import { describe, expect, it } from "vitest";

import type { Celula } from "./colunas";
import {
  BOM,
  celulaCSV,
  citarCSV,
  dataCSV,
  linhaCSV,
  linhaMetadadoCSV,
  numeroCSV,
  protegerFormula,
} from "./csv";

describe("protecao contra injecao de formula", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tvalor", "\rvalor"])(
    "prefixa %j com apostrofo",
    (entrada) => {
      expect(protegerFormula(entrada)).toBe(`'${entrada}`);
    },
  );

  it("neutraliza a formula de execucao de comando conhecida do Excel", () => {
    // O vetor classico: se o Excel avaliar isto, executa um programa na maquina
    // de quem abriu o arquivo.
    const ataque = `=cmd|'/c calc'!A1`;
    expect(protegerFormula(ataque).startsWith("'")).toBe(true);
  });

  it("nao mexe em texto comum", () => {
    expect(protegerFormula("AmazonEC2")).toBe("AmazonEC2");
    expect(protegerFormula("us-east-1b")).toBe("us-east-1b");
  });

  it("nao transforma numero negativo em texto", () => {
    // Credito da AWS chega como valor negativo. Se `-12,34` virasse `'-12,34`,
    // a coluna pararia de somar no Excel -- e a soma e o motivo de exportar.
    const credito: Celula = { tipo: "numero", valor: -12.34, casas: 6 };
    expect(celulaCSV(credito)).toBe("-12,340000");
  });
});

describe("citacao", () => {
  it("cita quando ha separador", () => {
    expect(citarCSV("a;b")).toBe('"a;b"');
  });

  it("dobra aspas internas", () => {
    expect(citarCSV('diz "ola"')).toBe('"diz ""ola"""');
  });

  it("cita quebra de linha", () => {
    expect(citarCSV("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });

  it("cita espaco na ponta, para o valor exportado ser igual ao armazenado", () => {
    expect(citarCSV(" AmazonEC2 ")).toBe('" AmazonEC2 "');
  });

  it("deixa texto simples sem aspas", () => {
    expect(citarCSV("AmazonEC2")).toBe("AmazonEC2");
  });
});

describe("numeros em pt-BR", () => {
  it("usa virgula decimal", () => {
    expect(numeroCSV(597.28, 6)).toBe("597,280000");
  });

  it("nao usa separador de milhar", () => {
    // Com separador de milhar, o Excel em locale diferente leria 1.234 como 1234
    // ou como texto -- depende da configuracao de quem abre.
    expect(numeroCSV(1234567.5, 2)).toBe("1234567,50");
  });

  it("preserva a escala de 6 casas de numeric(18,6)", () => {
    // Ha lancamentos de US$ 0,000001 na base. Com 2 casas eles virariam zero.
    expect(numeroCSV(0.000001, 6)).toBe("0,000001");
  });

  it("cotacao sai com 4 casas, como o Banco Central publica", () => {
    expect(numeroCSV(5.1285, 4)).toBe("5,1285");
  });
});

describe("celulas", () => {
  it("data de calendario vira dd/mm/aaaa sem passar por Date", () => {
    // `new Date("2026-08-01")` e meia-noite UTC: formatado em Sao_Paulo voltaria
    // como 31/07. Por isso a conversao e textual.
    expect(dataCSV("2026-08-01")).toBe("01/08/2026");
    expect(celulaCSV({ tipo: "data", valor: "2026-01-31" })).toBe("31/01/2026");
  });

  it("valor nulo vira celula vazia, nunca zero", () => {
    expect(celulaCSV({ tipo: "numero", valor: null, casas: 6 })).toBe("");
    expect(celulaCSV({ tipo: "texto", valor: null })).toBe("");
    expect(celulaCSV({ tipo: "data", valor: null })).toBe("");
  });

  it("texto perigoso e protegido E citado", () => {
    expect(celulaCSV({ tipo: "texto", valor: "=A1;B2" })).toBe(`"'=A1;B2"`);
  });
});

describe("linhas", () => {
  it("junta com ponto-e-virgula e termina com CRLF", () => {
    expect(linhaCSV(["a", "b"])).toBe("a;b\r\n");
  });

  it("linha vazia produz apenas a quebra", () => {
    expect(linhaCSV([])).toBe("\r\n");
  });

  it("metadado sai comentado, para pandas/R pularem com comment='#'", () => {
    expect(linhaMetadadoCSV("Período da consulta", "01/08/2026 a 11/08/2026")).toBe(
      "# Período da consulta;01/08/2026 a 11/08/2026\r\n",
    );
  });

  it("metadado com valor perigoso tambem e protegido", () => {
    // O bloco carrega nome de conta (do banco) e termo de busca (do usuario).
    expect(linhaMetadadoCSV("Contas", "=HYPERLINK(1)")).toBe(
      "# Contas;'=HYPERLINK(1)\r\n",
    );
  });
});

describe("codificacao", () => {
  it("o BOM e exatamente U+FEFF", () => {
    // Sem ele o Excel do Windows abre como ANSI e "Serviço" vira "Serviço".
    expect(BOM).toBe("\uFEFF");
    expect(BOM).toHaveLength(1);
  });

  it("o BOM em UTF-8 sao os tres bytes que o Excel procura", () => {
    expect([...new TextEncoder().encode(BOM)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
