import { describe, expect, it } from "vitest";

import {
  MAX_MESES_PERIODO,
  contarMeses,
  ehMesISOValido,
  indiceDoMes,
  mesDe,
  mesDoIndice,
  mesesDaJanela,
  resolverPeriodoMensal,
  somarMeses,
} from "./periodo-mensal";

/**
 * Aritmetica de mes.
 *
 * O bug que motivou o indice absoluto foi real e custou 16 meses de dado: o
 * collector OVH calculava a janela com
 *
 *   ano - (1 se mes <= MESES % 12 senao 0)
 *
 * mexendo em ano e mes separadamente. A expressao devolvia sempre janeiro do
 * ano corrente, e a coleta importou 11 faturas em vez de 27 -- sem erro nenhum,
 * porque a data era valida. Os testes abaixo travam a virada de ano, que e onde
 * esse tipo de conta erra.
 */

describe("indice absoluto de mes", () => {
  it("ida e volta preserva o mes", () => {
    for (const mes of ["2024-01", "2025-12", "2026-08", "2030-06"]) {
      expect(mesDoIndice(indiceDoMes(mes))).toBe(mes);
    }
  });

  it("meses consecutivos tem indices consecutivos, inclusive na virada do ano", () => {
    expect(indiceDoMes("2026-01") - indiceDoMes("2025-12")).toBe(1);
    expect(indiceDoMes("2025-02") - indiceDoMes("2025-01")).toBe(1);
  });

  it("zero-padding no mes e no ano", () => {
    expect(mesDoIndice(indiceDoMes("2026-01"))).toBe("2026-01");
    expect(mesDoIndice(indiceDoMes("2026-09"))).toBe("2026-09");
  });
});

describe("somarMeses", () => {
  it("atravessa a virada do ano nos dois sentidos", () => {
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2025-12", 1)).toBe("2026-01");
  });

  it("voltar 12 meses cai no mesmo mes do ano anterior", () => {
    // A conta que o collector errava. Independe de qual mes seja.
    for (const mes of ["2026-01", "2026-06", "2026-08", "2026-12"]) {
      expect(somarMeses(mes, -12)).toBe(`${Number(mes.slice(0, 4)) - 1}-${mes.slice(5)}`);
    }
  });

  it("voltar 11 meses a partir de agosto/2026 cai em setembro/2025", () => {
    // O caso concreto da janela de 12 meses: a expressao antiga devolvia
    // 2026-01 aqui, perdendo os quatro meses de 2025.
    expect(somarMeses("2026-08", -11)).toBe("2025-09");
  });

  it("somar zero nao move", () => {
    expect(somarMeses("2026-08", 0)).toBe("2026-08");
  });
});

describe("contarMeses", () => {
  it("e inclusiva nas duas pontas", () => {
    expect(contarMeses("2026-08", "2026-08")).toBe(1);
    expect(contarMeses("2026-07", "2026-08")).toBe(2);
  });

  it("conta atravessando o ano", () => {
    expect(contarMeses("2025-09", "2026-08")).toBe(12);
    expect(contarMeses("2024-09", "2026-08")).toBe(24);
  });
});

describe("ehMesISOValido", () => {
  it("aceita mes real", () => {
    expect(ehMesISOValido("2026-01")).toBe(true);
    expect(ehMesISOValido("2026-12")).toBe(true);
  });

  it("recusa mes fora da faixa", () => {
    // Um regex de \d{2} aceitaria os dois. A faixa faz parte da validacao.
    expect(ehMesISOValido("2026-13")).toBe(false);
    expect(ehMesISOValido("2026-00")).toBe(false);
  });

  it("recusa formato de data completa e lixo", () => {
    expect(ehMesISOValido("2026-08-17")).toBe(false);
    expect(ehMesISOValido("2026/08")).toBe(false);
    expect(ehMesISOValido("")).toBe(false);
    expect(ehMesISOValido("agosto")).toBe(false);
  });
});

describe("mesDe", () => {
  it("extrai o mes de uma data completa", () => {
    expect(mesDe("2026-08-17")).toBe("2026-08");
  });

  it("e idempotente sobre um mes", () => {
    expect(mesDe("2026-08")).toBe("2026-08");
  });
});

