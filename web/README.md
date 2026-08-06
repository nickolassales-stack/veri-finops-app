# Portal FinOps VERI — aplicação web

Next.js 16 (App Router, TypeScript) + Tailwind v4. Consome **exclusivamente** o
PostgreSQL `finops`. Não acessa Athena, S3 ou qualquer API AWS.

Operação, deploy e rollback: **[../docs/RUNBOOK-app.md](../docs/RUNBOOK-app.md)**.

## Rodar local

Requer um túnel SSH até o PostgreSQL da EC2 FinOps (o banco não é público):

```bash
ssh -L 15432:127.0.0.1:5432 ubuntu@<ip-da-ec2>   # em outro terminal

npm install

cat > .env.local <<'EOF'
PG_HOST=127.0.0.1
PG_PORT=15432
PG_DB=finops
PG_USER=finops_app
PG_PASSWORD=...
EOF

npm run dev                        # http://localhost:3000
```

`.env.local` está no `.gitignore`. Nunca comitar credencial.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (lê `.env.local`) |
| `npm run build` | Build de produção (não acessa o banco) |
| `npm start` | Servidor de produção — o mesmo binário que roda no container |
| `npm run lint` | ESLint |

Duas particularidades de `output: standalone`, ambas já resolvidas nos scripts,
mas que valem saber ao depurar:

- **`npm start` não lê `.env.local`.** O servidor standalone recebe configuração
  só do ambiente — igual ao container, onde as variáveis vêm do compose. Para
  testar o build de produção localmente:
  `set -a; . ./.env.local; set +a; npm start`
- **`prestart` copia `public/` e `.next/static/` para `.next/standalone/`.** Sem
  essa cópia o servidor sobe e responde 200, mas serve a página **sem CSS e sem
  gráficos** — os assets ficam 404. O `Dockerfile` faz a mesma cópia.

## Autenticação

E-mail e senha, sessão em banco, cookie HTTP-only. **Não existe cadastro
público**: usuários são criados por comando administrativo.

### Como configurar

1. **Criar as tabelas** (uma vez, aditivo e idempotente — não toca em nenhuma
   tabela financeira):

   ```bash
   docker exec -i finops-postgres \
     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
     < scripts/create-auth-tables.sql
   ```

   Cria `app_users` e `app_sessions` e concede a `finops_app` escrita **apenas**
   nelas. As tabelas de custo seguem somente-leitura para a aplicação.

2. **Variáveis de ambiente** (ver [`../infra/.env.example`](../infra/.env.example)):

   | Variável | Padrão | O que faz |
   |---|---|---|
   | `AUTH_SESSION_TTL_HOURS` | `12` | Validade da sessão. Sem renovação deslizante |
   | `AUTH_COOKIE_SECURE` | `true` | Atributo `Secure` do cookie. **Mantenha `true`** |

   `AUTH_COOKIE_SECURE=true` funciona no acesso por túnel SSH, porque navegadores
   tratam `http://localhost` / `127.0.0.1` como contexto seguro. Só mude para
   `false` para acessar por HTTP em host que não seja localhost — e aí a sessão
   trafega em claro. O certo é Nginx + HTTPS na frente.

### Como criar o primeiro usuário administrador

A senha vem **sempre** do ambiente, nunca de argumento de linha de comando (que
ficaria visível no `ps` e no histórico do shell).

```bash
# em produção, de dentro do container (que já tem PG_* no ambiente):
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
docker exec -i -e ADMIN_EMAIL="nome@porveri.com.br" -e ADMIN_PASSWORD \
  finops-portal node scripts/create-admin.mjs
unset ADMIN_PASSWORD

# localmente (com túnel SSH ativo e .env.local configurado):
set -a; . ./.env.local; set +a
ADMIN_EMAIL="nome@porveri.com.br" ADMIN_PASSWORD="..." npm run create-admin
```

| Variável | Obrigatória | Observação |
|---|---|---|
| `ADMIN_EMAIL` | sim | único, comparado sem diferenciar caixa |
| `ADMIN_PASSWORD` | sim | mínimo 12 caracteres |
| `ADMIN_NAME` | não | exibido no cabeçalho |
| `ADMIN_ROLE` | não | `ADMIN` (padrão) ou `VIEWER` |

O comando é **idempotente**: rodar de novo para o mesmo e-mail redefine a senha e
o papel, e encerra as sessões abertas daquele usuário. Serve tanto para criar o
primeiro acesso quanto para destravar quem esqueceu a senha.

