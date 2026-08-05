#!/usr/bin/env bash
# =============================================================================
# FinOps :: coleta o schema REAL do PostgreSQL -- SOMENTE LEITURA
# -----------------------------------------------------------------------------
# Nao executa DDL/DML, nao reinicia container, nao altera arquivo no servidor.
# Apenas abre uma sessao psql read-only e imprime metadados.
#
# Dois modos de execucao:
#
#   1) Remoto (rodando na sua maquina, via SSH):
#        SSH_TARGET=ubuntu@1.2.3.4 ./scripts/inspect-schema.sh
#        SSH_TARGET=ubuntu@1.2.3.4 SSH_KEY=~/.ssh/finops.pem ./scripts/inspect-schema.sh
#
#   2) Local (rodando dentro da propria EC2 FinOps):
#        ./scripts/inspect-schema.sh
#
# Saida: scripts/out/schema-snapshot-<data>.txt  (ignorado pelo git)
# =============================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-finops-postgres}"
PG_DB="${PG_DB:-finops}"
PG_USER="${PG_USER:-finops_user}"
SSH_TARGET="${SSH_TARGET:-}"
SSH_KEY="${SSH_KEY:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/inspect-schema.sql"
OUT_DIR="$SCRIPT_DIR/out"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/schema-snapshot-$STAMP.txt"

[ -f "$SQL_FILE" ] || { echo "ERRO: nao encontrei $SQL_FILE" >&2; exit 1; }
mkdir -p "$OUT_DIR"

# psql le o script pelo stdin; --no-psqlrc evita interferencia de config do host.
PSQL_CMD="docker exec -i $PG_CONTAINER psql -U $PG_USER -d $PG_DB --no-psqlrc -X"

echo "== FinOps :: inspecao SOMENTE LEITURA =="
echo "   container : $PG_CONTAINER"
echo "   banco     : $PG_DB"
echo "   usuario   : $PG_USER"

if [ -n "$SSH_TARGET" ]; then
  echo "   modo      : remoto via SSH ($SSH_TARGET)"
  SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
  [ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$PSQL_CMD" < "$SQL_FILE" | tee "$OUT_FILE"
else
  echo "   modo      : local (docker exec nesta maquina)"
  command -v docker >/dev/null || { echo "ERRO: docker nao encontrado" >&2; exit 1; }
  docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER" \
    || { echo "ERRO: container '$PG_CONTAINER' nao esta rodando aqui." >&2
         echo "      Use SSH_TARGET=... para inspecionar a EC2 FinOps." >&2; exit 1; }
  # shellcheck disable=SC2086
  $PSQL_CMD < "$SQL_FILE" | tee "$OUT_FILE"
fi

echo ""
echo "== Snapshot salvo em: $OUT_FILE =="
echo "   (scripts/out/ esta no .gitignore -- revise antes de versionar)"
