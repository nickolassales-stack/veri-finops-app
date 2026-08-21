#!/usr/bin/env python3
"""Gera o SQL da view finops.cur_raw com lista explicita de colunas.

Motivo de existir: as duas contas novas (891377338363, 683745271637) nao trazem
line_item_resource_id no CUR. Com `SELECT *` o UNION ALL falha por contagem de
colunas. Aqui a coluna e projetada como NULL tipado para essas duas, mantendo
posicao e tipo iguais aos das contas antigas.
"""
import json, subprocess, sys

REF_DB, REF_TB = "finops-cur2-daily", "finops_cur2_daily"
COMPLETAS = [("finops-cur2-daily", "finops_cur2_daily"),
             ("finops_cur2_147997123577", "finops_cur2_147997123577")]
SEM_RESOURCE = [("finops_cur2_891377338363", "finops_cur2_891377338363"),
                ("finops_cur2_683745271637", "finops_cur2_683745271637")]
FALTANTE = "line_item_resource_id"


def colunas(db, tb):
    saida = subprocess.run(
        ["aws", "glue", "get-table", "--database-name", db, "--name", tb],
        capture_output=True, text=True, check=True).stdout
    t = json.loads(saida)["Table"]
    dados = [(c["Name"], c["Type"]) for c in t["StorageDescriptor"]["Columns"]]
    parts = [(c["Name"], c["Type"]) for c in (t.get("PartitionKeys") or [])]
    return dados, parts


ref_dados, ref_parts = colunas(REF_DB, REF_TB)
ordem = [n for n, _ in ref_dados] + [n for n, _ in ref_parts]
tipos = dict(ref_dados + ref_parts)
print(f"-- referencia: {len(ref_dados)} colunas + {len(ref_parts)} particao = {len(ordem)}",
      file=sys.stderr)
assert FALTANTE in ordem, FALTANTE
assert tipos[FALTANTE] == "string", tipos[FALTANTE]

# Confere que as tabelas completas batem exatamente com a referencia.
for db, tb in COMPLETAS:
    d, p = colunas(db, tb)
    atual = [n for n, _ in d] + [n for n, _ in p]
    if atual != ordem:
        print(f"ERRO: {db}.{tb} divergente da referencia", file=sys.stderr)
        print(f"  faltando: {set(ordem) - set(atual)}", file=sys.stderr)
        print(f"  extras  : {set(atual) - set(ordem)}", file=sys.stderr)
        sys.exit(1)

# Confere que as incompletas so diferem pela coluna esperada.
esperado = [n for n in ordem if n != FALTANTE]
for db, tb in SEM_RESOURCE:
    d, p = colunas(db, tb)
    atual = [n for n, _ in d] + [n for n, _ in p]
    if atual != esperado:
        print(f"ERRO: {db}.{tb} nao difere apenas por {FALTANTE}", file=sys.stderr)
        print(f"  faltando: {set(esperado) - set(atual)}", file=sys.stderr)
        print(f"  extras  : {set(atual) - set(esperado)}", file=sys.stderr)
        sys.exit(1)
print("-- todas as 4 tabelas conferidas", file=sys.stderr)


def cita(db, tb):
    return f'"{db}".{tb}' if "-" in db else f"{db}.{tb}"


def braco(db, tb, completa):
    linhas = []
    for n in ordem:
        if n == FALTANTE and not completa:
            # NULL tipado: mantem posicao e tipo, sinaliza ausencia de dado.
            linhas.append(f"  CAST(NULL AS varchar) AS {n}")
        else:
            linhas.append(f"  {n}")
    return "SELECT\n" + ",\n".join(linhas) + f"\nFROM {cita(db, tb)}"


bracos = ([braco(d, t, True) for d, t in COMPLETAS] +
          [braco(d, t, False) for d, t in SEM_RESOURCE])
print("CREATE OR REPLACE VIEW finops.cur_raw AS\n" +
      "\nUNION ALL\n".join(bracos))
