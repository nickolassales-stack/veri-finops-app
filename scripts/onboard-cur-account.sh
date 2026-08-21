#!/usr/bin/env bash
# =============================================================================
# FinOps :: onboarding de uma nova conta AWS no pipeline CUR 2.0 / Data Export
# -----------------------------------------------------------------------------
# Prepara UMA conta no Athena/Glue: valida a entrega no S3, descobre os billing
# periods, cria database e tabela a partir do DDL que a propria AWS gera, e
# registra as particoes.
#
#   ./onboard-cur-account.sh 891377338363
#   ./onboard-cur-account.sh 891377338363 --somente-validar
#   ./onboard-cur-account.sh 891377338363 --export-name nome_diferente
#
# O QUE ELE NAO FAZ, DE PROPOSITO
#
# Nao altera `finops.cur_raw`. A view e o unico ponto do pipeline em que um erro
# atinge TODAS as contas de uma vez: um UNION ALL com schema incompativel, ou uma
# tabela vazia entrando na uniao, quebra o ETL e o dashboard inteiro -- nao so a
# conta nova. Ao final o script IMPRIME o SQL sugerido da view, ja conferido
# contra o Glue, para um humano ler e executar.
#
# Nao mexe em PostgreSQL, nao roda o ETL e nao apaga nada. Tudo que ele cria e
# aditivo e idempotente: rodar duas vezes na mesma conta nao causa dano.
#
# PRE-REQUISITO QUE O SCRIPT NAO PODE RESOLVER
#
# A conta precisa ter ENTREGADO dados no S3. O Data Export e criado no console de
# billing da conta pagadora e a primeira entrega leva ate ~24 h. Sem `data/` e
# `metadata/` no bucket nao existe DDL para criar tabela nenhuma, e o script para
# com codigo 2 dizendo exatamente isso.
# =============================================================================
set -euo pipefail

REGION="${REGION:-us-east-2}"
BUCKET="${BUCKET:-finops-aws-cost-datalake-800168045394}"
OUTPUT="${OUTPUT:-s3://finops-aws-cost-datalake-800168045394/athena-results/}"
PREFIXO="${PREFIXO:-raw/aws/cur}"
TRABALHO="${TRABALHO:-/opt/finops}"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$*"; }
titulo()   { printf '\n\033[1m== %s\033[0m\n' "$*"; }

ACCOUNT_ID=""
EXPORT_NAME=""
SOMENTE_VALIDAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --somente-validar) SOMENTE_VALIDAR=1; shift ;;
    --export-name)     EXPORT_NAME="${2:?--export-name exige um valor}"; shift 2 ;;
    -h|--help)         sed -n '2,32p' "$0"; exit 0 ;;
    -*)                vermelho "opcao desconhecida: $1"; exit 64 ;;
    *)                 ACCOUNT_ID="$1"; shift ;;
  esac
done

# 12 digitos: pega typo de account_id antes de ele virar nome de database.
if ! printf '%s' "$ACCOUNT_ID" | grep -qE '^[0-9]{12}$'; then
  vermelho "account_id invalido: '${ACCOUNT_ID}'"
  echo "Uso: $(basename "$0") <account_id de 12 digitos> [--somente-validar] [--export-name NOME]"
  exit 64
fi

EXPORT_NAME="${EXPORT_NAME:-finops_cur2_$ACCOUNT_ID}"
RAW_DB="finops_cur2_$ACCOUNT_ID"
RAW_TABLE="finops_cur2_$ACCOUNT_ID"
BASE="s3://$BUCKET/$PREFIXO/account_id=$ACCOUNT_ID/$EXPORT_NAME"

echo "conta        : $ACCOUNT_ID"
echo "export       : $EXPORT_NAME"
echo "database     : $RAW_DB"
echo "tabela       : $RAW_TABLE"
echo "regiao       : $REGION"
echo "base no S3   : $BASE"
[ "$SOMENTE_VALIDAR" = 1 ] && amarelo "modo SOMENTE VALIDAR: nada sera criado"

