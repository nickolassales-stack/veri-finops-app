import { describe, expect, it } from "vitest";

import {
  PADRAO_ANALITICO,
  alternarOrdenacao,
  aplicarMudanca,
  escreverFiltrosAnalitico,
  lerFiltrosAnalitico,
  paramsDaApiAnalitico,
  type FiltrosAnalitico,
} from "./analitico";

const ler = (qs: string) => lerFiltrosAnalitico(new URLSearchParams(qs));
const escrever = (f: FiltrosAnalitico) => escreverFiltrosAnalitico(f).toString();
const api = (f: FiltrosAnalitico) => paramsDaApiAnalitico(f);

describe("leitura da URL", () => {
  it("URL vazia produz o padrao", () => {
    expect(ler("")).toEqual(PADRAO_ANALITICO);
  });

  it("le os filtros globais junto dos proprios do analitico", () => {
    const f = ler("periodo=30d&contas=111,222&busca=EC2&regiao=us-east-1b&pagina=3");
    expect(f).toMatchObject({
      periodo: "30d",
      contas: ["111", "222"],
      busca: "EC2",
      regiao: "us-east-1b",
      pagina: 3,
    });
  });

  it("recusa campo de ordenacao fora da allowlist", () => {
    // Sem isso, um valor colado na URL viaria para o parametro sortBy da API.
    expect(ler("ordenarPor=cost_amount").ordenarPor).toBe("usageDate");
    expect(ler("ordenarPor=service%3B+DROP+TABLE").ordenarPor).toBe("usageDate");
    expect(ler("ordenarPor=service").ordenarPor).toBe("service");
  });

  it("recusa direcao invalida", () => {
    expect(ler("direcao=DESC").direcao).toBe("desc");
    expect(ler("direcao=aleatorio").direcao).toBe("desc");
    expect(ler("direcao=asc").direcao).toBe("asc");
  });

  it("recusa pagina invalida", () => {
    for (const qs of ["pagina=0", "pagina=-2", "pagina=abc", "pagina=1.5"]) {
      expect(ler(qs).pagina).toBe(1);
    }
    expect(ler("pagina=7").pagina).toBe(7);
  });

  it("restringe o tamanho de pagina ao conjunto oferecido", () => {
    // 33 nao esta na lista: a API recusaria depois, entao cai no padrao aqui.
    expect(ler("tamanho=33").tamanho).toBe(50);
    expect(ler("tamanho=99999").tamanho).toBe(50);
    expect(ler("tamanho=100").tamanho).toBe(100);
  });

  it("corta busca longa demais", () => {
    expect(ler(`busca=${"x".repeat(300)}`).busca).toHaveLength(100);
  });
});

describe("escrita na URL", () => {
  it("omite tudo que for padrao", () => {
    expect(escrever(PADRAO_ANALITICO)).toBe("");
  });

  it("escreve apenas o que mudou", () => {
    expect(escrever({ ...PADRAO_ANALITICO, busca: "EC2" })).toBe("busca=EC2");
    expect(escrever({ ...PADRAO_ANALITICO, pagina: 4 })).toBe("pagina=4");
    expect(escrever({ ...PADRAO_ANALITICO, ordenarPor: "cost", direcao: "asc" })).toBe(
      "ordenarPor=cost&direcao=asc",
    );
  });

  it("ida e volta preserva o estado", () => {
    const original: FiltrosAnalitico = {
      periodo: "personalizado",
      de: "2026-07-01",
      ate: "2026-07-31",
      contas: ["800168045394"],
      busca: "EC2",
      regiao: "us-east-1b",
      ordenarPor: "cost",
      direcao: "asc",
      pagina: 3,
      tamanho: 100,
    };
    expect(ler(escrever(original))).toEqual(original);
  });

  it("apara espacos da busca", () => {
    expect(escrever({ ...PADRAO_ANALITICO, busca: "  EC2  " })).toBe("busca=EC2");
  });
});

