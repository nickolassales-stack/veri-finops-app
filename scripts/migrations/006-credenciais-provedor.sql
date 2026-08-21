-- ============================================================================
-- FinOps :: credenciais de API por conta de provedor
-- ----------------------------------------------------------------------------
-- ADITIVA E REVERSIVEL. Cria UMA tabela nova, `cloud_provider_credentials`.
-- Nao altera nenhuma tabela existente. Nao toca em `aws_daily_costs`,
-- `ovh_monthly_costs`, `cloud_accounts` nem em qualquer objeto do pipeline.
--
-- Rollback: scripts/migrations/006-credenciais-provedor-rollback.sql
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/006-credenciais-provedor.sql
--
-- Idempotente: reexecutar nao duplica nada e nao apaga credencial gravada.
--
-- ----------------------------------------------------------------------------
-- O QUE ESTA TABELA GUARDA, E O QUE ELA NAO GUARDA
--
-- Guarda credencial de API CIFRADA. Nao guarda nada em texto claro, e nao
-- guarda a chave que decifra -- essa vive so em
-- `APP_CREDENTIALS_ENCRYPTION_KEY`, no ambiente do processo do portal.
--
-- Um dump deste banco, sozinho, NAO entrega credencial nenhuma. Isso e o ponto
-- do desenho: o backup do Postgres circula (copia local, snapshot de volume),
-- e a chave nao circula com ele.
--
-- ----------------------------------------------------------------------------
-- POR QUE CIFRADO E NAO HASH -- a pergunta que sempre volta
--
-- Hash serve para VERIFICAR (a senha apresentada e a mesma?). Credencial de API
-- precisa ser USADA: o collector tem de enviar a chave a OVH em cada coleta.
-- Hash e via de mao unica, entao a credencial ficaria inutil no dia seguinte ao
-- cadastro. Cifragem simetrica e a unica forma que atende ao uso.
--
-- O fingerprint HMAC existe ao lado justamente para dar o que o hash daria:
-- comparar sem decifrar. Serve para auditoria ("a credencial mudou entre
-- ontem e hoje?") e para detectar a mesma credencial cadastrada em duas contas.
--
-- ----------------------------------------------------------------------------
-- QUEM ESCREVE, QUEM LE
--
-- Escreve: o PORTAL, com o papel `finops_app`, e somente por acao de um usuario
--          ADMIN. E a primeira tabela em que o portal escreve segredo, e por
--          isso os GRANTs no fim deste arquivo sao explicitos e minimos.
-- Le:      o portal (para status e mascara) e, no proximo passo, o collector
--          (`finops_user`) para autenticar na OVH.
--
-- O collector AINDA NAO le daqui: ele continua lendo o proprio `.env`. Esta
-- migracao cria o destino; a troca do collector e uma entrega separada, descrita
-- em docs/CONTAS-CLOUD.md.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cloud_provider_credentials (
    id                            bigserial   PRIMARY KEY,

    -- Somente 'ovh' hoje. A AWS NAO entra aqui e nao e esquecimento: ela
    -- autentica por IAM role da instancia, sem segredo para guardar. Colocar
    -- 'aws' nesta lista convidaria alguem a colar uma access key no formulario.
    provider                      text        NOT NULL,
    account_id                    text        NOT NULL,

    -- Regiao da API. eu/ca/us sao contas SEPARADAS na OVH: gravar a errada faz o
    -- proximo operador procurar a conta no console errado. Mesma lista de
    -- `ovh_provider_accounts.endpoint`.
    endpoint                      text        NOT NULL,

    -- Envelope `v1:<iv b64>:<cifrado b64>:<tag b64>`, AES-256-GCM com AAD
    -- "provider:account_id:campo". Ver web/src/lib/cripto/segredos.ts.
    --
    -- `text` e nao `bytea`: o envelope e ASCII e legivel, o que permite conferir
    -- o PREFIXO DE VERSAO numa consulta sem escrever codigo -- util no dia de
    -- uma troca de algoritmo. Nao ha ganho de espaco relevante em 3 colunas.
    application_key_encrypted     text        NOT NULL,
    application_secret_encrypted  text        NOT NULL,
    consumer_key_encrypted        text        NOT NULL,

    -- HMAC-SHA256 hex (64 chars) do valor em claro, com subchave derivada.
    -- NAO ha fingerprint do application_secret de proposito: ele nunca precisa
    -- ser comparado por fora, e cada copia derivada de um segredo e mais uma
    -- superficie. Auditoria de identidade usa a application_key.
    application_key_fingerprint   text        NOT NULL,
    consumer_key_fingerprint      text        NOT NULL,

    -- Resultado da ultima validacao contra a API do provedor.
    status                        text        NOT NULL DEFAULT 'nao_validado',
    last_validated_at             timestamptz,

    -- Mensagem JA SANITIZADA pelo portal. Nunca o corpo cru da resposta da OVH:
    -- ela ecoa cabecalhos de autenticacao em alguns erros, e esta coluna e
    -- exibida na tela.
    last_validation_error         text,

    created_by                    bigint,
    updated_by                    bigint,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    updated_at                    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cloud_provider_credentials_provider_check
        CHECK (provider IN ('ovh')),

    CONSTRAINT cloud_provider_credentials_endpoint_check
        CHECK (endpoint IN ('ovh-eu', 'ovh-ca', 'ovh-us')),

    CONSTRAINT cloud_provider_credentials_status_check
        CHECK (status IN ('nao_validado', 'conectado', 'invalido')),

    -- Envelope no formato desta versao. Guarda contra INSERT feito na mao com
    -- valor em claro -- que passaria pelos tipos e sairia como credencial
    -- "cifrada" que o portal nao consegue decifrar.
    CONSTRAINT cloud_provider_credentials_envelope_check
        CHECK (
            application_key_encrypted    LIKE 'v1:%' AND
            application_secret_encrypted LIKE 'v1:%' AND
            consumer_key_encrypted       LIKE 'v1:%'
        ),

    -- 64 hex do HMAC-SHA256. Mesma ideia: rejeita valor colado a mao.
    CONSTRAINT cloud_provider_credentials_fingerprint_check
        CHECK (
            application_key_fingerprint ~ '^[0-9a-f]{64}$' AND
            consumer_key_fingerprint    ~ '^[0-9a-f]{64}$'
        ),

    -- UMA credencial por conta e provedor. A tela edita no lugar; nao ha
    -- historico de credencial de proposito -- guardar versoes antigas de um
    -- segredo multiplica a superficie sem responder nenhuma pergunta que o
    -- fingerprint e o `updated_at` nao respondam.
    CONSTRAINT cloud_provider_credentials_unica
        UNIQUE (provider, account_id)
);

COMMENT ON TABLE cloud_provider_credentials IS
  'Credenciais de API por conta de provedor, cifradas com AES-256-GCM. A chave '
  'de cifragem NAO esta neste banco: vive em APP_CREDENTIALS_ENCRYPTION_KEY, no '
  'ambiente do portal. Escrita apenas por usuario ADMIN, pela tela '
  'Configuracoes > Contas Cloud.';

COMMENT ON COLUMN cloud_provider_credentials.application_secret_encrypted IS
  'Envelope AES-256-GCM. NUNCA e devolvido ao frontend, nem mascarado: a tela '
  'sabe apenas se existe.';

COMMENT ON COLUMN cloud_provider_credentials.last_validation_error IS
  'Mensagem sanitizada pelo portal. Nunca o corpo cru da resposta do provedor.';

-- ------------------------------------------------------------------ indices

-- A consulta do collector sera "credencial desta conta, deste provedor", ja
-- coberta pela UNIQUE acima. Este indice serve a OUTRA pergunta: "quais contas
-- tem credencial com problema?", que a tela de Contas Cloud faz a cada carga.
CREATE INDEX IF NOT EXISTS cloud_provider_credentials_status_idx
    ON cloud_provider_credentials (status, provider);

-- ------------------------------------------------ referencia a cloud_accounts

-- FK DE VERDADE quando o schema permite, e nao apenas "logica".
--
-- O pedido original falava em FK logica "se existir no schema". Uma FK real e
-- melhor e exige uma condicao: `cloud_accounts.account_id` precisa ter indice
-- unico. Ele e chave primaria no banco de producao, mas esta migracao tem de
-- rodar tambem em base recriada do zero, onde a ordem pode diferir -- entao a
-- condicao e VERIFICADA, nao presumida, e a ausencia dela nao derruba a
-- migracao inteira.
--
-- ON DELETE CASCADE: credencial de conta que nao existe mais e passivo puro --
-- segredo sobrevivendo a propria finalidade. Some com a conta.
--
-- Os dois `::text` abaixo NAO sao decoracao. `pg_attribute.attname` e do tipo
-- `name`, entao `array_agg` devolve `name[]`, e o PostgreSQL nao tem operador
-- `name[] = text[]` -- sem o cast a migracao aborta com "operator does not
-- exist". Aconteceu na primeira tentativa de aplicar em producao.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = 'cloud_accounts'
           AND c.contype IN ('p', 'u')
           AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
                  FROM pg_attribute a
                 WHERE a.attrelid = c.conrelid
                   AND a.attnum = ANY (c.conkey)) = ARRAY['account_id']::text[]
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'cloud_provider_credentials_conta_fk'
    ) THEN
        ALTER TABLE cloud_provider_credentials
            ADD CONSTRAINT cloud_provider_credentials_conta_fk
            FOREIGN KEY (account_id) REFERENCES cloud_accounts (account_id)
            ON DELETE CASCADE;
        RAISE NOTICE 'FK para cloud_accounts(account_id) criada.';
    ELSE
        RAISE NOTICE 'FK para cloud_accounts nao criada (ja existe, ou account_id nao tem indice unico). A integridade fica por conta da aplicacao.';
    END IF;
