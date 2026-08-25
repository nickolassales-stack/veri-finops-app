#!/usr/bin/env python3
"""
Testes da fila `cloud_sync_jobs`.

    python -m unittest test_jobs_ovh -v

Sem psycopg2 e sem banco: a conexao e substituida por um roteiro que casa
fragmento de SQL com resposta. Roteiro em vez de lista posicional de proposito --
uma lista posicional quebra ao se acrescentar uma consulta no meio da funcao, e o
teste passa a falhar por motivo que nada tem a ver com o comportamento testado.
"""

from __future__ import annotations

import unittest

import jobs_ovh
from jobs_ovh import (
    MAX_TENTATIVAS,
    adiar_por_conta_ocupada,
    FilaAusente,
    Job,
    TravaConta,
    concluir,
    devolver_para_fila,
    enfileirar,
    fila_existe,
    reabrir_orfaos,
    reivindicar,
    sanitizar,
)


class CursorRoteiro:
    def __init__(self, roteiro: list[tuple[str, list]], registro: list) -> None:
        self.roteiro = roteiro
        self.registro = registro
        self._atual: list = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql: str, params=None) -> None:
        normal = " ".join(sql.split())
        self.registro.append((normal, params))
        for fragmento, resposta in self.roteiro:
            if fragmento in normal:
                self._atual = resposta
                self.rowcount = len(resposta)
                return
        self._atual = []
        self.rowcount = 0

    def fetchone(self):
        return self._atual[0] if self._atual else None

    def fetchall(self):
        return self._atual


class ConexaoRoteiro:
    def __init__(self, roteiro: list[tuple[str, list]]) -> None:
        self.roteiro = roteiro
        self.registro: list[tuple[str, object]] = []

    def cursor(self) -> CursorRoteiro:
        return CursorRoteiro(self.roteiro, self.registro)

    def close(self) -> None:
        pass

    def sql_executado(self) -> str:
        return " || ".join(s for s, _ in self.registro)


FILA_EXISTE = ("to_regclass('public.cloud_sync_jobs')", [(True,)])
FILA_AUSENTE = ("to_regclass('public.cloud_sync_jobs')", [(False,)])


# ================================================== 1. existencia da tabela
class TesteFilaAusente(unittest.TestCase):
    """Sem a migracao 008, nada pode estourar de forma feia -- o cron roda a cada minuto."""

    def test_fila_existe_falso(self) -> None:
        self.assertFalse(fila_existe(ConexaoRoteiro([FILA_AUSENTE])))

    def test_reivindicar_recusa_com_erro_nomeado(self) -> None:
        with self.assertRaises(FilaAusente) as ctx:
            reivindicar(ConexaoRoteiro([FILA_AUSENTE]))
        self.assertIn("008", str(ctx.exception))

    def test_enfileirar_recusa_com_erro_nomeado(self) -> None:
        with self.assertRaises(FilaAusente):
            enfileirar(ConexaoRoteiro([FILA_AUSENTE]), "ovh-main-ca")

    def test_reabrir_orfaos_devolve_zero_sem_estourar(self) -> None:
        self.assertEqual(reabrir_orfaos(ConexaoRoteiro([FILA_AUSENTE])), 0)


