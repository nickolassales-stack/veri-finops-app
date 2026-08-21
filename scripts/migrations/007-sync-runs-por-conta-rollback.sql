-- ============================================================================
-- ROLLBACK :: 007-sync-runs-por-conta.sql
-- ----------------------------------------------------------------------------
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/007-sync-runs-por-conta-rollback.sql
--
-- ----------------------------------------------------------------------------
-- QUASE SEMPRE VOCE NAO QUER RODAR ISTO
--
-- A coluna e nullable e ninguem depende dela para funcionar: o collector antigo
-- a ignora, o portal a ignora, e as consultas existentes nomeiam suas colunas.
-- Deixa-la no lugar nao atrapalha nada.
--
-- O que este arquivo APAGA e a resposta a pergunta "qual conta falhou?" para
-- todo o historico ja gravado. Isso nao volta -- a informacao nao esta em outro
-- lugar. Se a intencao e apenas voltar o CODIGO do collector, volte o codigo e
-- deixe a coluna.
--
-- Antes de decidir, veja quanto se perde:
--
--   SELECT provider_account_id, count(*) AS execucoes,
--          min(started_at) AS de, max(started_at) AS ate
--     FROM ovh_sync_runs
--    WHERE provider_account_id IS NOT NULL
--    GROUP BY 1 ORDER BY 1;
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS ovh_sync_runs_conta_inicio_idx;

ALTER TABLE ovh_sync_runs
    DROP COLUMN IF EXISTS provider_account_id;

COMMIT;

-- ============================================================================
-- CONFERENCIA
--
--   SELECT count(*) = 0 AS coluna_removida
--     FROM information_schema.columns
--    WHERE table_name = 'ovh_sync_runs'
--      AND column_name = 'provider_account_id';
--
-- As linhas de `ovh_sync_runs` continuam todas la: esta migracao nunca apagou
-- execucao nenhuma, so a coluna. O historico de sucesso/falha permanece -- sem
-- dizer de qual conta.
-- ============================================================================
