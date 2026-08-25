#!/usr/bin/env python3
"""
Fila de coleta sob demanda: `cloud_sync_jobs`.

O portal INSERE uma linha; este modulo, rodando no host, PROCESSA. A fronteira de
confianca fica no banco, que os dois lados ja acessam -- o container do portal
nunca executa shell nem alcanca o venv do collector.

---------------------------------------------------------------------------
DOIS CADEADOS, PARA DOIS PROBLEMAS DIFERENTES

Confundir os dois leva a implementar um e achar que o outro esta resolvido.

1. FILA DUPLA -- dois cliques no botao, ou duas requisicoes simultaneas, criando
   dois jobs para a mesma conta. Resolvido pelo indice unico parcial
   `cloud_sync_jobs_conta_ativa_uniq` (migracao 008). E o banco que decide, e nao
   `SELECT` antes de `INSERT`, que e corrida perdida por definicao.

2. COLETA SIMULTANEA -- o worker pegando uma conta que a coleta diaria das 09:00
   ja esta coletando. O indice nao cobre isso: a coleta diaria nao passa por job
   nenhum. Resolvido por LOCK CONSULTIVO (`pg_try_advisory_lock`), tomado pelos
   DOIS caminhos com a mesma chave.

O lock consultivo e por sessao, entao precisa de uma conexao dedicada mantida
aberta durante a coleta. `TravaConta` cuida disso.

---------------------------------------------------------------------------
O QUE NAO ESTA AQUI

Retentativa automatica com espera progressiva. Um job que falha porque a OVH
recusou a credencial nao melhora sozinho, e reenfileirar sem parar produziria
ruido no historico e chamada inutil a API. `MAX_TENTATIVAS` existe apenas para o
caso do worker morrer no meio -- ver `reabrir_orfaos`.
"""

from __future__ import annotations

from collections.abc import Iterable

import re
from dataclasses import dataclass

#: Prefixo da chave do lock consultivo. Namespace explicito para nao colidir com
#: outro uso de advisory lock no mesmo banco (o Metabase tambem vive nele).
PREFIXO_TRAVA = "ovh-sync:"

#: Um job so pode ser reivindicado este numero de vezes. Protege contra o caso do
#: worker ser morto no meio da coleta: `reabrir_orfaos` devolve o job para a fila,
#: e sem limite ele voltaria para sempre.
MAX_TENTATIVAS = 3

#: Tempo apos o qual um job `running` e considerado abandonado. Maior que a coleta
#: mais lenta observada (~70s para uma conta) com folga larga: matar um job que
#: apenas esta demorando produziria coleta duplicada, que e pior do que esperar.
MINUTOS_ORFAO = 30

STATUS_TERMINAIS = ("success", "failed", "cancelled")

_SEQUENCIA_LONGA = re.compile(r"[A-Za-z0-9+/_-]{16,}")


class FilaAusente(Exception):
    """`cloud_sync_jobs` nao existe -- a migracao 008 nao rodou neste ambiente."""


def sanitizar(texto: str, limite: int = 500) -> str:
    """
    Corta qualquer sequencia longa antes de a mensagem chegar ao banco.

    A mesma regra do portal e do collector. O erro cru da OVH carrega o
    `OVH-Query-ID` e, em alguns modos de falha, fragmento da propria credencial --
    e `error_message` e um campo que a TELA mostra.
    """
    limpo = _SEQUENCIA_LONGA.sub("<omitido>", texto or "")
    return limpo[:limite]


@dataclass(frozen=True)
class Job:
    id: int
    account_id: str
    action: str
    attempts: int


def fila_existe(conexao) -> bool:
    with conexao.cursor() as cur:
        cur.execute("SELECT to_regclass('public.cloud_sync_jobs') IS NOT NULL")
        return bool(cur.fetchone()[0])


