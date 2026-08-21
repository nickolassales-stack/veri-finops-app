-- ============================================================================
-- ROLLBACK :: 006-credenciais-provedor.sql
-- ----------------------------------------------------------------------------
-- Remove a tabela `cloud_provider_credentials`, o gatilho e a funcao.
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/006-credenciais-provedor-rollback.sql
--
-- ----------------------------------------------------------------------------
-- ISTO APAGA CREDENCIAL, E O DADO NAO E REGENERAVEL PELO SISTEMA
--
-- Diferente das migracoes 001 e 003, cujo conteudo o ETL recarrega, aqui o dado
-- foi DIGITADO por alguem a partir do console da OVH. Um rollback sem backup
-- obriga a voltar ao console, gerar credencial nova e cadastrar de novo.
--
-- Se a intencao e apenas voltar o CODIGO, nao rode este arquivo: a tabela
-- sozinha nao atrapalha nada. O portal antigo a ignora, o collector antigo nao a
-- consulta. Rode isto so quando quiser mesmo eliminar as credenciais gravadas.
--
-- BACKUP ANTES, se houver qualquer linha:
--
--   docker exec finops-postgres pg_dump -U finops_user -d finops \
--     -t cloud_provider_credentials --data-only \
--     > /opt/backups/veri-finops/credenciais.$(date +%F-%H%M).sql
--   chmod 600 /opt/backups/veri-finops/credenciais.*.sql
--
-- O dump sai CIFRADO -- e o envelope, nao o segredo. Ele so tem valor com a
-- `APP_CREDENTIALS_ENCRYPTION_KEY` da epoca: restaurar o dump depois de trocar a
-- chave devolve linhas que nao decifram. Guarde os dois, ou nenhum.
--
-- Quantas linhas existem, antes de decidir:
--   SELECT provider, account_id, status, updated_at
--     FROM cloud_provider_credentials ORDER BY provider, account_id;
-- ============================================================================

BEGIN;

-- O gatilho cai junto com a tabela; DROP explicito para o caso de a tabela ter
-- sido removida a mao e a funcao ter ficado orfa.
DROP TRIGGER IF EXISTS cloud_provider_credentials_touch_trg
    ON cloud_provider_credentials;

DROP TABLE IF EXISTS cloud_provider_credentials;

DROP FUNCTION IF EXISTS cloud_provider_credentials_touch();

COMMIT;

-- ============================================================================
-- CONFERENCIA
--
--   SELECT to_regclass('cloud_provider_credentials') IS NULL AS tabela_removida;
--
-- Nada mais precisa ser desfeito: a migracao 006 nao alterou nenhuma tabela
-- existente, entao nao ha coluna a devolver nem constraint a recriar em outro
-- objeto. `cloud_accounts`, `app_users` e as tabelas `ovh_*` seguem intactas --
-- as FKs apontavam DAQUI para elas, e caem com esta tabela.
-- ============================================================================
