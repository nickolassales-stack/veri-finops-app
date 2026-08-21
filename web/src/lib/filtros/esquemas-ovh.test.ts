import { describe, expect, it } from "vitest";

import { esquemaDashboardOvh } from "./esquemas-ovh";

/**
 * Validacao da entrada da visao OVH.
 *
 * O resultado deste esquema e a UNICA coisa que a camada de query aceita, entao
 * o que passa aqui define o que chega ao banco. Dois pontos merecem teste
 * proprio:
 *
 * 1. O PADRAO DE `source` E `invoice`. Se ele fosse opcional, ausente teria de
 *    significar "somar as tres origens" -- que triplica o custo, porque o mesmo
 *    projeto no mesmo mes tem legitimamente linha em invoice, usage_current e
 *    usage_forecast.
 * 2. O periodo e em MESES. `?periodo=30d` (o vocabulario da AWS) tem de ser
 *    recusado, e nao silenciosamente ignorado -- ignorar mostraria 12 meses com
 *    "30d" ainda na URL, dizendo uma coisa enquanto a tela mostra outra.
 */

const ok = (entrada: Record<string, string | undefined>) => {
  const r = esquemaDashboardOvh.safeParse(entrada);
  if (!r.success) throw new Error(`esperava sucesso: ${r.error.issues[0]?.message}`);
  return r.data;
};

const falha = (entrada: Record<string, string | undefined>) => {
  const r = esquemaDashboardOvh.safeParse(entrada);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues;
};

describe("padroes", () => {
  it("entrada vazia rende 12 meses e origem invoice", () => {
    expect(ok({})).toMatchObject({ periodo: "12m", source: "invoice" });
  });

  it("origem ausente NUNCA vira 'todas as origens'", () => {
    // O ponto central: nao existe valor de `source` que signifique "some as
    // tres". A ausencia cai no custo realizado, explicito.
    const dados = ok({});
    expect(dados.source).toBe("invoice");
  });

  it("projeto ausente e undefined, nao string vazia", () => {
    // `""` como filtro buscaria pelo projeto de nome vazio -- que existe no
    // banco e significa "custo de fatura sem projeto". Confundir os dois faria
    // o filtro "todos" mostrar apenas a linha nao atribuida.
    expect(ok({}).projeto).toBeUndefined();
    expect(ok({ projeto: "" }).projeto).toBeUndefined();
    expect(ok({ projeto: "   " }).projeto).toBeUndefined();
  });
});

describe("periodo em meses", () => {
  it("aceita os presets mensais", () => {
    for (const periodo of ["6m", "12m", "24m", "ano-atual"]) {
      expect(ok({ periodo }).periodo).toBe(periodo);
    }
  });

  it("RECUSA os presets diarios da AWS", () => {
    for (const periodo of ["7d", "30d", "mes-atual", "mes-anterior"]) {
      expect(falha({ periodo })[0]?.message).toContain("Periodo deve ser um de");
    }
  });

  it("personalizado exige os dois meses", () => {
    expect(falha({ periodo: "personalizado" })[0]?.message).toContain(
      "exige os dois meses",
    );
    expect(falha({ periodo: "personalizado", deMes: "2026-01" })[0]?.path).toEqual([
      "ateMes",
    ]);
    expect(falha({ periodo: "personalizado", ateMes: "2026-01" })[0]?.path).toEqual([
      "deMes",
    ]);
  });

  it("meses soltos com preset nao-personalizado sao recusados", () => {
    // Aceitar em silencio mostraria a janela do preset com os meses ainda na
    // URL, contradizendo a tela.
    const issues = falha({ periodo: "12m", deMes: "2026-01", ateMes: "2026-06" });
    expect(issues[0]?.message).toContain("periodo=personalizado");
  });

  it("aceita intervalo valido", () => {
    expect(ok({ periodo: "personalizado", deMes: "2025-01", ateMes: "2025-12" })).toMatchObject(
      { deMes: "2025-01", ateMes: "2025-12" },
    );
  });

  it("recusa fim antes do inicio", () => {
    const issues = falha({
      periodo: "personalizado",
      deMes: "2026-06",
      ateMes: "2026-01",
    });
    expect(issues[0]?.path).toEqual(["ateMes"]);
  });

  it("aceita mes igual nas duas pontas -- janela de um mes", () => {
    expect(
      ok({ periodo: "personalizado", deMes: "2026-08", ateMes: "2026-08" }),
    ).toMatchObject({ deMes: "2026-08", ateMes: "2026-08" });
  });

  it("recusa janela acima do teto de 60 meses", () => {
    const issues = falha({
      periodo: "personalizado",
      deMes: "2000-01",
      ateMes: "2026-08",
    });
    expect(issues[0]?.message).toContain("excede o maximo");
  });

  it("recusa mes inexistente", () => {
    expect(
      falha({ periodo: "personalizado", deMes: "2026-13", ateMes: "2026-14" })[0]?.message,
    ).toContain("AAAA-MM");
  });

  it("recusa data completa no lugar do mes", () => {
    expect(
      falha({ periodo: "personalizado", deMes: "2026-01-15", ateMes: "2026-06-15" })
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("origem", () => {
  it("aceita as tres origens do catalogo", () => {
    for (const source of ["invoice", "usage_current", "usage_forecast"]) {
      expect(ok({ source }).source).toBe(source);
    }
  });

  it("recusa origem fora do catalogo", () => {
    expect(falha({ source: "todas" })[0]?.message).toContain("Origem OVH deve ser uma de");
    expect(falha({ source: "invoices" }).length).toBeGreaterThan(0);
    expect(falha({ source: "usage" }).length).toBeGreaterThan(0);
  });
});

describe("projeto", () => {
  it("aceita identificador da OVH", () => {
    expect(ok({ projeto: "abc123def456" }).projeto).toBe("abc123def456");
    expect(ok({ projeto: "proj-1_2.3" }).projeto).toBe("proj-1_2.3");
  });

  it("recusa caractere fora do conjunto permitido", () => {
    // O valor vai como parametro ($1), entao isto nao e barreira contra
    // injecao -- e limite de custo e mensagem clara.
    expect(falha({ projeto: "a b" }).length).toBeGreaterThan(0);
    expect(falha({ projeto: "a'b" }).length).toBeGreaterThan(0);
    expect(falha({ projeto: "a%" }).length).toBeGreaterThan(0);
  });

  it("recusa identificador longo demais", () => {
    expect(falha({ projeto: "a".repeat(121) })[0]?.message).toContain("muito longo");
  });
});

describe("moeda", () => {
  it("normaliza para maiuscula", () => {
    expect(ok({ moeda: "usd" }).moeda).toBe("USD");
  });

  it("ausente fica undefined -- o servidor escolhe a de maior volume", () => {
    expect(ok({}).moeda).toBeUndefined();
  });

  it("recusa codigo que nao seja ISO de 3 letras", () => {
    expect(falha({ moeda: "US" }).length).toBeGreaterThan(0);
    expect(falha({ moeda: "DOLAR" }).length).toBeGreaterThan(0);
    expect(falha({ moeda: "US$" }).length).toBeGreaterThan(0);
  });
});
