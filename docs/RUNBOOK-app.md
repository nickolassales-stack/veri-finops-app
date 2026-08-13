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
           │ publicado em 127.0.0.1:3001 por padrão
           v
     túnel SSH / Nginx+HTTPS (a definir antes de liberar a usuários)
```

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
- A página `/diagnostico` mostra os privilégios efetivos do usuário conectado,
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

# 4. Subir SOMENTE o serviço novo
/opt/veri-finops/scripts/finops-app.sh up
```

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

### Acessar durante a validação (sem expor a porta)

```bash
# da estação de trabalho:
ssh -L 3001:127.0.0.1:3001 ubuntu@<ip-da-ec2>
# depois: http://localhost:3001
```

Só troque `APP_BIND` para `0.0.0.0` **depois** de colocar Nginx + HTTPS na frente
e restringir o Security Group — a mesma recomendação já registrada para a porta
3000 do Metabase.

---

## 7. Rollback

Dois cenários diferentes.

**A versão nova subiu, mas está ruim** — volte para a imagem anterior:

```bash
scripts/finops-app.sh rollback
```

Sobe `finops-portal:anterior` **sem rebuild**: o objetivo é voltar ao binário que
funcionava, não reconstruir a partir de um código que pode ter mudado no disco.
O `build` guarda essa tag automaticamente antes de sobrescrever a corrente.

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
| ETL é manual (`athena_to_postgres.py`) | A aplicação exibe o dado que existe no banco; a tela precisa indicar o frescor. Automação do ETL segue pendente (já registrada na doc original) |
| `postgres` não tem healthcheck no compose | `depends_on` só garante ordem de start, não prontidão. A aplicação tolera: erro de conexão vira mensagem na tela, não crash |
| Porta 3000 já é do Metabase | A aplicação usa 3001 no host (3000 apenas dentro do container). O `.env.example` avisa explicitamente para não trocar para 3000 |
| Senhas em texto claro no `docker-compose.yml` atual e nos `.docx` | Fora do escopo deste serviço, mas recomendada rotação e migração para `.env` em etapa própria |
| Valor oficial é em USD; BRL é estimativa | A conversão usa a PTAX do Banco Central e é **indicativa** — não considera spread nem IOF, e nada em BRL é gravado no banco. Telas e arquivos exportados marcam isso explicitamente |
| Exportação consome memória proporcional à BASE, não à tela | Único ponto do portal com esse comportamento. `EXPORT_MAX_ROWS` (padrão 50.000) é conferido antes de gerar e recusa com HTTP 413 acima do teto. O CSV vai em streaming; quem o teto protege é o XLSX. Se subir o teto, suba `APP_MEM_LIMIT` junto |
| `next dev` (Turbopack) trava a tela analítica com `?busca=` na URL | **Só em desenvolvimento.** Com a seção de exportação presente, o dev server suspende a fronteira de Suspense e não a revela; o build de produção (`next build` + `server.js`, que é o que roda no container) foi verificado nas mesmas URLs e funciona. Ao validar essa tela localmente, use o build de produção |
