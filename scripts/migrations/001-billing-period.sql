-- ============================================================================
-- FinOps :: 001 -- periodo financeiro separado da data de uso
-- ----------------------------------------------------------------------------
-- ADITIVO, REVERSIVEL E NAO DESTRUTIVO. Este script:
--   - adiciona 4 colunas NULLAVEIS (2 em aws_daily_costs, 2 em aws_monthly_costs);
--   - cria 2 indices para o filtro por periodo de cobranca.
--
-- Ele NAO altera nenhum valor existente, NAO mexe em cost_amount, NAO remove
-- coluna, NAO troca indice unico e NAO toca em `month` das linhas ja gravadas.
-- Rollback em scripts/migrations/001-billing-period-rollback.sql.
--
-- ----------------------------------------------------------------------------
-- POR QUE
--
-- O CUR da AWS tem DUAS datas, e elas nao sao a mesma coisa:
--
--   line_item_usage_start_date     -> quando o recurso foi USADO
--   bill_billing_period_start_date -> em que fatura a AWS COBROU
--   billing_period (particao)      -> o mesmo, no formato 'AAAA-MM'
--
-- Na maioria das linhas as duas caem no mesmo mes. Em cobrancas pontuais --
-- registro de dominio, taxa anual, reserva -- nao caem. Medido em 13/08/2026
-- na base real: 3 linhas do CUR divergem, todas AmazonRegistrar, US$ 37,32.
--
--   billing_period 2026-07  |  usage_date 2026-09-04  |  US$ 37,32
--
-- O ETL so gravava a data de uso, entao o portal somava julho como US$ 311,41
-- enquanto o Cost Explorer mostrava US$ 348,73. A diferenca era exatamente
-- essa linha, empurrada para setembro.
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/001-billing-period.sql
--
-- Idempotente: pode ser reexecutado.
--
-- DEPOIS DELE, rode o backfill -- as colunas nascem NULL e so o CUR sabe o
-- valor certo:
--   scripts/backfill-billing-period.py   (ver cabecalho do arquivo)
--
-- Enquanto o backfill nao roda, o portal se comporta EXATAMENTE como antes:
-- as consultas usam coalesce(billing_month, date_trunc('month', usage_date)),
-- entao coluna nula = criterio antigo. Nao ha janela de quebra.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- aws_daily_costs
-- ----------------------------------------------------------------------------
-- `billing_period` e o texto 'AAAA-MM' da particao do CUR -- guardado como veio,
-- para reconciliar com a AWS sem reconstruir a string.
-- `billing_month` e o primeiro dia do mes de cobranca, para comparar com data.
ALTER TABLE aws_daily_costs
  ADD COLUMN IF NOT EXISTS billing_period TEXT NULL,
  ADD COLUMN IF NOT EXISTS billing_month  DATE NULL;

COMMENT ON COLUMN aws_daily_costs.usage_date IS
  'Data de USO (line_item_usage_start_date). Visao operacional. Nao serve para reconciliar com o Cost Explorer.';
COMMENT ON COLUMN aws_daily_costs.billing_period IS
  'Periodo de cobranca AAAA-MM (particao billing_period do CUR). Visao financeira.';
COMMENT ON COLUMN aws_daily_costs.billing_month IS
  'Primeiro dia do mes de cobranca (bill_billing_period_start_date). NULL = ainda nao carregado; as consultas caem em date_trunc(month, usage_date).';

-- ----------------------------------------------------------------------------
-- aws_monthly_costs
-- ----------------------------------------------------------------------------
-- `month` PERMANECE, e permanece com o valor que ja tem: e a chave do indice
-- unico que o ON CONFLICT do ETL usa hoje. Reescrever essa coluna quebraria a
-- carga em andamento. Linhas NOVAS passam a nascer com month = billing_month.
ALTER TABLE aws_monthly_costs
  ADD COLUMN IF NOT EXISTS billing_period TEXT NULL,
  ADD COLUMN IF NOT EXISTS billing_month  DATE NULL;

COMMENT ON COLUMN aws_monthly_costs.month IS
  'Mantida por compatibilidade (chave do indice unico). Em linhas novas recebe o mesmo valor de billing_month.';
COMMENT ON COLUMN aws_monthly_costs.billing_period IS
  'Periodo de cobranca AAAA-MM (particao billing_period do CUR).';
COMMENT ON COLUMN aws_monthly_costs.billing_month IS
  'Primeiro dia do mes de cobranca (bill_billing_period_start_date).';

-- ----------------------------------------------------------------------------
-- Indices do filtro financeiro
-- ----------------------------------------------------------------------------
-- A expressao e a MESMA que as consultas usam. Sem indice por expressao o
-- planejador nao aproveitaria o indice para o coalesce.
--
-- O `::timestamp` NAO e enfeite. Sem ele, `date_trunc('month', usage_date)`
-- resolve para a sobrecarga que recebe `timestamptz`, que e apenas STABLE (o
-- resultado depende do fuso da sessao) -- e o Postgres recusa a criacao do
-- indice com "functions in index expression must be marked IMMUTABLE".
-- Fixar em `timestamp` tira o fuso da conta e torna a expressao deterministica.
CREATE INDEX IF NOT EXISTS aws_daily_costs_billing_month_idx
  ON aws_daily_costs ((coalesce(billing_month, date_trunc('month', usage_date::timestamp)::date)));

CREATE INDEX IF NOT EXISTS aws_monthly_costs_billing_month_idx
  ON aws_monthly_costs ((coalesce(billing_month, month)));

COMMIT;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== colunas novas (esperado: 4 linhas, todas is_nullable = YES) =='
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name IN ('billing_period', 'billing_month')
 ORDER BY table_name, column_name;

\echo ''
\echo '== nenhum valor existente foi tocado: as colunas novas nascem NULL =='
SELECT 'aws_daily_costs'   AS tabela,
       count(*)            AS linhas,
       count(billing_month) AS com_billing_month
  FROM aws_daily_costs
UNION ALL
SELECT 'aws_monthly_costs', count(*), count(billing_month)
  FROM aws_monthly_costs;

\echo ''
\echo '== proximo passo: scripts/backfill-billing-period.py =='
