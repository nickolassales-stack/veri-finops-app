#!/usr/bin/env python3
"""
FinOps :: registra execucao do ETL em `app_etl_runs`.

PARA QUE ISTO EXISTE, JA QUE O ETL SE REGISTRA SOZINHO
------------------------------------------------------
`scripts/etl/athena_to_postgres.py` abre e fecha a propria linha, e e ele quem
sabe a contagem de linhas. Este utilitario cobre o que o proprio ETL nao
consegue cobrir:

  * carga feita a mao por outro caminho (psql, backfill, reprocessamento) que
    ainda assim precisa aparecer no diagnostico;
  * execucao que morreu de forma a nao conseguir gravar nada -- `--fechar-orfas`
    conserta o bookkeeping sem esperar a proxima carga;
  * conferencia rapida do que a tela esta lendo (`--ultimas`).

CREDENCIAIS
-----------
Le PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASSWORD do ambiente, exatamente como o ETL.
Nao ha valor padrao para a senha, e ela nunca e argumento de linha de comando --
argumento aparece em `ps` e no historico do shell.

    export PG_PASSWORD='...'      # ou: read -rs PG_PASSWORD && export PG_PASSWORD
    ./scripts/register-etl-status.py --ultimas

EXEMPLOS
--------
    # abrir uma execucao manual e capturar o id
    ID=$(./scripts/register-etl-status.py --abrir --source manual)

    # ... rodar a carga ...

    ./scripts/register-etl-status.py --fechar "$ID" --status success \\
        --mensais 50 --diarias 885

    # deu errado
    ./scripts/register-etl-status.py --fechar "$ID" --status failed \\
        --erro "Athena query failed: FAILED - Insufficient permissions"

    # fechar execucoes abertas ha mais de 2h como interrompidas
    ./scripts/register-etl-status.py --fechar-orfas --minutos 120
"""

import argparse
import os
import re
import sys

import psycopg2

LIMITE_MENSAGEM = 500

# Mesma redacao aplicada pelo ETL. Duplicada aqui, e nao importada, porque este
# script roda a partir de /opt/finops enquanto o ETL vive em /opt/finops/etl --
# um import entre eles obrigaria a mexer no PYTHONPATH do cron para ganhar
# quatro linhas.
_REDACOES = (
    (re.compile(r"(password\s*=\s*)(\S+)", re.I), r"\1***"),
    (re.compile(r"(PG_PASSWORD\s*[=:]\s*)(\S+)", re.I), r"\1***"),
    (re.compile(r"://([^:/\s]+):([^@/\s]+)@"), r"://\1:***@"),
    (re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"), "***"),
    (re.compile(r"(aws_secret_access_key\s*[=:]\s*)(\S+)", re.I), r"\1***"),
)


def sanitizar(texto):
    if not texto:
        return None
    for padrao, troca in _REDACOES:
        texto = padrao.sub(troca, texto)
    texto = " ".join(texto.split())
    return texto[: LIMITE_MENSAGEM - 1] + "…" if len(texto) > LIMITE_MENSAGEM else texto


def conectar():
    try:
        senha = os.environ["PG_PASSWORD"]
    except KeyError:
        sys.exit("ERRO: PG_PASSWORD nao esta no ambiente. Ver o cabecalho deste arquivo.")

    conn = psycopg2.connect(
        host=os.getenv("PG_HOST", "127.0.0.1"),
        port=int(os.getenv("PG_PORT", "5432")),
        dbname=os.getenv("PG_DB", "finops"),
        user=os.getenv("PG_USER", "finops_user"),
        password=senha,
    )
    conn.autocommit = True
    return conn


def abrir(cur, source, log_path):
    cur.execute(
        """
        INSERT INTO app_etl_runs (started_at, status, source, log_path)
        VALUES (now(), 'running', %s, %s)
        RETURNING id
        """,
        (source, log_path),
    )
    return cur.fetchone()[0]


def fechar(cur, run_id, status, mensais, diarias, erro):
    cur.execute(
        """
        UPDATE app_etl_runs
           SET status        = %s,
               finished_at   = now(),
               monthly_rows  = coalesce(%s, monthly_rows),
               daily_rows    = coalesce(%s, daily_rows),
               error_message = coalesce(%s, error_message)
         WHERE id = %s
        """,
        (status, mensais, diarias, sanitizar(erro), run_id),
    )
    return cur.rowcount


def fechar_orfas(cur, minutos):
    cur.execute(
        """
        UPDATE app_etl_runs
           SET status        = 'failed',
               finished_at   = now(),
               error_message = coalesce(error_message,
                                        'Execucao interrompida: fechada manualmente por '
                                        'register-etl-status.py')
         WHERE status = 'running'
           AND started_at < now() - make_interval(mins => %s)
        RETURNING id
        """,
        (minutos,),
    )
    return [linha[0] for linha in cur.fetchall()]


def ultimas(cur, limite):
    cur.execute(
        """
        SELECT id, started_at, finished_at, status, source,
               monthly_rows, daily_rows, left(coalesce(error_message, ''), 60)
          FROM app_etl_runs
         ORDER BY started_at DESC
         LIMIT %s
        """,
        (limite,),
    )
    return cur.fetchall()


def main():
    p = argparse.ArgumentParser(
        description="Registra execucao do ETL FinOps em app_etl_runs.",
        epilog="Todas as escritas usam consulta parametrizada; nada e concatenado em SQL.",
    )
    acao = p.add_mutually_exclusive_group(required=True)
    acao.add_argument("--abrir", action="store_true", help="abre uma execucao e imprime o id")
    acao.add_argument("--fechar", metavar="ID", type=int, help="fecha a execucao informada")
    acao.add_argument("--fechar-orfas", action="store_true",
                      help="marca execucoes abertas ha tempo demais como interrompidas")
    acao.add_argument("--ultimas", nargs="?", const=10, type=int, metavar="N",
                      help="lista as N ultimas execucoes (padrao 10)")

    p.add_argument("--source", choices=("manual", "cron", "unknown"), default="manual")
    p.add_argument("--status", choices=("success", "failed"))
    p.add_argument("--mensais", type=int, help="linhas carregadas no mensal")
    p.add_argument("--diarias", type=int, help="linhas carregadas no diario")
    p.add_argument("--erro", help="mensagem de erro (sera sanitizada e truncada)")
    p.add_argument("--log-path", default=os.getenv("ETL_LOG_PATH"))
    p.add_argument("--minutos", type=int, default=120,
                   help="idade minima, em minutos, para dar uma execucao por interrompida")

    args = p.parse_args()

    if args.fechar is not None and not args.status:
        p.error("--fechar exige --status success|failed")

    conn = conectar()
    try:
        with conn.cursor() as cur:
            if args.abrir:
                print(abrir(cur, args.source, args.log_path))

            elif args.fechar is not None:
                if fechar(cur, args.fechar, args.status, args.mensais, args.diarias, args.erro):
                    print(f"execucao {args.fechar} fechada como {args.status}")
                else:
                    sys.exit(f"ERRO: execucao {args.fechar} nao encontrada")

            elif args.fechar_orfas:
                ids = fechar_orfas(cur, args.minutos)
                print(f"{len(ids)} execucao(oes) fechada(s)" + (f": {ids}" if ids else ""))

            else:
                for linha in ultimas(cur, args.ultimas):
                    print("  ".join("-" if c is None else str(c) for c in linha))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