describe("traducao para os parametros da API", () => {
  it("usa os nomes do contrato do endpoint", () => {
    const p = api({
      ...PADRAO_ANALITICO,
      contas: ["111", "222"],
      busca: "EC2",
      regiao: "us-east-1b",
      pagina: 2,
      tamanho: 25,
      ordenarPor: "cost",
      direcao: "asc",
    });
    expect(p.get("accountIds")).toBe("111,222");
    expect(p.get("serviceSearch")).toBe("EC2");
    expect(p.get("region")).toBe("us-east-1b");
    expect(p.get("page")).toBe("2");
    expect(p.get("pageSize")).toBe("25");
    expect(p.get("sortBy")).toBe("cost");
    expect(p.get("sortDirection")).toBe("asc");
    // Os nomes internos nao podem vazar para a API.
    expect(p.get("contas")).toBeNull();
    expect(p.get("pagina")).toBeNull();
  });

  it("periodo personalizado manda as duas datas", () => {
    const p = api({
      ...PADRAO_ANALITICO,
      periodo: "personalizado",
      de: "2026-07-01",
      ate: "2026-07-31",
    });
    expect(p.get("startDate")).toBe("2026-07-01");
    expect(p.get("endDate")).toBe("2026-07-31");
  });

  it("mes-atual NAO manda datas: quem resolve e o servidor", () => {
    // E o unico preset cujo fim depende da ultima carga do ETL, informacao que
    // so o servidor tem. Resolver no cliente faria a tela divergir do painel.
    const p = api({ ...PADRAO_ANALITICO, periodo: "mes-atual" });
    expect(p.get("startDate")).toBeNull();
    expect(p.get("endDate")).toBeNull();
  });

  it("presets relativos viram datas concretas e coerentes", () => {
    for (const [preset, dias] of [
      ["7d", 7],
      ["30d", 30],
    ] as const) {
      const p = api({ ...PADRAO_ANALITICO, periodo: preset });
      const de = p.get("startDate")!;
      const ate = p.get("endDate")!;
      expect(de).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(de <= ate).toBe(true);
      const span =
        (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000 + 1;
      expect(span).toBe(dias);
    }
  });

  it("mes-anterior cobre um mes fechado", () => {
    const p = api({ ...PADRAO_ANALITICO, periodo: "mes-anterior" });
    const de = p.get("startDate")!;
    const ate = p.get("endDate")!;
    expect(de.endsWith("-01")).toBe(true);
    expect(de.slice(0, 7)).toBe(ate.slice(0, 7));
    // Ultimo dia do mes: somar um dia muda o mes.
    const seguinte = new Date(Date.parse(`${ate}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(seguinte.slice(0, 7)).not.toBe(ate.slice(0, 7));
  });

  it("nao manda filtro vazio", () => {
    const p = api(PADRAO_ANALITICO);
    expect(p.get("accountIds")).toBeNull();
    expect(p.get("serviceSearch")).toBeNull();
    expect(p.get("region")).toBeNull();
  });
});

describe("reset de pagina", () => {
  const naPagina7: FiltrosAnalitico = { ...PADRAO_ANALITICO, pagina: 7 };

  it("mudar filtro volta para a pagina 1", () => {
    // Sem isso, aplicar uma busca que devolve 2 resultados estando na pagina 7
    // cairia numa pagina vazia, e pareceria que a busca nao achou nada.
    for (const mudanca of [
      { busca: "EC2" },
      { regiao: "us-east-1b" },
      { contas: ["111"] },
      { periodo: "7d" as const },
      { tamanho: 100 },
      { ordenarPor: "cost" as const },
      { direcao: "asc" as const },
    ]) {
      expect(aplicarMudanca(naPagina7, mudanca).pagina).toBe(1);
    }
  });

  it("mudar de pagina explicitamente e respeitado", () => {
    expect(aplicarMudanca(naPagina7, { pagina: 8 }).pagina).toBe(8);
  });

  it("trocar preset limpa as datas soltas", () => {
    const custom: FiltrosAnalitico = {
      ...PADRAO_ANALITICO,
      periodo: "personalizado",
      de: "2026-07-01",
      ate: "2026-07-31",
    };
    const depois = aplicarMudanca(custom, { periodo: "30d" });
    expect(depois.de).toBe("");
    expect(depois.ate).toBe("");
  });
});

describe("alternancia de ordenacao", () => {
  it("coluna nova de data ou valor comeca decrescente", () => {
    expect(alternarOrdenacao(PADRAO_ANALITICO, "cost")).toEqual({
      ordenarPor: "cost",
      direcao: "desc",
    });
  });

  it("coluna nova de texto comeca crescente", () => {
    expect(alternarOrdenacao(PADRAO_ANALITICO, "service")).toEqual({
      ordenarPor: "service",
      direcao: "asc",
    });
  });

  it("clicar de novo na mesma coluna inverte", () => {
    const emCusto: FiltrosAnalitico = {
      ...PADRAO_ANALITICO,
      ordenarPor: "cost",
      direcao: "desc",
    };
    expect(alternarOrdenacao(emCusto, "cost")).toEqual({ direcao: "asc" });
    expect(alternarOrdenacao({ ...emCusto, direcao: "asc" }, "cost")).toEqual({
      direcao: "desc",
    });
  });
});
