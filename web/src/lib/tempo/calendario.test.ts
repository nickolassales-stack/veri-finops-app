import { describe, expect, it } from "vitest";

import {
  dataDoMes,
  diaEm,
  diaValidoDoMes,
  diasEntre,
  mesCorrente,
  mesesEntre,
  mesmoDia,
  somarMeses,
  ultimoDiaDoMes,
} from "./calendario";

/**
 * Estas contas decidem duas afirmacoes de producao: "o ETL ja deveria ter
 * rodado" e "a fatura ja fechou". As duas erram em silencio -- a tela nao
 * quebra, so passa a dizer outra coisa --, e por isso os casos abaixo usam
 * instantes exatos em volta das viradas de dia, de mes e de ano.
 */

describe("mesmoDia e diaEm", () => {
  it("compara pelo calendario do fuso indicado, nao pelo do servidor", () => {
    const a = new Date("2026-08-14T02:00:00Z"); // 13/08 23:00 em Sao Paulo
    const b = new Date("2026-08-14T15:00:00Z"); // 14/08 12:00 em Sao Paulo

    expect(mesmoDia("Etc/UTC", a, b)).toBe(true);
    expect(mesmoDia("America/Sao_Paulo", a, b)).toBe(false);

    expect(diaEm("Etc/UTC", a)).toBe("2026-08-14");
    expect(diaEm("America/Sao_Paulo", a)).toBe("2026-08-13");
  });

  it("trata a meia-noite como 00h do proprio dia, e nao 24h do anterior", () => {
    const meiaNoite = new Date("2026-08-14T03:00:00Z"); // 00:00 em Sao Paulo
    expect(diaEm("America/Sao_Paulo", meiaNoite)).toBe("2026-08-14");
  });
});

describe("mesCorrente", () => {
  it("devolve o primeiro dia do mes no fuso da tela", () => {
    // 01/09 00:30 UTC ainda e 31/08 em Sao Paulo.
    const instante = new Date("2026-09-01T00:30:00Z");
    expect(mesCorrente("Etc/UTC", instante)).toBe("2026-09-01");
    expect(mesCorrente("America/Sao_Paulo", instante)).toBe("2026-08-01");
  });
});

describe("diasEntre", () => {
  it("conta dias de calendario, sem fuso no meio", () => {
    expect(diasEntre("2026-08-10", "2026-08-14")).toBe(4);
    expect(diasEntre("2026-08-14", "2026-08-14")).toBe(0);
    expect(diasEntre("2026-02-27", "2026-03-01")).toBe(2); // 2026 nao e bissexto
    expect(diasEntre("2026-08-20", "2026-08-14")).toBe(-6);
  });
});

describe("mesesEntre", () => {
  it("inclui as duas pontas", () => {
    expect(mesesEntre("2026-07-01", "2026-09-01")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("atravessa a virada do ano", () => {
    expect(mesesEntre("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("devolve um unico mes quando as pontas coincidem", () => {
    expect(mesesEntre("2026-08-01", "2026-08-31")).toEqual(["2026-08"]);
  });

  it("devolve vazio quando o fim antecede o inicio, em vez de girar sem parar", () => {
    expect(mesesEntre("2026-09", "2026-07")).toEqual([]);
  });
});

describe("ultimoDiaDoMes", () => {
  it("conhece os meses de 30 e 31 dias", () => {
    expect(ultimoDiaDoMes(2026, 1)).toBe(31);
    expect(ultimoDiaDoMes(2026, 4)).toBe(30);
    expect(ultimoDiaDoMes(2026, 12)).toBe(31);
  });

  it("acerta fevereiro nos dois casos", () => {
    expect(ultimoDiaDoMes(2026, 2)).toBe(28);
    expect(ultimoDiaDoMes(2028, 2)).toBe(29); // bissexto
    expect(ultimoDiaDoMes(2100, 2)).toBe(28); // secular nao bissexto
    expect(ultimoDiaDoMes(2000, 2)).toBe(29); // secular bissexto
  });
});

describe("diaValidoDoMes", () => {
  it("mantem o dia quando ele existe no mes", () => {
    expect(diaValidoDoMes(2026, 8, 15)).toBe(15);
    expect(diaValidoDoMes(2026, 8, 31)).toBe(31);
  });

  it("encurta o dia 31 ao ultimo dia do mes curto", () => {
    // A regra de fevereiro: a fatura precisa fechar em ALGUM dia. Empurrar para
    // 1o de marco mudaria a fatura de mes; ignorar deixaria a conta sem
    // fechamento quatro vezes por ano.
    expect(diaValidoDoMes(2026, 2, 31)).toBe(28);
    expect(diaValidoDoMes(2028, 2, 30)).toBe(29);
    expect(diaValidoDoMes(2026, 4, 31)).toBe(30);
  });
});

describe("dataDoMes", () => {
  it("monta a data ja encurtada e com dois digitos", () => {
    expect(dataDoMes(2026, 2, 31)).toBe("2026-02-28");
    expect(dataDoMes(2026, 8, 5)).toBe("2026-08-05");
    expect(dataDoMes(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("somarMeses", () => {
  it("anda para frente e para tras atravessando o ano", () => {
    expect(somarMeses(2026, 12, 1)).toEqual([2027, 1]);
    expect(somarMeses(2026, 1, -1)).toEqual([2025, 12]);
    expect(somarMeses(2026, 8, 0)).toEqual([2026, 8]);
    expect(somarMeses(2026, 6, 12)).toEqual([2027, 6]);
  });
});
