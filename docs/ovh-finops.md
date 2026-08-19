# OVHcloud no VERI FinOps

Segundo provedor de nuvem. Coleta pela API da OVH e grava nas tabelas `ovh_*` do
mesmo PostgreSQL que ja guarda o custo AWS -- **sem tocar no pipeline AWS**.

| | |
|---|---|
| Collector | `/opt/finops/ovh-collector/ovh_to_postgres.py` |
| Wrapper | `/opt/finops/ovh-collector/run-ovh-etl.sh` |
| POC (exploracao) | `/opt/finops/ovh-collector/ovh_poc.py` |
| Migracao | `scripts/migrations/005-ovh-collector.sql` ([rollback](../scripts/migrations/005-ovh-collector-rollback.sql)) |
| Versionado em | `scripts/ovh-collector/` -- **sem o `.env`** |
| Cron | **preparado, NAO instalado** -- ver secao 6 |

> **Estado em 19/08/2026: nenhum dado coletado.** As tabelas existem e estao
> vazias, o collector esta testado, mas **a credencial OVH nao autentica** -- a
> application key e recusada nas tres regioes. Ver secao 7.

---

## 1. Por que tabelas separadas

A alternativa seria migrar `aws_daily_costs` e `aws_monthly_costs` para um
`cloud_costs` generico com coluna `provider`. Foi descartada: mexeria no pipeline
que hoje sustenta o dashboard em producao para acomodar um provedor que ainda nao
entregou o primeiro dado.

Tabelas `ovh_*` proprias isolam o risco -- se a coleta OVH estiver errada, o custo
AWS nao muda uma linha. A unificacao vem depois, **por view**, que um `DROP VIEW`
desfaz, enquanto tabela migrada exige restore.

```
   API OVHcloud  (somente GET)
        │
        │  ovh_to_postgres.py   -- roda no host, venv proprio
        v
   ovh_provider_accounts ─┬─ ovh_projects
                          ├─ ovh_monthly_costs      <- o que o dashboard vai ler
                          └─ ovh_invoice_headers ─ ovh_invoice_lines
   ovh_sync_runs                                    <- historico de execucoes

   aws_daily_costs / aws_monthly_costs              <- INTOCADAS
```

---

## 2. As tabelas

| Tabela | Papel |
|---|---|
| `ovh_provider_accounts` | uma linha por conta OVH. `provider_account_id` casa com `cloud_accounts.account_id` |
| `ovh_projects` | projetos Public Cloud |
| `ovh_monthly_costs` | **custo por mes** -- a tabela que o dashboard le |
| `ovh_invoice_headers` | cabecalho das faturas |
| `ovh_invoice_lines` | linhas das faturas |
| `ovh_sync_runs` | historico de execucoes, espelhando `app_etl_runs` |

### `source` divide tres coisas que nao se somam

| `source` | O que e | Serve para |
|---|---|---|
| `invoice` | a empresa **pagou** | conciliacao financeira |
| `usage_current` | consumo do mes **em andamento** | acompanhamento operacional |
| `usage_forecast` | **projecao** da OVH | previsao |

**Sempre filtre por `source` ao somar.** Sem filtro, o total conta o mesmo
consumo tres vezes. Foi por isso que `source` entra na chave unica: o mesmo
projeto no mesmo mes tem legitimamente um valor de uso corrente **e** um de
previsao, e os dois precisam coexistir.

### Duas decisoes de schema que evitam bug silencioso

**`project_service_name` e `category` sao `NOT NULL DEFAULT ''`, nao `NULL`.**
Em indice UNIQUE do PostgreSQL, `NULL` nunca e igual a `NULL`. Com essas colunas
nulas, cada execucao inseriria linha nova em vez de atualizar a existente, e o
custo **dobraria a cada dia sem erro nenhum**. `''` significa "nao se aplica" --
custo de fatura que nao pertence a projeto.

**Custo de fatura e agregado por (mes, descricao) entre TODAS as faturas do mes**,
nao por fatura. Agregar por fatura faria duas faturas do mesmo mes com a mesma
descricao colidirem na chave unica, e uma sobrescreveria a outra.

---

## 3. Instalar

A migracao ja foi aplicada em producao em 19/08/2026. Em outro ambiente:

```bash
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < scripts/migrations/005-ovh-collector.sql
```

Aditiva e idempotente. O rollback destroi dado nao regeneravel -- ver o cabecalho
do arquivo de rollback antes de usar.