# ---------------------------------------------------------------- helper Athena
# Executa uma query e espera. Devolve o id; aborta com o motivo real da AWS se
# falhar, em vez de deixar o chamador adivinhar.
athena() {
  local descricao="$1" sql="$2" contexto="${3:-}"
  local id estado motivo args=()
  args=(--region "$REGION" --result-configuration "OutputLocation=$OUTPUT")
  [ -n "$contexto" ] && args+=(--query-execution-context "Database=$contexto")

  id="$(aws athena start-query-execution "${args[@]}" \
          --query-string "$sql" --query QueryExecutionId --output text)"

  while :; do
    estado="$(aws athena get-query-execution --region "$REGION" \
                --query-execution-id "$id" \
                --query 'QueryExecution.Status.State' --output text)"
    case "$estado" in
      SUCCEEDED) verde "  OK    $descricao"; ATHENA_ID="$id"; return 0 ;;
      FAILED|CANCELLED)
        motivo="$(aws athena get-query-execution --region "$REGION" \
                    --query-execution-id "$id" \
                    --query 'QueryExecution.Status.StateChangeReason' --output text)"
        vermelho "  FALHA $descricao"
        echo "        $motivo"
        ATHENA_MOTIVO="$motivo"; ATHENA_ID="$id"; return 1 ;;
    esac
    sleep 2
  done
}

# Baixa o resultado de uma query como CSV e imprime.
resultado() {
  aws athena get-query-results --region "$REGION" --query-execution-id "$1" \
    --query 'ResultSet.Rows[].Data[].VarCharValue' --output text 2>/dev/null || true
}

# ============================================================ 1. validar no S3
titulo "1. Entrega no S3"

CONTA_OBJETOS="$(aws s3 ls "s3://$BUCKET/$PREFIXO/account_id=$ACCOUNT_ID/" --recursive 2>/dev/null | grep -c . || true)"
DATA_OBJETOS="$(aws s3 ls "$BASE/data/" --recursive 2>/dev/null | grep -c . || true)"
META_OBJETOS="$(aws s3 ls "$BASE/metadata/" --recursive 2>/dev/null | grep -c . || true)"

echo "  objetos no prefixo da conta : $CONTA_OBJETOS"
echo "  objetos em data/            : $DATA_OBJETOS"
echo "  objetos em metadata/        : $META_OBJETOS"

if [ "$DATA_OBJETOS" -eq 0 ] || [ "$META_OBJETOS" -eq 0 ]; then
  echo
  vermelho "A conta ainda nao entregou CUR/Data Export no S3. Aguardar primeira entrega."
  echo
  echo "O que conferir, nesta ordem:"
  echo "  1. o Data Export existe no console de billing da conta pagadora?"
  echo "  2. o destino dele e s3://$BUCKET/$PREFIXO/account_id=$ACCOUNT_ID/ ?"
  echo "  3. o nome do export e exatamente '$EXPORT_NAME'?"
  echo "     (se for outro, rode com --export-name)"
  echo "  4. a primeira entrega leva ate ~24 h apos a criacao do export."
  echo
  echo "Sinal util: um objeto 'aws-programmatic-access-test-object' recente na raiz"
  echo "do bucket indica que a AWS validou a escrita -- ou seja, o export foi criado"
  echo "e a permissao esta certa; falta so a primeira entrega."
  aws s3api head-object --bucket "$BUCKET" --key aws-programmatic-access-test-object \
    --query 'LastModified' --output text 2>/dev/null \
    | sed 's/^/     objeto de teste gravado em: /' || true
  exit 2
fi
verde "  entrega presente"

# ================================================= 2. billing periods presentes
titulo "2. Billing periods"

PERIODOS="$(aws s3 ls "$BASE/data/" 2>/dev/null \
  | awk '{print $2}' | sed 's|/$||; s|^BILLING_PERIOD=||' \
  | grep -E '^[0-9]{4}-[0-9]{2}$' | sort -u || true)"

if [ -z "$PERIODOS" ]; then
  vermelho "  data/ tem objetos, mas nenhuma particao BILLING_PERIOD=AAAA-MM."
  echo "  Estrutura encontrada:"
  aws s3 ls "$BASE/data/" | sed 's/^/    /'
  exit 3
fi
echo "$PERIODOS" | sed 's/^/  /'
echo "  total: $(echo "$PERIODOS" | grep -c .)"

# ================================================= 3. baixar o DDL da propria AWS
titulo "3. create-table.sql gerado pela AWS"

DDL_LOCAL="$TRABALHO/$EXPORT_NAME-create-table.sql"
DDL_PERIODO=""
# Do mais recente para o mais antigo: o DDL mais novo reflete o schema atual.
for p in $(echo "$PERIODOS" | sort -r); do
  if aws s3 cp "$BASE/metadata/BILLING_PERIOD=$p/$EXPORT_NAME-create-table.sql" \
       "$DDL_LOCAL" --only-show-errors 2>/dev/null; then
    DDL_PERIODO="$p"; break
  fi
done

if [ -z "$DDL_PERIODO" ]; then
  vermelho "  Nenhum create-table.sql encontrado em metadata/, em nenhum billing period."
  aws s3 ls "$BASE/metadata/" --recursive | sed 's/^/    /'
  exit 4
