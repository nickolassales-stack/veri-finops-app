#!/usr/bin/env bash
# =============================================================================
# FinOps :: executa o ETL identificando a ORIGEM da execucao
# -----------------------------------------------------------------------------
# NAO SUBSTITUI /opt/finops/run-etl.sh -- chama. O script atual continua sendo
# quem tem as credenciais e quem invoca o Python; este aqui so acrescenta o
# contexto que o ETL nao tem como descobrir sozinho: quem o disparou e para onde
# vai o log.
#
# POR QUE ELE NAO ESCREVE NO BANCO
#
# Seria natural este wrapper abrir a linha em app_etl_runs. Ele nao faz isso de
# proposito: para escrever, precisaria da senha do Postgres, e isso significaria
# um SEGUNDO lugar guardando credencial de producao. Quem registra e o Python,
# que ja recebe as variaveis de `run-etl.sh` -- e a execucao morta sem registro
# e consertada pela execucao seguinte (`fechar_execucoes_orfas`) ou a mao, por
# `scripts/register-etl-status.py --fechar-orfas`.
#
# USO
#
#   ./run-etl-with-status.sh              # source=cron   (o caso do agendamento)
#   ./run-etl-with-status.sh manual       # source=manual (execucao a mao)
#
# INSTALACAO NO CRON (com backup e rollback -- ver docs/RUNBOOK-app.md)
#
#   crontab -l > /opt/finops/backups/crontab-$(date +%F-%H%M).bak
#   crontab -l | sed 's|/opt/finops/run-etl.sh|/opt/finops/run-etl-with-status.sh|' | crontab -
#
#   rollback:  crontab /opt/finops/backups/crontab-<data>.bak
#
# Sem este wrapper nada quebra: o ETL continua se registrando, apenas com
# `source = 'unknown'`.
# =============================================================================
set -euo pipefail

# Caminhos configuraveis para o script poder ser testado fora de /opt/finops.
RUN_ETL="${RUN_ETL:-/opt/finops/run-etl.sh}"
ETL_LOG_PATH="${ETL_LOG_PATH:-/opt/finops/etl.log}"

# 'cron' e o padrao porque o agendamento e o unico chamador que nao pode passar
# argumento. Execucao a mao informa explicitamente.
ETL_SOURCE="${1:-cron}"

case "$ETL_SOURCE" in
  cron|manual|unknown) ;;
  *)
    echo "ERRO: origem invalida: '$ETL_SOURCE' (use cron, manual ou unknown)" >&2
    exit 2
    ;;
esac

if [ ! -x "$RUN_ETL" ]; then
  echo "ERRO: nao encontrei o ETL executavel em $RUN_ETL" >&2
  exit 2
fi

export ETL_SOURCE ETL_LOG_PATH

echo "== FinOps ETL == origem: $ETL_SOURCE == $(date -Is) =="

# `exec` de proposito: o wrapper sai de cena e o codigo de saida do ETL vira o
# codigo de saida deste script, sem intermediario que possa mascarar falha.
exec "$RUN_ETL"
