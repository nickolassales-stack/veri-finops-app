"""
FinOps :: backfill do periodo financeiro nas linhas ja carregadas.

POR QUE ELE EXISTE
------------------
A migracao 001 cria `billing_period` e `billing_month` vazias. So o CUR sabe o
valor certo -- nao da para deduzir do que esta no Postgres, porque o caso que
interessa e justamente aquele em que a data de uso NAO indica a fatura.

Este script le a resposta no CUR (fonte da verdade) e preenche as duas colunas
das linhas que ja existem. E o passo entre a migracao e a proxima carga do ETL.

O QUE ELE ESCREVE
-----------------
    aws_daily_costs    -> billing_period, billing_month
    aws_monthly_costs  -> billing_period, billing_month
                          e, SOMENTE com --realinhar-mes, a coluna `month`

NUNCA toca em cost_amount, currency, usage_date, account_id, service ou region.
Sem `--aplicar` ele nao escreve nada: roda em modo simulacao e mostra o que
faria.

SOBRE O --realinhar-mes
-----------------------
`aws_monthly_costs.month` foi gravada com o mes de USO. Onde uso e cobranca
divergem, ela aponta para o mes errado -- na base real, a linha do AmazonRegistrar
esta em 2026-09 e deveria estar em 2026-07.

Isso NAO e cosmetico. O ON CONFLICT da carga mensal usa (month, account_id,
service). Se a linha antiga ficar em setembro, a proxima carga vai INSERIR uma
linha nova em julho e a antiga permanece: os mesmos US$ 37,32 contados duas
vezes na tabela mensal.

O portal nao le essa tabela (ele usa so aws_daily_costs), mas o Metabase pode.
Por isso o realinhamento existe -- e por isso ele e explicito, e nao automatico.
Nenhum valor e apagado: so a atribuicao de mes e corrigida, e ela pode ser
regerada do CUR a qualquer momento.

COMO EXECUTAR (na EC2)
----------------------
    cd /opt/finops && source venv/bin/activate
    export AWS_REGION=us-east-2
    export FINOPS_BUCKET=finops-aws-cost-datalake-800168045394
    export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DB=finops PG_USER=finops_user
    read -rsp 'senha do postgres: ' PG_PASSWORD; export PG_PASSWORD; echo

    python scripts/backfill-billing-period.py                      # simulacao
    python scripts/backfill-billing-period.py --aplicar --realinhar-mes

    unset PG_PASSWORD

Idempotente: reexecutar nao muda nada depois da primeira vez.
"""

import argparse
import os
import sys
import time
from io import StringIO

import boto3
import pandas as pd
import psycopg2

REGION = os.getenv("AWS_REGION", "us-east-2")
BUCKET = os.getenv("FINOPS_BUCKET", "finops-aws-cost-datalake-800168045394")
DATABASE = "finops"

PG_HOST = os.getenv("PG_HOST", "127.0.0.1")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DB = os.getenv("PG_DB", "finops")
PG_USER = os.getenv("PG_USER", "finops_user")
PG_PASSWORD = os.environ["PG_PASSWORD"]


def run_athena_query(query: str) -> pd.DataFrame:
    athena = boto3.client("athena", region_name=REGION)
    s3 = boto3.client("s3", region_name=REGION)

    response = athena.start_query_execution(
        QueryString=query,
        QueryExecutionContext={"Database": DATABASE},
        ResultConfiguration={"OutputLocation": f"s3://{BUCKET}/athena-results/"},
    )
    query_id = response["QueryExecutionId"]

    while True:
        status = athena.get_query_execution(QueryExecutionId=query_id)
        state = status["QueryExecution"]["Status"]["State"]
        if state in ("SUCCEEDED", "FAILED", "CANCELLED"):
            break
        time.sleep(3)

    if state != "SUCCEEDED":
        reason = status["QueryExecution"]["Status"].get("StateChangeReason", "erro desconhecido")
        raise RuntimeError(f"Athena falhou: {state} - {reason}")

    obj = s3.get_object(Bucket=BUCKET, Key=f"athena-results/{query_id}.csv")
    csv_data = obj["Body"].read().decode("utf-8")
    return pd.read_csv(StringIO(csv_data)) if csv_data.strip() else pd.DataFrame()