fi
verde "  baixado de BILLING_PERIOD=$DDL_PERIODO -> $DDL_LOCAL"
echo "  colunas declaradas: $(grep -cE '^\s+[a-z_]+ ' "$DDL_LOCAL" || true)"
grep -E 'CREATE EXTERNAL TABLE|LOCATION' "$DDL_LOCAL" | sed 's/^/    /'

# O DDL da AWS ja vem qualificado com o database. Se nao vier, o CREATE TABLE
# cairia no database `default` e a tabela ficaria no lugar errado sem erro algum.
if ! grep -q "$RAW_DB" "$DDL_LOCAL"; then
  amarelo "  ATENCAO: o DDL nao menciona '$RAW_DB'."
  echo "  A AWS costuma qualificar a tabela. Confira o cabecalho antes de seguir:"
  head -1 "$DDL_LOCAL" | sed 's/^/    /'
fi

if [ "$SOMENTE_VALIDAR" = 1 ]; then
  titulo "Modo somente-validar"
  verde "S3, billing periods e DDL conferidos. Nada foi criado."
  exit 0
fi

# =========================================================== 4. database no Glue
titulo "4. Database no Glue"
if aws glue get-database --region "$REGION" --name "$RAW_DB" >/dev/null 2>&1; then
  verde "  OK    $RAW_DB ja existe"
else
  athena "criar database $RAW_DB" "CREATE DATABASE IF NOT EXISTS $RAW_DB;"
fi

# ================================================================= 5. tabela
titulo "5. Tabela"
if aws glue get-table --region "$REGION" --database-name "$RAW_DB" --name "$RAW_TABLE" >/dev/null 2>&1; then
  verde "  OK    $RAW_DB.$RAW_TABLE ja existe (DDL nao reexecutado)"
else
  # O DDL pode ter varias centenas de linhas; passa por arquivo.
  if ! athena "criar tabela $RAW_DB.$RAW_TABLE" "file://$DDL_LOCAL"; then
    vermelho "Tabela nao criada. Nao vou adicionar particoes nem sugerir view."
    exit 5
  fi
fi

# ============================================================== 6. particoes
titulo "6. Particoes"
for p in $PERIODOS; do
  SQL_PART="$TRABALHO/add_partition_${ACCOUNT_ID}_${p//-/_}.sql"
  cat > "$SQL_PART" <<SQL
ALTER TABLE $RAW_TABLE
ADD IF NOT EXISTS PARTITION (billing_period='$p')
LOCATION '$BASE/data/BILLING_PERIOD=$p/';
SQL
  athena "particao $p" "file://$SQL_PART" "$RAW_DB" || exit 6
done

echo "  particoes registradas no Glue:"
aws glue get-partitions --region "$REGION" --database-name "$RAW_DB" \
  --table-name "$RAW_TABLE" --query 'Partitions[].Values[0]' --output text 2>/dev/null \
  | tr '\t' '\n' | sed 's/^/    /'

# ========================================================= 7. ler de verdade
titulo "7. Leitura no Athena"
SQL_COUNT="$TRABALHO/count_${ACCOUNT_ID}.sql"
cat > "$SQL_COUNT" <<SQL
SELECT
  line_item_usage_account_id AS account_id,
  billing_period,
  COUNT(*) AS linhas,
  ROUND(SUM(line_item_unblended_cost), 2) AS total_cost
FROM $RAW_DB.$RAW_TABLE
GROUP BY line_item_usage_account_id, billing_period
ORDER BY billing_period;
SQL
if ! athena "contagem por billing period" "file://$SQL_COUNT"; then
  vermelho "A tabela existe mas nao le. Verifique LOCATION das particoes."
  exit 7
fi
echo "  resultado (account_id | billing_period | linhas | total_cost):"
resultado "$ATHENA_ID" | tr '\t' '\n' | paste - - - - 2>/dev/null | sed 's/^/    /'

LINHAS="$(resultado "$ATHENA_ID" | tr '\t' '\n' | sed -n '7p' || true)"
if [ -z "$LINHAS" ]; then
  amarelo "  A consulta rodou mas nao voltou linha de dado."
  echo "  Nao inclua esta conta na view ainda: um UNION ALL com tabela vazia nao"
  echo "  quebra a query, mas esconde o problema -- a conta simplesmente nunca"
  echo "  aparece no dashboard e ninguem descobre por que."
  exit 8
fi

