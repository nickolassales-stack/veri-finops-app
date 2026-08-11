import "server-only";

import { ConstrutorParams, identificadorPermitido, query, queryOne } from "@/lib/database";
import type { Direcao } from "@/lib/filtros/esquemas";
import { hojeEm, type ContextoTemporal } from "@/lib/filtros/periodo";
import { toNumber } from "@/lib/format";

import { condicoesDeCorte, janelas, juntarE, type FiltroCusto } from "./filtros-sql";

/**
 * Queries do dashboard. Validadas contra o banco real em 06/08/2026 --
 * ver docs/schema-snapshot.md.
 *
 * FONTE UNICA: `aws_daily_costs`. O periodo pode comecar e terminar em
 * qualquer dia, e a tabela mensal so tem granularidade de mes -- filtrar
 * "01 a 05 de agosto" nela seria impossivel. Os dois totais conferem
 * (agosto: 42,61 no diario e 42,61 no mensal), entao nao ha perda de
 * fidelidade em usar o diario para tudo.
 *
 * Toda agregacao acontece no Postgres. O que trafega para o Node ja e o
 * resultado somado -- nunca o historico bruto.
 */

// ------------------------------------------------------------------- contexto

/**
 * Le da base o que o resolvedor de periodo precisa saber.
 *
 * "Hoje" e calculado em JavaScript no fuso de exibicao (nao no banco, que roda
 * em Etc/UTC): a virada do dia que importa para um relatorio brasileiro e a de
 * America/Sao_Paulo.
 */
export async function getContextoTemporal(tz: string): Promise<ContextoTemporal> {
  const linha = await queryOne<{ maior: string | null }>(
    `SELECT max(usage_date) AS maior FROM aws_daily_costs`,
  );

  return { hoje: hojeEm(tz), maiorDataComDado: linha.maior };
}

// --------------------------------------------------------------------- resumo

export type Resumo = {
  /** Custo total em USD na janela. Sem conversao de moeda. */
  total: number;
  totalAnterior: number;
  /** Fracao: 0.12 = +12%. `null` quando nao ha base de comparacao. */
  variacao: number | null;
  /**
   * `false` quando o conjunto de contas com dado difere entre as duas janelas.
   * Nesse caso a variacao nao mede consumo, e sim ausencia de carga -- foi
   * exatamente o que aconteceu entre julho (so a conta piloto) e agosto (so a
   * conta nova). A interface precisa dizer isso em vez de exibir o percentual
   * como se fosse fato de negocio.
   */
  comparavel: boolean;
  contasComCusto: number;
  contasComCustoAnterior: number;
  contasAtivasCadastradas: number;
  servicos: number;
  /** Dias da janela que realmente tem linha carregada. */
  diasComDado: number;
  primeiroDiaComDado: string | null;
  ultimoDiaComDado: string | null;
  /** Media por dia COM dado -- nao por dia da janela, que diluiria o valor. */
  mediaDiaria: number;
};

