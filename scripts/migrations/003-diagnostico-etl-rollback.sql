-- ============================================================================
-- FinOps :: ROLLBACK do monitoramento do ETL (migracao 003)
-- ----------------------------------------------------------------------------
-- Remove a view `app_data_freshness` e a tabela `app_etl_runs`.
--
-- O QUE ISTO DESTROI
--
--   `app_data_freshness` -- NADA. E uma view: os numeros continuam nas tabelas
--   de custo e recria-la devolve exatamente o mesmo resultado.
--
--   `app_etl_runs`       -- O HISTORICO DE EXECUCOES, que NAO se regenera.
--                           Nenhuma outra fonte guarda a duracao, a contagem de
--                           linhas e a mensagem de erro de cada carga passada.
--                           O log em /opt/finops/etl.log tem parte disso em
--                           texto corrido, e nada disso em forma consultavel.
--
-- FACA BACKUP ANTES:
--
--   docker exec finops-postgres \
--     pg_dump -U finops_user -d finops -t app_etl_runs \
--     > /opt/finops/backups/app_etl_runs-$(date +%F-%H%M).sql
--
-- O QUE ISTO **NAO** TOCA
--
--   cloud_accounts, aws_daily_costs, aws_monthly_costs, cloud_budgets,
--   cost_alerts, app_users, app_sessions e todas as tabelas da migracao 002.
--   Nenhum dado de custo e afetado -- o rollback devolve o banco ao estado
--   anterior a 003 e nada alem disso.
--
-- DEPOIS DO ROLLBACK
--
--   A tela /dashboard/diagnostico continua abrindo: ela degrada para
--   "monitoramento nao instalado" e segue mostrando o frescor por conta, que
--   e calculado direto das tabelas de custo. O ETL tambem continua carregando
--   normalmente -- ele apenas registra um aviso no log a cada execucao.
--
--   Para tirar o ETL da instrumentacao tambem, restaure o backup do script:
--     cp /opt/finops/etl/athena_to_postgres.py.bak-<data> \
--        /opt/finops/etl/athena_to_postgres.py
--   e, se o cron tiver sido alterado, restaure o crontab:
--     crontab /opt/finops/backups/crontab-<data>.bak
--
-- COMO EXECUTAR
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/003-diagnostico-etl-rollback.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DROP VIEW  IF EXISTS app_data_freshness;

-- Sem CASCADE de proposito: se algum objeto passar a depender desta tabela, o
-- rollback deve PARAR e obrigar a uma decisao, em vez de arrastar junto o que
-- ninguem examinou.
DROP TABLE IF EXISTS app_etl_runs;

COMMIT;

\echo ''
\echo '== conferencia: os objetos da 003 nao existem mais =='
SELECT to_regclass('public.app_etl_runs')       AS app_etl_runs,
       to_regclass('public.app_data_freshness') AS app_data_freshness;

\echo ''
\echo '== conferencia: nada de custo foi tocado =='
SELECT 'aws_daily_costs'   AS tabela, count(*) AS linhas FROM aws_daily_costs
UNION ALL SELECT 'aws_monthly_costs', count(*) FROM aws_monthly_costs
UNION ALL SELECT 'cloud_accounts',    count(*) FROM cloud_accounts;
