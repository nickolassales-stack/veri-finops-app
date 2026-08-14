import "server-only";

import {
  ConstrutorParams,
  identificadorPermitido,
  query,
  queryForaDoEscopo,
} from "@/lib/database";
import type { Direcao } from "@/lib/filtros/esquemas";
import { toNumber } from "@/lib/format";

import {
  aliasDisponivel,
  expressaoCampoDaConta,
  expressaoNomeDaConta,
  joinAlias,
  type AmarracaoAlias,
} from "./alias-conta";
import { condicoesDeCorte, janelaAtual, juntarE, type FiltroCusto } from "./filtros-sql";

/**
 * Historico mensal de custo por conta -- a visao FINANCEIRA.
 *
 * A diferenca em relacao ao analitico por servico nao e de apresentacao, e de
 * PERGUNTA:
 *
 *   por servico   "o que foi consumido, e quando"      -> granularidade de dia
 *   por custo     "quanto cada conta custou por mes"   -> granularidade de mes
 *
 * Aqui o agrupamento e sempre `billing_month` -- o mes em que a AWS FATUROU --
 * e nunca a data de uso. Uma cobranca pontual com data de uso em setembro que
 * pertence a fatura de julho entra em JULHO nesta tela, exatamente como no Cost
 * Explorer. Agrupar por data de uso produziria um historico que nao fecha com a
 * fatura, que e a unica coisa que esta tela existe para responder.
 *
 * A evolucao diaria do painel executivo continua por data de uso, e esta certa:
 * ela responde "em que dia rodou", nao "em que fatura caiu". Sao visoes
 * diferentes do mesmo dado, e nenhuma das duas serve para o trabalho da outra.
 *
 * FONTE: `aws_daily_costs`, como todo o resto do portal. A tabela mensal existe
 * mas nao e lida por aqui -- ter duas fontes para o mesmo numero e como elas
 * divergem sem ninguem perceber.
 */

// --------------------------------------------------------------------- tipos

export type FiltroHistorico = FiltroCusto & {
  /** Filtros de cadastro. `undefined` = nao filtrar. */
  unidade?: string;
  centroDeCusto?: string;
  ambiente?: string;
};

export type LinhaHistorico = {
  /** Mes de COBRANCA, "AAAA-MM". */
  mes: string;
  accountId: string;
  /** Nome resolvido: alias -> account_name -> conta-<id>. Nunca vazio. */
  nomeExibicao: string;
  /** O alias digitado, ou `null`. A tela mostra as duas colunas. */
  alias: string | null;
  unidade: string | null;
  centroDeCusto: string | null;
  ambiente: string | null;
  custoUSD: number;
  /** Custo da MESMA conta no mes anterior da serie. `null` no primeiro mes. */
  custoAnterior: number | null;
  /** Absoluta, em USD. `null` quando nao ha mes anterior. */
  variacaoAbsoluta: number | null;
  /** Fracao, 0..1. `null` quando nao ha base de comparacao ou ela e zero. */
  variacaoPercentual: number | null;
  /** Fatia do total do periodo inteiro, 0..1. */
  participacao: number;
};

export type ResumoHistorico = {
  total: number;
  /** Media POR MES da serie, nao por linha. */
  mediaMensal: number;
  meses: number;
  maiorMes: { mes: string; total: number } | null;
  menorMes: { mes: string; total: number } | null;
  /** Ultimo mes com dado. */
  ultimoMes: { mes: string; total: number } | null;
  /** Penultimo, base da variacao do card. */
  mesAnterior: { mes: string; total: number } | null;
  variacao: number | null;
};

export type PontoMensalPorConta = {
  mes: string;
  /** Uma entrada por conta com custo naquele mes. */
  contas: { accountId: string; nomeExibicao: string; total: number }[];
  total: number;
};

// ------------------------------------------------------------------ ordenacao

const COLUNAS_ORDENACAO = {
  mes: "mes",
  conta: "nome_exibicao",
  custo: "custo",
  variacao: "variacao_absoluta",
} as const;