export async function getResumo(filtro: FiltroCusto): Promise<Resumo> {
  const p = new ConstrutorParams();
  const j = janelas(p, filtro);
  const corte = condicoesDeCorte(p, filtro);

  const linha = await queryOne<{
    total: string;
    total_anterior: string;
    contas: string;
    contas_anterior: string;
    servicos: string;
    dias_com_dado: string;
    primeiro_dia: string | null;
    ultimo_dia: string | null;
    mesmas_contas: boolean | null;
    contas_ativas: string;
  }>(
    `
    WITH base AS (
      SELECT d.usage_date, d.account_id, d.service, d.cost_amount
        FROM aws_daily_costs d
       WHERE ${j.qualquerUmaDasDuas}
         AND ${juntarE(corte)}
    )
    SELECT
      coalesce(sum(cost_amount) FILTER (WHERE ${j.atual}), 0)    AS total,
      coalesce(sum(cost_amount) FILTER (WHERE ${j.anterior}), 0) AS total_anterior,
      count(DISTINCT account_id) FILTER (WHERE ${j.atual})    AS contas,
      count(DISTINCT account_id) FILTER (WHERE ${j.anterior}) AS contas_anterior,
      count(DISTINCT service)    FILTER (WHERE ${j.atual})    AS servicos,
      count(DISTINCT usage_date) FILTER (WHERE ${j.atual})    AS dias_com_dado,
      min(usage_date) FILTER (WHERE ${j.atual}) AS primeiro_dia,
      max(usage_date) FILTER (WHERE ${j.atual}) AS ultimo_dia,
      -- Compara o CONJUNTO de contas, nao a quantidade: duas janelas podem ter
      -- uma conta cada e serem contas diferentes. array_agg(DISTINCT ...) sai
      -- ordenado, entao a igualdade de arrays equivale a igualdade de conjuntos.
      (array_agg(DISTINCT account_id) FILTER (WHERE ${j.atual})
       IS NOT DISTINCT FROM
       array_agg(DISTINCT account_id) FILTER (WHERE ${j.anterior})) AS mesmas_contas,
      (SELECT count(*) FROM cloud_accounts WHERE active) AS contas_ativas
    FROM base d
    `,
    p.lista,
  );

  const total = toNumber(linha.total);
  const totalAnterior = toNumber(linha.total_anterior);
  const contasComCusto = Number(linha.contas);
  const diasComDado = Number(linha.dias_com_dado);

  return {
    total,
    totalAnterior,
    variacao: totalAnterior > 0 ? (total - totalAnterior) / totalAnterior : null,
    comparavel: contasComCusto > 0 && linha.mesmas_contas === true,
    contasComCusto,
    contasComCustoAnterior: Number(linha.contas_anterior),
    contasAtivasCadastradas: Number(linha.contas_ativas),
    servicos: Number(linha.servicos),
    diasComDado,
    primeiroDiaComDado: linha.primeiro_dia,
    ultimoDiaComDado: linha.ultimo_dia,
    mediaDiaria: diasComDado > 0 ? total / diasComDado : 0,
  };
}

// ------------------------------------------------------------ custo por conta

const COLUNAS_ORDENACAO_CUSTO = {
  custo: "total",
  anterior: "total_anterior",
  conta: "account_id",
  nome: "account_name",
} as const;

export type OrdenacaoCusto = keyof typeof COLUNAS_ORDENACAO_CUSTO;

export const CAMPOS_ORDENACAO_CUSTO = Object.keys(COLUNAS_ORDENACAO_CUSTO) as [
  OrdenacaoCusto,
  ...OrdenacaoCusto[],
];

export type CustoDaConta = {
  accountId: string;
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  active: boolean;
  /** `false` quando a conta tem custo mas nao esta em `cloud_accounts`. */
  cadastrada: boolean;
  total: number;
  totalAnterior: number;
  variacao: number | null;
  /** Fatia do total da janela, 0..1. */
  participacao: number;
  /** Distingue "custo zero" de "nenhuma linha carregada". */
  temDadoNaJanela: boolean;
};

export type CustoPorContaPaginado = {
  itens: CustoDaConta[];
  total: number;
  totalDaJanela: number;
};

