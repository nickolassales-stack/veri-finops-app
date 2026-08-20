import "server-only";

import { query, queryOne } from "@/lib/database";
import { FONTES_OVH, type FonteOvh } from "@/lib/filtros/esquemas";

/**
 * Leitura das tabelas `ovh_*`.
 *
 * ---------------------------------------------------------------------------
 * TRES REGRAS QUE ESTE MODULO EXISTE PARA SUSTENTAR
 *
 * 1. `source` separa tres coisas que NAO se somam. `invoice` e o que a OVH
 *    faturou; `usage_current` e o consumo do mes em andamento; `usage_forecast`
 *    e projecao. O mesmo projeto no mesmo mes tem legitimamente linha nas tres,
 *    e um `sum(amount)` sem `GROUP BY source` triplica o custo. Nenhuma funcao
 *    aqui devolve total agregado sem a origem ao lado.
 *
 * 2. OVH nao entra em conta com AWS. A OVH e MENSAL e FATURADA; a AWS e DIARIA
 *    e por uso. Somar as duas produziria um numero que nao responde pergunta
 *    nenhuma -- nem "quanto consumi", nem "quanto vou pagar".
 *
 * 3. Moeda nao se converte aqui. A conta OVH fatura em USD hoje, mas `currency`
 *    existe por linha e a moeda de referencia e decisao de negocio. Os totais
 *    saem SEMPRE agrupados por moeda: se um dia houver EUR e USD na mesma
 *    conta, a tela mostra duas linhas em vez de uma soma errada.
 * ---------------------------------------------------------------------------
 *
 * `raw_json` nunca sai daqui. E a resposta crua da API da OVH, nao tem funcao
 * na interface, e expo-la vazaria detalhe de integracao para o navegador.
 */

/** `false` quando a migracao 005 ainda nao rodou. */
export async function ovhInstalado(): Promise<boolean> {
  const linha = await queryOne<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ovh_monthly_costs'
     ) AS existe`,
  );
  return linha?.existe ?? false;
}

function ehFonteConhecida(valor: string): valor is FonteOvh {
  return (FONTES_OVH as readonly string[]).includes(valor);
}

export type TotalPorOrigem = {
  source: FonteOvh;
  currency: string;
  total: number;
  linhas: number;
  /** Mes mais recente com valor nesta origem. `null` quando nao ha dado. */
  mesMaisRecente: string | null;
};

/**
 * Total por origem e moeda, sem cruzar as duas dimensoes.
 *
 * Alimenta os tres cards de Faturamento. Nao devolve entrada para origem sem
 * dado -- e o que permite a tela dizer "sem dado" em vez de "0,00", que seria
 * uma afirmacao sobre o custo.
 */
export async function getTotaisOvhPorOrigem(): Promise<TotalPorOrigem[]> {
  const linhas = await query<{
    source: string;
    currency: string;
    total: string;
    linhas: string;
    mes_mais_recente: Date | null;
  }>(
    `SELECT source,
            currency,
            sum(amount)        AS total,
            count(*)           AS linhas,
            max(billing_month) AS mes_mais_recente
       FROM ovh_monthly_costs
      GROUP BY source, currency
      ORDER BY source, currency`,
  );

  return linhas
    .filter((l) => ehFonteConhecida(l.source))
    .map((l) => ({
      source: l.source as FonteOvh,
      currency: l.currency,
      total: Number(l.total),
      linhas: Number(l.linhas),
      mesMaisRecente: l.mes_mais_recente
        ? l.mes_mais_recente.toISOString().slice(0, 10)
        : null,
    }));
}

export type LinhaMensalOvh = {
  billingMonth: string;
  providerAccountId: string;
  /** Alias do portal; `null` quando a conta nao esta em `cloud_accounts`. */
  alias: string | null;
  projectServiceName: string;
  source: FonteOvh;
  currency: string;
  amount: number;
};

/**
 * Tabela mensal de Faturamento.
 *
 * O LEFT JOIN em `cloud_accounts`/`app_account_settings` e proposital: a conta
 * OVH pode ainda nao estar cadastrada no portal, e nesse caso a linha aparece
 * com o id cru em vez de desaparecer. Custo que existe no banco e nao aparece
 * em tela nenhuma e pior do que custo sem nome.
 */
export async function getMensalOvh(limite = 200): Promise<LinhaMensalOvh[]> {
  const linhas = await query<{
    billing_month: Date;
    provider_account_id: string;
    alias: string | null;
    project_service_name: string;
    source: string;
    currency: string;
    amount: string;
  }>(
    `SELECT c.billing_month,
            c.provider_account_id,
            coalesce(s.alias, a.account_name) AS alias,
            c.project_service_name,
            c.source,
            c.currency,
            sum(c.amount) AS amount
       FROM ovh_monthly_costs c
       LEFT JOIN cloud_accounts       a ON a.account_id = c.provider_account_id
       LEFT JOIN app_account_settings s ON s.account_id = c.provider_account_id
      GROUP BY c.billing_month, c.provider_account_id,
               coalesce(s.alias, a.account_name),
               c.project_service_name, c.source, c.currency
      ORDER BY c.billing_month DESC, c.provider_account_id,
               c.project_service_name, c.source
      LIMIT $1`,
    [limite],
  );

  return linhas
    .filter((l) => ehFonteConhecida(l.source))
    .map((l) => ({
      billingMonth: l.billing_month.toISOString().slice(0, 10),
      providerAccountId: l.provider_account_id,
      alias: l.alias,
      projectServiceName: l.project_service_name,
      source: l.source as FonteOvh,
      currency: l.currency,
      amount: Number(l.amount),
    }));
}

export type ExecucaoOvh = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  source: string;
  accountsRows: number;
  projectsRows: number;
  costRows: number;
  invoiceRows: number;
  /**
   * `error_message` como o collector gravou. Ele SANITIZA na origem -- chaves
   * de API e o identificador de query da OVH sao substituidos antes de chegar
   * ao banco, nao aqui. Ver `sanitizar_erro()` em
   * scripts/ovh-collector/ovh_to_postgres.py.
   */
  errorMessage: string | null;
};

const SELECAO_EXECUCAO = `
  id, started_at, finished_at, status, source,
  accounts_rows, projects_rows, cost_rows, invoice_rows,
  -- Teto defensivo: a mensagem ja vem sanitizada, mas nada garante que seja
  -- curta, e um stack inteiro na tela nao ajuda ninguem.
  left(error_message, 500) AS error_message
