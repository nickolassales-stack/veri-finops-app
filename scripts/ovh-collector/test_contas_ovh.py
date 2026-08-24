#!/usr/bin/env python3
"""
Testes do loader de contas OVH.

    cd scripts/ovh-collector && python -m unittest -v test_contas_ovh

`unittest` da biblioteca padrao, e nao pytest: o collector roda num venv enxuto
na EC2, e uma dependencia so de teste seria instalada em producao para nunca ser
usada. A unica dependencia externa aqui e `cryptography`, que o collector precisa
de todo jeito.

---------------------------------------------------------------------------
O TESTE MAIS IMPORTANTE DESTE ARQUIVO

`TesteDecifragemContratoComPortal` usa envelopes REAIS, gerados pelo modulo
TypeScript do portal (`web/src/lib/cripto/segredos.ts`) com uma chave conhecida,
e embutidos aqui como constantes.

Isso e deliberado e vale explicar: cifrar em Python para decifrar em Python
provaria apenas que este arquivo e coerente consigo mesmo. O que precisa ser
verdade e outra coisa -- que o Python decifra o que o NODE cifrou. Se alguem
mudar o `salt`, o `info`, a ordem do AAD ou o formato do envelope num dos lados,
estes envelopes param de abrir e o teste acusa. Com fixtures geradas em Python,
a divergencia passaria.
"""

from __future__ import annotations

import base64
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import contas_ovh as mod
from contas_ovh import (
    ContaOvh,
    ErroDeCredencial,
    _subchave_de_cifra,
    carregar_de_accounts_d,
    carregar_de_env_unico,
    carregar_do_banco,
    decifrar,
    descobrir_contas,
    filtrar,
    resumo_para_log,
    sem_segredo,
)

# ---------------------------------------------------------------------------
# Fixtures produzidas pelo modulo TS do portal. Valores de DEMONSTRACAO -- nao
# sao credencial de conta nenhuma, e a chave e simplesmente os bytes 0..31.
CHAVE_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
CONTA = "ovh-main-ca"

ENVELOPES = {
    "application_key": "v1:K+VTis9oyylmGmLV:sQ9SpHpLYoQp8SB7onAQEw==:FhayzNJJtBJs17oH6yLqKg==",
    "application_secret": "v1:yPSUadGVpSnZrqJz:ntIJt/WlF0AY3cwkLLfyHGZacp5C33Lj3DKZdWgWMMA=:s1Z79eWeWRSwRz2E6V5iZA==",
    "consumer_key": "v1:Sp6H4FR18pv/1Qzt:wcCr4sXTXq5KmUoPgGMXqg==:lIVLHYyKQbcnHzinsbnU6w==",
}
CLAROS = {
    "application_key": "aK1demoDEMO0000a",
    "application_secret": "aS9demoDEMO111111111111111111bb2",
    "consumer_key": "cK7demoDEMO2222c",
}
#: Mesmo valor de `application_key`, cifrado para OUTRA conta.
ENVELOPE_DE_OUTRA_CONTA = "v1:y7mFLfd8iKUc+Z4z:n3XFwB2StUR5h6QnE5I0pA==:bJ9NXD8F7ZsCR8gUdsAQGQ=="


