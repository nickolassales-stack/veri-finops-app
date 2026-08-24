-- =============================================================================
-- 008 -- cloud_sync_jobs: fila de coleta entre o portal e o collector
-- =============================================================================
--
-- POR QUE UMA FILA, E NAO UMA CHAMADA DIRETA
--
-- O portal roda dentro do container `finops-portal`. O collector roda no HOST,
-- em /opt/finops/ovh-collector, com venv proprio, chamado por cron. O container
-- nao tem o filesystem do host montado, nao tem o venv e nao tem o binario do
-- Python do collector -- e dar a ele qualquer um dos tres significaria montar
-- diretorio do host num processo que atende requisicao HTTP publica.
--
-- Executar shell a partir de rota HTTP e a alternativa que este arquivo existe
-- para evitar. Mesmo parametrizado com cuidado, transforma a tela de
-- configuracao em superficie de execucao de comando.
--
-- Entao a tela nao executa nada: ela INSERE UMA LINHA. Um worker no host, que ja
-- tem tudo de que precisa, le a linha e trabalha. A fronteira de confianca fica
-- no banco, que os dois lados ja acessam de qualquer forma.
--
-- -----------------------------------------------------------------------------
-- O INDICE UNICO PARCIAL E O CADEADO, NAO UM DETALHE DE PERFORMANCE
--
-- `cloud_sync_jobs_conta_ativa_uniq` impede que exista mais de UM job em
-- `queued` ou `running` para a mesma conta. Isso e o que faz o botao ser seguro
-- de clicar duas vezes: o segundo insert bate no indice e nao cria fila dupla.
--
-- Deixar isso para a aplicacao seria confiar em `SELECT` antes de `INSERT`, que
-- e uma corrida perdida por definicao -- duas requisicoes simultaneas leem
-- "nao existe" e as duas inserem. O banco e o unico lugar onde essa checagem
-- pode ser atomica.
--
-- O indice cobre a fila. Ele NAO cobre a coleta diaria do cron, que nao passa
-- por job nenhum: essa exclusao e feita com lock consultivo (`pg_advisory_lock`)
-- pelos dois caminhos. Ver scripts/ovh-collector/jobs_ovh.py.
--
-- -----------------------------------------------------------------------------
-- Reversao: scripts/migrations/008-cloud-sync-jobs-rollback.sql
-- Documentacao: docs/CONTAS-CLOUD.md secao 11, docs/ovh-collector-multiconta.md
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cloud_sync_jobs (
    id              bigserial PRIMARY KEY,

    -- `provider` fica generico no nome da tabela e restrito no CHECK. A fila
    -- nasce so com OVH porque so a OVH tem credencial no banco; AWS chega pelo
    -- pipeline Athena e nao tem o que enfileirar. Quando houver um segundo
    -- provedor com coleta sob demanda, muda o CHECK, nao o nome da tabela.
    provider        text NOT NULL DEFAULT 'ovh',

    -- Sem FK para `cloud_accounts`. Mesmo motivo da 007: o job registra uma
    -- INTENCAO, e o registro da intencao nao pode falhar porque a conta foi
    -- removida no meio do caminho. O historico de "pediram coleta desta conta"
    -- tem valor de auditoria mesmo depois de a conta sumir.
    account_id      text NOT NULL,

    action          text NOT NULL DEFAULT 'first_sync',
    status          text NOT NULL DEFAULT 'queued',

    -- Quem pediu. SET NULL e nao CASCADE: a saida de um administrador da empresa
    -- nao pode apagar o registro de auditoria do que ele pediu.
    requested_by    bigint,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,

    -- SEMPRE sanitizado antes de chegar aqui. A mensagem da OVH pode conter
    -- fragmento de credencial e o `OVH-Query-ID`; `sem_segredo()` no collector e
    -- `sanitizar()` no portal cortam qualquer sequencia longa antes do INSERT.
    error_message   text,

    -- Liga o job a execucao que ele produziu, para a tela poder mostrar linhas,
    -- faturas e projetos sem reimplementar a leitura de `ovh_sync_runs`.
    sync_run_id     bigint,

    -- Conta quantas vezes o worker pegou este job. Um job que reaparece em
    -- `queued` depois de o worker morrer nao pode ser tentado para sempre.
    attempts        integer NOT NULL DEFAULT 0,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cloud_sync_jobs_provider_check
        CHECK (provider = 'ovh'),
    CONSTRAINT cloud_sync_jobs_action_check
        CHECK (action IN ('first_sync', 'manual_sync')),
    CONSTRAINT cloud_sync_jobs_status_check
        CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),

    -- Coerencia temporal. Um job `success` sem `finished_at` deixaria a tela
    -- mostrando "concluido" sem quando, e um `finished_at` antes de `started_at`
    -- so pode ser bug de quem gravou.
    CONSTRAINT cloud_sync_jobs_tempo_check
        CHECK (
            (finished_at IS NULL OR started_at IS NOT NULL)
            AND (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
        ),
    CONSTRAINT cloud_sync_jobs_terminal_check
        CHECK (
            status NOT IN ('success', 'failed') OR finished_at IS NOT NULL
        )
);

