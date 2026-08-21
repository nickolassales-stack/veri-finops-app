#!/usr/bin/env python3
"""
Collector OVHcloud -> PostgreSQL.

Le a API da OVH (somente GET) e grava nas tabelas `ovh_*` criadas pela migracao
005. NAO toca em nada da AWS: nem `aws_daily_costs`, nem `aws_monthly_costs`, nem
`cloud_accounts`, nem o pipeline Athena. Um erro aqui nao pode mudar um numero de
custo AWS -- e por isso as tabelas sao separadas.

    ./venv/bin/python ovh_to_postgres.py --all
    ./venv/bin/python ovh_to_postgres.py --account ovh-main-ca
    ./venv/bin/python ovh_to_postgres.py --source cron --all
    ./venv/bin/python ovh_to_postgres.py --dry-run  # coleta e mostra, nao grava
    ./venv/bin/python ovh_to_postgres.py --fechar-orfas

DE ONDE VEM A CREDENCIAL

Tres origens, nesta precedencia (ver contas_ovh.py):

    1. `cloud_provider_credentials`, cifrada, cadastrada pelo portal   <- principal
    2. `accounts.d/*.env`, um arquivo por conta                        <- fallback
    3. `.env`, arquivo unico com uma conta                             <- fallback

O banco vence sempre que houver credencial la. Sem essa precedencia, uma rotacao
feita pela tela seria ignorada em silencio porque alguem esqueceu de limpar o
`.env` -- e a coleta seguiria funcionando com a credencial antiga, que parece
certo e esta errado.

Para decifrar, o collector precisa de `APP_CREDENTIALS_ENCRYPTION_KEY` no
ambiente -- a MESMA do portal. Sem ela, as credenciais do banco sao ignoradas
com aviso e o fallback assume.

UMA CONTA NAO DERRUBA AS OUTRAS

Cada conta roda isolada, com linha propria em `ovh_sync_runs`. Falha de uma nao
interrompe as demais; o codigo de saida no fim reflete se alguma falhou.

Codigos de saida:
    0  sucesso em todas as contas
    1  a unica conta processada falhou
    2  configuracao: `.env` ausente, PostgreSQL sem variaveis, ou nenhuma conta
       utilizavel, ou `--account` com id inexistente
    3  biblioteca ausente
    4  a OVH recusou a autenticacao      (mantido para o caso de conta unica)
    5  falha ao gravar no PostgreSQL     (mantido para o caso de conta unica)
    6  falha PARCIAL ou total com mais de uma conta -- veja o resumo no log

RAW_JSON SEMPRE, NORMALIZACAO DEPOIS

Cada linha guarda o payload que a origem devolveu. Custa disco e paga barato: o
formato de `usage/current` varia entre tipos de projeto, e quando a normalizacao
estiver errada da para corrigir e reprocessar A PARTIR DO BANCO, sem bater de
novo na API -- que tem rate limit e nao devolve o passado. `usage/current` e
fotografia do mes em andamento: o consumo de ontem nao pode ser consultado
novamente.

O QUE NUNCA ENTRA NO BANCO EM CLARO

As chaves da OVH e o campo `pdfUrl` das faturas, que embute um token capaz de
baixar o PDF sem autenticacao -- grava-lo seria distribuir um segredo para todo
mundo com SELECT.

As chaves agora ESTAO no banco, mas cifradas em AES-256-GCM, em
`cloud_provider_credentials`, e a chave que as decifra nunca esta la. Nada em
`ovh_*` guarda credencial.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

# `contas_ovh` vive ao lado deste arquivo. Funciona porque o Python coloca o
# diretorio do SCRIPT em sys.path[0] -- vale tanto para
# `python /opt/finops/ovh-collector/ovh_to_postgres.py` quanto para o wrapper.
from contas_ovh import (
    ContaOvh,
    Descoberta,
    ErroDeCredencial,
    chave_mestra_do_ambiente,
    descobrir_contas,
    filtrar,
    resumo_para_log,
    sem_segredo,
)

RAIZ = Path(__file__).resolve().parent
ARQUIVO_ENV = RAIZ / ".env"
DIRETORIO_ACCOUNTS_D = RAIZ / "accounts.d"

# Janela de faturas a coletar. 12 meses cobre comparacao ano a ano sem varrer o
# historico inteiro de uma conta antiga a cada execucao diaria.
MESES_FATURA_PADRAO = 12


def agora() -> datetime:
    return datetime.now(timezone.utc)


def log(msg: str) -> None:
    print(f"[{agora():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------- sanitizacao
# Repetido da POC de proposito: o collector precisa rodar sozinho no cron, e uma
# dependencia entre os dois faria a coleta parar se alguem mexesse na POC.
CHAVES_SEGREDO = re.compile(
    r"(secret|password|passwd|token|consumerkey|applicationkey|apikey|"
    r"credential|authorization|pdfurl|url)",
    re.IGNORECASE,
)
CHAVES_PESSOAIS = re.compile(
    r"(email|phone|address|firstname|lastname|organisation|organization|vat|"
    r"nationalidentificationnumber|zip|city|street|birth|fax)",
    re.IGNORECASE,
)


def mascarar(valor: str) -> str:
    if "@" in valor:
        m = re.match(r"^([^@]+)@(.+)$", valor)
        if m:
            local, dominio = m.groups()
            return f"{local[0]}{'*' * max(len(local) - 1, 3)}@{dominio}"
    return "*" * len(valor) if len(valor) <= 2 else f"{valor[0]}{'*' * (len(valor) - 2)}{valor[-1]}"


def limpar(dado: Any, chave_pai: str = "") -> Any:
    """Aplicado ANTES de gravar: o que vai para o banco ja esta limpo."""
    if isinstance(dado, dict):
        return {k: limpar(v, k) for k, v in dado.items()}
    if isinstance(dado, list):
        return [limpar(v, chave_pai) for v in dado]
    if isinstance(dado, str):
        if CHAVES_SEGREDO.search(chave_pai):
            return "<omitido>"
        if CHAVES_PESSOAIS.search(chave_pai):
            return mascarar(dado)
    return dado


_REDACOES = (
    (re.compile(r"(application_secret|consumer_key|application_key)\s*=\s*\S+", re.I), r"\1=<omitido>"),
    (re.compile(r"\b[0-9a-f]{32}\b", re.I), "<hex32>"),
    (re.compile(r"(password=)\S+", re.I), r"\1<omitido>"),
    (re.compile(r"://[^/@\s]+:[^/@\s]+@", re.I), "://<omitido>@"),
)


def sanitizar_erro(exc: BaseException) -> str:
    """
    Mensagem de UMA linha, sem traceback.

    Sem traceback de proposito: ele carrega repr de variaveis locais, e neste
    script as locais incluem a configuracao com as chaves da OVH. A mensagem vai
    para `ovh_sync_runs.error_message`, que o portal LE -- e o portal nao pode
    exibir credencial.
    """
    texto = f"{type(exc).__name__}: {exc}"
    for padrao, troca in _REDACOES:
        texto = padrao.sub(troca, texto)
    return " ".join(texto.split())[:500]


# -------------------------------------------------------------------- config
ENDPOINTS_VALIDOS = ("ovh-eu", "ovh-ca", "ovh-us")


def carregar_config() -> dict[str, Any]:
    if not ARQUIVO_ENV.exists():
        log(f"ERRO: {ARQUIVO_ENV} nao existe.")
        log("Crie a partir de .env.example e preencha. Ver README.md, secao 2/3.")
        sys.exit(2)
    try:
        from dotenv import load_dotenv
    except ImportError:
        log("ERRO: falta python-dotenv. pip install -r requirements.txt")
        sys.exit(3)

    load_dotenv(ARQUIVO_ENV)
    cfg: dict[str, Any] = {}

    # As chaves OVH_* NAO sao mais exigidas aqui.
    #
    # Elas passaram a ser fallback: a fonte principal e `cloud_provider_credentials`,
    # cadastrada pelo portal. Exigi-las neste ponto impediria o caso que a mudanca
    # existe para permitir -- credencial no banco e `.env` sem nenhuma chave OVH.
    #
    # O `.env` CONTINUA obrigatorio, porem, por outro motivo: e dele que saem as
    # variaveis do PostgreSQL, sem as quais nao ha como nem ler as credenciais.
    cfg["MESES_FATURA"] = int(os.getenv("OVH_MESES_FATURA") or MESES_FATURA_PADRAO)

    # PostgreSQL: as mesmas variaveis que o ETL AWS ja usa.
    for chave, padrao in (("PG_HOST", "127.0.0.1"), ("PG_PORT", "5432"),
                          ("PG_DB", "finops"), ("PG_USER", None), ("PG_PASSWORD", None)):
        valor = (os.getenv(chave) or "").strip() or padrao
        if not valor:
            log(f"ERRO: {chave} nao definida (nem no .env, nem no ambiente).")
            sys.exit(2)
        cfg[chave] = valor
    return cfg


def cfg_da_conta(base: dict[str, Any], conta: ContaOvh) -> dict[str, Any]:
    """
    Copia da config base com os campos da conta preenchidos.

    Existe para NAO precisar mexer em `coletar` nem em `gravar`. As duas funcoes
    ja liam `cfg["OVH_*"]`, e sao a parte testada em producao desde 20/08/2026 --
    reescreve-las para receber `ContaOvh` seria a mudanca mais arriscada desta
    entrega, em troca de nada.

    Copia e nao mutacao: a base e reusada em todas as contas do laco, e mutar
    faria a segunda conta herdar a credencial da primeira em caso de campo
    ausente. Duas contas coletando a mesma conta da OVH, sem aviso.
    """
    especifico = dict(base)
    especifico.update(
        OVH_ENDPOINT=conta.endpoint,
        OVH_APPLICATION_KEY=conta.application_key,
        OVH_APPLICATION_SECRET=conta.application_secret,
        OVH_CONSUMER_KEY=conta.consumer_key,
        OVH_PROVIDER_ACCOUNT_ID=conta.provider_account_id,
        OVH_ACCOUNT_ALIAS=conta.alias,
    )
    return especifico


def conectar_banco(cfg: dict[str, Any], autocommit: bool = False):
    import psycopg2
    conexao = psycopg2.connect(
        host=cfg["PG_HOST"], port=cfg["PG_PORT"], dbname=cfg["PG_DB"],
        user=cfg["PG_USER"], password=cfg["PG_PASSWORD"], connect_timeout=10,
    )
    conexao.autocommit = autocommit
    return conexao


# ------------------------------------------------------------ registro do run
class Execucao:
    """
    Escreve em `ovh_sync_runs` numa conexao PROPRIA, em autocommit.

    Separada da conexao de dados de proposito: se a transacao da carga estourar e
    for revertida, o registro da FALHA precisa sobreviver ao rollback. Registro
    de erro que some junto com o erro nao serve para nada.
    """

    def __init__(
        self,
        cfg: dict[str, Any],
        source: str,
        log_path: str | None,
        provider_account_id: str | None = None,
    ) -> None:
        self.cfg, self.source, self.log_path = cfg, source, log_path
        self.provider_account_id = provider_account_id
        self.id: int | None = None
        self.conexao = None
        #: `True` quando o banco ainda nao tem a coluna da migracao 007.
        self.sem_coluna_conta = False

    def abrir(self) -> None:
        try:
            self.conexao = conectar_banco(self.cfg, autocommit=True)
            with self.conexao.cursor() as cur:
                # Tenta com `provider_account_id`; sem a migracao 007 o Postgres
                # devolve 42703 (undefined_column) e caimos na forma antiga.
                #
                # Degradar em vez de exigir a migracao e deliberado: o collector
                # novo tem de rodar num banco que ainda nao migrou, senao a
                # ordem de deploy passa a ser obrigatoria e uma coleta se perde
                # se alguem inverter os passos.
                try:
                    cur.execute(
                        "INSERT INTO ovh_sync_runs "
                        "(started_at, status, source, log_path, provider_account_id) "
                        "VALUES (now(), 'running', %s, %s, %s) RETURNING id",
                        (self.source, self.log_path, self.provider_account_id),
                    )
                except Exception as exc:
                    if getattr(exc, "pgcode", None) != "42703":
                        raise
                    self.sem_coluna_conta = True
                    self.conexao.rollback()
                    cur.execute(
                        "INSERT INTO ovh_sync_runs (started_at, status, source, log_path) "
                        "VALUES (now(), 'running', %s, %s) RETURNING id",
                        (self.source, self.log_path),
                    )
                self.id = cur.fetchone()[0]
            conta = self.provider_account_id or "(sem conta)"
            aviso = " [sem coluna de conta: rode a migracao 007]" if self.sem_coluna_conta else ""
            log(f"execucao registrada: ovh_sync_runs.id={self.id} conta={conta}{aviso}")
        except Exception as exc:
            # Monitoramento NUNCA derruba o que ele monitora.
            log(f"aviso: nao foi possivel registrar inicio ({sanitizar_erro(exc)})")

    def fechar(self, status: str, contagens: dict[str, int], erro: str | None = None) -> None:
        if self.id is None or self.conexao is None:
            return
        try:
            with self.conexao.cursor() as cur:
                cur.execute(
                    "UPDATE ovh_sync_runs SET finished_at = now(), status = %s, "
                    "accounts_rows = %s, projects_rows = %s, cost_rows = %s, "
                    "invoice_rows = %s, error_message = %s WHERE id = %s",
                    (status, contagens.get("contas", 0), contagens.get("projetos", 0),
                     contagens.get("custos", 0), contagens.get("faturas", 0), erro, self.id),
                )
        except Exception as exc:
            log(f"aviso: nao foi possivel registrar fim ({sanitizar_erro(exc)})")
        finally:
            try:
                self.conexao.close()
            except Exception:
                pass


def fechar_orfas(cfg: dict[str, Any], minutos: int = 180) -> int:
    """Execucao que ficou 'running' alem do razoavel foi morta sem registrar."""
    conexao = conectar_banco(cfg, autocommit=True)
    try:
        with conexao.cursor() as cur:
            cur.execute(
                "UPDATE ovh_sync_runs SET status='failed', finished_at=now(), "
                "error_message = coalesce(error_message, 'execucao orfa: processo "
                "encerrado sem registrar desfecho') "
                "WHERE status='running' AND started_at < now() - make_interval(mins => %s)",
                (minutos,),
            )
            return cur.rowcount
    finally:
        conexao.close()


# --------------------------------------------------------------- normalizacao
def mes_de(valor: Any) -> date | None:
    if not valor:
        return None
    texto = str(valor)[:10]
    try:
        return datetime.strptime(texto, "%Y-%m-%d").date().replace(day=1)
    except ValueError:
        return None


def numero(valor: Any) -> float | None:
    """A OVH devolve preco ora como numero, ora como {'value': x, 'text': 'R$ 1'}."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    if isinstance(valor, dict):
        for chave in ("value", "amount", "total"):
            if chave in valor:
                return numero(valor[chave])
        return None
    if isinstance(valor, str):
        limpo = re.sub(r"[^\d.,-]", "", valor).replace(",", ".")
        try:
            return float(limpo)
        except ValueError:
            return None
    return None


