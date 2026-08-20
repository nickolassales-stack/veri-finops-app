#!/usr/bin/env bash
# =============================================================================
# FinOps :: wrapper do collector OVHcloud
# -----------------------------------------------------------------------------
#   ./run-ovh-etl.sh            # source=cron   (o caso do agendamento)
#   ./run-ovh-etl.sh manual     # source=manual (execucao a mao)
#   ./run-ovh-etl.sh manual --dry-run
#
# NAO TEM RELACAO COM O ETL AWS. `run-etl-with-status.sh` continua sendo o unico
# responsavel pela carga da AWS; os dois nao se chamam, nao compartilham venv e
# nao compartilham credencial. Se o collector OVH quebrar, a carga AWS das 08:00
# nao percebe.
#
# 'cron' e o padrao porque o agendamento e o unico chamador que nao pode passar
# argumento -- e melhor a execucao a mao ter que ser explicita do que uma
# execucao agendada aparecer como origem desconhecida no historico.
# =============================================================================
set -euo pipefail

DIR="${DIR:-/opt/finops/ovh-collector}"
PYTHON="${PYTHON:-$DIR/venv/bin/python}"
LOG="${OVH_LOG_PATH:-/opt/finops/ovh-etl.log}"

ORIGEM="cron"
if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
  ORIGEM="$1"; shift
fi

[ -x "$PYTHON" ] || { echo "venv nao encontrado em $PYTHON -- ver README, secao 4" >&2; exit 3; }
[ -f "$DIR/.env" ] || { echo "$DIR/.env nao existe -- ver README, secao 3" >&2; exit 2; }

echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ')  collector OVH  origem=$ORIGEM ==="

# Encerra execucao travada de ontem ANTES de comecar: sem isso, um processo morto
# deixa `running` eterno e o proximo operador acha que ha coleta em andamento.
OVH_LOG_PATH="$LOG" "$PYTHON" "$DIR/ovh_to_postgres.py" --fechar-orfas || true

OVH_LOG_PATH="$LOG" exec "$PYTHON" "$DIR/ovh_to_postgres.py" --source "$ORIGEM" --log-path "$LOG" "$@"
