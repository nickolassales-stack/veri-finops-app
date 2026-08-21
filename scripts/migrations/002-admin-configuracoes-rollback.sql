-- ============================================================================
-- ROLLBACK da migracao 002 -- area administrativa
-- ----------------------------------------------------------------------------
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/002-admin-configuracoes-rollback.sql
--
-- ----------------------------------------------------------------------------
-- LEIA ANTES DE RODAR
--
-- Esta migracao, ao contrario da 001, guarda dado que NAO existe em outro
-- lugar: os aliases de conta, os grupos, quem esta em cada grupo e o que cada
-- grupo pode. Nada disso e regeravel a partir do CUR ou do ETL -- foi digitado
-- por alguem. Derrubar as tabelas APAGA esse conteudo em definitivo.
--
-- Faca backup antes:
--
--   docker exec finops-postgres pg_dump -U finops_user -d finops \
--     -t app_account_settings -t app_groups \
--     -t app_user_groups -t app_group_permissions \
--     > backup-admin-$(date +%F-%H%M).sql
--
-- ----------------------------------------------------------------------------
-- ORDEM EM RELACAO AO CODIGO
--
-- Derrube o codigo ANTES do banco. Com as tabelas removidas e o codigo novo no
-- ar, as telas de configuracao respondem erro. O resto do portal continua de pe:
-- o alias usa LEFT JOIN e o nome cai de volta em `cloud_accounts.account_name`.
--
-- O que NAO e desfeito aqui:
--   - app_users e app_sessions, que sao da migracao de autenticacao;
--   - cloud_accounts, que nunca foi alterada por esta migracao.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Ordem inversa da criacao. As FKs sao ON DELETE CASCADE, mas DROP explicito
-- na ordem certa deixa o efeito visivel em vez de implicito.
DROP TABLE IF EXISTS app_group_permissions;
DROP TABLE IF EXISTS app_user_groups;
DROP TABLE IF EXISTS app_groups;
DROP TABLE IF EXISTS app_account_settings;

COMMIT;

\echo ''
\echo '== restaram (esperado: 0 linhas) =='
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('app_account_settings', 'app_groups',
                     'app_user_groups', 'app_group_permissions');

\echo ''
\echo '== conferencia: autenticacao e cadastro de contas intactos =='
SELECT 'app_users'      AS tabela, count(*) AS linhas FROM app_users
UNION ALL SELECT 'cloud_accounts', count(*) FROM cloud_accounts;
