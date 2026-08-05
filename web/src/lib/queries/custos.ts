import "server-only";

import { query, queryOne } from "@/lib/db";
import { toNumber } from "@/lib/format";

/**
 * Queries de custo. Todas validadas contra o banco real em 05/08/2026 --
 * ver docs/schema-snapshot.md.
 *
 * Duas regras vindas da realidade do dado, nao da documentacao:
 *
 * 1) "Mes atual" e SEMPRE o mes de calendario corrente, nunca `max(month)`.
 *    A tabela contem periodos no futuro (cobrancas lancadas adiantado, como
 *    registro anual de dominio). Usar max(month) apontaria para setembro.
 *
 * 2) Janela de dias tambem se ancora na data de hoje, nunca em
 *    `max(usage_date)`. Com o registro futuro presente, ancorar no maximo
 *    devolvia um unico dia.
 */

/** Mes de referencia no fuso da aplicacao, como texto YYYY-MM-DD. */
const SQL_MES_REF = `date_trunc('month', (now() AT TIME ZONE $1)::date)::date`;

// ---------------------------------------------------------------------- KPIs

export type Kpis = {
  mesReferencia: string;
  mesAtual: number;
  mesAnterior: number;
  /** Fracao (-0.88 = -88%). `null` quando nao ha base de comparacao. */
  variacao: number | null;
  /**
   * `false` quando o conjunto de contas com dado difere entre os dois meses.
   * Nesse caso a variacao NAO representa mudanca de consumo, e sim ausencia
   * de carga -- a interface precisa dizer isso em vez de exibir o percentual
   * como se fosse um fato de negocio.
   */
  variacaoComparavel: boolean;
  lancadoNoFuturo: number;
  totalHistorico: number;
  mesesComDado: number;
  contasComDadoMesAtual: number;
  contasComDadoMesAnterior: number;
  contasAtivas: number;
};

export async function getKpis(tz: string): Promise<Kpis> {
  const row = await queryOne<{
    mes_referencia: Date;
    mes_atual: string;
    mes_anterior: string;
    lancado_no_futuro: string;
    total_historico: string;
    meses_com_dado: string;
    contas_mes_atual: string;
    contas_mes_anterior: string;
    mesmas_contas: boolean;
    contas_ativas: string;
  }>(
    `
    WITH ref AS (SELECT ${SQL_MES_REF} AS mes)
    SELECT
      r.mes AS mes_referencia,
      coalesce(sum(m.cost_amount) FILTER (WHERE m.month = r.mes), 0) AS mes_atual,
      coalesce(sum(m.cost_amount) FILTER (
        WHERE m.month = (r.mes - interval '1 month')::date), 0) AS mes_anterior,
      coalesce(sum(m.cost_amount) FILTER (WHERE m.month > r.mes), 0) AS lancado_no_futuro,
      coalesce(sum(m.cost_amount), 0) AS total_historico,
      count(DISTINCT m.month) AS meses_com_dado,
      count(DISTINCT m.account_id) FILTER (WHERE m.month = r.mes) AS contas_mes_atual,
      count(DISTINCT m.account_id) FILTER (
        WHERE m.month = (r.mes - interval '1 month')::date) AS contas_mes_anterior,
      -- Comparar o CONJUNTO de contas, nao a quantidade: dois meses podem ter
      -- uma conta cada e serem contas diferentes -- foi o que aconteceu entre
      -- julho (so a piloto) e agosto (so a nova). array_agg(DISTINCT ...) sai
      -- ordenado, portanto a igualdade de arrays e comparacao de conjuntos.
      (array_agg(DISTINCT m.account_id) FILTER (WHERE m.month = r.mes)
       IS NOT DISTINCT FROM
       array_agg(DISTINCT m.account_id) FILTER (
         WHERE m.month = (r.mes - interval '1 month')::date)) AS mesmas_contas,
      (SELECT count(*) FROM cloud_accounts WHERE active) AS contas_ativas
    FROM ref r
    LEFT JOIN aws_monthly_costs m ON true
    GROUP BY r.mes
    `,
    [tz],
  );

  const mesAtual = toNumber(row.mes_atual);
  const mesAnterior = toNumber(row.mes_anterior);
  const contasComDadoMesAtual = Number(row.contas_mes_atual);
  const contasComDadoMesAnterior = Number(row.contas_mes_anterior);

  return {
    mesReferencia: formatarDataISO(row.mes_referencia),
    mesAtual,
    mesAnterior,
    variacao: mesAnterior > 0 ? (mesAtual - mesAnterior) / mesAnterior : null,
    variacaoComparavel: contasComDadoMesAtual > 0 && row.mesmas_contas,
    lancadoNoFuturo: toNumber(row.lancado_no_futuro),
    totalHistorico: toNumber(row.total_historico),
    mesesComDado: Number(row.meses_com_dado),
    contasComDadoMesAtual,
    contasComDadoMesAnterior,
    contasAtivas: Number(row.contas_ativas),
  };
}

