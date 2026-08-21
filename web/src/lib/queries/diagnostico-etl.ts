import "server-only";

import { query } from "@/lib/database";
import {
  redigirErro,
  type ExecucaoEtl,
  type FrescorConta,
  type OrigemExecucao,
  type StatusExecucao,
} from "@/lib/diagnostico/etl";
import { toNumber } from "@/lib/format";

import {
  aliasDisponivel,
  expressaoNomeDaConta,
  joinAlias,
} from "./alias-conta";

/**
 * Leitura do estado do pipeline. Somente SELECT.
 *
 * O portal NAO escreve em `app_etl_runs` -- nem tem GRANT para isso (ver
 * migracao 003). Quem carrega registra; quem exibe le. Se a aplicacao pudesse
 * gravar aqui, "o ETL rodou" viraria uma afirmacao que ela mesma fabrica, e
 * esta tela deixaria de ser evidencia de coisa nenhuma.
 */

// ------------------------------------------------- disponibilidade dos objetos

const TEMPO_DE_REPESCAGEM_MS = 30_000;

let instalado: boolean | null = null;
let ultimaChecagem = 0;

/**
 * A migracao 003 rodou neste banco?
 *
 * Mesma politica de `aliasDisponivel`: o positivo e definitivo, o negativo e
 * reconferido a cada 30s -- aplicar a migracao com o portal no ar passa a valer
 * sozinho, sem reinicio.
 *
 * Aqui a degradacao TIRA a tela de diagnostico do ar (ela informa o que falta),
 * e nao mostra numero errado. E a distincao que o projeto ja aplica: degradar
 * removendo funcionalidade e aceitavel; degradar exibindo valor incorreto, nao.
 */
export async function diagnosticoInstalado(): Promise<boolean> {
  if (instalado === true) return true;

  const agora = Date.now();
  if (instalado === false && agora - ultimaChecagem < TEMPO_DE_REPESCAGEM_MS) {
    return false;
  }

  const linhas = await query<{ existe: boolean }>(
    `SELECT to_regclass('public.app_etl_runs')       IS NOT NULL
        AND to_regclass('public.app_data_freshness') IS NOT NULL AS existe`,
  );
  instalado = linhas[0]?.existe ?? false;
  ultimaChecagem = agora;
  return instalado;
}

/** Zera o cache. Existe para o teste; nao chame em codigo de producao. */
export function esquecerInstalacao(): void {
  instalado = null;
  ultimaChecagem = 0;
}

// ------------------------------------------------------------------ execucoes

type LinhaExecucao = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  source: string;
  monthly_rows: number | null;
  daily_rows: number | null;
  error_message: string | null;
  log_path: string | null;
};

const STATUS_CONHECIDOS: StatusExecucao[] = ["running", "success", "failed"];
const ORIGENS_CONHECIDAS: OrigemExecucao[] = ["manual", "cron", "unknown"];

function converter(linha: LinhaExecucao): ExecucaoEtl {
  return {
    id: String(linha.id),
    iniciadaEm: linha.started_at.toISOString(),
    finalizadaEm: linha.finished_at ? linha.finished_at.toISOString() : null,
    // O CHECK do banco ja garante o dominio; a conferencia aqui protege o tipo
    // de uma linha vinda de um banco onde a constraint tenha sido removida.
    status: STATUS_CONHECIDOS.includes(linha.status as StatusExecucao)
      ? (linha.status as StatusExecucao)
      : "failed",
    origem: ORIGENS_CONHECIDAS.includes(linha.source as OrigemExecucao)
      ? (linha.source as OrigemExecucao)
      : "unknown",
    linhasMensais: linha.monthly_rows === null ? null : Number(linha.monthly_rows),
    linhasDiarias: linha.daily_rows === null ? null : Number(linha.daily_rows),
    erro: redigirErro(linha.error_message),
    caminhoDoLog: linha.log_path,
  };
}

