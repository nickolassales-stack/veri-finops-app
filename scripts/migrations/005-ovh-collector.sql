-- ============================================================================
-- FinOps :: tabelas do provedor OVHcloud
-- ----------------------------------------------------------------------------
-- ADITIVA E REVERSIVEL. Cria SEIS tabelas novas, todas com prefixo `ovh_`.
-- Nao altera nenhuma tabela existente, nao toca em `aws_daily_costs`,
-- `aws_monthly_costs`, `cloud_accounts` nem em qualquer objeto do pipeline AWS.
--
-- Rollback: scripts/migrations/005-ovh-collector-rollback.sql
--
-- ----------------------------------------------------------------------------
-- COMO EXECUTAR (na EC2 FinOps)
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
--     < scripts/migrations/005-ovh-collector.sql
--
-- Idempotente: reexecutar nao duplica nada e nao apaga dado coletado.
--
-- ----------------------------------------------------------------------------
-- POR QUE TABELAS SEPARADAS, E NAO UM SCHEMA GENERICO
--
-- A alternativa seria migrar `aws_*` para um `cloud_costs` unico com coluna
-- `provider`. Foi descartada: mexeria no pipeline que hoje sustenta o dashboard
-- em producao, para acomodar um provedor que ainda nao entregou o primeiro dado.
--
-- Tabelas `ovh_*` proprias isolam o risco -- se a coleta OVH estiver errada, o
-- custo AWS nao muda uma linha. A unificacao vem depois, por VIEW, quando o
-- formato real da OVH for conhecido. VIEW porque e reversivel: um `DROP VIEW`
-- desfaz, enquanto uma tabela migrada exige restore.
--
-- ----------------------------------------------------------------------------
-- QUEM ESCREVE, QUEM LE
--
-- Escreve: o collector (`ovh_to_postgres.py`), com o papel `finops_user`.
-- Le: o portal, com `finops_app`, que recebe apenas SELECT no fim deste arquivo.
-- O portal nunca grava custo, e nunca fala com a API da OVH -- mesma decisao ja
-- registrada para a AWS em docs/AWS-INVOICING.md.
--
-- NENHUM SEGREDO ENTRA AQUI. As chaves da OVH ficam no `.env` (modo 600) da EC2.
-- O banco guarda o que a API DEVOLVEU, nunca o que foi usado para autenticar --
-- e o collector remove `pdfUrl` antes de gravar, porque essa URL embute um token
-- que baixa a fatura sem autenticacao.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. contas
-- Uma linha por conta OVH (nichandle). `provider_account_id` e o identificador
-- que a conta tem DENTRO do VERI FinOps -- deliberadamente nosso, nao da OVH:
-- o nichandle muda de formato entre regioes e nao serve como chave estavel.
CREATE TABLE IF NOT EXISTS ovh_provider_accounts (
    provider_account_id text        PRIMARY KEY,
    nichandle           text,
    endpoint            text        NOT NULL,
    account_alias       text,
    currency            text,
    country             text,
    state               text,
    raw_json            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    -- Mesma lista aceita pela biblioteca oficial. eu/ca/us sao contas SEPARADAS
    -- na OVH: gravar a regiao errada faz o proximo operador procurar a conta no
    -- console errado.
    CONSTRAINT ovh_provider_accounts_endpoint_check
        CHECK (endpoint IN ('ovh-eu', 'ovh-ca', 'ovh-us'))
);

COMMENT ON TABLE ovh_provider_accounts IS
  'Contas OVHcloud. provider_account_id casa com cloud_accounts.account_id '
  '(que ja tem coluna provider). Sem chave estrangeira DE PROPOSITO: o '
  'collector nao pode falhar porque alguem esqueceu de cadastrar a conta na '
  'tela; a consulta de validacao 5 do docs/ovh-finops.md aponta as que faltam.';

-- ------------------------------------------------------------- 2. projetos
CREATE TABLE IF NOT EXISTS ovh_projects (
    provider_account_id text        NOT NULL
        REFERENCES ovh_provider_accounts(provider_account_id) ON DELETE CASCADE,
    service_name        text        NOT NULL,
    description         text,
    status              text,
    plan_code           text,
    raw_json            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, service_name)
);

COMMENT ON TABLE ovh_projects IS
  'Projetos Public Cloud. service_name e o id opaco da OVH; description e o '
  'nome que a pessoa deu, e pode mudar sem aviso -- nunca use description como '
  'chave.';

-- --------------------------------------------------------------- 3. custos
-- A tabela que o dashboard vai ler.
CREATE TABLE IF NOT EXISTS ovh_monthly_costs (
    id                   bigserial   PRIMARY KEY,
    provider_account_id  text        NOT NULL
        REFERENCES ovh_provider_accounts(provider_account_id) ON DELETE CASCADE,

    -- NOT NULL com '' em vez de NULL, e isto NAO e detalhe de estilo:
    -- em indice UNIQUE do PostgreSQL, NULL nunca e igual a NULL. Com estas
    -- colunas nulas, cada execucao do collector inseriria uma linha NOVA em vez
    -- de atualizar a existente, e o custo dobraria a cada dia sem erro nenhum.
    -- '' significa "nao se aplica": custo de fatura que nao pertence a projeto.
    project_service_name text        NOT NULL DEFAULT '',
    category             text        NOT NULL DEFAULT '',

    billing_month        date        NOT NULL,
    service_label        text        NOT NULL,
    amount               numeric(18,6) NOT NULL,
    currency             text        NOT NULL DEFAULT 'EUR',

    -- De onde veio o numero. Separa o que a empresa PAGOU do que ela CONSUMIU
    -- ate agora, e do que a OVH ACHA que vai pagar. Somar os tres na mesma
    -- coluna produz relatorio que ninguem confia.
    source               text        NOT NULL,

    raw_reference        text,
    raw_json             jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ovh_monthly_costs_source_check
        CHECK (source IN ('invoice', 'usage_current', 'usage_forecast')),
    CONSTRAINT ovh_monthly_costs_month_check
        CHECK (billing_month = date_trunc('month', billing_month)::date),
    CONSTRAINT ovh_monthly_costs_amount_check
        CHECK (amount >= 0),

    -- A chave do upsert. `source` participa de proposito: o mesmo projeto no
    -- mesmo mes tem legitimamente um valor de uso corrente E um de previsao.
    CONSTRAINT ovh_monthly_costs_chave UNIQUE
        (provider_account_id, project_service_name, billing_month,
         service_label, category, source)
);

