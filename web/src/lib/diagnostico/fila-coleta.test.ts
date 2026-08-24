import { describe, expect, it } from "vitest";

import { avaliarFilaParada, MINUTOS_SEM_WORKER, type JobNaFila } from "./fila-coleta";

const AGORA = new Date("2026-08-24T18:00:00Z");

function job(status: string, minutosAtras: number, accountId = "ovh-main-ca"): JobNaFila {
  return {
    accountId,
    status,
    requestedAt: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(),
  };
}

describe("avaliarFilaParada", () => {
  it("fila vazia não alerta", () => {
    expect(avaliarFilaParada([], AGORA)).toBeNull();
  });

  it("job recém-enfileirado não alerta", () => {
    // O worker roda de poucos em poucos minutos; alertar no primeiro minuto
    // faria o alerta aparecer em toda coleta normal e perder o sentido.
    expect(avaliarFilaParada([job("queued", 2)], AGORA)).toBeNull();
  });

  it("job em queued que envelheceu alerta", () => {
    const a = avaliarFilaParada([job("queued", MINUTOS_SEM_WORKER + 5)], AGORA);
    expect(a?.chave).toBe("fila-coleta-parada");
  });

  it("o alerta nomeia a conta", () => {
    // Com várias contas, "há coleta parada" obrigaria a descobrir qual por
    // tentativa e erro.
    const a = avaliarFilaParada([job("queued", 60, "ovh-outra-ca")], AGORA);
    expect(a?.detalhe).toContain("ovh-outra-ca");
  });

  it("running velho NÃO alerta — já tem dono", () => {
    // `reabrir_orfaos` devolve à fila o que passou de 30 min. Alertar aqui
    // competiria com uma recuperação automática em curso e mandaria investigar
    // o que vai se resolver sozinho.
    expect(avaliarFilaParada([job("running", 120)], AGORA)).toBeNull();
  });

  it("job terminal nunca alerta, por mais antigo que seja", () => {
    // Este é o estado de REPOUSO da fila — o mesmo que derrubava a página.
    for (const status of ["success", "failed", "cancelled"]) {
      expect(avaliarFilaParada([job(status, 60 * 24 * 30)], AGORA), status).toBeNull();
    }
  });

  it("é atenção, não crítico: nada foi perdido", () => {
    // A fila é durável — o job roda quando o worker voltar. O que está errado é
    // a expectativa de que já tenha rodado, não o dado.
    expect(avaliarFilaParada([job("queued", 60)], AGORA)?.tom).toBe("atencao");
  });

  it("singular e plural", () => {
    const um = avaliarFilaParada([job("queued", 60, "ovh-a-ca")], AGORA);
    const dois = avaliarFilaParada(
      [job("queued", 60, "ovh-a-ca"), job("queued", 60, "ovh-b-ca")],
      AGORA,
    );
    expect(um?.titulo).toContain("1 coleta enfileirada");
    expect(dois?.titulo).toContain("2 coletas");
  });

  it("a espera aparece na unidade certa", () => {
    expect(avaliarFilaParada([job("queued", 20)], AGORA)?.detalhe).toContain("20 minutos");
    expect(avaliarFilaParada([job("queued", 60 * 3)], AGORA)?.detalhe).toContain("3 horas");
    expect(avaliarFilaParada([job("queued", 60 * 24 * 4)], AGORA)?.detalhe).toContain("4 dias");
  });

  it("não conta a mesma conta duas vezes na lista de nomes", () => {
    const a = avaliarFilaParada([job("queued", 60), job("queued", 90)], AGORA);
    expect(a?.detalhe.match(/ovh-main-ca/g)).toHaveLength(1);
  });

  it("mistura de estados considera só o que está parado", () => {
    // Ids realistas de proposito: um id de uma letra casa com a prosa do
    // proprio alerta ("Confira", "coleta") e o teste passaria a medir o texto
    // em vez da regra.
    const a = avaliarFilaParada(
      [
        job("success", 500, "ovh-feita-ca"),
        job("queued", 60, "ovh-parada-ca"),
        job("running", 500, "ovh-rodando-ca"),
      ],
      AGORA,
    );
    expect(a?.titulo).toContain("1 coleta");
    expect(a?.detalhe).toContain("ovh-parada-ca");
    expect(a?.detalhe).not.toContain("ovh-rodando-ca");
    expect(a?.detalhe).not.toContain("ovh-feita-ca");
  });
});