# ------------------------------------------------------------ lock consultivo
class TravaConta:
    """
    Exclusao mutua por conta, entre processos, via `pg_try_advisory_lock`.

    Usada pelo worker E pela coleta diaria. `try` e nao a versao bloqueante de
    proposito: se a conta esta sendo coletada agora, a resposta certa e desistir e
    tentar no proximo ciclo -- nao empilhar processos esperando.

    Precisa de conexao DEDICADA: o lock e por sessao, e a conexao usada para
    gravar custo abre e fecha varias vezes durante a coleta, o que soltaria o lock
    no meio.
    """

    def __init__(self, conexao, account_id: str) -> None:
        self.conexao = conexao
        self.account_id = account_id
        self.obtida = False

    def __enter__(self) -> "TravaConta":
        with self.conexao.cursor() as cur:
            cur.execute(
                "SELECT pg_try_advisory_lock(hashtext(%s))",
                (PREFIXO_TRAVA + self.account_id,),
            )
            self.obtida = bool(cur.fetchone()[0])
        return self

    def __exit__(self, *_) -> None:
        if not self.obtida:
            return
        try:
            with self.conexao.cursor() as cur:
                cur.execute(
                    "SELECT pg_advisory_unlock(hashtext(%s))",
                    (PREFIXO_TRAVA + self.account_id,),
                )
        except Exception:  # noqa: BLE001
            # Soltar o lock e melhor esforco: fechar a conexao ja o solta, e
            # levantar aqui mascararia a excecao real que trouxe o codigo ao
            # `__exit__`.
            pass
        finally:
            self.obtida = False


# ------------------------------------------------------------------ fila: ler
SQL_REIVINDICAR = """
WITH proximo AS (
    SELECT id
      FROM cloud_sync_jobs
     WHERE status = 'queued'
       AND provider = 'ovh'
       AND NOT (id = ANY(%s::bigint[]))
     ORDER BY requested_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED
)
UPDATE cloud_sync_jobs j
   SET status     = 'running',
       started_at = now(),
       attempts   = j.attempts + 1
  FROM proximo
 WHERE j.id = proximo.id
RETURNING j.id, j.account_id, j.action, j.attempts
"""


def reivindicar(conexao, excluir: Iterable[int] = ()) -> Job | None:
    """
    Pega o job mais antigo em `queued` e o marca `running`, atomicamente.

    `FOR UPDATE SKIP LOCKED` e o que permite dois workers rodarem sem coordenacao
    externa: o segundo pula a linha que o primeiro travou em vez de esperar por
    ela. Sem `SKIP LOCKED`, dois workers serializariam e o segundo processaria o
    MESMO job depois do commit do primeiro.

    `excluir` sao ids que ESTE worker ja adiou nesta execucao.

    Sem ele o worker gira em falso: um job adiado volta para `queued`, e como a
    ordem e por `requested_at` ele e imediatamente o mais antigo de novo. O laco
    o reivindicava, adiava, reivindicava -- gastando as `--max` iteracoes no mesmo
    job e, pior, impedindo que qualquer OUTRA conta fosse atendida, porque a
    consulta nunca chegava nela.
    """
    if not fila_existe(conexao):
        raise FilaAusente(
            "cloud_sync_jobs nao existe -- rode "
            "scripts/migrations/008-cloud-sync-jobs.sql"
        )

    with conexao.cursor() as cur:
        cur.execute(SQL_REIVINDICAR, (list(excluir),))
        linha = cur.fetchone()

    if linha is None:
        return None
    return Job(id=linha[0], account_id=linha[1], action=linha[2], attempts=linha[3])


def concluir(
    conexao,
    job_id: int,
    *,
    status: str,
    sync_run_id: int | None = None,
    erro: str | None = None,
) -> None:
    """Fecha o job. `erro` e sanitizado aqui, nao na chamada -- ultima barreira."""
    if status not in STATUS_TERMINAIS:
        raise ValueError(f"status terminal invalido: {status!r}")

    with conexao.cursor() as cur:
        cur.execute(
            """
            UPDATE cloud_sync_jobs
               SET status        = %s,
                   finished_at   = now(),
                   sync_run_id   = COALESCE(%s, sync_run_id),
                   error_message = %s
             WHERE id = %s
            """,
            (status, sync_run_id, sanitizar(erro) if erro else None, job_id),
        )