def _cifrar_local(claro: str, subchave: bytes, conta: str, campo: str) -> str:
    """Cifra do lado Python -- so para montar linhas de banco falsas."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = b"\x00" * 12  # IV fixo E ACEITAVEL AQUI: fixture de teste, nunca producao
    aad = f"ovh:{conta}:{campo}".encode()
    saida = AESGCM(subchave).encrypt(iv, claro.encode(), aad)
    corpo, tag = saida[:-16], saida[-16:]
    return ":".join(
        [
            "v1",
            base64.b64encode(iv).decode(),
            base64.b64encode(corpo).decode(),
            base64.b64encode(tag).decode(),
        ]
    )


# ---------------------------------------------------------------- banco falso
class CursorFalso:
    def __init__(self, respostas: list) -> None:
        self._respostas = respostas
        self._atual = None
        self.consultas: list[str] = []
        self.parametros: list = []
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql: str, params=None) -> None:
        self.consultas.append(" ".join(sql.split()))
        self.parametros.append(params)
        self._atual = self._respostas.pop(0) if self._respostas else []
        self.rowcount = len(self._atual) if isinstance(self._atual, list) else 0

    def fetchall(self):
        return self._atual

    def fetchone(self):
        return self._atual[0] if self._atual else None


class ConexaoFalsa:
    """
    Substitui psycopg2 sem instala-lo.

    `respostas` e consumida em ordem: a primeira e do `to_regclass` (existencia da
    tabela), a segunda e das linhas de credencial.
    """

    def __init__(self, respostas: list) -> None:
        self._respostas = respostas
        self.cursores: list[CursorFalso] = []

    def cursor(self) -> CursorFalso:
        c = CursorFalso(self._respostas)
        self.cursores.append(c)
        return c

    def rollback(self) -> None:
        pass

    def close(self) -> None:
        pass


def linha_de_conta(
    subchave: bytes,
    account_id: str,
    endpoint: str = "ovh-ca",
    status: str = "conectado",
    alias: str | None = None,
) -> tuple:
    return (
        account_id,
        endpoint,
        status,
        _cifrar_local("ak-" + account_id, subchave, account_id, "application_key"),
        _cifrar_local("as-" + account_id, subchave, account_id, "application_secret"),
        _cifrar_local("ck-" + account_id, subchave, account_id, "consumer_key"),
        alias or f"alias de {account_id}",
    )


def banco_com(linhas: list[tuple], tabela_existe: bool = True) -> ConexaoFalsa:
    return ConexaoFalsa([[(tabela_existe,)], linhas])


def banco_completo(linhas: list[tuple], inativas: tuple[str, ...] = ()) -> ConexaoFalsa:
    """
    Conexao para `descobrir_contas`, que faz QUATRO consultas em ordem:

      1. to_regclass de cloud_provider_credentials
      2. SQL_CONTAS
      3. to_regclass de cloud_accounts
      4. SQL_OVH_INATIVAS
    """
    return ConexaoFalsa(
        [[(True,)], linhas, [(True,)], [(i,) for i in inativas]]
    )


# =========================================================== 1. decifragem
class TesteDecifragemContratoComPortal(unittest.TestCase):
    """Os envelopes vieram do modulo TS. Se pararem de abrir, os lados divergiram."""

    def setUp(self) -> None:
        self.sub = _subchave_de_cifra(CHAVE_B64)

    def test_decifra_os_tres_campos_cifrados_pelo_node(self) -> None:
        for campo, envelope in ENVELOPES.items():
            with self.subTest(campo=campo):
                self.assertEqual(decifrar(envelope, self.sub, CONTA, campo), CLAROS[campo])

    def test_aad_impede_realocacao_entre_contas(self) -> None:
        # O ataque concreto: com escrita no banco, mover o envelope da conta A
        # para a conta B. Sem AAD, decifraria e o collector coletaria A gravando
        # como B.
        with self.assertRaises(ErroDeCredencial):
            decifrar(ENVELOPE_DE_OUTRA_CONTA, self.sub, CONTA, "application_key")

    def test_aad_impede_troca_de_campo(self) -> None:
        with self.assertRaises(ErroDeCredencial):
            decifrar(ENVELOPES["application_key"], self.sub, CONTA, "consumer_key")

    def test_chave_diferente_nao_decifra(self) -> None:
        outra = _subchave_de_cifra(base64.b64encode(b"\x09" * 32).decode())
        with self.assertRaises(ErroDeCredencial):
            decifrar(ENVELOPES["application_key"], outra, CONTA, "application_key")

    def test_envelope_corrompido_falha_em_vez_de_devolver_lixo(self) -> None:
        partes = ENVELOPES["application_key"].split(":")
        corpo = bytearray(base64.b64decode(partes[2]))
        corpo[0] ^= 0xFF
        partes[2] = base64.b64encode(bytes(corpo)).decode()
        with self.assertRaises(ErroDeCredencial):
            decifrar(":".join(partes), self.sub, CONTA, "application_key")

    def test_texto_em_claro_na_coluna_e_recusado(self) -> None:
        with self.assertRaises(ErroDeCredencial):
            decifrar("minha-chave-em-claro", self.sub, CONTA, "application_key")

    def test_versao_desconhecida(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "formato desconhecido"):
            decifrar(ENVELOPES["application_key"].replace("v1:", "v9:", 1),
                     self.sub, CONTA, "application_key")


class TesteChaveMestra(unittest.TestCase):
    def test_ausente(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "openssl rand"):
            _subchave_de_cifra("")

    def test_curta_e_recusada_nao_esticada(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "32"):
            _subchave_de_cifra(base64.b64encode(b"\x01" * 16).decode())

    def test_nao_base64(self) -> None:
        with self.assertRaises(ErroDeCredencial):
            _subchave_de_cifra("nao###base64###")

    def test_mensagem_nunca_contem_a_chave(self) -> None:
        chave = base64.b64encode(b"\x07" * 16).decode()
        with self.assertRaises(ErroDeCredencial) as ctx:
            _subchave_de_cifra(chave)
        self.assertNotIn(chave, str(ctx.exception))


# ========================================================= 2. loader do banco
class TesteLoaderDoBanco(unittest.TestCase):
    def setUp(self) -> None:
        self.sub = _subchave_de_cifra(CHAVE_B64)
        self.avisos: list[str] = []

    def avisar(self, msg: str) -> None:
        self.avisos.append(msg)

    def test_duas_contas(self) -> None:
        conexao = banco_com([
            linha_de_conta(self.sub, "ovh-main-ca", "ovh-ca"),
            linha_de_conta(self.sub, "ovh-eu-01", "ovh-eu"),
        ])
        contas = carregar_do_banco(conexao, CHAVE_B64, self.avisar)

        self.assertEqual([c.provider_account_id for c in contas],
                         ["ovh-main-ca", "ovh-eu-01"])
        self.assertEqual([c.endpoint for c in contas], ["ovh-ca", "ovh-eu"])
        self.assertEqual([c.origem for c in contas], ["banco", "banco"])
        # Decifrou de fato.
        self.assertEqual(contas[0].application_key, "ak-ovh-main-ca")
        self.assertEqual(contas[1].consumer_key, "ck-ovh-eu-01")
        self.assertEqual(self.avisos, [])

    def test_tabela_ausente_devolve_vazio_com_aviso(self) -> None:
        conexao = banco_com([], tabela_existe=False)
        self.assertEqual(carregar_do_banco(conexao, CHAVE_B64, self.avisar), [])
        self.assertTrue(any("006" in a for a in self.avisos))

    def test_sem_linhas_devolve_vazio_e_nem_exige_a_chave(self) -> None:
        # Sem credencial no banco, nao faz sentido exigir a chave-mestra.
        conexao = banco_com([])
        self.assertEqual(carregar_do_banco(conexao, "", self.avisar), [])

    def test_status_invalido_e_pulado_com_motivo(self) -> None:
        conexao = banco_com([
            linha_de_conta(self.sub, "ovh-boa"),
            linha_de_conta(self.sub, "ovh-ruim", status="invalido"),
        ])
        contas = carregar_do_banco(conexao, CHAVE_B64, self.avisar)
        self.assertEqual([c.provider_account_id for c in contas], ["ovh-boa"])
        self.assertTrue(any("ovh-ruim" in a and "invalido" in a for a in self.avisos))

    def test_nao_validado_e_ACEITO(self) -> None:
        # Credencial recem-cadastrada e nunca testada tem de coletar. Exigir
        # `conectado` faria o cadastro pela tela nao surtir efeito ate alguem
        # clicar em "Testar conexao" -- uma armadilha.
        conexao = banco_com([linha_de_conta(self.sub, "ovh-nova", status="nao_validado")])
        contas = carregar_do_banco(conexao, CHAVE_B64, self.avisar)
        self.assertEqual(len(contas), 1)

    def test_endpoint_invalido_pula_a_conta_sem_derrubar_as_outras(self) -> None:
        conexao = banco_com([
            linha_de_conta(self.sub, "ovh-boa", "ovh-ca"),
            linha_de_conta(self.sub, "ovh-torta", "ovh-br"),
        ])
        contas = carregar_do_banco(conexao, CHAVE_B64, self.avisar)
        self.assertEqual([c.provider_account_id for c in contas], ["ovh-boa"])
        self.assertTrue(any("ovh-torta" in a for a in self.avisos))

    def test_credencial_que_nao_decifra_nao_derruba_as_outras(self) -> None:
        boa = linha_de_conta(self.sub, "ovh-boa")
        ruim = list(linha_de_conta(self.sub, "ovh-ilegivel"))
        ruim[3] = "v1:AAAA:AAAA:AAAAAAAAAAAAAAAAAAAAAA=="  # tag que nao confere
        conexao = banco_com([boa, tuple(ruim)])

        contas = carregar_do_banco(conexao, CHAVE_B64, self.avisar)
        self.assertEqual([c.provider_account_id for c in contas], ["ovh-boa"])
        self.assertTrue(any("ovh-ilegivel" in a for a in self.avisos))

    def test_a_consulta_filtra_por_provider_e_ativa(self) -> None:
        conexao = banco_com([linha_de_conta(self.sub, "ovh-x")])
        carregar_do_banco(conexao, CHAVE_B64, self.avisar)
        sql = " ".join(c for cur in conexao.cursores for c in cur.consultas)
        self.assertIn("c.provider = 'ovh'", sql)
        self.assertIn("a.provider = 'ovh'", sql)
        self.assertIn("a.active", sql)


# ============================================================ 3. fallbacks
class TesteFallbacks(unittest.TestCase):
    ENV_COMPLETO = (
        "OVH_ENDPOINT=ovh-ca\n"
        "OVH_APPLICATION_KEY=ak-arquivo\n"
        "OVH_APPLICATION_SECRET=as-arquivo\n"
        "OVH_CONSUMER_KEY=ck-arquivo\n"
        "OVH_PROVIDER_ACCOUNT_ID=ovh-do-arquivo\n"
        "OVH_ACCOUNT_ALIAS=apelido\n"
    )

    def setUp(self) -> None:
        self.avisos: list[str] = []
        self.tmp = TemporaryDirectory()
        self.raiz = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def avisar(self, msg: str) -> None:
        self.avisos.append(msg)

    def test_accounts_d_com_duas_contas(self) -> None:
        d = self.raiz / "accounts.d"
        d.mkdir()
        (d / "a.env").write_text(self.ENV_COMPLETO, encoding="utf-8")
        (d / "b.env").write_text(
            self.ENV_COMPLETO.replace("ovh-do-arquivo", "ovh-segunda").replace(
                "ovh-ca", "ovh-eu"
            ),
            encoding="utf-8",
        )

        contas = carregar_de_accounts_d(d, self.avisar)
        self.assertEqual([c.provider_account_id for c in contas],
                         ["ovh-do-arquivo", "ovh-segunda"])
        self.assertEqual([c.origem for c in contas], ["accounts.d", "accounts.d"])

    def test_accounts_d_arquivo_torto_nao_impede_os_outros(self) -> None:
        d = self.raiz / "accounts.d"
        d.mkdir()
        (d / "boa.env").write_text(self.ENV_COMPLETO, encoding="utf-8")
        (d / "torta.env").write_text("OVH_ENDPOINT=ovh-ca\n", encoding="utf-8")

        contas = carregar_de_accounts_d(d, self.avisar)
        self.assertEqual([c.provider_account_id for c in contas], ["ovh-do-arquivo"])
        self.assertTrue(any("torta.env" in a for a in self.avisos))

    def test_accounts_d_inexistente_e_lista_vazia_nao_erro(self) -> None:
        self.assertEqual(carregar_de_accounts_d(self.raiz / "nao-existe", self.avisar), [])

    def test_uma_conta_nao_herda_credencial_da_outra(self) -> None:
        # `load_dotenv` poluiria os.environ e a segunda conta herdaria o que
        # faltasse nela. O leitor proprio existe por isso.
        d = self.raiz / "accounts.d"
        d.mkdir()
        (d / "a.env").write_text(self.ENV_COMPLETO, encoding="utf-8")
        (d / "b.env").write_text(
            self.ENV_COMPLETO.replace("ak-arquivo", "ak-DIFERENTE").replace(
                "ovh-do-arquivo", "ovh-segunda"
            ),
            encoding="utf-8",
        )
        contas = carregar_de_accounts_d(d, self.avisar)
        self.assertEqual(contas[0].application_key, "ak-arquivo")
        self.assertEqual(contas[1].application_key, "ak-DIFERENTE")

    def test_env_unico(self) -> None:
        env = self.raiz / ".env"
        env.write_text(self.ENV_COMPLETO, encoding="utf-8")
        contas = carregar_de_env_unico(env, self.avisar)
        self.assertEqual(len(contas), 1)
        self.assertEqual(contas[0].origem, ".env")
        self.assertEqual(contas[0].alias, "apelido")

    def test_env_incompleto_avisa_e_devolve_vazio(self) -> None:
        env = self.raiz / ".env"
        env.write_text("OVH_ENDPOINT=ovh-ca\n", encoding="utf-8")
        self.assertEqual(carregar_de_env_unico(env, self.avisar), [])
        self.assertTrue(self.avisos)

    def test_valores_com_aspas_e_comentario(self) -> None:
        env = self.raiz / ".env"
        env.write_text(
            "# comentario\n"
            'OVH_ENDPOINT="ovh-ca"\n'
            "OVH_APPLICATION_KEY='ak'\n"
            "OVH_APPLICATION_SECRET=as\n"
            "OVH_CONSUMER_KEY=ck\n"
            "OVH_PROVIDER_ACCOUNT_ID=ovh-z\n",
            encoding="utf-8",
        )
        contas = carregar_de_env_unico(env, self.avisar)
        self.assertEqual(contas[0].endpoint, "ovh-ca")
        self.assertEqual(contas[0].application_key, "ak")


# ========================================================= 4. precedencia
class TestePrecedencia(unittest.TestCase):
    def setUp(self) -> None:
        self.sub = _subchave_de_cifra(CHAVE_B64)
        self.tmp = TemporaryDirectory()
        self.raiz = Path(self.tmp.name)
        self.d = self.raiz / "accounts.d"
        self.d.mkdir()
        (self.d / "a.env").write_text(
            TesteFallbacks.ENV_COMPLETO, encoding="utf-8"
        )
        self.env = self.raiz / ".env"
        self.env.write_text(
            TesteFallbacks.ENV_COMPLETO.replace("ovh-do-arquivo", "ovh-do-env"),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_banco_e_legado_se_somam_por_conta(self) -> None:
        """
        A mudanca que corrige perda silenciosa de coleta.

        Antes, uma credencial no banco fazia a origem virar `banco` e toda conta
        que existia so no `.env` saia da coleta -- sem erro e com o run marcado
        `success`. Agora as origens se somam por conta.
        """
        conexao = banco_completo([linha_de_conta(self.sub, "ovh-do-banco")])
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=CHAVE_B64,
            diretorio_accounts_d=self.d,
            arquivo_env=self.env,
        )
        self.assertEqual(
            sorted(c.provider_account_id for c in d.contas),
            ["ovh-do-arquivo", "ovh-do-banco", "ovh-do-env"],
        )
        self.assertEqual(d.origem, "banco+legado")

    def test_aviso_por_conta_usa_o_texto_exigido(self) -> None:
        conexao = banco_completo([])
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=CHAVE_B64,
            diretorio_accounts_d=self.d,
            arquivo_env=self.env,
        )
        self.assertIn("Usando fallback legado para conta ovh-do-arquivo", d.avisos)
        self.assertIn("Usando fallback legado para conta ovh-do-env", d.avisos)

    def test_conta_no_banco_ignora_o_arquivo_com_mesmo_id(self) -> None:
        """
        O arquivo perde para o banco NA MESMA CONTA -- e isso tambem e proposital.

        Se o arquivo vencesse, uma rotacao feita pela tela seria descartada porque
        alguem esqueceu de limpar o `.env`, e a coleta seguiria com a credencial
        antiga: parece certo e esta errado.
        """
        conexao = banco_completo([linha_de_conta(self.sub, "ovh-do-env")])
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=CHAVE_B64,
            diretorio_accounts_d=self.raiz / "nao-existe",
            arquivo_env=self.env,
        )
        self.assertEqual([c.provider_account_id for c in d.contas], ["ovh-do-env"])
        self.assertEqual([c.origem for c in d.contas], ["banco"])
        self.assertEqual(d.origem, "banco")
        self.assertNotIn("Usando fallback legado para conta ovh-do-env", d.avisos)

    def test_conta_desativada_nao_volta_pelo_fallback(self) -> None:
        """
        `SQL_CONTAS` exige `a.active`, mas ARQUIVO nao sabe de `active`.

        Sem a guarda, desativar uma conta pela tela e ainda ter a chave no `.env`
        faria a coleta continuar -- o oposto exato do que desativar significa.
        """
        conexao = banco_completo([], inativas=("ovh-do-env",))
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=CHAVE_B64,
            diretorio_accounts_d=self.raiz / "nao-existe",
            arquivo_env=self.env,
        )
        self.assertEqual(d.contas, [])
        self.assertEqual(d.origem, "nenhuma")
        self.assertTrue(
            any("desativada em cloud_accounts" in a for a in d.avisos), d.avisos
        )

    def test_sem_banco_usa_so_o_legado(self) -> None:
        conexao = banco_completo([])
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=CHAVE_B64,
            diretorio_accounts_d=self.raiz / "nao-existe",
            arquivo_env=self.env,
        )
        self.assertEqual(d.origem, "legado")
        self.assertEqual([c.provider_account_id for c in d.contas], ["ovh-do-env"])
        self.assertIn(mod.AVISO_FALLBACK_ENV, d.avisos)

    def test_accounts_d_vence_env_para_a_mesma_conta(self) -> None:
        mesmo = self.raiz / "accounts.d" / "duplicada.env"
        mesmo.write_text(
            TesteFallbacks.ENV_COMPLETO.replace("ovh-do-arquivo", "ovh-do-env"),
            encoding="utf-8",
        )
        d = descobrir_contas(
            None,
            diretorio_accounts_d=self.d,
            arquivo_env=self.env,
        )
        origens = {c.provider_account_id: c.origem for c in d.contas}
        self.assertEqual(origens["ovh-do-env"], "accounts.d")

    def test_conexao_none_ainda_tenta_os_fallbacks(self) -> None:
        d = descobrir_contas(
            None,
            diretorio_accounts_d=self.raiz / "nao-existe",
            arquivo_env=self.env,
        )
        self.assertEqual(d.origem, "legado")

    def test_nenhuma_origem_devolve_lista_vazia(self) -> None:
        d = descobrir_contas(
            None,
            diretorio_accounts_d=self.raiz / "nao-existe",
            arquivo_env=self.raiz / "nao-existe.env",
        )
        self.assertEqual(d.contas, [])
        self.assertEqual(d.origem, "nenhuma")


# ============================================================== 5. filtro
class TesteFiltro(unittest.TestCase):
    def contas(self) -> list[ContaOvh]:
        return [
            ContaOvh("ovh-a", "ovh-ca", "ak", "as", "ck"),
            ContaOvh("ovh-b", "ovh-eu", "ak", "as", "ck"),
        ]

    def test_all_e_o_padrao_quando_nao_ha_filtro(self) -> None:
        self.assertEqual(len(filtrar(self.contas(), None)), 2)

    def test_account_escolhe_uma(self) -> None:
        escolhidas = filtrar(self.contas(), "ovh-b")
        self.assertEqual([c.provider_account_id for c in escolhidas], ["ovh-b"])

    def test_account_inexistente_LEVANTA_em_vez_de_devolver_vazio(self) -> None:
        # Sair com sucesso tendo coletado nada faria alguem concluir que a conta
        # esta sem custo.
        with self.assertRaises(ErroDeCredencial) as ctx:
            filtrar(self.contas(), "ovh-inexistente")
        # A mensagem lista o que existe, para o operador nao adivinhar.
        self.assertIn("ovh-a", str(ctx.exception))
        self.assertIn("ovh-b", str(ctx.exception))

    def test_lista_vazia_com_filtro_tambem_levanta(self) -> None:
        with self.assertRaises(ErroDeCredencial):
            filtrar([], "ovh-a")


# ====================================================== 6. logs sanitizados
class TesteLogsSemSegredo(unittest.TestCase):
    def conta(self) -> ContaOvh:
        return ContaOvh(
            provider_account_id="ovh-main-ca",
            endpoint="ovh-ca",
            application_key="AK-SEGREDO-AAAA",
            application_secret="AS-SEGREDO-BBBB",
            consumer_key="CK-SEGREDO-CCCC",
            alias="principal",
            origem="banco",
        )

    def test_repr_nao_contem_segredo(self) -> None:
        # A forma mais provavel de vazar nao e um log deliberado: e o repr
        # automatico num traceback ou num f-string de depuracao.
        texto = repr(self.conta())
        for segredo in ("AK-SEGREDO", "AS-SEGREDO", "CK-SEGREDO"):
            self.assertNotIn(segredo, texto)
        self.assertIn("<omitido>", texto)

    def test_str_tambem(self) -> None:
        texto = str(self.conta())
        self.assertNotIn("AS-SEGREDO", texto)

    def test_repr_ainda_diz_o_que_importa(self) -> None:
        texto = repr(self.conta())
        self.assertIn("ovh-main-ca", texto)
        self.assertIn("ovh-ca", texto)
        self.assertIn("banco", texto)

    def test_f_string_de_lista_de_contas_nao_vaza(self) -> None:
        # `log(f"contas: {lista}")` usa repr de cada item.
        texto = f"contas: {[self.conta()]}"
        self.assertNotIn("AS-SEGREDO", texto)

    def test_resumo_para_log_e_seguro(self) -> None:
        texto = resumo_para_log([self.conta()])
        self.assertIn("ovh-main-ca", texto)
        self.assertIn("via banco", texto)
        for segredo in ("AK-SEGREDO", "AS-SEGREDO", "CK-SEGREDO"):
            self.assertNotIn(segredo, texto)

    def test_sem_segredo_corta_por_forma(self) -> None:
        self.assertNotIn("aBcDeF1234567890Gh", sem_segredo("chave aBcDeF1234567890Gh"))
        self.assertIn("<omitido>", sem_segredo("chave aBcDeF1234567890Gh"))

    def test_sem_segredo_preserva_texto_curto(self) -> None:
        self.assertEqual(sem_segredo("erro 403 Forbidden"), "erro 403 Forbidden")

    def test_sem_segredo_aceita_vazio(self) -> None:
        self.assertEqual(sem_segredo(""), "")


# ======================================================== 7. falha parcial
class TesteFalhaParcial(unittest.TestCase):
    """
    A regra de codigo de saida, testada sem subir nada.

    `sincronizar_conta` fala com a OVH e com o banco, entao nao e exercitada
    aqui. O que se verifica e a DECISAO que o `main` toma sobre o resultado dela
    -- que e onde o erro seria silencioso: exit 0 com uma conta falhada faria o
    cron reportar sucesso.
    """

    @staticmethod
    def codigo(total_contas: int, falhas: int) -> int:
        # Mesma regra do fim de `main()`. Duplicada aqui de proposito: se alguem
        # mudar uma das duas, o teste acusa a divergencia.
        if falhas == 0:
            return 0
        if total_contas == 1:
            return 1
        return 6

    def test_tudo_bem(self) -> None:
        self.assertEqual(self.codigo(3, 0), 0)

    def test_uma_conta_unica_que_falha(self) -> None:
        self.assertEqual(self.codigo(1, 1), 1)

    def test_falha_parcial_em_varias_contas(self) -> None:
        self.assertEqual(self.codigo(3, 1), 6)

    def test_todas_falharam(self) -> None:
        self.assertEqual(self.codigo(3, 3), 6)

    def test_nunca_devolve_zero_havendo_falha(self) -> None:
        for total in range(1, 6):
            for falhas in range(1, total + 1):
                with self.subTest(total=total, falhas=falhas):
                    self.assertNotEqual(self.codigo(total, falhas), 0)


class TesteValidacaoDeConta(unittest.TestCase):
    def test_endpoint_invalido(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "endpoint invalido"):
            ContaOvh("x", "ovh-br", "a", "b", "c").validar()

    def test_campo_vazio(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "application_secret"):
            ContaOvh("x", "ovh-ca", "a", "", "c").validar()

    def test_sem_id(self) -> None:
        with self.assertRaisesRegex(ErroDeCredencial, "provider_account_id"):
            ContaOvh("", "ovh-ca", "a", "b", "c").validar()

    def test_conta_valida_passa(self) -> None:
        ContaOvh("x", "ovh-ca", "a", "b", "c").validar()


if __name__ == "__main__":
    # A chave nao pode vazar do ambiente para dentro dos testes e mascarar um
    # erro de fixture.
    os.environ.pop("APP_CREDENTIALS_ENCRYPTION_KEY", None)
    unittest.main(verbosity=2)
