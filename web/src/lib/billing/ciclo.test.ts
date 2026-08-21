import { describe, expect, it } from "vitest";

import {
  calcularCiclo,
  calcularVencimento,
  competenciaDaFaturaFechada,
  descreverFechada,
  type ConfiguracaoDeFatura,
} from "./ciclo";

/**
 * Estas contas decidem o que a tela AFIRMA sobre prazo. Errar aqui nao quebra
 * nada visivelmente: a tela apenas passa a dizer "fecha em 3 dias" no dia
 * errado, e quem depende do aviso descobre pela cobranca.
 */

const cfg = (
  fechamento: number | null,
  vencimento: number | null = null,
  aviso = 5,
): ConfiguracaoDeFatura => ({
  diaDeFechamento: fechamento,
  diaDeVencimento: vencimento,
  diasDeAviso: aviso,
});

describe("calcularCiclo -- sem configuracao", () => {
  it("nao inventa calendario para conta sem dia de fechamento", () => {
    const c = calcularCiclo(cfg(null), "2026-08-14");
    expect(c.situacao).toBe("sem_configuracao");
    expect(c.proximoFechamento).toBeNull();
    expect(c.diasParaFechar).toBeNull();
    expect(c.descricao).toBe("Sem dia de fechamento configurado");
  });
});

describe("calcularCiclo -- quanto falta", () => {
  it("conta os dias ate o fechamento do mes corrente", () => {
    const c = calcularCiclo(cfg(25), "2026-08-14");
    expect(c.proximoFechamento).toBe("2026-08-25");
    expect(c.diasParaFechar).toBe(11);
    expect(c.situacao).toBe("aberta");
    expect(c.descricao).toBe("Fatura fecha em 11 dias");
  });

  it("entra em 'fecha em breve' dentro da antecedencia configurada", () => {
    expect(calcularCiclo(cfg(25, null, 5), "2026-08-19").situacao).toBe("aberta");
    expect(calcularCiclo(cfg(25, null, 5), "2026-08-20").situacao).toBe("fecha_em_breve");
    expect(calcularCiclo(cfg(25, null, 5), "2026-08-24").situacao).toBe("fecha_em_breve");
  });

  it("respeita uma antecedencia diferente por conta", () => {
    expect(calcularCiclo(cfg(25, null, 0), "2026-08-24").situacao).toBe("aberta");
    expect(calcularCiclo(cfg(25, null, 0), "2026-08-25").situacao).toBe("fecha_hoje");
    expect(calcularCiclo(cfg(25, null, 15), "2026-08-14").situacao).toBe("fecha_em_breve");
  });

  it("usa singular no dia anterior ao fechamento", () => {
    expect(calcularCiclo(cfg(25), "2026-08-24").descricao).toBe("Fatura fecha em 1 dia");
  });

  it("reconhece o dia do fechamento", () => {
    const c = calcularCiclo(cfg(25), "2026-08-25");
    expect(c.situacao).toBe("fecha_hoje");
    expect(c.diasParaFechar).toBe(0);
    expect(c.descricao).toBe("Fatura fecha hoje");
  });

  it("depois do fechamento, aponta para o mes seguinte", () => {
    const c = calcularCiclo(cfg(25), "2026-08-26");
    expect(c.proximoFechamento).toBe("2026-09-25");
    expect(c.ultimoFechamento).toBe("2026-08-25");
    expect(c.diasDesdeFechamento).toBe(1);
  });

  it("atravessa a virada do ano", () => {
    const c = calcularCiclo(cfg(10), "2026-12-20");
    expect(c.proximoFechamento).toBe("2027-01-10");
    expect(c.ultimoFechamento).toBe("2026-12-10");
  });
});

