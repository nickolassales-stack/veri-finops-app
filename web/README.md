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

## Organização

```
src/
  app/
    page.tsx                 visão executiva
    diagnostico/page.tsx     estado real da integração (agnóstico ao schema)
    api/health/route.ts      usado pelo HEALTHCHECK do container
  components/
    layout/                  header, nav, footer
    ui/                      card, aviso
  lib/
    db.ts                    pool pg, timeouts, checagem de saúde
    env.ts                   validação de env (lazy: o build não precisa do banco)
    format.ts                formatação pt-BR; valores em USD, sem conversão
    nav.ts                   navegação (só rotas já implementadas)
    queries/                 SQL por domínio
```

## Convenções

- **Sem dado mockado.** Sem banco, a tela mostra erro — nunca número inventado.
- Toda query usa placeholders (`$1`, `$2`). Nunca interpolar valor em SQL.
- Acesso a dados só em Server Components / Server Actions. A credencial nunca
  chega ao browser.
- Funções que tocam o banco chamam `connection()` (via `lib/db.ts`), o que as
  exclui do prerender — sem isso o `next build` tentaria consultar o banco.
- Cores apenas da paleta VERI (`src/app/globals.css`), conforme
  [`../docs/skill-veri.md`](../docs/skill-veri.md).
