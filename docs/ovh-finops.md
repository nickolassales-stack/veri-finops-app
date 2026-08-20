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
| Cron | **instalado 20/08/2026**, `0 9 * * *` UTC -- ver secao 6 |

> **Estado em 19/08/2026: primeira carga real concluida.** Conta `ovh-main-ca`
> (`ovh80386@gmail.com`, endpoint `ovh-ca`, moeda **USD**), 39 faturas de
> 2024-09 a 2026-08, 551 linhas de fatura, 512 linhas de custo, total
> **US$ 30.917,39**. Uso por projeto (`usage_current` / `usage_forecast`) nao
> veio: a API responde `no usages found`. Ver secao 7.

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

## 6. Cron -- INSTALADO em 20/08/2026

Instalado apenas depois de a coleta manual funcionar: **tres execucoes com
sucesso** (`ovh_sync_runs` ids 2, 3 e 4) antes do agendamento. Agendar coleta que
nunca funcionou so produz uma falha silenciosa por dia.

```cron
0 9 * * * cd /opt/finops/ovh-collector && ./run-ovh-etl.sh cron >> /opt/finops/ovh-collector/logs/cron.log 2>&1
```

**09:00 UTC** (06:00 em Sao Paulo), uma hora depois do ETL AWS das 08:00. Os dois
usam o mesmo PostgreSQL numa instancia de 3,8 GiB que ja roda Metabase --
sobrepor as cargas cria contencao sem necessidade. Os dois crons sao
independentes: se o collector OVH quebrar, a carga AWS nao percebe.

### O diretorio de log precisa existir ANTES

```bash
mkdir -p /opt/finops/ovh-collector/logs && chmod 700 /opt/finops/ovh-collector/logs
```

Nao e detalhe de arrumacao. Redirecionamento para diretorio inexistente **falha
no shell do cron, e o comando nao roda** -- uma falha diaria silenciosa, sem log
nenhum que a explique, porque o log e justamente o que nao pode ser aberto.

### Duas variaveis de ambiente da aplicacao

Instalar o cron no host **nao** informa a aplicacao. O portal roda em container
sem acesso ao crontab, entao o estado do agendamento e DECLARADO:

```env
OVH_CRON_INSTALADO=true
OVH_HORARIO_ESPERADO=09:00
```

Sem isso, o bloco "OVH Collector" do Diagnostico afirma que o cron nao existe --
o oposto da verdade, na tela cuja funcao e dizer a verdade sobre o pipeline. E a
mesma armadilha de `ETL_HORARIO_ESPERADO`, e pelo mesmo motivo: os dois passos
andam juntos.

### Como conferir que o caminho do cron funciona, sem esperar 09:00

Rodar o wrapper a mao **nao prova** que o cron vai funcionar: o cron usa `sh`, um
`PATH` reduzido e nenhuma variavel do seu login. Para testar o ambiente de
verdade:

```bash
env -i SHELL=/bin/sh PATH=/usr/bin:/bin HOME=/home/ubuntu LOGNAME=ubuntu \
  /bin/sh -c 'cd /opt/finops/ovh-collector && ./run-ovh-etl.sh cron \
    >> /opt/finops/ovh-collector/logs/cron.log 2>&1'
echo "exit=$?"
```

Depois confirme que a execucao entrou com a origem certa:

```sql
SELECT id, status, source, cost_rows, invoice_rows
  FROM ovh_sync_runs ORDER BY id DESC LIMIT 1;
```

`source` tem de ser `cron`. Se vier `manual`, o argumento nao chegou ao wrapper.

### ROLLBACK

O backup do crontab **anterior** a instalacao esta em
`/opt/finops/backups/crontab.before-ovh.2026-08-20-1530.txt` (modo 600).

**Nivel 1 -- desativar so o cron OVH, preservando o AWS:**

```bash
crontab -l > /tmp/crontab.atual
crontab -l | grep -v 'run-ovh-etl.sh' | crontab -
crontab -l    # conferir que a linha das 08:00 do AWS continua la
```

**Nivel 2 -- restaurar o crontab inteiro de antes da instalacao:**

```bash
crontab /opt/finops/backups/crontab.before-ovh.2026-08-20-1530.txt
crontab -l
```

Este arquivo contem **apenas** a linha do ETL AWS, que era todo o crontab antes
desta mudanca. Restaurar remove o cron OVH e devolve o AWS ao que era.

**Nivel 3 -- alinhar a aplicacao:** depois de qualquer um dos dois, ponha
`OVH_CRON_INSTALADO=false` no `.env` da aplicacao e reinicie o container do
portal, senao o Diagnostico passa a afirmar que existe um cron que voce acabou de
remover.

**O que o rollback NAO desfaz:** as linhas que a coleta ja gravou em
`ovh_monthly_costs` e nas tabelas de fatura. Remover o cron para a coleta futura;
nao apaga o passado. Para isso, ver o rollback da migracao 005 --
`005-ovh-collector-rollback.sql` -- e leia o aviso dele antes: `usage_current` e
fotografia de um mes em andamento e nao volta rodando o collector de novo.