describe("resolverPeriodoMensal", () => {
  const HOJE = "2026-08-17";

  it("12m termina no mes corrente e tem exatamente 12 meses", () => {
    const p = resolverPeriodoMensal("12m", HOJE);
    expect(p.ateMes).toBe("2026-08");
    expect(p.deMes).toBe("2025-09");
    expect(p.meses).toBe(12);
    expect(contarMeses(p.deMes, p.ateMes)).toBe(12);
  });

  it("6m e 24m tambem fecham a contagem", () => {
    expect(resolverPeriodoMensal("6m", HOJE)).toMatchObject({
      deMes: "2026-03",
      ateMes: "2026-08",
      meses: 6,
    });
    expect(resolverPeriodoMensal("24m", HOJE)).toMatchObject({
      deMes: "2024-09",
      ateMes: "2026-08",
      meses: 24,
    });
  });

  it("ano-atual comeca em janeiro do ano corrente", () => {
    const p = resolverPeriodoMensal("ano-atual", HOJE);
    expect(p.deMes).toBe("2026-01");
    expect(p.ateMes).toBe("2026-08");
    expect(p.meses).toBe(8);
  });

  it("personalizado usa os meses informados", () => {
    const p = resolverPeriodoMensal("personalizado", HOJE, "2025-01", "2025-06");
    expect(p).toMatchObject({ deMes: "2025-01", ateMes: "2025-06", meses: 6 });
  });

  it("NAO encurta a janela pelo mes corrente sem fatura", () => {
    // Deliberado, e diferente da AWS: na OVH a fatura chega dias depois do fim
    // do mes, entao o mes corrente legitimamente ainda nao tem `invoice`.
    // Cortar a janela ali esconderia justamente o mes que se quer ver aparecer.
    const p = resolverPeriodoMensal("12m", "2026-08-01");
    expect(p.ateMes).toBe("2026-08");
  });

  it("a janela anterior tem o MESMO tamanho e termina um mes antes", () => {
    const p = resolverPeriodoMensal("12m", HOJE);
    expect(p.anterior.ateMes).toBe("2025-08");
    expect(p.anterior.deMes).toBe("2024-09");
    expect(p.anterior.meses).toBe(p.meses);
  });

  it("a anterior de ano-atual tem 8 meses, nao 12", () => {
    // Comparar 8 meses de 2026 com o ano inteiro de 2025 daria variacao sempre
    // negativa -- o numero pareceria queda de custo quando e so janela menor.
    const p = resolverPeriodoMensal("ano-atual", HOJE);
    expect(p.anterior.meses).toBe(8);
    expect(p.anterior.ateMes).toBe("2025-12");
    expect(p.anterior.deMes).toBe("2025-05");
  });

  it("as duas janelas nao se sobrepoem", () => {
    for (const preset of ["6m", "12m", "24m", "ano-atual"] as const) {
      const p = resolverPeriodoMensal(preset, HOJE);
      expect(indiceDoMes(p.anterior.ateMes)).toBeLessThan(indiceDoMes(p.deMes));
    }
  });

  it("o rotulo acompanha o preset", () => {
    expect(resolverPeriodoMensal("12m", HOJE).rotulo).toBe("Últimos 12 meses");
  });
});

describe("mesesDaJanela", () => {
  it("devolve todos os meses, em ordem crescente", () => {
    const meses = mesesDaJanela({ deMes: "2025-11", ateMes: "2026-02", meses: 4 });
    expect(meses).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("janela de um mes devolve um item", () => {
    expect(mesesDaJanela({ deMes: "2026-08", ateMes: "2026-08", meses: 1 })).toEqual([
      "2026-08",
    ]);
  });

  it("o tamanho casa com o preset -- e o que preenche o buraco do grafico", () => {
    const p = resolverPeriodoMensal("12m", "2026-08-17");
    expect(mesesDaJanela(p)).toHaveLength(12);
  });
});

describe("teto de meses", () => {
  it("o maximo cobre cinco anos", () => {
    expect(MAX_MESES_PERIODO).toBe(60);
  });
});