`;

type LinhaExecucao = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  source: string;
  accounts_rows: number;
  projects_rows: number;
  cost_rows: number;
  invoice_rows: number;
  error_message: string | null;
};

function mapearExecucao(l: LinhaExecucao): ExecucaoOvh {
  return {
    id: Number(l.id),
    startedAt: l.started_at.toISOString(),
    finishedAt: l.finished_at?.toISOString() ?? null,
    status: l.status,
    source: l.source,
    accountsRows: l.accounts_rows,
    projectsRows: l.projects_rows,
    costRows: l.cost_rows,
    invoiceRows: l.invoice_rows,
    errorMessage: l.error_message,
  };
}

/** Ultimas execucoes do collector, mais recente primeiro. */
export async function getExecucoesOvh(limite = 5): Promise<ExecucaoOvh[]> {
  const linhas = await query<LinhaExecucao>(
    `SELECT ${SELECAO_EXECUCAO} FROM ovh_sync_runs ORDER BY id DESC LIMIT $1`,
    [limite],
  );
  return linhas.map(mapearExecucao);
}

/**
 * A ultima execucao que terminou em `success` -- nem sempre e a ultima.
 *
 * A distincao importa: uma coleta que falhou hoje nao invalida o dado que a de
 * ontem gravou, e a tela precisa poder dizer "o dado e de ontem" em vez de so
 * "falhou".
 */
export async function getUltimoSucessoOvh(): Promise<ExecucaoOvh | null> {
  const linhas = await query<LinhaExecucao>(
    `SELECT ${SELECAO_EXECUCAO}
       FROM ovh_sync_runs
      WHERE status = 'success'
      ORDER BY id DESC
      LIMIT 1`,
  );
  return linhas.length > 0 ? mapearExecucao(linhas[0]) : null;
}

export type ResumoFaturasOvh = {
  faturas: number;
  linhas: number;
  currency: string;
  total: number;
  primeiroMes: string | null;
  ultimoMes: string | null;
};

/** Cabecalhos de fatura agregados por moeda. */
export async function getResumoFaturasOvh(): Promise<ResumoFaturasOvh[]> {
  const linhas = await query<{
    faturas: string;
    linhas: string;
    currency: string;
    total: string;
    primeiro_mes: Date | null;
    ultimo_mes: Date | null;
  }>(
    `SELECT count(*)                   AS faturas,
            coalesce(sum(l.linhas), 0) AS linhas,
            h.currency,
            sum(h.total_with_tax)      AS total,
            min(h.billing_month)       AS primeiro_mes,
            max(h.billing_month)       AS ultimo_mes
       FROM ovh_invoice_headers h
       LEFT JOIN (SELECT bill_id, count(*) AS linhas
                    FROM ovh_invoice_lines
                   GROUP BY bill_id) l
              ON l.bill_id = h.bill_id
      GROUP BY h.currency
      ORDER BY h.currency`,
  );

  return linhas.map((l) => ({
    faturas: Number(l.faturas),
    linhas: Number(l.linhas),
    currency: l.currency,
    total: Number(l.total),
    primeiroMes: l.primeiro_mes ? l.primeiro_mes.toISOString().slice(0, 10) : null,
    ultimoMes: l.ultimo_mes ? l.ultimo_mes.toISOString().slice(0, 10) : null,
  }));
}