END $$;

-- created_by / updated_by apontam para quem mexeu. SET NULL e nao CASCADE: a
-- saida de um administrador da empresa NAO pode apagar a credencial que mantem
-- a coleta funcionando. Perde-se a autoria, preserva-se o servico.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'app_users')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conname = 'cloud_provider_credentials_criado_por_fk') THEN
        ALTER TABLE cloud_provider_credentials
            ADD CONSTRAINT cloud_provider_credentials_criado_por_fk
            FOREIGN KEY (created_by) REFERENCES app_users (id) ON DELETE SET NULL;
        ALTER TABLE cloud_provider_credentials
            ADD CONSTRAINT cloud_provider_credentials_alterado_por_fk
            FOREIGN KEY (updated_by) REFERENCES app_users (id) ON DELETE SET NULL;
        RAISE NOTICE 'FKs de autoria para app_users criadas.';
    END IF;
END $$;

-- ------------------------------------------------------------------- gatilho

-- `updated_at` mantido pelo banco, e nao pela aplicacao: e o campo que responde
-- "quando esta credencial mudou pela ultima vez?" numa investigacao, e um
-- UPDATE feito por fora do portal tem de aparecer nele.
CREATE OR REPLACE FUNCTION cloud_provider_credentials_touch()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cloud_provider_credentials_touch_trg
    ON cloud_provider_credentials;
