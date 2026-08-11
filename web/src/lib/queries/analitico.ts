import "server-only";

import {
  ConstrutorParams,
  escaparLike,
  identificadorPermitido,
  query,
} from "@/lib/database";
import type { Direcao } from "@/lib/filtros/esquemas";
import { toNumber } from "@/lib/format";

import { condicoesDeCorte, juntarE, type FiltroCusto } from "./filtros-sql";

/**
 * Consulta analitica: LINHA A LINHA de `aws_daily_costs`, paginada no banco.
 *
 * Diferente das queries do painel executivo, que devolvem agregados. Aqui o
 * usuario quer ver o lancamento individual -- e por isso a paginacao no
 * servidor nao e detalhe de performance, e sim requisito: a tabela cresce
 * indefinidamente com o tempo e nao pode ser baixada inteira.
 *
 * PLANO DE EXECUCAO MEDIDO em 11/08/2026 (642 linhas, 288 kB):
 *
 *   Execution Time: 1,228 ms
 *   Index Scan Backward using aws_daily_costs_usage_date_account_id_service_region_key
 *   Incremental Sort -> Presorted Key: d.usage_date
 *
 * O indice UNIQUE que o ETL usa para deduplicar tem `usage_date` como primeira
 * coluna, entao serve tanto ao corte por periodo quanto a ordenacao padrao.
 * Nenhum indice novo e necessario hoje -- ver scripts/proposta-indices-analitico.sql
 * para os gatilhos objetivos que justificariam criar.
 */

/**
 * Nome exposto na API -> expressao SQL. Lista FECHADA.
 *
 * Ordenacao NAO pode ser parametro no protocolo do Postgres: o nome da coluna
 * vai para o texto da query. Esta e a unica porta, e `identificadorPermitido`
 * reforca a checagem na hora de montar.
 */
const COLUNAS_ORDENACAO = {
  usageDate: "d.usage_date",
  accountId: "d.account_id",
  accountName: "a.account_name",
  service: "d.service",
  region: "d.region",
  cost: "d.cost_amount",
} as const;

export type OrdenacaoAnalitica = keyof typeof COLUNAS_ORDENACAO;

export const CAMPOS_ORDENACAO_ANALITICA = Object.keys(COLUNAS_ORDENACAO) as [
  OrdenacaoAnalitica,
  ...OrdenacaoAnalitica[],
];

export type LinhaAnalitica = {
  id: string;
  /** Data de uso, "AAAA-MM-DD" -- data de calendario, sem fuso. */
  usageDate: string;
  accountId: string;
  /** `null` quando a conta tem custo mas nao esta em `cloud_accounts`. */
  accountName: string | null;
  service: string;
  /**
   * `null` quando o ETL nao informou a regiao. A string literal "nan" que o ETL
   * grava e traduzida aqui, para o cliente nao precisar conhecer esse detalhe.
   */
  region: string | null;
  costUSD: number;
  currency: string;
};

export type PaginaAnalitica = {
  linhas: LinhaAnalitica[];
  /** Total de linhas que casam com o filtro, no banco. Nao apenas nesta pagina. */
  total: number;
  /** Soma em USD de TODAS as linhas do filtro, nao so da pagina. */
  somaUSD: number;
};

export type OpcoesAnalitico = {
  busca?: string;
  ordenarPor: OrdenacaoAnalitica;
  direcao: Direcao;
  pagina: number;
  tamanho: number;
};

/** Valor cru que o ETL grava quando nao sabe a regiao (NaN do pandas). */
const REGIAO_CRUA = "nan";

