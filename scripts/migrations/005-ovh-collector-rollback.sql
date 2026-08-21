-- ============================================================================
-- ROLLBACK da 005-ovh-collector.sql
-- ----------------------------------------------------------------------------
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/005-ovh-collector-rollback.sql
--
-- ----------------------------------------------------------------------------
-- O QUE ESTE ROLLBACK DESTROI
--
-- Tudo que a coleta OVH acumulou. Nem tudo volta rodando o collector de novo:
--
--   ovh_monthly_costs  com source='usage_current': FOTOGRAFIA de um mes em
--     andamento. A API da OVH devolve o consumo de AGORA -- nao existe endpoint
--     para "qual era o consumo no dia 12". Apagar a serie historica de uso
--     corrente e definitivo.
--   ovh_sync_runs      historico de execucoes. Nao regeneravel: e a memoria de
--     quando a coleta falhou e por que.
--   ovh_invoice_*      recoletaveis enquanto a OVH mantiver as faturas na API,
--     o que tem limite de retencao.
--
-- FACA DUMP ANTES:
--
--   docker exec finops-postgres pg_dump -U finops_user -d finops \
--     -t 'ovh_*' > /opt/finops/backups/ovh-$(date +%F-%H%M).sql
--
-- ----------------------------------------------------------------------------
-- O QUE ELE NAO TOCA
--
-- Nada de AWS. `aws_daily_costs`, `aws_monthly_costs`, `cloud_accounts`, as
-- tabelas `app_*` e o pipeline Athena seguem intactos -- a 005 nunca os alterou,
-- entao nao ha o que reverter neles.
--
-- Se `cloud_accounts` recebeu contas com provider='ovh', elas PERMANECEM: sao
-- cadastro, nao coleta, e apaga-las levaria junto os dados de faturamento em
-- `app_account_settings` (FK com ON DELETE CASCADE). Remova a mao, se for o caso.
--
-- ----------------------------------------------------------------------------
-- ORDEM
--
-- Da tabela mais dependente para a menos. Sem CASCADE de proposito: se algo que
-- nao esta previsto aqui depender destas tabelas -- uma view de unificacao
-- criada depois, por exemplo -- o DROP falha e avisa, em vez de arrastar o
-- objeto desconhecido junto.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS ovh_invoice_lines;
DROP TABLE IF EXISTS ovh_invoice_headers;
DROP TABLE IF EXISTS ovh_monthly_costs;
DROP TABLE IF EXISTS ovh_projects;
DROP TABLE IF EXISTS ovh_provider_accounts;
DROP TABLE IF EXISTS ovh_sync_runs;

COMMIT;
