import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { converterParaBRL, estimarBRL, limparCacheDeCotacao, obterCotacao } from "./index";
import { buscarPtax, buscarSgs } from "./provedores";

/**
 * Nenhum teste aqui sai para a rede: o `fetch` e injetado. A validacao contra o
 * servico real do Banco Central foi feita a parte (ver relatorio da etapa) --
 * aqui o que se prova e o COMPORTAMENTO da integracao, principalmente quando a
 * fonte externa falha.
 */

/** Resposta real do Olinda, copiada da sondagem de 06/08/2026. */
const RESPOSTA_PTAX = {
  value: [
    {
      cotacaoCompra: 5.1148,
      cotacaoVenda: 5.1154,
      dataHoraCotacao: "2026-08-05 13:06:43.148328",
    },
  ],
};

/** Resposta real do SGS, mesma data. */
const RESPOSTA_SGS = [{ data: "05/08/2026", valor: "5.1154" }];

function fetchQueResponde(corpo: unknown, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function fetchQueFalha(erro: Error): typeof fetch {
  return vi.fn(async () => {
    throw erro;
  }) as unknown as typeof fetch;
}

const BASE = { provedor: "ptax" as const, ttlSegundos: 60, timeoutMs: 1_000 };

beforeEach(() => {
  limparCacheDeCotacao();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------- provedor PTAX

describe("provedor PTAX", () => {
  it("le a cotacao de venda e a hora do boletim", async () => {
    const r = await buscarPtax({
      timeoutMs: 1_000,
      fetchImpl: fetchQueResponde(RESPOSTA_PTAX),
    });

    expect(r.valor).toBe(5.1154);
    expect(r.dataReferencia).toBe("2026-08-05");
    // 13:06:43 em Brasilia (UTC-3) = 16:06:43 UTC. Sem o deslocamento explicito
    // o container, que roda em UTC, leria como se ja fosse UTC.
    expect(r.dataHoraReferencia).toBe("2026-08-05T16:06:43.148Z");
  });

  it("consulta um periodo, nao o dia de hoje", async () => {
    // O boletim de hoje so sai por volta das 13h; consultar "hoje" devolve
    // vazio a manha inteira, e o fim de semana inteiro.
    const espiao = fetchQueResponde(RESPOSTA_PTAX);
    await buscarPtax({ timeoutMs: 1_000, fetchImpl: espiao });

    const url = String(vi.mocked(espiao).mock.calls[0][0]);
    expect(url).toContain("CotacaoDolarPeriodo");
    expect(url).toContain("dataInicial");
    expect(url).toContain("orderby=dataHoraCotacao%20desc");
  });

  it("avisa quando nao ha boletim na janela (feriado longo, fonte parada)", async () => {
    await expect(
      buscarPtax({ timeoutMs: 1_000, fetchImpl: fetchQueResponde({ value: [] }) }),
    ).rejects.toThrow(/nao tem boletim/i);
  });

  it("recusa cotacao invalida em vez de propagar NaN", async () => {
    await expect(
      buscarPtax({
        timeoutMs: 1_000,
        fetchImpl: fetchQueResponde({ value: [{ cotacaoVenda: "abc", dataHoraCotacao: "x" }] }),
      }),
    ).rejects.toThrow(/invalida/i);
  });

  it("trata erro HTTP do Banco Central", async () => {
    await expect(
      buscarPtax({ timeoutMs: 1_000, fetchImpl: fetchQueResponde({}, 503) }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("provedor SGS", () => {
  it("converte a data brasileira e nao inventa hora", async () => {
    const r = await buscarSgs({
      timeoutMs: 1_000,
      fetchImpl: fetchQueResponde(RESPOSTA_SGS),
    });

    expect(r.valor).toBe(5.1154);
    expect(r.dataReferencia).toBe("2026-08-05");
    // A serie do SGS informa so o dia: null e mais honesto que "13:00".
    expect(r.dataHoraReferencia).toBeNull();
  });

  it("recusa payload fora do formato esperado", async () => {
    await expect(
      buscarSgs({ timeoutMs: 1_000, fetchImpl: fetchQueResponde([{ data: "2026-08-05", valor: "5" }]) }),
    ).rejects.toThrow(/invalida/i);
  });
});

// ------------------------------------------------------------ API disponivel

describe("API disponivel", () => {
  it("devolve status current com valor, data, fonte e sem erro", async () => {
    const c = await obterCotacao({ ...BASE, fetchImpl: fetchQueResponde(RESPOSTA_PTAX) });

    expect(c.status).toBe("current");
    expect(c.valor).toBe(5.1154);
    expect(c.dataReferencia).toBe("2026-08-05");
    expect(c.dataHoraReferencia).toBe("2026-08-05T16:06:43.148Z");
    expect(c.fonte).toMatch(/Banco Central/);
    expect(c.provedor).toBe("ptax");
    expect(c.desatualizada).toBe(false);
    expect(c.mensagemErro).toBeNull();
    expect(c.obtidaEm).toBeTruthy();
  });

  it("respeita o provedor configurado", async () => {
    const c = await obterCotacao({
      ...BASE,
      provedor: "sgs",
      fetchImpl: fetchQueResponde(RESPOSTA_SGS),
    });

    expect(c.provedor).toBe("sgs");
    expect(c.fonte).toMatch(/SGS/);
    expect(c.valor).toBe(5.1154);
  });

  it("nao sai para a rede quando o provedor esta desligado", async () => {
    const espiao = fetchQueResponde(RESPOSTA_PTAX);
    const c = await obterCotacao({ ...BASE, provedor: "nenhum", fetchImpl: espiao });

    expect(c.status).toBe("unavailable");
    expect(c.valor).toBeNull();
    expect(c.provedor).toBe("nenhum");
    // A mensagem varia conforme o motivo (desligado por configuracao ou
    // ambiente sem configuracao); o que importa e existir uma explicacao.
    expect(c.mensagemErro).toMatch(/desabilitada|nao configurada/i);
    expect(espiao).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------- cache

describe("cache", () => {
  it("dentro do TTL serve do cache sem nova chamada", async () => {
    const espiao = fetchQueResponde(RESPOSTA_PTAX);

    const primeira = await obterCotacao({ ...BASE, fetchImpl: espiao });
    const segunda = await obterCotacao({ ...BASE, fetchImpl: espiao });

    expect(primeira.status).toBe("current");
    expect(segunda.status).toBe("cached");
    expect(segunda.valor).toBe(primeira.valor);
    expect(segunda.desatualizada).toBe(false);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("passado o TTL, busca de novo", async () => {
    const espiao = fetchQueResponde(RESPOSTA_PTAX);
    const t0 = new Date("2026-08-06T12:00:00Z");
    const depois = new Date("2026-08-06T12:02:00Z"); // TTL de 60s ja venceu

    await obterCotacao({ ...BASE, fetchImpl: espiao, agora: t0 });
    const nova = await obterCotacao({ ...BASE, fetchImpl: espiao, agora: depois });

    expect(nova.status).toBe("current");
    expect(espiao).toHaveBeenCalledTimes(2);
  });

  it("informa a idade do valor em cache", async () => {
    const espiao = fetchQueResponde(RESPOSTA_PTAX);
    const t0 = new Date("2026-08-06T12:00:00Z");
    const depois = new Date("2026-08-06T12:00:30Z");

    await obterCotacao({ ...BASE, fetchImpl: espiao, agora: t0 });
    const c = await obterCotacao({ ...BASE, fetchImpl: espiao, agora: depois });

    expect(c.status).toBe("cached");
    expect(c.idadeSegundos).toBe(30);
  });

  it("nao dispara chamadas simultaneas para o mesmo valor", async () => {
    let chamadas = 0;
    const lento = vi.fn(async () => {
      chamadas += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(RESPOSTA_PTAX), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const todas = await Promise.all(
      Array.from({ length: 5 }, () => obterCotacao({ ...BASE, fetchImpl: lento })),
    );

    expect(chamadas).toBe(1);
    expect(todas.every((c) => c.valor === 5.1154)).toBe(true);
  });
});

// ------------------------------------------------------- fallback e falha

describe("API indisponivel", () => {
  it("usa o ultimo valor conhecido e marca como desatualizada", async () => {
    const t0 = new Date("2026-08-06T12:00:00Z");
    const depois = new Date("2026-08-06T13:00:00Z");

    await obterCotacao({ ...BASE, fetchImpl: fetchQueResponde(RESPOSTA_PTAX), agora: t0 });

    const c = await obterCotacao({
      ...BASE,
      fetchImpl: fetchQueFalha(new TypeError("fetch failed")),
      agora: depois,
    });

    expect(c.status).toBe("cached");
    expect(c.valor).toBe(5.1154);
    expect(c.desatualizada).toBe(true);
    expect(c.mensagemErro).toMatch(/ultima cotacao conhecida/i);
    expect(c.idadeSegundos).toBe(3_600);
  });

  it("sem cache nenhum, devolve unavailable com mensagem amigavel", async () => {
    const c = await obterCotacao({
      ...BASE,
      fetchImpl: fetchQueFalha(new TypeError("fetch failed")),
    });

    expect(c.status).toBe("unavailable");
    expect(c.valor).toBeNull();
    expect(c.mensagemErro).toBe("Nao foi possivel falar com o Banco Central.");
    // A mensagem nao pode vazar detalhe tecnico da falha.
    expect(c.mensagemErro).not.toMatch(/fetch failed|bcb\.gov\.br|stack/i);
  });

  it("timeout vira mensagem propria, citando o limite", async () => {
    const erro = new Error("The operation was aborted due to timeout");
    erro.name = "TimeoutError";

    const c = await obterCotacao({ ...BASE, fetchImpl: fetchQueFalha(erro) });

    expect(c.status).toBe("unavailable");
    expect(c.mensagemErro).toMatch(/nao respondeu em 1000 ms/i);
  });

  it("NUNCA lanca, qualquer que seja a falha", async () => {
    // Este e o contrato que mantem o dashboard de pe.
    const desastres: unknown[] = [
      new TypeError("fetch failed"),
      new Error("boom"),
      "erro em string",
      null,
    ];

    for (const desastre of desastres) {
      limparCacheDeCotacao();
      const c = await obterCotacao({
        ...BASE,
        fetchImpl: vi.fn(async () => {
          throw desastre;
        }) as unknown as typeof fetch,
      });
      expect(c.status).toBe("unavailable");
      expect(c.mensagemErro).toBeTruthy();
    }
  });

  it("resposta corrompida tambem nao derruba", async () => {
    const c = await obterCotacao({
      ...BASE,
      fetchImpl: vi.fn(async () =>
        new Response("<html>erro do proxy</html>", {
          headers: { "content-type": "text/html" },
        }),
      ) as unknown as typeof fetch,
    });

    expect(c.status).toBe("unavailable");
    expect(c.mensagemErro).toMatch(/ilegivel/i);
  });
});

// ------------------------------------------------------------- conversao

describe("estimativa em BRL", () => {
  it("multiplica pelo valor da cotacao", async () => {
    const c = await obterCotacao({ ...BASE, fetchImpl: fetchQueResponde(RESPOSTA_PTAX) });
    expect(converterParaBRL(100, c)).toBeCloseTo(511.54, 6);
  });

  it("sem cotacao devolve null, nunca zero", async () => {
    // Zero seria lido como "custo zero" -- numero inventado, que este projeto
    // nao exibe em hipotese alguma.
    const c = await obterCotacao({
      ...BASE,
      fetchImpl: fetchQueFalha(new TypeError("fetch failed")),
    });

    expect(converterParaBRL(100, c)).toBeNull();
    const e = estimarBRL(42.6, 93.19, c);
    expect(e.total).toBeNull();
    expect(e.totalAnterior).toBeNull();
    expect(e.cotacao.status).toBe("unavailable");
  });

  it("o bloco de estimativa sempre carrega o aviso de que nao e valor contabil", async () => {
    const c = await obterCotacao({ ...BASE, fetchImpl: fetchQueResponde(RESPOSTA_PTAX) });
    const e = estimarBRL(42.607028, 93.192638, c);

    // Os dois totais em USD sao convertidos pela MESMA cotacao, sem
    // arredondamento -- a formatacao e responsabilidade da interface.
    expect(e.total).toBeCloseTo(42.607028 * 5.1154, 9);
    expect(e.totalAnterior).toBeCloseTo(93.192638 * 5.1154, 9);
    expect(e.aviso).toMatch(/indicativa/i);
    expect(e.aviso).toMatch(/USD/);
  });
});