CONSULTA_DIARIA = """
SELECT
  CAST(line_item_usage_start_date AS date) AS usage_date,
  line_item_usage_account_id AS account_id,
  line_item_product_code AS service,
  COALESCE(line_item_availability_zone, '') AS region,
  billing_period,
  CAST(bill_billing_period_start_date AS date) AS billing_month
FROM finops.cur_raw
GROUP BY 1,2,3,4,5,6
"""

# O `usage_month` NAO e enfeite: ele e a chave de casamento.
#
# `aws_monthly_costs.month` foi gravada pelo ETL antigo como o mes de USO, e o
# indice unico da tabela e (month, account_id, service). Sem o mes no WHERE, um
# servico presente em julho E agosto casa com as duas linhas e cada iteracao
# sobrescreve a anterior -- a ultima do laco vence, arbitrariamente. Foi
# exatamente esse defeito que a simulacao pegou em 13/08/2026, quando o script
# relatou 78 atualizacoes numa tabela de 50 linhas.
CONSULTA_MENSAL = """
SELECT
  CAST(date_trunc('month', line_item_usage_start_date) AS date) AS usage_month,
  line_item_usage_account_id AS account_id,
  line_item_product_code AS service,
  billing_period,
  CAST(bill_billing_period_start_date AS date) AS billing_month
FROM finops.cur_raw
GROUP BY 1,2,3,4,5
"""