describe("calcularCiclo -- o dia 31", () => {
  it("encurta o fechamento ao ultimo dia de fevereiro", () => {
    // Sem isto, a conta configurada para o dia 31 ficaria sem fechamento em
    // fevereiro, abril, junho, setembro e novembro.
    const c = calcularCiclo(cfg(31), "2026-02-20");
    expect(c.proximoFechamento).toBe("2026-02-28");
    expect(c.diasParaFechar).toBe(8);
  });

  it("acerta fevereiro de ano bissexto", () => {
    expect(calcularCiclo(cfg(31), "2028-02-10").proximoFechamento).toBe("2028-02-29");
  });

  it("volta ao dia 31 no mes seguinte que o tem", () => {
    const c = calcularCiclo(cfg(31), "2026-03-01");
    expect(c.ultimoFechamento).toBe("2026-02-28");
    expect(c.proximoFechamento).toBe("2026-03-31");
  });

  it("no dia 28 de fevereiro, uma conta de dia 31 fecha HOJE", () => {
    expect(calcularCiclo(cfg(31), "2026-02-28").situacao).toBe("fecha_hoje");
  });
});

describe("calcularVencimento", () => {
  it("fica no mesmo mes quando o vencimento e depois do fechamento", () => {
    expect(calcularVencimento(cfg(5, 20), "2026-08-05")).toBe("2026-08-20");
  });

  it("vai para o mes seguinte quando o vencimento e ANTES do fechamento", () => {
    // A configuracao mais comum do mercado. Sem esta regra, a fatura que fecha
    // dia 25 e vence dia 10 venceria quinze dias antes de existir, e a tela
    // chamaria de vencida toda fatura recem-fechada.
    expect(calcularVencimento(cfg(25, 10), "2026-08-25")).toBe("2026-09-10");
  });

  it("vencimento no MESMO dia do fechamento e entendido como mes seguinte", () => {
    expect(calcularVencimento(cfg(10, 10), "2026-08-10")).toBe("2026-09-10");
  });

  it("encurta tambem o vencimento em mes curto", () => {
    expect(calcularVencimento(cfg(25, 31), "2026-01-25")).toBe("2026-01-31");
    expect(calcularVencimento(cfg(5, 31), "2026-02-05")).toBe("2026-02-28");
  });

  it("devolve null sem dia de vencimento configurado", () => {
    expect(calcularVencimento(cfg(25, null), "2026-08-25")).toBeNull();
  });

  it("atravessa a virada do ano", () => {
    expect(calcularVencimento(cfg(25, 10), "2026-12-25")).toBe("2027-01-10");
  });
});

describe("descreverFechada", () => {
  it("descreve o tempo desde o ultimo fechamento", () => {
    expect(descreverFechada(calcularCiclo(cfg(10), "2026-08-14"))).toBe(
      "Fatura fechou há 4 dias",
    );
    expect(descreverFechada(calcularCiclo(cfg(10), "2026-08-11"))).toBe(
      "Fatura fechou há 1 dia",
    );
  });

  it("diz 'hoje' quando o fechamento foi hoje -- e o ciclo ja e o proximo", () => {
    // No dia 10 o ciclo esta FECHANDO, entao o ultimo fechamento e o do mes
    // anterior. A frase de "fechou hoje" so aparece no dia seguinte ao virar.
    const c = calcularCiclo(cfg(10), "2026-08-10");
    expect(c.situacao).toBe("fecha_hoje");
    expect(c.ultimoFechamento).toBe("2026-07-10");
  });

  it("devolve null sem configuracao", () => {
    expect(descreverFechada(calcularCiclo(cfg(null), "2026-08-14"))).toBeNull();
  });
});

describe("competenciaDaFaturaFechada", () => {
  it("devolve o mes da fatura ja fechada", () => {
    expect(competenciaDaFaturaFechada(calcularCiclo(cfg(10), "2026-08-14"))).toBe("2026-08");
    expect(competenciaDaFaturaFechada(calcularCiclo(cfg(20), "2026-08-14"))).toBe("2026-07");
  });
});
