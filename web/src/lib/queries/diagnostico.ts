import "server-only";

import { query } from "@/lib/database";

/**
 * Consultas de diagnostico -- deliberadamente agnosticas ao schema.
 *
 * Elas leem apenas o catalogo do PostgreSQL, sem citar nenhuma tabela de
 * negocio. Servem para validar a integracao real antes de o schema ter sido
 * inspecionado, e continuam uteis depois como pagina de suporte.
 */

export type TabelaDescoberta = {
  schema: string;
  tabela: string;
  tipo: string;
  colunas: number;
  linhasEstimadas: number;
  tamanho: string;
};

export async function listarTabelas(): Promise<TabelaDescoberta[]> {
  const rows = await query<{
    schema: string;
    tabela: string;
    tipo: string;
    colunas: string;
    linhas_estimadas: string;
    tamanho: string;
  }>(`
    SELECT
      c.relnamespace::regnamespace::text AS schema,
      c.relname                          AS tabela,
      CASE c.relkind
        WHEN 'r' THEN 'tabela'
        WHEN 'p' THEN 'tabela particionada'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
      END                                AS tipo,
      (SELECT count(*) FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
      GREATEST(c.reltuples, 0)::bigint   AS linhas_estimadas,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho
    FROM pg_class c
    WHERE c.relkind IN ('r', 'p', 'v', 'm')
      AND c.relnamespace::regnamespace::text NOT IN
          ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY 1, 2
  `);

  return rows.map((r) => ({
    schema: r.schema,
    tabela: r.tabela,
    tipo: r.tipo,
    colunas: Number(r.colunas),
    linhasEstimadas: Number(r.linhas_estimadas),
    tamanho: r.tamanho,
  }));
}

export type PrivilegioApp = {
  tabela: string;
  privilegios: string;
};

/** O que o usuario da aplicacao realmente pode fazer, segundo o proprio banco. */
export async function listarPrivilegiosDoApp(): Promise<PrivilegioApp[]> {
  return query<PrivilegioApp>(`
    SELECT
      table_schema || '.' || table_name AS tabela,
      string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
    FROM information_schema.role_table_grants
    WHERE grantee = current_user
      AND table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY 1
    ORDER BY 1
  `);
}
