# Onboarding de nova conta AWS no pipeline FinOps

Como levar uma conta AWS nova de "existe na organizacao" ate "aparece no
dashboard com alias e custo".

Pre-requisito que nao esta nesta maquina: **o Data Export da conta precisa ter
entregado arquivos no S3.** Ate isso acontecer nao ha o que fazer aqui -- o DDL da
tabela e gerado pela propria AWS e vem junto da entrega.

---

## Como o pipeline esta montado

```
 conta AWS
    │ Data Export (CUR 2.0), configurado no console de billing
    v
 s3://finops-aws-cost-datalake-800168045394
    /raw/aws/cur/account_id=<ID>/<export_name>/
        data/BILLING_PERIOD=AAAA-MM/*.snappy.parquet      <- o dado
        metadata/BILLING_PERIOD=AAAA-MM/*-create-table.sql <- o DDL, da AWS
    │
    │ uma tabela Athena POR CONTA, em um database por conta
    v
 finops_cur2_<ID>.finops_cur2_<ID>       (particionada por billing_period)
    │
    │ UNION ALL de todas as contas
    v
 finops.cur_raw                          <- a view que o ETL le
    │
    │ ETL Python (cron 08:00 UTC), Athena -> PostgreSQL
    v
 aws_daily_costs / aws_monthly_costs      <- o que portal e Metabase consomem
```

Duas propriedades que valem entender antes de mexer:

**A view e o unico ponto compartilhado.** Um erro nela atinge todas as contas ao
mesmo tempo, nao so a nova: o ETL para e o dashboard congela no ultimo dado
carregado. Por isso o script nunca altera a view sozinho.

**O ETL nao cadastra contas.** Ele grava custo em `aws_daily_costs` sem exigir
cadastro -- nao ha chave estrangeira. A aplicacao faz `LEFT JOIN cloud_accounts`,
entao uma conta com custo e sem cadastro **aparece no dashboard sem alias**,
identificada apenas pelo numero. Cadastrar e passo separado, e obrigatorio.

---

## Passo a passo

### 1. Conferir se a conta ja entregou

```bash
cd /opt/finops
./scripts/onboard-cur-account.sh <ACCOUNT_ID> --somente-validar
```

O modo `--somente-validar` nao cria nada: confere S3, lista os billing periods e
baixa o DDL. Codigo de saida:

| Codigo | Significado |
|---|---|
| 0 | pronto para o passo 2 |
| 2 | **ainda nao entregou** -- aguardar. O script explica o que conferir |
| 3 | ha objetos em `data/` mas sem particao `BILLING_PERIOD=AAAA-MM` |
| 4 | sem `create-table.sql` em `metadata/`, em nenhum periodo |
| 64 | `account_id` invalido (precisa ter 12 digitos) |

Se der 2, um sinal util: um `aws-programmatic-access-test-object` recente na raiz
do bucket significa que a AWS validou a escrita -- o export existe e a permissao
esta certa, falta so a primeira entrega, que leva ate ~24 h.

Se o export tiver outro nome:

```bash
./scripts/onboard-cur-account.sh <ACCOUNT_ID> --export-name <nome_real>
```

### 2. Criar database, tabela e particoes

```bash
./scripts/onboard-cur-account.sh <ACCOUNT_ID>
```

Faz, em ordem, parando no primeiro erro com o motivo real da AWS:

1. valida o S3;
2. descobre **todos** os billing periods (nao so o mes atual);
3. baixa o `create-table.sql` do periodo mais recente que o tenha;
4. cria o database, se nao existir;
5. cria a tabela com o DDL da AWS -- se a tabela ja existe, **nao** reexecuta;
6. adiciona uma particao por billing period;
7. roda uma contagem real por periodo, para provar que le;
8. compara o schema com a conta piloto (secao "Divergencia de schema", abaixo);
9. **imprime** o SQL sugerido da view, sem executar.

Tudo aditivo e idempotente: rodar duas vezes na mesma conta nao causa dano.

### 3. Aplicar a view -- decisao humana

O script grava a sugestao em
`/opt/finops/recreate_cur_raw_view.sugerido.sql`, montada apenas com databases e
tabelas **confirmados no Glue naquele momento**. Leia o arquivo. Depois:

```bash
aws athena start-query-execution --region us-east-2 \
  --query-string file:///opt/finops/recreate_cur_raw_view.sugerido.sql \
  --result-configuration OutputLocation=s3://finops-aws-cost-datalake-800168045394/athena-results/
```

Acompanhe com `aws athena get-query-execution --query-execution-id <ID>`.

`CREATE OR REPLACE VIEW` e reversivel: para voltar, reexecute a versao anterior.
Guarde a anterior antes de trocar:

```bash
cp /opt/finops/recreate_cur_raw_view.sql \
   /opt/finops/backups/recreate_cur_raw_view-$(date +%F-%H%M).sql
```

### 4. Cadastrar a conta no PostgreSQL

Sem isso a conta aparece no dashboard como numero, sem alias.