export async function getCustoPorConta(
  filtro: FiltroCusto,
  opcoes: {
    ordenarPor: OrdenacaoCusto;
    direcao: Direcao;
    pagina: number;
    tamanho: number;
  },
): Promise<CustoPorContaPaginado> {
  if (!identificadorPermitido(opcoes.ordenarPor, COLUNAS_ORDENACAO_CUSTO)) {
    throw new Error(`Campo de ordenacao invalido: ${opcoes.ordenarPor}`);
  }
  const coluna = COLUNAS_ORDENACAO_CUSTO[opcoes.ordenarPor];
  const direcao = opcoes.direcao === "asc" ? "ASC" : "DESC";

  const p = new ConstrutorParams();
  const j = janelas(p, filtro);
  const corte = condicoesDeCorte(p, filtro);
  const limite = p.add(opcoes.tamanho);
  const deslocamento = p.add((opcoes.pagina - 1) * opcoes.tamanho);

  const linhas = await query<{
    account_id: string;
    account_name: string | null;
    business_unit: string | null;
    cost_center: string | null;
    environment: string | null;
    active: boolean | null;
    cadastrada: boolean;
    total: string;
    total_anterior: string;
    linhas_na_janela: string;
    total_geral: string;
    soma_janela: string;
  }>(
    `
    WITH agregado AS (
      SELECT d.account_id,
             coalesce(sum(d.cost_amount) FILTER (WHERE ${j.atual}), 0)    AS total,
             coalesce(sum(d.cost_amount) FILTER (WHERE ${j.anterior}), 0) AS total_anterior,
             count(*) FILTER (WHERE ${j.atual}) AS linhas_na_janela
        FROM aws_daily_costs d
       WHERE ${j.qualquerUmaDasDuas}
         AND ${juntarE(corte)}
       GROUP BY d.account_id
    )
    SELECT g.account_id,
           a.account_name,
           a.business_unit,
           a.cost_center,
           a.environment,
           a.active,
           (a.account_id IS NOT NULL) AS cadastrada,
           g.total,
           g.total_anterior,
           g.linhas_na_janela,
           count(*) OVER ()    AS total_geral,
           sum(g.total) OVER () AS soma_janela
      FROM agregado g
      LEFT JOIN cloud_accounts a ON a.account_id = g.account_id
     ORDER BY ${coluna} ${direcao} NULLS LAST, g.account_id ASC
     LIMIT ${limite} OFFSET ${deslocamento}
    `,
    p.lista,
  );

  // As funcoes de janela rodam ANTES do LIMIT, entao `soma_janela` e o total
  // de todas as contas do periodo, nao apenas o desta pagina.
  const totalDaJanela = linhas.length > 0 ? toNumber(linhas[0].soma_janela) : 0;

  return {
    total: linhas.length > 0 ? Number(linhas[0].total_geral) : 0,
    totalDaJanela,
    itens: linhas.map((l) => {
      const total = toNumber(l.total);
      const totalAnterior = toNumber(l.total_anterior);
      return {
        accountId: l.account_id,
        accountName: l.account_name ?? `Conta ${l.account_id}`,
        businessUnit: l.business_unit,
        costCenter: l.cost_center,
        environment: l.environment,
        active: l.active ?? false,
        cadastrada: l.cadastrada,
        total,
        totalAnterior,
        variacao: totalAnterior > 0 ? (total - totalAnterior) / totalAnterior : null,
        participacao: totalDaJanela > 0 ? total / totalDaJanela : 0,
        temDadoNaJanela: Number(l.linhas_na_janela) > 0,
      };
    }),
  };
}

// ------------------------------------------------------------------ servicos

export type CustoDoServico = {
  servico: string;
  total: number;
  totalAnterior: number;
  variacao: number | null;
  participacao: number;
};

export type TopServicos = {
  itens: CustoDoServico[];
  /** Soma dos servicos fora do top N. Zero quando todos couberam. */
  outros: number;
  totalDaJanela: number;
  servicosNaJanela: number;
};

