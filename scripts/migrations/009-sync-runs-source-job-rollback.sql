-- =============================================================================
-- 009 -- ROLLBACK: ovh_sync_runs.source volta a recusar 'job'
-- =============================================================================
--
-- ATENCAO: se houver linha com source='job', o CHECK antigo NAO PODE ser
-- recriado -- o PostgreSQL valida as linhas existentes ao adicionar a
-- restricao, e o ALTER falha. Confira primeiro:
--
--   SELECT count(*) FROM ovh_sync_runs WHERE source = 'job';
--
-- Havendo linhas, escolha: reclassificar como 'manual' (perde a distincao de
-- origem, preserva o historico de execucao) ou nao reverter. Este arquivo faz a
-- reclassificacao, porque apagar historico de execucao para satisfazer uma
-- restricao seria trocar dado por conveniencia.
--
-- Depois de reverter, o collector volta a degradar: grava 'manual' no lugar de
-- 'job' e avisa no log. A coleta continua funcionando.
-- =============================================================================

BEGIN;

UPDATE ovh_sync_runs SET source = 'manual' WHERE source = 'job';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ovh_sync_runs_source_check'
    ) THEN
        ALTER TABLE ovh_sync_runs DROP CONSTRAINT ovh_sync_runs_source_check;
    END IF;
END $$;

ALTER TABLE ovh_sync_runs
    ADD CONSTRAINT ovh_sync_runs_source_check
    CHECK (source = ANY (ARRAY['manual', 'cron', 'unknown']));

COMMIT;