```bash
docker exec -i finops-postgres psql -U finops_user -d finops <<'SQL'
INSERT INTO cloud_accounts
  (account_id, account_name, provider, owner, business_unit, cost_center, environment, active)
VALUES
  ('<ACCOUNT_ID>', '<ALIAS>', 'aws', 'infra', 'ti', 'TI', 'prod', true)
ON CONFLICT (account_id) DO UPDATE SET
  account_name  = EXCLUDED.account_name,
  owner         = EXCLUDED.owner,
  business_unit = EXCLUDED.business_unit,
  cost_center   = EXCLUDED.cost_center,
  environment   = EXCLUDED.environment,
  active        = EXCLUDED.active,
  updated_at    = now();
SQL
```

Alias, unidade de negocio e centro de custo tambem podem ser editados depois pela
tela **Configuracoes -> Contas**, que e o caminho normal. O SQL acima serve para
o cadastro inicial em lote.

Dia de fechamento de fatura e situacao de pagamento ficam em
`app_account_settings` e sao editados em **Faturamento** -- nao neste INSERT. A
tabela tem chave estrangeira para `cloud_accounts`, entao a conta precisa existir
aqui primeiro.

### 5. Rodar o ETL

```bash
/opt/finops/run-etl-with-status.sh manual
```

O `manual` registra a origem em `app_etl_runs`, o que separa esta execucao das do
cron na tela de Diagnostico. E idempotente (`ON CONFLICT DO UPDATE`): rodar de
novo nao duplica linha.

### 6. Validar

```bash
docker exec -i finops-postgres psql -U finops_user -d finops <<'SQL'
SELECT account_id, MIN(usage_date) AS primeira, MAX(usage_date) AS ultima,
       COUNT(*) AS linhas, ROUND(SUM(cost_amount), 2) AS total
  FROM aws_daily_costs GROUP BY account_id ORDER BY account_id;
SQL
```

E no portal (https://finops.nexeeo.com):

- **Diagnostico** -- a conta nova aparece na tabela de frescor, com data e linhas;
- filtro de contas do dashboard lista a conta, com o alias certo;
- o total do dashboard cresceu de acordo;
- **Analitico -> Custos** filtra pela conta nova;
- exportacao CSV/XLSX inclui a conta;
- **Faturamento** lista a conta (a lista vem de `cloud_accounts`).

---

## Divergencia de schema: o risco que nao avisa

A view usa `SELECT * ... UNION ALL`, o que exige **mesma quantidade, ordem e tipo
de colunas** em todas as tabelas. Se o export de uma conta nova vier com versao
diferente do CUR 2.0, dois desfechos, ambos ruins:

- contagem diferente de colunas -> a view **falha**, e com ela o ETL e o
  dashboard de **todas** as contas;
- mesma contagem em ordem diferente -> a view e criada e **embaralha colunas**.
  Custo vira regiao, data vira servico. Nao ha erro; ha numero errado.

O passo 8 do script compara coluna por coluna com a conta piloto e mostra o
`diff` quando divergem. Se divergir, a view precisa **listar as colunas
explicitamente**, na mesma ordem, em vez de `SELECT *` -- e ai vale abrir uma
tarefa em vez de improvisar no terminal.

---

## Se algo falhar

| Sintoma | Causa provavel | O que fazer |
|---|---|---|
| script sai com 2 | export nao entregou | aguardar ate ~24 h; conferir destino e nome do export no console |
| `data/` cheio, saida 3 | export sem particao por billing period | conferir a configuracao do export (deve ser CUR 2.0 particionado) |
| tabela criada, contagem 0 | `LOCATION` da particao errado | `aws glue get-partitions` e comparar com o caminho real no S3 |
| view falha ao criar | schema divergente | secao acima; listar colunas explicitamente |
| ETL falha depois da view | view invalida ou tabela sem particao | tela de **Diagnostico** mostra a mensagem sanitizada; `app_etl_runs` guarda o historico |
| conta no dashboard sem nome | falta o passo 4 | rodar o INSERT em `cloud_accounts` |
| conta nao aparece de jeito nenhum | view nao atualizada, ou ETL nao rodou depois | conferir `finops.cur_raw` e rodar o ETL |

Rollback, em ordem de reversibilidade:

1. **view** -- reexecutar a versao anterior (`backups/`). Reversivel, imediato;
2. **cadastro** -- `UPDATE cloud_accounts SET active = false WHERE account_id = '<ID>'`.
   Nao apague: `app_account_settings` tem FK com `ON DELETE CASCADE`, e apagar a
   conta leva o dia de fechamento e o historico de pagamento com ela;
3. **tabela/database/particoes no Glue** -- podem ficar. Nao custam nada e nao
   afetam ninguem enquanto estiverem fora da view;
4. **dados no PostgreSQL** -- so remova com dump previo. O ETL recarrega o que
   estiver na view, mas o que voce apagar de um periodo que saiu do S3 nao volta.

Nunca apague arquivo no S3 nem tabela no Glue como parte de um rollback de
onboarding. Nada no procedimento exige isso, e o CUR de um periodo fechado nao e
regenerado pela AWS.