### Uma consequencia da janela de 12 meses

O padrao `OVH_MESES_FATURA=12` faz cada execucao diaria recoletar os ultimos 12
meses -- na rodada de 20/08/2026, 17 faturas e 266 linhas. As linhas mais antigas
que a janela **permanecem**: o collector so faz `INSERT ... ON CONFLICT DO
UPDATE`, nunca `DELETE`. Comprovado na propria instalacao: depois de uma rodada
de 12 meses, as 512 linhas e o total de US$ 30.917,39 vindos da carga inicial de
24 meses seguiram intactos, com 266 atualizadas e 246 sem toque.

---

## 7. Estado atual e o que falta

A credencial foi regerada e **autentica** em `ovh-ca`. A carga inicial rodou com
`OVH_MESES_FATURA=24` para trazer o historico inteiro; o padrao diario de 12
meses cobre o periodo corrente sem revarrer tudo.

### O que veio

| | |
|---|---|
| conta | `ovh-main-ca` -- `ovh80386@gmail.com`, pais BR, moeda **USD** |
| faturas | 39, de 2024-09-11 a 2026-08-01 |
| linhas de fatura | 551 |
| linhas de custo | 512, todas com `source='invoice'` |
| total | US$ 30.917,39 em 24 meses |

### O que nao veio, e por que

`usage/current` e `usage/forecast` respondem `ResourceNotFoundError: no usages
found` para o unico projeto Public Cloud da conta (`Project 2026-07-21`,
`plan_code=project.discovery`). Nao e falha de permissao nem de codigo: **o
projeto nao tem consumo registrado**. Enquanto for assim, `ovh_monthly_costs` so
tera linhas de fatura, e o custo aparece no mes em que foi **faturado**, nao no
mes em que foi consumido.

O collector trata isso como aviso, nao como erro: a execucao termina `success` e
os avisos ficam no log. Uma falha aqui nao pode derrubar a coleta de faturas, que
e o dado que existe.

### Bug corrigido nesta carga

A janela de faturas era calculada como
`date(hoje.year - (1 if hoje.month <= MESES % 12 else 0), 1, 1)`. Com o padrao de
12 meses, `12 % 12` e zero, a condicao nunca era verdadeira e o inicio caia
**sempre em 1o de janeiro do ano corrente** -- em agosto, 8 meses em vez de 12;
em janeiro, um unico mes. Nao dava erro: importava menos historico calado.
Trocado por aritmetica em meses absolutos, que atravessa a virada de ano sem
caso especial.

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

## 9. O que o portal ja le, e o que falta

### Feito em 20/08/2026: separacao por provider na interface

O portal le as tabelas `ovh_*` em **duas telas**, e deliberadamente NAO as le nas
outras. O detalhamento completo esta na secao 5.2 do README; o resumo:

| Tela | Contas OVH |
|---|---|
| Visao executiva, analitico, exportacoes | **nao aparecem** -- selo "Visao AWS" |
| Faturamento | secao "OVHcloud" com tres cards por `source` e tabela mensal |
| Diagnostico | bloco "OVH Collector" lendo `ovh_sync_runs` |
| Admin > Contas | aparecem, com selo do provedor |

A conta `ovh-main-ca` foi cadastrada em `cloud_accounts` com `provider='ovh'` e
alias em `app_account_settings` -- o item 1 da lista anterior, concluido.

**Conta OVH numa tela AWS agora da 400, nao zero.** A barreira esta em
`montarFiltro()`, funil de toda leitura de custo AWS: cinco endpoints do painel,
tres do analitico e as duas exportacoes. Era o defeito central: a conta OVH
existe no cadastro, passa em qualquer verificacao de existencia, e nao tem uma
linha em `aws_daily_costs` -- o resultado seria `US$ 0,00` com cara de resposta
legitima.

### O que falta

1. **Decidir a moeda de referencia.** A conta OVH tem moeda propria
   (`ovh_provider_accounts.currency`) que pode nao ser a da AWS. Somar provedores
   exige escolher a moeda e a data da cotacao -- decisao de negocio antes de ser
   de codigo. O portal ja tem provedor de cotacao (`EXCHANGE_RATE_PROVIDER`),
   hoje usado so para exibir BRL estimado.

2. **Criar a view de unificacao**, so depois da decisao de moeda. Precisa resolver:
   granularidade (AWS e diaria, OVH e mensal), e qual `source` da OVH representa
   custo realizado -- provavelmente `invoice` para meses fechados e
   `usage_current` para o mes corrente, o que e uma regra, nao um `UNION`.

3. **Unificar a granularidade nas telas AWS**, se a decisao for exibir os dois
   provedores juntos. Filtro de contas, analitico e exportacao assumem uma linha
   por dia; OVH so tem mes. Enquanto isso nao for resolvido, a separacao atual e
   a resposta: cada tela le o que sabe ler, e diz qual recorte esta mostrando.

Os itens de instalar o cron e estender o Diagnostico foram concluidos -- ver
secao 6 e a secao 5.2 do README.

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
