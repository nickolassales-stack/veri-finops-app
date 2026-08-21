#!/usr/bin/env python3
"""
Descoberta de contas OVH e decifragem das credenciais.

Tres origens, nesta ordem de precedencia:

    1. BANCO           `cloud_provider_credentials`, cadastrado pelo portal
    2. accounts.d      `accounts.d/*.env`, um arquivo por conta      (fallback)
    3. .env            arquivo unico, uma conta                       (fallback)

O banco vence sempre que houver credencial la. Sem essa precedencia, uma rotacao
feita pela tela seria silenciosamente ignorada porque alguem esqueceu de limpar o
`.env` -- e o sintoma seria a coleta continuar funcionando com a credencial
antiga, que e o pior desfecho possivel: parece certo e esta errado.

---------------------------------------------------------------------------
NOTA SOBRE accounts.d

Este diretorio NUNCA EXISTIU neste repositorio. O fallback real, hoje em
producao, e o `.env` unico com uma conta. `accounts.d` foi pedido por nome na
especificacao, entao esta implementado e funciona se o diretorio for criado --
mas nao ha nada para migrar dele, e a ordem 2 e, na pratica, um caminho novo que
ja nasce marcado para remocao.

---------------------------------------------------------------------------
SEGREDO NAO VAI PARA REPR

`ContaOvh` sobrescreve `__repr__` e `__str__`. Nao e zelo decorativo: um
dataclass comum imprime todos os campos, e este objeto aparece em traceback, em
`log(f"... {conta}")` e em qualquer `print` de depuracao. A forma mais provavel de
vazar credencial neste arquivo nao e um `log` deliberado -- e um repr automatico.
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

# Precisam ser IDENTICOS aos de web/src/lib/cripto/segredos.ts. Divergir num byte
# faz toda decifragem falhar com "tag invalida", sem dizer por que.
SAL_HKDF = b"veri-finops/credenciais"
INFO_CIFRA = b"cifra-credencial-v1"
VERSAO_ENVELOPE = "v1"
BYTES_CHAVE = 32
BYTES_IV = 12
BYTES_TAG = 16

ENDPOINTS_VALIDOS = ("ovh-eu", "ovh-ca", "ovh-us")

#: Status que autorizam a coleta.
#:
#: `invalido` fica FORA de proposito: significa que a OVH REJEITOU a credencial
#: num teste -- falha de rede nao marca invalido, disso o portal cuida. Tentar de
#: novo a cada execucao so produziria ruido no log e no historico de execucoes.
#: Retestar ou recadastrar pela tela reabre o status.
#:
#: `nao_validado` ENTRA: credencial recem-cadastrada e nunca testada tem de
#: coletar. Exigir `conectado` faria o cadastro pela tela nao surtir efeito ate
#: alguem clicar em "Testar conexao" -- uma armadilha silenciosa.
STATUS_ACEITOS = ("conectado", "nao_validado")


class ErroDeCredencial(Exception):
    """Falha ao obter ou decifrar credencial. A mensagem nunca contem segredo."""


# --------------------------------------------------------------------- conta
@dataclass(frozen=True)
class ContaOvh:
    """
    Uma conta OVH pronta para sincronizar.

    `repr` e `str` sao sobrescritos para NUNCA exibirem segredo. Os tres campos
    de credencial ficam com `repr=False` no dataclass tambem, como segunda
    camada: se alguem remover o `__repr__` customizado, o dataclass gerado ja nao
    os inclui.
    """

    provider_account_id: str
    endpoint: str
    application_key: str = field(repr=False)
    application_secret: str = field(repr=False)
    consumer_key: str = field(repr=False)
    alias: str | None = None
    #: "banco" | "accounts.d" | ".env" -- entra no resumo do log.
    origem: str = "banco"

    def __repr__(self) -> str:
        return (
            f"ContaOvh(provider_account_id={self.provider_account_id!r}, "
            f"endpoint={self.endpoint!r}, alias={self.alias!r}, "
            f"origem={self.origem!r}, credenciais=<omitido>)"
        )

    __str__ = __repr__

    def validar(self) -> None:
        """Recusa conta que nao tem como funcionar, antes de gastar uma chamada."""
        if not self.provider_account_id:
            raise ErroDeCredencial("conta sem provider_account_id")
        if self.endpoint not in ENDPOINTS_VALIDOS:
            raise ErroDeCredencial(
                f"{self.provider_account_id}: endpoint invalido "
                f"({self.endpoint!r}); use {', '.join(ENDPOINTS_VALIDOS)}"
            )
        for nome in ("application_key", "application_secret", "consumer_key"):
            if not getattr(self, nome):
                raise ErroDeCredencial(f"{self.provider_account_id}: {nome} vazio")


# ------------------------------------------------------------------ cifragem
def _subchave_de_cifra(chave_mestra_b64: str) -> bytes:
    """
    Deriva a subchave de cifragem por HKDF-SHA256.

    Os mesmos `salt` e `info` do portal. Chave-mestra de tamanho diferente de 32
    bytes e RECUSADA, nao esticada -- aceitar daria a aparencia de AES-256 com a
    forca do que foi digitado.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    if not (chave_mestra_b64 or "").strip():
        raise ErroDeCredencial(
            "APP_CREDENTIALS_ENCRYPTION_KEY nao definida. O collector precisa dela "
            "para decifrar as credenciais do banco. Gere com: openssl rand -base64 32"
        )

    try:
        mestra = base64.b64decode(chave_mestra_b64, validate=True)
    except Exception:
        raise ErroDeCredencial(
            "APP_CREDENTIALS_ENCRYPTION_KEY nao e base64 valido."
        ) from None

    if len(mestra) != BYTES_CHAVE:
        # O TAMANHO entra na mensagem; o valor, nunca.
        raise ErroDeCredencial(
            f"APP_CREDENTIALS_ENCRYPTION_KEY precisa decodificar para {BYTES_CHAVE} "
            f"bytes (recebi {len(mestra)})."
        )

    return HKDF(
        algorithm=hashes.SHA256(),
        length=BYTES_CHAVE,
        salt=SAL_HKDF,
        info=INFO_CIFRA,
    ).derive(mestra)


