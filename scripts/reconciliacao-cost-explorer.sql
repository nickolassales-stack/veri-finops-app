-- ============================================================================
-- FinOps :: reconciliacao com o AWS Cost Explorer
-- ----------------------------------------------------------------------------
-- SOMENTE LEITURA. Nenhum SELECT aqui escreve, tranca ou altera qualquer coisa.
--
-- Serve para responder a pergunta que motivou a migracao 001:
--   "por que o portal mostra um numero e o Cost Explorer mostra outro?"
--
-- COMO EXECUTAR
--
--   docker exec -i finops-postgres \
--     psql -U finops_user -d finops -X --no-psqlrc \
--     -v conta=800168045394 -v periodo=2026-07 \
--     < scripts/reconciliacao-cost-explorer.sql
--
-- Sem passar as variaveis, ele usa a conta e o periodo do caso investigado em
-- 13/08/2026.
--
-- COMO COMPARAR COM A AWS
--   Cost Explorer > Monthly > filtro Linked Account = a conta > mes desejado
--   > metrica "Unblended costs". E esse numero que a consulta 2 reproduz.
-- ============================================================================

\if :{?conta}
\else
\set conta '800168045394'
\endif

\if :{?periodo}
\else
\set periodo '2026-07'
\endif

\echo ''
\echo '############################################################'
\echo '# conta:' :conta '   periodo de cobranca:' :periodo
\echo '############################################################'

-- ----------------------------------------------------------------------------
-- 1. As duas leituras, lado a lado
-- ----------------------------------------------------------------------------
-- A de cima e a que o Cost Explorer mostra. A de baixo e o que o portal mostrava
-- antes da migracao 001. A diferenca entre elas nao e erro de soma: e cobranca
-- lancada num mes com data de uso em outro.
\echo ''
\echo '== 1. financeiro (bate com o Cost Explorer) x operacional (data de uso) =='
SELECT
  'financeiro -- por periodo de cobranca' AS leitura,
  round(sum(cost_amount), 2)              AS total_usd,
  count(*)                                AS linhas
FROM aws_daily_costs
WHERE account_id = :'conta'
  AND coalesce(billing_period, to_char(usage_date, 'YYYY-MM')) = :'periodo'

UNION ALL

SELECT
  'operacional -- por mes da data de uso',
  round(sum(cost_amount), 2),
  count(*)
FROM aws_daily_costs
WHERE account_id = :'conta'
  AND to_char(usage_date, 'YYYY-MM') = :'periodo';

-- ----------------------------------------------------------------------------
-- 2. Exatamente o que explica a diferenca
-- ----------------------------------------------------------------------------
-- Toda linha cobrada no periodo cuja data de uso cai em OUTRO mes. A soma desta
-- consulta e, por definicao, a diferenca entre as duas leituras acima.
\echo ''
\echo '== 2. as linhas deslocadas: cobradas neste periodo, usadas em outro mes =='
SELECT billing_period,
       billing_month,
       usage_date,
       service,
       coalesce(nullif(region, 'nan'), '(sem regiao)') AS region,
       round(cost_amount, 2) AS custo_usd
FROM aws_daily_costs
WHERE account_id = :'conta'
  AND billing_month IS NOT NULL
  AND billing_period = :'periodo'
  AND billing_month <> date_trunc('month', usage_date::timestamp)::date
ORDER BY usage_date;

-- ----------------------------------------------------------------------------
-- 3. Fechamento aritmetico
-- ----------------------------------------------------------------------------
-- operacional + deslocado = financeiro. Se esta consulta nao devolver
-- `confere = true`, ha linha entrando ou saindo por outro motivo e a
-- investigacao NAO deve parar aqui.
\echo ''
\echo '== 3. operacional + deslocado = financeiro ? =='
WITH numeros AS (
  SELECT
    (SELECT coalesce(sum(cost_amount), 0) FROM aws_daily_costs
      WHERE account_id = :'conta'
        AND coalesce(billing_period, to_char(usage_date, 'YYYY-MM')) = :'periodo')
      AS financeiro,
    (SELECT coalesce(sum(cost_amount), 0) FROM aws_daily_costs
      WHERE account_id = :'conta'
        AND to_char(usage_date, 'YYYY-MM') = :'periodo')
      AS operacional,
    (SELECT coalesce(sum(cost_amount), 0) FROM aws_daily_costs
      WHERE account_id = :'conta'
        AND billing_month IS NOT NULL
        AND billing_period = :'periodo'
        AND billing_month <> date_trunc('month', usage_date::timestamp)::date)
      AS deslocado_para_dentro,
    (SELECT coalesce(sum(cost_amount), 0) FROM aws_daily_costs
      WHERE account_id = :'conta'
        AND billing_month IS NOT NULL
        AND to_char(usage_date, 'YYYY-MM') = :'periodo'
        AND billing_month <> date_trunc('month', usage_date::timestamp)::date)
      AS deslocado_para_fora
)
SELECT round(operacional, 2)            AS operacional,
       round(deslocado_para_dentro, 2)  AS entra,
       round(deslocado_para_fora, 2)    AS sai,
       round(financeiro, 2)             AS financeiro,
       round(operacional + deslocado_para_dentro - deslocado_para_fora, 2)
         = round(financeiro, 2)         AS confere
FROM numeros;

-- ----------------------------------------------------------------------------
-- 4. Panorama: todas as contas, todos os periodos
-- ----------------------------------------------------------------------------
\echo ''
\echo '== 4. panorama por conta e periodo de cobranca =='
SELECT coalesce(d.billing_period, to_char(d.usage_date, 'YYYY-MM')) AS periodo_cobranca,
       d.account_id,
       coalesce(a.account_name, '(nao cadastrada)') AS conta,
       round(sum(d.cost_amount), 2) AS financeiro_usd,
       count(*) FILTER (
         WHERE d.billing_month IS NOT NULL
           AND d.billing_month <> date_trunc('month', d.usage_date::timestamp)::date
       ) AS linhas_deslocadas
FROM aws_daily_costs d
LEFT JOIN cloud_accounts a ON a.account_id = d.account_id
GROUP BY 1, 2, 3
ORDER BY 1, 2;

-- ----------------------------------------------------------------------------
-- 5. Saude do backfill
-- ----------------------------------------------------------------------------
-- Linha sem `billing_month` nao esta errada: ela apenas ainda nao passou pelo
-- backfill nem por uma carga do ETL novo. Enquanto for assim, ela e tratada
-- pelo mes da data de uso -- o criterio antigo.
\echo ''
\echo '== 5. cobertura do periodo financeiro =='
SELECT count(*)                                            AS linhas,
       count(billing_month)                                AS com_periodo,
       count(*) - count(billing_month)                     AS sem_periodo,
       round(100.0 * count(billing_month) / nullif(count(*), 0), 1) AS cobertura_pct
FROM aws_daily_costs;