CREATE INDEX IF NOT EXISTS ovh_monthly_costs_mes_idx
    ON ovh_monthly_costs (billing_month DESC, provider_account_id);
CREATE INDEX IF NOT EXISTS ovh_monthly_costs_origem_idx
    ON ovh_monthly_costs (source, billing_month DESC);

COMMENT ON TABLE ovh_monthly_costs IS
  'Custo OVH por mes. Tres origens em source: invoice (financeiro, fechado), '
  'usage_current (operacional, mes em andamento) e usage_forecast (estimativa '
  'da OVH). SEMPRE filtre por source ao somar -- sem filtro o total conta o '
  'mesmo consumo tres vezes.';
COMMENT ON COLUMN ovh_monthly_costs.source IS
  'invoice = a empresa pagou. usage_current = consumo do mes corrente, muda ao '
  'longo do dia, nao concilia com fatura. usage_forecast = projecao da OVH, '
  'NUNCA e custo realizado.';
COMMENT ON COLUMN ovh_monthly_costs.raw_reference IS
  'Identificador na origem: billId para invoice, serviceName para usage. '
  'Permite voltar da linha do banco ate a resposta original da API.';

-- ------------------------------------------------------------- 4. faturas
CREATE TABLE IF NOT EXISTS ovh_invoice_headers (
    provider_account_id text        NOT NULL
        REFERENCES ovh_provider_accounts(provider_account_id) ON DELETE CASCADE,
    bill_id             text        NOT NULL,
    bill_date           date,
    billing_month       date,
    total_with_tax      numeric(18,6),
    total_without_tax   numeric(18,6),
    tax                 numeric(18,6),
    currency            text,
    -- pdfUrl NAO tem coluna aqui, de proposito: a URL embute um token que baixa
    -- a fatura sem autenticar. Guardar isso no banco seria distribuir um
    -- segredo para todo mundo que tem SELECT.
    raw_json            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_account_id, bill_id)
);

CREATE TABLE IF NOT EXISTS ovh_invoice_lines (
    id                  bigserial   PRIMARY KEY,
    provider_account_id text        NOT NULL,
    bill_id             text        NOT NULL,
    detail_id           text        NOT NULL,
    description         text,
    quantity            numeric(18,6),
    unit_price          numeric(18,6),
    total_price         numeric(18,6),
    currency            text,
    period_start        date,
    period_end          date,
    service_name        text,
    raw_json            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ovh_invoice_lines_chave UNIQUE
        (provider_account_id, bill_id, detail_id),
    CONSTRAINT ovh_invoice_lines_fatura_fk
        FOREIGN KEY (provider_account_id, bill_id)
        REFERENCES ovh_invoice_headers(provider_account_id, bill_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ovh_invoice_lines_fatura_idx
    ON ovh_invoice_lines (provider_account_id, bill_id);

-- ------------------------------------------------------------ 5. execucoes
-- Mesma forma de `app_etl_runs`, de proposito: quem ja sabe ler o monitoramento
-- do ETL AWS le este sem aprender nada novo.
CREATE TABLE IF NOT EXISTS ovh_sync_runs (
    id             bigserial   PRIMARY KEY,
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    status         text        NOT NULL,
    source         text        NOT NULL DEFAULT 'unknown',
    accounts_rows  integer     NOT NULL DEFAULT 0,
    projects_rows  integer     NOT NULL DEFAULT 0,
    cost_rows      integer     NOT NULL DEFAULT 0,
    invoice_rows   integer     NOT NULL DEFAULT 0,
    error_message  text,
    log_path       text,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ovh_sync_runs_status_check
        CHECK (status IN ('running', 'success', 'failed')),
    CONSTRAINT ovh_sync_runs_source_check
        CHECK (source IN ('manual', 'cron', 'unknown')),
    -- Uma execucao em andamento nao tem fim; uma encerrada obrigatoriamente tem.
    -- Sem isso, um processo morto fica "running" para sempre e a tela mente.
    CONSTRAINT ovh_sync_runs_coerencia_check
        CHECK ((status = 'running'  AND finished_at IS NULL)
            OR (status <> 'running' AND finished_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ovh_sync_runs_inicio_idx
    ON ovh_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS ovh_sync_runs_execucao_idx
    ON ovh_sync_runs (started_at DESC) WHERE status = 'running';

COMMENT ON TABLE ovh_sync_runs IS
  'Historico de execucoes do collector OVH. Espelha app_etl_runs. Este dado NAO '
  'e regeneravel: perde-lo apaga a memoria de quando a coleta falhou.';

-- ----------------------------------------------------------------- leitura
-- SELECT apenas. O portal nunca escreve custo, entao nao pode forjar um.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finops_app') THEN
        EXECUTE 'GRANT SELECT ON ovh_provider_accounts, ovh_projects, '
                'ovh_monthly_costs, ovh_invoice_headers, ovh_invoice_lines, '
                'ovh_sync_runs TO finops_app';
    END IF;
END
$$;

COMMIT;
