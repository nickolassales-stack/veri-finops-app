# syntax=docker/dockerfile:1
# =============================================================================
# Portal FinOps VERI -- imagem de producao
#
# Multi-stage com output "standalone": a imagem final nao carrega node_modules
# completo nem toolchain de build. Roda como usuario sem privilegio, com
# filesystem que pode ser montado somente-leitura (ver o compose).
# =============================================================================

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencias -----------------------------------------------------------
# `--include=dev` e explicito: typescript e tailwind sao devDependencies e sao
# necessarios no build. Sem isso, um NODE_ENV=production herdado do ambiente de
# build faria o npm pular justamente o que o `next build` precisa.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# --- build ------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build NAO acessa o banco: a validacao de env e lazy (src/lib/env.ts) e as
# paginas com dados chamam connection(), o que as exclui do prerender. Por isso
# nenhuma credencial precisa entrar na imagem em tempo de build.
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Comando administrativo de criacao de usuario. Roda dentro do container, que ja
# tem as variaveis PG_* no ambiente:
#   docker exec -i -e ADMIN_EMAIL -e ADMIN_PASSWORD finops-portal \
#     node scripts/create-admin.mjs
# O caminho de src/ e preservado porque o script importa a implementacao unica
# de hash por caminho relativo. `pg` resolve do node_modules do standalone.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/auth/password.mjs ./src/lib/auth/password.mjs

USER nextjs
EXPOSE 3000

# Falha (503) quando o PostgreSQL nao responde -- a aplicacao sem banco nao tem
# nada util a entregar, e e melhor o orquestrador saber disso do que servir uma
# tela de erro achando que esta tudo bem.
#
# `start-period` cobre a partida do Node; durante ela as falhas nao contam para
# o limite de tentativas.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