def decifrar(envelope: str, subchave: bytes, account_id: str, campo: str) -> str:
    """
    Decifra um envelope `v1:<iv>:<cifrado>:<tag>`.

    O AAD amarra o texto cifrado a conta E ao campo. Nao e formalidade: sem ele,
    quem tivesse escrita no banco moveria o `application_secret` da conta A para
    a conta B, e a decifragem funcionaria -- o collector passaria a autenticar na
    conta A gravando o resultado como se fosse da B. Com AAD, falha.
    """
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    partes = (envelope or "").split(":")
    if len(partes) != 4 or partes[0] != VERSAO_ENVELOPE:
        raise ErroDeCredencial(
            f"{account_id}/{campo}: envelope em formato desconhecido "
            f"(esperado {VERSAO_ENVELOPE} com 4 partes)"
        )

    try:
        iv = base64.b64decode(partes[1])
        corpo = base64.b64decode(partes[2])
        tag = base64.b64decode(partes[3])
    except Exception:
        raise ErroDeCredencial(f"{account_id}/{campo}: envelope nao e base64") from None

    # IV E tag, os dois. Validar so a tag deixava um IV de tamanho errado chegar a
    # biblioteca, que levanta `ValueError` -- excecao que NAO e ErroDeCredencial e
    # portanto escapava do `except` de quem chama, derrubando a coleta das outras
    # contas. Era exatamente o oposto do isolamento pretendido.
    if len(iv) != BYTES_IV:
        raise ErroDeCredencial(f"{account_id}/{campo}: IV de tamanho invalido")
    if len(tag) != BYTES_TAG:
        raise ErroDeCredencial(f"{account_id}/{campo}: tag de tamanho invalido")

    aad = f"ovh:{account_id}:{campo}".encode()
    try:
        # O AESGCM do `cryptography` espera cifrado+tag concatenados; o Node
        # entrega os dois separados. E a unica diferenca de forma entre os lados.
        return AESGCM(subchave).decrypt(iv, corpo + tag, aad).decode("utf-8")
    except InvalidTag:
        raise ErroDeCredencial(
            f"{account_id}/{campo}: nao foi possivel decifrar. A "
            "APP_CREDENTIALS_ENCRYPTION_KEY mudou, ou a linha foi alterada fora do portal."
        ) from None
    except (ValueError, UnicodeDecodeError) as exc:
        # Rede de seguranca: qualquer outra recusa da biblioteca ou texto que nao
        # e UTF-8 valido tambem tem de sair como ErroDeCredencial, senao volta a
        # escapar. A mensagem original nao sobe -- ela poderia carregar buffer.
        raise ErroDeCredencial(
            f"{account_id}/{campo}: envelope invalido ({type(exc).__name__})"
        ) from None