def conferir_chave_unica(df: pd.DataFrame, chave: list[str], nome: str) -> None:
    """Recusa-se a prosseguir se a chave de casamento nao for unica no CUR.

    Cada linha do CUR vira um UPDATE. Se duas linhas diferentes casarem com a
    MESMA linha do Postgres, a segunda sobrescreve a primeira e o resultado
    depende da ordem do laco -- silenciosamente. Uma tabela financeira nao pode
    ser preenchida por sorteio, entao aqui o script para em vez de adivinhar.
    """
    repetidas = df[df.duplicated(subset=chave, keep=False)]
    if repetidas.empty:
        return
    print(f"\nABORTADO: em {nome}, a chave {chave} nao identifica um unico")
    print("periodo de cobranca. As linhas abaixo competem pela mesma linha do banco:\n")
    print(repetidas.sort_values(chave).to_string(index=False))
    print("\nNada foi gravado. Resolva a ambiguidade antes de repetir.")
    raise SystemExit(2)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true",
                    help="grava de verdade. Sem isto, so simula.")
    ap.add_argument("--realinhar-mes", action="store_true",
                    help="corrige aws_monthly_costs.month onde ele diverge do mes de cobranca.")
    args = ap.parse_args()

    modo = "APLICANDO" if args.aplicar else "SIMULACAO (nada sera gravado)"
    print(f"== backfill do periodo financeiro -- {modo} ==\n")

    print("lendo o CUR no Athena...")
    diario = run_athena_query(CONSULTA_DIARIA)
    mensal = run_athena_query(CONSULTA_MENSAL)
    print(f"  {len(diario)} chaves diarias, {len(mensal)} chaves mensais")

    conferir_chave_unica(
        diario, ["usage_date", "account_id", "service", "region"], "aws_daily_costs"
    )
    conferir_chave_unica(
        mensal, ["usage_month", "account_id", "service"], "aws_monthly_costs"
    )
    print("  chaves conferidas: cada linha do banco casa com no maximo 1 do CUR\n")

    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD
    )
    try:
        with conn:
            with conn.cursor() as cur:
                # ------------------------------------------------------ diario
                atualizadas = 0
                for _, r in diario.iterrows():
                    cur.execute(
                        """
                        UPDATE aws_daily_costs
                           SET billing_period = %s,
                               billing_month  = %s
                         WHERE usage_date = %s
                           AND account_id = %s
                           AND service    = %s
                           AND region     = %s
                           AND (billing_period IS DISTINCT FROM %s
                                OR billing_month IS DISTINCT FROM %s)
                        """,
                        (
                            str(r["billing_period"]), r["billing_month"],
                            r["usage_date"], str(r["account_id"]),
                            str(r["service"]), str(r["region"]),
                            str(r["billing_period"]), r["billing_month"],
                        ),
                    )
                    atualizadas += cur.rowcount
                print(f"aws_daily_costs   : {atualizadas} linha(s) preenchida(s)")

                # ------------------------------------------------------ mensal
                atualizadas_m = 0
                for _, r in mensal.iterrows():
                    cur.execute(
                        """
                        UPDATE aws_monthly_costs
                           SET billing_period = %s,
                               billing_month  = %s
                         WHERE month      = %s
                           AND account_id = %s
                           AND service    = %s
                           AND (billing_period IS DISTINCT FROM %s
                                OR billing_month IS DISTINCT FROM %s)
                        """,
                        (
                            str(r["billing_period"]), r["billing_month"],
                            r["usage_month"], str(r["account_id"]), str(r["service"]),
                            str(r["billing_period"]), r["billing_month"],
                        ),
                    )
                    atualizadas_m += cur.rowcount
                print(f"aws_monthly_costs : {atualizadas_m} linha(s) preenchida(s)")

                # ------------------------------------------- realinhar `month`
                cur.execute(
                    """
                    SELECT id, month, billing_month, account_id, service, cost_amount
                      FROM aws_monthly_costs
                     WHERE billing_month IS NOT NULL
                       AND month <> billing_month
                     ORDER BY id
                    """
                )
                divergentes = cur.fetchall()

                if not divergentes:
                    print("\naws_monthly_costs.month: nenhuma linha divergente.")
                else:
                    print(f"\naws_monthly_costs.month: {len(divergentes)} linha(s) apontam "
                          f"para o mes errado:")
                    for (id_, mes, bmes, conta, servico, custo) in divergentes:
                        print(f"   id={id_}  {conta} {servico}  US$ {custo}"
                              f"   month={mes} -> {bmes}")

                    if args.realinhar_mes:
                        cur.execute(
                            """
                            UPDATE aws_monthly_costs
                               SET month = billing_month
                             WHERE billing_month IS NOT NULL
                               AND month <> billing_month
                            """
                        )
                        print(f"   -> {cur.rowcount} linha(s) realinhada(s). "
                              f"Nenhum valor de custo foi alterado.")
                    else:
                        print("   -> NAO realinhadas (faltou --realinhar-mes).")
                        print("      Deixar assim faz a proxima carga mensal INSERIR uma")
                        print("      linha nova no mes certo e manter esta no mes errado,")
                        print("      contando o mesmo valor duas vezes.")

                if not args.aplicar:
                    conn.rollback()
                    print("\n(simulacao: rollback aplicado, nada foi gravado)")
                    return 0

        # --------------------------------------------------------- conferencia
        with conn.cursor() as cur:
            print("\n== conferencia: total por periodo de cobranca ==")
            cur.execute(
                """
                SELECT coalesce(billing_period, to_char(usage_date, 'YYYY-MM')) AS periodo,
                       account_id,
                       round(sum(cost_amount), 2) AS total
                  FROM aws_daily_costs
                 GROUP BY 1, 2
                 ORDER BY 1, 2
                """
            )
            for periodo, conta, total in cur.fetchall():
                print(f"   {periodo}  {conta}  US$ {total}")
    finally:
        conn.close()

    print("\nPronto.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
