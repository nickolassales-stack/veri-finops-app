# VERI FinOps — Portal de custos AWS

Portal interno que mostra o custo AWS da VERI a partir do **PostgreSQL do
pipeline FinOps que já existe**. Entra ao lado do Metabase e do ETL, sem
substituir nem alterar nenhum dos dois.

| | |
|---|---|
| **Seções** | [1. Resumo](#1-resumo-da-aplicação) · [2. Arquitetura](#2-arquitetura) · [3. Fluxo de dados](#3-fluxo-de-dados) · [4. Variáveis](#4-variáveis-de-ambiente) · [5. Primeiro admin](#5-como-criar-o-primeiro-admin) · [6. Rodar local](#6-como-rodar-local) · [7. Rodar em produção](#7-como-rodar-em-produção) · [8. Implantar na EC2](#8-como-implantar-na-ec2) · [9. Rollback](#9-como-fazer-rollback) · [10. Validar dashboard](#10-como-validar-o-dashboard) · [11. Validar exportações](#11-como-validar-as-exportações) · [12. Troubleshooting](#12-troubleshooting) · [13. Limitações](#13-limitações-conhecidas) · [14. Homologação](#14-checklist-de-homologação) |

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
| [scripts/etl/athena_to_postgres.py](scripts/etl/athena_to_postgres.py) | Carga Athena → PostgreSQL. Roda na EC2, em `/opt/finops/etl/` |
| [scripts/backfill-billing-period.py](scripts/backfill-billing-period.py) | Preenche o período de cobrança nas linhas já carregadas |
| [scripts/reconciliacao-cost-explorer.sql](scripts/reconciliacao-cost-explorer.sql) | Confere o portal contra o AWS Cost Explorer |

---

## 1. Resumo da aplicação

Três telas, atrás de login, alimentadas pelo PostgreSQL do FinOps:

| Tela | Rota | Quem vê | O que faz |
|---|---|---|---|
| **Visão executiva** | `/dashboard` | qualquer sessão | KPIs do período, custo por conta, maiores serviços, evolução diária, distribuição percentual |
| **Analítico** | `/dashboard/analitico` | qualquer sessão | Tabela paginada de lançamentos, com filtros e **exportação CSV/XLSX** |
| **Diagnóstico** | `/diagnostico` | `ADMIN` | Última carga do ETL, cobertura do dado, saúde do banco |
| **Minha conta** | `/conta` | qualquer sessão | Troca de senha |

**Papéis:** `ADMIN` e `VIEWER`. Esconder o link do menu não é a proteção — a
autorização real está em `requirePapel()` dentro da rota.

**Não existe cadastro público.** O primeiro administrador é criado por comando
pontual (seção 5) e ele cria os demais pelo mesmo comando.

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

## 5. Como criar o primeiro admin

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

# 6. variáveis
cp /opt/veri-finops/infra/.env.example /opt/finops/.env
chmod 600 /opt/finops/.env
sudo vi /opt/finops/.env        # APP_BUILD_CONTEXT, APP_PG_USER, APP_PG_PASSWORD
unset APP_PG_PASSWORD

# 7. subir SOMENTE o portal
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
errado. Sem isso, a próxima carga mensal insere uma linha nova no mês certo e
mantém a antiga no errado — o mesmo valor contado duas vezes. Nenhum valor de
custo é alterado; só a atribuição de mês, que é regerável a partir do CUR.

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
| O total continua sem bater com o Cost Explorer | Migração aplicada, mas o backfill não rodou | `scripts/backfill-billing-period.py --aplicar --realinhar-mes`. A consulta 5 do script de reconciliação mostra a cobertura |
| O mesmo valor aparece duas vezes na tabela mensal | Backfill rodou sem `--realinhar-mes` | Reexecute com a opção. A carga mensal insere no mês certo e a linha antiga fica no errado |
| Tela em branco / erro 500 nas telas de dado | Banco fora, ou schema diferente do esperado | `curl localhost:3001/api/health`; `/diagnostico` (ADMIN) mostra a última carga do ETL |
| `403 sem-permissao` | Perfil `VIEWER` acessando rota de ADMIN | Esperado. Ajuste o papel do usuário |
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
