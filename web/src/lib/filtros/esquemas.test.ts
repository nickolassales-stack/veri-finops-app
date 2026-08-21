import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MAX_TAMANHO_PAGINA,
  REGIAO_NAO_INFORMADA,
  camposBusca,
  camposContas,
  camposOrdenacao,
  camposPaginacao,
  camposPeriodo,
  camposRegiao,
  lerParametros,
  regrasPeriodo,
} from "./esquemas";

const esquemaCusto = z
  .object({ ...camposPeriodo, ...camposContas, ...camposRegiao })
  .superRefine(regrasPeriodo);

const esquemaLista = z.object({
  ...camposBusca,
  ...camposPaginacao,
  ...camposOrdenacao(["nome", "custo"] as const, "custo"),
});

/** Atalho: valida e devolve o erro do primeiro campo que falhou. */
function erroDe(esquema: z.ZodType, entrada: unknown): string | null {
  const r = esquema.safeParse(entrada);
  return r.success ? null : (r.error.issues[0]?.message ?? "erro sem mensagem");
}

describe("filtro de periodo", () => {
  it("aceita a ausencia de parametro (usa o padrao mais adiante)", () => {
    expect(esquemaCusto.parse({})).toMatchObject({ contas: [] });
  });

  it("aceita cada preset previsto", () => {
    for (const preset of ["7d", "30d", "mes-atual", "mes-anterior"]) {
      expect(esquemaCusto.parse({ periodo: preset }).periodo).toBe(preset);
    }
  });

  it("recusa preset desconhecido, dizendo quais valem", () => {
    expect(erroDe(esquemaCusto, { periodo: "ultimo-ano" })).toMatch(
      /Periodo deve ser um de: 7d, 30d/,
    );
  });

  it("recusa data que nao existe no calendario", () => {
    expect(erroDe(esquemaCusto, { de: "2026-02-30", ate: "2026-03-01" })).toMatch(
      /data real/i,
    );
  });

  it("recusa formato de data brasileiro", () => {
    expect(erroDe(esquemaCusto, { de: "01/08/2026", ate: "05/08/2026" })).toMatch(
      /AAAA-MM-DD/,
    );
  });

  it("recusa intervalo invertido", () => {
    expect(erroDe(esquemaCusto, { de: "2026-08-10", ate: "2026-08-01" })).toMatch(
      /nao pode ser anterior/,
    );
  });

  it("exige as duas datas no periodo personalizado", () => {
    expect(erroDe(esquemaCusto, { periodo: "personalizado", de: "2026-08-01" })).toMatch(
      /duas datas/,
    );
    expect(erroDe(esquemaCusto, { ate: "2026-08-01" })).toMatch(/duas datas/);
  });

  it("recusa misturar preset com intervalo", () => {
    expect(erroDe(esquemaCusto, { periodo: "7d", de: "2026-08-01" })).toMatch(
      /personalizado/,
    );
  });

  it("recusa periodo acima do teto de dias", () => {
    expect(erroDe(esquemaCusto, { de: "2020-01-01", ate: "2026-08-01" })).toMatch(
      /excede o maximo/,
    );
  });

  it("aceita periodo longo mas dentro do teto", () => {
    expect(esquemaCusto.safeParse({ de: "2025-01-01", ate: "2026-08-01" }).success).toBe(
      true,
    );
  });
});

describe("filtro de contas", () => {
  it("ausente significa todas as contas", () => {
    expect(esquemaCusto.parse({}).contas).toEqual([]);
  });

  it('"todas" tambem significa todas as contas', () => {
    expect(esquemaCusto.parse({ contas: "todas" }).contas).toEqual([]);
    expect(esquemaCusto.parse({ contas: "TODAS" }).contas).toEqual([]);
  });

  it("aceita uma ou varias contas", () => {
    expect(esquemaCusto.parse({ contas: "800168045394" }).contas).toEqual([
      "800168045394",
    ]);
    expect(
      esquemaCusto.parse({ contas: "800168045394, 147997123577" }).contas,
    ).toEqual(["800168045394", "147997123577"]);
  });

  it("remove repeticao", () => {
    expect(esquemaCusto.parse({ contas: "111,111,222" }).contas).toEqual(["111", "222"]);
  });

  it("recusa id com caractere fora do permitido", () => {
    expect(erroDe(esquemaCusto, { contas: "800168045394; DROP TABLE" })).toMatch(
      /invalido/,
    );
    expect(erroDe(esquemaCusto, { contas: "' OR 1=1 --" })).toMatch(/invalido/);
  });

  it("recusa id maior que a coluna varchar(20)", () => {
    expect(erroDe(esquemaCusto, { contas: "1".repeat(21) })).toMatch(/invalido/);
  });

  it("recusa lista acima do teto", () => {
    const muitas = Array.from({ length: 51 }, (_, i) => `conta${i}`).join(",");
    expect(erroDe(esquemaCusto, { contas: muitas })).toMatch(/Maximo de 50/);
  });
});