Dependencias, em venv **proprio**, separado do `/opt/finops/venv` do ETL AWS:

```bash
cd /opt/finops/ovh-collector
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Separado de proposito: compartilhar significaria que instalar dependencia da OVH
pode quebrar a carga de custo AWS das 08:00.

---

## 4. Configurar

```bash
cd /opt/finops/ovh-collector
cp .env.example .env && chmod 600 .env && nano .env
```

Precisa das chaves da OVH **e** das variaveis `PG_*`. Como gerar as chaves e as
permissoes minimas: [scripts/ovh-collector/README.md](../scripts/ovh-collector/README.md), secao 2.

O `.env` nunca e versionado. O `.env.example` **e** -- por isso so tem
marcadores, e o script recusa rodar se encontrar marcador no lugar de valor.

---

## 5. Rodar

```bash
/opt/finops/ovh-collector/run-ovh-etl.sh manual            # execucao a mao
/opt/finops/ovh-collector/run-ovh-etl.sh manual --dry-run  # coleta, mostra, NAO grava
/opt/finops/ovh-collector/run-ovh-etl.sh                   # source=cron
```

O wrapper encerra execucoes travadas antes de comecar: sem isso, um processo
morto deixa `running` eterno e o proximo operador acha que ha coleta em
andamento.

| Codigo | Significado |
|---|---|
| 0 | sucesso |
| 2 | `.env` ausente ou incompleto |
| 3 | dependencia ausente |
| 4 | **a OVH recusou a autenticacao** |
| 5 | falha ao gravar no PostgreSQL |

Codigos distintos por causa porque 4 e 5 sao times diferentes: um e credencial de
provedor, o outro e banco.

---

## 6. Cron -- preparado, nao instalado

O agendamento esta em `/opt/finops/ovh-collector/cron-ovh.exemplo`, **fora do
crontab**. Nao foi instalado porque nenhuma coleta real funcionou ainda, e
agendar coleta que nunca funcionou so produz uma falha silenciosa por dia.

```bash
# conferir que uma execucao manual deu certo:
/opt/finops/ovh-collector/run-ovh-etl.sh manual
docker exec -i finops-postgres psql -U finops_user -d finops \
  -c "SELECT id, status, cost_rows FROM ovh_sync_runs ORDER BY id DESC LIMIT 1;"

# so entao instalar, com backup:
crontab -l > /opt/finops/backups/crontab-$(date +%F-%H%M).bak
( crontab -l; grep -v '^#' /opt/finops/ovh-collector/cron-ovh.exemplo ) | crontab -

# rollback:
crontab /opt/finops/backups/crontab-<data>.bak
```

Horario proposto: **09:00 UTC** (06:00 em Sao Paulo), uma hora depois do ETL AWS.
Os dois usam o mesmo PostgreSQL numa instancia de 3,8 GiB que ja roda Metabase --
sobrepor as cargas cria contencao sem necessidade.

---

## 7. Estado atual e o que falta

**A credencial OVH nao autentica.** Testada nas tres regioes (`ovh-ca`, `ovh-us`,
`ovh-eu`): todas devolvem `This application key is invalid`. Nao e regiao errada.
A application key fornecida tem **17 caracteres hex; a OVH usa 16** -- um digito a
mais, provavelmente valor de exemplo ou erro de transcricao. Secret e consumer key
tem os 32 esperados.

Enquanto isso nao for resolvido: tabelas criadas e vazias, zero linhas
importadas, zero projetos, zero faturas.

Para destravar: gerar chaves novas no console da regiao correta (README do
collector, secao 2), preencher o `.env` e rodar `run-ovh-etl.sh manual`.

---

## 8. Consultas de validacao

```sql
-- 1. total por projeto (mes corrente, uso operacional)
SELECT project_service_name, currency, round(sum(amount), 2) AS total
  FROM ovh_monthly_costs
 WHERE source = 'usage_current'
   AND billing_month = date_trunc('month', current_date)::date
 GROUP BY 1, 2 ORDER BY 3 DESC;

-- 2. total por mes, SEPARADO por origem -- nunca some as tres
SELECT billing_month, source, currency, round(sum(amount), 2) AS total,
       count(*) AS linhas
  FROM ovh_monthly_costs
 GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2;

