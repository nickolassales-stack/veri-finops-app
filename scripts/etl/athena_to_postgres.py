"""
FinOps :: carga Athena (CUR) -> PostgreSQL.

ORIGEM DESTE ARQUIVO
--------------------
Ate 13/08/2026 este script existia apenas em /opt/finops/etl/ na EC2, fora de
controle de versao. Foi trazido para o repositorio junto com a correcao do
periodo financeiro, para que a proxima mudanca seja revisavel.

Antes de publicar, faca backup do que esta rodando:

    ssh ubuntu@EC2 'cp /opt/finops/etl/athena_to_postgres.py \\
                      /opt/finops/etl/athena_to_postgres.py.bak-$(date +%F-%H%M)'

    scp scripts/etl/athena_to_postgres.py ubuntu@EC2:/opt/finops/etl/

Pre-requisito: a migracao 001 precisa ter rodado. Sem as colunas novas, o INSERT
falha com "column billing_period does not exist".

O QUE MUDOU EM RELACAO A VERSAO ANTERIOR
----------------------------------------
O CUR tem DUAS datas e elas nao sao a mesma coisa:

    line_item_usage_start_date      -> quando o recurso foi USADO
    bill_billing_period_start_date  -> em que fatura a AWS COBROU
    billing_period (particao)       -> o mesmo, no formato 'AAAA-MM'

A versao anterior so lia a primeira, e derivava o "mes" dela:

    CAST(date_trunc('month', line_item_usage_start_date) AS date) AS month

Para quase toda linha isso da no mesmo. Para cobranca pontual -- registro de
dominio, taxa anual, reserva -- nao da. Medido na base real em 13/08/2026:

    billing_period 2026-07 | usage_date 2026-09-04 | AmazonRegistrar | US$ 37,32

Resultado: julho fechava US$ 311,41 no portal e US$ 348,73 no Cost Explorer.

Agora as duas datas sao gravadas. `usage_date` continua servindo a evolucao
diaria operacional; `billing_month`/`billing_period` passam a ser a base dos
numeros financeiros.

O QUE NAO MUDOU (de proposito)
------------------------------
- As chaves dos ON CONFLICT. Conferido no CUR: cada tuplo
  (usage_date, conta, servico, regiao) pertence a exatamente 1 billing_period
  (879 de 879), e o mesmo vale para o mensal (50 de 50). Os indices unicos
  atuais continuam corretos, entao a carga segue idempotente sem trocar indice.
- `aws_monthly_costs.month`, que continua existindo por compatibilidade. Em
  linha nova ela recebe o mesmo valor de billing_month.
- `region` continua vindo de COALESCE(line_item_availability_zone, ''), o que
  faz o pandas gravar a string "nan" quando o campo e nulo. E um defeito
  conhecido e SEPARADO; corrigi-lo aqui mudaria o valor da chave unica e criaria
  linhas duplicadas. Fica para migracao propria.
"""

import os
import time
from io import StringIO

import boto3
import pandas as pd
import psycopg2

REGION = os.getenv("AWS_REGION", "us-east-2")
BUCKET = os.getenv("FINOPS_BUCKET", "finops-aws-cost-datalake-800168045394")
ATHENA_OUTPUT = f"s3://{BUCKET}/athena-results/"
DATABASE = "finops"

PG_HOST = os.getenv("PG_HOST", "127.0.0.1")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DB = os.getenv("PG_DB", "finops")
PG_USER = os.getenv("PG_USER", "finops_user")
# Sem valor padrao: a versao anterior trazia a senha de producao embutida no
# codigo. Falhar aqui e melhor do que carregar segredo no arquivo.
PG_PASSWORD = os.environ["PG_PASSWORD"]

athena = boto3.client("athena", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)


def run_athena_query(query: str) -> pd.DataFrame:
    response = athena.start_query_execution(
        QueryString=query,
        QueryExecutionContext={"Database": DATABASE},
        ResultConfiguration={"OutputLocation": ATHENA_OUTPUT},
    )

    query_id = response["QueryExecutionId"]
    print(f"Query started: {query_id}")

    while True:
        status = athena.get_query_execution(QueryExecutionId=query_id)
        state = status["QueryExecution"]["Status"]["State"]

        if state in ["SUCCEEDED", "FAILED", "CANCELLED"]:
            break

        time.sleep(3)

    if state != "SUCCEEDED":
        reason = status["QueryExecution"]["Status"].get("StateChangeReason", "Unknown error")
        raise RuntimeError(f"Athena query failed: {state} - {reason}")

    result_key = f"athena-results/{query_id}.csv"
    obj = s3.get_object(Bucket=BUCKET, Key=result_key)
    csv_data = obj["Body"].read().decode("utf-8")

    if not csv_data.strip():
        return pd.DataFrame()

    return pd.read_csv(StringIO(csv_data))