export async function getTopServicos(
  filtro: FiltroCusto,
  limite: number,
): Promise<TopServicos> {
  const p = new ConstrutorParams();
  const j = janelas(p, filtro);
  const corte = condicoesDeCorte(p, filtro);
  const pLimite = p.add(limite);

  const linhas = await query<{
    service: string;
    total: string;
    total_anterior: string;
    total_janela: string;
    servicos_na_janela: string;
  }>(
    `
    WITH agregado AS (
      SELECT d.service,
             coalesce(sum(d.cost_amount) FILTER (WHERE ${j.atual}), 0)    AS total,
             coalesce(sum(d.cost_amount) FILTER (WHERE ${j.anterior}), 0) AS total_anterior
        FROM aws_daily_costs d
       WHERE ${j.qualquerUmaDasDuas}
         AND ${juntarE(corte)}
       GROUP BY d.service
    ), com_totais AS (
      SELECT service, total, total_anterior,
             sum(total) OVER ()  AS total_janela,
             count(*) OVER ()    AS servicos_na_janela
        FROM agregado
       -- Arredondado, e nao bruto: ha servicos com fracao de centavo
       -- (AmazonCloudFront a 0,001181). Eles entrariam no ranking como barra
       -- invisivel rotulada "US$ 0,00", que e ruido puro.
       WHERE round(total, 2) > 0
    )
    SELECT * FROM com_totais
     ORDER BY total DESC, service ASC
     LIMIT ${pLimite}
    `,
    p.lista,
  );

  const totalDaJanela = linhas.length > 0 ? toNumber(linhas[0].total_janela) : 0;
  const somaExibida = linhas.reduce((acc, l) => acc + toNumber(l.total), 0);

  return {
    totalDaJanela,
    servicosNaJanela: linhas.length > 0 ? Number(linhas[0].servicos_na_janela) : 0,
    // Arredonda para nao devolver residuo de ponto flutuante como se fosse
    // custo de servico ("Outros: US$ 0,0000000003").
    outros: Math.max(0, Number((totalDaJanela - somaExibida).toFixed(6))),
    itens: linhas.map((l) => {
      const total = toNumber(l.total);
      const totalAnterior = toNumber(l.total_anterior);
      return {
        servico: l.service,
        total,
        totalAnterior,
        variacao: totalAnterior > 0 ? (total - totalAnterior) / totalAnterior : null,
        participacao: totalDaJanela > 0 ? total / totalDaJanela : 0,
      };
    }),
  };
}

// -------------------------------------------------------------- serie diaria

export type PontoDiario = {
  data: string;
  total: number;
  contas: number;
  /**
   * `true` quando o dia nao tem NENHUMA linha na base. Diferente de custo zero:
   * um dia sem carga precisa aparecer como lacuna, nao como queda a zero.
   */
  semDado: boolean;
};

export async function getSerieDiaria(filtro: FiltroCusto): Promise<PontoDiario[]> {
  const p = new ConstrutorParams();
  const de = p.add(filtro.periodo.de);
  const ate = p.add(filtro.periodo.ate);
  const corte = condicoesDeCorte(p, filtro);

  // Os cortes vao na condicao do LEFT JOIN, nao no WHERE: no WHERE eles
  // eliminariam a linha do `generate_series` e o dia sem dado desapareceria
  // do grafico em vez de aparecer como lacuna.
  const linhas = await query<{
    dia: string;
    total: string;
    linhas: string;
    contas: string;
  }>(
    `
    WITH dias AS (
      SELECT generate_series(${de}::date, ${ate}::date, interval '1 day')::date AS dia
    )
    SELECT dias.dia,
           coalesce(sum(d.cost_amount), 0)  AS total,
           count(d.id)                      AS linhas,
           count(DISTINCT d.account_id)     AS contas
      FROM dias
      LEFT JOIN aws_daily_costs d
             ON d.usage_date = dias.dia
            AND ${juntarE(corte)}
     GROUP BY dias.dia
     ORDER BY dias.dia
    `,
    p.lista,
  );

  return linhas.map((l) => ({
    data: l.dia,
    total: toNumber(l.total),
    contas: Number(l.contas),
    semDado: Number(l.linhas) === 0,
  }));
}

// --------------------------------------------------- serie diaria por servico

export const ROTULO_OUTROS = "Outros";

export type SerieDeServico = {
  nome: string;
  total: number;
  /** Alinhado indice a indice com `dias`. */
  valores: number[];
};

export type SerieDiariaPorServico = {
  dias: string[];
  series: SerieDeServico[];
  /** `true` quando houve agrupamento em "Outros". */
  agrupou: boolean;
  servicosNaJanela: number;
};

