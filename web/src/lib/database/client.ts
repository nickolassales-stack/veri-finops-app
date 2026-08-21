import "server-only";

import { Pool, type QueryResultRow } from "pg";
import { connection } from "next/server";

import { getEnv } from "@/lib/env";

import { registrarTiposPg } from "./tipos-pg";

/**
 * Ponto unico de acesso ao PostgreSQL do FinOps.
 *
 * Premissas de seguranca:
 * - A aplicacao fala SOMENTE com o PostgreSQL. Nunca com Athena/S3/AWS.
 * - Em producao a conexao usa a rede interna do docker compose (host
 *   `postgres`), portanto a porta 5432 continua sem exposicao publica.
 * - O que a aplicacao pode ou nao escrever e decidido pelos GRANTs do role
 *   `finops_app` no banco, nao pelo codigo. As tabelas do ETL
 *   (`aws_daily_costs`, `aws_monthly_costs`) sao SELECT-only para este role.
 * - `statement_timeout` protege o banco compartilhado com o Metabase.
 * - Nenhuma credencial e exportada: este modulo e `server-only` e o pool nunca
 *   cruza a fronteira para o cliente.
 */

registrarTiposPg();

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
 * Sempre use placeholders ($1, $2...). Nunca interpole valor em SQL --
 * `ConstrutorParams` existe justamente para montar filtros dinamicos sem
 * concatenar nada vindo do usuario.
 */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  await connection();
  return executar<T>(sql, params);
}

/**
 * Igual a `query`, mas SEM o `connection()`.
 *
 * Serve a um caso so: leitura feita enquanto o corpo da resposta JA esta sendo
 * transmitido (a exportacao em CSV le o banco em lotes conforme escreve). Nesse
 * momento a requisicao ja saiu do escopo do Next, e `connection()` lanca
 * "`connection` was called outside a request scope" -- o que derruba o download
 * pela metade, depois do status 200 ja ter sido enviado.
 *
 * Nao ha perda de protecao: o `connection()` existe para impedir que uma
 * consulta rode durante o prerender, e um corpo que ja comecou a ser transmitido
 * nunca esta em prerender. A rota que chega ate aqui ja executou consultas
 * dentro do escopo (para resolver periodo e conferir volume), entao a requisicao
 * ja foi marcada como dinamica.
 */
export async function queryForaDoEscopo<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  return executar<T>(sql, params);
}

async function executar<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<T[]> {
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
    const error = err instanceof Error ? err.message : String(err);
    // O log e o canal certo para este detalhe: `/api/health` responde sem sessao
    // e a mensagem do driver costuma trazer usuario e host do banco. Quem le
    // `docker logs` ja tem shell na maquina; quem chama a rota, nao.
    console.error("[db] healthcheck falhou:", error);
    return { ok: false, error };
  }
}
