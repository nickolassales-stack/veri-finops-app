# Runbook — Portal FinOps VERI (aplicação web)

> Complementa `documentacao_finops_aws_dashboard.docx` (arquitetura do pipeline) e
> `pop_adicionar_nova_conta_finops_aws.docx` (onboarding de conta AWS).
> Aqui trata-se apenas do **serviço novo**: a aplicação web que consome o PostgreSQL.

---

## 1. O que é, e o que deliberadamente não é

| | |
|---|---|
| **É** | Aplicação Next.js 16 (TypeScript), servidor Node, um único container Docker |
| **Consome** | O PostgreSQL `finops`, pela rede interna do compose. Todo dado de custo vem daí |
| **Consome também** | HTTPS para o Banco Central, só para a cotação USD/BRL. Dispensável: se falhar, o portal segue em USD (`EXCHANGE_RATE_PROVIDER=nenhum` desliga) |
| **Não consome** | Athena, Glue, S3 ou qualquer API AWS — a aplicação não tem credencial AWS |
| **Não altera** | Containers `finops-postgres` e `finops-metabase`, o `docker-compose.yml` atual, o ETL, o Metabase |
| **Não contém** | Dado mockado. Toda tela lê o banco real; sem banco, a tela mostra erro em vez de número inventado |

O Metabase continua sendo a ferramenta de exploração ad-hoc. A aplicação é a
camada de visão executiva e governança.

---

## 2. Arquitetura do serviço

```
                    rede interna do compose (bridge)
  ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
  │ finops-portal    │───────>│ postgres:5432    │<───────│ finops-metabase  │
  │ (Next.js, :3000) │  DNS   │ (finops-postgres)│        │ (:3000 -> :3000) │
  └────────┬─────────┘        └──────────────────┘        └──────────────────┘
           │ publicado em 127.0.0.1:8080 na EC2 (APP_PORT no .env)
           v
  ┌──────────────────────┐
  │ nginx-proxy-manager  │  rede npm-public, alcanca finops-portal:3000
  │ 80/443 publicas      │  /opt/nginx-proxy-manager
  └──────────┬───────────┘
             v
   https://nexeeo.com  ·  www.nexeeo.com  ·  finops.nexeeo.com
   HTTPS ATIVO -- Let's Encrypt, um certificado para os tres nomes
```

Dominio de producao: **`nexeeo.com`**, com dois `e`. `nexxeo.com` (dois `x`) e de
terceiro e foi usado por engano em documentacao anterior.

- A porta 5432 continua publicada **apenas** em `127.0.0.1` pelo compose original.
  A aplicação nunca precisa dela: fala com `postgres` por DNS interno.
- Única saída para fora: HTTPS ao Banco Central (`olinda.bcb.gov.br`,
  `api.bcb.gov.br`) para a cotação USD/BRL. Verificado em 06/08/2026 que host e
  container alcançam os dois. Se o egress for fechado no futuro, defina
  `EXCHANGE_RATE_PROVIDER=nenhum` — o portal continua funcionando, só em USD.
- `PG_POOL_MAX=5` e `statement_timeout=15s` protegem o banco compartilhado com o Metabase.
- Limite de memória de 512 MiB no container. Medido em teste: **~49 MiB em uso**.
  A instância tem ~4 GiB e o Metabase (JVM) já sofreu OOM nela — daí o teto.

---

## 3. Arquivos

| Arquivo | Papel |
|---|---|
| `web/` | Aplicação Next.js |
| `web/Dockerfile` | Imagem multi-stage, `output: standalone`, roda como uid 1001 (não-root) |
| `infra/docker-compose.veri-finops.yml` | **Complementar.** Só adiciona o serviço `finops-app` |
| `infra/docker-compose.dev.yml` | Roda a imagem de produção na máquina do dev, contra um Postgres alcançável |
| `infra/.env.example` | Modelo de variáveis. O `.env` real nunca é versionado |
| `infra/docker-compose.current.yml` | Snapshot do compose em produção — **referência, não editar** |
| `scripts/finops-app.sh` | Operação do container: `build`, `up`, `logs`, `health`, `status`, `rollback`, `down` |
| `scripts/inspect-schema.sql` | Inspeção somente-leitura do schema |
| `scripts/inspect-schema.sh` | Wrapper (SSH ou local) da inspeção |
| `scripts/etl/athena_to_postgres.py` | A carga Athena → PostgreSQL, com registro de execução. **Roda na EC2, fora do compose** |
| `scripts/run-etl-with-status.sh` | Chama o `run-etl.sh` da EC2 informando a origem. Não substitui nem guarda credencial |
| `scripts/register-etl-status.py` | Registro manual de execução e conserto de execução travada |
| `scripts/migrations/003-diagnostico-etl.sql` | `app_etl_runs` + view `app_data_freshness` (+ rollback) |

---

