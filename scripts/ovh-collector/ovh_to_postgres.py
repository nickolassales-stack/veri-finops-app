#!/usr/bin/env python3
"""
Collector OVHcloud -> PostgreSQL.

Le a API da OVH (somente GET) e grava nas tabelas `ovh_*` criadas pela migracao
005. NAO toca em nada da AWS: nem `aws_daily_costs`, nem `aws_monthly_costs`, nem
`cloud_accounts`, nem o pipeline Athena. Um erro aqui nao pode mudar um numero de
custo AWS -- e por isso as tabelas sao separadas.

    ./venv/bin/python ovh_to_postgres.py            # source=manual
    ./venv/bin/python ovh_to_postgres.py --source cron
    ./venv/bin/python ovh_to_postgres.py --dry-run  # coleta e mostra, nao grava
    ./venv/bin/python ovh_to_postgres.py --fechar-orfas

Codigos de saida:
    0  sucesso
    2  .env ausente/incompleto, ou faltam variaveis do PostgreSQL
    3  biblioteca ausente
    4  a OVH recusou a autenticacao
    5  falha ao gravar no PostgreSQL

RAW_JSON SEMPRE, NORMALIZACAO DEPOIS

Cada linha guarda o payload que a origem devolveu. Custa disco e paga barato: o
formato de `usage/current` varia entre tipos de projeto, e quando a normalizacao
estiver errada da para corrigir e reprocessar A PARTIR DO BANCO, sem bater de
novo na API -- que tem rate limit e nao devolve o passado. `usage/current` e
fotografia do mes em andamento: o consumo de ontem nao pode ser consultado
novamente.

O QUE NUNCA ENTRA NO BANCO

As chaves da OVH (ficam no .env, modo 600) e o campo `pdfUrl` das faturas, que
embute um token capaz de baixar o PDF sem autenticacao -- grava-lo seria
distribuir um segredo para todo mundo com SELECT.
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

RAIZ = Path(__file__).resolve().parent
ARQUIVO_ENV = RAIZ / ".env"

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
    for chave in ("OVH_ENDPOINT", "OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET",
                  "OVH_CONSUMER_KEY", "OVH_PROVIDER_ACCOUNT_ID"):
        valor = (os.getenv(chave) or "").strip()
        if not valor:
            log(f"ERRO: {chave} vazia no .env")
            sys.exit(2)
        cfg[chave] = valor
    if cfg["OVH_ENDPOINT"] not in ENDPOINTS_VALIDOS:
        log(f"ERRO: OVH_ENDPOINT invalido ({cfg['OVH_ENDPOINT']}). Use: {', '.join(ENDPOINTS_VALIDOS)}")
        sys.exit(2)
    cfg["OVH_ACCOUNT_ALIAS"] = (os.getenv("OVH_ACCOUNT_ALIAS") or "").strip() or None
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

    def __init__(self, cfg: dict[str, Any], source: str, log_path: str | None) -> None:
        self.cfg, self.source, self.log_path = cfg, source, log_path
        self.id: int | None = None
        self.conexao = None

    def abrir(self) -> None:
        try:
            self.conexao = conectar_banco(self.cfg, autocommit=True)
            with self.conexao.cursor() as cur:
                cur.execute(
                    "INSERT INTO ovh_sync_runs (started_at, status, source, log_path) "
                    "VALUES (now(), 'running', %s, %s) RETURNING id",
                    (self.source, self.log_path),
                )
                self.id = cur.fetchone()[0]
            log(f"execucao registrada: ovh_sync_runs.id={self.id}")
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
    inicio = date(hoje.year - (1 if hoje.month <= cfg["MESES_FATURA"] % 12 else 0), 1, 1)
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


# --------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description="Collector OVHcloud -> PostgreSQL")
    ap.add_argument("--source", default="manual", choices=("manual", "cron", "unknown"))
    ap.add_argument("--dry-run", action="store_true", help="coleta e mostra; nao grava")
    ap.add_argument("--fechar-orfas", action="store_true", help="so encerra execucoes travadas")
    ap.add_argument("--log-path", default=os.getenv("OVH_LOG_PATH"))
    args = ap.parse_args()

    cfg = carregar_config()

    if args.fechar_orfas:
        n = fechar_orfas(cfg)
        log(f"execucoes orfas encerradas: {n}")
        return 0

    try:
        import ovh  # noqa: F401
        import psycopg2  # noqa: F401
    except ImportError as exc:
        log(f"ERRO: dependencia ausente ({exc}). pip install -r requirements.txt")
        return 3

    import ovh

    execucao = Execucao(cfg, args.source, args.log_path)
    if not args.dry_run:
        execucao.abrir()
    contagens = {"contas": 0, "projetos": 0, "custos": 0, "faturas": 0, "linhas": 0}

    try:
        cliente = ovh.Client(
            endpoint=cfg["OVH_ENDPOINT"],
            application_key=cfg["OVH_APPLICATION_KEY"],
            application_secret=cfg["OVH_APPLICATION_SECRET"],
            consumer_key=cfg["OVH_CONSUMER_KEY"],
        )
        collector = Collector(cliente, cfg)
        dados = coletar(collector, cfg)

        log(f"coletado: {len(dados['projetos'])} projetos, "
            f"{len(dados['faturas'])} faturas, {len(dados['custos'])} linhas de custo")
        for aviso in collector.avisos[:20]:
            log(f"  aviso: {aviso}")
        if len(collector.avisos) > 20:
            log(f"  ... e mais {len(collector.avisos) - 20} avisos")

        if args.dry_run:
            log("dry-run: nada gravado")
            print(json.dumps({"projetos": len(dados["projetos"]),
                              "faturas": len(dados["faturas"]),
                              "custos": len(dados["custos"]),
                              "avisos": collector.avisos}, indent=2, ensure_ascii=False, default=str))
            return 0

        conexao = conectar_banco(cfg)
        try:
            contagens = gravar(conexao, dados)
        finally:
            conexao.close()

        log(f"gravado: contas={contagens['contas']} projetos={contagens['projetos']} "
            f"faturas={contagens['faturas']} linhas_fatura={contagens['linhas']} "
            f"custos={contagens['custos']}")
        execucao.fechar("success", contagens)
        return 0

    except Exception as exc:
        msg = sanitizar_erro(exc)
        log(f"FALHA: {msg}")
        execucao.fechar("failed", contagens, msg)
        # Distingue "a OVH recusou" de "o banco recusou": sao times diferentes.
        if any(t in msg.lower() for t in ("invalid", "credential", "forbidden", "401", "403")):
            return 4
        if "psycopg2" in msg or "connection" in msg.lower():
            return 5
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("interrompido")
        sys.exit(130)
