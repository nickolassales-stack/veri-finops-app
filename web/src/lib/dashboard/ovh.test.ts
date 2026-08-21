import { describe, expect, it } from "vitest";

import {
  ROTULO_SITUACAO_COLLECTOR,
  decidirEstadoDado,
  detalheDeAusencia,
  escolherMoeda,
  mensagemDeAusencia,
  participacao,
  podeEstimarBRL,
  semDado,
  tomDaSituacao,
  variacao,
  type EntradaEstadoOvh,
} from "./ovh";

/**
 * Regras da visao OVH.
 *
 * A regra que estes testes existem para travar: AUSENCIA DE DADO NAO E CUSTO
 * ZERO. Num painel executivo, "US$ 0,00" e lido como "esta sob controle" --
 * escrever zero onde a verdade e "nao foi importado" faz o portal mentir
 * exatamente no lugar onde a decisao e tomada.
 */

const base: EntradaEstadoOvh = {
  instalado: true,
  temAlgumDado: true,
  fontesComDado: ["invoice"],
  source: "invoice",
  linhasNoPeriodo: 42,
};

describe("decidirEstadoDado -- as quatro ausencias sao distintas", () => {
  it("sem tabela -> sem-integracao", () => {
    expect(decidirEstadoDado({ ...base, instalado: false })).toBe("sem-integracao");
  });

  it("tabela vazia -> sem-nenhum-dado", () => {
    expect(decidirEstadoDado({ ...base, temAlgumDado: false })).toBe("sem-nenhum-dado");
  });

  it("origem que a API nunca devolveu -> fonte-sem-dado", () => {
    expect(decidirEstadoDado({ ...base, source: "usage_current" })).toBe(
      "fonte-sem-dado",
    );
  });

  it("origem existe mas a janela esta vazia -> periodo-sem-dado", () => {
    expect(decidirEstadoDado({ ...base, linhasNoPeriodo: 0 })).toBe("periodo-sem-dado");
  });

  it("com linha na janela -> ok", () => {
    expect(decidirEstadoDado(base)).toBe("ok");
  });

  it("a ordem importa: sem tabela vence tudo", () => {
    // Sem tabela nao se sabe se ha dado nem quais origens existem. Classificar
    // como "fonte-sem-dado" mandaria o operador procurar na API da OVH um
    // problema que esta na migracao.
    expect(
      decidirEstadoDado({
        instalado: false,
        temAlgumDado: false,
        fontesComDado: [],
        source: "usage_forecast",
        linhasNoPeriodo: 0,
      }),
    ).toBe("sem-integracao");
  });

  it("tabela vazia vence 'fonte sem dado'", () => {
    // Dizer "a API nao devolveu previsao" quando NADA foi importado culparia a
    // OVH por uma coleta que nunca rodou.
    expect(
      decidirEstadoDado({
        ...base,
        temAlgumDado: false,
        fontesComDado: [],
        source: "usage_forecast",
      }),
    ).toBe("sem-nenhum-dado");
  });
});

describe("semDado", () => {
  it("só 'ok' tem numero para mostrar", () => {
    expect(semDado("ok")).toBe(false);
    for (const e of [
      "sem-integracao",
      "sem-nenhum-dado",
      "fonte-sem-dado",
      "periodo-sem-dado",
    ] as const) {
      expect(semDado(e)).toBe(true);
    }
  });
});

describe("mensagemDeAusencia", () => {
  it("ok nao gera mensagem", () => {
    expect(mensagemDeAusencia("ok", "invoice")).toBeNull();
    expect(detalheDeAusencia("ok")).toBeNull();
  });

  it("sem-nenhum-dado usa o texto pedido pela especificacao", () => {
    expect(mensagemDeAusencia("sem-nenhum-dado", "invoice")).toBe(
      "Nenhum dado OVH importado ainda.",
    );
  });

  it("uso corrente ausente culpa a API, nao a coleta", () => {
    // A API da OVH responde `no usages found` para projeto Public Cloud sem
    // consumo -- foi o que aconteceu em producao. Dizer "falha na coleta"
    // mandaria o operador investigar um problema que nao existe.
    expect(mensagemDeAusencia("fonte-sem-dado", "usage_current")).toBe(
      "Sem dados de uso corrente retornados pela API OVH.",
    );
  });

  it("previsao ausente tem mensagem propria", () => {
    expect(mensagemDeAusencia("fonte-sem-dado", "usage_forecast")).toBe(
      "Sem dados de previsão retornados pela API OVH.",
    );
  });

  it("fatura ausente NAO reusa o texto de uso -- seria enganoso", () => {
    // "Sem dados de uso corrente" para `invoice` mandaria procurar a coisa
    // errada: fatura ausente significa que o collector nao importou fatura.
    const m = mensagemDeAusencia("fonte-sem-dado", "invoice");
    expect(m).toBe("Nenhuma fatura OVH importada ainda.");
    expect(m).not.toContain("uso corrente");
  });

  it("periodo-sem-dado nomeia a origem e aponta para o filtro", () => {
    expect(mensagemDeAusencia("periodo-sem-dado", "invoice")).toContain("Faturado");
    expect(detalheDeAusencia("periodo-sem-dado")).toContain("Amplie o período");
  });

  it("nenhuma mensagem de ausencia contem um valor monetario", () => {
    // A prova estrutural da regra: ausencia nunca e comunicada como numero.
    for (const estado of [
      "sem-integracao",
      "sem-nenhum-dado",
      "fonte-sem-dado",
      "periodo-sem-dado",
    ] as const) {
      for (const fonte of ["invoice", "usage_current", "usage_forecast"] as const) {
        const texto = `${mensagemDeAusencia(estado, fonte)} ${detalheDeAusencia(estado)}`;
        expect(texto).not.toMatch(/0[,.]00/);
        expect(texto).not.toMatch(/US\$/);
      }
    }
  });

  it("sem-nenhum-dado diz explicitamente que nao e custo zero", () => {
    expect(detalheDeAusencia("sem-nenhum-dado")).toContain("não é custo zero");
  });
});