/**
 * Evolucao diaria quebrada por servico.
 *
 * Os servicos alem do top N viram uma unica serie "Outros" -- agregada no
 * banco, nao no cliente. Alem de manter o payload limitado, isso segue a regra
 * de visualizacao do projeto: cores categoricas saem de uma lista fixa e nao
 * sao recicladas; a serie que nao tem cor propria e agrupada.
 */
export async function getSerieDiariaPorServico(
  filtro: FiltroCusto,
  limiteSeries: number,
): Promise<SerieDiariaPorServico> {
  const p = new ConstrutorParams();
  const de = p.add(filtro.periodo.de);
  const ate = p.add(filtro.periodo.ate);
  const corte = condicoesDeCorte(p, filtro);
  const pLimite = p.add(limiteSeries);
  const pOutros = p.add(ROTULO_OUTROS);

  const linhas = await query<{
    dia: string;
    serie: string;
    total: string;
    servicos_na_janela: string;
  }>(
    `
    WITH base AS (
      SELECT d.usage_date, d.service, d.cost_amount
        FROM aws_daily_costs d
       WHERE d.usage_date BETWEEN ${de}::date AND ${ate}::date
         AND ${juntarE(corte)}
    ), ranking AS (
      SELECT service, sum(cost_amount) AS total,
             count(*) OVER () AS servicos_na_janela
        FROM base GROUP BY service
    ), destaque AS (
      SELECT service, servicos_na_janela FROM ranking
       -- Mesma regra do ranking: quadro de servico que soma menos de um centavo
       -- seria uma linha reta em zero, ocupando espaco sem informar nada.
       WHERE round(total, 2) > 0
       ORDER BY total DESC, service ASC
       LIMIT ${pLimite}
    )
    SELECT b.usage_date AS dia,
           CASE WHEN b.service IN (SELECT service FROM destaque)
                THEN b.service ELSE ${pOutros} END AS serie,
           sum(b.cost_amount) AS total,
           (SELECT max(servicos_na_janela) FROM ranking) AS servicos_na_janela
      FROM base b
     GROUP BY 1, 2
     ORDER BY 1, 2
    `,
    p.lista,
  );

  // A grade de dias vem do periodo, nao das linhas: dia sem custo precisa
  // existir no eixo, senao o grafico "pula" a lacuna e distorce a inclinacao.
  const dias = gerarDias(filtro.periodo.de, filtro.periodo.ate);
  const indicePorDia = new Map(dias.map((d, i) => [d, i]));

  const porSerie = new Map<string, number[]>();
  for (const linha of linhas) {
    const indice = indicePorDia.get(linha.dia);
    if (indice === undefined) continue;
    let valores = porSerie.get(linha.serie);
    if (!valores) {
      valores = new Array<number>(dias.length).fill(0);
      porSerie.set(linha.serie, valores);
    }
    valores[indice] = toNumber(linha.total);
  }

  const series: SerieDeServico[] = [...porSerie.entries()]
    .map(([nome, valores]) => ({
      nome,
      valores,
      total: valores.reduce((a, b) => a + b, 0),
    }))
    // "Outros" sempre por ultimo; os demais por tamanho.
    .sort((a, b) =>
      a.nome === ROTULO_OUTROS ? 1 : b.nome === ROTULO_OUTROS ? -1 : b.total - a.total,
    );

  return {
    dias,
    series,
    agrupou: porSerie.has(ROTULO_OUTROS),
    servicosNaJanela: linhas.length > 0 ? Number(linhas[0].servicos_na_janela) : 0,
  };
}

/** Grade de datas "AAAA-MM-DD" de `de` ate `ate`, inclusive. */
function gerarDias(de: string, ate: string): string[] {
  const dias: string[] = [];
  const atual = new Date(`${de}T00:00:00Z`);
  const fim = new Date(`${ate}T00:00:00Z`);
  while (atual <= fim) {
    dias.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

