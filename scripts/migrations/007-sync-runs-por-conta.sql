-- ============================================================================
-- FinOps :: ovh_sync_runs passa a identificar a CONTA
-- ----------------------------------------------------------------------------
-- ADITIVA E REVERSIVEL. Acrescenta UMA coluna nullable a `ovh_sync_runs`.
-- Nao altera dado existente, nao mexe em nenhuma outra tabela, nao toca em nada
-- da AWS.
--
-- Rollback: scripts/migrations/007-sync-runs-por-conta-rollback.sql
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/007-sync-runs-por-conta.sql
--
-- ----------------------------------------------------------------------------
-- POR QUE
--
-- Ate aqui o collector coletava UMA conta, lida do `.env`, e uma linha de
-- `ovh_sync_runs` bastava para descrever a execucao. Com as credenciais no banco
-- ele passa a coletar N contas, cada uma com sucesso ou falha propria -- e a
-- pergunta "a coleta funcionou?" deixa de ter resposta unica.
--
-- Sem esta coluna, duas contas coletando no mesmo dia produziriam duas linhas
-- indistinguiveis, e uma falha parcial apareceria como "houve uma falha hoje"
-- sem dizer de QUAL conta. O diagnostico ficaria pior do que era com uma conta.
--
-- ----------------------------------------------------------------------------
-- POR QUE NULLABLE, E POR QUE VAI CONTINUAR NULLABLE
--
-- Tres tipos de linha legitimamente nao tem conta:
--
--   1. As 7 linhas historicas, gravadas antes desta mudanca.
--   2. `--fechar-orfas`, que encerra execucoes travadas e nao coleta nada.
--   3. Uma falha ANTES de descobrir as contas -- banco fora do ar, chave de
--      cifragem ausente. Nesse caso nao ha conta a atribuir, e inventar uma
--      seria pior do que deixar nulo.
--
-- NOT NULL exigiria um valor sentinela ('desconhecida', ''), que e sempre pior:
-- viraria um id de conta que nao existe em `ovh_provider_accounts`, quebrando
-- qualquer JOIN futuro.
--
-- ----------------------------------------------------------------------------
-- SEM FK PARA ovh_provider_accounts -- de proposito
--
-- A ordem dos fatos impede. O collector abre o run ANTES de chamar a API, e e a
-- chamada que descobre/confirma a conta em `ovh_provider_accounts`. Numa
-- primeira coleta, a linha de `ovh_sync_runs` nasce antes da linha da conta.
--
-- Com FK, o INSERT do run falharia -- e o registro da falha e justamente o que
-- nao pode falhar. Registro de erro que nao consegue ser gravado nao serve para
-- nada.
-- ============================================================================

BEGIN;

ALTER TABLE ovh_sync_runs
    ADD COLUMN IF NOT EXISTS provider_account_id text;

COMMENT ON COLUMN ovh_sync_runs.provider_account_id IS
  'Conta OVH desta execucao. NULL em tres casos legitimos: linha anterior a '
  'coleta multi-conta, execucao de --fechar-orfas, e falha ocorrida antes de as '
  'contas serem descobertas. Sem FK de proposito: o run e aberto antes de a '
  'conta existir em ovh_provider_accounts.';

-- A consulta que o portal faz e "ultima execucao" e "ultimo sucesso", agora
-- podendo ser por conta. Sem indice, cada carga da tela varreria a tabela --
-- barato hoje com 7 linhas, e crescendo N vezes mais rapido a partir de agora.
--
-- `started_at DESC` na definicao porque toda consulta pede a mais recente.
CREATE INDEX IF NOT EXISTS ovh_sync_runs_conta_inicio_idx
    ON ovh_sync_runs (provider_account_id, started_at DESC);

COMMIT;

-- ============================================================================
-- CONFERENCIA
--
--   \d ovh_sync_runs
--
--   -- As linhas historicas ficaram nulas, como esperado:
--   SELECT provider_account_id, count(*)
--     FROM ovh_sync_runs GROUP BY 1 ORDER BY 1 NULLS FIRST;
--
--   -- Depois da primeira coleta multi-conta, uma linha por conta por execucao:
--   SELECT provider_account_id, status, source, started_at
--     FROM ovh_sync_runs ORDER BY started_at DESC LIMIT 10;
--
-- ----------------------------------------------------------------------------
-- EFEITO NO PORTAL -- leia antes de aplicar
--
-- Nenhuma tela quebra: as consultas do portal nomeiam as colunas que leem, e
-- nenhuma usa `SELECT *`. A coluna nova e simplesmente ignorada por elas.
--
-- MAS a LEITURA de duas telas muda de significado, e isso nao e defeito desta
-- migracao -- e consequencia de passar a ter N contas:
--
--   - O card "Status do collector" (painel OVH) e /dashboard/diagnostico usam a
--     ULTIMA execucao para decidir a situacao. Com varias contas, a ultima pode
--     ser a falha de uma conta enquanto as outras foram bem -- e a tela vai
--     dizer que a coleta falhou. Esta correto no sentido de "algo esta errado",
--     mas nao diz o que.
--
-- Ajustar as duas telas para agregar por conta e trabalho separado, registrado
-- em docs/ovh-collector-multiconta.md. Enquanto nao for feito, a tela erra para
-- o lado seguro: acusa problema que existe, sem precisar qual.
-- ============================================================================
