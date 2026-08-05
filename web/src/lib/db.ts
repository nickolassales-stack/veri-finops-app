import "server-only";

import { Pool, type QueryResultRow } from "pg";
import { connection } from "next/server";

import { getEnv } from "./env";

/**
 * Acesso ao PostgreSQL do FinOps.
 *
 * Premissas de seguranca:
 * - A aplicacao fala SOMENTE com o PostgreSQL. Nunca com Athena/S3/AWS.
 * - A conexao usa a rede interna do docker compose (host `postgres`), portanto
 *   a porta 5432 continua sem exposicao publica.
 * - O que a aplicacao pode ou nao escrever e decidido pelos GRANTs do role no
 *   banco, nao pelo codigo. Ver docs/RUNBOOK-app.md.
 * - `statement_timeout` protege o banco compartilhado com o Metabase.
 */

// Reaproveita o pool entre recompilacoes do dev server (HMR) e entre
// requisicoes em producao. Sem isso, cada reload abriria um pool novo.
const globalForDb = globalThis as unknown as { finopsPool?: Pool };

export function getPool(): Pool {
  if (globalForDb.finopsPool) return globalForDb.finopsPool;

  const env = getEnv();

  const pool = new Pool({
    host: env.PG_HOST,
    port: env.PG_PORT,
    database: env.PG_DB,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: env.PG_STATEMENT_TIMEOUT_MS,
    application_name: "finops-portal",
    // Rede interna do compose; TLS aqui exigiria certificado no container do
    // Postgres e nao adiciona protecao real dentro da bridge.
    ssl: false,
  });

  // Erro em conexao idle nao deve derrubar o processo.
  pool.on("error", (err) => {
    console.error("[db] erro em conexao idle do pool:", err);
  });

  globalForDb.finopsPool = pool;
  return pool;
}

/**
 * Executa uma query parametrizada e devolve as linhas.
 *
 * `await connection()` garante que nada disso rode durante o build/prerender:
 * sem ele, o Next poderia tentar executar a query na hora do `next build`
 * (quando o banco nao existe) e congelar o resultado na pagina estatica.
 *
 * Sempre use placeholders ($1, $2...). Nunca interpole valor em SQL.
 */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  await connection();
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

/** Igual a `query`, mas exige exatamente uma linha. */
export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T> {
  const rows = await query<T>(sql, params);
  if (rows.length !== 1) {
    throw new Error(`Esperava 1 linha, recebi ${rows.length}.`);
  }
  return rows[0];
}

export type DbHealth =
  | { ok: true; latencyMs: number; serverVersion: string; database: string }
  | { ok: false; error: string };

/** Checagem de conectividade usada pelo /api/health e pelo HEALTHCHECK do container. */
export async function checkDbHealth(): Promise<DbHealth> {
  const inicio = Date.now();
  try {
    const row = await queryOne<{ versao: string; banco: string }>(
      "SELECT version() AS versao, current_database() AS banco",
    );
    return {
      ok: true,
      latencyMs: Date.now() - inicio,
      serverVersion: row.versao.split(" ").slice(0, 2).join(" "),
      database: row.banco,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