-- 3. total por fatura, com conferencia contra as linhas
SELECT h.bill_id, h.bill_date, h.currency,
       h.total_with_tax                     AS total_cabecalho,
       round(sum(l.total_price), 2)         AS soma_das_linhas,
       round(h.total_without_tax - coalesce(sum(l.total_price), 0), 2) AS diferenca
  FROM ovh_invoice_headers h
  LEFT JOIN ovh_invoice_lines l
         ON l.provider_account_id = h.provider_account_id AND l.bill_id = h.bill_id
 GROUP BY h.provider_account_id, h.bill_id, h.bill_date, h.currency,
          h.total_with_tax, h.total_without_tax
 ORDER BY h.bill_date DESC;

-- 4. ultimo sync
SELECT id, source, status,
       started_at AT TIME ZONE 'America/Sao_Paulo' AS inicio,
       round(extract(epoch FROM (finished_at - started_at))) AS duracao_s,
       accounts_rows, projects_rows, invoice_rows, cost_rows,
       left(error_message, 120) AS erro
  FROM ovh_sync_runs ORDER BY id DESC LIMIT 10;

-- 5. contas OVH que ainda nao estao em cloud_accounts
--    (sem cadastro, a conta aparece no dashboard sem alias)
SELECT o.provider_account_id, o.nichandle, o.account_alias
  FROM ovh_provider_accounts o
  LEFT JOIN cloud_accounts c ON c.account_id = o.provider_account_id
 WHERE c.account_id IS NULL;

-- 6. sanidade: nenhuma linha deve ter chegado duplicada
SELECT provider_account_id, project_service_name, billing_month,
       service_label, category, source, count(*)
  FROM ovh_monthly_costs
 GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1;
```

---

## 9. Pendencias para o dashboard

O portal **ainda nao le** nenhuma dessas tabelas. Em ordem:

1. **Cadastrar a conta em `cloud_accounts`** com `provider = 'ovh'`. A coluna ja
   existe, com default `'aws'`. Sem cadastro, a consulta 5 acima acusa, e a conta
   apareceria sem alias.

2. **Decidir a moeda de referencia.** A conta OVH tem moeda propria
   (`ovh_provider_accounts.currency`) que pode nao ser a da AWS. Somar provedores
   exige escolher a moeda e a data da cotacao -- decisao de negocio antes de ser
   de codigo. O portal ja tem provedor de cotacao (`EXCHANGE_RATE_PROVIDER`),
   hoje usado so para exibir BRL estimado.

3. **Criar a view de unificacao**, so depois de 1 e 2. Precisa resolver:
   granularidade (AWS e diaria, OVH e mensal), e qual `source` da OVH representa
   custo realizado -- provavelmente `invoice` para meses fechados e
   `usage_current` para o mes corrente, o que e uma regra, nao um `UNION`.

4. **Ajustar as telas.** Filtro de contas, analitico e exportacao assumem uma
   linha por dia; OVH so tem mes. Decidir se o mes vira uma linha no primeiro dia
   ou se a tela passa a ter granularidade variavel por provedor.

5. **Estender a tela de Diagnostico** para ler `ovh_sync_runs` junto de
   `app_etl_runs`. Um collector que ninguem ve falhar e um collector que falha
   sem ninguem ver.

Nada disso foi feito nesta entrega: sem dado real coletado, decidir granularidade
e moeda seria adivinhar o formato do problema antes de te-lo.

---

## 10. Testes executados (19/08/2026)

30 verificacoes contra o PostgreSQL de producao, com conta ficticia e limpeza
verificada:

| Grupo | Resultado |
|---|---|
| conexao com o PostgreSQL | OK |
| primeira gravacao nas 5 tabelas | OK |
| **reexecucao identica -- nao duplica** | OK |
| **valor mudou -- atualiza, nao insere**, `updated_at` avanca | OK |
| tres origens coexistindo no mesmo projeto/mes | OK |
| constraints recusam `source` invalido, mes que nao e dia 1, valor negativo e projeto de conta inexistente | OK |
| limpeza por `ON DELETE CASCADE`, residuo zero | OK |
| AWS intacta: 1059 linhas, soma 1316.956024, 2 contas | OK |

Caminho de falha da API, exercitado de verdade: o wrapper devolveu `4`, a
execucao ficou `failed` em `ovh_sync_runs` com `finished_at` preenchido, e a
sanitizacao redigiu o hexadecimal do `OVH-Query-ID` -- nenhum hex longo chegou ao
banco.
