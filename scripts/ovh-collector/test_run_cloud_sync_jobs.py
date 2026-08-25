#!/usr/bin/env python3
"""
Testes do INVOLUCRO do worker (`run-cloud-sync-jobs.sh`).

    python -m unittest test_run_cloud_sync_jobs -v

Os demais testes cobrem a logica em Python. Este cobre o shell, que tem as suas
proprias armadilhas -- e uma delas ja custou uma falha silenciosa.

---------------------------------------------------------------------------
O QUE ESTA SENDO GUARDADO

1. O codigo de saida do Python chega ao cron.
2. Quando ele NAO e zero, uma linha vai para o stderr -- que e o unico lugar que
   o `cron.log` enxerga, ja que todo o resto do worker escreve em `jobs.log`.
3. `flock` recusa o segundo worker com 75, em vez de enfileirar processos.
4. O valor da chave de cifragem nunca aparece no log.

O ponto 2 e o motivo deste arquivo existir. Escrito como

    "$PYTHON" ... >> "$LOG" 2>&1
    codigo=$?

sob `set -e`, a atribuicao NUNCA roda quando o Python falha: o bash encerra no
comando anterior. O codigo de saida continuava correto -- e por isso ninguem
percebia --, mas a linha de diagnostico nunca era impressa, e o `cron.log` ficava
vazio num dia em que jobs falharam.

O teste roda o script DE VERDADE, com um Python de mentira que devolve o codigo
pedido. Testar o padrao numa copia do trecho nao valeria nada: guardaria a copia,
nao o arquivo que o cron chama.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "run-cloud-sync-jobs.sh"
BASH = shutil.which("bash")
TEM_FLOCK = shutil.which("flock") is not None

# `flock` e do util-linux: existe na EC2, nao existe no Git Bash do Windows. Sem
# ele o script recusa a rodar de proposito (ver o guarda no shell), entao os
# testes de fluxo sao PULADOS em vez de reprovados -- reprovar aqui ensinaria a
# ignorar a suite inteira na maquina de desenvolvimento. A validacao de verdade
# roda no venv de producao, onde o `flock` existe.
precisa_flock = unittest.skipUnless(TEM_FLOCK, "flock indisponivel (util-linux)")


@unittest.skipUnless(BASH, "bash indisponivel neste ambiente")
class InvolucroDoWorker(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

        # O script exige `$DIR/.env` -- e dele que saem PG_USER e PG_PASSWORD.
        # Valores de mentira: nada aqui chega a banco nenhum.
        (self.dir / ".env").write_text(
            "PG_HOST=127.0.0.1\nAPP_CREDENTIALS_ENCRYPTION_KEY=chave-de-teste-nao-e-segredo\n",
            encoding="utf-8",
        )

        self.log = self.dir / "jobs.log"
        self.trava = self.dir / "worker.lock"

    def _python_falso(self, codigo: int, demora: float = 0.0) -> Path:
        """Um executavel que imprime algo e sai com o codigo pedido."""
        caminho = self.dir / f"python-falso-{codigo}"
        caminho.write_text(
            textwrap.dedent(
                f"""\
                #!/usr/bin/env bash
                sleep {demora}
                echo "worker de mentira rodou"
                exit {codigo}
                """
            ),
            encoding="utf-8",
        )
        caminho.chmod(0o755)
        return caminho

    def _rodar(self, codigo: int, demora: float = 0.0, trava: Path | None = None):
        ambiente = {
            **os.environ,
            "DIR": str(self.dir),
            "PYTHON": str(self._python_falso(codigo, demora)),
            "JOBS_LOG_PATH": str(self.log),
            "JOBS_LOCK_PATH": str(trava or self.trava),
        }
        # `APP_CREDENTIALS_ENCRYPTION_KEY` sai do ambiente para o script ter de
        # busca-la no `.env` -- que e o caminho real em producao.
        ambiente.pop("APP_CREDENTIALS_ENCRYPTION_KEY", None)

        return subprocess.run(
            [BASH, str(SCRIPT)],
            env=ambiente,
            capture_output=True,
            text=True,
            timeout=60,
        )

    # ------------------------------------------------------------------ saida
    @precisa_flock
    def test_sucesso_sai_zero_e_calado(self):
        r = self._rodar(0)
        self.assertEqual(r.returncode, 0)
        # Fila vazia e o caso normal, uma vez por minuto. Uma linha no cron.log a
        # cada minuto afogaria qualquer problema de verdade.
        self.assertEqual(r.stderr.strip(), "")

    @precisa_flock
    def test_falha_propaga_o_codigo(self):
        for codigo in (2, 3, 6):
            with self.subTest(codigo=codigo):
                self.assertEqual(self._rodar(codigo).returncode, codigo)

    @precisa_flock
    def test_falha_DEIXA_RASTRO_no_stderr(self):
        # A regressao. Com `codigo=$?` solto sob `set -e`, este stderr vinha vazio
        # e o cron.log nao registrava nada num dia de falhas.
        r = self._rodar(6)
        self.assertEqual(r.returncode, 6)
        self.assertIn("codigo 6", r.stderr)
        self.assertIn(str(self.log), r.stderr, "a mensagem precisa dizer onde olhar")

    # ------------------------------------------------------------------ trava
    @precisa_flock
    def test_segundo_worker_desiste_com_75(self):
        # 75 e EX_TEMPFAIL: nao e erro. Com cron a cada minuto, um worker que
        # demore mais de 60s encontra o proximo subindo, e isso e esperado.
        import threading

        resultados: list[subprocess.CompletedProcess] = []
        t = threading.Thread(target=lambda: resultados.append(self._rodar(0, demora=3)))
        t.start()
        try:
            import time

            time.sleep(1.0)
            segundo = self._rodar(0)
            self.assertEqual(segundo.returncode, 75)
        finally:
            t.join()

        self.assertEqual(resultados[0].returncode, 0, "o primeiro worker deve terminar bem")

    # -------------------------------------------------------------- segredos
    @precisa_flock
    def test_a_chave_de_cifragem_nunca_aparece_no_log(self):
        self._rodar(0)
        conteudo = self.log.read_text(encoding="utf-8")
        # O script registra o TAMANHO, e nunca o valor.
        self.assertNotIn("chave-de-teste-nao-e-segredo", conteudo)
        self.assertIn("chave de cifragem: presente", conteudo)
        self.assertIn(str(len("chave-de-teste-nao-e-segredo")), conteudo)

    @precisa_flock
    def test_avisa_quando_a_chave_falta(self):
        # Sem a chave, job de conta cadastrada pelo portal falha na decifragem --
        # e o log precisa dizer isso antes, e nao depois de tres tentativas.
        (self.dir / ".env").write_text("PG_HOST=127.0.0.1\n", encoding="utf-8")
        self._rodar(0)
        self.assertIn("AUSENTE", self.log.read_text(encoding="utf-8"))

    # ------------------------------------------------------- pre-requisitos
    def test_sem_env_recusa_com_2(self):
        (self.dir / ".env").unlink()
        r = self._rodar(0)
        self.assertEqual(r.returncode, 2)
        self.assertIn(".env", r.stderr)

    def test_sem_flock_recusa_com_3_em_vez_de_fingir_75(self):
        # O guarda que este teste protege existe porque a alternativa e a pior
        # possivel: `flock` ausente faz `flock -n 9` devolver 127, o `if !` toma
        # isso por "outro worker rodando" e o script sai 75 a cada minuto, para
        # sempre, sem processar nada e sem uma linha de erro.
        vazio = self.dir / "sem-flock"
        vazio.mkdir()
        ambiente = {
            **os.environ,
            "PATH": str(vazio),  # PATH sem flock e sem mais nada
            "DIR": str(self.dir),
            "PYTHON": str(self._python_falso(0)),
            "JOBS_LOG_PATH": str(self.log),
            "JOBS_LOCK_PATH": str(self.trava),
        }
        r = subprocess.run(
            [BASH, str(SCRIPT)], env=ambiente, capture_output=True, text=True, timeout=60
        )
        self.assertEqual(r.returncode, 3, "sem flock o worker precisa RECUSAR, nao sair 75")
        self.assertNotEqual(r.returncode, 75)
        self.assertIn("flock", r.stderr)

    def test_sem_python_recusa_com_3(self):
        ambiente = {
            **os.environ,
            "DIR": str(self.dir),
            "PYTHON": str(self.dir / "nao-existe"),
            "JOBS_LOG_PATH": str(self.log),
            "JOBS_LOCK_PATH": str(self.trava),
        }
        r = subprocess.run(
            [BASH, str(SCRIPT)], env=ambiente, capture_output=True, text=True, timeout=60
        )
        self.assertEqual(r.returncode, 3)
        self.assertIn("venv", r.stderr)


if __name__ == "__main__":
    unittest.main()