COMMENT ON TABLE cloud_sync_jobs IS
  'Fila de coleta sob demanda entre o portal (que insere) e o collector no host '
  '(que processa). O portal nunca executa shell: ele grava uma linha aqui. '
  'Ver scripts/ovh-collector/processar_jobs.py.';

COMMENT ON COLUMN cloud_sync_jobs.error_message IS
  'Mensagem JA SANITIZADA. Erro cru da OVH pode conter fragmento de credencial.';

COMMENT ON COLUMN cloud_sync_jobs.attempts IS
  'Incrementado a cada claim do worker. Limite aplicado no worker, nao aqui: o '
  'numero certo de tentativas e decisao de operacao, nao de schema.';

-- ------------------------------------------------------------------ indices

-- O CADEADO. No maximo um job vivo por conta e provedor.
CREATE UNIQUE INDEX IF NOT EXISTS cloud_sync_jobs_conta_ativa_uniq
    ON cloud_sync_jobs (provider, account_id)
 WHERE status IN ('queued', 'running');

-- A fila do worker: pega o mais antigo em `queued`.
CREATE INDEX IF NOT EXISTS cloud_sync_jobs_fila_idx
    ON cloud_sync_jobs (status, requested_at)
 WHERE status IN ('queued', 'running');

-- O historico por conta, que a tela mostra como "ultimo resultado".
CREATE INDEX IF NOT EXISTS cloud_sync_jobs_conta_recente_idx
    ON cloud_sync_jobs (provider, account_id, requested_at DESC);

-- --------------------------------------------------------------------- FKs
--
-- Condicionais, como nas migracoes anteriores: esta migracao tem de rodar em
-- base recriada do zero, onde a ordem de criacao pode diferir. A ausencia de uma
-- FK nao pode derrubar a migracao inteira.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'app_users')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conname = 'cloud_sync_jobs_pedido_por_fk') THEN
        ALTER TABLE cloud_sync_jobs
            ADD CONSTRAINT cloud_sync_jobs_pedido_por_fk
            FOREIGN KEY (requested_by) REFERENCES app_users (id) ON DELETE SET NULL;
        RAISE NOTICE 'FK de autoria para app_users criada.';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ovh_sync_runs')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conname = 'cloud_sync_jobs_execucao_fk') THEN
        -- SET NULL: limpar historico antigo de `ovh_sync_runs` nao pode apagar o
        -- job. Perde-se o detalhe da execucao, preserva-se o registro do pedido.
        ALTER TABLE cloud_sync_jobs
            ADD CONSTRAINT cloud_sync_jobs_execucao_fk
            FOREIGN KEY (sync_run_id) REFERENCES ovh_sync_runs (id) ON DELETE SET NULL;
        RAISE NOTICE 'FK para ovh_sync_runs criada.';
    END IF;
END $$;

-- ------------------------------------------------------------------- gatilho
CREATE OR REPLACE FUNCTION cloud_sync_jobs_touch()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cloud_sync_jobs_touch_trg ON cloud_sync_jobs;
CREATE TRIGGER cloud_sync_jobs_touch_trg
    BEFORE UPDATE ON cloud_sync_jobs
    FOR EACH ROW EXECUTE FUNCTION cloud_sync_jobs_touch();

-- -------------------------------------------------------------------- grants
--
-- Assimetria proposital. O portal ENFILEIRA e LE; ele nao processa, entao nao
-- precisa de UPDATE. O collector roda como finops_user (superusuario hoje), e o
-- GRANT abaixo e explicito para o dia em que deixar de ser.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
        GRANT SELECT, INSERT ON cloud_sync_jobs TO finops_app;
        GRANT USAGE, SELECT ON SEQUENCE cloud_sync_jobs_id_seq TO finops_app;
        RAISE NOTICE 'GRANTs (SELECT, INSERT) concedidos a finops_app.';
    ELSE
        RAISE NOTICE 'role finops_app nao existe -- rode scripts/create-app-role.sql.';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_user') THEN
        GRANT SELECT, INSERT, UPDATE ON cloud_sync_jobs TO finops_user;
        RAISE NOTICE 'GRANTs (SELECT, INSERT, UPDATE) concedidos a finops_user.';
    END IF;
END $$;

COMMIT;
