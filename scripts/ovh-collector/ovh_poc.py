#!/usr/bin/env python3
"""
POC de integracao OVHcloud -- somente LEITURA.

Objetivo: descobrir o que a API da OVH realmente entrega para FinOps, antes de
escrever qualquer ETL. Nao grava no PostgreSQL, nao toca no pipeline AWS, nao
altera nada na OVH -- apenas GET.

O resultado sai em dois formatos: um resumo legivel no terminal e um JSON
sanitizado em out/ovh_poc_result.json, que serve de base para decidir o schema
das tabelas depois.

SANITIZACAO NAO E ENFEITE AQUI

A resposta de /me traz nome, e-mail, endereco, telefone e documento fiscal do
titular da conta. E cada fatura traz `pdfUrl`, que embute um token de acesso: quem
tiver a URL baixa o PDF sem autenticar. Nada disso pode cair num arquivo que
alguem vai colar num chamado ou commitar por engano. Por isso o JSON e sanitizado
ANTES de ser gravado, e nao na hora de exibir -- o arquivo em disco ja nasce
limpo.

Uso:
    cd /opt/finops/ovh-collector
    source venv/bin/activate
    python ovh_poc.py

Codigos de saida:
    0  coleta concluida (mesmo com endpoints falhando -- veja o resumo)
    2  .env ausente ou incompleto
    3  biblioteca `ovh` nao instalada
    4  autenticacao recusada pela OVH (credencial invalida ou sem permissao)
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parent
ARQUIVO_ENV = RAIZ / ".env"
DIR_SAIDA = RAIZ / "out"
ARQUIVO_SAIDA = DIR_SAIDA / "ovh_poc_result.json"

# Quantas faturas detalhar. Detalhar TODAS custa uma chamada por fatura mais uma
# por linha de detalhe -- numa conta antiga isso vira centenas de requisicoes e
# esbarra no rate limit. Tres bastam para descobrir o formato.
FATURAS_A_DETALHAR = 3


# --------------------------------------------------------------------- saida
def cor(codigo: str, texto: str) -> str:
    return f"\033[{codigo}m{texto}\033[0m" if sys.stdout.isatty() else texto


def ok(t: str) -> str:
    return cor("32", t)


def erro(t: str) -> str:
    return cor("31", t)


def alerta(t: str) -> str:
    return cor("33", t)


def titulo(t: str) -> None:
    print(f"\n{cor('1', '== ' + t)}")


# --------------------------------------------------------------- sanitizacao
# Chaves cujo VALOR nunca deve aparecer -- nem no terminal, nem no JSON.
CHAVES_SEGREDO = re.compile(
    r"(secret|password|passwd|token|consumerkey|applicationkey|apikey|"
    r"credential|authorization|pdfurl|url)",
    re.IGNORECASE,
)

# Chaves com dado pessoal do titular. Mascaradas, nao removidas: saber que o
# campo existe e util para decidir o schema depois.
CHAVES_PESSOAIS = re.compile(
    r"(email|phone|address|firstname|lastname|name|organisation|organization|"
    r"vat|nationalidentificationnumber|companynationalidentificationnumber|"
    r"zip|city|street|birth|fax|contact)",
    re.IGNORECASE,
)


def mascarar_email(valor: str) -> str:
    """a***@dominio.com -- preserva o dominio, que costuma ser o dado util."""
    m = re.match(r"^([^@]+)@(.+)$", valor)
    if not m:
        return mascarar_texto(valor)
    local, dominio = m.groups()
    return f"{local[0]}{'*' * max(len(local) - 1, 3)}@{dominio}"


def mascarar_texto(valor: str) -> str:
    if len(valor) <= 2:
        return "*" * len(valor)
    return f"{valor[0]}{'*' * (len(valor) - 2)}{valor[-1]}"


def sanitizar(dado: Any, chave_pai: str = "") -> Any:
    """
    Percorre a estrutura inteira aplicando as regras.

    Recursiva de proposito: a API devolve objetos aninhados, e mascarar so o
    primeiro nivel deixaria e-mail escondido dentro de `me.address.email`.
    """
    if isinstance(dado, dict):
        return {k: sanitizar(v, k) for k, v in dado.items()}
    if isinstance(dado, list):
        return [sanitizar(v, chave_pai) for v in dado]
    if isinstance(dado, str):
        if CHAVES_SEGREDO.search(chave_pai):
            return "<omitido>"
        if CHAVES_PESSOAIS.search(chave_pai):
            return mascarar_email(dado) if "@" in dado else mascarar_texto(dado)
    return dado


# ------------------------------------------------------------------- config
OBRIGATORIAS = (
    "OVH_ENDPOINT",
    "OVH_APPLICATION_KEY",
    "OVH_APPLICATION_SECRET",
    "OVH_CONSUMER_KEY",
)

# A OVH opera regioes como contas SEPARADAS: uma credencial de ovh-ca nao vale em
# ovh-us. Errar aqui produz 403 que parece falta de permissao, e a pessoa vai
# procurar no lugar errado.
ENDPOINTS_VALIDOS = {
    "ovh-eu": "https://eu.api.ovh.com/1.0/",
    "ovh-ca": "https://ca.api.ovh.com/1.0/",
    "ovh-us": "https://api.us.ovhcloud.com/1.0/",
}


def carregar_config() -> dict[str, str]:
    if not ARQUIVO_ENV.exists():
        print(erro(f"Arquivo nao encontrado: {ARQUIVO_ENV}"))
        print()
        print("Este script NAO roda sem credencial real, de proposito.")
        print("Crie o .env a partir do modelo e preencha com as suas chaves:")
        print()
        print(f"    cp {RAIZ / '.env.example'} {ARQUIVO_ENV}")
        print(f"    chmod 600 {ARQUIVO_ENV}")
        print(f"    nano {ARQUIVO_ENV}")
        print()
        print("Como gerar as chaves: veja o README.md, secao 2.")
        sys.exit(2)

    try:
        from dotenv import load_dotenv
    except ImportError:
        print(erro("Falta a biblioteca python-dotenv."))
        print("    pip install -r requirements.txt")
        sys.exit(3)

    load_dotenv(ARQUIVO_ENV)
    cfg = {c: (os.getenv(c) or "").strip() for c in OBRIGATORIAS}

    faltando = [c for c, v in cfg.items() if not v]
    if faltando:
        print(erro("Variaveis obrigatorias vazias no .env:"))
        for c in faltando:
            print(f"    {c}")
        sys.exit(2)

    # Marcadores do modelo: se chegaram ate aqui, ninguem preencheu de verdade.
    if any(v.lower().startswith(("cole-", "troque", "<", "sua-")) for v in cfg.values()):
        print(erro("O .env ainda tem os marcadores do modelo."))
        print("Substitua pelos valores reais gerados no console da OVH.")
        sys.exit(2)

    if cfg["OVH_ENDPOINT"] not in ENDPOINTS_VALIDOS:
        print(erro(f"OVH_ENDPOINT invalido: {cfg['OVH_ENDPOINT']}"))
        print(f"Use um destes: {', '.join(ENDPOINTS_VALIDOS)}")
        sys.exit(2)

    cfg["OVH_ACCOUNT_ALIAS"] = os.getenv("OVH_ACCOUNT_ALIAS", "").strip() or "(sem alias)"
    cfg["OVH_PROVIDER_ACCOUNT_ID"] = os.getenv("OVH_PROVIDER_ACCOUNT_ID", "").strip() or "(sem id)"
    return cfg


# ------------------------------------------------------------------ coletor
class Coletor:
    """Chama a API guardando o desfecho de CADA endpoint, com erro ou sem."""

    def __init__(self, cliente) -> None:
        self.cliente = cliente
        self.chamadas: list[dict[str, Any]] = []

    def get(self, caminho: str, **kwargs) -> tuple[bool, Any]:
        registro: dict[str, Any] = {"endpoint": caminho, "metodo": "GET"}
        try:
            dados = self.cliente.get(caminho, **kwargs)
            registro["ok"] = True
            registro["itens"] = len(dados) if isinstance(dados, (list, dict)) else 1
            self.chamadas.append(registro)
            return True, dados
        except Exception as exc:  # a lib levanta subclasses distintas por status
            registro["ok"] = False
            registro["erro_tipo"] = type(exc).__name__
            # A mensagem da OVH descreve a permissao faltante -- e o dado mais
            # util do POC. Ela nao contem credencial, mas cortamos por seguranca.
            registro["erro"] = str(exc)[:300]
            self.chamadas.append(registro)
            return False, None

    def resumo_por_endpoint(self) -> list[dict[str, Any]]:
        return self.chamadas


# --------------------------------------------------------------------- main
def main() -> int:
    cfg = carregar_config()

    try:
        import ovh
    except ImportError:
        print(erro("Falta a biblioteca `ovh`."))
        print("    python3 -m venv venv && source venv/bin/activate")
        print("    pip install -r requirements.txt")
        return 3

    print(f"endpoint     : {cfg['OVH_ENDPOINT']}  ({ENDPOINTS_VALIDOS[cfg['OVH_ENDPOINT']]})")
    print(f"alias        : {cfg['OVH_ACCOUNT_ALIAS']}")
    print(f"provider id  : {cfg['OVH_PROVIDER_ACCOUNT_ID']}")
    print(f"application  : {cfg['OVH_APPLICATION_KEY'][:4]}…  (chave nunca impressa por inteiro)")

    cliente = ovh.Client(
        endpoint=cfg["OVH_ENDPOINT"],
        application_key=cfg["OVH_APPLICATION_KEY"],
        application_secret=cfg["OVH_APPLICATION_SECRET"],
        consumer_key=cfg["OVH_CONSUMER_KEY"],
    )
    coletor = Coletor(cliente)
    resultado: dict[str, Any] = {
        "coletado_em": datetime.now(timezone.utc).isoformat(),
        "endpoint": cfg["OVH_ENDPOINT"],
        "alias": cfg["OVH_ACCOUNT_ALIAS"],
        "provider_account_id": cfg["OVH_PROVIDER_ACCOUNT_ID"],
    }

    # ------------------------------------------------------------- 1. /me
    titulo("1. Identidade  GET /me")
    sucesso, me = coletor.get("/me")
    if not sucesso:
        print(erro("  /me falhou -- a credencial nao autentica."))
        print("  Causas usuais, nesta ordem:")
        print("    1. OVH_ENDPOINT de regiao diferente da conta (eu/ca/us sao separadas);")
        print("    2. consumer_key nao validado no link que a OVH devolve ao cria-lo;")
        print("    3. application_secret errado.")
        for c in coletor.chamadas:
            if not c["ok"]:
                print(f"    resposta: {c['erro']}")
        return 4
    resultado["me"] = sanitizar(me, "me")
    print(ok(f"  OK  nichandle={me.get('nichandle')}  pais={me.get('country')}  moeda={(me.get('currency') or {}).get('code')}"))
    print(f"      tipo de conta: {me.get('legalform')}  |  estado: {me.get('state')}")

    # ---------------------------------------------------------- 2. faturas
    titulo("2. Faturas  GET /me/bill")
    sucesso, ids_faturas = coletor.get("/me/bill")
    faturas: list[dict[str, Any]] = []
    detalhes_ok = 0
    if sucesso and ids_faturas:
        print(ok(f"  OK  {len(ids_faturas)} faturas na conta"))
        # Do fim da lista: na pratica a API devolve em ordem crescente de
        # data, mas isso nao e documentado -- por isso o rotulo abaixo nao
        # promete "as mais recentes", so identifica a amostra.
        recentes = ids_faturas[-FATURAS_A_DETALHAR:]
        print(f"      detalhando {len(recentes)}, do fim da lista devolvida")
        for bill_id in recentes:
            entrada: dict[str, Any] = {"billId": bill_id}
            s_cab, cab = coletor.get(f"/me/bill/{bill_id}")
            if s_cab:
                entrada["cabecalho"] = sanitizar(cab, "bill")
                print(
                    f"      {bill_id}  data={cab.get('date', '?')[:10]}  "
                    f"total={(cab.get('priceWithTax') or {}).get('text', '?')}"
                )
            s_det, det = coletor.get(f"/me/bill/{bill_id}/details")
            if s_det:
                detalhes_ok += 1
                entrada["detalhes_ids"] = det
                entrada["detalhes_qtd"] = len(det) if isinstance(det, list) else None
                # Uma linha de exemplo revela o schema sem baixar a fatura toda.
                if isinstance(det, list) and det:
                    s_l, linha = coletor.get(f"/me/bill/{bill_id}/details/{det[0]}")
                    if s_l:
                        entrada["detalhe_exemplo"] = sanitizar(linha, "detail")
                print(f"        detalhes: {entrada.get('detalhes_qtd')} linhas")
            else:
                print(alerta(f"        detalhes indisponiveis para {bill_id}"))
            faturas.append(entrada)
    elif sucesso:
        print(alerta("  Conta sem faturas."))
    else:
        print(erro("  /me/bill falhou -- confira a permissao GET /me/bill*"))
    resultado["faturas"] = faturas
    resultado["faturas_total"] = len(ids_faturas) if sucesso and ids_faturas else 0

    # -------------------------------------------------- 3. projetos cloud
    titulo("3. Public Cloud  GET /cloud/project")
    sucesso, projetos_ids = coletor.get("/cloud/project")
    projetos: list[dict[str, Any]] = []
    usage_ok = forecast_ok = 0
    if sucesso and projetos_ids:
        print(ok(f"  OK  {len(projetos_ids)} projetos"))
        for nome in projetos_ids:
            entrada: dict[str, Any] = {"serviceName": nome}
            s_p, proj = coletor.get(f"/cloud/project/{nome}")
            if s_p:
                entrada["projeto"] = sanitizar(proj, "project")
                print(f"      {nome}  status={proj.get('status')}  nome={proj.get('description')}")

            s_u, uso = coletor.get(f"/cloud/project/{nome}/usage/current")
            if s_u:
                usage_ok += 1
                entrada["usage_current"] = sanitizar(uso, "usage")
                total = None
                if isinstance(uso, dict):
                    total = (uso.get("resourcesUsage") or [{}])
                    total = (uso.get("hourlyBilling") or {}).get("total") or uso.get("total")
                print(ok(f"        usage/current  OK   total={total}"))
            else:
                print(alerta("        usage/current  indisponivel"))

            s_f, prev = coletor.get(f"/cloud/project/{nome}/usage/forecast")
            if s_f:
                forecast_ok += 1
                entrada["usage_forecast"] = sanitizar(prev, "forecast")
                print(ok("        usage/forecast OK"))
            else:
                print(alerta("        usage/forecast indisponivel"))

            projetos.append(entrada)
    elif sucesso:
        print(alerta("  Nenhum projeto Public Cloud nesta conta."))
    else:
        print(erro("  /cloud/project falhou -- confira a permissao GET /cloud/project*"))
    resultado["projetos"] = projetos
    resultado["projetos_total"] = len(projetos_ids) if sucesso and projetos_ids else 0

    # ------------------------------------------------------------- gravar
    resultado["chamadas"] = coletor.resumo_por_endpoint()
    DIR_SAIDA.mkdir(exist_ok=True)
    # O conteudo ja esta sanitizado; 600 e cinto e suspensorio, porque mesmo
    # mascarado o arquivo revela quanto a empresa gasta e em que.
    ARQUIVO_SAIDA.write_text(
        json.dumps(resultado, indent=2, ensure_ascii=False, default=str), encoding="utf-8"
    )
    os.chmod(ARQUIVO_SAIDA, 0o600)

    # ------------------------------------------------------------- resumo
    titulo("Resumo")
    falhas = [c for c in coletor.chamadas if not c["ok"]]
    print(f"  conta conectada        : {me.get('nichandle')}  ({cfg['OVH_ACCOUNT_ALIAS']})")
    print(f"  faturas encontradas    : {resultado['faturas_total']}")
    print(f"  faturas detalhadas     : {detalhes_ok} de {min(FATURAS_A_DETALHAR, resultado['faturas_total'])}")
    print(f"  projetos Public Cloud  : {resultado['projetos_total']}")
    print(f"  usage/current OK       : {usage_ok} de {resultado['projetos_total']}")
    print(f"  usage/forecast OK      : {forecast_ok} de {resultado['projetos_total']}")
    print(f"  chamadas totais        : {len(coletor.chamadas)}  ({len(falhas)} com erro)")

    if falhas:
        print(f"\n  {alerta('Endpoints que falharam:')}")
        vistos: dict[str, str] = {}
        for c in falhas:
            # Agrupa por padrao de caminho: 40 faturas com o mesmo 403 e UM
            # problema, nao quarenta.
            padrao = re.sub(r"/[A-Za-z0-9_-]{8,}", "/{id}", c["endpoint"])
            vistos.setdefault(padrao, f"{c['erro_tipo']}: {c['erro']}")
        for padrao, msg in vistos.items():
            print(f"    {padrao}")
            print(f"      {msg}")

    print(f"\n  resultado sanitizado   : {ARQUIVO_SAIDA}")
    print(f"  {alerta('Confira o arquivo antes de anexar em chamado ou ticket.')}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrompido")
        sys.exit(130)
