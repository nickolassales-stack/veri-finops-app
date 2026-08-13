#!/usr/bin/env bash
# =============================================================================
# Portal FinOps VERI -- operacao do container na EC2
#
#   ./scripts/finops-app.sh build      constroi a imagem (nao mexe em nada no ar)
#   ./scripts/finops-app.sh up         constroi e sobe SOMENTE o finops-app
#   ./scripts/finops-app.sh logs       acompanha o log do portal
#   ./scripts/finops-app.sh health     estado do container + /api/health
#   ./scripts/finops-app.sh status     o que esta no ar (portal, banco, metabase)
#   ./scripts/finops-app.sh rollback   volta para a imagem anterior
#   ./scripts/finops-app.sh down       para o portal (nao toca no resto)
#
# POR QUE ESTE SCRIPT EXISTE: cada comando abaixo termina com o nome do servico,
# `finops-app`. Sem esse nome, o `docker compose` avalia TODOS os servicos do
# projeto e pode recriar o Metabase e o PostgreSQL. Esquecer isso uma vez, num
# terminal as pressas, e o suficiente para derrubar o Metabase de producao.
# O script torna esse detalhe impossivel de esquecer.
#
# O que ele NUNCA faz: `down` do projeto inteiro, `up` sem nome de servico,
# `-v` (que apagaria o volume do banco) ou qualquer escrita no compose original.
# =============================================================================
set -euo pipefail

SERVICO="finops-app"
CONTAINER="finops-portal"
IMAGEM="finops-portal"

# Diretorio do compose de producao (o que ja existe na EC2).
DIR_COMPOSE="${DIR_COMPOSE:-/opt/finops}"
COMPOSE_ATUAL="${COMPOSE_ATUAL:-$DIR_COMPOSE/docker-compose.yml}"

# Este repositorio, resolvido a partir da localizacao do proprio script.
RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_APP="${COMPOSE_APP:-$RAIZ_REPO/infra/docker-compose.veri-finops.yml}"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$*"; }

exigir_arquivos() {
  [ -f "$COMPOSE_ATUAL" ] || { vermelho "Nao achei o compose de producao em: $COMPOSE_ATUAL"; exit 1; }
  [ -f "$COMPOSE_APP" ]   || { vermelho "Nao achei o compose do portal em: $COMPOSE_APP"; exit 1; }
  [ -f "$DIR_COMPOSE/.env" ] || {
    vermelho "Nao achei $DIR_COMPOSE/.env"
    echo "Crie a partir do modelo:  cp $RAIZ_REPO/infra/.env.example $DIR_COMPOSE/.env && chmod 600 $DIR_COMPOSE/.env"
    exit 1
  }
}

# Nome do projeto compose do ambiente que JA ESTA NO AR.
#
# Nao e detalhe cosmetico: o projeto define a rede. Se o portal subir com outro
# nome de projeto, ele vai para outra rede, o nome `postgres` nao resolve e a
# aplicacao sobe sem banco. Por isso o valor e LIDO do container do Postgres que
# esta rodando, em vez de adivinhado pelo nome do diretorio.
projeto() {
  local nome
  nome="$(docker inspect finops-postgres \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"

  if [ -z "$nome" ]; then
    vermelho "nao encontrei o container finops-postgres em execucao."
    echo "O portal precisa entrar no MESMO projeto compose do banco -- sem isso"
    echo "ele sobe em outra rede e nao acha o PostgreSQL."
    echo "Confira com: docker ps --filter name=finops-"
    exit 1
  fi
  printf '%s' "$nome"
}

# Os dois arquivos SEMPRE juntos, no MESMO projeto do banco: e isso que coloca o
# portal na rede onde o nome `postgres` resolve.
dc() {
  ( cd "$DIR_COMPOSE" && docker compose -p "$(projeto)" \
      -f "$COMPOSE_ATUAL" -f "$COMPOSE_APP" "$@" )
}

# Tag da imagem que esta rodando agora -- guardada antes de qualquer build para
# que o rollback tenha para onde voltar.
tag_em_uso() {
  docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo ""
}