# ============================================================ 2. reivindicar
class TesteReivindicar(unittest.TestCase):
    def test_devolve_job_da_linha(self) -> None:
        conexao = ConexaoRoteiro(
            [FILA_EXISTE, ("UPDATE cloud_sync_jobs", [(7, "ovh-main-ca", "first_sync", 1)])]
        )
        job = reivindicar(conexao)
        self.assertEqual(job, Job(id=7, account_id="ovh-main-ca", action="first_sync", attempts=1))

    def test_fila_vazia_devolve_none(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        self.assertIsNone(reivindicar(conexao))

    def test_usa_skip_locked_para_dois_workers_nao_colidirem(self) -> None:
        """
        Sem `SKIP LOCKED` os workers serializariam e o segundo processaria o MESMO
        job depois do commit do primeiro -- coleta duplicada, nao concorrencia.
        """
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reivindicar(conexao)
        sql = conexao.sql_executado()
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("ORDER BY requested_at", sql)

    def test_incrementa_tentativas(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reivindicar(conexao)
        self.assertIn("attempts = j.attempts + 1", conexao.sql_executado())


# ================================================================ 3. concluir
class TesteConcluir(unittest.TestCase):
    def test_recusa_status_nao_terminal(self) -> None:
        for ruim in ("queued", "running", "inventado"):
            with self.subTest(status=ruim):
                with self.assertRaises(ValueError):
                    concluir(ConexaoRoteiro([]), 1, status=ruim)

    def test_aceita_os_tres_terminais(self) -> None:
        for bom in ("success", "failed", "cancelled"):
            with self.subTest(status=bom):
                concluir(ConexaoRoteiro([]), 1, status=bom)

    def test_grava_sync_run_id(self) -> None:
        conexao = ConexaoRoteiro([])
        concluir(conexao, 42, status="success", sync_run_id=99)
        _, params = conexao.registro[-1]
        self.assertIn(99, params)
        self.assertIn(42, params)

    def test_erro_e_sanitizado_antes_de_ir_ao_banco(self) -> None:
        """
        `error_message` e um campo que a TELA mostra, e o erro cru da OVH carrega
        o `OVH-Query-ID` e, em alguns modos de falha, fragmento da credencial.
        """
        conexao = ConexaoRoteiro([])
        segredo = "a" * 40
        concluir(conexao, 1, status="failed", erro=f"recusado: {segredo}")
        _, params = conexao.registro[-1]
        gravado = next(p for p in params if isinstance(p, str) and "recusado" in p)
        self.assertNotIn(segredo, gravado)
        self.assertIn("<omitido>", gravado)


# ============================================================== 4. sanitizar
class TesteSanitizar(unittest.TestCase):
    def test_remove_sequencia_longa(self) -> None:
        self.assertEqual(sanitizar("chave " + "b" * 32), "chave <omitido>")

    def test_preserva_texto_curto_legivel(self) -> None:
        self.assertEqual(
            sanitizar("This credential is not valid"),
            "This credential is not valid",
        )

    def test_corta_no_limite(self) -> None:
        self.assertEqual(len(sanitizar("x " * 600, limite=50)), 50)

    def test_none_e_vazio_nao_estouram(self) -> None:
        self.assertEqual(sanitizar(""), "")
        self.assertEqual(sanitizar(None), "")


# ================================================== 5. lock anti-concorrencia
class TesteTravaConta(unittest.TestCase):
    def test_obtem_a_trava(self) -> None:
        conexao = ConexaoRoteiro([("pg_try_advisory_lock", [(True,)])])
        with TravaConta(conexao, "ovh-main-ca") as t:
            self.assertTrue(t.obtida)

    def test_nao_obtem_quando_outro_processo_tem(self) -> None:
        conexao = ConexaoRoteiro([("pg_try_advisory_lock", [(False,)])])
        with TravaConta(conexao, "ovh-main-ca") as t:
            self.assertFalse(t.obtida)
        # Nao tenta soltar o que nao pegou -- soltar lock alheio seria pior que o bug.
        self.assertNotIn("pg_advisory_unlock", conexao.sql_executado())

    def test_solta_ao_sair(self) -> None:
        conexao = ConexaoRoteiro(
            [("pg_try_advisory_lock", [(True,)]), ("pg_advisory_unlock", [(True,)])]
        )
        with TravaConta(conexao, "ovh-main-ca"):
            pass
        self.assertIn("pg_advisory_unlock", conexao.sql_executado())

    def test_a_chave_e_namespaceada_pela_conta(self) -> None:
        """
        O banco e compartilhado com o Metabase. Chave sem namespace poderia colidir
        com outro uso de advisory lock e travar coleta por motivo invisivel.
        """
        conexao = ConexaoRoteiro([("pg_try_advisory_lock", [(True,)])])
        with TravaConta(conexao, "ovh-main-ca"):
            pass
        _, params = conexao.registro[0]
        self.assertEqual(params, ("ovh-sync:ovh-main-ca",))

    def test_contas_diferentes_usam_chaves_diferentes(self) -> None:
        chaves = []
        for cid in ("ovh-a-ca", "ovh-b-ca"):
            conexao = ConexaoRoteiro([("pg_try_advisory_lock", [(True,)])])
            with TravaConta(conexao, cid):
                pass
            chaves.append(conexao.registro[0][1])
        self.assertNotEqual(chaves[0], chaves[1])

    def test_solta_mesmo_com_excecao_dentro_do_bloco(self) -> None:
        conexao = ConexaoRoteiro(
            [("pg_try_advisory_lock", [(True,)]), ("pg_advisory_unlock", [(True,)])]
        )
        with self.assertRaises(RuntimeError):
            with TravaConta(conexao, "ovh-main-ca"):
                raise RuntimeError("falha no meio da coleta")
        self.assertIn("pg_advisory_unlock", conexao.sql_executado())


# ============================================================== 6. enfileirar
class TesteEnfileirar(unittest.TestCase):
    def test_devolve_id_do_job_criado(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("INSERT INTO cloud_sync_jobs", [(15,)])])
        self.assertEqual(enfileirar(conexao, "ovh-main-ca"), 15)

    def test_conflito_devolve_none_e_nao_e_erro(self) -> None:
        """
        Job ja na fila para a conta: o indice unico parcial recusa o INSERT e o
        `ON CONFLICT DO NOTHING` nao devolve linha. Pedir coleta de algo que ja
        esta na fila FOI ATENDIDO -- tratar como erro faria a tela mostrar falha
        para o segundo clique de um botao que funcionou.
        """
        conexao = ConexaoRoteiro([FILA_EXISTE, ("INSERT INTO cloud_sync_jobs", [])])
        self.assertIsNone(enfileirar(conexao, "ovh-main-ca"))

    def test_usa_on_conflict_do_nothing(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("INSERT INTO cloud_sync_jobs", [(1,)])])
        enfileirar(conexao, "ovh-main-ca")
        self.assertIn("ON CONFLICT DO NOTHING", conexao.sql_executado())

    def test_action_padrao_e_manual(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("INSERT INTO cloud_sync_jobs", [(1,)])])
        enfileirar(conexao, "ovh-main-ca")
        _, params = conexao.registro[-1]
        self.assertEqual(params, ("ovh-main-ca", "manual_sync"))


