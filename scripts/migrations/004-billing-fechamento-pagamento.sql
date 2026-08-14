-- ============================================================================
-- FinOps :: fechamento de fatura e situacao de pagamento
-- ----------------------------------------------------------------------------
-- ADITIVA. Acrescenta oito colunas a `app_account_settings` e TROCA o dominio de
-- `payment_status`. Nao cria nem remove tabela, nao toca em nenhuma outra
-- tabela, nao altera dado de custo.
--
-- Rollback: scripts/migrations/004-billing-fechamento-pagamento-rollback.sql
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/004-billing-fechamento-pagamento.sql
--
-- Idempotente: reexecutar nao duplica coluna nem reescreve valor ja convertido.
--
-- ----------------------------------------------------------------------------
-- A TROCA DE DOMINIO DE `payment_status`
--
-- A migracao 002 criou o campo com vocabulario de acompanhamento interno
-- ('em_dia', 'pendente', 'atrasado', 'isento'). Ele nasceu antes de existir
-- tela de faturamento e antes da decisao de preparar integracao com a AWS.
--
-- O vocabulario novo e outro, e a diferenca nao e cosmetica:
--
--   unknown        NAO SABEMOS -- e o padrao honesto, e o que toda conta e
--                  ate alguem afirmar o contrario. 'em_dia' presumia.
--   pending        fatura fechada, pagamento ainda nao confirmado
--   paid           alguem CONFIRMOU o pagamento (com referencia e data)
--   overdue        passou do vencimento sem confirmacao
--   manual_review  precisa de olho humano: divergencia, contestacao, isencao
--
-- 'isento' desaparece porque nao e situacao de pagamento, e sim acordo
-- comercial; quem tiver esse caso cai em `manual_review` com a explicacao em
-- `payment_notes` -- e o valor original vai para la, para nada se perder.
--
-- Verificado em producao em 14/08/2026: a tabela esta VAZIA, entao a conversao
-- abaixo nao encontra linha nenhuma. Ela existe mesmo assim porque este script
-- tambem roda em copias do banco, e uma migracao que so funciona na tabela
-- vazia e uma armadilha esperando a proxima restauracao de backup.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Fechamento e vencimento da fatura
-- ----------------------------------------------------------------------------
ALTER TABLE app_account_settings
  -- Dia do vencimento. SEPARADO do fechamento porque sao coisas diferentes: a
  -- fatura fecha quando a AWS para de acumular, e vence quando o dinheiro
  -- precisa sair. Entre um e outro ha dias, e e neles que mora o aviso util.
  ADD COLUMN IF NOT EXISTS invoice_due_day                 smallint,

  -- Antecedencia do aviso de fechamento, em dias. DEFAULT 5 conforme pedido.
  -- 0 e valido e significa "avise so no dia".
  ADD COLUMN IF NOT EXISTS invoice_notification_days_before smallint NOT NULL DEFAULT 5,

  -- Contato de cobranca da conta. GUARDADO, NAO USADO: nao ha provedor de
  -- e-mail configurado no portal, e inventar um envio seria pior do que nao
  -- ter. Existe para que o dia em que houver envio nao comece pedindo que
  -- alguem redigite tudo.
  ADD COLUMN IF NOT EXISTS billing_contact_email            text;

-- ----------------------------------------------------------------------------
-- 2. Pagamento
-- ----------------------------------------------------------------------------
ALTER TABLE app_account_settings
  -- DE ONDE veio a afirmacao. E a coluna mais importante deste bloco: sem ela,
  -- "paid" na tela e uma afirmacao sem autor. 'manual' significa que uma pessoa
  -- digitou; 'aws_invoicing' so podera existir depois de a integracao ser
  -- validada em ambiente real; 'unknown' e o resto.
  ADD COLUMN IF NOT EXISTS payment_status_source text NOT NULL DEFAULT 'unknown',

  -- Numero da fatura, id da transacao, protocolo -- o que amarra a afirmacao a
  -- uma evidencia fora deste banco.
  ADD COLUMN IF NOT EXISTS payment_reference     text,

  -- Vencimento EFETIVO desta fatura, quando conhecido. Diferente de
  -- `invoice_due_day`, que e a regra mensal: aqui e a data de um caso concreto,
  -- inclusive quando ela foge da regra (prorrogacao, feriado, acordo).
  ADD COLUMN IF NOT EXISTS payment_due_date      date,

  -- Quando o pagamento foi confirmado. Nao e o mesmo que
  -- `payment_status_updated_at`: uma pessoa pode registrar hoje um pagamento
  -- feito na semana passada, e confundir os dois transformaria atraso em
  -- pontualidade.
  ADD COLUMN IF NOT EXISTS payment_paid_at       timestamptz,

  ADD COLUMN IF NOT EXISTS payment_notes         text;

-- ----------------------------------------------------------------------------
-- 3. Conversao do vocabulario antigo
--
-- Guarda o valor original em `payment_notes` antes de trocar. A conversao e uma
-- INTERPRETACAO nossa, e quem for auditar precisa poder ver o que estava
-- escrito antes de alguem decidir o que aquilo queria dizer.
-- ----------------------------------------------------------------------------
UPDATE app_account_settings
   SET payment_notes = concat_ws(
         E'\n',
         nullif(payment_notes, ''),
         'Migracao 004: situacao anterior registrada como "' || payment_status || '".'
       )
 WHERE payment_status IN ('em_dia', 'pendente', 'atrasado', 'isento');