def devolver_para_fila(conexao, job_id: int, motivo: str) -> None:
    """
    Devolve um job `running` para `queued`, ou o mata se estourou as tentativas.

    O job volta para a fila quando o worker nao conseguiu nem comecar -- conta
    travada por outro processo, por exemplo. Nao volta quando a coleta rodou e
    falhou: isso e `failed`, e repetir nao ajuda.
    """
    with conexao.cursor() as cur:
        cur.execute(
            """
            UPDATE cloud_sync_jobs
               SET status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'queued' END,
                   started_at = CASE WHEN attempts >= %s THEN started_at ELSE NULL END,
                   finished_at = CASE WHEN attempts >= %s THEN now() ELSE NULL END,
                   error_message = %s
             WHERE id = %s
            """,
            (MAX_TENTATIVAS, MAX_TENTATIVAS, MAX_TENTATIVAS, sanitizar(motivo), job_id),
        )


def adiar_por_conta_ocupada(conexao, job_id: int, motivo: str) -> None:
    """
    Devolve o job para `queued` SEM gastar tentativa.

    ---------------------------------------------------------------------------
    ADIAR NAO E TENTAR

    `reivindicar` incrementa `attempts` ao marcar `running` -- otimista, porque
    normalmente o trabalho comeca em seguida. Quando a conta esta travada por
    outro processo, nenhum trabalho aconteceu: nao houve chamada a OVH, nao houve
    escrita, nao houve erro. Cobrar uma tentativa por isso faz o job morrer por
    ESTAR OCUPADO.

    O caso concreto: uma coleta pedida pelo portal enquanto a carga diaria das
    09:00 corre a mesma conta. Com o incremento valendo, o job gastava as tres
    tentativas em segundos e a tela mostrava "coleta falhou" para uma coleta que
    so estava esperando a vez -- e que teria funcionado um minuto depois.

    Por isso `attempts` volta ao valor anterior. Nao ha risco de laco infinito: o
    worker exclui o job do resto desta execucao (ver `reivindicar`), e a coleta
    concorrente termina.
    """
    with conexao.cursor() as cur:
        cur.execute(
            """
            UPDATE cloud_sync_jobs
               SET status        = 'queued',
                   started_at    = NULL,
                   finished_at   = NULL,
                   attempts      = GREATEST(attempts - 1, 0),
                   error_message = %s
             WHERE id = %s
            """,
            (sanitizar(motivo), job_id),
        )


def reabrir_orfaos(conexao, minutos: int = MINUTOS_ORFAO) -> int:
    """
    Trata job `running` de worker que morreu.

    Sem isto, o indice unico parcial trabalharia contra nos: um job travado em
    `running` para sempre impediria QUALQUER novo job daquela conta, e o botao no
    portal passaria a recusar coleta sem explicacao.

    Job que ja gastou as tentativas vira `failed` em vez de voltar para a fila.
    """
    if not fila_existe(conexao):
        return 0

    with conexao.cursor() as cur:
        cur.execute(
            """
            UPDATE cloud_sync_jobs
               SET status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'queued' END,
                   started_at = CASE WHEN attempts >= %s THEN started_at ELSE NULL END,
                   finished_at = CASE WHEN attempts >= %s THEN now() ELSE NULL END,
                   error_message = %s
             WHERE status = 'running'
               AND started_at < now() - make_interval(mins => %s)
            """,
            (
                MAX_TENTATIVAS,
                MAX_TENTATIVAS,
                MAX_TENTATIVAS,
                f"worker interrompido: sem conclusao apos {minutos} min",
                minutos,
            ),
        )
        return cur.rowcount or 0


def enfileirar(conexao, account_id: str, *, action: str = "manual_sync") -> int | None:
    """
    Enfileira pela linha de comando. O portal faz o proprio INSERT em TypeScript.

    Devolve o id do job criado, ou `None` quando ja havia um vivo para a conta --
    e `None` NAO e erro: pedir coleta de algo que ja esta na fila foi atendido.
    """
    if not fila_existe(conexao):
        raise FilaAusente(
            "cloud_sync_jobs nao existe -- rode "
            "scripts/migrations/008-cloud-sync-jobs.sql"
        )

    with conexao.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cloud_sync_jobs (provider, account_id, action, status)
            VALUES ('ovh', %s, %s, 'queued')
                ON CONFLICT DO NOTHING
             RETURNING id
            """,
            (account_id, action),
        )
        linha = cur.fetchone()
    return linha[0] if linha else None