export type OrdenacaoHistorico = keyof typeof COLUNAS_ORDENACAO;

export const CAMPOS_ORDENACAO_HISTORICO = Object.keys(COLUNAS_ORDENACAO) as [
  OrdenacaoHistorico,
  ...OrdenacaoHistorico[],
];

// -------------------------------------------------------------------- SQL base

const AMARRACAO: AmarracaoAlias = { colunaId: "d.account_id", cadastro: "a" };

/**
 * O nucleo compartilhado por listagem, resumo, serie e exportacao.
 *
 * Uma funcao so porque as quatro precisam responder ao MESMO recorte. Montar o
 * WHERE em cada lugar deixaria o card e a tabela discordando na primeira vez que
 * alguem acrescentasse um filtro num deles e esquecesse do outro -- e discordar
 * e o unico defeito que esta tela nao pode ter.
 */
async function baseDoHistorico(p: ConstrutorParams, filtro: FiltroHistorico) {
  const comAlias = await aliasDisponivel();

  const nome = expressaoNomeDaConta(comAlias, AMARRACAO);
  const unidade = expressaoCampoDaConta(comAlias, "business_unit", AMARRACAO);
  const centro = expressaoCampoDaConta(comAlias, "cost_center", AMARRACAO);
  const ambiente = expressaoCampoDaConta(comAlias, "environment", AMARRACAO);

  // Criterio de COBRANCA -- ver o cabecalho deste arquivo.
  const condicoes = [janelaAtual(p, filtro, "d", "cobranca"), ...condicoesDeCorte(p, filtro)];

  // Filtros de cadastro comparam o valor JA RESOLVIDO (portal vence cadastro),
  // senao editar o centro de custo na tela de configuracoes nao mudaria nada
  // aqui.
  if (filtro.unidade !== undefined) condicoes.push(`${unidade} = ${p.add(filtro.unidade)}`);
  if (filtro.centroDeCusto !== undefined) {
    condicoes.push(`${centro} = ${p.add(filtro.centroDeCusto)}`);
  }
  if (filtro.ambiente !== undefined) condicoes.push(`${ambiente} = ${p.add(filtro.ambiente)}`);

  /**
   * `coalesce(d.billing_month, date_trunc(...usage_date...))` e a mesma cascata
   * do resto do sistema: antes do backfill a coluna e nula e o portal se
   * comporta como antes, sem regressao.
   */
  const mesDeCobranca = `coalesce(d.billing_month, date_trunc('month', d.usage_date::timestamp)::date)`;

  const de = `
    FROM aws_daily_costs d
    LEFT JOIN cloud_accounts a ON a.account_id = d.account_id
    ${joinAlias(comAlias, AMARRACAO)}
   WHERE ${juntarE(condicoes)}
  `;

  return { de, nome, unidade, centro, ambiente, mesDeCobranca, comAlias };
}

/** CTE com uma linha por (mes de cobranca, conta). Base de tudo abaixo. */
function cteMensal(base: Awaited<ReturnType<typeof baseDoHistorico>>): string {
  return `
    mensal AS (
      SELECT to_char(${base.mesDeCobranca}, 'YYYY-MM') AS mes,
             d.account_id,
             min(${base.nome})     AS nome_exibicao,
             min(${base.unidade})  AS unidade,
             min(${base.centro})   AS centro_de_custo,
             min(${base.ambiente}) AS ambiente,
             sum(d.cost_amount)    AS custo
        ${base.de}
       GROUP BY 1, 2
    )
  `;
}

// ----------------------------------------------------------------- listagem

export type PaginaHistorico = {
  linhas: LinhaHistorico[];
  total: number;
  somaUSD: number;
};

