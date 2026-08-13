# veri-finops-app

Portal FinOps da VERI: custos AWS consolidados, governança de contas e
orçamentos, sobre o PostgreSQL do pipeline FinOps existente.

## Onde está o quê

| Caminho | Conteúdo |
|---|---|
| [web/](web/) | Aplicação Next.js 16 + TypeScript. **[README da aplicação](web/README.md)** — autenticação, telas, API, exportação e convenções |
| [infra/](infra/) | Composes de produção e de desenvolvimento, e o `.env.example` |
| [scripts/](scripts/) | Operação do container, inspeção do schema, criação do role e das tabelas de auth |
| [docs/](docs/) | Runbook, schema real do banco, decisões de visualização, brandbook VERI |
| [assets/logos/](assets/logos/) | Identidade visual VERI |

### Documentos principais

- **[docs/RUNBOOK-app.md](docs/RUNBOOK-app.md)** — deploy detalhado, role do banco, riscos
- **[docs/schema-snapshot.md](docs/schema-snapshot.md)** — schema real e achados de qualidade do dado
- **[docs/API-dados.md](docs/API-dados.md)** — endpoints, filtros e contrato de resposta
- **[docs/DECISOES-dataviz.md](docs/DECISOES-dataviz.md)** — paleta validada e regras de gráfico
- **[docs/skill-veri.md](docs/skill-veri.md)** — Brandbook VERI v2.0

---

## Arquitetura

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

## Variáveis de ambiente

Modelo completo e comentado: **[infra/.env.example](infra/.env.example)**.
O `.env` real vive ao lado do `docker-compose.yml` da EC2, com `chmod 600`, e
**nunca** é versionado.

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

> `docker compose config` **imprime os valores interpolados**, inclusive senhas.
> Use com cuidado em terminal compartilhado ou log de CI.

---

## Desenvolvimento local

**Escrevendo código** — use o servidor de desenvolvimento, que tem Fast Refresh:

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

> Uma ressalva do `next dev`: a tela `/dashboard/analitico` carregada
> diretamente com `?busca=` na URL fica presa no carregamento **no servidor de
> desenvolvimento**. Não acontece na imagem de produção. Para conferir essa
> tela, use o compose acima.

---

## Produção na EC2

### Deploy

```bash
# 1. código
sudo git clone https://github.com/nickolassales-stack/veri-finops-app.git /opt/veri-finops
# (ou: cd /opt/veri-finops && sudo git pull)

# 2. BACKUP do compose atual — mesmo não sendo alterado por nós
cd /opt/finops
cp docker-compose.yml "docker-compose.yml.bak-$(date +%F-%H%M)"

# 3. variáveis
cp /opt/veri-finops/infra/.env.example /opt/finops/.env
chmod 600 /opt/finops/.env
sudo vi /opt/finops/.env        # APP_BUILD_CONTEXT, APP_PG_USER, APP_PG_PASSWORD

# 4. subir SOMENTE o portal
/opt/veri-finops/scripts/finops-app.sh up
```

O script existe por um motivo: **todo comando termina com o nome do serviço**.
Sem esse nome, o `docker compose` avalia todos os serviços do projeto e pode
recriar o Metabase. Ele também descobre o nome do projeto compose lendo o
container do Postgres em execução — assim o portal entra na rede certa, onde o
nome `postgres` resolve.

Equivalente manual, se preferir:

```bash
cd /opt/finops
docker compose -p "$(docker inspect finops-postgres \
    --format '{{index .Config.Labels "com.docker.compose.project"}}')" \
  -f docker-compose.yml \
  -f /opt/veri-finops/infra/docker-compose.veri-finops.yml \
  up -d --no-deps --build finops-app
```

### Seed do administrador

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

A senha não é exibida nem registrada em log. O mesmo comando **atualiza** a
senha de um e-mail já existente.

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
sobrescrever a tag corrente — é isso que dá para onde voltar. Postgres, Metabase
e volumes não são tocados em nenhum momento.

### Rollback

```bash
scripts/finops-app.sh rollback   # volta para finops-portal:anterior, sem rebuild
```

Sobe o binário que funcionava, sem reconstruir a partir de um código que pode
ter mudado no disco. Para simplesmente tirar o portal do ar:

```bash
scripts/finops-app.sh down       # remove só o finops-app
```

Nenhum `down` de projeto, nenhum `-v`, nenhum `--force-recreate`. Postgres,
Metabase, volumes e dados permanecem intactos.

---

## Cuidados para não parar o Metabase nem o ETL

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
e não sabe que o portal existe. O portal só **lê** essas tabelas — o role
`finops_app` tem `SELECT` nelas e escrita apenas nas de governança
(ver [scripts/create-app-role.sql](scripts/create-app-role.sql)).

Depois de qualquer deploy, confirme que nada mais se mexeu:

```bash
scripts/finops-app.sh status     # portal, banco e Metabase, com portas e uptime
curl -so /dev/null -w '%{http_code}\n' http://localhost:3000   # Metabase
```

Um `Up 3 weeks` no Metabase depois de um deploy do portal é a prova de que ele
não foi recriado.

---

## Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `unhealthy` logo após subir | O portal não alcança o Postgres | `docker logs finops-portal`. Confira `APP_PG_USER`/`APP_PG_PASSWORD` e se o role existe |
| `getaddrinfo ENOTFOUND postgres` | O portal subiu em **outro projeto** compose, logo em outra rede | Use `scripts/finops-app.sh up`, que lê o projeto do container do Postgres |
| `password authentication failed` | Role da aplicação inexistente ou senha errada | Rode `scripts/create-app-role.sql`. Ver RUNBOOK seção 5 |
| Erro de porta em uso ao subir | `APP_PORT` colidindo (3000 é do Metabase) | Volte para `APP_PORT=3001` |
| Login não fecha; volta para `/login` | `AUTH_COOKIE_SECURE=true` sem HTTPS e sem ser localhost | Acesse por túnel SSH, ou ponha HTTPS na frente. **Não** desligue o `Secure` em produção |
| Tela em branco / erro 500 nas telas de dado | Banco fora, ou schema diferente do esperado | `curl localhost:3001/api/health` mostra o estado do banco; `/diagnostico` (ADMIN) mostra a última carga do ETL |
| `403 sem-permissao` | Perfil `VIEWER` acessando rota de ADMIN | Esperado. Ajuste o papel do usuário |
| Exportação responde 413 | O filtro seleciona mais que `EXPORT_MAX_ROWS` | Estreite período/contas, ou suba o teto **e** `APP_MEM_LIMIT` juntos |
| Cotação some da tela, custo continua | Saída HTTPS para o BCB bloqueada | Esperado: o portal segue em USD. `EXCHANGE_RATE_PROVIDER=nenhum` silencia o aviso |
| `EBUSY` / `resource busy` no build local | Um `server.js` do standalone ainda rodando | Pare o processo antes de reconstruir |
| Build falha por falta de memória na EC2 | Build do Next concorrendo com a JVM do Metabase | Construa em horário de baixo uso, ou faça `build` e `up` em passos separados |

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
