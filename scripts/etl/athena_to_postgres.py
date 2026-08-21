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

REGISTRO DE EXECUCAO (14/08/2026)
---------------------------------
O script passou a gravar o proprio historico em `app_etl_runs`: abre uma linha
'running' no inicio e a fecha como 'success' ou 'failed' no fim, com a contagem
de linhas de cada carga. E o que alimenta /dashboard/diagnostico.

Tres regras que valem para todo esse trecho:

1. MONITORAMENTO NUNCA DERRUBA O QUE ELE MONITORA. Toda falha de registro vira
   aviso no log e a carga continua. Um erro ao anotar "comecei" jamais pode
   impedir o custo de entrar no banco.
2. A LINHA E ABERTA ANTES DA CARGA. Gravar so o resultado no final seria mais
   simples e esconderia exatamente o caso que interessa: a execucao que morreu
   no meio ficaria indistinguivel da que nunca comecou.
3. MENSAGEM DE ERRO E SANITIZADA. Vai a mensagem da excecao, curta e com
   segredo redigido -- nunca o traceback, que carrega variavel de ambiente.

Pre-requisito: migracao 003. Sem ela o script avisa uma vez por execucao e
carrega normalmente.

Variaveis opcionais:

    ETL_SOURCE        'cron' | 'manual' | 'unknown' (padrao)
    ETL_RUN_ID        adota uma execucao ja aberta por quem chamou
    ETL_LOG_PATH      caminho do log, guardado junto da execucao
    ETL_ORFA_MINUTOS  idade a partir da qual uma execucao aberta e dada por
                      interrompida (padrao 120)

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
import re
import time
from io import StringIO

import boto3
import pandas as pd
import psycopg2
import psycopg2.errors

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


# ============================================================================
# Registro de execucao em app_etl_runs
# ============================================================================

ETL_SOURCE = os.getenv("ETL_SOURCE", "unknown")
ETL_LOG_PATH = os.getenv("ETL_LOG_PATH") or None
ETL_ORFA_MINUTOS = int(os.getenv("ETL_ORFA_MINUTOS", "120"))

FONTES_VALIDAS = ("manual", "cron", "unknown")

# Padroes redigidos antes de qualquer mensagem ir para o banco. A lista nao
# precisa ser exaustiva para valer a pena: ela cobre a forma como o segredo
# REALMENTE aparece numa excecao de psycopg2/boto3 -- na string de conexao e no
# eco de variavel de ambiente.
_REDACOES = (
    (re.compile(r"(password\s*=\s*)(\S+)", re.I), r"\1***"),
    (re.compile(r"(PG_PASSWORD\s*[=:]\s*)(\S+)", re.I), r"\1***"),
    # usuario:senha@host em URI de conexao
    (re.compile(r"://([^:/\s]+):([^@/\s]+)@"), r"://\1:***@"),
    # chave de acesso AWS, que aparece em erro de credencial do boto3
    (re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"(aws_secret_access_key\s*[=:]\s*)(\S+)", re.I), r"\1***"),
)

LIMITE_MENSAGEM = 500


def sanitizar_erro(erro) -> str:
    """Mensagem curta, de uma linha e sem segredo.

    Deliberadamente NAO usa traceback.format_exc(): o traceback traz o quadro
    local da chamada, e o quadro de `get_pg_connection` inclui a senha. O que o
    diagnostico precisa e do tipo e da mensagem -- o resto esta no log da EC2,
    que fica no servidor e nao passa pela aplicacao.
    """
    texto = f"{type(erro).__name__}: {erro}".strip()
    for padrao, troca in _REDACOES:
        texto = padrao.sub(troca, texto)
    texto = " ".join(texto.split())
    if len(texto) > LIMITE_MENSAGEM:
        texto = texto[: LIMITE_MENSAGEM - 1] + "…"
    return texto


def _registrar(operacao, *args):
    """Executa uma escrita de bookkeeping, engolindo qualquer falha.

    Conexao propria e autocommit: o registro precisa sobreviver ao rollback da
    carga. Se a transacao do 'failed' morresse junto com a transacao que falhou,
    a tela mostraria "executando" para sempre justamente quando deu errado.
    """
    try:
        conn = get_pg_connection()
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                return operacao(cur, *args)
        finally:
            conn.close()
    except psycopg2.errors.UndefinedTable:
        print(
            "AVISO: tabela app_etl_runs ausente -- rode "
            "scripts/migrations/003-diagnostico-etl.sql. A carga continua normalmente."
        )
    except Exception as err:  # noqa: BLE001 - bookkeeping nao pode derrubar a carga
        print(f"AVISO: falha ao registrar status do ETL ({sanitizar_erro(err)}). A carga continua.")
    return None