// ------------------------------------------------------------ custo por conta

export type CustoPorConta = {
  accountId: string;
  nome: string;
  /** `false` quando a conta tem custo mas nao esta cadastrada em cloud_accounts. */
  cadastrada: boolean;
  ativa: boolean;
  unidade: string | null;
  centroCusto: string | null;
  cliente: string | null;
  mesAtual: number;
  mesAnterior: number;
  totalHistorico: number;
  /** Distingue "custo zero" de "nenhuma linha carregada no mes". */
  temDadoNoMes: boolean;
};

export async function getCustoPorConta(tz: string): Promise<CustoPorConta[]> {
  const rows = await query<{
    account_id: string;
    account_name: string | null;
    business_unit: string | null;
    cost_center: string | null;
    client: string | null;
    active: boolean | null;
    cadastrada: boolean;
    mes_atual: string;
    mes_anterior: string;
    total_historico: string;
    linhas_no_mes: string;
  }>(
    `
    WITH ref AS (SELECT ${SQL_MES_REF} AS mes)
    SELECT
      m.account_id,
      a.account_name,
      a.business_unit,
      a.cost_center,
      a.client,
      a.active,
      (a.account_id IS NOT NULL) AS cadastrada,
      coalesce(sum(m.cost_amount) FILTER (WHERE m.month = r.mes), 0) AS mes_atual,
      coalesce(sum(m.cost_amount) FILTER (
        WHERE m.month = (r.mes - interval '1 month')::date), 0) AS mes_anterior,
      sum(m.cost_amount) AS total_historico,
      count(*) FILTER (WHERE m.month = r.mes) AS linhas_no_mes
    FROM aws_monthly_costs m
    CROSS JOIN ref r
    LEFT JOIN cloud_accounts a ON a.account_id = m.account_id
    GROUP BY m.account_id, a.account_id, a.account_name, a.business_unit,
             a.cost_center, a.client, a.active
    ORDER BY total_historico DESC
    `,
    [tz],
  );

  return rows.map((r) => ({
    accountId: r.account_id,
    nome: r.account_name ?? `Conta ${r.account_id}`,
    cadastrada: r.cadastrada,
    ativa: r.active ?? false,
    unidade: r.business_unit,
    centroCusto: r.cost_center,
    cliente: r.client,
    mesAtual: toNumber(r.mes_atual),
    mesAnterior: toNumber(r.mes_anterior),
    totalHistorico: toNumber(r.total_historico),
    temDadoNoMes: Number(r.linhas_no_mes) > 0,
  }));
}

// ---------------------------------------------------------------- series

export type PontoMensal = {
  mes: string;
  total: number;
  /** Periodo posterior ao mes de referencia -- cobranca lancada adiantado. */
  futuro: boolean;
};

export async function getSerieMensal(tz: string): Promise<PontoMensal[]> {
  const rows = await query<{ month: Date; total: string; futuro: boolean }>(
    `
    WITH ref AS (SELECT ${SQL_MES_REF} AS mes)
    SELECT m.month, sum(m.cost_amount) AS total, (m.month > r.mes) AS futuro
    FROM aws_monthly_costs m CROSS JOIN ref r
    GROUP BY m.month, r.mes
    ORDER BY m.month
    `,
    [tz],
  );

  return rows.map((r) => ({
    mes: formatarDataISO(r.month),
    total: toNumber(r.total),
    futuro: r.futuro,
  }));
}

export type PontoDiario = { data: string; total: number };

/** Janela de `dias` terminando HOJE (nunca em max(usage_date)). */
export async function getSerieDiaria(tz: string, dias = 30): Promise<PontoDiario[]> {
  const rows = await query<{ usage_date: Date; total: string }>(
    `
    WITH ref AS (SELECT (now() AT TIME ZONE $1)::date AS hoje)
    SELECT d.usage_date, sum(d.cost_amount) AS total
    FROM aws_daily_costs d CROSS JOIN ref r
    WHERE d.usage_date BETWEEN r.hoje - ($2::int - 1) AND r.hoje
    GROUP BY d.usage_date
    ORDER BY d.usage_date
    `,
    [tz, dias],
  );

  return rows.map((r) => ({ data: formatarDataISO(r.usage_date), total: toNumber(r.total) }));
}