# -------------------------------------------------------------- origem: banco
SQL_CONTAS = """
SELECT c.account_id,
       c.endpoint,
       c.status,
       c.application_key_encrypted,
       c.application_secret_encrypted,
       c.consumer_key_encrypted,
       a.account_name
  FROM cloud_provider_credentials c
  JOIN cloud_accounts a
    ON a.account_id = c.account_id
 WHERE c.provider = 'ovh'
   AND a.provider = 'ovh'
   AND a.active
 ORDER BY c.account_id
"""


def _tabela_existe(conexao, nome: str) -> bool:
    with conexao.cursor() as cur:
        cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{nome}",))
        return bool(cur.fetchone()[0])


def carregar_do_banco(
    conexao,
    chave_mestra_b64: str,
    avisar,
) -> list[ContaOvh]:
    """
    Contas OVH ativas com credencial cadastrada pelo portal.

    Devolve lista VAZIA -- nao levanta -- quando a migracao 006 nao rodou ou
    quando nao ha nenhuma credencial. As duas situacoes sao normais durante a
    transicao, e quem decide cair no fallback e quem chama.

    Credencial que nao decifra NAO derruba as outras: a conta e pulada com aviso.
    Uma chave-mestra trocada afetaria todas, e nesse caso o fallback ainda pode
    salvar a coleta -- abortar aqui garantiria zero contas.
    """
    if not _tabela_existe(conexao, "cloud_provider_credentials"):
        avisar(
            "tabela cloud_provider_credentials ausente -- rode "
            "scripts/migrations/006-credenciais-provedor.sql"
        )
        return []

    with conexao.cursor() as cur:
        cur.execute(SQL_CONTAS)
        linhas = cur.fetchall()

    if not linhas:
        return []

    # A subchave e derivada UMA vez, e so se houver algo para decifrar: sem
    # linhas, nao faz sentido exigir a chave-mestra.
    subchave = _subchave_de_cifra(chave_mestra_b64)

    contas: list[ContaOvh] = []
    for (
        account_id,
        endpoint,
        status,
        ak_cifrada,
        as_cifrada,
        ck_cifrada,
        account_name,
    ) in linhas:
        if status not in STATUS_ACEITOS:
            # `invalido` significa que a OVH REJEITOU a credencial num teste --
            # falha de rede nao marca invalido (o portal cuida disso). Tentar de
            # novo a cada execucao so produziria ruido no log e no historico.
            #
            # Para voltar a rotacao: teste de novo pelo portal, ou salve a
            # credencial corrigida. As duas acoes reabrem o status.
            avisar(
                f"{account_id}: pulada, credencial com status {status!r} "
                "(reteste ou recadastre pelo portal para reativar)"
            )
            continue

        try:
            conta = ContaOvh(
                provider_account_id=account_id,
                endpoint=endpoint,
                application_key=decifrar(ak_cifrada, subchave, account_id, "application_key"),
                application_secret=decifrar(
                    as_cifrada, subchave, account_id, "application_secret"
                ),
                consumer_key=decifrar(ck_cifrada, subchave, account_id, "consumer_key"),
                alias=account_name,
                origem="banco",
            )
            conta.validar()
        except ErroDeCredencial as exc:
            avisar(f"{account_id}: pulada ({exc})")
            continue

        contas.append(conta)

    return contas


