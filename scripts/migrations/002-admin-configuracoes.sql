-- ============================================================================
-- FinOps :: area administrativa -- metadados de conta, grupos e permissoes
-- ----------------------------------------------------------------------------
-- ADITIVA E REVERSIVEL. Cria quatro tabelas novas com o prefixo `app_` e nao
-- toca em NENHUMA tabela existente: cloud_accounts, aws_daily_costs,
-- aws_monthly_costs, cloud_budgets, cost_alerts e app_users seguem exatamente
-- como estao. Nenhuma coluna alterada, nenhum dado reescrito.
--
-- Rollback: scripts/migrations/002-admin-configuracoes-rollback.sql
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/002-admin-configuracoes.sql
--
-- Idempotente: reexecutar nao duplica grupo nem permissao.
--
-- ----------------------------------------------------------------------------
-- ORDEM EM RELACAO AO CODIGO
--
-- Ao contrario da migracao 001, esta NAO derruba o portal se faltar: as telas
-- novas sao o unico consumidor das tabelas novas, e o alias de conta usa
-- LEFT JOIN com COALESCE -- sem a tabela, o nome cai no `account_name` de
-- sempre. Ainda assim, rode a migracao ANTES de subir o codigo: a alternativa
-- e a area de configuracoes responder erro ate alguem perceber.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Metadados de conta mantidos PELA APLICACAO
--
-- Por que tabela propria, e nao colunas novas em `cloud_accounts`:
-- `cloud_accounts` e cadastro de origem, mantido fora daqui. Escrever nele
-- misturaria o que o portal sabe com o que o cadastro afirma, e uma recarga do
-- cadastro apagaria o alias sem aviso. Separado, o alias sobrevive a qualquer
-- reescrita da origem -- e o LEFT JOIN deixa claro quem manda quando os dois
-- discordam: o alias.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_account_settings (
  id                        bigserial   PRIMARY KEY,
  account_id                varchar(20) NOT NULL,
  -- NULL = "sem alias definido". A tela nunca grava string vazia; o COALESCE
  -- do alias trata '' como ausente de qualquer forma, por seguranca.
  alias                     text,
  business_unit             text,
  cost_center               text,
  environment               text,
  -- Dia de fechamento da fatura (1..31). Nao ha validacao de mes curto aqui:
  -- 31 em fevereiro e problema de quem interpreta, nao do armazenamento.
  invoice_close_day         smallint,
  payment_status            text,
  payment_status_updated_at timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_account_settings_account_fk
    FOREIGN KEY (account_id) REFERENCES cloud_accounts (account_id) ON DELETE CASCADE,

  CONSTRAINT app_account_settings_invoice_close_day_check
    CHECK (invoice_close_day IS NULL OR invoice_close_day BETWEEN 1 AND 31),

  CONSTRAINT app_account_settings_payment_status_check
    CHECK (payment_status IS NULL
           OR payment_status IN ('em_dia', 'pendente', 'atrasado', 'isento'))
);

-- Uma linha de configuracao por conta. E o alvo do ON CONFLICT do PATCH.
CREATE UNIQUE INDEX IF NOT EXISTS app_account_settings_account_id_key
  ON app_account_settings (account_id);

COMMENT ON TABLE  app_account_settings IS
  'Metadados de conta AWS mantidos pelo portal. Nao substitui cloud_accounts: complementa.';
COMMENT ON COLUMN app_account_settings.alias IS
  'Nome amigavel. Tem precedencia sobre cloud_accounts.account_name em toda a aplicacao.';

