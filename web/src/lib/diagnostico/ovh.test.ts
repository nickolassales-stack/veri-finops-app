import { describe, expect, it } from "vitest";

import {
  HORAS_PARA_DADO_VELHO,
  decidirSituacaoOvh,
  montarAlertasOvh,
  type ExecucaoOvhResumida,
  type SituacaoOvh,
} from "./ovh";

/**
 * Regras de saude do collector OVH.
 *
 * O caso que motivou o `erro_de_leitura` foi real: em 20/08/2026 uma coluna
 * `date` tipada como `Date` fez `montarVisaoOvh()` lancar, e as duas telas que
 * a chamam morreram com "A server error occurred" -- inclusive a parte de AWS,
 * que nao tinha nada a ver com o defeito. Os testes abaixo travam o
 * comportamento que impede isso de derrubar pagina de novo.
 */

const AGORA = new Date("2026-08-20T18:00:00Z");

function execucao(over: Partial<ExecucaoOvhResumida> = {}): ExecucaoOvhResumida {
  return {
    id: 7,
    startedAt: "2026-08-20T15:53:00Z",
    finishedAt: "2026-08-20T15:54:01Z",
    status: "success",
    ...over,
  };
}

function alertas(
  situacao: SituacaoOvh,
  over: Partial<Parameters<typeof montarAlertasOvh>[0]> = {},
) {
  return montarAlertasOvh({
    situacao,
    ultima: null,
    ultimoSucesso: null,
    temDado: true,
    teveExecucaoAutomatica: true,
    cronInstalado: true,
    agora: AGORA,
    ...over,
  });
}

const chaves = (a: { chave: string }[]) => a.map((x) => x.chave);

describe("decidirSituacaoOvh", () => {
  it("sem execucao nenhuma -> nunca_executado", () => {
    expect(decidirSituacaoOvh(null, null, AGORA)).toBe("nunca_executado");
  });

  it("execucao aberta -> em_execucao, mesmo sem sucesso anterior", () => {
    // A ordem importa: `running` nao e falha. Classificar como falha faria a
    // tela alarmar durante os dois minutos normais de uma coleta.
    const rodando = execucao({ status: "running", finishedAt: null });
    expect(decidirSituacaoOvh(rodando, null, AGORA)).toBe("em_execucao");
  });

  it("falhou e nunca houve sucesso -> nunca_teve_sucesso", () => {
    const falha = execucao({ status: "failed" });
    expect(decidirSituacaoOvh(falha, null, AGORA)).toBe("nunca_teve_sucesso");
  });

  it("falhou mas havia sucesso antes -> ultima_falhou", () => {
    const falha = execucao({ id: 8, status: "failed" });
    expect(decidirSituacaoOvh(falha, execucao(), AGORA)).toBe("ultima_falhou");
  });

  it("sucesso recente -> ok", () => {
    expect(decidirSituacaoOvh(execucao(), execucao(), AGORA)).toBe("ok");
  });

  it(`sucesso com mais de ${HORAS_PARA_DADO_VELHO}h -> dado_velho`, () => {
    const velho = execucao({ finishedAt: "2026-08-18T00:00:00Z" }); // ~66h
    expect(decidirSituacaoOvh(velho, velho, AGORA)).toBe("dado_velho");
  });

  it("usa startedAt quando finishedAt e nulo, sem virar NaN", () => {
    // `finishedAt` nulo num sucesso e anomalia, mas nao pode produzir
    // `Invalid Date` e classificar como recente por acidente.
    const semFim = execucao({ finishedAt: null, startedAt: "2026-08-17T00:00:00Z" });
    expect(decidirSituacaoOvh(semFim, semFim, AGORA)).toBe("dado_velho");
  });
});

describe("montarAlertasOvh -- erro de leitura", () => {
  it("gera alerta critico", () => {
    const a = alertas("erro_de_leitura");
    expect(chaves(a)).toContain("ovh-erro-de-leitura");
    expect(a[0].tom).toBe("critico");
  });

  it("diz que o resto da pagina nao depende disto", () => {
    // A tela precisa dizer isso: quem ve um erro vermelho na secao OVH nao pode
    // concluir que o diagnostico do ETL AWS ao lado tambem esta comprometido.
    expect(alertas("erro_de_leitura")[0].detalhe).toContain("restante da página");
  });

  it("NAO afirma que nao ha linha de custo", () => {
    // O ponto central: sem conseguir ler, a tela nao sabe se ha dado. Dizer
    // "nenhuma linha de custo" transformaria uma falha de query numa afirmacao
    // sobre o custo.
    const a = alertas("erro_de_leitura", { temDado: false });
    expect(chaves(a)).not.toContain("ovh-sem-linha");
  });

  it("NAO afirma nada sobre execucao automatica", () => {
    const a = alertas("erro_de_leitura", { teveExecucaoAutomatica: false });
    expect(chaves(a)).not.toContain("ovh-sem-execucao-automatica");
  });

  it("nao esconde o problema: e o unico alerta, e e critico", () => {
    expect(alertas("erro_de_leitura", { temDado: false })).toHaveLength(1);
  });
});

describe("montarAlertasOvh -- success sem dado", () => {
  it("avisa que success sem linha nao e custo zero", () => {
    const a = alertas("ok", { temDado: false });
    expect(chaves(a)).toContain("ovh-sem-linha");
    expect(a.find((x) => x.chave === "ovh-sem-linha")!.detalhe).toContain(
      "não significa custo zero",
    );
  });

  it("nao avisa quando a integracao nem esta instalada", () => {
    // Sem tabela, "vazia" e o estado esperado e nao merece alarme.
    const a = alertas("nao_instalado", { temDado: false });
    expect(chaves(a)).not.toContain("ovh-sem-linha");
  });

  it("nao avisa quando nunca executou -- ja ha alerta proprio", () => {
    const a = alertas("nunca_executado", { temDado: false });
    expect(chaves(a)).not.toContain("ovh-sem-linha");
    expect(chaves(a)).toContain("ovh-nunca-executado");
  });
});

describe("montarAlertasOvh -- cron declarado x execucao real", () => {
  it("cron instalado sem execucao automatica gera aviso", () => {
    // Era o estado real logo apos a instalacao de 20/08/2026: o cron existia,
    // mas o horario das 09:00 UTC ja tinha passado. Sem este aviso, quem le a
    // tela conclui que a coleta e automatica quando ainda nao se provou.
    const a = alertas("ok", { teveExecucaoAutomatica: false });
    expect(chaves(a)).toContain("ovh-sem-execucao-automatica");
  });

  it("com execucao automatica, nao avisa", () => {
    const a = alertas("ok", { teveExecucaoAutomatica: true });
    expect(chaves(a)).not.toContain("ovh-sem-execucao-automatica");
  });

  it("cron NAO instalado nao gera esse aviso -- e coerente", () => {
    // Nao ter execucao automatica sem cron nao e contradicao nenhuma.
    const a = alertas("ok", { cronInstalado: false, teveExecucaoAutomatica: false });
    expect(chaves(a)).not.toContain("ovh-sem-execucao-automatica");
  });

  it("aponta o log do cron como primeiro lugar a olhar", () => {
    const a = alertas("ok", { teveExecucaoAutomatica: false });
    expect(a.find((x) => x.chave === "ovh-sem-execucao-automatica")!.detalhe).toContain(
      "cron.log",
    );
  });
});

describe("montarAlertasOvh -- situacao saudavel", () => {
  it("nao gera alerta nenhum", () => {
    expect(alertas("ok")).toHaveLength(0);
  });
});