O próprio usuário troca a senha em **`/conta`** (link no cabeçalho, sobre o nome).
A senha atual é exigida mesmo com a sessão aberta — sem isso, um cookie roubado
permitiria tomar a conta em definitivo. Ao trocar, as sessões abertas em outros
navegadores são encerradas e a atual é preservada.

### Como testar login e logout

```bash
set -a; . ./.env.local; set +a
npm run dev        # ou: npm start, para exercitar o build de produção
```

| Cenário | Resultado esperado |
|---|---|
| Abrir `/login` | Formulário com identidade VERI |
| Senha errada | Permanece em `/login` com "E-mail ou senha incorretos." e **sem** cookie |
| Senha correta | Redireciona para `/dashboard`; cookie `veri_finops_session` HttpOnly + Secure + Lax |
| `/dashboard` sem sessão | Redireciona para `/login?next=%2Fdashboard` |
| `/dashboard` com sessão | Renderiza a visão executiva |
| Botão **Sair** | Volta para `/login`, apaga a linha em `app_sessions` e o cookie |
| `/conta` → trocar senha | Senha atual errada é recusada; troca válida confirma sucesso e mantém a sessão |
| 5 senhas erradas seguidas | Bloqueio de 5 minutos para aquele e-mail + IP |
| `/diagnostico` com perfil `VIEWER` | Redireciona para `/sem-permissao` |

Conferir no banco:

```sql
SELECT email, role, active, last_login_at FROM app_users;
SELECT user_id, expires_at, last_seen_at FROM app_sessions;   -- vazia após logout
```

### Perfis

| Perfil | Acesso |
|---|---|
| `ADMIN` | Tudo, incluindo `/diagnostico` (estrutura do banco e privilégios) |
| `VIEWER` | Visão executiva e analítico |

Esconder o link de navegação **não** é a proteção: a autorização é aplicada por
`requirePapel()` dentro da rota.

## Organização

```
src/
  proxy.ts                   checagem otimista de cookie (Next 16 renomeou middleware)
  app/
    layout.tsx               raiz: sem cabeçalho (a tela de login não tem nav)
    page.tsx                 redireciona para /dashboard
    login/                   tela de entrada + formulário
    (privado)/
      layout.tsx             FRONTEIRA DE AUTENTICAÇÃO: requireSessao()
      dashboard/             visão executiva
      dashboard/analitico/   rota protegida (conteúdo na próxima etapa)
      conta/                 dados da sessão e troca de senha
      diagnostico/           somente ADMIN
      sem-permissao/         403 de perfil insuficiente
    api/health/route.ts      usado pelo HEALTHCHECK do container (público)
  components/
    layout/                  header, nav, footer
    charts/                  gráficos (tema e paleta validados)
    ui/                      card, aviso, kpi
  lib/
    auth/
      password.mjs           scrypt -- implementação única, usada pela app e pelo seed
      session.ts             criar/ler/destruir sessão em app_sessions
      dal.ts                 getSessao, requireSessao, requirePapel
      actions.ts             server actions de entrar/sair + throttle
      destino.ts             validação anti-open-redirect do parâmetro `next`
      troca-senha.ts         regras de troca de senha (puro, testável)
    db.ts                    pool pg, timeouts, checagem de saúde
    env.ts                   validação de env (lazy: o build não precisa do banco)
    format.ts                formatação pt-BR; valores em USD, sem conversão
    nav.ts                   navegação (só rotas já implementadas)
    queries/                 SQL por domínio
scripts/
  create-admin.mjs           criação/atualização de usuário
```

## Convenções

- **Sem dado mockado.** Sem banco, a tela mostra erro — nunca número inventado.
- **Autenticação nunca depende só do proxy.** `proxy.ts` faz checagem otimista de
  cookie; a validação real (token no banco, expiração, usuário ativo, perfil)
  acontece em `requireSessao()` dentro da rota. Cookie inventado passa pelo proxy
  e é recusado lá — comportamento coberto por teste E2E.
- Toda query usa placeholders (`$1`, `$2`). Nunca interpolar valor em SQL.
- Acesso a dados só em Server Components / Server Actions. A credencial nunca
  chega ao browser.
- Funções que tocam o banco chamam `connection()` (via `lib/db.ts`), o que as
  exclui do prerender — sem isso o `next build` tentaria consultar o banco.
- Cores apenas da paleta VERI (`src/app/globals.css`), conforme
  [`../docs/skill-veri.md`](../docs/skill-veri.md).
