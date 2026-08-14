-- ============================================================================
-- FinOps :: monitoramento do ETL e frescor da carga
-- ----------------------------------------------------------------------------
-- ADITIVA E REVERSIVEL. Cria UMA tabela nova (`app_etl_runs`) e UMA view
-- (`app_data_freshness`). Nao altera nenhuma tabela existente, nao reescreve
-- dado, nao mexe em indice, constraint ou privilegio ja concedido.
--
-- Rollback: scripts/migrations/003-diagnostico-etl-rollback.sql
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/003-diagnostico-etl.sql
--
-- Idempotente: reexecutar nao duplica nada e nao apaga historico de execucao.
--
-- ----------------------------------------------------------------------------
-- ORDEM EM RELACAO AO CODIGO
--
-- Como a 002, esta migracao NAO derruba o portal se faltar. A tela de
-- diagnostico degrada: sem a tabela ela informa "monitoramento nao instalado"
-- em vez de estourar. Ainda assim rode a migracao ANTES de publicar o ETL
-- instrumentado -- sem ela o ETL registra um aviso no log a cada execucao (e
-- CARREGA NORMALMENTE; monitoramento nunca derruba o que ele monitora).
--
-- ----------------------------------------------------------------------------
-- QUEM ESCREVE, QUEM LE
--
-- Escreve: `finops_user`, que e quem roda o ETL na EC2.
-- Le:      `finops_app`, o role do portal -- com SELECT e NADA MAIS.
--
-- Essa assimetria e deliberada. Se o portal pudesse escrever aqui, "o ETL rodou"
-- passaria a ser uma afirmacao que a propria aplicacao pode fabricar, e a tela
-- de diagnostico deixaria de ser evidencia. E a mesma barreira ja aplicada as
-- tabelas de custo: quem carrega escreve, quem exibe le.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Historico de execucoes do ETL
--
-- Uma linha por execucao, aberta no inicio com status 'running' e fechada no
-- fim. Abrir a linha ANTES da carga (em vez de gravar so o resultado no final)
-- e o que torna visivel a execucao que morreu no meio: sem isso, um ETL morto
-- por OOM seria indistinguivel de um ETL que nunca comecou.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_etl_runs (
  id            bigserial   PRIMARY KEY,

  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,

  status        text        NOT NULL DEFAULT 'running',
  -- Como a execucao foi disparada. 'unknown' e o padrao honesto: uma execucao
  -- que nao se identificou nao deve ser apresentada como agendada.
  source        text        NOT NULL DEFAULT 'unknown',

  -- Linhas efetivamente lidas do Athena em cada carga. NULL enquanto roda.
  monthly_rows  integer,
  daily_rows    integer,

  -- Mensagem de erro JA SANITIZADA pelo gravador (ver scripts/etl/*.py). Nunca
  -- recebe o log inteiro nem traceback bruto: e um campo de diagnostico, e
  -- traceback carrega variavel de ambiente com frequencia.
  error_message text,

  -- Caminho do arquivo de log na EC2. O CONTEUDO do log nunca e lido pelo
  -- portal -- a API devolve o caminho e nada mais.
  log_path      text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_etl_runs_status_check
    CHECK (status IN ('running', 'success', 'failed')),

  CONSTRAINT app_etl_runs_source_check
    CHECK (source IN ('manual', 'cron', 'unknown')),

  -- Execucao em andamento nao tem fim; execucao encerrada tem. Sem isto, uma
  -- atualizacao pela metade produziria a linha "terminou mas ainda esta
  -- rodando", que a tela leria como travada para sempre.
  CONSTRAINT app_etl_runs_finished_at_check
    CHECK ((status = 'running' AND finished_at IS NULL)
           OR (status <> 'running' AND finished_at IS NOT NULL)),

  CONSTRAINT app_etl_runs_rows_check
    CHECK ((monthly_rows IS NULL OR monthly_rows >= 0)
           AND (daily_rows IS NULL OR daily_rows >= 0))
);

-- "Qual foi a ultima execucao" e "as ultimas N" sao as duas unicas leituras
-- quentes da tabela, e as duas partem daqui.
CREATE INDEX IF NOT EXISTS app_etl_runs_started_at_idx
  ON app_etl_runs (started_at DESC);

-- Indice parcial para achar execucao orfa (aberta e nunca fechada). Fica
-- minusculo: em operacao normal ha no maximo uma linha 'running'.
CREATE INDEX IF NOT EXISTS app_etl_runs_running_idx
  ON app_etl_runs (started_at) WHERE status = 'running';

COMMENT ON TABLE  app_etl_runs IS
  'Historico de execucoes do ETL Athena->PostgreSQL. Escrito pelo ETL (finops_user), somente lido pelo portal (finops_app).';
COMMENT ON COLUMN app_etl_runs.status IS
  'running enquanto executa; success ou failed ao encerrar. running antigo = execucao interrompida.';
COMMENT ON COLUMN app_etl_runs.error_message IS
  'Mensagem curta e sanitizada. Nunca traceback bruto: traceback vaza variavel de ambiente.';
COMMENT ON COLUMN app_etl_runs.log_path IS
  'Caminho do log na EC2. O portal exibe o caminho; jamais le o conteudo.';

-- ----------------------------------------------------------------------------
-- 2. Frescor do dado, por conta
--
-- VIEW e nao tabela: os numeros ja existem nas tabelas de custo, e materializar
-- criaria uma segunda verdade que envelhece. O volume torna isso barato
-- (centenas de linhas hoje, ~2 mil ao ano).
--
-- `security_invoker = true` (PG 15+): a view roda com o privilegio de QUEM
-- CONSULTA, nao com o do dono. Sem isso ela seria um caminho lateral de leitura
-- das tabelas de custo para qualquer role que ganhasse SELECT nela.
--
-- SOBRE `created_at`: as tabelas de custo usam `timestamp without time zone`
-- com DEFAULT now(), e o banco esta em Etc/UTC -- ou seja, guardam hora UTC sem
-- dizer isso. `AT TIME ZONE 'UTC'` transforma essa hora "solta" no instante
-- correto. Sem essa conversao, a hora apareceria 3 horas adiantada na tela, e um
-- dado carregado ha 10 minutos poderia parecer vindo do futuro.
--
-- E SOBRE O QUE `created_at` NAO E: a carga e um ON CONFLICT ... DO UPDATE, que
-- NAO toca em created_at. Entao o maximo dessa coluna e o instante em que a
-- linha MAIS NOVA foi inserida pela primeira vez -- nao "quando o ETL rodou".
-- Uma conta cujo custo so foi reajustado hoje, sem dia novo, mantem o carimbo
-- antigo, e isso esta correto: nao entrou dado novo. Quando o ETL rodou e
-- pergunta de `app_etl_runs`, e a coluna se chama `linha_mais_nova_em`
-- justamente para as duas perguntas nao se confundirem numa tela de auditoria.
--
-- DROP + CREATE em vez de CREATE OR REPLACE: a versao anterior desta view
-- chamava essa coluna de `ultima_carga`, e o REPLACE nao permite renomear
-- coluna. Recriar uma view nao custa nada -- ela nao guarda dado.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS app_data_freshness;

CREATE VIEW app_data_freshness
WITH (security_invoker = true) AS
WITH diario AS (
  SELECT
    account_id,
    max(usage_date)                        AS ultima_usage_date,
    min(usage_date)                        AS primeira_usage_date,
    count(*)                               AS linhas_diarias,
    max(created_at AT TIME ZONE 'UTC')     AS linha_mais_nova_diaria
  FROM aws_daily_costs
  GROUP BY account_id
),
mensal AS (
  SELECT
    account_id,
    -- coalesce com `month` cobre linha anterior a migracao 001, que nao tem
    -- billing_month preenchido.
    max(coalesce(billing_month, month))              AS ultimo_billing_month,
    min(coalesce(billing_month, month))              AS primeiro_billing_month,
    count(*)                                         AS linhas_mensais,
    count(DISTINCT coalesce(billing_month, month))   AS meses_disponiveis,
    max(created_at AT TIME ZONE 'UTC')               AS linha_mais_nova_mensal
  FROM aws_monthly_costs
  GROUP BY account_id
)
-- FULL JOIN: conta pode existir so no diario (mes ainda nao fechado) ou so no
-- mensal (cobranca pontual sem linha diaria). Um INNER esconderia justamente a
-- conta com carga incompleta, que e a que o diagnostico precisa mostrar.
SELECT
  coalesce(d.account_id, m.account_id)               AS account_id,
  d.ultima_usage_date,
  d.primeira_usage_date,
  m.ultimo_billing_month,
  m.primeiro_billing_month,
  coalesce(d.linhas_diarias, 0)                      AS linhas_diarias,
  coalesce(m.linhas_mensais, 0)                      AS linhas_mensais,
  coalesce(d.linhas_diarias, 0) + coalesce(m.linhas_mensais, 0) AS total_linhas,
  coalesce(m.meses_disponiveis, 0)                   AS meses_disponiveis,
  greatest(d.linha_mais_nova_diaria, m.linha_mais_nova_mensal) AS linha_mais_nova_em
FROM diario d
FULL JOIN mensal m ON m.account_id = d.account_id;

COMMENT ON VIEW app_data_freshness IS
  'Frescor da carga por conta AWS: ultima data de uso, ultimo mes de cobranca, volume e quando entrou a linha mais nova. Sem alias -- o nome de exibicao e resolvido pela aplicacao.';

-- ----------------------------------------------------------------------------
-- 3. Privilegios
--
-- SELECT e so isso. O portal LE o historico de execucao; nao pode criar,
-- alterar nem apagar linha -- ver o cabecalho deste arquivo.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
    EXECUTE 'GRANT SELECT ON app_etl_runs, app_data_freshness TO finops_app';
    RAISE NOTICE 'SELECT concedido a finops_app em app_etl_runs e app_data_freshness';
  ELSE
    RAISE NOTICE 'role finops_app nao existe -- rode scripts/create-app-role.sql primeiro';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verificacao
-- ============================================================================
\echo ''
\echo '== objetos criados =='
SELECT c.relname AS objeto,
       CASE c.relkind WHEN 'r' THEN 'tabela' WHEN 'v' THEN 'view' END AS tipo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('app_etl_runs', 'app_data_freshness')
ORDER BY 1;

\echo ''
\echo '== frescor por conta (estado atual) =='
SELECT account_id, ultima_usage_date, ultimo_billing_month,
       linhas_diarias, linhas_mensais, meses_disponiveis, linha_mais_nova_em
FROM app_data_freshness
ORDER BY account_id;

\echo ''
\echo '== execucoes registradas =='
SELECT count(*) AS execucoes FROM app_etl_runs;

\echo ''
\echo '== conferencia: o portal so LE o historico de execucao =='
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app'
  AND table_name IN ('app_etl_runs', 'app_data_freshness')
ORDER BY 1, 2;

\echo ''
\echo '== conferencia: tabelas de custo seguem somente-leitura para finops_app =='
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'finops_app'
  AND table_name IN ('aws_daily_costs', 'aws_monthly_costs')
  AND privilege_type <> 'SELECT';

\echo ''
\echo '== proximo passo: publicar o ETL instrumentado (scripts/etl/athena_to_postgres.py) =='