def fechar_execucoes_orfas():
    """Fecha execucoes abertas ha tempo demais como 'failed'.

    E a autocorrecao do bookkeeping: quando o processo morre de forma que nao
    permite gravar nada (OOM, kill -9, reboot), a linha fica 'running' para
    sempre. Quem conserta e a execucao SEGUINTE -- ninguem precisa de acesso ao
    banco para isso, e nao ha um segundo lugar guardando credencial.
    """

    def operacao(cur):
        cur.execute(
            """
            UPDATE app_etl_runs
               SET status        = 'failed',
                   finished_at   = now(),
                   error_message = coalesce(error_message,
                                            'Execucao interrompida: nao foi encerrada e '
                                            'uma nova execucao comecou.')
             WHERE status = 'running'
               AND started_at < now() - make_interval(mins => %s)
            """,
            (ETL_ORFA_MINUTOS,),
        )
        return cur.rowcount

    fechadas = _registrar(operacao)
    if fechadas:
        print(f"AVISO: {fechadas} execucao(oes) anterior(es) marcada(s) como interrompida(s).")


def abrir_execucao():
    """Abre a linha 'running' e devolve o id, ou None se nao foi possivel.

    Se `ETL_RUN_ID` vier no ambiente, ADOTA a execucao que o chamador ja abriu
    em vez de criar outra -- e assim que o wrapper e este script contam a mesma
    execucao uma vez so.
    """
    adotada = os.getenv("ETL_RUN_ID")
    if adotada:
        try:
            print(f"Registrando na execucao ja aberta: {int(adotada)}")
            return int(adotada)
        except ValueError:
            print(f"AVISO: ETL_RUN_ID invalido ({adotada!r}); abrindo execucao propria.")

    fonte = ETL_SOURCE if ETL_SOURCE in FONTES_VALIDAS else "unknown"
    if fonte != ETL_SOURCE:
        print(f"AVISO: ETL_SOURCE {ETL_SOURCE!r} desconhecido; registrando como 'unknown'.")

    def operacao(cur):
        cur.execute(
            """
            INSERT INTO app_etl_runs (started_at, status, source, log_path)
            VALUES (now(), 'running', %s, %s)
            RETURNING id
            """,
            (fonte, ETL_LOG_PATH),
        )
        return cur.fetchone()[0]

    run_id = _registrar(operacao)
    if run_id:
        print(f"Execucao registrada: id={run_id} source={fonte}")
    return run_id


def fechar_execucao(run_id, status, monthly_rows=None, daily_rows=None, erro=None):
    """Fecha a execucao com o resultado. Sem id, nao ha o que fechar."""
    if run_id is None:
        return

    def operacao(cur):
        cur.execute(
            """
            UPDATE app_etl_runs
               SET status        = %s,
                   finished_at   = now(),
                   monthly_rows  = coalesce(%s, monthly_rows),
                   daily_rows    = coalesce(%s, daily_rows),
                   error_message = %s
             WHERE id = %s
            """,
            (status, monthly_rows, daily_rows, erro, run_id),
        )
        return cur.rowcount

    _registrar(operacao)


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
        # Zero e um resultado, nao a ausencia de um: registrar 0 distingue "o
        # Athena nao devolveu nada" de "a carga nem chegou aqui" (que fica NULL).
        return 0

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

    return len(df)


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
        return 0

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

    return len(df)


if __name__ == "__main__":
    print("Starting FinOps ETL...")

    fechar_execucoes_orfas()
    execucao = abrir_execucao()

    mensais = None
    diarias = None
    try:
        mensais = load_monthly_costs()
        diarias = load_daily_costs()
    except Exception as err:
        # As contagens ja conhecidas vao junto: saber que o mensal carregou 50
        # linhas e o diario nem comecou e metade do diagnostico.
        fechar_execucao(execucao, "failed", mensais, diarias, sanitizar_erro(err))
        print("FinOps ETL FAILED.")
        # Repropagado de proposito: o codigo de saida e o log continuam sendo a
        # fonte de verdade para o cron. O registro e um espelho, nao um substituto.
        raise

    fechar_execucao(execucao, "success", mensais, diarias)
    print("FinOps ETL finished.")
