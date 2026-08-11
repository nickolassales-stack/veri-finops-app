-- =============================================================================
-- PROPOSTA de indices para a tela analitica -- NAO APLICADA
-- -----------------------------------------------------------------------------
-- Este arquivo existe como registro tecnico. NAO execute agora: medicao de
-- 11/08/2026 mostra que os indices atuais ja atendem, e criar indice sem
-- necessidade custa espaco e desacelera cada INSERT do ETL.
--
-- MEDICAO QUE JUSTIFICA NAO APLICAR
--
--   aws_daily_costs: 642 linhas, 288 kB
--   EXPLAIN (ANALYZE) da query do analitico, janela de 2 meses, pagina 1:
--     Execution Time: 1.228 ms
--     Index Scan Backward using aws_daily_costs_usage_date_account_id_service_region_key
--       Index Cond: usage_date >= ... AND usage_date <= ...
--     Incremental Sort  ->  Presorted Key: d.usage_date
--
-- O indice UNIQUE que ja existe -- criado para deduplicar o upsert do ETL --
-- tem `usage_date` como PRIMEIRA coluna. Isso o torna utilizavel tanto para o
-- corte por periodo quanto para a ordenacao padrao da tela (usage_date DESC),
-- e o planner explora as duas coisas. Nao ha o que melhorar hoje.
--
-- Com filtro de conta + busca por servico o planner escolhe Seq Scan
-- (0,35 ms para 642 linhas). Para esse volume, Seq Scan e a escolha CORRETA:
-- ler 288 kB sequencialmente e mais rapido que navegar indice.
--
-- QUANDO REVISITAR
--
-- Estimativa de crescimento: ~20 servicos x ~30 dias = ~600 linhas por conta
-- por mes. Com 50 contas: ~30 mil linhas/mes, ~360 mil/ano. O Seq Scan comeca
-- a incomodar por volta de 1 milhao de linhas -- cerca de 3 anos nesse ritmo.
--
-- GATILHOS OBJETIVOS para aplicar:
--   1. aws_daily_costs passar de ~500 mil linhas, OU
--   2. o EXPLAIN da tela passar de ~200 ms, OU
--   3. a busca por servico (ILIKE) aparecer como gargalo no log
--
-- Antes de aplicar: rode o EXPLAIN de novo. O planner muda de estrategia com o
-- volume, e o indice certo depende do plano real, nao de suposicao.
-- =============================================================================

\echo 'Este script e uma PROPOSTA e nao deve ser executado sem os gatilhos.'
\echo 'Leia o cabecalho. Para aplicar de proposito, remova o \\quit abaixo.'
\quit

-- =============================================================================
-- SUBIR (aplicar)
-- =============================================================================

-- CONCURRENTLY: nao bloqueia escrita do ETL durante a criacao. Nao pode rodar
-- dentro de transacao -- por isso nao ha BEGIN/COMMIT neste arquivo.

-- (1) Consulta filtrada por conta dentro de um periodo.
--     Ordem (account_id, usage_date) e nao o inverso: o filtro de conta e por
--     igualdade e o de data por faixa, e coluna de igualdade vem primeiro.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aws_daily_costs_conta_data_idx
  ON aws_daily_costs (account_id, usage_date DESC);

-- (2) Busca por servico com ILIKE '%termo%'.
--     Indice B-tree NAO serve para curinga no inicio do padrao; trigrama serve.
--     Exige a extensao pg_trgm, que precisa de superusuario para instalar.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS aws_daily_costs_service_trgm_idx
  ON aws_daily_costs USING gin (service gin_trgm_ops);

ANALYZE aws_daily_costs;

-- =============================================================================
-- DESCER (reverter)
-- -----------------------------------------------------------------------------
-- Totalmente reversivel: derrubar indice nao toca em nenhuma linha de dado.
-- A extensao pg_trgm fica, por seguranca -- outra coisa pode ter passado a
-- depender dela. Para remover tambem: DROP EXTENSION pg_trgm;
-- =============================================================================

-- DROP INDEX CONCURRENTLY IF EXISTS aws_daily_costs_service_trgm_idx;
-- DROP INDEX CONCURRENTLY IF EXISTS aws_daily_costs_conta_data_idx;
