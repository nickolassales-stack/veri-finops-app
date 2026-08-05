-- ============================================================================
-- FinOps :: role de aplicacao `finops_app`
-- ----------------------------------------------------------------------------
-- ADITIVO E NAO DESTRUTIVO. Este script:
--   - cria (ou atualiza a senha de) um role de login dedicado a aplicacao;
--   - concede SELECT nas 5 tabelas existentes;
--   - concede INSERT/UPDATE/DELETE APENAS nas tabelas de governanca;
--   - REVOGA explicitamente escrita nas tabelas alimentadas pelo ETL.
--
-- Ele NAO cria, altera ou remove tabela, coluna, dado, view ou constraint.
-- Nao mexe em `finops_user` nem em `metabase_user`.
--
-- Por que um role novo: `finops_user` e SUPERUSUARIO. Dar ao portal a mesma
-- credencial do ETL significaria permitir que a aplicacao apague dado de custo.
-- Aqui o limite entre leitura e escrita e imposto pelo BANCO, nao pelo codigo.
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   # 1. gere uma senha forte e guarde-a no .env do compose
--   openssl rand -base64 24
--
--   # 2. rode o script passando a senha por variavel de ambiente
--   #    (a senha nunca aparece neste arquivo nem no historico do git)
--   export APP_PG_PASSWORD='<a-senha-gerada>'
--   docker exec -i -e APP_PG_PASSWORD="$APP_PG_PASSWORD" finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/create-app-role.sql
--
--   # 3. limpe a variavel da sessao
--   unset APP_PG_PASSWORD
--
-- Idempotente: pode ser reexecutado (util para rotacao de senha).
-- ============================================================================

\set ON_ERROR_STOP on

-- A senha vem do ambiente. Nunca de literal neste arquivo.
-- O \set antes do \getenv garante que a variavel exista mesmo quando a variavel
-- de ambiente nao foi definida (sem isso, :'app_password' seria interpolado
-- literalmente e viraria erro de sintaxe em vez de mensagem clara).
\set app_password ''
\getenv app_password APP_PG_PASSWORD

SELECT coalesce(:'app_password', '') <> '' AS tem_senha \gset
\if :tem_senha
\else
\warn 'ERRO: defina APP_PG_PASSWORD antes de executar (ver cabecalho do script).'
\quit
\endif

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') AS role_existe \gset

\if :role_existe
\echo '-> role finops_app ja existe: atualizando senha e reaplicando privilegios'
ALTER ROLE finops_app WITH LOGIN PASSWORD :'app_password';
\else
\echo '-> criando role finops_app'
CREATE ROLE finops_app WITH LOGIN PASSWORD :'app_password';
\endif

-- Sem nenhum atributo administrativo, em qualquer dos dois caminhos acima.
ALTER ROLE finops_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 10;

-- Acesso ao banco e ao schema.
GRANT CONNECT ON DATABASE finops TO finops_app;
GRANT USAGE   ON SCHEMA   public TO finops_app;

-- ----------------------------------------------------------------------------
-- Leitura: todas as tabelas.
-- ----------------------------------------------------------------------------
GRANT SELECT ON
    aws_daily_costs,
    aws_monthly_costs,
    cloud_accounts,
    cloud_budgets,
    cost_alerts
  TO finops_app;

-- ----------------------------------------------------------------------------
-- Escrita: SOMENTE governanca. Dado de custo e imutavel pela aplicacao.
-- ----------------------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON
    cloud_accounts,
    cloud_budgets,
    cost_alerts
  TO finops_app;

-- cloud_accounts tem PK natural (account_id), sem sequence.
GRANT USAGE, SELECT ON SEQUENCE
    cloud_budgets_id_seq,
    cost_alerts_id_seq
  TO finops_app;

-- ----------------------------------------------------------------------------
-- Barreira explicita: nada de escrita nas tabelas do ETL, nem por acidente
-- de um GRANT futuro amplo.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
    aws_daily_costs,
    aws_monthly_costs
  FROM finops_app;

-- ----------------------------------------------------------------------------
-- Tabela nova criada pelo ETL no futuro ja nasce legivel pelo portal
-- (somente SELECT -- escrita continua exigindo GRANT deliberado).
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE finops_user IN SCHEMA public
  GRANT SELECT ON TABLES TO finops_app;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== atributos do role =='
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolconnlimit
FROM pg_roles WHERE rolname = 'finops_app';

\echo ''
\echo '== privilegios efetivos (esperado: SELECT em 5, escrita em 3) =='
SELECT table_name AS tabela,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app' AND table_schema = 'public'
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== conferencia: escrita nas tabelas do ETL deve vir vazio =='
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app'
  AND table_name IN ('aws_daily_costs', 'aws_monthly_costs')
  AND privilege_type <> 'SELECT';
