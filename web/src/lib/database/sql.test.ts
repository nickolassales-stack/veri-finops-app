import { describe, expect, it } from "vitest";

import { ConstrutorParams, escaparLike, identificadorPermitido } from "./sql";

describe("ConstrutorParams", () => {
  it("numera os placeholders em ordem", () => {
    const p = new ConstrutorParams();
    expect(p.add("2026-08-01")).toBe("$1");
    expect(p.add("2026-08-06")).toBe("$2");
    expect(p.lista).toEqual(["2026-08-01", "2026-08-06"]);
  });

  it("mantem o valor fora do texto do SQL", () => {
    const p = new ConstrutorParams();
    const sql = `WHERE account_id = ${p.add("'; DROP TABLE cloud_accounts; --")}`;
    expect(sql).toBe("WHERE account_id = $1");
    expect(sql).not.toContain("DROP");
    expect(p.lista[0]).toBe("'; DROP TABLE cloud_accounts; --");
  });

  it("guarda array como um unico parametro (para = ANY)", () => {
    const p = new ConstrutorParams();
    expect(p.add(["a", "b", "c"])).toBe("$1");
    expect(p.quantidade).toBe(1);
  });
});

describe("identificadorPermitido", () => {
  const colunas = { custo: "total", nome: "account_name" } as const;

  it("aceita chave do mapa", () => {
    expect(identificadorPermitido("custo", colunas)).toBe(true);
  });

  it("recusa o que nao esta no mapa", () => {
    expect(identificadorPermitido("total", colunas)).toBe(false);
    expect(identificadorPermitido("custo; DROP TABLE x", colunas)).toBe(false);
  });

  it("nao se deixa enganar por propriedade herdada", () => {
    // `"toString" in obj` seria true e abriria caminho para o SQL.
    expect(identificadorPermitido("toString", colunas)).toBe(false);
    expect(identificadorPermitido("constructor", colunas)).toBe(false);
  });

  it("funciona tambem com lista", () => {
    expect(identificadorPermitido("asc", ["asc", "desc"] as const)).toBe(true);
    expect(identificadorPermitido("random()", ["asc", "desc"] as const)).toBe(false);
  });
});

describe("escaparLike", () => {
  it("neutraliza os curingas", () => {
    expect(escaparLike("100%")).toBe("100\\%");
    expect(escaparLike("a_b")).toBe("a\\_b");
  });

  it("escapa a barra invertida antes dos curingas", () => {
    // Se a ordem fosse outra, o escape do % seria desfeito pelo escape da barra.
    expect(escaparLike("a\\%b")).toBe("a\\\\\\%b");
  });

  it("deixa texto comum intacto", () => {
    expect(escaparLike("conta-piloto")).toBe("conta-piloto");
  });
});
