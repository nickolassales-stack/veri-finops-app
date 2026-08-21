import { describe, expect, it } from "vitest";

import {
  passouDaHora,
  proximaEsperada,
  ultimaEsperada,
  type AgendaEtl,
} from "./agenda";

/**
 * O que estes testes protegem
 * ---------------------------
 * O cron da EC2 e `0 8 * * *` com o servidor em UTC -- ou seja, 05:00 em Sao
 * Paulo. Trocar um fuso pelo outro nao quebra nada visivelmente: a tela apenas
 * passa a afirmar um horario errado, e ninguem descobre ate o dia em que a
 * carga falha e o alerta nao aparece.
 *
 * Por isso os casos abaixo usam instantes exatos em volta da virada.
 */

// A agenda real de producao.
const PRODUCAO: AgendaEtl = {
  hora: 8,
  minuto: 0,
  fuso: "Etc/UTC",
  toleranciaMinutos: 90,
};

// A mesma hora, mas declarada no fuso de Sao Paulo -- o que muita gente supoe
// que esteja configurado.
const SAO_PAULO: AgendaEtl = { ...PRODUCAO, fuso: "America/Sao_Paulo" };

describe("ultimaEsperada", () => {
  it("devolve o horario de hoje quando ele ja passou", () => {
    const agora = new Date("2026-08-14T15:51:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-14T08:00:00.000Z");
  });

  it("devolve o horario de ONTEM quando o de hoje ainda nao chegou", () => {
    const agora = new Date("2026-08-14T07:59:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-13T08:00:00.000Z");
  });

  it("aceita o instante exato do agendamento como ja esperado", () => {
    const agora = new Date("2026-08-14T08:00:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-14T08:00:00.000Z");
  });

  it("separa 08:00 UTC de 08:00 em Sao Paulo -- as tres horas que importam", () => {
    const agora = new Date("2026-08-14T15:00:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-14T08:00:00.000Z");
    // 08:00 em Sao Paulo e 11:00 UTC.
    expect(ultimaEsperada(SAO_PAULO, agora).toISOString()).toBe("2026-08-14T11:00:00.000Z");
  });

  it("atravessa a virada do mes sem inventar dia 0", () => {
    const agora = new Date("2026-09-01T02:00:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-31T08:00:00.000Z");
  });

  it("atravessa a virada do ano", () => {
    const agora = new Date("2027-01-01T03:00:00Z");
    expect(ultimaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-12-31T08:00:00.000Z");
  });
});

describe("proximaEsperada", () => {
  it("e sempre estritamente no futuro", () => {
    const agora = new Date("2026-08-14T08:00:00Z");
    expect(proximaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-15T08:00:00.000Z");
  });

  it("devolve o horario de hoje quando ele ainda nao chegou", () => {
    const agora = new Date("2026-08-14T05:00:00Z");
    expect(proximaEsperada(PRODUCAO, agora).toISOString()).toBe("2026-08-14T08:00:00.000Z");
  });

  it("nunca coincide com a ultima esperada", () => {
    for (const hora of [0, 7, 8, 9, 12, 23]) {
      const agora = new Date(`2026-08-14T${String(hora).padStart(2, "0")}:30:00Z`);
      expect(proximaEsperada(PRODUCAO, agora).getTime()).toBeGreaterThan(
        ultimaEsperada(PRODUCAO, agora).getTime(),
      );
      expect(proximaEsperada(PRODUCAO, agora).getTime()).toBeGreaterThan(agora.getTime());
    }
  });

  it("respeita horario de verao no fuso do agendamento", () => {
    // Nova York entra no horario de verao em 08/03/2026. As 08:00 locais mudam
    // de 13:00 para 12:00 UTC -- somar 24h em ms erraria por uma hora aqui.
    const nova_york: AgendaEtl = { ...PRODUCAO, fuso: "America/New_York" };
    const antes = new Date("2026-03-07T14:00:00Z"); // sabado, 09:00 EST
    expect(proximaEsperada(nova_york, antes).toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });
});

describe("passouDaHora", () => {
  it("nao acusa atraso dentro da tolerancia", () => {
    expect(passouDaHora(PRODUCAO, new Date("2026-08-14T09:29:00Z"))).toBe(false);
  });

  it("acusa atraso depois da tolerancia", () => {
    expect(passouDaHora(PRODUCAO, new Date("2026-08-14T09:31:00Z"))).toBe(true);
  });

  it("de madrugada, cobra a carga de ONTEM -- e ela ja passou da tolerancia", () => {
    // 03:00 UTC de dia 14: a carga devida e a das 08:00 do dia 13.
    expect(passouDaHora(PRODUCAO, new Date("2026-08-14T03:00:00Z"))).toBe(true);
  });
});