def extrair_uso(payload: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Achata `usage/current` e `usage/forecast` em linhas (label, categoria, valor).

    O formato varia com o tipo de recurso do projeto, e nao ha como cobrir todos
    sem ver a conta real. Entao: reconhece as formas documentadas e DEVOLVE o que
    nao reconheceu, em vez de descartar em silencio. O que nao for reconhecido
    aparece no log e no resumo -- um zero errado no dashboard e pior do que um
    aviso explicito de que algo nao foi mapeado.
    """
    linhas: list[dict[str, Any]] = []
    nao_mapeado: list[str] = []
    if not isinstance(payload, dict):
        return linhas, ["payload nao e objeto"]

    # Blocos conhecidos: cada um agrupa recursos com totalPrice.
    for bloco in ("hourlyUsage", "monthlyUsage", "resourcesUsage"):
        conteudo = payload.get(bloco)
        if conteudo is None:
            continue
        if isinstance(conteudo, dict):
            for categoria, itens in conteudo.items():
                if not isinstance(itens, list):
                    continue
                for item in itens:
                    if not isinstance(item, dict):
                        continue
                    valor = numero(item.get("totalPrice") or item.get("price"))
                    if valor is None:
                        continue
                    rotulo = (item.get("reference") or item.get("region")
                              or item.get("planCode") or item.get("type") or categoria)
                    linhas.append({"label": str(rotulo), "categoria": f"{bloco}.{categoria}",
                                   "valor": valor, "raw": item})
        elif isinstance(conteudo, list):
            for item in conteudo:
                if not isinstance(item, dict):
                    continue
                valor = numero(item.get("totalPrice") or item.get("price"))
                if valor is None:
                    continue
                linhas.append({"label": str(item.get("reference") or bloco),
                               "categoria": bloco, "valor": valor, "raw": item})
        else:
            nao_mapeado.append(f"{bloco}: tipo {type(conteudo).__name__}")

    # Se nada foi extraido mas ha um total, grava o total -- melhor um numero
    # agregado correto do que nenhum.
    if not linhas:
        total = numero(payload.get("total") or payload.get("totalPrice"))
        if total is not None:
            linhas.append({"label": "(total do projeto)", "categoria": "total",
                           "valor": total, "raw": payload})
        else:
            nao_mapeado.append(f"sem bloco reconhecido; chaves={sorted(payload)[:12]}")
    return linhas, nao_mapeado


# ------------------------------------------------------------------- coleta
class Collector:
    def __init__(self, cliente, cfg: dict[str, Any]) -> None:
        self.cliente, self.cfg = cliente, cfg
        self.avisos: list[str] = []

    def get(self, caminho: str, **kwargs) -> Any:
        return self.cliente.get(caminho, **kwargs)

    def tenta(self, caminho: str, **kwargs) -> Any | None:
        try:
            return self.get(caminho, **kwargs)
        except Exception as exc:
            self.avisos.append(f"{caminho}: {sanitizar_erro(exc)}")
            return None


def coletar(collector: Collector, cfg: dict[str, Any]) -> dict[str, Any]:
    dados: dict[str, Any] = {"conta": None, "projetos": [], "faturas": [], "custos": []}
    pid = cfg["OVH_PROVIDER_ACCOUNT_ID"]

    # ---- conta ----
    me = collector.get("/me")  # se falhar aqui, o run inteiro falha: sem conta nao ha chave
    dados["conta"] = {
        "provider_account_id": pid,
        "nichandle": me.get("nichandle"),
        "endpoint": cfg["OVH_ENDPOINT"],
        "account_alias": cfg["OVH_ACCOUNT_ALIAS"],
        "currency": (me.get("currency") or {}).get("code"),
        "country": me.get("country"),
        "state": me.get("state"),
        "raw": limpar(me, "me"),
    }
    moeda = dados["conta"]["currency"] or "EUR"
    log(f"conta {me.get('nichandle')} ({cfg['OVH_ENDPOINT']}), moeda {moeda}")

    # ---- faturas ----
    hoje = date.today()
    # Recua MESES_FATURA meses a partir do mes corrente. A conta em meses
    # absolutos atravessa a virada de ano sem caso especial -- a versao
    # anterior caia sempre em 1o de janeiro do ano corrente, o que em janeiro
    # reduzia a janela a um unico mes e descartava o historico calado.
    absoluto = hoje.year * 12 + (hoje.month - 1) - cfg["MESES_FATURA"]
    inicio = date(absoluto // 12, absoluto % 12 + 1, 1)
    ids = collector.tenta("/me/bill", **{"date.from": f"{inicio.isoformat()}T00:00:00Z"})
    if ids is None:
        ids = collector.tenta("/me/bill") or []  # filtro por data nem sempre aceito
    log(f"faturas na janela: {len(ids)}")

    por_mes: dict[tuple[date, str], dict[str, Any]] = {}
    for bill_id in ids:
        cab = collector.tenta(f"/me/bill/{bill_id}")
        if not cab:
            continue
        mes = mes_de(cab.get("date"))
        fatura = {
            "bill_id": bill_id,
            "bill_date": (str(cab.get("date"))[:10] or None),
            "billing_month": mes,
            "total_with_tax": numero(cab.get("priceWithTax")),
            "total_without_tax": numero(cab.get("priceWithoutTax")),
            "tax": numero(cab.get("tax")),
            "currency": (cab.get("priceWithTax") or {}).get("currencyCode") if isinstance(cab.get("priceWithTax"), dict) else moeda,
            "raw": limpar(cab, "bill"),
            "linhas": [],
        }
        for detail_id in (collector.tenta(f"/me/bill/{bill_id}/details") or []):
            linha = collector.tenta(f"/me/bill/{bill_id}/details/{detail_id}")
            if not linha:
                continue
            total = numero(linha.get("totalPrice"))
            fatura["linhas"].append({
                "detail_id": str(detail_id),
                "description": linha.get("description"),
                "quantity": numero(linha.get("quantity")),
                "unit_price": numero(linha.get("unitPrice")),
                "total_price": total,
                "currency": moeda,
                "period_start": (str((linha.get("periodStart") or ""))[:10] or None),
                "period_end": (str((linha.get("periodEnd") or ""))[:10] or None),
                "service_name": linha.get("domain") or linha.get("serviceName"),
                "raw": limpar(linha, "detail"),
            })
            # Agrega por (mes, descricao) ACROSS faturas. Agregar por fatura faria
            # duas faturas do mesmo mes com a mesma descricao colidirem na chave
            # unica, e uma sobrescreveria a outra.
            if mes and total is not None:
                rotulo = (linha.get("description") or "(sem descricao)")[:200]
                chave = (mes, rotulo)
                registro = por_mes.setdefault(chave, {"valor": 0.0, "bills": set()})
                registro["valor"] += total
                registro["bills"].add(bill_id)
        dados["faturas"].append(fatura)

    for (mes, rotulo), agregado in por_mes.items():
        dados["custos"].append({
            "provider_account_id": pid, "project_service_name": "", "category": "",
            "billing_month": mes, "service_label": rotulo,
            "amount": round(agregado["valor"], 6), "currency": moeda,
            "source": "invoice",
            "raw_reference": ",".join(sorted(agregado["bills"]))[:200],
            "raw": {"bills": sorted(agregado["bills"])},
        })

    # ---- projetos e uso ----
    mes_corrente = date.today().replace(day=1)
    for nome in (collector.tenta("/cloud/project") or []):
        proj = collector.tenta(f"/cloud/project/{nome}") or {}
        dados["projetos"].append({
            "provider_account_id": pid, "service_name": nome,
            "description": proj.get("description"), "status": proj.get("status"),
            "plan_code": proj.get("planCode"), "raw": limpar(proj, "project"),
        })
        for caminho, origem in (("usage/current", "usage_current"),
                                ("usage/forecast", "usage_forecast")):
            payload = collector.tenta(f"/cloud/project/{nome}/{caminho}")
            if payload is None:
                continue
            linhas, nao_mapeado = extrair_uso(payload)
            for aviso in nao_mapeado:
                collector.avisos.append(f"{nome} {origem}: {aviso}")
            for linha in linhas:
                dados["custos"].append({
                    "provider_account_id": pid, "project_service_name": nome,
                    "category": linha["categoria"][:200], "billing_month": mes_corrente,
                    "service_label": linha["label"][:200],
                    "amount": round(abs(linha["valor"]), 6), "currency": moeda,
                    "source": origem, "raw_reference": nome, "raw": limpar(linha["raw"], "usage"),
                })
    return dados


# ------------------------------------------------------------------ gravacao
def gravar(conexao, dados: dict[str, Any]) -> dict[str, int]:
    """
    Tudo numa transacao so. Ou a coleta inteira entra, ou nada entra -- meia
    coleta gravada e pior do que nenhuma, porque o dashboard mostraria um total
    plausivel e errado.
    """
    from psycopg2.extras import Json, execute_batch
    contagens = {"contas": 0, "projetos": 0, "custos": 0, "faturas": 0, "linhas": 0}
    with conexao.cursor() as cur:
        c = dados["conta"]
        cur.execute(
            """INSERT INTO ovh_provider_accounts
                 (provider_account_id, nichandle, endpoint, account_alias,
                  currency, country, state, raw_json)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (provider_account_id) DO UPDATE SET
                 nichandle=EXCLUDED.nichandle, endpoint=EXCLUDED.endpoint,
                 account_alias=EXCLUDED.account_alias, currency=EXCLUDED.currency,
                 country=EXCLUDED.country, state=EXCLUDED.state,
                 raw_json=EXCLUDED.raw_json, updated_at=now()""",
            (c["provider_account_id"], c["nichandle"], c["endpoint"], c["account_alias"],
             c["currency"], c["country"], c["state"], Json(c["raw"])),
        )
        contagens["contas"] = 1

        if dados["projetos"]:
            execute_batch(cur,
                """INSERT INTO ovh_projects
                     (provider_account_id, service_name, description, status, plan_code, raw_json)
                   VALUES (%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (provider_account_id, service_name) DO UPDATE SET
                     description=EXCLUDED.description, status=EXCLUDED.status,
                     plan_code=EXCLUDED.plan_code, raw_json=EXCLUDED.raw_json,
                     updated_at=now()""",
                [(p["provider_account_id"], p["service_name"], p["description"],
                  p["status"], p["plan_code"], Json(p["raw"])) for p in dados["projetos"]])
            contagens["projetos"] = len(dados["projetos"])

        for f in dados["faturas"]:
            cur.execute(
                """INSERT INTO ovh_invoice_headers
                     (provider_account_id, bill_id, bill_date, billing_month,
                      total_with_tax, total_without_tax, tax, currency, raw_json)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (provider_account_id, bill_id) DO UPDATE SET
                     bill_date=EXCLUDED.bill_date, billing_month=EXCLUDED.billing_month,
                     total_with_tax=EXCLUDED.total_with_tax,
                     total_without_tax=EXCLUDED.total_without_tax, tax=EXCLUDED.tax,
                     currency=EXCLUDED.currency, raw_json=EXCLUDED.raw_json, updated_at=now()""",
                (dados["conta"]["provider_account_id"], f["bill_id"], f["bill_date"],
                 f["billing_month"], f["total_with_tax"], f["total_without_tax"],
                 f["tax"], f["currency"], Json(f["raw"])))
            contagens["faturas"] += 1
            if f["linhas"]:
                execute_batch(cur,
                    """INSERT INTO ovh_invoice_lines
                         (provider_account_id, bill_id, detail_id, description, quantity,
                          unit_price, total_price, currency, period_start, period_end,
                          service_name, raw_json)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (provider_account_id, bill_id, detail_id) DO UPDATE SET
                         description=EXCLUDED.description, quantity=EXCLUDED.quantity,
                         unit_price=EXCLUDED.unit_price, total_price=EXCLUDED.total_price,
                         currency=EXCLUDED.currency, period_start=EXCLUDED.period_start,
                         period_end=EXCLUDED.period_end, service_name=EXCLUDED.service_name,
                         raw_json=EXCLUDED.raw_json, updated_at=now()""",
                    [(dados["conta"]["provider_account_id"], f["bill_id"], l["detail_id"],
                      l["description"], l["quantity"], l["unit_price"], l["total_price"],
                      l["currency"], l["period_start"], l["period_end"], l["service_name"],
                      Json(l["raw"])) for l in f["linhas"]])
                contagens["linhas"] += len(f["linhas"])

        if dados["custos"]:
            execute_batch(cur,
                """INSERT INTO ovh_monthly_costs
                     (provider_account_id, project_service_name, category, billing_month,
                      service_label, amount, currency, source, raw_reference, raw_json)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (provider_account_id, project_service_name, billing_month,
                                service_label, category, source) DO UPDATE SET
                     amount=EXCLUDED.amount, currency=EXCLUDED.currency,
                     raw_reference=EXCLUDED.raw_reference, raw_json=EXCLUDED.raw_json,
                     updated_at=now()""",
                [(k["provider_account_id"], k["project_service_name"], k["category"],
                  k["billing_month"], k["service_label"], k["amount"], k["currency"],
                  k["source"], k["raw_reference"], Json(k["raw"])) for k in dados["custos"]])
            contagens["custos"] = len(dados["custos"])
    conexao.commit()
    return contagens


# ------------------------------------------------------------ uma conta so
def sincronizar_conta(
    conta: ContaOvh,
    base: dict[str, Any],
    source: str,
    log_path: str | None,
    dry_run: bool,
) -> tuple[bool, dict[str, int], str | None]:
    """
    Coleta e grava UMA conta, isolada.

    Devolve `(ok, contagens, erro_sanitizado)`. NUNCA levanta: o laco de fora
    precisa seguir para a proxima conta, e uma excecao vazando daqui pararia a
    coleta das demais -- justamente o que a isolacao existe para impedir.

    Cada conta tem `Execucao` propria, com o seu `provider_account_id`. Uma linha
    por conta em `ovh_sync_runs`: sem isso, uma falha parcial apareceria como
    "houve falha hoje" sem dizer de qual conta, e o diagnostico ficaria pior do
    que era com uma conta so.
    """
    import ovh

    cfg = cfg_da_conta(base, conta)
    execucao = Execucao(cfg, source, log_path, conta.provider_account_id)
    if not dry_run:
        execucao.abrir()
    contagens = {"contas": 0, "projetos": 0, "custos": 0, "faturas": 0, "linhas": 0}

    try:
        cliente = ovh.Client(
            endpoint=conta.endpoint,
            application_key=conta.application_key,
            application_secret=conta.application_secret,
            consumer_key=conta.consumer_key,
        )
        collector = Collector(cliente, cfg)
        dados = coletar(collector, cfg)

        log(f"  {conta.provider_account_id}: coletado "
            f"{len(dados['projetos'])} projetos, {len(dados['faturas'])} faturas, "
            f"{len(dados['custos'])} linhas de custo")
        for aviso in collector.avisos[:20]:
            log(f"    aviso: {aviso}")
        if len(collector.avisos) > 20:
            log(f"    ... e mais {len(collector.avisos) - 20} avisos")

        if dry_run:
            log(f"  {conta.provider_account_id}: dry-run, nada gravado")
            return True, {
                "contas": 1,
                "projetos": len(dados["projetos"]),
                "faturas": len(dados["faturas"]),
                "custos": len(dados["custos"]),
                "linhas": 0,
            }, None

        conexao = conectar_banco(cfg)
        try:
            contagens = gravar(conexao, dados)
        finally:
            conexao.close()

        log(f"  {conta.provider_account_id}: gravado "
            f"projetos={contagens['projetos']} faturas={contagens['faturas']} "
            f"linhas_fatura={contagens['linhas']} custos={contagens['custos']}")
        execucao.fechar("success", contagens)
        return True, contagens, None

    except Exception as exc:
        msg = sanitizar_erro(exc)
        log(f"  {conta.provider_account_id}: FALHA -- {msg}")
        execucao.fechar("failed", contagens, msg)
        return False, contagens, msg


# --------------------------------------------------------------------- main
def descobrir(base: dict[str, Any], apenas: str | None) -> Descoberta:
    """
    Descobre as contas, tolerando banco indisponivel.

    O banco pode falhar e ainda assim haver `.env` utilizavel -- e nesse caso a
    coleta deve acontecer. Sem este `try`, uma indisponibilidade momentanea do
    Postgres impediria o fallback de sequer ser tentado.
    """
    conexao = None
    try:
        conexao = conectar_banco(base, autocommit=True)
    except Exception as exc:
        log(f"aviso: banco indisponivel para ler credenciais ({sanitizar_erro(exc)})")

    try:
        d = descobrir_contas(
            conexao,
            chave_mestra_b64=chave_mestra_do_ambiente(),
            diretorio_accounts_d=DIRETORIO_ACCOUNTS_D,
            arquivo_env=ARQUIVO_ENV,
        )
    finally:
        if conexao is not None:
            try:
                conexao.close()
            except Exception:
                pass

    for aviso in d.avisos:
        log(f"aviso: {sem_segredo(aviso)}")

    d.contas = filtrar(d.contas, apenas)
    return d


def main() -> int:
    ap = argparse.ArgumentParser(description="Collector OVHcloud -> PostgreSQL")
    ap.add_argument("--source", default="manual", choices=("manual", "cron", "unknown"))
    ap.add_argument("--dry-run", action="store_true", help="coleta e mostra; nao grava")
    ap.add_argument("--fechar-orfas", action="store_true", help="so encerra execucoes travadas")
    ap.add_argument("--log-path", default=os.getenv("OVH_LOG_PATH"))

    # `--all` e `--account` sao mutuamente exclusivos, e o padrao (nenhum dos
    # dois) equivale a `--all`. O padrao permissivo e proposital: o cron em
    # producao hoje chama sem argumento nenhum, e ele nao pode parar de coletar
    # porque o codigo passou a esperar uma flag nova.
    escopo = ap.add_mutually_exclusive_group()
    escopo.add_argument("--all", action="store_true", help="todas as contas OVH ativas (padrao)")
    escopo.add_argument("--account", metavar="ID", help="somente esta conta (provider_account_id)")

    args = ap.parse_args()

    base = carregar_config()

    if args.fechar_orfas:
        n = fechar_orfas(base)
        log(f"execucoes orfas encerradas: {n}")
        return 0

    try:
        import ovh  # noqa: F401
        import psycopg2  # noqa: F401
    except ImportError as exc:
        log(f"ERRO: dependencia ausente ({exc}). pip install -r requirements.txt")
        return 3

    try:
        descoberta = descobrir(base, args.account)
    except ErroDeCredencial as exc:
        # `--account` com id que nao existe cai aqui. Sair com erro em vez de
        # coletar nada: um "sucesso" que nao coletou faria alguem concluir que a
        # conta esta sem custo.
        log(f"ERRO: {sem_segredo(str(exc))}")
        return 2

    if not descoberta.contas:
        log("ERRO: nenhuma conta OVH utilizavel encontrada.")
        log("  Verifique: credencial cadastrada em Configuracoes > Contas Cloud,")
        log("  ou accounts.d/*.env, ou as chaves OVH_* no .env.")
        return 2

    log(f"origem das credenciais: {descoberta.origem}")
    log(f"contas a sincronizar ({len(descoberta.contas)}): "
        f"{resumo_para_log(descoberta.contas)}")

    falhas: list[str] = []
    total = {"contas": 0, "projetos": 0, "custos": 0, "faturas": 0, "linhas": 0}

    for conta in descoberta.contas:
        ok, contagens, _erro = sincronizar_conta(
            conta, base, args.source, args.log_path, args.dry_run
        )
        for chave in total:
            total[chave] += contagens.get(chave, 0)
        if not ok:
            falhas.append(conta.provider_account_id)

    # Resumo SEM SEGREDO: ids, contagens e quem falhou. Nenhum campo de credencial.
    log("--- resumo ---")
    log(f"contas processadas: {len(descoberta.contas)}  "
        f"sucesso: {len(descoberta.contas) - len(falhas)}  falhas: {len(falhas)}")
    log(f"totais: projetos={total['projetos']} faturas={total['faturas']} "
        f"linhas_fatura={total['linhas']} custos={total['custos']}")
    if falhas:
        log(f"contas que falharam: {', '.join(falhas)}")

    if args.dry_run:
        log("dry-run: nada gravado")

    if not falhas:
        return 0

    # Codigo 6 para falha PARCIAL ou total em modo multi-conta. Com uma conta so,
    # os codigos historicos (4 = a OVH recusou, 5 = o banco recusou) continuam
    # valendo -- o RUNBOOK e o cron dependem deles, e trocar por 6 quebraria a
    # leitura de quem opera. Ver o cabecalho deste arquivo.
    if len(descoberta.contas) == 1:
        return 1
    return 6


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("interrompido")
        sys.exit(130)
