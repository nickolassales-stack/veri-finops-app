-- ============================================================================
-- FinOps :: tabelas de autenticacao da APLICACAO
-- ----------------------------------------------------------------------------
-- ADITIVO E NAO DESTRUTIVO. Cria duas tabelas novas e concede privilegios ao
-- role da aplicacao. NAO toca em nenhuma tabela financeira
-- (aws_daily_costs, aws_monthly_costs, cloud_accounts, cloud_budgets,
-- cost_alerts), nao altera dado existente e nao remove nada.
--
-- As tabelas usam o prefixo `app_` justamente para ficarem visivelmente
-- separadas das tabelas de custo alimentadas pelo ETL.
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/create-auth-tables.sql
--
-- Idempotente: pode ser reexecutado sem efeito colateral.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Usuarios da aplicacao
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id             bigserial   PRIMARY KEY,
  email          text        NOT NULL,
  -- Formato: scrypt$N$r$p$<salt base64>$<hash base64>. Os parametros ficam no
  -- proprio registro para poderem evoluir sem invalidar hashes antigos.
  password_hash  text        NOT NULL,
  name           text,
  role           text        NOT NULL DEFAULT 'VIEWER',
  active         boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_role_check CHECK (role IN ('ADMIN', 'VIEWER'))
);

-- E-mail unico ignorando caixa: "Nick@x.com" e "nick@x.com" sao o mesmo login.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key
  ON app_users (lower(email));

COMMENT ON TABLE  app_users IS 'Usuarios do Portal FinOps. Sem cadastro publico: criados por comando administrativo.';
COMMENT ON COLUMN app_users.password_hash IS 'scrypt$N$r$p$salt$hash -- nunca senha em claro.';

-- ----------------------------------------------------------------------------
-- Sessoes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_sessions (
  id            bigserial   PRIMARY KEY,
  -- SHA-256 do token que vai no cookie. O token em si NUNCA e persistido:
  -- assim um dump do banco nao entrega sessao utilizavel.
  token_hash    bytea       NOT NULL,
  user_id       bigint      NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ip            inet,
  user_agent    text
);

CREATE UNIQUE INDEX IF NOT EXISTS app_sessions_token_hash_key
  ON app_sessions (token_hash);
CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx
  ON app_sessions (user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
  ON app_sessions (expires_at);

COMMENT ON TABLE  app_sessions IS 'Sessoes ativas do Portal FinOps.';
COMMENT ON COLUMN app_sessions.token_hash IS 'SHA-256 do token de sessao. O token original existe apenas no cookie do navegador.';

-- ----------------------------------------------------------------------------
-- Privilegios do role da aplicacao
--
-- A aplicacao PRECISA escrever aqui (criar sessao no login, apagar no logout).
-- Isso nao afeta a barreira das tabelas financeiras: la o role continua
-- somente-leitura. Ver scripts/create-app-role.sql.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON app_users, app_sessions TO finops_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE app_users_id_seq, app_sessions_id_seq TO finops_app';
    RAISE NOTICE 'privilegios concedidos a finops_app';
  ELSE
    RAISE NOTICE 'role finops_app nao existe -- rode scripts/create-app-role.sql primeiro';
  END IF;
END $$;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== estrutura criada =='
SELECT table_name AS tabela, count(*) AS colunas
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('app_users', 'app_sessions')
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== privilegios de finops_app nas tabelas de auth =='
SELECT table_name AS tabela,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app' AND table_name IN ('app_users', 'app_sessions')
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== conferencia: tabelas financeiras seguem somente-leitura para finops_app =='
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app'
  AND table_name IN ('aws_daily_costs', 'aws_monthly_costs')
  AND privilege_type <> 'SELECT';

\echo ''
\echo '== usuarios cadastrados (esperado: 0 antes do seed) =='
SELECT count(*) AS usuarios FROM app_users;
