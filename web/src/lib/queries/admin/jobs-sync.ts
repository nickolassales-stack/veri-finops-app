import "server-only";

import { query, queryOne, queryOpcional } from "@/lib/database";

/**
 * Acesso a `cloud_sync_jobs` -- a fila entre o portal e o collector.
 *
 * ---------------------------------------------------------------------------
 * O PORTAL ENFILEIRA E LE. NAO PROCESSA.
 *
 * Nao ha aqui nenhuma funcao que marque `running` ou `success`: isso e do worker
 * que roda no host (`scripts/ovh-collector/processar_jobs.py`), onde o venv e as
 * dependencias existem. Os GRANTs da migracao 008 refletem a assimetria --
 * `finops_app` tem SELECT e INSERT, e nao UPDATE.
 *
 * A razao de existir a fila: o container do portal nao alcanca o filesystem do
 * host nem o venv do collector, e dar-lhe qualquer um dos dois significaria
 * montar diretorio do host num processo que atende requisicao HTTP publica.
 * Executar shell a partir de rota HTTP e exatamente o que isto evita.
 *
 * ---------------------------------------------------------------------------
 * NENHUM SEGREDO PASSA POR AQUI
 *
 * A fila trafega id de conta, acao e status. A credencial fica em
 * `cloud_provider_credentials`, e quem a decifra e o collector -- nunca este
 * modulo, nunca a tela.
 */

/** Espelha o CHECK da migracao 008. */
export const STATUS_JOB = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
] as const;
export type StatusJob = (typeof STATUS_JOB)[number];

export const ACOES_JOB = ["first_sync", "manual_sync"] as const;
export type AcaoJob = (typeof ACOES_JOB)[number];

const PROVIDER = "ovh";

/** Estados em que o job ainda vai acontecer -- os que o indice unico cobre. */
const VIVOS: StatusJob[] = ["queued", "running"];

export type JobSync = {
  id: string;
  accountId: string;
  action: AcaoJob;
  status: StatusJob;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Sempre sanitizado pelo worker antes de chegar ao banco. */
  errorMessage: string | null;
  /** `ovh_sync_runs.id` da execucao que este job produziu. */
  syncRunId: string | null;
  attempts: number;
};

type LinhaJob = {
  id: string;
  account_id: string;
  action: string;
  status: string;
  requested_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  error_message: string | null;
  sync_run_id: string | null;
  attempts: number;
};

const COLUNAS = `
  id::text            AS id,
  account_id,
  action,
  status,
  requested_at,
  started_at,
  finished_at,
  error_message,
  sync_run_id::text   AS sync_run_id,
  attempts
`;

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/**
 * `status` e `action` chegam como `text`. O CHECK do banco garante a lista, mas o
 * driver nao sabe disso: cair num valor conhecido e melhor do que propagar um que
 * a tela nao sabe desenhar.
 */
function normalizar<T extends string>(valor: string, validos: readonly T[], padrao: T): T {
  return (validos as readonly string[]).includes(valor) ? (valor as T) : padrao;
}

function mapear(l: LinhaJob): JobSync {
  return {
    id: l.id,
    accountId: l.account_id,
    action: normalizar(l.action, ACOES_JOB, "manual_sync"),
    status: normalizar(l.status, STATUS_JOB, "queued"),
    requestedAt: iso(l.requested_at)!,
    startedAt: iso(l.started_at),
    finishedAt: iso(l.finished_at),
    errorMessage: l.error_message,
    syncRunId: l.sync_run_id,
    attempts: l.attempts,
  };
}

// ---------------------------------------------------------- disponibilidade
let cacheFila: { valor: boolean; em: number } | null = null;
const TTL_CACHE_MS = 30_000;

/**
 * A migracao 008 rodou neste banco?
 *
 * Cache curto pelo mesmo motivo de `credenciaisDisponiveis`: a resposta muda uma
 * vez na vida do ambiente, e consultar o catalogo a cada request para saber isso
 * e desperdicio. Curto o suficiente para que, aplicada a migracao, a tela passe a
 * funcionar sem reiniciar o container -- o que importa num deploy em que a ordem
 * dos passos nao e garantida.
 */