// -------------------------------------------------------------- servicos

export type CustoServico = { servico: string; total: number };

export async function getTopServicos(tz: string, limite = 10): Promise<CustoServico[]> {
  const rows = await query<{ service: string; total: string }>(
    `
    WITH ref AS (SELECT ${SQL_MES_REF} AS mes)
    SELECT m.service, sum(m.cost_amount) AS total
    FROM aws_monthly_costs m CROSS JOIN ref r
    WHERE m.month = r.mes
    GROUP BY m.service
    HAVING round(sum(m.cost_amount), 2) > 0
    ORDER BY 2 DESC
    LIMIT $2
    `,
    [tz, limite],
  );

  return rows.map((r) => ({ servico: r.service, total: toNumber(r.total) }));
}

/** Fallback para quando o mes de referencia nao tem carga: usa todo o historico. */
export async function getTopServicosHistorico(limite = 10): Promise<CustoServico[]> {
  const rows = await query<{ service: string; total: string }>(
    `
    SELECT service, sum(cost_amount) AS total
    FROM aws_monthly_costs
    GROUP BY service
    HAVING round(sum(cost_amount), 2) > 0
    ORDER BY 2 DESC
    LIMIT $1
    `,
    [limite],
  );

  return rows.map((r) => ({ servico: r.service, total: toNumber(r.total) }));
}

// --------------------------------------------------------------- rollup

/** Dimensoes de governanca permitidas. Lista fixa: o nome vai para o SQL. */
export const DIMENSOES = {
  business_unit: "Unidade de negocio",
  cost_center: "Centro de custo",
  client: "Cliente",
  environment: "Ambiente",
  owner: "Responsavel",
} as const;

export type Dimensao = keyof typeof DIMENSOES;

export type LinhaRollup = {
  valor: string;
  contas: number;
  mesAtual: number;
  totalHistorico: number;
};

export async function getRollup(tz: string, dimensao: Dimensao): Promise<LinhaRollup[]> {
  // `dimensao` vem de DIMENSOES, nao do usuario. A validacao explicita abaixo
  // impede que qualquer refatoracao futura transforme isso em injecao de SQL.
  if (!Object.hasOwn(DIMENSOES, dimensao)) {
    throw new Error(`dimensao invalida: ${dimensao}`);
  }

  const rows = await query<{
    valor: string;
    contas: string;
    mes_atual: string;
    total_historico: string;
  }>(
    `
    WITH ref AS (SELECT ${SQL_MES_REF} AS mes)
    SELECT
      coalesce(nullif(trim(a.${dimensao}), ''), '(nao classificado)') AS valor,
      count(DISTINCT m.account_id) AS contas,
      coalesce(sum(m.cost_amount) FILTER (WHERE m.month = r.mes), 0) AS mes_atual,
      sum(m.cost_amount) AS total_historico
    FROM aws_monthly_costs m
    CROSS JOIN ref r
    LEFT JOIN cloud_accounts a ON a.account_id = m.account_id
    GROUP BY 1
    ORDER BY total_historico DESC
    `,
    [tz],
  );

  return rows.map((r) => ({
    valor: r.valor,
    contas: Number(r.contas),
    mesAtual: toNumber(r.mes_atual),
    totalHistorico: toNumber(r.total_historico),
  }));
}

// -------------------------------------------------------------- frescor

export type Frescor = {
  ultimaCargaMensal: Date | null;
  ultimaCargaDiaria: Date | null;
  /** Maior usage_date presente -- pode estar no futuro. */
  maiorDataUso: Date | null;
};

export async function getFrescor(): Promise<Frescor> {
  const row = await queryOne<{
    mensal: Date | null;
    diaria: Date | null;
    maior_data_uso: Date | null;
  }>(`
    SELECT
      (SELECT max(created_at) FROM aws_monthly_costs) AS mensal,
      (SELECT max(created_at) FROM aws_daily_costs)   AS diaria,
      (SELECT max(usage_date) FROM aws_daily_costs)   AS maior_data_uso
  `);

  return {
    ultimaCargaMensal: row.mensal,
    ultimaCargaDiaria: row.diaria,
    maiorDataUso: row.maior_data_uso,
  };
}

// ----------------------------------------------------------------- util

/**
 * `date` do Postgres chega como Date em horario local do processo. Formatar com
 * toISOString() deslocaria o dia em fuso negativo, entao montamos manualmente.
 */
function formatarDataISO(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}