describe("escolherMoeda -- nunca soma duas", () => {
  it("sem moeda nenhuma devolve null", () => {
    expect(escolherMoeda([])).toEqual({ moeda: null, outras: [] });
  });

  it("uma moeda e escolhida sem sobras", () => {
    expect(escolherMoeda([{ moeda: "USD", total: 100, linhas: 3 }])).toEqual({
      moeda: "USD",
      outras: [],
    });
  });

  it("escolhe a de maior volume e mantem a outra separada", () => {
    const r = escolherMoeda([
      { moeda: "EUR", total: 10, linhas: 1 },
      { moeda: "USD", total: 900, linhas: 9 },
    ]);
    expect(r.moeda).toBe("USD");
    expect(r.outras).toEqual([{ moeda: "EUR", total: 10, linhas: 1 }]);
  });

  it("a escolha NAO soma os totais", () => {
    // A garantia central: 900 + 10 nunca aparece. O total exibido e o da moeda
    // escolhida, e o resto e reportado ao lado.
    const totais = [
      { moeda: "EUR", total: 10, linhas: 1 },
      { moeda: "USD", total: 900, linhas: 9 },
    ];
    const r = escolherMoeda(totais);
    const escolhido = totais.find((t) => t.moeda === r.moeda)!;
    expect(escolhido.total).toBe(900);
    expect(r.outras.reduce((s, o) => s + o.total, 0)).toBe(10);
  });

  it("empate e resolvido pelo codigo, nao pela ordem do banco", () => {
    // Sem o desempate, a tela trocaria de moeda entre dois carregamentos iguais.
    const a = escolherMoeda([
      { moeda: "USD", total: 50, linhas: 1 },
      { moeda: "EUR", total: 50, linhas: 1 },
    ]);
    const b = escolherMoeda([
      { moeda: "EUR", total: 50, linhas: 1 },
      { moeda: "USD", total: 50, linhas: 1 },
    ]);
    expect(a.moeda).toBe(b.moeda);
    expect(a.moeda).toBe("EUR");
  });

  it("a preferida da URL vence o volume", () => {
    const r = escolherMoeda(
      [
        { moeda: "USD", total: 900, linhas: 9 },
        { moeda: "EUR", total: 10, linhas: 1 },
      ],
      "eur",
    );
    expect(r.moeda).toBe("EUR");
    expect(r.outras).toEqual([{ moeda: "USD", total: 900, linhas: 9 }]);
  });

  it("preferida inexistente no recorte cai no maior volume", () => {
    const r = escolherMoeda([{ moeda: "USD", total: 900, linhas: 9 }], "BRL");
    expect(r.moeda).toBe("USD");
  });
});

describe("podeEstimarBRL", () => {
  it("só USD -- a cotacao do portal e USD/BRL", () => {
    expect(podeEstimarBRL("USD")).toBe(true);
  });

  it("euro nao estima: aplicar taxa USD/BRL a euro daria numero sem sentido", () => {
    expect(podeEstimarBRL("EUR")).toBe(false);
    expect(podeEstimarBRL(null)).toBe(false);
  });
});

describe("participacao e variacao", () => {
  it("participacao com total zero e zero, nao NaN", () => {
    expect(participacao(0, 0)).toBe(0);
    expect(participacao(10, 0)).toBe(0);
  });

  it("participacao normal", () => {
    expect(participacao(25, 100)).toBe(0.25);
  });

  it("variacao com anterior zero e null, nao Infinity", () => {
    // "+∞%" nao e informacao. A tela mostra "—" e o valor absoluto ao lado.
    expect(variacao(100, 0)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });

  it("variacao normal, nos dois sentidos", () => {
    expect(variacao(150, 100)).toBeCloseTo(0.5);
    expect(variacao(50, 100)).toBeCloseTo(-0.5);
  });
});

describe("status do collector", () => {
  it("os sete estados tem rotulo -- nenhum colapsa em outro", () => {
    const rotulos = Object.values(ROTULO_SITUACAO_COLLECTOR);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("em_execucao nao e chamado de falha", () => {
    // Uma coleta em andamento nao e sucesso nem falha. Classificar como falha
    // faria a tela alarmar durante os dois minutos normais de uma execucao.
    expect(ROTULO_SITUACAO_COLLECTOR.em_execucao).toBe("Em execução");
    expect(tomDaSituacao("em_execucao")).toBe("atencao");
  });

  it("erro_de_leitura nao afirma nada sobre a coleta", () => {
    expect(ROTULO_SITUACAO_COLLECTOR.erro_de_leitura).toBe("Não foi possível ler");
  });

  it("só 'ok' recebe tom verde", () => {
    expect(tomDaSituacao("ok")).toBe("ok");
    for (const s of [
      "dado_velho",
      "ultima_falhou",
      "nunca_teve_sucesso",
      "nunca_executado",
      "em_execucao",
      "erro_de_leitura",
      "nao_instalado",
    ] as const) {
      expect(tomDaSituacao(s)).not.toBe("ok");
    }
  });

  it("dado_velho aparece como 'Atrasado' -- o termo pedido", () => {
    expect(ROTULO_SITUACAO_COLLECTOR.dado_velho).toBe("Atrasado");
  });

  it("nunca_executado aparece como 'Sem execução' -- o termo pedido", () => {
    expect(ROTULO_SITUACAO_COLLECTOR.nunca_executado).toBe("Sem execução");
  });
});