CREATE TRIGGER cloud_provider_credentials_touch_trg
    BEFORE UPDATE ON cloud_provider_credentials
    FOR EACH ROW EXECUTE FUNCTION cloud_provider_credentials_touch();

-- -------------------------------------------------------------------- grants

-- PRIMEIRA tabela em que o portal escreve segredo. Os privilegios sao dados um
-- por um, e nao por `ALL`: o portal precisa inserir, atualizar e remover
-- credencial, e nada alem disso. Sem TRUNCATE, sem REFERENCES.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_provider_credentials TO finops_app;
        GRANT USAGE, SELECT ON SEQUENCE cloud_provider_credentials_id_seq TO finops_app;
        RAISE NOTICE 'GRANTs concedidos a finops_app.';
    ELSE
        RAISE NOTICE 'role finops_app nao existe -- rode scripts/create-app-role.sql.';
    END IF;
END $$;

-- O collector roda como finops_user (superusuario hoje), entao o GRANT abaixo e
-- redundante na pratica. Ele existe para o dia em que finops_user deixar de ser
-- superusuario -- e essa e uma pendencia registrada em README secao 13.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_user') THEN
        GRANT SELECT ON cloud_provider_credentials TO finops_user;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- CONFERENCIA (rode depois, fora da transacao)
--
--   \d+ cloud_provider_credentials
--
--   -- Nenhuma credencial em claro: toda linha tem de comecar com o envelope.
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE application_secret_encrypted LIKE 'v1:%') AS cifradas
--     FROM cloud_provider_credentials;
--
--   -- A mesma credencial cadastrada em duas contas? (fingerprint responde sem
--   -- decifrar nada)
--   SELECT application_key_fingerprint, count(*)
--     FROM cloud_provider_credentials
--    GROUP BY 1 HAVING count(*) > 1;
-- ============================================================================
