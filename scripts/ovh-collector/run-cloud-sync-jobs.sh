#!/usr/bin/env bash
# =============================================================================
# FinOps :: worker da fila de coleta (cloud_sync_jobs)
# -----------------------------------------------------------------------------
#   ./run-cloud-sync-jobs.sh                      # o que o cron chama, a cada minuto
#   ./run-cloud-sync-jobs.sh --max 5
#   ./run-cloud-sync-jobs.sh --enfileirar ovh-main-ca
#
# O portal INSERE job em `cloud_sync_jobs`; este script processa. O container do
# portal nunca executa shell: ele nao tem o venv, nao tem o filesystem do host, e
# dar-lhe qualquer um dos dois transformaria a tela de configuracao em superficie
# de execucao de comando.
#
# -----------------------------------------------------------------------------
# TRES CADEADOS, TRES PROBLEMAS DISTINTOS
#
#   1. `flock` aqui              -- duas execucoes DESTE script ao mesmo tempo.
#                                   O cron dispara a cada minuto; um worker que
#                                   demore 90s encontraria o proximo ja subindo.
#   2. indice unico parcial      -- dois jobs para a MESMA conta na fila.
#      (migracao 008)               Resolvido no banco, nao na aplicacao.
#   3. pg_try_advisory_lock      -- worker e coleta diaria das 09:00 coletando a
#      (jobs_ovh.TravaConta)        mesma conta. O indice nao cobre: a coleta
#                                   diaria nao passa por job.
#
# `flock -n` desiste em vez de esperar: com o cron chamando a cada minuto, uma
# fila de workers esperando so adiaria o problema e consumiria memoria da EC2, que
# tem 4 GiB e um Metabase que ja sofreu OOM nela.
#
# -----------------------------------------------------------------------------
# NAO TEM RELACAO COM A COLETA DIARIA. `run-ovh-etl.sh` continua sendo o unico
# responsavel pela carga agendada das 09:00. Os dois nao se chamam. Se este
# worker parar, a coleta diaria segue; se a coleta diaria parar, o botao do portal
# continua funcionando.
#
# CODIGOS DE SAIDA -- repassados do Python:
#   0 nada na fila ou tudo bem   2 configuracao/migracao 008 ausente
#   3 dependencia                6 pelo menos um job falhou
#   75 outro worker esta rodando (EX_TEMPFAIL; nao e erro)
# =============================================================================
set -euo pipefail

DIR="${DIR:-/opt/finops/ovh-collector}"
PYTHON="${PYTHON:-$DIR/venv/bin/python}"
LOG="${JOBS_LOG_PATH:-$DIR/logs/jobs.log}"
TRAVA="${JOBS_LOCK_PATH:-/tmp/veri-finops-cloud-sync-jobs.lock}"

[ -x "$PYTHON" ] || { echo "venv nao encontrado em $PYTHON -- ver README, secao 4" >&2; exit 3; }

# O `.env` continua obrigatorio, e nao pelas chaves da OVH: e dele que saem
# PG_USER e PG_PASSWORD. Sem banco nao ha fila para ler.
[ -f "$DIR/.env" ] || { echo "$DIR/.env nao existe -- ver README, secao 3" >&2; exit 2; }

# `flock` explicitamente, ANTES de usa-lo. Sem esta checagem, um host sem
# util-linux faria `flock -n 9` retornar 127 (comando nao encontrado), o `if !`
# abaixo tomaria isso por "outro worker rodando" e o script sairia 75 -- a cada
# minuto, para sempre, sem processar nada e sem nenhuma linha de erro. Falha
# permanente disfarcada do caso normal e o pior resultado possivel aqui.
command -v flock >/dev/null 2>&1 || {
  echo "flock nao encontrado (pacote util-linux) -- sem ele nao ha como impedir dois workers" >&2
  exit 3
}

mkdir -p "$(dirname "$LOG")"

# ---------------------------------------------------------------------------
# `flock` no proprio script. `exec` substitui o processo mantendo o descritor 9
# aberto, entao o lock vale por toda a vida do worker e e liberado pelo kernel
# quando ele morre -- inclusive se for morto com SIGKILL, caso em que um lock
# baseado em arquivo-marcador ficaria preso para sempre.
# ---------------------------------------------------------------------------
exec 9>"$TRAVA"
if ! flock -n 9; then
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ')  outro worker em execucao; saindo ===" >> "$LOG"
  exit 75
fi

# ---------------------------------------------------------------------------
# A chave de cifragem tem de chegar ao Python: sem ela nao se decifra credencial
# nenhuma do banco, e a fila existe justamente para as contas cadastradas por la.
#
# `sed` em vez de `source`: o `.env` tem outras variaveis, e um `source` traria
# todas para este shell, onde apareceriam no `ps` de qualquer processo filho.
# O VALOR nunca e ecoado -- so o tamanho.
# ---------------------------------------------------------------------------
if [ -z "${APP_CREDENTIALS_ENCRYPTION_KEY:-}" ] && [ -r "$DIR/.env" ]; then
  APP_CREDENTIALS_ENCRYPTION_KEY="$(
    sed -nE 's/^[[:space:]]*APP_CREDENTIALS_ENCRYPTION_KEY[[:space:]]*=[[:space:]]*//p' \
      "$DIR/.env" | tail -n 1 | tr -d '"'"'"'\r'
  )"
  export APP_CREDENTIALS_ENCRYPTION_KEY
fi

{
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ')  worker de fila  args=${*:-<padrao>} ==="
  if [ -n "${APP_CREDENTIALS_ENCRYPTION_KEY:-}" ]; then
    echo "chave de cifragem: presente (${#APP_CREDENTIALS_ENCRYPTION_KEY} chars)"
  else
    echo "chave de cifragem: AUSENTE -- jobs de conta cadastrada pelo portal vao falhar"
  fi
} >> "$LOG"

cd "$DIR"

# ---------------------------------------------------------------------------
# `|| codigo=$?` E OBRIGATORIO AQUI -- nao e estilo.
#
# Com `set -e`, um comando simples que retorna diferente de zero encerra o script
# NA HORA. Escrito como `cmd` seguido de `codigo=$?`, a atribuicao nunca roda
# quando o Python falha, e a linha de diagnostico abaixo nunca e impressa.
#
# O codigo de saida continuava certo (o bash sai com o status do comando que
# falhou), e por isso o defeito era invisivel: o cron recebia 6 e o log do cron
# ficava VAZIO. Como todo o detalhe do worker vai para `$LOG`, essa linha no
# stderr era a UNICA pista no `cron.log` de que jobs falharam -- e ela nunca
# apareceu. Um worker que falha em silencio e pior do que um worker parado.
#
# `|| codigo=$?` transforma a chamada em comando composto, que `set -e` nao
# aborta, e a atribuicao passa a acontecer.
# ---------------------------------------------------------------------------
codigo=0
"$PYTHON" "$DIR/processar_jobs.py" "$@" >> "$LOG" 2>&1 || codigo=$?

# Codigo 0 sem nada na fila e o caso normal e nao merece linha no log do cron.
[ "$codigo" -ne 0 ] && echo "worker terminou com codigo $codigo (ver $LOG)" >&2
exit "$codigo"