# ---------------------------------------------------- origem: arquivos .env
_CHAVES_ENV = {
    "endpoint": "OVH_ENDPOINT",
    "application_key": "OVH_APPLICATION_KEY",
    "application_secret": "OVH_APPLICATION_SECRET",
    "consumer_key": "OVH_CONSUMER_KEY",
    "provider_account_id": "OVH_PROVIDER_ACCOUNT_ID",
    "alias": "OVH_ACCOUNT_ALIAS",
}


def ler_env_simples(caminho: Path) -> dict[str, str]:
    """
    Le `CHAVE=valor` sem `python-dotenv` e sem exportar nada no ambiente.

    Proprio, e nao `load_dotenv`, por dois motivos: cada arquivo de `accounts.d`
    e uma conta DIFERENTE, e `load_dotenv` polui `os.environ` de forma que o
    segundo arquivo herdaria valor do primeiro quando uma chave faltasse -- duas
    contas com a mesma credencial, sem aviso. E porque nada aqui precisa chegar a
    variavel de ambiente: o valor vai direto para memoria e morre com o processo.
    """
    valores: dict[str, str] = {}
    for linha in caminho.read_text(encoding="utf-8", errors="replace").splitlines():
        crua = linha.strip()
        if not crua or crua.startswith("#") or "=" not in crua:
            continue
        chave, valor = crua.split("=", 1)
        valores[chave.strip()] = valor.strip().strip("\"'")
    return valores


def conta_de_env(valores: dict[str, str], origem: str, rotulo: str) -> ContaOvh:
    faltando = [
        env
        for campo, env in _CHAVES_ENV.items()
        if campo != "alias" and not valores.get(env, "").strip()
    ]
    if faltando:
        raise ErroDeCredencial(f"{rotulo}: faltam {', '.join(sorted(faltando))}")

    conta = ContaOvh(
        provider_account_id=valores["OVH_PROVIDER_ACCOUNT_ID"].strip(),
        endpoint=valores["OVH_ENDPOINT"].strip(),
        application_key=valores["OVH_APPLICATION_KEY"].strip(),
        application_secret=valores["OVH_APPLICATION_SECRET"].strip(),
        consumer_key=valores["OVH_CONSUMER_KEY"].strip(),
        alias=(valores.get("OVH_ACCOUNT_ALIAS") or "").strip() or None,
        origem=origem,
    )
    conta.validar()
    return conta


def carregar_de_accounts_d(diretorio: Path, avisar) -> list[ContaOvh]:
    """Uma conta por arquivo `*.env`. Diretorio ausente devolve lista vazia."""
    if not diretorio.is_dir():
        return []

    contas: list[ContaOvh] = []
    for caminho in sorted(diretorio.glob("*.env")):
        try:
            contas.append(
                conta_de_env(ler_env_simples(caminho), "accounts.d", caminho.name)
            )
        except ErroDeCredencial as exc:
            # Um arquivo torto nao pode impedir os outros de coletarem.
            avisar(f"accounts.d: {caminho.name} ignorado ({exc})")
    return contas


def carregar_de_env_unico(caminho: Path, avisar) -> list[ContaOvh]:
    """O fallback que existe hoje em producao: um `.env`, uma conta."""
    if not caminho.is_file():
        return []
    try:
        return [conta_de_env(ler_env_simples(caminho), ".env", caminho.name)]
    except ErroDeCredencial as exc:
        avisar(f".env: ignorado ({exc})")
        return []


