import { describe, expect, it } from "vitest";

import {
  contarDias,
  ehDataISOValida,
  hojeEm,
  janelaAnterior,
  resolverPeriodo,
  somarDias,
  somarMeses,
  ultimoDiaDoMes,
  type ContextoTemporal,
} from "./periodo";

/**
 * O contexto reproduz o estado real da base em 06/08/2026: existe usage_date em
 * setembro (cobranca anual lancada adiantado) e a carga mais recente e do dia 05.
 */
const CONTEXTO: ContextoTemporal = {
  hoje: "2026-08-06",
  maiorDataComDado: "2026-09-04",
};

describe("aritmetica de data de calendario", () => {
  it("nao desloca o dia por causa do fuso do processo", () => {
    // O bug que motivou tratar data como string: em UTC-3, transformar
    // "2026-08-01" em Date e formatar em UTC devolvia 31/07.
    expect(somarDias("2026-08-01", 0)).toBe("2026-08-01");
    expect(somarDias("2026-08-01", -1)).toBe("2026-07-31");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("conta dias de forma inclusiva", () => {
    expect(contarDias("2026-08-01", "2026-08-01")).toBe(1);
    expect(contarDias("2026-08-01", "2026-08-31")).toBe(31);
  });

  it("resolve fim de mes e ano bissexto", () => {
    expect(ultimoDiaDoMes("2026-02-10")).toBe("2026-02-28");
    expect(ultimoDiaDoMes("2028-02-10")).toBe("2028-02-29");
    expect(ultimoDiaDoMes("2026-08-01")).toBe("2026-08-31");
  });

  it("ao voltar um mes, encaixa o dia 31 no ultimo dia do mes destino", () => {
    expect(somarMeses("2026-03-31", -1)).toBe("2026-02-28");
    expect(somarMeses("2026-08-06", -1)).toBe("2026-07-06");
  });

  it("rejeita data que nao existe", () => {
    expect(ehDataISOValida("2026-02-30")).toBe(false);
    expect(ehDataISOValida("2026-13-01")).toBe(false);
    expect(ehDataISOValida("06/08/2026")).toBe(false);
    expect(ehDataISOValida("2026-08-06")).toBe(true);
  });

  it("calcula hoje no fuso pedido, nao no do processo", () => {
    expect(hojeEm("America/Sao_Paulo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 23:00 em Sao Paulo ja e o dia seguinte em UTC: os dois nao podem ser
    // iguais por construcao, so por coincidencia de horario.
    expect(hojeEm("Pacific/Kiritimati") >= hojeEm("Pacific/Midway")).toBe(true);
  });
});

describe("periodo padrao", () => {
  it("vai do primeiro dia do mes ate o dia mais recente exibivel", () => {
    const p = resolverPeriodo({}, CONTEXTO);
    expect(p.preset).toBe("mes-atual");
    expect(p.de).toBe("2026-08-01");
    expect(p.ate).toBe("2026-08-06");
  });

  it("nunca ultrapassa hoje, mesmo com usage_date no futuro", () => {
    // max(usage_date) e 04/09 -- se entrasse cru, o "mes atual" incluiria setembro.
    const p = resolverPeriodo({}, CONTEXTO);
    expect(p.ate <= CONTEXTO.hoje).toBe(true);
    expect(p.existeDadoAlemDaJanela).toBe(true);
  });

  it("encurta a janela ate a ultima carga quando o ETL esta atrasado", () => {
    const p = resolverPeriodo({}, { hoje: "2026-08-20", maiorDataComDado: "2026-08-05" });
    expect(p.ate).toBe("2026-08-05");
    expect(p.limitadoPorDadoDisponivel).toBe(true);
  });

  it("nao inverte a janela quando a ultima carga e de antes do mes corrente", () => {
    const p = resolverPeriodo({}, { hoje: "2026-08-06", maiorDataComDado: "2026-07-31" });
    expect(p.de).toBe("2026-08-01");
    expect(p.ate).toBe("2026-08-01");
    expect(p.dias).toBe(1);
  });

  it("funciona com a base vazia", () => {
    const p = resolverPeriodo({}, { hoje: "2026-08-06", maiorDataComDado: null });
    expect(p.de).toBe("2026-08-01");
    expect(p.ate).toBe("2026-08-06");
    expect(p.existeDadoAlemDaJanela).toBe(false);
  });
});

describe("presets", () => {
  it("7d e 30d terminam hoje", () => {
    expect(resolverPeriodo({ preset: "7d" }, CONTEXTO)).toMatchObject({
      de: "2026-07-31",
      ate: "2026-08-06",
      dias: 7,
    });
    expect(resolverPeriodo({ preset: "30d" }, CONTEXTO)).toMatchObject({
      de: "2026-07-08",
      ate: "2026-08-06",
      dias: 30,
    });
  });

  it("mes-anterior cobre o mes fechado inteiro", () => {
    expect(resolverPeriodo({ preset: "mes-anterior" }, CONTEXTO)).toMatchObject({
      de: "2026-07-01",
      ate: "2026-07-31",
      dias: 31,
    });
  });

  it("personalizado usa exatamente as datas informadas", () => {
    const p = resolverPeriodo(
      { preset: "personalizado", de: "2026-07-10", ate: "2026-07-20" },
      CONTEXTO,
    );
    expect(p).toMatchObject({ de: "2026-07-10", ate: "2026-07-20", dias: 11 });
  });

  it("deduz personalizado quando so vem de/ate", () => {
    const p = resolverPeriodo({ de: "2026-07-10", ate: "2026-07-20" }, CONTEXTO);
    expect(p.preset).toBe("personalizado");
  });
});

describe("janela de comparacao", () => {
  it("mes em curso compara com o mesmo intervalo do mes anterior", () => {
    // 01-06/08 contra 01-06/07: responde "como estamos no mesmo ponto do mes
    // passado". Deslocar por 6 dias compararia com o fim de julho.
    expect(janelaAnterior("mes-atual", "2026-08-01", "2026-08-06")).toEqual({
      de: "2026-07-01",
      ate: "2026-07-06",
      dias: 6,
    });
  });

  it("mes fechado compara com o mes fechado anterior inteiro", () => {
    expect(janelaAnterior("mes-anterior", "2026-07-01", "2026-07-31")).toEqual({
      de: "2026-06-01",
      ate: "2026-06-30",
      dias: 30,
    });
  });

  it("mes de 31 dias comparado com mes de 28 nao vaza para marco", () => {
    expect(janelaAnterior("mes-atual", "2026-03-01", "2026-03-31")).toEqual({
      de: "2026-02-01",
      ate: "2026-02-28",
      dias: 28,
    });
  });

  it("janela de N dias compara com os N dias imediatamente anteriores", () => {
    expect(janelaAnterior("7d", "2026-07-31", "2026-08-06")).toEqual({
      de: "2026-07-24",
      ate: "2026-07-30",
      dias: 7,
    });
  });

  it("nao deixa buraco nem sobreposicao entre as duas janelas", () => {
    const p = resolverPeriodo({ preset: "30d" }, CONTEXTO);
    expect(somarDias(p.anterior.ate, 1)).toBe(p.de);
    expect(p.anterior.dias).toBe(p.dias);
  });
});