export async function getPaginaHistorico(
  filtro: FiltroHistorico,
  opcoes: {
    ordenarPor: OrdenacaoHistorico;
    direcao: Direcao;
    pagina: number;
    tamanho: number;
    foraDoEscopoDaRequisicao?: boolean;
  },
): Promise<PaginaHistorico> {
  if (!identificadorPermitido(opcoes.ordenarPor, COLUNAS_ORDENACAO)) {
    throw new Error(`Campo de ordenacao invalido: ${opcoes.ordenarPor}`);
  }
  const coluna = COLUNAS_ORDENACAO[opcoes.ordenarPor];
  const direcao = opcoes.direcao === "asc" ? "ASC" : "DESC";

  const p = new ConstrutorParams();
  const base = await baseDoHistorico(p, filtro);
  const limite = p.add(opcoes.tamanho);
  const deslocamento = p.add((opcoes.pagina - 1) * opcoes.tamanho);

  const executar = opcoes.foraDoEscopoDaRequisicao ? queryForaDoEscopo : query;

  const linhas = await executar<{
    mes: string;
    account_id: string;
    nome_exibicao: string;
    alias: string | null;
    unidade: string | null;
    centro_de_custo: string | null;
    ambiente: string | null;
    custo: string;
    custo_anterior: string | null;
    variacao_absoluta: string | null;
    total_geral: string;
    soma_usd: string;
  }>(
    `
    WITH ${cteMensal(base)},
    comparado AS (
      SELECT m.*,
             -- Mes anterior DA MESMA CONTA na serie, nao a linha anterior da
             -- tabela: sem o PARTITION, a variacao compararia contas
             -- diferentes e o numero nao significaria nada.
             lag(m.custo) OVER (PARTITION BY m.account_id ORDER BY m.mes) AS custo_anterior
        FROM mensal m
    )
    SELECT c.mes,
           c.account_id,
           c.nome_exibicao,
           s.alias,
           c.unidade,
           c.centro_de_custo,
           c.ambiente,
           c.custo,
           c.custo_anterior,
           (c.custo - c.custo_anterior) AS variacao_absoluta,
           count(*) OVER ()      AS total_geral,
           sum(c.custo) OVER ()  AS soma_usd
      FROM comparado c
      ${base.comAlias ? "LEFT JOIN app_account_settings s ON s.account_id = c.account_id" : "LEFT JOIN (SELECT NULL::text AS account_id, NULL::text AS alias) s ON false"}
     ORDER BY ${coluna} ${direcao} NULLS LAST, c.mes DESC, c.account_id ASC
     LIMIT ${limite} OFFSET ${deslocamento}
    `,
    p.lista,
  );

  const somaUSD = linhas.length > 0 ? toNumber(linhas[0].soma_usd) : 0;

  return {
    total: linhas.length > 0 ? Number(linhas[0].total_geral) : 0,
    somaUSD,
    linhas: linhas.map((l) => {
      const custo = toNumber(l.custo);
      const anterior = l.custo_anterior === null ? null : toNumber(l.custo_anterior);
      return {
        mes: l.mes,
        accountId: l.account_id,
        nomeExibicao: l.nome_exibicao,
        alias: l.alias,
        unidade: l.unidade,
        centroDeCusto: l.centro_de_custo,
        ambiente: l.ambiente,
        custoUSD: custo,
        custoAnterior: anterior,
        variacaoAbsoluta: anterior === null ? null : custo - anterior,
        // Divisao por zero devolve `null`, nao Infinity: "subiu infinito por
        // cento" nao e uma frase que alguem possa usar.
        variacaoPercentual: anterior === null || anterior === 0 ? null : (custo - anterior) / anterior,
        participacao: somaUSD > 0 ? custo / somaUSD : 0,
      };
    }),
  };
}

// -------------------------------------------------------------------- resumo