# ============================================================== 7. orfaos
class TesteOrfaos(unittest.TestCase):
    def test_reabre_e_conta_as_linhas(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [(1,), (2,)])])
        self.assertEqual(reabrir_orfaos(conexao), 2)

    def test_respeita_o_limite_de_tentativas(self) -> None:
        """
        Sem limite, um job de worker que morre sempre voltaria para a fila para
        sempre. Sem reabrir, o indice unico parcial trabalharia contra nos: um job
        preso em `running` impede QUALQUER novo job daquela conta, e o botao no
        portal passaria a recusar coleta sem explicacao.
        """
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reabrir_orfaos(conexao)
        _, params = conexao.registro[-1]
        self.assertIn(MAX_TENTATIVAS, params)

    def test_devolver_para_fila_usa_o_limite(self) -> None:
        conexao = ConexaoRoteiro([("UPDATE cloud_sync_jobs", [])])
        devolver_para_fila(conexao, 3, "conta em coleta por outro processo")
        _, params = conexao.registro[-1]
        self.assertIn(MAX_TENTATIVAS, params)
        self.assertIn(3, params)


# ================================================= 8. nenhum segredo no modulo
class TesteSemSegredo(unittest.TestCase):
    def test_o_modulo_nao_menciona_campo_de_credencial(self) -> None:
        """
        A fila trafega ids e status. Se um campo de credencial aparecer aqui, o
        segredo passou a circular por um caminho que nao foi projetado para ele.
        """
        import inspect

        fonte = inspect.getsource(jobs_ovh)
        # As mencoes legitimas estao em comentario; nenhuma linha de CODIGO deve
        # nomear campo de credencial.
        codigo = [
            l for l in fonte.splitlines()
            if l.strip() and not l.strip().startswith("#")
        ]
        corpo = "\n".join(codigo)
        for proibido in ("application_secret", "consumer_key", "application_key"):
            self.assertNotIn(proibido, corpo, f"{proibido} aparece no codigo de jobs_ovh")


if __name__ == "__main__":
    unittest.main(verbosity=2)