# ----------------------------------------------------------------- descoberta
AVISO_FALLBACK = (
    "Usando fallback accounts.d; migracao para credenciais no banco recomendada."
)
AVISO_FALLBACK_ENV = (
    "Usando fallback .env; migracao para credenciais no banco recomendada."
)


@dataclass
class Descoberta:
    contas: list[ContaOvh]
    origem: str
    avisos: list[str]


def descobrir_contas(
    conexao,
    *,
    chave_mestra_b64: str | None = None,
    diretorio_accounts_d: Path | None = None,
    arquivo_env: Path | None = None,
) -> Descoberta:
    """
    A ordem completa: banco -> accounts.d -> .env.

    `conexao` pode ser `None`: sem banco, so os fallbacks sao tentados. Serve ao
    caso de a migracao 006 nao existir ainda naquele ambiente.
    """
    avisos: list[str] = []

    def avisar(msg: str) -> None:
        avisos.append(msg)

    if conexao is not None:
        contas = carregar_do_banco(conexao, chave_mestra_b64 or "", avisar)
        if contas:
            return Descoberta(contas, "banco", avisos)

    if diretorio_accounts_d is not None:
        contas = carregar_de_accounts_d(diretorio_accounts_d, avisar)
        if contas:
            avisos.append(AVISO_FALLBACK)
            return Descoberta(contas, "accounts.d", avisos)

    if arquivo_env is not None:
        contas = carregar_de_env_unico(arquivo_env, avisar)
        if contas:
            avisos.append(AVISO_FALLBACK_ENV)
            return Descoberta(contas, ".env", avisos)

    return Descoberta([], "nenhuma", avisos)


def filtrar(contas: Iterable[ContaOvh], apenas: str | None) -> list[ContaOvh]:
    """
    Aplica `--account`. Sem o filtro, devolve tudo.

    Conta pedida e inexistente levanta em vez de devolver lista vazia: rodar
    `--account tipo-errado` e sair com sucesso tendo coletado nada e o tipo de
    silencio que faz alguem concluir que a conta esta sem custo.
    """
    lista = list(contas)
    if apenas is None:
        return lista

    escolhidas = [c for c in lista if c.provider_account_id == apenas]
    if not escolhidas:
        disponiveis = ", ".join(c.provider_account_id for c in lista) or "(nenhuma)"
        raise ErroDeCredencial(
            f"conta {apenas!r} nao encontrada entre as disponiveis: {disponiveis}"
        )
    return escolhidas


# ------------------------------------------------------------------- resumo
def resumo_para_log(contas: Iterable[ContaOvh]) -> str:
    """Linha de log com o que e seguro dizer: id, endpoint, alias, origem."""
    itens = [
        f"{c.provider_account_id}({c.endpoint}"
        + (f",{c.alias}" if c.alias else "")
        + f",via {c.origem})"
        for c in contas
    ]
    return ", ".join(itens) if itens else "(nenhuma)"


_FORMA_DE_SEGREDO = re.compile(r"[A-Za-z0-9+/_=-]{16,}")


def sem_segredo(texto: str) -> str:
    """
    Ultima barreira antes de um texto ir para log ou banco.

    Corta por FORMA e nao por lista de valores: nao ha como enumerar o que uma
    biblioteca de terceiro pode ecoar numa mensagem de erro. O custo e recortar
    tambem palavra longa inocente, e a troca esta certa -- perder uma palavra de
    uma mensagem custa menos do que publicar uma chave.
    """
    return _FORMA_DE_SEGREDO.sub("<omitido>", texto or "")


def chave_mestra_do_ambiente() -> str:
    return os.getenv("APP_CREDENTIALS_ENCRYPTION_KEY", "")
