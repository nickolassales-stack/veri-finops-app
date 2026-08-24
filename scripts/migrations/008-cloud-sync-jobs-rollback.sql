-- =============================================================================
-- 008 -- ROLLBACK: remove a fila cloud_sync_jobs
-- =============================================================================
--
-- O QUE ISTO APAGA
--
-- O historico de pedidos de coleta. Nao apaga custo, fatura, projeto nem
-- `ovh_sync_runs`: a coleta em si vive nessas tabelas e sobrevive a este
-- rollback intacta.
--
-- O QUE PARA DE FUNCIONAR
--
-- O botao "Salvar e executar primeira coleta" no portal. Ele passa a falhar com
-- erro de tabela ausente -- e o codigo do portal trata esse caso: a credencial
-- continua sendo salva e testada, so o enfileiramento e recusado com mensagem
-- propria. Salvar credencial NAO depende desta tabela.
--
-- O worker (`processar_jobs.py`) tambem detecta a ausencia e sai com codigo 0
-- em vez de estourar no cron a cada minuto.
--
-- A coleta diaria (`run-ovh-etl.sh cron --all`) nao usa esta tabela e nao e
-- afetada de forma alguma.
--
-- ANTES DE RODAR
--
-- Se houver job em `running`, um worker pode estar coletando neste instante.
-- Derrubar a tabela no meio disso nao corrompe a coleta -- ela grava em
-- `ovh_sync_runs` --, mas o worker vai falhar ao tentar fechar o job. Confira:
--
--   SELECT id, account_id, status, started_at FROM cloud_sync_jobs
--    WHERE status IN ('queued','running') ORDER BY requested_at;
--
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS cloud_sync_jobs_touch_trg ON cloud_sync_jobs;
DROP FUNCTION IF EXISTS cloud_sync_jobs_touch();

-- Os indices e as FKs caem com a tabela; nomeados aqui so para quem ler o
-- arquivo saber o que existia.
--   cloud_sync_jobs_conta_ativa_uniq    (o cadeado de job unico por conta)
--   cloud_sync_jobs_fila_idx
--   cloud_sync_jobs_conta_recente_idx
--   cloud_sync_jobs_pedido_por_fk       -> app_users
--   cloud_sync_jobs_execucao_fk         -> ovh_sync_runs
DROP TABLE IF EXISTS cloud_sync_jobs;

COMMIT;