const CAMPOS_EXECUCAO = `
  id, started_at, finished_at, status, source,
  monthly_rows, daily_rows, error_message, log_path
`;

/** As N execucoes mais recentes, da mais nova para a mais antiga. */
export async function getExecucoes(limite: number): Promise<ExecucaoEtl[]> {
  const linhas = await query<LinhaExecucao>(
    `SELECT ${CAMPOS_EXECUCAO}
       FROM app_etl_runs
      ORDER BY started_at DESC, id DESC
      LIMIT $1`,
    [limite],
  );
  return linhas.map(converter);
}

export async function getUltimaExecucao(): Promise<ExecucaoEtl | null> {
  const [primeira] = await getExecucoes(1);
  return primeira ?? null;
}

/**
 * A ultima execucao BEM-SUCEDIDA -- que nao e necessariamente a ultima.
 *
 * Distincao que muda a leitura da tela: com uma falha as 08h de hoje e um
 * sucesso as 08h de ontem, o pipeline esta em erro E o dado exibido no portal
 * e o de ontem. Mostrar so a ultima execucao esconderia a segunda metade.
 */
export async function getUltimoSucesso(): Promise<ExecucaoEtl | null> {
  const linhas = await query<LinhaExecucao>(
    `SELECT ${CAMPOS_EXECUCAO}
       FROM app_etl_runs
      WHERE status = 'success'
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
  );
  return linhas[0] ? converter(linhas[0]) : null;
}

export type ResumoExecucoes = {
  total: number;
  sucessos: number;
  falhas: number;
  /** Duracao media dos sucessos, em segundos. `null` sem nenhum sucesso. */
  duracaoMediaSegundos: number | null;
};

export async function getResumoExecucoes(dias: number): Promise<ResumoExecucoes> {
  const [linha] = await query<{
    total: string;
    sucessos: string;
    falhas: string;
    duracao_media: string | null;
  }>(
    `SELECT count(*)                                        AS total,
            count(*) FILTER (WHERE status = 'success')      AS sucessos,
            count(*) FILTER (WHERE status = 'failed')       AS falhas,
            avg(extract(epoch FROM (finished_at - started_at)))
              FILTER (WHERE status = 'success')             AS duracao_media
       FROM app_etl_runs
      WHERE started_at >= now() - make_interval(days => $1)`,
    [dias],
  );

  return {
    total: Number(linha?.total ?? 0),
    sucessos: Number(linha?.sucessos ?? 0),
    falhas: Number(linha?.falhas ?? 0),
    duracaoMediaSegundos:
      linha?.duracao_media == null ? null : Math.round(toNumber(linha.duracao_media)),
  };
}

// -------------------------------------------------------------------- frescor

type LinhaFrescor = {
  account_id: string;
  nome_exibicao: string;
  ultima_usage_date: string | null;
  ultimo_billing_month: string | null;
  primeiro_billing_month: string | null;
  linhas_diarias: string;
  linhas_mensais: string;
  total_linhas: string;
  meses_disponiveis: string;
  linha_mais_nova_em: Date | null;
  meses_presentes: string[] | null;
};

/**
 * Frescor por conta, com o nome de exibicao ja resolvido.
 *
 * A view `app_data_freshness` nao conhece alias de proposito: o nome tem uma
 * cascata unica (alias -> account_name -> conta-<id>) que vive em
 * `alias-conta.ts` e vale para o portal inteiro. Duplica-la em SQL de view
 * criaria uma segunda definicao que diverge na primeira mudanca.
 *
 * `account_id` vem SEMPRE junto do nome. Numa tela de diagnostico, apelido sem
 * identificador obrigaria a abrir outra tela para saber de que conta se fala.
 */
export async function getFrescorPorConta(): Promise<FrescorConta[]> {
  const disponivel = await aliasDisponivel();

  const nome = expressaoNomeDaConta(disponivel, {
    colunaId: "f.account_id",
    cadastro: "a",
    cfg: "s",
  });

  const linhas = await query<LinhaFrescor>(`
    SELECT
      f.account_id,
      ${nome} AS nome_exibicao,
      to_char(f.ultima_usage_date,      'YYYY-MM-DD') AS ultima_usage_date,
      to_char(f.ultimo_billing_month,   'YYYY-MM-DD') AS ultimo_billing_month,
      to_char(f.primeiro_billing_month, 'YYYY-MM-DD') AS primeiro_billing_month,
      f.linhas_diarias,
      f.linhas_mensais,
      f.total_linhas,
      f.meses_disponiveis,
      f.linha_mais_nova_em,
      m.meses_presentes
    FROM app_data_freshness f
    LEFT JOIN cloud_accounts a ON a.account_id = f.account_id
    ${joinAlias(disponivel, { colunaId: "f.account_id", cfg: "s" })}
    LEFT JOIN (
      -- Meses efetivamente presentes no mensal, por conta. Sai daqui a deteccao
      -- de buraco no meio da serie: comparar esta lista com o intervalo entre o
      -- primeiro e o ultimo mes e o que revela particao nao adicionada.
      SELECT account_id,
             array_agg(DISTINCT to_char(coalesce(billing_month, month), 'YYYY-MM')
                       ORDER BY to_char(coalesce(billing_month, month), 'YYYY-MM')) AS meses_presentes
        FROM aws_monthly_costs
       GROUP BY account_id
    ) m ON m.account_id = f.account_id
    ORDER BY 2
  `);

  return linhas.map((l) => ({
    accountId: l.account_id,
    nomeExibicao: l.nome_exibicao,
    ultimaUsageDate: l.ultima_usage_date,
    ultimoBillingMonth: l.ultimo_billing_month,
    primeiroBillingMonth: l.primeiro_billing_month,
    linhasDiarias: Number(l.linhas_diarias),
    linhasMensais: Number(l.linhas_mensais),
    totalLinhas: Number(l.total_linhas),
    mesesDisponiveis: Number(l.meses_disponiveis),
    linhaMaisNovaEm: l.linha_mais_nova_em ? l.linha_mais_nova_em.toISOString() : null,
    mesesPresentes: l.meses_presentes ?? [],
  }));
}

export type CoberturaDoDado = {
  contas: number;
  totalLinhas: number;
  mesesDisponiveis: string[];
  primeiraUsageDate: string | null;
  ultimaUsageDate: string | null;
  /** Quando entrou a linha mais nova, em qualquer conta. */
  linhaMaisNovaEm: string | null;
};

/** Cobertura consolidada -- o "quanto de dado existe" de uma olhada so. */
export async function getCobertura(): Promise<CoberturaDoDado> {
  const [linha] = await query<{
    contas: string;
    total_linhas: string;
    primeira: string | null;
    ultima: string | null;
    linha_mais_nova_em: Date | null;
  }>(`
    SELECT count(*)                                    AS contas,
           coalesce(sum(total_linhas), 0)              AS total_linhas,
           to_char(min(primeira_usage_date), 'YYYY-MM-DD') AS primeira,
           to_char(max(ultima_usage_date),   'YYYY-MM-DD') AS ultima,
           max(linha_mais_nova_em)                     AS linha_mais_nova_em
      FROM app_data_freshness
  `);

  const meses = await query<{ mes: string }>(`
    SELECT DISTINCT to_char(coalesce(billing_month, month), 'YYYY-MM') AS mes
      FROM aws_monthly_costs
     ORDER BY 1
  `);

  return {
    contas: Number(linha?.contas ?? 0),
    totalLinhas: Number(linha?.total_linhas ?? 0),
    mesesDisponiveis: meses.map((m) => m.mes),
    primeiraUsageDate: linha?.primeira ?? null,
    ultimaUsageDate: linha?.ultima ?? null,
    linhaMaisNovaEm: linha?.linha_mais_nova_em
      ? linha.linha_mais_nova_em.toISOString()
      : null,
  };
}
