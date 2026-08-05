# syntax=docker/dockerfile:1
# =============================================================================
# Portal FinOps VERI -- imagem de producao
#
# Multi-stage com output "standalone": a imagem final nao carrega node_modules
# completo nem toolchain de build. Roda como usuario sem privilegio.
# =============================================================================

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# --- dependencias (inclui devDeps: typescript e tailwind sao necessarios no build)
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O build NAO acessa o banco: a validacao de env e lazy (src/lib/env.ts) e as
# paginas com dados chamam connection(), o que as exclui do prerender.
RUN npm run build

# --- runtime
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

USER nextjs
EXPOSE 3000

# Falha (503) quando o PostgreSQL nao responde -- a aplicacao sem banco nao
# tem nada util a entregar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