## 4. Inspecionar o schema real (antes de qualquer query nova)

Regra do projeto: **nunca assumir o schema a partir da documentação.** As tabelas
citadas nos `.docx` (`cloud_accounts`, `aws_daily_costs`, `aws_monthly_costs`,
`cloud_budgets`, `cost_alerts`) precisam ser confirmadas no banco real, com tipos,
constraints e índices, antes de escrever a query final.

O script só executa `SELECT` sobre o catálogo e força a sessão para read-only na
primeira instrução. Não faz DDL, DML, restart nem alteração de arquivo.

```bash
# Da estação de trabalho, via SSH:
SSH_TARGET=ubuntu@<ip-da-ec2> SSH_KEY=~/.ssh/<chave>.pem ./scripts/inspect-schema.sh

# Ou dentro da própria EC2 FinOps:
./scripts/inspect-schema.sh
```

Saída em `scripts/out/schema-snapshot-<timestamp>.txt` (ignorado pelo git — pode
conter dados de custo; revise antes de versionar qualquer trecho).

---

## 5. Usuário do banco para a aplicação

Script: [`scripts/create-app-role.sql`](../scripts/create-app-role.sql), escrito
sobre o schema real já inspecionado ([`schema-snapshot.md`](schema-snapshot.md)).

```bash
# na EC2, a partir do repositório clonado
openssl rand -base64 24                       # gere e guarde no .env do compose
export APP_PG_PASSWORD='<a-senha-gerada>'
docker exec -i -e APP_PG_PASSWORD="$APP_PG_PASSWORD" finops-postgres \
  psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
  < scripts/create-app-role.sql
unset APP_PG_PASSWORD
```

É aditivo e idempotente (reexecutar serve para rotação de senha): cria o role,
concede privilégios e imprime a verificação. Não cria, altera ou remove tabela,
coluna, dado, view ou constraint, e não toca em `finops_user`/`metabase_user`.

Princípios aplicados:

- **Não reutilizar `finops_user`** (dono do schema, usado pelo ETL). O portal recebe
  um role próprio, `finops_app`, com permissão mínima.
- O limite entre leitura e escrita é imposto pelo **banco**, não pelo código:
  - `SELECT` nas tabelas de custo (`aws_daily_costs`, `aws_monthly_costs`, ...).
  - `INSERT/UPDATE/DELETE` **apenas** nas tabelas de governança
    (`cloud_accounts`, `cloud_budgets`, `cost_alerts`).
  - **Nenhuma** permissão de escrita nas tabelas alimentadas pelo ETL — dado de
    custo é imutável pela aplicação.
- O `GRANT` é aditivo e não destrutivo, mas ainda assim exige aprovação explícita
  antes de rodar em produção.
- A página `/dashboard/diagnostico` mostra os privilégios efetivos do usuário conectado,
  lidos do próprio banco — use-a para conferir o resultado do GRANT.

---

## 5.1 Autenticação