export async function getResumoHistorico(
  filtro: FiltroHistorico,
): Promise<ResumoHistorico> {
  const p = new ConstrutorParams();
  const base = await baseDoHistorico(p, filtro);

  const linhas = await query<{ mes: string; total: string }>(
    `
    WITH ${cteMensal(base)}
    SELECT mes, sum(custo) AS total
      FROM mensal
     GROUP BY mes
     ORDER BY mes ASC
    `,
    p.lista,
  );

  const meses = linhas.map((l) => ({ mes: l.mes, total: toNumber(l.total) }));

  if (meses.length === 0) {
    return {
      total: 0, mediaMensal: 0, meses: 0,
      maiorMes: null, menorMes: null, ultimoMes: null, mesAnterior: null, variacao: null,
    };
  }

  const total = meses.reduce((s, m) => s + m.total, 0);
  // Media POR MES COM DADO. Dividir pelos meses do calendario diluiria o valor
  // num periodo em que a conta simplesmente nao existia ainda.
  const mediaMensal = total / meses.length;

  const ordenadosPorValor = [...meses].sort((a, b) => a.total - b.total);
  const ultimoMes = meses[meses.length - 1];
  const mesAnterior = meses.length > 1 ? meses[meses.length - 2] : null;

  return {
    total,
    mediaMensal,
    meses: meses.length,
    maiorMes: ordenadosPorValor[ordenadosPorValor.length - 1],
    menorMes: ordenadosPorValor[0],
    ultimoMes,
    mesAnterior,
    variacao:
      mesAnterior && mesAnterior.total !== 0
        ? (ultimoMes.total - mesAnterior.total) / mesAnterior.total
        : null,
  };
}

// --------------------------------------------------------------------- serie

/** Serie mensal por conta -- alimenta a linha e as barras empilhadas. */
export async function getSerieMensalPorConta(
  filtro: FiltroHistorico,
): Promise<PontoMensalPorConta[]> {
  const p = new ConstrutorParams();
  const base = await baseDoHistorico(p, filtro);

  const linhas = await query<{
    mes: string;
    account_id: string;
    nome_exibicao: string;
    custo: string;
  }>(
    `
    WITH ${cteMensal(base)}
    SELECT mes, account_id, nome_exibicao, custo
      FROM mensal
     ORDER BY mes ASC, custo DESC
    `,
    p.lista,
  );

  const porMes = new Map<string, PontoMensalPorConta>();
  for (const l of linhas) {
    const total = toNumber(l.custo);
    const ponto = porMes.get(l.mes) ?? { mes: l.mes, contas: [], total: 0 };
    ponto.contas.push({
      accountId: l.account_id,
      nomeExibicao: l.nome_exibicao,
      total,
    });
    ponto.total += total;
    porMes.set(l.mes, ponto);
  }

  return [...porMes.values()];
}

// ------------------------------------------------------ opcoes dos filtros

export type OpcoesDeCadastro = {
  unidades: string[];
  centrosDeCusto: string[];
  ambientes: string[];
};

/**
 * Valores distintos para os seletores, lidos do CADASTRO e nao das linhas de
 * custo.
 *
 * Ler das linhas de custo esconderia a opcao de uma conta que ainda nao gastou
 * no periodo escolhido -- e o usuario concluiria que o centro de custo dela
 * deixou de existir, em vez de entender que nao houve custo.
 */
export async function getOpcoesDeCadastro(): Promise<OpcoesDeCadastro> {
  const comAlias = await aliasDisponivel();
  const amarracao: AmarracaoAlias = { colunaId: "a.account_id", cadastro: "a" };

  const linhas = await query<{
    unidade: string | null;
    centro_de_custo: string | null;
    ambiente: string | null;
  }>(
    `SELECT DISTINCT
            ${expressaoCampoDaConta(comAlias, "business_unit", amarracao)} AS unidade,
            ${expressaoCampoDaConta(comAlias, "cost_center", amarracao)}   AS centro_de_custo,
            ${expressaoCampoDaConta(comAlias, "environment", amarracao)}   AS ambiente
       FROM cloud_accounts a
       ${joinAlias(comAlias, amarracao)}`,
  );

  const distintos = (ler: (l: (typeof linhas)[number]) => string | null) =>
    [...new Set(linhas.map(ler).filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );

  return {
    unidades: distintos((l) => l.unidade),
    centrosDeCusto: distintos((l) => l.centro_de_custo),
    ambientes: distintos((l) => l.ambiente),
  };
}
