-- =============================================================================
-- 009 -- ovh_sync_runs.source aceita 'job'
-- =============================================================================
--
-- POR QUE ESTA MIGRACAO EXISTE
--
-- Encontrada em producao, no primeiro teste controlado da fila. O worker gravava
-- `source = 'job'` e o CHECK recusava:
--
--   CHECK (source = ANY (ARRAY['manual','cron','unknown']))
--
-- O collector degrada em vez de derrubar a coleta -- monitoramento nunca derruba
-- o que ele monitora --, entao o efeito NAO foi coleta perdida: os custos foram
-- gravados normalmente. O efeito foi PIOR de diagnosticar: a coleta funcionou e
-- nao ficou registrada em `ovh_sync_runs`, e o job ficou com `sync_run_id` nulo.
--
-- Ou seja, a tela continuou mostrando a falha do dia anterior como "ultima
-- sincronizacao" enquanto uma coleta bem-sucedida acabava de acontecer. Um
-- sucesso invisivel e a forma mais cara de estar certo.
--
-- -----------------------------------------------------------------------------
-- POR QUE UM VALOR NOVO, E NAO REUSAR 'manual'
--
-- `source` existe para dizer DE ONDE veio a execucao, e coleta pedida pela tela
-- nao e a mesma coisa que alguem rodando o CLI. Reusar 'manual' pouparia esta
-- migracao e tornaria impossivel responder "quantas coletas vieram do portal?".
--
-- Nao afeta o diagnostico existente: ele pergunta por `source = 'cron'` para
-- saber se o agendamento funciona, e um valor novo nao entra nessa conta. O tipo
-- no portal (`ExecucaoOvh.source`) e `string`, sem uniao estreita, entao 'job'
-- aparece na tela como qualquer outro.
--
-- -----------------------------------------------------------------------------
-- Reversao: scripts/migrations/009-sync-runs-source-job-rollback.sql
-- =============================================================================

BEGIN;

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
    CHECK (source = ANY (ARRAY['manual', 'cron', 'unknown', 'job']));

COMMENT ON COLUMN ovh_sync_runs.source IS
  'De onde veio a execucao: manual (CLI), cron (agendada), job (pedida pelo '
  'portal via cloud_sync_jobs), unknown. O collector degrada para manual se este '
  'CHECK recusar o valor -- ver Execucao.abrir().';

COMMIT;
