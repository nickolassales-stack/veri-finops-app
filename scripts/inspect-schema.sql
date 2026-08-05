-- ============================================================================
-- FinOps :: Inspecao de schema do PostgreSQL -- SOMENTE LEITURA
-- ----------------------------------------------------------------------------
-- Este script NAO executa DDL nem DML. A sessao e forcada para read-only na
-- primeira instrucao, de modo que qualquer tentativa acidental de escrita
-- falharia no proprio servidor. Seguro para rodar em producao.
--
-- Objetivo: levantar o schema REAL antes de escrever qualquer query da
-- aplicacao. Nada aqui assume as tabelas descritas na documentacao.
--
-- Uso: ver scripts/inspect-schema.sh
-- ============================================================================

SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;

\pset pager off
\pset linestyle unicode
\timing off

\echo ''
\echo '################ 0. CONTEXTO ################'
SELECT
  version()                     AS pg_version,
  current_database()            AS banco,
  current_user                  AS usuario,
  current_setting('TimeZone')   AS timezone,
  now()                         AS coletado_em;

\echo ''
\echo '################ 1. EXTENSOES ################'
SELECT extname AS extensao, extversion AS versao
FROM pg_extension
ORDER BY 1;

\echo ''
\echo '################ 2. SCHEMAS ################'
SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner
FROM pg_namespace
WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
ORDER BY 1;

\echo ''
\echo '################ 3. RELACOES E TAMANHOS ################'
SELECT
  c.relnamespace::regnamespace::text AS schema,
  c.relname                          AS objeto,
  CASE c.relkind
    WHEN 'r' THEN 'tabela'
    WHEN 'p' THEN 'tabela_particionada'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'f' THEN 'foreign_table'
  END                                AS tipo,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho_total
FROM pg_class c
WHERE c.relkind IN ('r','p','v','m','f')
  AND c.relnamespace::regnamespace::text NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY 1, 3, 2;

\echo ''
\echo '################ 4. COLUNAS (tipos, nulidade, defaults) ################'
SELECT
  table_schema                AS schema,
  table_name                  AS tabela,
  ordinal_position            AS pos,
  column_name                 AS coluna,
  data_type                   AS tipo,
  character_maximum_length    AS tam_char,
  numeric_precision           AS num_precisao,
  numeric_scale               AS num_escala,
  is_nullable                 AS aceita_nulo,
  column_default              AS valor_default
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name, ordinal_position;

\echo ''
\echo '################ 5. CONSTRAINTS (PK / FK / UNIQUE / CHECK) ################'
SELECT
  n.nspname   AS schema,
  t.relname   AS tabela,
  con.conname AS nome,
  CASE con.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
    WHEN 'x' THEN 'EXCLUDE'
    ELSE con.contype::text
  END         AS tipo,
  pg_get_constraintdef(con.oid) AS definicao
FROM pg_constraint con
JOIN pg_class     t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2, 4, 3;

\echo ''
\echo '################ 6. INDICES ################'
SELECT schemaname AS schema, tablename AS tabela, indexname AS indice, indexdef AS definicao
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2, 3;

\echo ''
\echo '################ 7. DEFINICAO DAS VIEWS ################'
SELECT table_schema AS schema, table_name AS view, view_definition AS definicao
FROM information_schema.views
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2;

\echo ''
\echo '################ 8. CONTAGEM EXATA DE LINHAS ################'
-- query_to_xml executa um COUNT(*) real por tabela, sem precisar saber os nomes
-- de antemao. Continua sendo leitura pura.
SELECT
  t.table_schema AS schema,
  t.table_name   AS tabela,
  (xpath(
    '/row/cnt/text()',
    query_to_xml(
      format('SELECT count(*) AS cnt FROM %I.%I', t.table_schema, t.table_name),
      false, true, ''
    )
  ))[1]::text::bigint AS linhas
FROM information_schema.tables t
WHERE t.table_schema NOT IN ('pg_catalog','information_schema')
  AND t.table_type = 'BASE TABLE'
ORDER BY 3 DESC, 1, 2;

\echo ''
\echo '################ 9. SEQUENCES ################'
SELECT sequence_schema AS schema, sequence_name AS sequence, data_type AS tipo
FROM information_schema.sequences
ORDER BY 1, 2;

\echo ''
\echo '################ 10. TRIGGERS ################'
SELECT
  event_object_schema AS schema,
  event_object_table  AS tabela,
  trigger_name        AS trigger,
  action_timing       AS quando,
  event_manipulation  AS evento,
  action_statement    AS acao
FROM information_schema.triggers
WHERE event_object_schema NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2, 3;

\echo ''
\echo '################ 11. ROLES ################'
SELECT rolname AS role, rolsuper AS superuser, rolcreaterole AS cria_role,
       rolcreatedb AS cria_db, rolcanlogin AS pode_logar, rolconnlimit AS limite_conex
FROM pg_roles
WHERE rolname NOT LIKE 'pg\_%'
ORDER BY 1;

\echo ''
\echo '################ 12. GRANTS POR TABELA ################'
SELECT grantee AS role, table_schema AS schema, table_name AS tabela,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.role_table_grants
WHERE table_schema NOT IN ('pg_catalog','information_schema')
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo ''
\echo '################ 13. CONEXOES ATIVAS (impacto operacional) ################'
SELECT usename AS usuario, application_name AS aplicacao, client_addr AS origem,
       state AS estado, count(*) AS qtd
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2, 3, 4
ORDER BY 5 DESC;

\echo ''
\echo '################ FIM DA INSPECAO (nenhuma escrita executada) ################'