cmd_build() {
  exigir_arquivos
  local anterior; anterior="$(tag_em_uso)"

  # Marca a imagem atual como `anterior` ANTES de sobrescrever `local`. Sem
  # isso, o build seguinte descarta a unica versao boa conhecida.
  if [ -n "$anterior" ] && docker image inspect "$anterior" >/dev/null 2>&1; then
    docker tag "$anterior" "$IMAGEM:anterior"
    amarelo "imagem em uso preservada como $IMAGEM:anterior  (era: $anterior)"
  fi

  verde "construindo a imagem (nada no ar e alterado ate o 'up')"
  dc build "$SERVICO"
  docker images "$IMAGEM" --format 'table {{.Repository}}\t{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}'
}

cmd_up() {
  exigir_arquivos
  cmd_build
  verde "subindo SOMENTE $SERVICO"
  dc up -d --no-deps "$SERVICO"
  cmd_health
}

cmd_down() {
  exigir_arquivos
  amarelo "parando SOMENTE $SERVICO (postgres e metabase seguem no ar)"
  # `rm -s` para o servico e remove o container -- sem `down`, que atingiria o
  # projeto inteiro.
  dc rm -sf "$SERVICO"
  cmd_status
}

cmd_logs() {
  docker logs -f --tail "${LINHAS:-100}" "$CONTAINER"
}

cmd_health() {
  echo
  echo "--- container ---"
  docker inspect --format \
    'estado={{.State.Status}}  saude={{if .State.Health}}{{.State.Health.Status}}{{else}}sem healthcheck{{end}}  imagem={{.Config.Image}}  reinicios={{.RestartCount}}' \
    "$CONTAINER" 2>/dev/null || { vermelho "container $CONTAINER nao existe"; return 1; }

  # Espera a checagem sair de "starting": logo apos o up ela ainda nao concluiu,
  # e reportar "starting" como falha assustaria sem motivo.
  local i saude
  for i in $(seq 1 30); do
    saude="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo "")"
    [ "$saude" = "starting" ] || break
    sleep 2
  done

  echo
  echo "--- /api/health (de dentro do container) ---"
  docker exec "$CONTAINER" wget -qO- http://127.0.0.1:3000/api/health || {
    vermelho "healthcheck FALHOU"
    echo "Ultimas linhas do log:"
    docker logs --tail 30 "$CONTAINER" || true
    return 1
  }
  echo

  if [ "$saude" = "unhealthy" ]; then
    vermelho "o Docker marcou o container como unhealthy"
    return 1
  fi
  verde "portal saudavel"
}

cmd_status() {
  echo "--- containers do ambiente FinOps ---"
  docker ps -a \
    --filter "name=finops-" \
    --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'
  echo
  echo "--- portas publicadas (confirma que o banco nao ganhou porta publica) ---"
  docker ps --format '{{.Names}}: {{.Ports}}' | sed 's/^/  /'
}

cmd_rollback() {
  exigir_arquivos
  if ! docker image inspect "$IMAGEM:anterior" >/dev/null 2>&1; then
    vermelho "nao existe $IMAGEM:anterior -- nada para onde voltar"
    echo "Imagens disponiveis:"
    docker images "$IMAGEM" --format '  {{.Repository}}:{{.Tag}}  ({{.CreatedSince}})'
    exit 1
  fi

  amarelo "voltando para $IMAGEM:anterior"
  # `export` explicito, e nao prefixo `VAR=x comando`: `dc` e uma FUNCAO que
  # chama o docker num subshell, e a forma prefixada depende do modo do shell
  # para chegar ate o processo filho.
  export APP_IMAGE_TAG=anterior

  # Sobe a imagem antiga SEM rebuild: o objetivo do rollback e voltar ao binario
  # que funcionava, nao reconstruir a partir de um codigo que pode ter mudado no
  # disco.
  dc up -d --no-deps --no-build "$SERVICO"
  cmd_health
}

case "${1:-}" in
  build)    cmd_build ;;
  up)       cmd_up ;;
  down)     cmd_down ;;
  logs)     cmd_logs ;;
  health)   cmd_health ;;
  status)   cmd_status ;;
  rollback) cmd_rollback ;;
  *)
    sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
