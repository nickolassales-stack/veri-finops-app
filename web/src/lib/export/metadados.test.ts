import { describe, expect, it } from "vitest";

import type { Cotacao } from "@/lib/exchange-rate/tipos";

import {
  AVISO_BRL,
  AVISO_USD,
  descreverContas,
  descreverStatusCotacao,
  montarMetadados,
  nomeDoArquivo,
  type ContextoExportacao,
} from "./metadados";

const cotacaoAtual: Cotacao = {
  valor: 5.1285,
  dataReferencia: "2026-08-11",
  dataHoraReferencia: "2026-08-11T13:04:00.000-03:00",
  fonte: "Banco Central do Brasil — PTAX (venda)",
  provedor: "ptax",
  status: "current",
  desatualizada: false,
  mensagemErro: null,
  obtidaEm: "2026-08-11T16:10:00.000Z",
  idadeSegundos: 0,
};

const semCotacao: Cotacao = {
  ...cotacaoAtual,
  valor: null,
  dataReferencia: null,
  dataHoraReferencia: null,
  status: "unavailable",
  mensagemErro: "O Banco Central não respondeu a tempo.",
};

function contexto(sobrescrever: Partial<ContextoExportacao> = {}): ContextoExportacao {
  return {
    periodo: {
      de: "2026-08-01",
      ate: "2026-08-11",
      dias: 11,
      limitadoPorDadoDisponivel: false,
    },
    contas: [],
    busca: null,
    regiao: null,
    ordenacao: { campo: "usageDate", direcao: "desc" },
    totalLinhas: 230,
    cotacao: cotacaoAtual,
    geradoEm: "2026-08-11T17:30:00.000Z",
    tz: "America/Sao_Paulo",
    ...sobrescrever,
  };
}

function valorDe(rotulo: string, ctx = contexto()): string {
  const par = montarMetadados(ctx).find((m) => m.rotulo === rotulo);
  if (!par) throw new Error(`metadado ausente: ${rotulo}`);
  return par.valor;
}

describe("nome do arquivo", () => {
  it("segue o padrao pedido, com as datas do periodo aplicado", () => {
    expect(nomeDoArquivo("2026-08-01", "2026-08-11", "csv")).toBe(
      "veri-finops-aws-2026-08-01_2026-08-11.csv",
    );
    expect(nomeDoArquivo("2026-08-01", "2026-08-11", "xlsx")).toBe(
      "veri-finops-aws-2026-08-01_2026-08-11.xlsx",
    );
  });
});

describe("contas selecionadas", () => {
  it("lista vazia significa todas -- nunca um id fixo no codigo", () => {
    expect(descreverContas([])).toBe("Todas as contas cadastradas");
  });

  it("mostra nome e id de cada conta", () => {
    expect(
      descreverContas([
        { id: "111122223333", nome: "Produção" },
        { id: "444455556666", nome: "Homologação" },
      ]),
    ).toBe("Produção (111122223333); Homologação (444455556666)");
  });

  it("marca conta filtrada que nao existe no cadastro", () => {
    // Sem essa marca, o total viria zerado e pareceria "a conta nao gastou".
    expect(descreverContas([{ id: "999999999999", nome: null }])).toBe(
      "999999999999 (sem cadastro)",
    );
  });
});

describe("status da cotacao", () => {
  it("distingue atual, em cache e desatualizada", () => {
    expect(descreverStatusCotacao(cotacaoAtual)).toContain("atual");
    expect(descreverStatusCotacao({ ...cotacaoAtual, status: "cached" })).toContain(
      "em cache",
    );

    const velha = descreverStatusCotacao({
      ...cotacaoAtual,
      status: "cached",
      desatualizada: true,
    });
    expect(velha).toContain("DESATUALIZADA");
  });

  it("indisponivel carrega o motivo", () => {
    expect(descreverStatusCotacao(semCotacao)).toContain("O Banco Central não respondeu");
  });
});

describe("bloco de metadados", () => {
  it("traz todos os campos obrigatorios", () => {
    const rotulos = montarMetadados(contexto()).map((m) => m.rotulo);
    for (const obrigatorio of [
      "Período da consulta",
      "Contas selecionadas",
      "Data e hora da exportação",
      "Fonte da cotação",
      "Cotação utilizada",
      "Status da cotação",
      "Aviso — dólar",
      "Aviso — real",
    ]) {
      expect(rotulos).toContain(obrigatorio);
    }
  });

  it("o periodo sai em pt-BR com a contagem de dias", () => {
    expect(valorDe("Período da consulta")).toBe("01/08/2026 a 11/08/2026 (11 dia(s))");
  });

  it("avisa quando a janela foi encurtada pela ultima carga do ETL", () => {
    const ctx = contexto({
      periodo: {
        de: "2026-08-01",
        ate: "2026-08-11",
        dias: 11,
        limitadoPorDadoDisponivel: true,
      },
    });
    expect(valorDe("Período da consulta", ctx)).toContain("última carga do ETL");
  });

  it("a hora da exportacao e a de Sao_Paulo, nao a do servidor", () => {
    // 17:30 UTC e 14:30 em Sao_Paulo. Se o fuso fosse ignorado, o arquivo
    // registraria uma hora que nao corresponde a nenhum relogio brasileiro.
    expect(valorDe("Data e hora da exportação")).toBe(
      "11/08/2026, 14:30 (America/Sao_Paulo)",
    );
  });

  it("a cotacao sai com 4 casas e a referencia no horario do boletim", () => {
    expect(valorDe("Cotação utilizada")).toBe("R$ 5,1285 por US$ 1,00");
    expect(valorDe("Referência da cotação")).toBe("11/08/2026, 13:04");
  });

  it("descreve os filtros de refino aplicados", () => {
    const ctx = contexto({
      busca: "EC2",
      regiao: "us-east-1b",
      ordenacao: { campo: "cost", direcao: "asc" },
    });
    expect(valorDe("Filtro de serviço", ctx)).toBe('contém "EC2"');
    expect(valorDe("Filtro de região", ctx)).toBe("us-east-1b");
    expect(valorDe("Ordenação", ctx)).toBe("valor USD (crescente)");
  });

  it("regiao nao informada e explicada por extenso", () => {
    const ctx = contexto({ regiao: "nao-informado" });
    expect(valorDe("Filtro de região", ctx)).toBe("somente linhas sem região informada");
  });

  it("o aviso do dolar afirma que ele e o valor oficial", () => {
    expect(valorDe("Aviso — dólar")).toBe(AVISO_USD);
    expect(AVISO_USD).toContain("oficiais");
  });

  it("o aviso do real afirma que e estimativa e nao serve para contabilidade", () => {
    expect(valorDe("Aviso — real")).toBe(AVISO_BRL);
    expect(AVISO_BRL).toContain("ESTIMATIVA");
    expect(AVISO_BRL).toContain("contabilidade");
  });

  it("sem cotacao, o arquivo diz que a coluna de BRL saiu vazia e o USD segue exato", () => {
    const ctx = contexto({ cotacao: semCotacao });
    expect(valorDe("Cotação utilizada", ctx)).toBe("—");
    expect(valorDe("Referência da cotação", ctx)).toBe("—");
    expect(valorDe("Aviso — real", ctx)).toContain("USD acima seguem exatos");
  });
});