export async function filaDisponivel(): Promise<boolean> {
  const agora = Date.now();
  if (cacheFila && agora - cacheFila.em < TTL_CACHE_MS) return cacheFila.valor;

  const linha = await queryOne<{ existe: boolean }>(
    `SELECT to_regclass('public.cloud_sync_jobs') IS NOT NULL AS existe`,
    [],
  );
  const valor = Boolean(linha?.existe);
  cacheFila = { valor, em: agora };
  return valor;
}

/** Usado pelos testes: o cache nao pode vazar entre casos. */
export function esquecerDisponibilidadeFila(): void {
  cacheFila = null;
}

// ------------------------------------------------------------------- leitura
export async function jobAtivoDaConta(accountId: string): Promise<JobSync | null> {
  const linha = await queryOpcional<LinhaJob>(
    `SELECT ${COLUNAS}
       FROM cloud_sync_jobs
      WHERE provider = $1 AND account_id = $2 AND status = ANY($3)
      ORDER BY requested_at DESC
      LIMIT 1`,
    [PROVIDER, accountId, VIVOS],
  );
  return linha ? mapear(linha) : null;
}

export async function ultimoJobDaConta(accountId: string): Promise<JobSync | null> {
  const linha = await queryOpcional<LinhaJob>(
    `SELECT ${COLUNAS}
       FROM cloud_sync_jobs
      WHERE provider = $1 AND account_id = $2
      ORDER BY requested_at DESC
      LIMIT 1`,
    [PROVIDER, accountId],
  );
  return linha ? mapear(linha) : null;
}

export async function jobsRecentes(limite = 20): Promise<JobSync[]> {
  const linhas = await query<LinhaJob>(
    `SELECT ${COLUNAS}
       FROM cloud_sync_jobs
      WHERE provider = $1
      ORDER BY requested_at DESC
      LIMIT $2`,
    [PROVIDER, limite],
  );
  return linhas.map(mapear);
}

// ---------------------------------------------------------------- escrita
/**
 * Enfileira uma coleta. Devolve o job criado, ou o que JA existia.
 *
 * `ON CONFLICT DO NOTHING` contra o indice unico parcial da migracao 008, que
 * garante no maximo um job vivo por conta. Quando o insert nao cria linha, a
 * funcao devolve o job existente em vez de erro: pedir coleta de algo que ja esta
 * na fila FOI ATENDIDO, e tratar como falha faria o segundo clique de um botao
 * que funcionou aparecer como erro na tela.
 *
 * A checagem nao pode ser feita com SELECT antes de INSERT -- duas requisicoes
 * simultaneas leem "nao existe" e as duas inserem. O banco e o unico lugar onde
 * ela e atomica.
 */
export async function enfileirarColeta(
  accountId: string,
  action: AcaoJob,
  requestedBy: string | null,
): Promise<{ job: JobSync; criado: boolean }> {
  const linha = await queryOpcional<LinhaJob>(
    `INSERT INTO cloud_sync_jobs (provider, account_id, action, status, requested_by)
     VALUES ($1, $2, $3, 'queued', $4)
         ON CONFLICT DO NOTHING
      RETURNING ${COLUNAS}`,
    [PROVIDER, accountId, action, requestedBy],
  );

  if (linha) return { job: mapear(linha), criado: true };

  const existente = await jobAtivoDaConta(accountId);
  if (existente) return { job: existente, criado: false };

  // Nao criou e nao existe job vivo. So acontece se a linha foi concluida entre
  // as duas consultas -- raro, e a resposta certa e tentar de novo uma vez.
  const segunda = await queryOpcional<LinhaJob>(
    `INSERT INTO cloud_sync_jobs (provider, account_id, action, status, requested_by)
     VALUES ($1, $2, $3, 'queued', $4)
         ON CONFLICT DO NOTHING
      RETURNING ${COLUNAS}`,
    [PROVIDER, accountId, action, requestedBy],
  );
  if (segunda) return { job: mapear(segunda), criado: true };

  const ultimo = await ultimoJobDaConta(accountId);
  if (ultimo) return { job: ultimo, criado: false };
  throw new Error("nao foi possivel enfileirar a coleta");
}
