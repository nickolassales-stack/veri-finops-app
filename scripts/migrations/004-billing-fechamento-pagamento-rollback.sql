-- ============================================================================
-- FinOps :: ROLLBACK do faturamento (migracao 004)
-- ----------------------------------------------------------------------------
-- Remove as oito colunas acrescentadas e devolve `payment_status` ao vocabulario
-- da migracao 002.
--
-- O QUE ISTO DESTROI, e nao se regenera de lugar nenhum:
--
--   invoice_due_day, invoice_notification_days_before, billing_contact_email
--   payment_status_source, payment_reference, payment_due_date,
--   payment_paid_at, payment_notes
--
--   Tudo isso foi DIGITADO POR PESSOAS. Nao existe segunda fonte: a AWS nao
--   sabe o numero de protocolo que o financeiro anotou, e o CUR nao sabe se a
--   fatura foi paga. Apagar aqui e apagar de vez.
--
-- FACA BACKUP ANTES:
--
--   docker exec finops-postgres \
--     pg_dump -U finops_user -d finops -t app_account_settings \
--     > /opt/finops/backups/app_account_settings-$(date +%F-%H%M).sql
--
-- SOBRE A VOLTA DO VOCABULARIO
--
--   'paid'    -> 'em_dia'
--   'pending' -> 'pendente'
--   'overdue' -> 'atrasado'
--
--   'unknown' e 'manual_review' NAO TEM equivalente no vocabulario antigo e
--   viram NULL, com o valor original anotado em... lugar nenhum, porque
--   `payment_notes` tambem esta sendo removida. Se esses estados importarem,
--   exporte a tabela ANTES -- e a razao de o backup acima nao ser opcional.
--
-- O QUE ISTO **NAO** TOCA
--
--   alias, business_unit, cost_center, environment e invoice_close_day, que sao
--   da migracao 002 e continuam intactos. Nenhuma outra tabela e afetada.
--
-- DEPOIS DO ROLLBACK
--
--   A tela /dashboard/billing PARA de funcionar (ela consulta as colunas
--   removidas) enquanto o codigo desta entrega estiver publicado. Volte o
--   codigo junto -- `scripts/finops-app.sh rollback` -- ou remova o item de
--   menu antes.
--
-- COMO EXECUTAR
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/004-billing-fechamento-pagamento-rollback.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Solta as regras novas antes de mexer nos dados.
ALTER TABLE app_account_settings
  DROP CONSTRAINT IF EXISTS app_account_settings_payment_status_check,
  DROP CONSTRAINT IF EXISTS app_account_settings_payment_source_check,
  DROP CONSTRAINT IF EXISTS app_account_settings_invoice_due_day_check,
  DROP CONSTRAINT IF EXISTS app_account_settings_notification_days_check,
  DROP CONSTRAINT IF EXISTS app_account_settings_paid_needs_date_check;

-- 2. Vocabulario antigo. O que nao tem equivalente vira NULL -- "nao informado"
--    e menos errado do que escolher um estado que a pessoa nunca afirmou.
UPDATE app_account_settings
   SET payment_status = CASE payment_status
         WHEN 'paid'    THEN 'em_dia'
         WHEN 'pending' THEN 'pendente'
         WHEN 'overdue' THEN 'atrasado'
         ELSE NULL
       END
 WHERE payment_status IS NOT NULL;

-- 3. Colunas fora.
ALTER TABLE app_account_settings
  DROP COLUMN IF EXISTS invoice_due_day,
  DROP COLUMN IF EXISTS invoice_notification_days_before,
  DROP COLUMN IF EXISTS billing_contact_email,
  DROP COLUMN IF EXISTS payment_status_source,
  DROP COLUMN IF EXISTS payment_reference,
  DROP COLUMN IF EXISTS payment_due_date,
  DROP COLUMN IF EXISTS payment_paid_at,
  DROP COLUMN IF EXISTS payment_notes;

-- 4. CHECK original da migracao 002, de volta.
ALTER TABLE app_account_settings
  ADD CONSTRAINT app_account_settings_payment_status_check
    CHECK (payment_status IS NULL
           OR payment_status IN ('em_dia', 'pendente', 'atrasado', 'isento'));

COMMIT;

\echo ''
\echo '== colunas restantes =='
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'app_account_settings'
ORDER BY ordinal_position;

\echo ''
\echo '== conferencia: alias e demais metadados intactos =='
SELECT count(*) AS contas_configuradas,
       count(alias) AS com_alias,
       count(invoice_close_day) AS com_fechamento
FROM app_account_settings;
