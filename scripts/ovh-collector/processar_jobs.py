#!/usr/bin/env python3
"""
Worker da fila `cloud_sync_jobs`.

Le os jobs que o portal enfileirou e executa a coleta. Roda no HOST, onde o venv
e as dependencias do collector existem -- o container do portal nunca executa
nada disto.

    ./run-cloud-sync-jobs.sh              # o que o cron chama
    venv/bin/python processar_jobs.py --max 3
    venv/bin/python processar_jobs.py --enfileirar ovh-main-ca

---------------------------------------------------------------------------
POR QUE UM LIMITE DE JOBS POR EXECUCAO

`--max` existe para o worker terminar. Chamado a cada minuto pelo cron, um worker
que drenasse a fila inteira poderia ficar horas no ar se alguem enfileirasse
muitas contas, e a proxima execucao do cron encontraria o anterior ainda vivo.
Processar poucos e sair deixa o cron ser o laco.

---------------------------------------------------------------------------
CODIGOS DE SAIDA

    0  nada na fila, ou tudo processado com sucesso
    2  configuracao ausente, ou a migracao 008 nao rodou
    3  dependencia Python ausente
    6  pelo menos um job falhou

O 6 e o mesmo codigo de falha parcial de `ovh_to_postgres.py`, de proposito: quem
le o log do cron nao precisa aprender duas tabelas de codigo.
"""

from __future__ import annotations

import argparse
import sys

import jobs_ovh
from contas_ovh import ErroDeCredencial
from ovh_to_postgres import (
    carregar_config,
    conectar_banco,
    descobrir,
    log,
    sanitizar_erro,
    sincronizar_conta,
)


def processar_um(conexao, base, job: jobs_ovh.Job, source: str) -> str:
    """
    Executa um job ja reivindicado.

    Devolve `"ok"`, `"falha"` ou `"adiado"` -- TRES resultados, e nao um booleano.

    `adiado` nao e sucesso nem falha: a conta esta sendo coletada por outro
    processo e este job volta para a fila intacto. Enquanto isto era `True`
    (sucesso), o resumo do worker dizia "3 jobs processados, 0 falhas" para uma
    execucao que nao coletou nada -- e o operador nao tinha como saber.

    NUNCA levanta: um job que estoura tem de ser fechado como `failed`, senao fica
    `running` para sempre e o indice unico parcial impede qualquer novo job
    daquela conta -- o botao no portal passaria a recusar coleta sem explicacao.
    """
    cid = job.account_id
    log(f"job {job.id}: conta={cid} action={job.action} tentativa={job.attempts}")

    # O LOCK. Impede que este worker colida com a coleta diaria das 09:00, que nao
    # passa por job nenhum e portanto nao e coberta pelo indice unico.
    trava = jobs_ovh.TravaConta(conexao, cid)
    with trava:
        if not trava.obtida:
            log(f"job {job.id}: conta em coleta por outro processo, devolvido a fila")
            # `adiar_por_conta_ocupada` e nao `devolver_para_fila`: nenhum trabalho
            # aconteceu, entao a tentativa nao pode ser cobrada. Ver o docstring
            # daquela funcao -- cobrar fazia o job morrer por ESTAR OCUPADO.
            jobs_ovh.adiar_por_conta_ocupada(
                conexao, job.id, "conta em coleta por outro processo"
            )
            return "adiado"

        try:
            descoberta = descobrir(base, cid)
        except ErroDeCredencial as exc:
            msg = str(exc)
            log(f"job {job.id}: FALHA -- {msg}")
            jobs_ovh.concluir(conexao, job.id, status="failed", erro=msg)
            return "falha"

        if not descoberta.contas:
            msg = (
                f"nenhuma credencial utilizavel para {cid}: cadastre em "
                "Configuracoes > Contas Cloud, ou verifique se a conta esta ativa"
            )
            log(f"job {job.id}: FALHA -- {msg}")
            jobs_ovh.concluir(conexao, job.id, status="failed", erro=msg)
            return "falha"

        conta = descoberta.contas[0]
        log(f"job {job.id}: credencial via {conta.origem}")

        try:
            ok, contagens, erro, run_id = sincronizar_conta(
                conta, base, source, None, False
            )
        except Exception as exc:  # noqa: BLE001
            # `sincronizar_conta` promete nao levantar, mas esta e a rede que
            # garante que o job nao fica `running` se a promessa quebrar.
            msg = sanitizar_erro(exc)
            log(f"job {job.id}: FALHA inesperada -- {msg}")
            jobs_ovh.concluir(conexao, job.id, status="failed", erro=msg)
            return "falha"

        if ok:
            log(
                f"job {job.id}: sucesso  projetos={contagens.get('projetos', 0)} "
                f"faturas={contagens.get('faturas', 0)} "
                f"linhas_fatura={contagens.get('linhas', 0)} "
                f"custos={contagens.get('custos', 0)}"
            )
            jobs_ovh.concluir(conexao, job.id, status="success", sync_run_id=run_id)
            return "ok"

        jobs_ovh.concluir(conexao, job.id, status="failed", sync_run_id=run_id, erro=erro)
        return "falha"