describe("filtro de regiao", () => {
  it("ausente nao filtra", () => {
    expect(esquemaCusto.parse({}).regiao).toBeUndefined();
  });

  it("aceita zona de disponibilidade como esta na base", () => {
    expect(esquemaCusto.parse({ regiao: "us-east-1b" }).regiao).toBe("us-east-1b");
  });

  it('traduz o "nan" do ETL para o sentinela de nao informado', () => {
    expect(esquemaCusto.parse({ regiao: "nan" }).regiao).toBe(REGIAO_NAO_INFORMADA);
    expect(esquemaCusto.parse({ regiao: REGIAO_NAO_INFORMADA }).regiao).toBe(
      REGIAO_NAO_INFORMADA,
    );
  });

  it("recusa caractere fora do permitido", () => {
    expect(erroDe(esquemaCusto, { regiao: "us-east-1'; --" })).toMatch(/invalida/i);
  });
});

describe("paginacao", () => {
  it("aplica o padrao quando nao vem nada", () => {
    expect(esquemaLista.parse({})).toMatchObject({ pagina: 1, tamanho: 50 });
  });

  it("converte texto da query string em numero", () => {
    expect(esquemaLista.parse({ pagina: "3", tamanho: "10" })).toMatchObject({
      pagina: 3,
      tamanho: 10,
    });
  });

  it("recusa pagina zero, negativa ou fracionaria", () => {
    for (const pagina of ["0", "-1", "1.5"]) {
      expect(esquemaLista.safeParse({ pagina }).success).toBe(false);
    }
  });

  it("recusa tamanho acima do teto", () => {
    expect(esquemaLista.safeParse({ tamanho: String(MAX_TAMANHO_PAGINA + 1) }).success).toBe(
      false,
    );
  });

  it("recusa texto que nao e numero", () => {
    expect(esquemaLista.safeParse({ pagina: "abc" }).success).toBe(false);
  });
});

describe("ordenacao", () => {
  it("aplica campo e direcao padrao", () => {
    expect(esquemaLista.parse({})).toMatchObject({
      ordenarPor: "custo",
      direcao: "desc",
    });
  });

  it("aceita apenas campos da lista fechada", () => {
    expect(esquemaLista.parse({ ordenarPor: "nome" }).ordenarPor).toBe("nome");
    // Sem a lista fechada isso viraria texto dentro do ORDER BY.
    expect(esquemaLista.safeParse({ ordenarPor: "cost_amount" }).success).toBe(false);
    expect(
      esquemaLista.safeParse({ ordenarPor: "nome; DROP TABLE cloud_accounts" }).success,
    ).toBe(false);
  });

  it("aceita apenas asc ou desc", () => {
    expect(esquemaLista.parse({ direcao: "asc" }).direcao).toBe("asc");
    expect(esquemaLista.safeParse({ direcao: "ASC" }).success).toBe(false);
    expect(esquemaLista.safeParse({ direcao: "desc --" }).success).toBe(false);
  });
});

describe("busca", () => {
  it("texto vazio vira ausente", () => {
    expect(esquemaLista.parse({ busca: "   " }).busca).toBeUndefined();
  });

  it("apara espacos", () => {
    expect(esquemaLista.parse({ busca: "  piloto " }).busca).toBe("piloto");
  });

  it("recusa termo muito longo", () => {
    expect(esquemaLista.safeParse({ busca: "x".repeat(101) }).success).toBe(false);
  });

  it("aceita curinga como texto (o escape acontece na query)", () => {
    expect(esquemaLista.parse({ busca: "100%" }).busca).toBe("100%");
  });
});

describe("leitura da query string", () => {
  it("converte URLSearchParams em objeto simples", () => {
    const url = new URL("http://x/api?periodo=7d&contas=1,2&pagina=2");
    expect(lerParametros(url)).toEqual({ periodo: "7d", contas: "1,2", pagina: "2" });
  });

  it("chave ausente fica undefined, para o default do Zod valer", () => {
    expect(lerParametros(new URL("http://x/api")).pagina).toBeUndefined();
    expect(esquemaLista.parse(lerParametros(new URL("http://x/api"))).pagina).toBe(1);
  });

  it("usa apenas a primeira ocorrencia de uma chave repetida", () => {
    const url = new URL("http://x/api?pagina=1&pagina=99");
    expect(lerParametros(url).pagina).toBe("1");
  });
});