def get_pg_connection():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASSWORD,
    )


def load_monthly_costs():
    """Carga mensal, agora agrupada pelo PERIODO DE COBRANCA.

    A versao anterior agrupava por date_trunc('month', usage_date) -- era isso
    que jogava a cobranca de julho para setembro. Nao ha mais nenhuma referencia
    a data de uso nesta consulta: a tabela mensal e a visao financeira.
    """
    query = """
    SELECT
      billing_period,
      CAST(bill_billing_period_start_date AS date) AS billing_month,
      line_item_usage_account_id AS account_id,
      line_item_product_code AS service,
      SUM(line_item_unblended_cost) AS cost_amount
    FROM finops.cur_raw
    GROUP BY
      billing_period,
      CAST(bill_billing_period_start_date AS date),
      line_item_usage_account_id,
      line_item_product_code
    """

    df = run_athena_query(query)
    print(f"Monthly rows: {len(df)}")

    if df.empty:
        return

    conn = get_pg_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                for _, row in df.iterrows():
                    cur.execute(
                        """
                        INSERT INTO aws_monthly_costs (
                            month,
                            billing_period,
                            billing_month,
                            account_id,
                            service,
                            cost_amount,
                            currency
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, 'USD')
                        ON CONFLICT (month, account_id, service)
                        DO UPDATE SET
                            billing_period = EXCLUDED.billing_period,
                            billing_month  = EXCLUDED.billing_month,
                            cost_amount    = EXCLUDED.cost_amount,
                            currency       = EXCLUDED.currency;
                        """,
                        (
                            # `month` recebe o mes de COBRANCA. A coluna continua
                            # existindo para nao quebrar quem ja consulta por
                            # ela (Metabase), mas passa a significar a mesma
                            # coisa que billing_month.
                            row["billing_month"],
                            str(row["billing_period"]),
                            row["billing_month"],
                            str(row["account_id"]),
                            str(row["service"]),
                            float(row["cost_amount"]),
                        ),
                    )
    finally:
        conn.close()


def load_daily_costs():
    """Carga diaria: mantem a data de uso E passa a gravar o periodo de cobranca.

    `usage_date` continua sendo a chave da evolucao diaria operacional -- e a
    unica coisa que responde "em que dia isso rodou". O que muda e que a linha
    agora carrega tambem a fatura a que pertence.
    """
    query = """
    SELECT
      billing_period,
      CAST(bill_billing_period_start_date AS date) AS billing_month,
      CAST(line_item_usage_start_date AS date) AS usage_date,
      line_item_usage_account_id AS account_id,
      line_item_product_code AS service,
      COALESCE(line_item_availability_zone, '') AS region,
      SUM(line_item_unblended_cost) AS cost_amount
    FROM finops.cur_raw
    GROUP BY
      billing_period,
      CAST(bill_billing_period_start_date AS date),
      CAST(line_item_usage_start_date AS date),
      line_item_usage_account_id,
      line_item_product_code,
      COALESCE(line_item_availability_zone, '')
    """

    df = run_athena_query(query)
    print(f"Daily rows: {len(df)}")

    if df.empty:
        return

    conn = get_pg_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                for _, row in df.iterrows():
                    cur.execute(
                        """
                        INSERT INTO aws_daily_costs (
                            usage_date,
                            billing_period,
                            billing_month,
                            account_id,
                            service,
                            region,
                            cost_amount,
                            currency
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, 'USD')
                        ON CONFLICT (usage_date, account_id, service, region)
                        DO UPDATE SET
                            billing_period = EXCLUDED.billing_period,
                            billing_month  = EXCLUDED.billing_month,
                            cost_amount    = EXCLUDED.cost_amount,
                            currency       = EXCLUDED.currency;
                        """,
                        (
                            row["usage_date"],
                            str(row["billing_period"]),
                            row["billing_month"],
                            str(row["account_id"]),
                            str(row["service"]),
                            str(row["region"]),
                            float(row["cost_amount"]),
                        ),
                    )
    finally:
        conn.close()


if __name__ == "__main__":
    print("Starting FinOps ETL...")
    load_monthly_costs()
    load_daily_costs()
    print("FinOps ETL finished.")