# =============================== 8. compatibilidade de schema com a view atual
titulo "8. Compatibilidade com finops.cur_raw"
# `SELECT * UNION ALL` exige MESMA quantidade, ORDEM e TIPO de colunas em todas as
# tabelas. Uma conta cujo export tenha versao diferente do CUR 2.0 faz a view
# falhar -- e o erro derruba TODAS as contas, nao so a nova.
colunas_de() {
  aws glue get-table --region "$REGION" --database-name "$1" --name "$2" \
    --query 'Table.StorageDescriptor.Columns[].[Name,Type]' --output text 2>/dev/null \
    | awk '{print $1":"$2}'
}
NOVA="$(colunas_de "$RAW_DB" "$RAW_TABLE")"
echo "  $RAW_DB.$RAW_TABLE: $(echo "$NOVA" | grep -c .) colunas"

INCOMPATIVEL=0
for par in "finops-cur2-daily:finops_cur2_daily"; do
  d="${par%%:*}"; t="${par##*:}"
  aws glue get-table --region "$REGION" --database-name "$d" --name "$t" >/dev/null 2>&1 || continue
  REF="$(colunas_de "$d" "$t")"
  echo "  $d.$t: $(echo "$REF" | grep -c .) colunas"
  if [ "$NOVA" = "$REF" ]; then
    verde "  OK    schema identico -- UNION ALL seguro"
  else
    INCOMPATIVEL=1
    vermelho "  DIVERGENCIA de schema com $d.$t"
    echo "  Diferencas (< referencia, > nova):"
    diff <(echo "$REF") <(echo "$NOVA") | grep -E '^[<>]' | head -20 | sed 's/^/    /'
    echo "  Com schema diferente, 'SELECT *' no UNION ALL falha ou embaralha colunas."
    echo "  Nesse caso a view precisa listar colunas explicitamente, na mesma ordem."
  fi
done

# ==================================================== 9. sugerir a view, so isso
titulo "9. SQL sugerido para finops.cur_raw -- NAO EXECUTADO"

VIEW_SQL="$TRABALHO/recreate_cur_raw_view.sugerido.sql"
{
  echo "-- Gerado por onboard-cur-account.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "-- Inclui apenas databases/tabelas CONFIRMADOS no Glue neste momento."
  echo "CREATE OR REPLACE VIEW finops.cur_raw AS"
  primeiro=1
  # Conta piloto primeiro, por ser a referencia de schema; depois as demais, em
  # ordem estavel, para o diff da view ser legivel entre execucoes.
  for par in "finops-cur2-daily:finops_cur2_daily" \
             $(aws glue get-databases --region "$REGION" \
                 --query 'DatabaseList[?starts_with(Name, `finops_cur2_`)].Name' \
                 --output text 2>/dev/null | tr '\t' '\n' | sort | sed 's/^\(.*\)$/\1:\1/'); do
    d="${par%%:*}"; t="${par##*:}"
    aws glue get-table --region "$REGION" --database-name "$d" --name "$t" >/dev/null 2>&1 || continue
    [ "$primeiro" = 1 ] || echo -e "\nUNION ALL\n"
    primeiro=0
    case "$d" in *-*) echo "SELECT * FROM \"$d\".$t" ;; *) echo "SELECT * FROM $d.$t" ;; esac
  done
  echo ";"
} > "$VIEW_SQL"
cat "$VIEW_SQL" | sed 's/^/  /'

echo
if [ "$INCOMPATIVEL" = 1 ]; then
  amarelo "NAO aplique a view acima: ha divergencia de schema (secao 8)."
else
  echo "Para aplicar, depois de LER o SQL acima:"
  echo
  echo "  aws athena start-query-execution --region $REGION \\"
  echo "    --query-string file://$VIEW_SQL \\"
  echo "    --result-configuration OutputLocation=$OUTPUT"
fi

titulo "Concluido"
verde "Conta $ACCOUNT_ID pronta no Athena."
cat <<FIM

Falta, e cada passo e uma decisao humana:

  1. aplicar a view (comando acima) -- e o unico ponto que afeta TODAS as contas;
  2. cadastrar a conta no PostgreSQL, senao ela aparece sem alias no dashboard
     (o ETL nao cadastra contas; a aplicacao faz LEFT JOIN em cloud_accounts):

       INSERT INTO cloud_accounts (account_id, account_name, provider, active)
       VALUES ('$ACCOUNT_ID', '<alias>', 'aws', true)
       ON CONFLICT (account_id) DO UPDATE
         SET account_name = EXCLUDED.account_name, updated_at = now();

  3. rodar o ETL:   /opt/finops/run-etl-with-status.sh manual
  4. conferir o dashboard: filtro de contas, soma, analitico e exportacao.

Ver docs/onboard-nova-conta.md.
FIM
