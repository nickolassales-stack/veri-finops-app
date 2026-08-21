#!/usr/bin/env bash
# =============================================================================
# FinOps :: wrapper do collector OVHcloud
# -----------------------------------------------------------------------------
#   ./run-ovh-etl.sh                            # cron, todas as contas
#   ./run-ovh-etl.sh cron --all                 # o que o crontab chama
#   ./run-ovh-etl.sh manual --all               # todas, a mao
#   ./run-ovh-etl.sh manual --account ovh-main-ca
#   ./run-ovh-etl.sh manual --all --dry-run     # coleta e mostra, nao grava
#
# AS CONTAS VEM DO BANCO. Desde a migracao 006, a fonte principal de credencial e
# `cloud_provider_credentials`, cadastrada em Configuracoes > Contas Cloud. O
# `.env` e `accounts.d/` continuam funcionando como FALLBACK -- ver README secao
# 3 e docs/ovh-collector-multiconta.md.
#
# NAO TEM RELACAO COM O ETL AWS. `run-etl-with-status.sh` continua sendo o unico
# responsavel pela carga da AWS; os dois nao se chamam, nao compartilham venv e
# nao compartilham credencial. Se o collector OVH quebrar, a carga AWS das 08:00
# nao percebe.
#
# 'cron' e o padrao porque o agendamento e o unico chamador que nao pode passar
# argumento -- e melhor a execucao a mao ter que ser explicita do que uma
# execucao agendada aparecer como origem desconhecida no historico.
#
# CODIGOS DE SAIDA -- repassados do Python, sem traducao:
#   0 tudo bem   1 unica conta falhou      2 configuracao/conta inexistente
#   3 dependencia   4 a OVH recusou   5 o banco recusou   6 falha parcial
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

# O `.env` continua OBRIGATORIO, e a razao mudou: nao e mais dele que saem as
# chaves da OVH -- e dele que saem PG_USER e PG_PASSWORD. Sem banco nao ha como
# nem LER as credenciais cifradas, entao a checagem fica.
[ -f "$DIR/.env" ] || { echo "$DIR/.env nao existe -- ver README, secao 3" >&2; exit 2; }

# --all e o padrao do Python quando nenhum escopo e passado. Acrescentar aqui
# seria redundante e, pior, atrapalharia: `run-ovh-etl.sh manual --account X`
# receberia os dois e o argparse recusaria por exclusividade mutua.
echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ')  collector OVH  origem=$ORIGEM  args=${*:-<padrao: todas>} ==="

# ---------------------------------------------------------------------------
# A chave de cifragem tem de chegar ao Python.
#
# Ela vem do ambiente, e no cron o ambiente e quase vazio -- por isso e lida do
# `.env` aqui quando nao estiver exportada. `grep`+`cut` em vez de `source`: o
# `.env` tem outras variaveis e um `source` traria todas para este shell, onde
# apareceriam no `ps` de qualquer processo filho.
#
# O VALOR nunca e ecoado. Sem a chave o collector nao para: ele avisa e cai no
# fallback -- ver contas_ovh.descobrir_contas.
# ---------------------------------------------------------------------------
if [ -z "${APP_CREDENTIALS_ENCRYPTION_KEY:-}" ] && [ -r "$DIR/.env" ]; then
  APP_CREDENTIALS_ENCRYPTION_KEY="$(
    sed -nE 's/^[[:space:]]*APP_CREDENTIALS_ENCRYPTION_KEY[[:space:]]*=[[:space:]]*//p' \
      "$DIR/.env" | tail -n 1 | tr -d '"'"'"'\r'
  )"
  export APP_CREDENTIALS_ENCRYPTION_KEY
fi

if [ -n "${APP_CREDENTIALS_ENCRYPTION_KEY:-}" ]; then
  echo "chave de cifragem: presente (${#APP_CREDENTIALS_ENCRYPTION_KEY} chars)"
else
  echo "chave de cifragem: AUSENTE -- credenciais do banco serao ignoradas, usando fallback"
fi

# Encerra execucao travada de ontem ANTES de comecar: sem isso, um processo morto
# deixa `running` eterno e o proximo operador acha que ha coleta em andamento.
OVH_LOG_PATH="$LOG" "$PYTHON" "$DIR/ovh_to_postgres.py" --fechar-orfas || true

OVH_LOG_PATH="$LOG" exec "$PYTHON" "$DIR/ovh_to_postgres.py" \
  --source "$ORIGEM" --log-path "$LOG" "$@"