Detalhes de uso estão em [`../web/README.md`](../web/README.md#autenticação).
Aqui fica o essencial de operação.

**Modelo:** e-mail + senha, hash `scrypt` do `node:crypto`, sessão opaca
persistida em `app_sessions` e cookie HTTP-only. Sem biblioteca de auth — a
justificativa técnica está no commit de implementação. Sem cadastro público.

**Tabelas** (criadas por [`../scripts/create-auth-tables.sql`](../scripts/create-auth-tables.sql),
aditivo e idempotente):

| Tabela | Papel |
|---|---|
| `app_users` | usuários, perfil (`ADMIN` \| `VIEWER`), hash da senha |
| `app_sessions` | sessões ativas; guarda **só o SHA-256** do token, nunca o token |

A separação de privilégio continua valendo: `finops_app` escreve nas tabelas
`app_*` e nas 3 de governança, e segue **somente-leitura** nas tabelas de custo
do ETL.

**Criar ou redefinir um usuário** (a senha só existe no ambiente da execução):

```bash
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
docker exec -i -e ADMIN_EMAIL="nome@porveri.com.br" -e ADMIN_PASSWORD \
  finops-portal node scripts/create-admin.mjs
unset ADMIN_PASSWORD
```

Rodar de novo para o mesmo e-mail redefine a senha, o perfil, e **encerra as
sessões abertas** daquele usuário. Use para criar acesso ou destravar quem
esqueceu a senha — o usuário comum troca a própria senha em `/conta`, informando
a senha atual.

**Revogar acesso sem apagar histórico:**

```sql
UPDATE app_users SET active = false, updated_at = now() WHERE email = '...';
DELETE FROM app_sessions WHERE user_id = (SELECT id FROM app_users WHERE email = '...');
```

O `active = false` já basta — `lerSessao()` exige `u.active` —, mas apagar as
sessões encerra o acesso na hora em vez de na próxima requisição.

**Pontos de atenção operacionais:**

- `AUTH_COOKIE_SECURE` deve permanecer `true`. Funciona no acesso por túnel SSH
  porque `localhost` é contexto seguro para o navegador. Mudar para `false`
  faz a sessão trafegar em claro.
- O bloqueio por tentativas é **em memória do processo**: reiniciar o container
  zera a contagem, e com mais de uma réplica cada uma contaria em separado.
- Sessões vencidas são limpas de forma oportunista a cada login, sem cron.

## 6. Deploy na EC2 FinOps

Pré-requisitos: etapas 4 e 5 concluídas.

### Os quatro nomes que não são intercambiáveis

Errar qualquer um destes faz o comando falhar — ou, pior, agir no lugar errado.
Todos foram confirmados no deploy de 20/08/2026.

| | Valor | Não confundir com |
|---|---|---|
| Repositório no servidor | `/opt/veri-finops` | `/opt/finops`, que é o diretório do **compose de produção** e do ETL |
| `.env` que o compose lê | **`/opt/finops/.env`** (modo 600) | `/opt/veri-finops/.env`, que **não existe** — lá só há `.env.example` |
| Serviço no compose | **`finops-app`** | o nome do container |
| Container | **`finops-portal`** | o nome do serviço |

`docker compose build finops-portal` falha: `finops-portal` é o
`container_name`, não o serviço. Use `finops-app`, ou o script, que já sabe disso.

> **O `.env` não basta.** O compose entrega ao container **apenas** as variáveis
> listadas no bloco `environment:` de `infra/docker-compose.veri-finops.yml`.
> Definir algo no `.env` sem declarar lá não chega na aplicação, e ela cai no
> valor padrão do código — silenciosamente. Foi o que aconteceu com
> `OVH_CRON_INSTALADO`: o cron estava instalado, a variável estava no `.env`, e o
> Diagnóstico afirmava que não havia cron.

```bash
# 1. Código no servidor
sudo git clone <repo> /opt/veri-finops      # ou: cd /opt/veri-finops && git pull
cd /opt/veri-finops && git checkout feature/veri-finops-app

# 2. BACKUP do compose atual (mesmo não sendo alterado por nós)
cd /opt/finops
cp docker-compose.yml "docker-compose.yml.bak-$(date +%F-%H%M)"

# 3. Variáveis de ambiente
cp /opt/veri-finops/infra/.env.example /opt/finops/.env
chmod 600 /opt/finops/.env
sudo vi /opt/finops/.env     # preencher APP_PG_PASSWORD e APP_BUILD_CONTEXT

# 4. Marcar tag durável ANTES de um deploy que talvez se queira desfazer
docker tag finops-portal:local finops-portal:pre-<nome-da-mudanca>

# 5. Subir SOMENTE o serviço novo
/opt/veri-finops/scripts/finops-app.sh up
```

> **O passo 4 não é zelo excessivo.** `:anterior` é sobrescrita a cada `build`, e
> dois deploys seguidos apagam o alvo do primeiro. Ver a seção 7.

**Se `/opt/veri-finops` não tiver `.git`.** Até 20/08/2026 o diretório era
extração de `git archive`, sem histórico — então o `git pull` acima era
impossível, e o `git status` de qualquer procedimento falhava ali. Resolvido
clonando de novo e trocando os diretórios:

```bash
sudo mkdir -p /opt/veri-finops.novo && sudo chown ubuntu:ubuntu /opt/veri-finops.novo
git clone --branch feature/veri-finops-app --single-branch <repo> /opt/veri-finops.novo
sudo mv /opt/veri-finops /opt/veri-finops.anterior
sudo mv /opt/veri-finops.novo /opt/veri-finops
```

`APP_BUILD_CONTEXT` aponta para `/opt/veri-finops/web`, então o caminho continua
válido depois da troca. Guarde um `tar -czf` do diretório antigo antes.

O script embute as travas: informa sempre o nome do serviço (sem ele o compose
avalia todos e pode recriar o Metabase), descobre o nome do projeto compose lendo
o container do Postgres em execução (para o portal entrar na rede onde
`postgres` resolve) e preserva a imagem em uso como `:anterior` antes de
sobrescrevê-la. Equivalente manual:

```bash
cd /opt/finops
docker compose -p "$(docker inspect finops-postgres \
    --format '{{index .Config.Labels "com.docker.compose.project"}}')" \
  -f docker-compose.yml \
  -f /opt/veri-finops/infra/docker-compose.veri-finops.yml \
  up -d --no-deps --build finops-app
```

### Validação obrigatória pós-deploy

```bash
# a) o portal subiu, está healthy e enxerga o banco
scripts/finops-app.sh health

# b) NADA foi recriado: confira o uptime dos containers existentes
scripts/finops-app.sh status     # finops-postgres e finops-metabase devem
                                 # manter o uptime anterior ao deploy

# c) o Metabase continua funcional
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
#    e abrir o dashboard "FinOps AWS - Visão Executiva" no navegador
```

Um `Up 3 weeks` no `finops-metabase` logo depois de um deploy do portal é a
prova de que ele não foi recriado — é o item que não pode ser pulado.

```bash
# d) o código NOVO está servindo -- conferido no container, não no disco
#    (um `git log` correto em /opt/veri-finops não prova que a imagem
#     foi reconstruída)
docker exec finops-portal sh -c 'grep -rl "OVH Collector" /app/.next | wc -l'

# e) as variáveis declaradas chegaram ao container
docker exec finops-portal printenv | grep -E '^(OVH_|ETL_|AWS_INVOICING)'
```

### Homologação funcional — o que automação não alcança

Os itens acima são todos verificáveis por comando. **Login, navegação e filtros
não são:** as rotas exigem sessão válida contra `app_sessions`, e sem credencial
de aplicação a automação para no `401`. Isso não é limitação a contornar — é o
desenho da autenticação funcionando.

Então a homologação tem duas metades, e o registro **precisa dizer qual é qual**.
O checklist com atribuição por observador fica em
[homologacao-multicloud.md](homologacao-multicloud.md); o do deploy
multi-provider de 20/08/2026 está preenchido lá.

### Acessar durante a validação (sem expor a porta)

```bash
# da estação de trabalho:
ssh -L 3001:127.0.0.1:3001 ubuntu@<ip-da-ec2>
# depois: http://localhost:3001
```

Só troque `APP_BIND` para `0.0.0.0` **depois** de colocar Nginx + HTTPS na frente
e restringir o Security Group — a mesma recomendação já registrada para a porta
3000 do Metabase.

Situação em 19/08/2026: **publicado.** URL oficial
**https://finops.nexeeo.com**, com `nexeeo.com` e `www.nexeeo.com` servindo a
mesma aplicação, certificado Let's Encrypt ativo e HTTP redirecionando para
HTTPS. `APP_BIND` **continua em `127.0.0.1`** e deve permanecer: o acesso público
é pelo proxy, e publicar a 8080 daria uma entrada que pula TLS, `Block Common
Exploits` e o log por host. Ver README seção 7.1 e
[dns-nexeeo.md](dns-nexeeo.md). Enquanto o certificado não sair,
`APP_BIND` continua em `127.0.0.1`: publicar sem TLS é exatamente o que esta
recomendação evita. Operação do proxy em
`/opt/nginx-proxy-manager/README-operacao.md`, na EC2.

---

## 7. Rollback

Dois cenários diferentes.

**A versão nova subiu, mas está ruim** — volte para a imagem anterior:

```bash
scripts/finops-app.sh rollback                    # volta para :anterior
```

Sobe **sem rebuild**: o objetivo é voltar ao binário que funcionava, não
reconstruir a partir de um código que pode ter mudado no disco.

Para voltar a uma tag durável específica:

```bash
APP_IMAGE_TAG=pre-multicloud scripts/finops-app.sh rollback
scripts/finops-app.sh health
```

`finops-portal:pre-multicloud` guarda a imagem de `ae42e22`, marcada à mão antes
do deploy multi-provider de 20/08/2026.

### Por que marcar uma tag durável, e não confiar em `:anterior`

`:anterior` é reescrita a cada `build`. Isso é correto para desfazer o **último**
deploy, mas **dois deploys seguidos apagam o alvo do primeiro**.

Havia um defeito pior até 20/08/2026, encontrado no próprio deploy:
`tag_em_uso()` lia `.Config.Image` — a **tag** pedida, `finops-portal:local` — em
vez de `.Image`, o **ID resolvido** da imagem. Como `cmd_up` chama `cmd_build`,
rodar `build` e depois `up` fazia a segunda passagem marcar como `:anterior` a
imagem **recém-criada**, apagando a única versão boa conhecida. O rollback
daquele deploy só existiu porque a tag `pre-multicloud` foi criada à mão antes.

Corrigido: o script usa o ID, que não se move quando a tag é reescrita. A trava
sobrevive, mas marcar a tag durável continua sendo a prática — ela é o que
protege contra o segundo deploy.

Para conferir que `:anterior` aponta mesmo para outra imagem antes de subir:

```bash
docker image inspect finops-portal:anterior --format '{{.Id}}'
docker image inspect finops-portal:local    --format '{{.Id}}'   # tem de diferir
```

> **O bit de execução não vinha do git.** Os scripts estavam versionados como
> `100644`, então um clone limpo produzia `finops-app.sh` sem `+x` e o deploy
> falhava com `Permission denied`. Corrigido em 20/08/2026 com
> `git update-index --chmod=+x`. Se ainda encontrar isso num clone antigo:
> `chmod +x scripts/*.sh scripts/*.py scripts/ovh-collector/*.sh`.

**Tirar o portal do ar** — o serviço é isolado, remover não toca em mais nada:

```bash
scripts/finops-app.sh down
```

Postgres, Metabase, volumes e dados permanecem intactos. Nenhum `down` de
projeto, nenhum `--volumes`, nenhum `--force-recreate` em serviço existente.

---

## 8. Desenvolvimento local

```bash
cd web
npm install

# .env.local aponta para o Postgres da EC2 através de um túnel SSH:
#   ssh -L 15432:127.0.0.1:5432 ubuntu@<ip-da-ec2>
cat > .env.local <<'EOF'
PG_HOST=127.0.0.1
PG_PORT=15432
PG_DB=finops
PG_USER=finops_app
PG_PASSWORD=...
EOF

npm run dev     # http://localhost:3000
npm run build   # valida o build de produção
npm run lint
```

`.env.local` está no `.gitignore`. Nunca comitar credencial.

---

## 9. Identidade visual

Tokens em `web/src/app/globals.css`, derivados de `docs/skill-veri.md`
(Brandbook VERI v2.0). Regras aplicadas:

- Apenas cores da paleta oficial. Status financeiro usa a semântica do brandbook:
  verde = realização, mostarda = atenção, vinho = crítico.
- Tema apenas claro: o brandbook não define paleta escura, e inventar uma seria
  criar identidade visual sem aprovação.
- Logo com descritor horizontal, versão primária, sobre fundo branco/claro.

**Pendências de branding:**

1. **Fontes oficiais** — Ador Hairline e Mr Eaves San OT são licenciadas via Adobe
   Fonts e não estão no repositório. Os nomes oficiais já vêm primeiro na pilha CSS:
   basta adicionar o kit da Adobe Fonts ao `<head>` para a tipografia correta passar
   a valer. Até então, cai numa pilha neutra de sistema.
2. **Logo Reduzido** — o brandbook define essa como a versão prioritária, mas o
   arquivo não está em `assets/logos/`. Solicitar ao branding.

---

## 10. Riscos conhecidos

| Risco | Situação |
|---|---|
| O horário exibido do ETL é **declarado**, não lido do crontab | O container não tem acesso ao host. Mudar o cron sem mudar `ETL_HORARIO_ESPERADO` faz a tela cobrar a carga na hora errada. Os dois passos andam juntos — seção 11 |
| `postgres` não tem healthcheck no compose | `depends_on` só garante ordem de start, não prontidão. A aplicação tolera: erro de conexão vira mensagem na tela, não crash |
| Porta 3000 já é do Metabase | A aplicação usa 3001 no host (3000 apenas dentro do container). O `.env.example` avisa explicitamente para não trocar para 3000 |
| Senhas em texto claro no `docker-compose.yml` atual e nos `.docx` | Fora do escopo deste serviço, mas recomendada rotação e migração para `.env` em etapa própria |
| Valor oficial é em USD; BRL é estimativa | A conversão usa a PTAX do Banco Central e é **indicativa** — não considera spread nem IOF, e nada em BRL é gravado no banco. Telas e arquivos exportados marcam isso explicitamente |
| Exportação consome memória proporcional à BASE, não à tela | Único ponto do portal com esse comportamento. `EXPORT_MAX_ROWS` (padrão 50.000) é conferido antes de gerar e recusa com HTTP 413 acima do teto. O CSV vai em streaming; quem o teto protege é o XLSX. Se subir o teto, suba `APP_MEM_LIMIT` junto |
| `next dev` (Turbopack) trava a tela analítica com `?busca=` na URL | **Só em desenvolvimento.** Com a seção de exportação presente, o dev server suspende a fronteira de Suspense e não a revela; o build de produção (`next build` + `server.js`, que é o que roda no container) foi verificado nas mesmas URLs e funciona. Ao validar essa tela localmente, use o build de produção |

---

## 11. Monitoramento do ETL

O ETL **não** faz parte deste serviço: é um script Python em `/opt/finops/etl/`,
disparado pelo cron do usuário `ubuntu`, fora do compose. O portal não o executa
e não o supervisiona — apenas lê o rastro que ele deixa em `app_etl_runs`.

### 11.1 O que está instalado na EC2

| Caminho | O que é | Alterado por esta entrega |
|---|---|---|
| `/opt/finops/run-etl.sh` | wrapper original, com as variáveis e a senha | **não** — intocado |
| `/opt/finops/etl/athena_to_postgres.py` | a carga | sim: passou a registrar `app_etl_runs` |
| `/opt/finops/etl/athena_to_postgres.py.bak-<data>` | backup automático da versão anterior | criado na publicação |
| `/opt/finops/run-etl-with-status.sh` | wrapper novo: informa a origem e chama o antigo | novo |
| `/opt/finops/register-etl-status.py` | registro manual e conserto de execução travada | novo |
| `crontab -l` do `ubuntu` | `0 8 * * *` apontando para o wrapper novo | sim — backup em `/opt/finops/backups/` |
| `/opt/finops/ovh-collector/` | collector OVHcloud, venv próprio | novo — pipeline **separado**, não compartilha venv nem credencial com o ETL AWS |
| `crontab -l` do `ubuntu` | `0 9 * * *` do collector OVH | instalado 20/08/2026 — uma hora depois do AWS, de propósito |
| `/opt/finops/ovh-collector/logs/` | log do cron OVH, modo 700 | **o diretório precisa existir**: redirecionamento para diretório inexistente falha no shell do cron e o comando não roda |

O wrapper novo **não guarda credencial nenhuma**. Ele exporta `ETL_SOURCE` e
`ETL_LOG_PATH` e dá `exec` no script antigo, que continua sendo o único lugar
com as variáveis de conexão. Um segundo lugar guardando a senha de produção
seria um preço alto por um campo de metadado.

### 11.2 Diagnóstico rápido

```bash
# 1. o que o portal está vendo
curl -s -H "cookie: veri_finops_session=$TOKEN" \
  http://localhost:3001/api/diagnostics/data-freshness | jq '.dados.situacao, .dados.saudavel'

# 2. as últimas execuções, direto do banco
docker exec finops-postgres psql -U finops_user -d finops -c \
  "SELECT id, started_at, finished_at, status, source, monthly_rows, daily_rows,
          left(coalesce(error_message,'-'), 60)
     FROM app_etl_runs ORDER BY started_at DESC LIMIT 5"

# 3. a saída bruta -- só existe aqui; o portal nunca lê o conteúdo do log
tail -50 /opt/finops/etl.log

# 4. o cron realmente instalado
crontab -l | grep etl
```

### 11.3 Reexecutar

A carga é idempotente (`ON CONFLICT ... DO UPDATE` em todas as tabelas), então
reexecutar não duplica linha:

```bash
/opt/finops/run-etl-with-status.sh manual
```

### 11.4 Execução presa em "Em execução"

Acontece quando o processo morre sem chance de gravar (OOM, `kill -9`, reboot).
Duas coisas já resolvem sozinhas: passado `ETL_EXECUCAO_ORFA_MINUTOS` a tela
mostra "interrompida", e a carga seguinte fecha o registro. Para resolver na
hora:

```bash
read -rs PG_PASSWORD && export PG_PASSWORD
/opt/finops/register-etl-status.py --fechar-orfas --minutos 120
unset PG_PASSWORD
```

### 11.5 Mudar o horário do agendamento

**São dois passos, e pular um deles faz a tela mentir.** O cron manda no
agendamento; a variável manda no que a tela afirma esperar.

```bash
# passo 1 -- o cron (BACKUP ANTES: `crontab -` substitui tudo sem perguntar)
crontab -l > /opt/finops/backups/crontab-$(date +%F-%H%M).bak
crontab -l | sed 's|^0 8 |0 11 |' | crontab -     # 11:00 UTC = 08:00 em São Paulo
crontab -l                                        # CONFIRA

# passo 2 -- o portal
sudo vi /opt/finops/.env                          # ETL_HORARIO_ESPERADO=11:00
/opt/veri-finops/scripts/finops-app.sh up
```

Lembre que a EC2 está em `Etc/UTC`: o `0 8` de hoje dispara às 05:00 de São
Paulo, e sempre foi assim.

### 11.6 Rollback

Na ordem inversa, e nenhum passo toca em dado de custo, no Metabase ou no
compose:

```bash
# 1. ETL volta à versão anterior
cp /opt/finops/etl/athena_to_postgres.py.bak-<data> /opt/finops/etl/athena_to_postgres.py

# 2. cron volta ao script original
crontab /opt/finops/backups/crontab-<data>.bak

# 3. banco -- DESTRÓI o histórico de execuções, que não se regenera
docker exec finops-postgres pg_dump -U finops_user -d finops -t app_etl_runs \
  > /opt/finops/backups/app_etl_runs-$(date +%F-%H%M).sql
docker exec -i finops-postgres psql -U finops_user -d finops -X -v ON_ERROR_STOP=1 \
  < /opt/veri-finops/scripts/migrations/003-diagnostico-etl-rollback.sql
```

Depois do passo 3 a tela `/dashboard/diagnostico` continua abrindo: informa que
o monitoramento não está instalado e não quebra nenhuma outra tela. O ETL também
segue carregando — ele apenas registra um aviso por execução.

---

## 12. Rotação da senha do banco

Feita em 20/08/2026 para o role `finops_app`, depois que o valor apareceu num
transcript. **Senha que apareceu em log não volta a ser senha por ter sido
apagada do log** — trate como vazada e rotacione.

Esta seção existe porque quatro coisas no caminho não são o que se espera, e
cada uma delas produz uma falha silenciosa ou uma falsa confirmação.

### 12.1 Quem usa `finops_app` — e quem não usa

| Role | Consumidores | Rotacionar exige |
|---|---|---|
| `finops_app` | **1** — só o portal | trocar `APP_PG_PASSWORD` e recriar o container |
| `finops_user` | **4** — ETL AWS, collector OVH, Metabase, acesso manual | ver "Riscos conhecidos" no [README](../README.md); muito mais caro |
| `metabase_user` | Metabase | fora do escopo |

Confirme antes de mexer, em vez de confiar na tabela — é uma consulta:

```bash
docker exec finops-postgres psql -U finops_user -d finops -c \
  "SELECT usename, client_addr, count(*) FROM pg_stat_activity
    WHERE datname='finops' GROUP BY usename, client_addr ORDER BY usename;"

docker inspect finops-portal \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$v.IPAddress}} {{end}}'
```

O `client_addr` das conexões `finops_app` tem de bater com o IP do portal. Se
aparecer outro endereço, existe um consumidor que ninguém documentou.

### 12.2 As chaves NÃO se chamam `PG_PASSWORD` nem `DATABASE_URL`

Em `/opt/finops/.env` os nomes são **`APP_PG_USER`** e **`APP_PG_PASSWORD`**. O
compose os traduz para `PG_*` dentro do container:

```yaml
PG_USER:     ${APP_PG_USER:?defina APP_PG_USER no .env}
PG_PASSWORD: ${APP_PG_PASSWORD:?defina APP_PG_PASSWORD no .env}
```

Não existe `DATABASE_URL` neste projeto — a conexão é montada a partir de `PG_*`
discretos. Um script de rotação que procure `PG_PASSWORD=` ou `DATABASE_URL=`
**no `.env`** não encontra nada. Se ele não tiver guarda, escreve zero linhas e
termina com sucesso: a senha muda no banco, o `.env` fica velho, e o estrago só
aparece no próximo `up`. Exija que o script **falhe** quando o número de linhas
trocadas não for exatamente 1.

### 12.3 A verificação óbvia é um falso positivo

O `pg_hba.conf` deste banco tem:

```
local   all   all                     trust
host    all   all   127.0.0.1/32      trust
host    all   all   all               scram-sha-256
```

Testar a senha com `docker exec finops-postgres psql -h 127.0.0.1 -U finops_app`
**autentica sempre** — com senha certa, errada ou vazia. A regra `trust` casa
antes. Um teste que passa com senha errada não está medindo senha nenhuma.

Teste pelo mesmo caminho do portal: um container efêmero na rede do compose, que
cai na regra `scram-sha-256`.

```bash
# senha correta -> devolve 1
docker run --rm --network finops_default -e PGPASSWORD="$PW" postgres:16 \
  psql -h postgres -U finops_app -d finops -Atc 'select 1'

# controle negativo -- OBRIGATÓRIO: com senha errada tem de FALHAR
docker run --rm --network finops_default -e PGPASSWORD='errada' postgres:16 \
  psql -h postgres -U finops_app -d finops -Atc 'select 1'
```

Rode **os dois** antes de mudar qualquer coisa. O controle negativo é o que prova
que o teste mede o que você pensa que ele mede.

### 12.4 Procedimento

Backup primeiro. `/opt/finops/.env` é `ubuntu:ubuntu` modo 600 — não precisa de
`sudo` para escrever, e é melhor que não precise:

```bash
TS=$(date +%F-%H%M)
cp -a /opt/finops/.env /opt/backups/veri-finops/env.before-rotate-finops-app.$TS.bak
```

Um `pg_dump` de `app_users`/`app_sessions` é opcional: rotação de senha **não
toca em linha nenhuma**, e as sessões do portal são de aplicação, não de banco —
ninguém é deslogado. Se fizer o dump, **`chmod 600` nele**: carrega hashes de
senha e tokens de sessão, e `pg_dump` cria o arquivo com o umask do shell, que
neste host produz 664.

A senha vive só numa variável de shell, nunca em `echo`. Alfabeto alfanumérico
elimina de uma vez o `+`/`/`/`=` do base64, que exigiria percent-encoding se
algum dia a senha entrar numa URL de conexão:

```bash
NEW_PW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
```

> `| head -c 40` **quebra sob `set -o pipefail`**: `head` sai antes do `tr`, que
> morre de SIGPIPE e derruba a pipeline inteira. `cut -c1-40` lê tudo e não tem
> esse problema.

Troque no banco passando a senha por **stdin**, não por argumento — `-v newpass=`
coloca o segredo em `argv`, visível no `ps` do host:

```bash
printf "ALTER ROLE finops_app WITH PASSWORD '%s';\n" "$NEW_PW" \
  | docker exec -i finops-postgres psql -U finops_user -d finops -v ON_ERROR_STOP=1 -q
```

Então, na ordem, com reversão automática em cada passo:

1. senha nova autentica (12.3) — se não, `ALTER ROLE` de volta e pare;
2. senha antiga **rejeitada** — confirma que a rotação foi efetiva;
3. reescreva `APP_PG_PASSWORD` no `.env`, exigindo exatamente 1 linha trocada;
4. confirme que a contagem de chaves não mudou (13 hoje);
5. **releia o valor do `.env` e autentique com ele** — é a única prova que mede o
   que o container vai de fato fazer;
6. recrie o container.

### 12.5 Recriar sem rebuild

`finops-app.sh up` chama `cmd_build` **sempre**. Numa troca de variável de
ambiente o código não mudou, e rebuildar acrescenta uma segunda variável ao
deploy: uma imagem nova a partir da mesma fonte. Recrie a partir da imagem que já
está no ar:

```bash
PROJ="$(docker inspect finops-postgres \
  --format '{{index .Config.Labels "com.docker.compose.project"}}')"

cd /opt/finops && docker compose -p "$PROJ" \
  -f /opt/finops/docker-compose.yml \
  -f /opt/veri-finops/infra/docker-compose.veri-finops.yml \
  up -d --no-deps finops-app
```

O `-p` lido do container do banco e o `--no-deps` são o que impede de recriar
Postgres e Metabase — os mesmos cuidados que `finops-app.sh` toma. Confirme
depois que **o ID da imagem não mudou**, o que prova que só o container foi
trocado:

```bash
docker inspect finops-portal --format '{{.Image}}'   # igual ao de antes
```

### 12.6 A janela é inevitável — e ela aparece no log

PostgreSQL não aceita duas senhas por role. Entre o `ALTER ROLE` e a recriação do
container existe um intervalo em que o portal **não consegue abrir conexão nova**.
As conexões já autenticadas continuam servindo — o Postgres não derruba sessão
aberta por troca de senha — então não houve indisponibilidade, mas houve falha
registrada.

Na rotação de 20/08/2026 a janela foi de ~67 s e o log do Postgres mostrou 5
`password authentication failed`, todas contabilizadas:

| Origem | Quantas |
|---|---|
| Controle negativo do 12.3, de propósito | 1 |
| Verificação de que a senha antiga caiu (passo 2) | 1 |
| Pool do container antigo, na cadência do healthcheck | 3 |

As três últimas, espaçadas de 30 s, casam exatamente com
`Healthcheck.Interval=30s`. Com `retries=3`, alongar a janela levaria o container
antigo a `unhealthy` — motivo para fazer `ALTER ROLE`, `.env` e recriação **num
único script**, e não em passos manuais separados.

Contabilize cada linha antes de declarar sucesso. Um `grep -c` que devolve 5 não
diz nada; o que importa é se sobrou alguma **depois** da recriação:

```bash
docker logs finops-postgres --since 20m 2>&1 \
  | grep -iE 'password authentication failed' | awk '$2 > "HH:MM:SS"'
```

### 12.7 Rollback

O rollback aqui **não é de imagem** — a imagem nunca mudou. São dois passos, e a
senha antiga está no backup do `.env`:

```bash
BAK=/opt/backups/veri-finops/env.before-rotate-finops-app.<TS>.bak

# 1. volta a senha no banco, lendo do backup, sem imprimir
printf "ALTER ROLE finops_app WITH PASSWORD '%s';\n" \
  "$(sed -nE 's/^APP_PG_PASSWORD=//p' "$BAK")" \
  | docker exec -i finops-postgres psql -U finops_user -d finops -v ON_ERROR_STOP=1 -q

# 2. volta o .env e recria (12.5)
cp -a "$BAK" /opt/finops/.env && chmod 600 /opt/finops/.env
```

Só faz sentido enquanto o backup existir. E depois de confirmar que a rotação
está boa, esse backup passa a ser **um arquivo com a senha antiga em texto
claro**: mantenha modo 600 e apague quando não precisar mais dele.

### 12.8 Inspecionar sem repetir o vazamento

O comando reflexo vaza exatamente o que se está tentando proteger:

```bash
docker exec finops-portal printenv | grep -Ei 'PG|DATABASE'   # IMPRIME A SENHA
```

Nomes com contexto, valores só com tamanho:

```bash
docker exec finops-portal printenv | sed -E 's/=.*//' | grep -iE 'PG|AUTH|OVH' | sort

docker exec finops-portal printenv | grep -E '^PG_PASSWORD=' \
  | awk -F= '{print $1, "->", length(substr($0, index($0,"=")+1)), "chars"}'

sed -E 's/(APP_PG_PASSWORD=).*/\1***REDACTED***/' /opt/finops/.env
```

Nomes de usuário e de banco (`finops_app`, `finops_user`, `finops`) **não são
segredo** e podem ser impressos — é justamente o que permite conferir a topologia
sem tocar em valor nenhum.
