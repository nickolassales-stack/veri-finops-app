# VERI FinOps — Portal de custos AWS

Portal interno que mostra o custo AWS da VERI a partir do **PostgreSQL do
pipeline FinOps que já existe**. Entra ao lado do Metabase e do ETL, sem
substituir nem alterar nenhum dos dois.

| | |
|---|---|
| **Seções** | [1. Resumo](#1-resumo-da-aplicação) · [2. Arquitetura](#2-arquitetura) · [3. Fluxo de dados](#3-fluxo-de-dados) · [4. Variáveis](#4-variáveis-de-ambiente) · [5. Usuários e permissões](#5-usuários-grupos-e-permissões) · [6. Rodar local](#6-como-rodar-local) · [7. Rodar em produção](#7-como-rodar-em-produção) · [8. Implantar na EC2](#8-como-implantar-na-ec2) · [9. Rollback](#9-como-fazer-rollback) · [10. Validar dashboard](#10-como-validar-o-dashboard) · [11. Validar exportações](#11-como-validar-as-exportações) · [12. Troubleshooting](#12-troubleshooting) · [13. Limitações](#13-limitações-conhecidas) · [14. Homologação](#14-checklist-de-homologação) |

### Onde está o quê

| Caminho | Conteúdo |
|---|---|
| [web/](web/) | Aplicação Next.js 16 + TypeScript. **[README da aplicação](web/README.md)** — autenticação, telas, API, exportação e convenções |
| [infra/](infra/) | Composes de produção e de desenvolvimento, e o `.env.example` |
| [scripts/](scripts/) | Operação do container, migrações, ETL, inspeção do schema, criação do role e das tabelas de auth |
| [docs/](docs/) | Runbook, schema real do banco, decisões de visualização, brandbook VERI |
| [assets/logos/](assets/logos/) | Identidade visual VERI |

- **[docs/RUNBOOK-app.md](docs/RUNBOOK-app.md)** — deploy detalhado, role do banco, riscos
- **[docs/schema-snapshot.md](docs/schema-snapshot.md)** — schema real e achados de qualidade do dado
- **[docs/API-dados.md](docs/API-dados.md)** — endpoints, filtros e contrato de resposta
- **[docs/DECISOES-dataviz.md](docs/DECISOES-dataviz.md)** — paleta validada e regras de gráfico
- **[docs/skill-veri.md](docs/skill-veri.md)** — Brandbook VERI v2.0

Banco e carga:

| Arquivo | Papel |
|---|---|
| [scripts/migrations/001-billing-period.sql](scripts/migrations/001-billing-period.sql) | Separa período financeiro de data de uso. **Reversível** ([rollback](scripts/migrations/001-billing-period-rollback.sql)) |
| [scripts/migrations/002-admin-configuracoes.sql](scripts/migrations/002-admin-configuracoes.sql) | Alias de contas, grupos, vínculos e permissões. **Reversível** ([rollback](scripts/migrations/002-admin-configuracoes-rollback.sql)) — mas guarda dado que só existe ali |
| [scripts/etl/athena_to_postgres.py](scripts/etl/athena_to_postgres.py) | Carga Athena → PostgreSQL. Roda na EC2, em `/opt/finops/etl/` |
| [scripts/backfill-billing-period.py](scripts/backfill-billing-period.py) | Preenche o período de cobrança nas linhas já carregadas |
| [scripts/reconciliacao-cost-explorer.sql](scripts/reconciliacao-cost-explorer.sql) | Confere o portal contra o AWS Cost Explorer |

---

## 1. Resumo da aplicação

Telas atrás de login, alimentadas pelo PostgreSQL do FinOps:

| Tela | Rota | Exige | O que faz |
|---|---|---|---|
| **Visão executiva** | `/dashboard` | `dashboard:view` | KPIs do período, custo por conta, maiores serviços, evolução diária, distribuição percentual |
| **Analítico · por serviço** | `/dashboard/analitico` | `analytic:view` | Tabela paginada de lançamentos, com filtros e **exportação CSV/XLSX** |
| **Analítico · por custo mensal** | `/dashboard/analitico/custos` | `analytic:view` | Histórico mensal por conta, com variação e participação. Exportação exige `analytic:export` |
| **Configurações** | `/dashboard/configuracoes` | `settings:view` | Alias de contas, usuários, grupos e permissões |
| **Diagnóstico** | `/dashboard/diagnostico` | `diagnostics:view` | Se o ETL rodou, quando, o que trouxe, frescor por conta, alertas e saúde do banco |
| **Minha conta** | `/conta` | sessão | Troca de senha |

**Autorização por permissão, não por papel.** `ADMIN` continua podendo tudo, mas
o que decide cada tela é uma permissão nomeada, concedida por grupo — ver
seção 5. Esconder o link do menu não é a proteção: a autorização real está em
`requirePermissao()` dentro da página e em `rotaComPermissao()` na rota de API.

**Não existe cadastro público.** O primeiro administrador é criado por comando
pontual (seção 5); os demais nascem pela tela de usuários.

**O valor oficial é USD.** O BRL é estimativa visual, calculada com a PTAX do
Banco Central, marcada como indicativa em toda tela e **nunca gravada no banco**.
Sem cotação, o portal continua funcionando — só em dólar.

---

## 2. Arquitetura

O portal **entra ao lado** do que já existe na EC2. Nada é substituído.

```
                    EC2 FinOps  (~4 GiB)
  ┌──────────────────────────────────────────────────────────┐
  │  projeto docker compose  (rede interna: bridge)          │
  │                                                          │
  │   finops-postgres ──────┬───────────┬──────────────────┐ │
  │   :5432 só em 127.0.0.1 │           │                  │ │
  │                         │           │                  │ │
  │   finops-metabase       │  finops-portal               │ │
  │   :3000 (já existia)    │  :3001 → 3000  (NOVO)        │ │
  │                         │                              │ │
  └─────────────────────────┼──────────────────────────────┘ │
                            │                                │
     ETL (athena_to_postgres.py, fora do compose) ───────────┘
                            │
                     HTTPS ↓ (só cotação USD/BRL)
                     api.bcb.gov.br
```

**O que o portal fala:** só PostgreSQL, pela **rede interna** do compose (host
`postgres`), e HTTPS com o Banco Central para a cotação — que é dispensável.
Nunca Athena, S3 ou API da AWS.

| Serviço | Container | Porta no host | Origem |
|---|---|---|---|
| PostgreSQL | `finops-postgres` | `127.0.0.1:5432` (**sem exposição pública**) | já existia |
| Metabase | `finops-metabase` | `3000` | já existia |
| **Portal FinOps** | `finops-portal` | `127.0.0.1:3001` | **este repositório** |

3001 porque **3000 é do Metabase**. O portal publica só no loopback: o acesso é
por túnel SSH até que haja Nginx + HTTPS na frente.

### Arquivos Docker

| Arquivo | Papel |
|---|---|
| [web/Dockerfile](web/Dockerfile) | Imagem multi-stage. `output: standalone`, roda como uid 1001, healthcheck embutido |
| [web/.dockerignore](web/.dockerignore) | Impede que `.env` e chaves cheguem ao contexto de build |
| [infra/docker-compose.veri-finops.yml](infra/docker-compose.veri-finops.yml) | **Complementar.** Só declara `finops-app` |
| [infra/docker-compose.dev.yml](infra/docker-compose.dev.yml) | Roda a imagem de produção na máquina do dev |
| [infra/docker-compose.current.yml](infra/docker-compose.current.yml) | Snapshot do compose da EC2 — **referência, não editar** |
| [scripts/finops-app.sh](scripts/finops-app.sh) | `build · up · logs · health · status · rollback · down` |

O complementar **não redeclara** `postgres` nem `metabase`. O que não está
escrito não pode ser recriado por engano.

---

## 3. Fluxo de dados

```
AWS Cost Explorer / CUR
        │
        ▼
   Athena  ──[ ETL athena_to_postgres.py, fora do compose ]──►  PostgreSQL
                                                                    │
                             ┌──────────────────────────────────────┤
                             │                                      │
                    Metabase (já existia)              Portal FinOps (este repo)
                                                                    │
                                             ┌──────────────────────┴──────────┐
                                             │                                 │
                                    Server Component                    Rota /api/*
                                    (render no servidor)          (fetch do navegador)
                                             │                                 │
                                             └──────────────┬──────────────────┘
                                                            ▼
                                             SQL parametrizado, agregação NO BANCO
                                                            │
                                                            ▼
                                              tela  ·  CSV/XLSX (streaming)
```

**Sentido único.** O ETL escreve; o portal só lê. Isso não depende de disciplina
do código: o role `finops_app` tem **`SELECT` e nada mais** em `aws_daily_costs`
e `aws_monthly_costs` — a barreira é do banco
(ver [scripts/create-app-role.sql](scripts/create-app-role.sql)).

### Como o ETL é monitorado

O ETL é um script Python na EC2, disparado pelo cron, **fora do compose e fora
do portal**. O portal não o executa nem o supervisiona: ele apenas lê o rastro
que a carga deixa.

Esse rastro é a tabela `app_etl_runs` (migração 003). O próprio ETL abre uma
linha `running` quando começa e a fecha como `success` ou `failed` quando
termina, gravando quantas linhas cada carga trouxe.

| | |
|---|---|
| **Quem escreve** | o ETL, como `finops_user` |
| **Quem lê** | o portal, como `finops_app`, com **`SELECT` e nada mais** |
| **Onde aparece** | `/dashboard/diagnostico` e `GET /api/diagnostics/etl` |

A assimetria de privilégio é o ponto. Se o portal pudesse escrever ali, *"o ETL
rodou"* passaria a ser uma afirmação que a própria aplicação fabrica — e a tela
que existe para provar o estado do pipeline deixaria de provar coisa alguma. É a
mesma barreira já aplicada às tabelas de custo.

**Três regras da instrumentação:**

1. **Monitorar não pode derrubar o que é monitorado.** Toda falha de registro
   vira aviso no log e a carga segue. Sem a migração 003, o ETL avisa uma vez por
   execução e **carrega normalmente**.
2. **A linha é aberta antes da carga.** Gravar só o resultado no fim seria mais
   simples e esconderia justamente o caso que interessa: execução morta no meio
   ficaria indistinguível de execução que nunca começou.
3. **Mensagem de erro é sanitizada** na escrita e redigida de novo na leitura.
   Vai a mensagem da exceção, curta e com segredo mascarado — nunca o traceback,
   que carrega variável de ambiente.

**Execução que morre sem conseguir gravar nada** (OOM, `kill -9`, reboot) deixa a
linha aberta para sempre. Duas coisas resolvem: a tela dá por interrompida
qualquer execução aberta há mais de `ETL_EXECUCAO_ORFA_MINUTOS`, e a carga
**seguinte** fecha o registro sozinha. Ninguém precisa de acesso ao banco para
consertar bookkeeping.

#### O horário esperado é declarado, não descoberto

> **O cron dispara às 08:00 UTC, que são 05:00 em São Paulo.** A EC2 está em
> `Etc/UTC` e a linha do cron é `0 8 * * *`. Não são 8h da manhã no horário de
> Brasília, e essa diferença de três horas já era assim antes desta entrega.

O portal roda em container sem acesso ao host, então não tem como ler o crontab.
O horário esperado vem de variável de ambiente, e o padrão foi escolhido para
bater com o cron real:

| Variável | Padrão | Para que serve |
|---|---|---|
| `ETL_HORARIO_ESPERADO` | `08:00` | hora do agendamento |
| `ETL_FUSO_AGENDAMENTO` | `Etc/UTC` | fuso em que **o agendador** entende essa hora |
| `ETL_TOLERANCIA_MINUTOS` | `90` | atraso aceito antes de acusar |
| `ETL_EXECUCAO_ORFA_MINUTOS` | `120` | idade que torna uma execução aberta "interrompida" |
| `DIAGNOSTICO_DIAS_SEM_ATUALIZACAO` | `3` | dias sem dado novo antes de acusar conta parada |

A tela mostra os dois: *"08:00 em Etc/UTC"* e a próxima execução convertida para
o fuso de quem lê. **Mudar a variável não muda o cron** — muda apenas o que a
tela afirma. Para mudar de verdade, veja "Como ajustar o cron" abaixo.

#### Como consultar o status

```bash
# pela tela (o caminho normal)
/dashboard/diagnostico

# por script / monitoração externa: 'saudavel' é exatamente "sem alerta crítico"
curl -s -H "cookie: veri_finops_session=$TOKEN" \
  http://localhost:3001/api/diagnostics/data-freshness | jq '.dados.saudavel'

# direto no banco, sem portal nenhum
docker exec finops-postgres psql -U finops_user -d finops -c \
  "SELECT id, started_at, status, source, monthly_rows, daily_rows
     FROM app_etl_runs ORDER BY started_at DESC LIMIT 5"
```

#### Como registrar uma execução manual

O caminho recomendado registra sozinho — o wrapper só informa a origem:

```bash
/opt/finops/run-etl-with-status.sh manual
```

Ele **chama** `/opt/finops/run-etl.sh` sem alterá-lo, e não guarda credencial
nenhuma: quem tem as variáveis continua sendo o script antigo. Para uma carga
feita por outro caminho (backfill, `psql`, reprocessamento) que ainda assim
precise aparecer no diagnóstico:

```bash
read -rs PG_PASSWORD && export PG_PASSWORD
ID=$(/opt/finops/register-etl-status.py --abrir --source manual)
# ... a carga ...
/opt/finops/register-etl-status.py --fechar "$ID" --status success --mensais 50 --diarias 915
/opt/finops/register-etl-status.py --ultimas 5          # conferir
/opt/finops/register-etl-status.py --fechar-orfas       # limpar execução travada
unset PG_PASSWORD
```

#### Como ajustar o cron

O agendamento vive no crontab do usuário `ubuntu`. **Backup antes, sempre** —
`crontab -` substitui tudo de uma vez e não pergunta:

```bash
crontab -l > /opt/finops/backups/crontab-$(date +%F-%H%M).bak

# mudar o HORÁRIO (exemplo: 08:00 em São Paulo = 11:00 UTC)
crontab -l | sed 's|^0 8 |0 11 |' | crontab -
#   e então acompanhe com ETL_HORARIO_ESPERADO=11:00 no .env do portal,
#   senão a tela passa a cobrar a carga na hora errada.

crontab -l    # CONFIRA o resultado antes de sair
```

**Rollback do cron:** `crontab /opt/finops/backups/crontab-<data>.bak`.

Rollback do restante, na ordem inversa da instalação:

```bash
# 1. ETL volta à versão anterior (o backup é criado a cada publicação)
cp /opt/finops/etl/athena_to_postgres.py.bak-<data> /opt/finops/etl/athena_to_postgres.py

# 2. cron volta a chamar o script direto
crontab /opt/finops/backups/crontab-<data>.bak

# 3. banco -- DESTRÓI o histórico de execuções; faça o dump antes
docker exec finops-postgres pg_dump -U finops_user -d finops -t app_etl_runs \
  > /opt/finops/backups/app_etl_runs-$(date +%F-%H%M).sql
docker exec -i finops-postgres psql -U finops_user -d finops -X -v ON_ERROR_STOP=1 \
  < scripts/migrations/003-diagnostico-etl-rollback.sql
```

Nenhum dos três passos toca em dado de custo, no Metabase ou no compose. A tela
de diagnóstico continua abrindo depois do rollback: ela informa que o
monitoramento não está instalado.

### Duas leituras do analítico

A área analítica tem duas abas. Elas **não** são a mesma tabela com outro
agrupamento: respondem perguntas diferentes e por isso usam critérios de data
diferentes.

| | Por serviço | Por custo mensal |
|---|---|---|
| Rota | `/dashboard/analitico` | `/dashboard/analitico/custos` |
| Pergunta | o que foi consumido, e quando | quanto cada conta custou por mês |
| Granularidade | um lançamento por dia/serviço | uma linha por (mês, conta) |
| Critério de data | `usage_date` — **operacional** | `billing_month` — **financeiro** |
| Fecha com o Cost Explorer | não necessariamente | **sim** |

A aba por custo é a que se usa para **reconciliação financeira**. A evolução
diária da visão executiva e a listagem por serviço seguem a data de uso e
respondem *“em que dia isso rodou”* — legítimo, e inadequado para conferir
fatura. Ver a seção seguinte.

`/dashboard/analitico` continua sendo a visão por serviço, e não foi movida para
`/servicos`: mover quebraria todo link, favorito e histórico já existentes em
troca de simetria no caminho.

### Duas datas, duas perguntas diferentes

O CUR da AWS traz **duas** datas para o mesmo lançamento, e confundi-las foi a
causa de o portal não bater com o Cost Explorer:

| Campo no CUR | Coluna no Postgres | Responde |
|---|---|---|
| `line_item_usage_start_date` | `usage_date` | **Quando o recurso rodou.** Visão operacional |
| `bill_billing_period_start_date` | `billing_month` | **Em que fatura a AWS cobrou.** Visão financeira |
| `billing_period` (partição) | `billing_period` | O mesmo, no formato `AAAA-MM` |

Na maioria dos lançamentos as duas caem no mesmo mês. Em **cobrança pontual** —
registro de domínio, taxa anual, reserva — não caem. Caso real medido em
13/08/2026 na conta piloto:

```
billing_period 2026-07  ·  usage_date 2026-09-04  ·  AmazonRegistrar  ·  US$ 37,32
```

O ETL antigo só gravava a data de uso, então julho fechava **US$ 311,41** no
portal e **US$ 348,73** no Cost Explorer. A diferença era exatamente essa linha,
empurrada para setembro.

**Quem usa o quê, hoje:**

| Consulta | Critério | Por quê |
|---|---|---|
| Custo total do período de cobrança | `billing_period` | É o número que reconcilia com o Cost Explorer |
| Custo por conta · Top serviços · Distribuição % | `billing_period` | Precisam somar o mesmo que o card |
| Comparação com o período anterior | `billing_period` | Comparar fatura com fatura |
| Analítico e exportações | `billing_period` | É o detalhe dos cards; se divergisse, a conferência linha a linha não fecharia |
| **Evolução diária** (os dois gráficos) | `usage_date` | Um gráfico diário responde "em que dia rodou" — só a data de uso responde isso |

Uma linha **deslocada** (cobrança num mês, uso em outro) é atribuída **apenas**
ao seu período de cobrança, nunca aos dois. Por isso somar todos os períodos
devolve o total exato da base: nada é contado em dobro, nada some.

Onde `billing_month` ainda é `NULL` (linha carregada antes da migração 001), as
consultas caem em `date_trunc('month', usage_date)` — ou seja, no critério
antigo. Não existe estado intermediário inconsistente.

| Tabela | O portal faz |
|---|---|
| `aws_daily_costs`, `aws_monthly_costs` | **somente `SELECT`** — alimentadas pelo ETL |
| `cloud_accounts`, `cloud_budgets`, `cost_alerts` | leitura + escrita (governança) |
| `app_users`, `app_sessions` | leitura + escrita (autenticação) |

**Onde a conta é feita:** soma, contagem, `count(*) OVER ()`, top-N e
agrupamento em "Outros" acontecem **em SQL**. O navegador recebe números já
prontos — nunca o histórico bruto para somar. A tabela analítica pagina no
servidor (máx. 200 linhas por página) e a exportação lê o banco em lotes de
2.000 linhas.

**A cotação é um caminho lateral e opcional:** cache em memória com TTL, e uma
cadeia de reserva de 5 passos. Se o Banco Central estiver fora, a tela mostra
USD e um aviso — nunca um número inventado.

---

## 4. Variáveis de ambiente

Modelo completo e comentado: **[infra/.env.example](infra/.env.example)**.
O `.env` real vive ao lado do `docker-compose.yml` da EC2, com `chmod 600`, e
**nunca** é versionado (bloqueado no `.gitignore`).

| Variável | Padrão | Para que serve |
|---|---|---|
| `APP_BUILD_CONTEXT` | — **(obrigatória)** | Caminho absoluto de `web/` na EC2 |
| `APP_IMAGE_TAG` | `local` | Tag da imagem. `anterior` é reservada ao rollback |
| `PG_DB` | `finops` | Banco (o mesmo do ETL e do Metabase) |
| `APP_PG_HOST` | `postgres` | Nome do serviço na rede interna do compose |
| `APP_PG_USER` | — **(obrigatória)** | Role dedicado, permissão mínima. **Não** use `finops_user` |
| `APP_PG_PASSWORD` | — **(obrigatória)** | Senha do role da aplicação |
| `APP_PG_POOL_MAX` | `5` | Conexões simultâneas. O banco é dividido com o Metabase |
| `APP_PG_STATEMENT_TIMEOUT_MS` | `15000` | Corta consulta travada antes que ela atrapalhe o banco |
| `APP_PORT` | `3001` | Porta no host. **Não** use 3000 (Metabase) |
| `APP_BIND` | `127.0.0.1` | Interface. Só troque depois de Nginx + HTTPS |
| `APP_MEM_LIMIT` | `512m` | Teto de memória. A JVM do Metabase já sofreu OOM nesta EC2 |
| `APP_TZ` | `America/Sao_Paulo` | Fuso de apresentação e de "hoje" |
| `AUTH_SESSION_TTL_HOURS` | `12` | Validade da sessão, sem renovação deslizante |
| `AUTH_COOKIE_SECURE` | `true` | **Mantenha `true`.** `false` faz a sessão trafegar em claro |
| `EXCHANGE_RATE_PROVIDER` | `ptax` | `ptax` · `sgs` · `nenhum` (desliga a chamada externa) |
| `EXCHANGE_RATE_CACHE_TTL_SECONDS` | `3600` | Validade do cache da cotação |
| `EXCHANGE_RATE_TIMEOUT_MS` | `4000` | Teto de espera pelo Banco Central |
| `EXPORT_MAX_ROWS` | `50000` | Teto de linhas por exportação. Acima disso: HTTP 413, nunca arquivo truncado |

`ADMIN_EMAIL` e `ADMIN_PASSWORD` **não entram no `.env`** — existem só no
ambiente da execução que cria o administrador (seção 5).

> `docker compose config` **imprime os valores interpolados**, inclusive senhas.
> Use com cuidado em terminal compartilhado ou log de CI.

---

## 5. Usuários, grupos e permissões

### O primeiro admin

Não há cadastro público. O primeiro usuário é criado por comando pontual, com a
senha vivendo apenas no ambiente daquela execução:

```bash
read -rsp "senha: " ADMIN_PASSWORD; echo
docker exec -i \
  -e ADMIN_EMAIL="nome@porveri.com.br" \
  -e ADMIN_PASSWORD \
  -e ADMIN_ROLE=ADMIN \
  finops-portal node scripts/create-admin.mjs
unset ADMIN_PASSWORD
```

A senha não é exibida nem registrada em log. Mínimo de 12 caracteres. O hash é
**scrypt** (N=65536, r=8, p=1, salt de 16 bytes, comparação em tempo constante).

O mesmo comando **atualiza** a senha de um e-mail já existente — é assim que se
recupera acesso quando alguém esquece a senha, já que não há fluxo de
"esqueci minha senha" por e-mail.

Pré-requisito: as tabelas de auth precisam existir. Uma vez por instalação:

```bash
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < scripts/create-auth-tables.sql
```

Do segundo usuário em diante, use a tela — não o comando.

### O modelo de permissões

A permissão efetiva é a **união** de três origens. Nunca uma subtração: grupo
só concede.

| Origem | O que dá |
|---|---|
| Perfil **ADMIN** | tudo, por curto-circuito — não depende de grupo nenhum |
| Piso de leitura | `dashboard:view` e `analytic:view`, para qualquer usuário |
| Grupos **ativos** | o que cada grupo conceder |

Não existe permissão negativa, e isso é deliberado. Com negação, responder *“por
que fulano não consegue exportar?”* viraria uma investigação pelo cruzamento de
vários grupos. Sem ela, a resposta é uma busca por quem concede.

O ADMIN nunca é uma lista de permissões — é um `return true`. Enumerá-lo abriria
a chance de esquecer de acrescentar uma permissão nova e trancar o administrador
para fora da própria tela que a introduziu.

**Catálogo atual** (dez permissões). A fonte da verdade é
[`web/src/lib/auth/permissoes.ts`](web/src/lib/auth/permissoes.ts), **não** uma
tabela: uma permissão só significa alguma coisa se alguma rota a verifica.

| Área | Permissão | O que libera |
|---|---|---|
| Custos | `dashboard:view` | visão executiva |
| Custos | `analytic:view` | analítico, lançamento a lançamento |
| Custos | `analytic:export` | baixar CSV e XLSX |
| Configurações | `settings:view` | entrar na área administrativa |
| Configurações | `settings:accounts` | alias e metadados das contas AWS |
| Configurações | `settings:users` | criar, ativar e desativar usuários |
| Configurações | `settings:groups` | criar grupos e distribuir permissões |
| Operação | `diagnostics:view` | tela de diagnóstico |
| Faturamento | `billing:view` | fechamento de fatura e situação de pagamento |
| Faturamento | `billing:manage` | alterar fechamento e situação |

`app_group_permissions.permission` é texto livre no banco. A entrada é validada
por Zod contra o catálogo, e valor desconhecido é **ignorado na leitura** —
remover uma permissão do código a torna inerte, nunca perigosa.

**Grupos padrão**, criados pela migração 002 e editáveis pela tela:

| Grupo | Permissões iniciais |
|---|---|
| Administradores | todas as dez |
| Visualizadores | `dashboard:view`, `analytic:view` |
| Financeiro | as duas de leitura + `analytic:export`, `billing:view` |
| Tecnologia | as duas de leitura + `analytic:export`, `diagnostics:view` |

### A área administrativa

`/dashboard/configuracoes`, restrita a quem tem `settings:view`. Cada subtela
ainda exige a sua própria permissão — entrar na área não libera tudo dentro dela.

Esconder o item do menu **não** é a proteção. A autorização está em
`requirePermissao()` dentro de cada página e em `rotaComPermissao()` em cada rota
de API; digitar a URL na barra do navegador para no mesmo lugar.

**Alias de contas AWS** — `/dashboard/configuracoes/contas`

A lista sai inteira de `cloud_accounts`: nenhum id de conta é fixo no código. O
alias vive em `app_account_settings`, tabela própria do portal — escrever em
`cloud_accounts` misturaria o que o portal sabe com o que o cadastro afirma, e
uma recarga do cadastro apagaria o alias sem aviso.

O nome exibido é uma cascata de três degraus:

```
app_account_settings.alias     o que o ADMIN digitou
cloud_accounts.account_name    o que o cadastro afirma
conta-<account_id>             último recurso, nunca vazio
```

Definido uma vez, o alias vale no **filtro de contas, nos cards, na tabela
analítica e nos arquivos exportados** — a expressão está num lugar só,
[`alias-conta.ts`](web/src/lib/queries/alias-conta.ts). Apagar o campo volta ao
nome do cadastro. O **ID da conta continua sempre visível** ao lado: é ele que
identifica a conta na AWS; o alias é apenas um rótulo.

A mesma tela guarda unidade de negócio, centro de custo, ambiente, dia de
fechamento da fatura e situação de pagamento. A data de atualização da situação
só anda quando a situação muda de fato — reescrevê-la a cada salvamento faria
“atualizado há 2 minutos” mentir sobre um campo que ninguém tocou.

**Usuários** — `/dashboard/configuracoes/usuarios`

Criar exige nome, e-mail e senha inicial de no mínimo 12 caracteres, guardada com
scrypt e **nunca exibida depois**; o hash não sai do banco em resposta alguma.
Combine a troca no primeiro acesso, em `/conta`.

Desativar **encerra as sessões abertas na hora** — sem isso, desativar seria um
pedido educado, válido só até o cookie expirar.

Duas travas impedem o sistema de ficar sem administrador, e as duas existem
porque o estrago não teria volta pela tela:

1. ninguém desativa nem rebaixa **a si mesmo** — é o erro de clique clássico;
2. ninguém desativa nem rebaixa o **último ADMIN ativo**, mesmo sendo outra
   pessoa. A regra 1 sozinha não cobre isto: com dois administradores, cada um
   pode derrubar o outro e o segundo a clicar deixa o sistema sem nenhum.

As duas valem no **servidor**, não na tela: quem chamar a API direto esbarra
nelas igual.

**Grupos** — `/dashboard/configuracoes/grupos`

Nome único ignorando caixa e espaço nas pontas. Grupo inativo deixa de conceder
as próprias permissões sem perder os membros — é como suspender um acesso sem
desmontar a estrutura.

**Permissões** — `/dashboard/configuracoes/permissoes`

Uma matriz por grupo. A tela envia o **conjunto completo** de caixas marcadas,
não um delta: o que não veio foi desmarcado de propósito. A troca é
transacional, então ninguém observa o grupo com zero permissões no meio do
salvamento.

As permissões novas valem **no próximo carregamento de página** de cada membro —
a resolução é memoizada por requisição, não por sessão.

---

## 6. Como rodar local

**Escrevendo código** — servidor de desenvolvimento, com Fast Refresh:

```bash
cd web
cp .env.example .env.local     # aponte para o banco (túnel SSH ou local)
npm install
npm run dev                    # http://localhost:3100
```

**Validando o que vai para a EC2** — rode a *mesma imagem* que será publicada:

```bash
# 1. túnel para o Postgres da EC2 (em outro terminal)
ssh -i chave.pem -N -L 5432:localhost:5432 ec2-user@HOST

# 2. suba a imagem de produção localmente
docker compose -f infra/docker-compose.dev.yml up -d --build
curl http://127.0.0.1:3001/api/health
docker compose -f infra/docker-compose.dev.yml down
```

O compose de desenvolvimento **não sobe PostgreSQL**, e isso é deliberado: as
tabelas de custo pertencem ao ETL, e escrever aqui um `CREATE TABLE` paralelo
produziria um schema que diverge do real sem ninguém perceber.

### Comandos de verificação

```bash
cd web
npx eslint            # lint
npx tsc --noEmit      # typecheck
npx vitest run        # testes unitários
npx next build        # build de produção
```

---

## 7. Como rodar em produção

A imagem é multi-stage e o runtime não tem toolchain de build:

```bash
cd web
docker build -t finops-portal:local .
```

O que a imagem garante:

| | |
|---|---|
| Usuário | `nextjs`, **uid 1001** — não roda como root |
| Filesystem | `read_only: true`, com `/tmp` em tmpfs |
| Capabilities | `cap_drop: ALL`, `no-new-privileges` |
| Segredos | `.env`, `*.pem` e `*.key` bloqueados no `.dockerignore` — não entram no contexto de build |
| Healthcheck | `wget --spider /api/health` a cada 30s, com 25s de carência |
| Memória | teto por `APP_MEM_LIMIT` |

Na EC2 a imagem sobe pelo compose complementar, no **mesmo projeto** do banco —
ver seção 8. Nunca solta, nunca em outro projeto: fora do projeto correto, o
container vai para outra rede e o host `postgres` deixa de resolver.

---

## 8. Como implantar na EC2

```bash
# 1. código
sudo git clone https://github.com/nickolassales-stack/veri-finops-app.git /opt/veri-finops
# (ou: cd /opt/veri-finops && sudo git pull)

# 2. BACKUP do compose atual — mesmo não sendo alterado por nós
cd /opt/finops
cp docker-compose.yml "docker-compose.yml.bak-$(date +%F-%H%M)"

# 3. role da aplicação no banco (uma vez; idempotente)
export APP_PG_PASSWORD="$(openssl rand -base64 24)"
docker exec -i -e APP_PG_PASSWORD="$APP_PG_PASSWORD" finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/create-app-role.sql

# 4. tabelas de autenticação (uma vez; idempotente)
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/create-auth-tables.sql

# 5. período financeiro (migração 001) -- OBRIGATÓRIA ANTES DE SUBIR O PORTAL
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/migrations/001-billing-period.sql

# 6. área administrativa (migração 002) -- aditiva, uma vez; idempotente
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/migrations/002-admin-configuracoes.sql

# 7. monitoramento do ETL (migração 003) -- aditiva, uma vez; idempotente
docker exec -i finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/migrations/003-diagnostico-etl.sql

# 8. variáveis
cp /opt/veri-finops/infra/.env.example /opt/finops/.env
chmod 600 /opt/finops/.env
sudo vi /opt/finops/.env        # APP_BUILD_CONTEXT, APP_PG_USER, APP_PG_PASSWORD
unset APP_PG_PASSWORD

# 9. subir SOMENTE o portal
/opt/veri-finops/scripts/finops-app.sh up
```

> **A ordem do passo 5 não é negociável.** As consultas executivas referenciam
> `billing_period` e `billing_month`. Subir o portal antes da migração faz toda
> tela de custo falhar com `column "billing_month" does not exist`. O inverso é
> seguro: com a migração aplicada e as colunas ainda vazias, o portal se comporta
> exatamente como a versão anterior.

### Passar a bater com o Cost Explorer

A migração só cria as colunas — elas nascem vazias. Quem sabe o período de
cobrança de cada linha é o CUR, então o preenchimento vem de lá:

```bash
cd /opt/finops && source venv/bin/activate
export AWS_REGION=us-east-2 FINOPS_BUCKET=finops-aws-cost-datalake-800168045394
export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=finops PG_USER=finops_user
read -rsp 'senha do postgres: ' PG_PASSWORD; export PG_PASSWORD; echo

# 1. simula e mostra o que faria
python /opt/veri-finops/scripts/backfill-billing-period.py

# 2. aplica
python /opt/veri-finops/scripts/backfill-billing-period.py --aplicar --realinhar-mes

# 3. ETL novo, para as próximas cargas já nascerem corretas
cp /opt/finops/etl/athena_to_postgres.py \
   /opt/finops/etl/athena_to_postgres.py.bak-$(date +%F-%H%M)
cp /opt/veri-finops/scripts/etl/athena_to_postgres.py /opt/finops/etl/

unset PG_PASSWORD
```

`--realinhar-mes` corrige `aws_monthly_costs.month` onde ele aponta para o mês
errado. Nenhum valor de custo é alterado; só a atribuição de mês, que é
regerável a partir do CUR.

**Os passos 2 e 3 são indivisíveis.** Cada um sozinho produz a duplicação que os
dois juntos evitam:

- Realinhar sem trocar o ETL: o ETL antigo deriva o mês da data de uso, não acha
  a linha realinhada, e **insere outra** no mês antigo.
- Trocar o ETL sem realinhar: o ETL novo insere no mês de cobrança e a linha
  antiga permanece no mês de uso.

Em qualquer das duas ordens incompletas o mesmo valor passa a ser contado duas
vezes na tabela mensal. Se precisar parar no meio, pare **antes** do passo 2:
preencher só as colunas do diário — que é a única tabela que o portal lê — é
seguro e já faz o portal bater com o Cost Explorer.

Rode sempre a simulação antes. Ela confere que cada linha do banco casa com no
máximo uma do CUR e **aborta** se a chave for ambígua, em vez de deixar a última
iteração do laço vencer no sorteio. O número de linhas atualizadas nunca deve
passar o tamanho da tabela; se passar, a chave está errada.

O script existe por um motivo: **todo comando termina com o nome do serviço**.
Sem esse nome, o `docker compose` avalia todos os serviços do projeto e pode
recriar o Metabase. Ele também descobre o nome do projeto compose lendo o
container do Postgres em execução — assim o portal entra na rede certa.

Equivalente manual, se preferir:

```bash
cd /opt/finops
docker compose -p "$(docker inspect finops-postgres \
    --format '{{index .Config.Labels "com.docker.compose.project"}}')" \
  -f docker-compose.yml \
  -f /opt/veri-finops/infra/docker-compose.veri-finops.yml \
  up -d --no-deps --build finops-app
```

### Acesso

```bash
ssh -i chave.pem -N -L 3001:localhost:3001 ec2-user@HOST
# abra http://localhost:3001
```

`http://localhost` é contexto seguro para os navegadores, então o cookie
`Secure` funciona nesse fluxo. Para liberar a usuários de gestão: Nginx + HTTPS
na frente, Security Group restrito, e **só então** `APP_BIND=0.0.0.0`.

### Procedimento de atualização

```bash
cd /opt/veri-finops && sudo git pull
scripts/finops-app.sh up        # marca a imagem em uso como :anterior, build e sobe
scripts/finops-app.sh health
```

O `build` preserva a imagem em uso como `finops-portal:anterior` **antes** de
sobrescrever a tag corrente — é isso que dá para onde voltar.

### Cuidados para não parar o Metabase nem o ETL

| Regra | Por quê |
|---|---|
| **Sempre** informe `finops-app` no fim do comando compose | Sem o nome, o compose avalia todos os serviços e pode recriar o Metabase |
| **Nunca** `docker compose down` | Derruba o projeto inteiro — banco e Metabase junto |
| **Nunca** `-v` / `--volumes` | Apagaria `postgres_data`, isto é, o banco |
| **Nunca** publique o portal na porta 3000 | É a do Metabase; ele deixaria de subir no próximo restart |
| Use os **dois** `-f`, no mesmo projeto | Um só coloca o portal em outra rede, e `postgres` deixa de resolver |
| Não edite `/opt/finops/docker-compose.yml` | O portal entra por arquivo complementar, justamente para não precisar |
| Mantenha `APP_MEM_LIMIT` | A JVM do Metabase já sofreu OOM nesta instância |
| Mantenha `APP_PG_POOL_MAX` baixo | O `max_connections` do banco é dividido com o Metabase |

**O ETL segue independente.** Roda fora do compose, escreve nas tabelas de custo
e não sabe que o portal existe.

Depois de qualquer deploy, confirme que nada mais se mexeu:

```bash
scripts/finops-app.sh status     # portal, banco e Metabase, com portas e uptime
curl -so /dev/null -w '%{http_code}\n' http://localhost:3000   # Metabase
```

Um `Up 3 weeks` no Metabase depois de um deploy do portal é a prova de que ele
não foi recriado.

---

## 9. Como fazer rollback

```bash
scripts/finops-app.sh rollback   # volta para finops-portal:anterior, sem rebuild
scripts/finops-app.sh health     # confirma
```

Sobe o binário que funcionava, **sem reconstruir** a partir de um código que
pode ter mudado no disco. Para simplesmente tirar o portal do ar:

```bash
scripts/finops-app.sh down       # remove só o finops-app
```

Nenhum `down` de projeto, nenhum `-v`, nenhum `--force-recreate`. Postgres,
Metabase, volumes e dados permanecem intactos.

Se `finops-portal:anterior` não existir (primeiro deploy), o script recusa e
lista as imagens disponíveis em vez de fazer algo imprevisível.

### Desfazer as migrações

As duas são reversíveis, mas o risco delas é **oposto** e vale saber qual é qual.

| Migração | O que o rollback apaga | Ordem segura |
|---|---|---|
| [001](scripts/migrations/001-billing-period-rollback.sql) | nada que não seja regerável — as colunas voltam a ser preenchidas pelo CUR | derrube o código **antes** do banco |
| [002](scripts/migrations/002-admin-configuracoes-rollback.sql) | **aliases, grupos, vínculos e permissões** — digitados por alguém, não existem em outro lugar | **faça backup antes**; derrube o código antes do banco |

```bash
# backup obrigatório antes do rollback da 002
docker exec finops-postgres pg_dump -U finops_user -d finops \
  -t app_account_settings -t app_groups \
  -t app_user_groups -t app_group_permissions \
  > backup-admin-$(date +%F-%H%M).sql
```

Desfazer a 002 **não** derruba o portal: sem as tabelas, o nome da conta cai de
volta em `cloud_accounts.account_name` e a área de configurações some do menu. O
resto continua de pé.

---

## 10. Como validar o dashboard

Depois de subir, com sessão aberta em `/dashboard`:

| # | O que conferir | Como saber que está certo |
|---|---|---|
| 1 | **Login** | Senha errada devolve "E-mail ou senha incorretos" sem dizer se o e-mail existe |
| 2 | **Rota protegida** | Em aba anônima, `/dashboard` redireciona para `/login?next=%2Fdashboard` |
| 3 | **Dado real** | O total bate com `SELECT sum(cost_amount) FROM aws_daily_costs WHERE usage_date BETWEEN …` |
| 4 | **Filtro de período** | Trocar entre 7 dias / 30 dias / mês atual muda os KPIs e a URL |
| 5 | **Uma conta** | Selecionar uma conta reduz o total; o rodapé indica a conta aplicada |
| 6 | **Várias contas** | Duas contas somam os dois valores |
| 7 | **Todas as contas** | Volta ao total geral |
| 8 | **Cotação** | O card mostra valor, data de referência e fonte (PTAX) |
| 9 | **Fallback da cotação** | Com `EXCHANGE_RATE_PROVIDER=nenhum`, o card mostra "—", **os valores em USD continuam** e a tela não quebra |
| 10 | **Sem dado ≠ zero** | Conta sem carga no período aparece como "sem dado", não como US$ 0,00 |
| 11 | **Bate com o Cost Explorer** | Selecione um mês fechado e compare com o Cost Explorer (ver abaixo) |

### Conferir contra o AWS Cost Explorer

No Cost Explorer: **Monthly** · filtro *Linked Account* = a conta · o mês
desejado · métrica **Unblended costs**. É esse número que o card
**"Custo total do período de cobrança"** reproduz.

```bash
# reconciliação completa, com o fechamento aritmético
docker exec -i finops-postgres psql -U finops_user -d finops -X --no-psqlrc \
  -v conta=800168045394 -v periodo=2026-07 \
  < scripts/reconciliacao-cost-explorer.sql
```

O script mostra as duas leituras lado a lado, lista as linhas deslocadas que
explicam a diferença e confirma que `operacional + deslocado = financeiro`.

> **Não compare o gráfico de evolução diária com o Cost Explorer mensal.** Ele
> soma por data de uso e vai divergir sempre que houver cobrança pontual — por
> desenho, não por erro. Quando isso acontece, o portal exibe um aviso dizendo
> quanto e quantos lançamentos.

Na tela **Analítico**: a paginação deve dizer o total de lançamentos do filtro
(não da página), a ordenação por coluna deve mudar a ordem no servidor, e a
busca por serviço deve filtrar sem recarregar a página inteira.

---

## 11. Como validar as exportações

Na tela `/dashboard/analitico`, com um filtro aplicado:

| # | O que conferir | Esperado |
|---|---|---|
| 1 | **Baixar CSV** | Arquivo `veri-finops-AAAA-MM-DD_AAAA-MM-DD.csv` |
| 2 | **Baixar Excel** | Arquivo `.xlsx` com o mesmo período no nome |
| 3 | **Mesmos filtros** | O arquivo traz **todas** as linhas do filtro, não só a página visível |
| 4 | **Cabeçalho de contexto** | Período, contas, data/hora da exportação, cotação usada e o aviso de que BRL é estimativa |
| 4b | **Período de cobrança** | Primeira coluna do arquivo. É o que explica uma linha com data de uso fora do período selecionado |
| 5 | **CSV no Excel pt-BR** | Abre com colunas separadas e acentos corretos (BOM UTF-8, separador `;`, decimal com vírgula) |
| 6 | **Sem sessão** | `curl` sem cookie em `/api/export/csv` responde **401** |
| 7 | **Acima do teto** | Filtro maior que `EXPORT_MAX_ROWS` responde **413** com mensagem pedindo para estreitar — nunca arquivo truncado |

```bash
# 6 — exportação exige sessão
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/export/csv   # 401

# 7 — teto: reinicie com um valor baixo para ver a recusa
EXPORT_MAX_ROWS=5 docker compose -f infra/docker-compose.dev.yml up -d
```

As duas rotas aplicam **exatamente** o mesmo filtro da tela — não por
coincidência, mas porque tela e exportação compartilham o mesmo esquema Zod
(`src/lib/services/parametros-analiticos.ts`) e a mesma cláusula `WHERE`
(`condicoesAnaliticas` em `src/lib/queries/analitico.ts`). Não há um segundo
caminho que possa divergir.

---

## 12. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `unhealthy` logo após subir | O portal não alcança o Postgres | `docker logs finops-portal`. Confira `APP_PG_USER`/`APP_PG_PASSWORD` e se o role existe |
| `getaddrinfo ENOTFOUND postgres` | O portal subiu em **outro projeto** compose, logo em outra rede | Use `scripts/finops-app.sh up`, que lê o projeto do container do Postgres |
| `password authentication failed` | Role da aplicação inexistente ou senha errada | Rode `scripts/create-app-role.sql`. Ver RUNBOOK seção 5 |
| Erro de porta em uso ao subir | `APP_PORT` colidindo (3000 é do Metabase) | Volte para `APP_PORT=3001` |
| Login não fecha; volta para `/login` | `AUTH_COOKIE_SECURE=true` sem HTTPS e sem ser localhost | Acesse por túnel SSH, ou ponha HTTPS na frente. **Não** desligue o `Secure` em produção |
| `/api/health` responde só `{"ok":…}` | Comportamento correto: o detalhe (versão, banco, erro) só sai com sessão | Para diagnosticar, veja `docker logs finops-portal` — o erro do driver é registrado lá |
| `column "billing_month" does not exist` | O portal subiu **antes** da migração 001 | Rode a migração e reinicie. Ver seção 8, passo 5 |
| As telas seguem em erro 500 **depois** de aplicar a migração | Processo antigo servindo código já compilado — vale para `next dev` e para o container | Reinicie o processo. Confirme com `curl` num endpoint: se a API responde 200 e a tela não, o que está velho é o navegador ou o servidor, não o banco |
| O total continua sem bater com o Cost Explorer | Migração aplicada, mas o backfill não rodou | `scripts/backfill-billing-period.py --aplicar --realinhar-mes`. A consulta 5 do script de reconciliação mostra a cobertura |
| O mesmo valor aparece duas vezes na tabela mensal | Backfill rodou sem `--realinhar-mes` | Reexecute com a opção. A carga mensal insere no mês certo e a linha antiga fica no errado |
| Tela em branco / erro 500 nas telas de dado | Banco fora, ou schema diferente do esperado | `curl localhost:3001/api/health`; `/dashboard/diagnostico` mostra a última carga do ETL |
| Diagnóstico diz "monitoramento não instalado" | Migração 003 não aplicada | Rode `scripts/migrations/003-diagnostico-etl.sql`. O portal e o ETL **não** caem por isso; a checagem é refeita a cada 30 s, sem reiniciar |
| Diagnóstico acusa atraso e a carga rodou | O cron mudou e `ETL_HORARIO_ESPERADO` não | O horário é declarado, não lido do crontab. Compare `crontab -l` com a variável — lembrando que o cron está em **UTC** |
| Execução presa em "Em execução" | Processo morto sem gravar o fim (OOM, reboot) | Passado `ETL_EXECUCAO_ORFA_MINUTOS`, a tela já mostra "interrompida"; a carga seguinte fecha o registro. Para agora: `register-etl-status.py --fechar-orfas` |
| Todas as execuções aparecem como "não identificada" | O cron chama `run-etl.sh` direto, sem o wrapper | Esperado e inofensivo. Para identificar, aponte o cron para `run-etl-with-status.sh` (ver seção 3) |
| "Sem dado no mês corrente" logo depois da virada do mês | A AWS ainda não fechou o primeiro CUR do mês | Normal nos primeiros dias. Vira problema se persistir com as outras contas já carregadas |
| "Mês sem carga no meio da série" | Partição do Athena não adicionada para aquele mês | `add_partition.sql` na EC2, depois reexecute a carga. O alerta ignora as pontas de propósito — só acusa buraco no meio |
| `403 sem-permissao` | Falta a permissão que a rota exige | Esperado. A resposta e a tela `/sem-permissao` **nomeiam** a permissão; conceda-a a um grupo do usuário em Configurações › Permissões |
| Concedi a permissão e a pessoa continua sem acesso | A resolução é memoizada **por requisição**; a aba aberta ainda usa a anterior | Recarregar a página basta. Se persistir: o grupo está inativo, ou o vínculo usuário-grupo não foi salvo |
| Área de configurações responde erro, resto do portal íntegro | Migração 002 não aplicada | Rode `scripts/migrations/002-admin-configuracoes.sql`. O portal **não** cai por isso: sem a tabela, o alias volta a `account_name` e o menu esconde a seção |
| O alias não aparece nos filtros nem nas exportações | Migração 002 ausente, ou o campo foi salvo vazio | Campo em branco é "sem alias" de propósito, e volta ao nome do cadastro. Confira em Configurações › Contas AWS |
| Não consigo desativar um usuário | É você mesmo, ou é o último ADMIN ativo | Comportamento deliberado: sem as duas travas, um clique deixaria o sistema sem administrador e a volta só existiria pelo banco. Promova outro antes |
| Exportação responde 413 | O filtro seleciona mais que `EXPORT_MAX_ROWS` | Estreite período/contas, ou suba o teto **e** `APP_MEM_LIMIT` juntos |
| Cotação some da tela, custo continua | Saída HTTPS para o BCB bloqueada | Esperado: o portal segue em USD. `EXCHANGE_RATE_PROVIDER=nenhum` silencia o aviso |
| "Muitas tentativas. Tente novamente em N minutos" | 5 falhas de login em 15 min pelo mesmo par e-mail+IP | Espere 5 minutos. É proteção contra força bruta |
| `EBUSY` / `resource busy` no build local | Um `server.js` do standalone ainda rodando | Pare o processo antes de reconstruir |
| Build falha por falta de memória na EC2 | Build do Next concorrendo com a JVM do Metabase | Construa em horário de baixo uso, ou faça `build` e `up` em passos separados |

---

## 13. Limitações conhecidas

**Operação e segurança**

1. **Não há HTTPS.** O acesso é por túnel SSH para `127.0.0.1`. Antes de expor o
   portal a usuários de gestão (`APP_BIND=0.0.0.0`), é obrigatório Nginx +
   HTTPS + Security Group restrito. Sem isso, sessão e dado financeiro trafegam
   em claro.
2. **O bloqueio de força bruta é por processo.** Fica na memória do container
   (5 tentativas / 15 min, bloqueio de 5 min). Com mais de uma réplica, cada uma
   conta separado. A evolução natural é uma tabela ou Redis.
3. **Não há "esqueci minha senha".** A recuperação é operacional: reexecutar
   `create-admin.mjs` com o mesmo e-mail redefine a senha.
4. **A sessão não renova.** Expira em `AUTH_SESSION_TTL_HOURS` (12h) contadas do
   login, mesmo com uso contínuo.
5. **`/api/health` é a única rota sem sessão** — necessária para o HEALTHCHECK do
   container. Ela devolve só `status` e `db.ok` a quem não está autenticado.
6. **O deploy na EC2 ainda não foi executado.** Toda a validação até aqui foi
   local, incluindo uma simulação fiel da pilha da EC2.

**Produto**

7. **Telas de governança não existem.** `/contas`, `/orcamentos` e `/alertas`
   estão no schema do banco, mas não têm interface. Só há leitura de custo.
8. **BRL é estimativa.** Não considera spread nem IOF da fatura e nunca é
   gravado. Para contabilidade, use o USD.
9. **A exportação XLSX monta a planilha inteira em memória** antes de compactar
   — é o que `EXPORT_MAX_ROWS` protege. O CSV é transmitido em streaming e não
   tem esse custo. Se subir o teto, suba `APP_MEM_LIMIT` junto.

**Identidade visual**

10. **As fontes oficiais não estão aplicadas.** Ador Hairline e Mr Eaves San OT
    são licenciadas via Adobe Fonts e o kit não está no `<head>`. Os nomes
    oficiais já vêm primeiro na pilha CSS: adicionar o kit passa a valer sem
    mudar mais nada.
11. **Não há tema escuro.** O brandbook não define paleta para fundo escuro, e
    criar uma seria inventar identidade visual.
12. **A paleta tem dois tons de tinta, não três.** Estados como "sem dado" e
    "indisponível" são distinguidos pelo **conteúdo**, não por um cinza mais
    claro — não existe um terceiro tom que passe em contraste nesta paleta.

**Dado**

13. **Há um "serviço" anômalo na base:** `dwqdkp3l0lnh14y2rkq6m7l2x`, com ~86% do
    custo do mês. O nome não é de um serviço AWS. Precisa ser investigado na
    origem (Athena/CUR), não no portal.
14. **O gráfico diário não bate com o card financeiro** quando há cobrança
    pontual no período — e isso é correto. São perguntas diferentes: o card
    segue a fatura, o gráfico segue o dia de uso. A tela avisa quando ocorre.
15. **`region` é gravada como a string `"nan"`** quando o CUR não informa a zona
    (o ETL faz `str()` sobre um `NaN` do pandas). O portal traduz para "não
    informada" na leitura. Corrigir na origem mudaria o valor da chave única e
    criaria linhas duplicadas — precisa de migração própria.
16. **O filtro por período de cobrança tem granularidade de mês.** Num recorte
    de dias (últimos 7 dias, personalizado), uma cobrança deslocada é atribuída
    ao recorte se o mês da fatura dela estiver dentro dele. É a atribuição menos
    errada possível: a alternativa seria o valor sumir de todas as telas.

**Desenvolvimento**

15. **No `next dev`, abrir `/dashboard/analitico?busca=…` direto na URL trava o
    carregamento.** Não acontece na imagem de produção (8 formatos de URL
    verificados). A causa raiz não foi fechada; para conferir essa tela, use o
    compose de desenvolvimento, que roda a imagem de produção.

---

## 14. Checklist de homologação

Copie e marque. Os comandos assumem o portal em `http://localhost:3001`.

### Segurança

- [ ] `git ls-files | grep -iE '\.env$|\.pem$|\.key$'` **não retorna nada**
- [ ] `git check-ignore infra/.env web/.env.local` → todos ignorados
- [ ] Cookie de sessão tem `HttpOnly`, `Secure` e `SameSite=Lax`
- [ ] `/dashboard`, `/dashboard/analitico`, `/conta` sem sessão → **307** para `/login?next=…`
- [ ] `/api/dashboard/*` sem sessão → **401**
- [ ] `/api/export/csv` e `/api/export/xlsx` sem sessão → **401**
- [ ] Senha em **scrypt** com salt por usuário e comparação em tempo constante
- [ ] Não existe rota nem ação de cadastro público
- [ ] Toda query usa `$1, $2…`; ordenação vem de lista fechada
- [ ] Toda rota de API valida entrada com **Zod**
- [ ] Nenhum componente de cliente importa `pg` ou `@/lib/database`
- [ ] `finops_app` tem **só `SELECT`** em `aws_daily_costs` / `aws_monthly_costs`

```bash
curl -s -o /dev/null -w 'summary %{http_code}\n' localhost:3001/api/dashboard/summary
curl -s -o /dev/null -w 'csv     %{http_code}\n' localhost:3001/api/export/csv
docker exec finops-postgres psql -U finops_user -d finops -c \
  "SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE grantee='finops_app' AND table_name LIKE 'aws_%';"
```

### Funcionalidade

- [ ] Login · [ ] Logout · [ ] Redirecionamento sem sessão
- [ ] Dashboard com dado real do PostgreSQL
- [ ] Filtro por período · [ ] uma conta · [ ] várias contas · [ ] todas
- [ ] Cotação USD/BRL exibida com data e fonte
- [ ] Fallback da cotação: com `EXCHANGE_RATE_PROVIDER=nenhum` a tela segue em USD
- [ ] Tabela analítica paginada no servidor
- [ ] Export CSV · [ ] Export XLSX (seção 11)
- [ ] **Reconcilia com o Cost Explorer**: um mês fechado bate com *Unblended costs*
- [ ] O analítico do mesmo período soma o mesmo que o card
- [ ] Somar todos os períodos devolve o total da base (nada em dobro, nada perdido)

```bash
docker exec -i finops-postgres psql -U finops_user -d finops -X --no-psqlrc \
  -v conta=800168045394 -v periodo=2026-07 \
  < scripts/reconciliacao-cost-explorer.sql      # consulta 3: confere = t
```

### Performance

- [ ] Somas e contagens saem prontas do banco, não do navegador
- [ ] Analítico não carrega o histórico inteiro (máx. 200 linhas/página)
- [ ] Exportação em lotes de 2.000 linhas, com teto `EXPORT_MAX_ROWS`
- [ ] Cotação em cache (TTL) com deduplicação de chamadas simultâneas

### Identidade visual

- [ ] Só cores da paleta VERI
- [ ] Logo oficial, versão primária sobre fundo claro, sem distorção
- [ ] Contraste WCAG AA em todo texto
- [ ] Layout responsivo (o cabeçalho mostra o usuário também no celular)
- [ ] HTML semântico: `<header>`, `<main>`, `<nav>`, `<table>`, `<dl>`, labels

### Operação

- [ ] `npx eslint` · [ ] `npx tsc --noEmit` · [ ] `npx vitest run` · [ ] `npx next build`
- [ ] `docker build -t finops-portal:local .`
- [ ] `docker compose config` na pilha mesclada (EC2 + portal)
- [ ] `/api/health` responde **200**
- [ ] `scripts/finops-app.sh rollback` volta para `:anterior`
- [ ] **Metabase intacto**: mesmo container id e mesmo `StartedAt` antes e depois do deploy
- [ ] **PostgreSQL sem porta pública**: `docker ps` mostra `127.0.0.1:5432` e nada mais

```bash
docker inspect finops-metabase --format 'id={{.Id}} iniciado={{.State.StartedAt}} reinicios={{.RestartCount}}'
docker ps --format '{{.Names}}: {{.Ports}}'
```

---

## Regras do projeto

- Dado de custo vem **apenas** do PostgreSQL. Nunca Athena, S3 ou API AWS.
- A única chamada externa é a cotação USD/BRL no Banco Central, e ela é
  dispensável: se falhar, o portal segue exibindo USD.
- Valor oficial é **USD**. O BRL é estimativa visual e nunca é gravado.
- O PostgreSQL não tem exposição pública; o Metabase e o ETL seguem intocados.
- Nenhum dado mockado: sem banco, a tela mostra erro em vez de número inventado.
- Segredos nunca são versionados. Ver [infra/.env.example](infra/.env.example).
- Cores apenas da paleta oficial VERI.