export async function getPaginaAnalitica(
  filtro: FiltroCusto,
  opcoes: OpcoesAnalitico,
): Promise<PaginaAnalitica> {
  if (!identificadorPermitido(opcoes.ordenarPor, COLUNAS_ORDENACAO)) {
    throw new Error(`Campo de ordenacao invalido: ${opcoes.ordenarPor}`);
  }
  const coluna = COLUNAS_ORDENACAO[opcoes.ordenarPor];
  const direcao = opcoes.direcao === "asc" ? "ASC" : "DESC";

  const p = new ConstrutorParams();

  // O analitico usa APENAS a janela atual: nao existe comparacao com periodo
  // anterior numa lista de lancamentos.
  const de = p.add(filtro.periodo.de);
  const ate = p.add(filtro.periodo.ate);
  const condicoes = [
    `d.usage_date BETWEEN ${de} AND ${ate}`,
    ...condicoesDeCorte(p, filtro),
  ];

  if (opcoes.busca) {
    // O termo vai como PARAMETRO; os curingas viram literais para que uma busca
    // por "%" nao devolva a base inteira.
    const termo = p.add(`%${escaparLike(opcoes.busca)}%`);
    condicoes.push(`d.service ILIKE ${termo} ESCAPE '\\'`);
  }

  const limite = p.add(opcoes.tamanho);
  const deslocamento = p.add((opcoes.pagina - 1) * opcoes.tamanho);
  const regiaoCrua = p.add(REGIAO_CRUA);

  const linhas = await query<{
    id: string;
    usage_date: string;
    account_id: string;
    account_name: string | null;
    service: string;
    region: string | null;
    cost_amount: string;
    currency: string | null;
    total_geral: string;
    soma_usd: string;
  }>(
    `
    SELECT d.id,
           d.usage_date,
           d.account_id,
           a.account_name,
           d.service,
           -- "nan" nao e regiao, e ausencia de informacao. Traduzir aqui evita
           -- que a interface precise conhecer a peculiaridade do ETL.
           nullif(d.region, ${regiaoCrua}) AS region,
           d.cost_amount,
           d.currency,
           -- Contagem e soma na MESMA ida ao banco. Funcao de janela roda antes
           -- do LIMIT, entao os dois valores cobrem o filtro inteiro, nao a
           -- pagina -- e e isso que a paginacao e o rodape precisam.
           count(*) OVER ()             AS total_geral,
           sum(d.cost_amount) OVER ()   AS soma_usd
      FROM aws_daily_costs d
      LEFT JOIN cloud_accounts a ON a.account_id = d.account_id
     WHERE ${juntarE(condicoes)}
     -- d.id como ultimo critério: sem desempate estavel, duas paginas podem
     -- repetir ou omitir uma linha, porque OFFSET nao garante ordem entre
     -- linhas de mesmo valor.
     ORDER BY ${coluna} ${direcao} NULLS LAST, d.id ASC
     LIMIT ${limite} OFFSET ${deslocamento}
    `,
    p.lista,
  );

  return {
    total: linhas.length > 0 ? Number(linhas[0].total_geral) : 0,
    somaUSD: linhas.length > 0 ? toNumber(linhas[0].soma_usd) : 0,
    linhas: linhas.map((l) => ({
      id: String(l.id),
      usageDate: l.usage_date,
      accountId: l.account_id,
      accountName: l.account_name,
      service: l.service,
      region: l.region,
      costUSD: toNumber(l.cost_amount),
      currency: l.currency ?? "USD",
    })),
  };
}

/**
 * Regioes presentes no periodo, para montar o filtro.
 *
 * Consulta separada e proposital: a lista precisa refletir o periodo escolhido
 * (nao faz sentido oferecer regiao que nao aparece na janela), mas nao pode
 * depender do filtro de regiao em vigor -- senao, ao escolher uma, as outras
 * desapareceriam e nao haveria como voltar.
 */
export async function getRegioesDoPeriodo(
  filtro: FiltroCusto,
): Promise<{ valor: string | null; linhas: number }[]> {
  const p = new ConstrutorParams();
  const de = p.add(filtro.periodo.de);
  const ate = p.add(filtro.periodo.ate);
  const regiaoCrua = p.add(REGIAO_CRUA);

  // Corte por conta VALE aqui (regiao de outra conta nao interessa); corte por
  // regiao, nao.
  const condicoes = [`d.usage_date BETWEEN ${de} AND ${ate}`];
  if (filtro.contas.length > 0) {
    condicoes.push(`d.account_id = ANY(${p.add(filtro.contas)})`);
  }

  const linhas = await query<{ valor: string | null; linhas: string }>(
    `
    SELECT nullif(d.region, ${regiaoCrua}) AS valor, count(*) AS linhas
      FROM aws_daily_costs d
     WHERE ${juntarE(condicoes)}
     GROUP BY 1
     ORDER BY 2 DESC, 1 ASC NULLS LAST
    `,
    p.lista,
  );

  return linhas.map((l) => ({ valor: l.valor, linhas: Number(l.linhas) }));
}