-- ----------------------------------------------------------------------------
-- 2. Grupos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_groups (
  id          bigserial   PRIMARY KEY,
  name        text        NOT NULL,
  description text,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Nome unico ignorando caixa e espaco nas pontas, pelo mesmo motivo do e-mail
-- em app_users: "Financeiro" e "financeiro " sao o mesmo grupo para quem le.
CREATE UNIQUE INDEX IF NOT EXISTS app_groups_name_lower_key
  ON app_groups (lower(btrim(name)));

COMMENT ON TABLE app_groups IS 'Grupos do Portal FinOps. Concedem permissao; nao substituem o papel do usuario.';

-- ----------------------------------------------------------------------------
-- 3. Vinculo usuario <-> grupo
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_groups (
  user_id    bigint      NOT NULL REFERENCES app_users (id)  ON DELETE CASCADE,
  group_id   bigint      NOT NULL REFERENCES app_groups (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);

-- A consulta quente e "quais permissoes tem este usuario", que parte do
-- usuario. O indice por grupo serve ao caminho inverso, na tela de grupos.
CREATE INDEX IF NOT EXISTS app_user_groups_group_id_idx
  ON app_user_groups (group_id);

COMMENT ON TABLE app_user_groups IS 'Quais grupos cada usuario integra.';

-- ----------------------------------------------------------------------------
-- 4. Permissoes concedidas a cada grupo
--
-- `permission` e texto livre no banco de proposito. O catalogo autoritativo
-- vive em web/src/lib/auth/permissoes.ts, porque uma permissao so significa
-- alguma coisa se ALGUMA ROTA a verifica -- quem define o conjunto e o codigo.
-- Um CHECK com a lista aqui obrigaria migracao a cada permissao nova e criaria
-- duas fontes de verdade que sairiam de sincronia. A entrada e validada por Zod
-- contra o catalogo antes de chegar ao banco, e permissao desconhecida que
-- porventura exista na tabela e simplesmente ignorada na leitura.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_group_permissions (
  group_id   bigint      NOT NULL REFERENCES app_groups (id) ON DELETE CASCADE,
  permission text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, permission)
);

COMMENT ON TABLE app_group_permissions IS
  'Permissoes por grupo. Catalogo autoritativo em web/src/lib/auth/permissoes.ts.';

-- ----------------------------------------------------------------------------
-- 5. Grupos padrao
--
-- Criados apenas se ainda nao existirem. Reexecutar a migracao nao duplica nem
-- reescreve descricao que alguem tenha ajustado pela tela.
-- ----------------------------------------------------------------------------
INSERT INTO app_groups (name, description)
VALUES
  ('Administradores', 'Acesso total, incluindo configuracoes, usuarios e grupos.'),
  ('Visualizadores',  'Leitura da visao executiva e do analitico.'),
  ('Financeiro',      'Leitura, exportacao e acompanhamento de faturamento.'),
  ('Tecnologia',      'Leitura, exportacao e diagnostico tecnico.')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. Permissoes iniciais dos grupos padrao
--
-- Ponto de partida, nao regra fixa: tudo isso e editavel em
-- /dashboard/configuracoes/permissoes. So concede a quem ainda nao tem.
-- ----------------------------------------------------------------------------
WITH concessoes (grupo, permissao) AS (
  VALUES
    ('Administradores', 'dashboard:view'),
    ('Administradores', 'analytic:view'),
    ('Administradores', 'analytic:export'),
    ('Administradores', 'settings:view'),
    ('Administradores', 'settings:accounts'),
    ('Administradores', 'settings:users'),
    ('Administradores', 'settings:groups'),
    ('Administradores', 'diagnostics:view'),
    ('Administradores', 'billing:view'),
    ('Administradores', 'billing:manage'),

    ('Visualizadores',  'dashboard:view'),
    ('Visualizadores',  'analytic:view'),

    ('Financeiro',      'dashboard:view'),
    ('Financeiro',      'analytic:view'),
    ('Financeiro',      'analytic:export'),
    ('Financeiro',      'billing:view'),

    ('Tecnologia',      'dashboard:view'),
    ('Tecnologia',      'analytic:view'),
    ('Tecnologia',      'analytic:export'),
    ('Tecnologia',      'diagnostics:view')
)
INSERT INTO app_group_permissions (group_id, permission)
SELECT g.id, c.permissao
  FROM concessoes c
  JOIN app_groups g ON lower(btrim(g.name)) = lower(c.grupo)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. Privilegios do role da aplicacao
--
-- A area administrativa escreve nestas quatro tabelas. Isso NAO afeta a
-- barreira das tabelas financeiras: aws_daily_costs e aws_monthly_costs
-- continuam SELECT-only para finops_app.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON
               app_account_settings, app_groups, app_user_groups, app_group_permissions
             TO finops_app';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE
               app_account_settings_id_seq, app_groups_id_seq
             TO finops_app';
    RAISE NOTICE 'privilegios concedidos a finops_app';
  ELSE
    RAISE NOTICE 'role finops_app nao existe -- rode scripts/create-app-role.sql primeiro';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== tabelas criadas =='
SELECT table_name AS tabela, count(*) AS colunas
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('app_account_settings', 'app_groups',
                     'app_user_groups', 'app_group_permissions')
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== grupos padrao e suas permissoes =='
SELECT g.name AS grupo,
       g.active AS ativo,
       count(p.permission) AS permissoes
FROM app_groups g
LEFT JOIN app_group_permissions p ON p.group_id = g.id
GROUP BY g.id, g.name, g.active
ORDER BY g.name;

\echo ''
\echo '== conferencia: nenhuma tabela existente foi tocada =='
SELECT 'cloud_accounts'  AS tabela, count(*) AS linhas FROM cloud_accounts
UNION ALL SELECT 'app_users',        count(*) FROM app_users
UNION ALL SELECT 'aws_daily_costs',  count(*) FROM aws_daily_costs;

\echo ''
\echo '== conferencia: tabelas financeiras seguem somente-leitura para finops_app =='
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app'
  AND table_name IN ('aws_daily_costs', 'aws_monthly_costs')
  AND privilege_type <> 'SELECT';

\echo ''
\echo '== proximo passo: subir o codigo da area administrativa =='