UPDATE app_account_settings
   SET payment_status = CASE payment_status
         WHEN 'em_dia'   THEN 'paid'
         WHEN 'pendente' THEN 'pending'
         WHEN 'atrasado' THEN 'overdue'
         -- Isencao nao e pagamento: vira revisao manual, para uma pessoa
         -- decidir o que fazer em vez de o sistema fingir que resolveu.
         WHEN 'isento'   THEN 'manual_review'
       END,
       -- Tudo que existia foi digitado por alguem. Nenhuma linha antiga pode
       -- herdar 'aws_invoicing'.
       payment_status_source = 'manual'
 WHERE payment_status IN ('em_dia', 'pendente', 'atrasado', 'isento');

-- ----------------------------------------------------------------------------
-- 4. Novos CHECKs
-- ----------------------------------------------------------------------------
ALTER TABLE app_account_settings
  DROP CONSTRAINT IF EXISTS app_account_settings_payment_status_check;

ALTER TABLE app_account_settings
  ADD CONSTRAINT app_account_settings_payment_status_check
    CHECK (payment_status IS NULL
           OR payment_status IN ('unknown', 'pending', 'paid', 'overdue', 'manual_review')),

  ADD CONSTRAINT app_account_settings_payment_source_check
    CHECK (payment_status_source IN ('manual', 'aws_invoicing', 'unknown')),

  ADD CONSTRAINT app_account_settings_invoice_due_day_check
    CHECK (invoice_due_day IS NULL OR invoice_due_day BETWEEN 1 AND 31),

  ADD CONSTRAINT app_account_settings_notification_days_check
    CHECK (invoice_notification_days_before BETWEEN 0 AND 30),

  -- `paid` sem data de pagamento e uma afirmacao sem evidencia -- exatamente o
  -- que esta entrega existe para evitar. O banco recusa.
  ADD CONSTRAINT app_account_settings_paid_needs_date_check
    CHECK (payment_status IS DISTINCT FROM 'paid' OR payment_paid_at IS NOT NULL);

COMMENT ON COLUMN app_account_settings.invoice_close_day IS
  'Dia do mes em que a fatura fecha. Dia 31 em mes curto e tratado como ultimo dia do mes pela aplicacao.';
COMMENT ON COLUMN app_account_settings.invoice_due_day IS
  'Dia do mes do vencimento. Se for menor que o de fechamento, entende-se vencimento no mes seguinte.';
COMMENT ON COLUMN app_account_settings.invoice_notification_days_before IS
  'Antecedencia do aviso in-app de fechamento, em dias. 0 = avisar apenas no dia.';
COMMENT ON COLUMN app_account_settings.billing_contact_email IS
  'Contato de cobranca. Guardado e exibido; o portal NAO envia e-mail -- nao ha provedor configurado.';
COMMENT ON COLUMN app_account_settings.payment_status IS
  'unknown|pending|paid|overdue|manual_review. NUNCA derivado de CUR/Data Export: eles nao dizem se a fatura foi paga.';
COMMENT ON COLUMN app_account_settings.payment_status_source IS
  'Quem afirmou: manual (uma pessoa) | aws_invoicing (integracao validada) | unknown. Sem isto, "paid" seria afirmacao sem autor.';
COMMENT ON COLUMN app_account_settings.payment_paid_at IS
  'Quando o pagamento ocorreu -- diferente de payment_status_updated_at, que e quando alguem registrou.';

-- ----------------------------------------------------------------------------
-- 5. Privilegios
--
-- Nenhum GRANT novo: `finops_app` ja tem INSERT/UPDATE/DELETE nesta tabela
-- desde a migracao 002, e coluna nova herda o privilegio da tabela. Quem separa
-- ver de alterar aqui e a PERMISSAO da aplicacao (billing:view x billing:manage),
-- nao o GRANT -- as duas operacoes chegam ao banco pelo mesmo role.
-- ----------------------------------------------------------------------------

COMMIT;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== colunas de faturamento =='
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'app_account_settings'
  AND column_name IN ('invoice_close_day', 'invoice_due_day',
                      'invoice_notification_days_before', 'billing_contact_email',
                      'payment_status', 'payment_status_source', 'payment_reference',
                      'payment_due_date', 'payment_paid_at', 'payment_notes',
                      'payment_status_updated_at')
ORDER BY ordinal_position;

\echo ''
\echo '== regras que o banco passa a impor =='
SELECT conname, pg_get_constraintdef(oid) AS definicao
FROM pg_constraint
WHERE conrelid = 'app_account_settings'::regclass AND contype = 'c'
ORDER BY conname;

\echo ''
\echo '== nenhum status fora do vocabulario novo =='
SELECT coalesce(payment_status, '(nulo)') AS status,
       payment_status_source AS fonte,
       count(*) AS contas
FROM app_account_settings
GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '== conferencia: nenhuma outra tabela foi tocada =='
SELECT 'cloud_accounts' AS tabela, count(*) AS linhas FROM cloud_accounts
UNION ALL SELECT 'aws_daily_costs',   count(*) FROM aws_daily_costs
UNION ALL SELECT 'aws_monthly_costs', count(*) FROM aws_monthly_costs;

\echo ''
\echo '== proximo passo: subir o portal com a tela /dashboard/billing =='
