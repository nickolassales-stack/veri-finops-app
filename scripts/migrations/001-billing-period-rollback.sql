-- ============================================================================
-- FinOps :: 001 -- ROLLBACK do periodo financeiro
-- ----------------------------------------------------------------------------
-- Desfaz scripts/migrations/001-billing-period.sql.
--
-- O QUE ELE APAGA: as 4 colunas adicionadas pela migracao e os 2 indices.
-- O QUE ELE NAO TOCA: usage_date, month, account_id, service, region,
-- cost_amount, currency, created_at -- ou seja, nenhum dado financeiro
-- original. Tudo que a migracao criou nasceu vazio e foi preenchido a partir do
-- CUR, que continua sendo a fonte da verdade e pode repovoar as colunas a
-- qualquer momento reexecutando a migracao + o backfill.
--
-- ----------------------------------------------------------------------------
-- ANTES DE RODAR
--
-- A aplicacao le `billing_month` com coalesce, entao ela volta sozinha ao
-- criterio antigo (mes da data de uso) assim que a coluna sumir -- MAS a versao
-- do portal precisa ser a que tem esse coalesce. Se voce estiver revertendo
-- para uma versao anterior do codigo, faca o rollback do container ANTES:
--
--   scripts/finops-app.sh rollback
--   docker exec -i finops-postgres psql -U finops_user -d finops -X \
--     --no-psqlrc -v ON_ERROR_STOP=1 < scripts/migrations/001-billing-period-rollback.sql
--
-- E o ETL: se ele ja estiver na versao que grava billing_period, reverta o
-- arquivo tambem, senao a proxima carga falha com "column does not exist".
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DROP INDEX IF EXISTS aws_daily_costs_billing_month_idx;
DROP INDEX IF EXISTS aws_monthly_costs_billing_month_idx;

ALTER TABLE aws_daily_costs
  DROP COLUMN IF EXISTS billing_period,
  DROP COLUMN IF EXISTS billing_month;

ALTER TABLE aws_monthly_costs
  DROP COLUMN IF EXISTS billing_period,
  DROP COLUMN IF EXISTS billing_month;

COMMIT;

\echo ''
\echo '== esperado: 0 linhas =='
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name IN ('billing_period', 'billing_month');

\echo ''
\echo '== dado financeiro intacto =='
SELECT 'aws_daily_costs' AS tabela, count(*) AS linhas, sum(cost_amount) AS total_usd
  FROM aws_daily_costs
UNION ALL
SELECT 'aws_monthly_costs', count(*), sum(cost_amount) FROM aws_monthly_costs;