# =========================================== adiar por conta ocupada (nao e falha)
class TesteAdiarPorContaOcupada(unittest.TestCase):
    """
    Adiar NAO e tentar.

    `reivindicar` incrementa `attempts` ao marcar `running` -- otimista, porque
    normalmente o trabalho comeca em seguida. Quando a conta esta travada por
    outro processo, NENHUM trabalho aconteceu: nao houve chamada a OVH, nao houve
    escrita, nao houve erro.

    Cobrar tentativa nesse caso faz o job morrer por ESTAR OCUPADO. Foi o que se
    observou em producao ao validar a instalacao do cron: com a conta travada, o
    worker reivindicou o mesmo job tres vezes na mesma execucao, gastou as tres
    tentativas em um segundo e marcou `failed` -- para uma coleta que teria
    funcionado no ciclo seguinte.
    """

    def _registro(self):
        conexao = ConexaoRoteiro([("UPDATE cloud_sync_jobs", [])])
        adiar_por_conta_ocupada(conexao, 7, "conta em coleta por outro processo")
        return conexao

    def test_volta_para_queued(self) -> None:
        # `sql_executado` NORMALIZA o espaco em branco: assegurar o alinhamento
        # do arquivo aqui testaria a formatacao, nao o comportamento.
        sql = self._registro().sql_executado()
        self.assertIn("SET status = 'queued'", sql)

    def test_DEVOLVE_a_tentativa(self) -> None:
        # O ponto central deste bloco.
        sql = self._registro().sql_executado()
        self.assertIn("GREATEST(attempts - 1, 0)", sql)

    def test_nunca_marca_failed(self) -> None:
        # Ao contrario de `devolver_para_fila`, aqui nao existe ramo que mate o
        # job: conta ocupada nao vira falha por mais que se repita.
        sql = self._registro().sql_executado()
        self.assertNotIn("failed", sql)

    def test_limpa_started_at(self) -> None:
        # O job volta a ser um job nao iniciado. Deixar `started_at` preenchido
        # faria `reabrir_orfaos` conta-lo como orfao daqui a 30 minutos.
        sql = self._registro().sql_executado()
        self.assertIn("started_at = NULL", sql)

    def test_sanitiza_o_motivo(self) -> None:
        conexao = ConexaoRoteiro([("UPDATE cloud_sync_jobs", [])])
        adiar_por_conta_ocupada(conexao, 7, "ocupada AKIAIOSFODNN7EXAMPLEKEY")
        _, params = conexao.registro[0]
        self.assertNotIn("AKIAIOSFODNN7EXAMPLEKEY", str(params))


# ================================== reivindicar nao gira em falso no mesmo job
class TesteReivindicarExclui(unittest.TestCase):
    """
    Um job adiado volta para `queued` e, por `ORDER BY requested_at`, volta a ser
    o mais antigo. Sem exclusao, o laco do worker o reivindica de novo na mesma
    execucao -- gastando as iteracoes de `--max` e, pior, nunca chegando as
    OUTRAS contas da fila, que ficam atras dele para sempre.
    """

    def test_a_consulta_aceita_lista_de_exclusao(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reivindicar(conexao, excluir=[7, 9])
        sql = conexao.sql_executado()
        self.assertIn("NOT (id = ANY(", sql)

    def test_os_ids_chegam_como_parametro(self) -> None:
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reivindicar(conexao, excluir=[7, 9])
        # O parametro da SEGUNDA consulta (a primeira e o to_regclass).
        _, params = conexao.registro[1]
        self.assertEqual(params, ([7, 9],))

    def test_sem_exclusao_o_comportamento_nao_muda(self) -> None:
        # Lista vazia precisa casar tudo: `id = ANY(ARRAY[]::bigint[])` e falso,
        # entao `NOT (...)` e verdadeiro para toda linha.
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [(7, "c", "manual_sync", 1)])])
        job = reivindicar(conexao)
        self.assertIsNotNone(job)
        _, params = conexao.registro[1]
        self.assertEqual(params, ([],))

    def test_o_cast_para_bigint_esta_explicito(self) -> None:
        # Sem `::bigint[]`, uma lista vazia chega ao Postgres com tipo
        # indeterminado e a consulta falha -- so no caminho que roda em producao.
        conexao = ConexaoRoteiro([FILA_EXISTE, ("UPDATE cloud_sync_jobs", [])])
        reivindicar(conexao)
        self.assertIn("::bigint[]", conexao.sql_executado())