def main() -> int:
    ap = argparse.ArgumentParser(description="Worker da fila cloud_sync_jobs")
    ap.add_argument("--max", type=int, default=3, help="jobs por execucao (padrao 3)")
    ap.add_argument(
        "--source", default="job", choices=("job", "manual", "cron"),
        help="valor gravado em ovh_sync_runs.source",
    )
    ap.add_argument(
        "--enfileirar", metavar="ID",
        help="enfileira coleta manual para esta conta e sai (nao processa)",
    )
    args = ap.parse_args()

    try:
        import psycopg2  # noqa: F401
    except ImportError as exc:
        log(f"ERRO: dependencia ausente ({exc}). pip install -r requirements.txt")
        return 3

    base = carregar_config()

    try:
        conexao = conectar_banco(base, autocommit=True)
    except Exception as exc:
        log(f"ERRO: sem conexao com o banco ({sanitizar_erro(exc)})")
        return 2

    try:
        if args.enfileirar:
            try:
                job_id = jobs_ovh.enfileirar(conexao, args.enfileirar)
            except jobs_ovh.FilaAusente as exc:
                log(f"ERRO: {exc}")
                return 2
            if job_id is None:
                log(f"{args.enfileirar}: ja havia job na fila; nada a fazer")
            else:
                log(f"{args.enfileirar}: job {job_id} enfileirado")
            return 0

        try:
            reabertos = jobs_ovh.reabrir_orfaos(conexao)
        except Exception as exc:  # noqa: BLE001
            log(f"aviso: nao foi possivel reabrir orfaos ({sanitizar_erro(exc)})")
            reabertos = 0
        if reabertos:
            log(f"jobs orfaos tratados: {reabertos}")

        falhas = 0
        feitos = 0
        # Jobs adiados NESTA execucao. Sem excluí-los, o laco reivindica o mesmo
        # job repetidamente -- ele volta para `queued` e e de novo o mais antigo --
        # gastando as iteracoes e impedindo que outras contas sejam atendidas.
        adiados: list[int] = []

        for _ in range(max(1, args.max)):
            try:
                job = jobs_ovh.reivindicar(conexao, excluir=adiados)
            except jobs_ovh.FilaAusente as exc:
                # Sem a migracao 008 o worker sai limpo. Cron a cada minuto
                # estourando erro encheria o log e esconderia problema de verdade.
                log(f"fila ausente: {exc}")
                return 2

            if job is None:
                break

            resultado = processar_um(conexao, base, job, args.source)
            if resultado == "adiado":
                adiados.append(job.id)
                continue

            feitos += 1
            if resultado == "falha":
                falhas += 1

        if feitos == 0 and not adiados:
            log("nada na fila")
            return 0

        if adiados:
            log(
                f"--- resumo --- jobs processados: {feitos}  falhas: {falhas}  "
                f"adiados (conta ocupada): {len(adiados)}"
            )
        else:
            log(f"--- resumo --- jobs processados: {feitos}  falhas: {falhas}")

        # Adiado NAO e falha: o job continua na fila e sera atendido. Devolver 6
        # aqui faria o cron registrar erro numa execucao que se comportou
        # exatamente como projetado.
        return 6 if falhas else 0
    finally:
        try:
            conexao.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
