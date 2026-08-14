import { describe, expect, it } from "vitest";

import type { AgendaEtl } from "./agenda";
import {
  duracaoSegundos,
  mesesFaltando,
  montarAlertas,
  redigirErro,
  situacaoDoEtl,
  type EntradaAlertas,
  type ExecucaoEtl,
  type FrescorConta,
  type LimitesDiagnostico,
} from "./etl";

const AGENDA: AgendaEtl = {
  hora: 8,
  minuto: 0,
  fuso: "Etc/UTC",
  toleranciaMinutos: 90,
};

const LIMITES: LimitesDiagnostico = {
  execucaoOrfaMinutos: 120,
  diasSemAtualizacao: 3,
};

function execucao(parcial: Partial<ExecucaoEtl> = {}): ExecucaoEtl {
  return {
    id: "1",
    iniciadaEm: "2026-08-14T08:00:00.000Z",
    finalizadaEm: "2026-08-14T08:00:12.000Z",
    status: "success",
    origem: "cron",
    linhasMensais: 50,
    linhasDiarias: 885,
    erro: null,
    caminhoDoLog: "/opt/finops/etl.log",
    ...parcial,
  };
}

function conta(parcial: Partial<FrescorConta> = {}): FrescorConta {
  return {
    accountId: "800168045394",
    nomeExibicao: "Produção — TI",
    ultimaUsageDate: "2026-08-13",
    ultimoBillingMonth: "2026-08-01",
    primeiroBillingMonth: "2026-07-01",
    linhasDiarias: 800,
    linhasMensais: 40,
    totalLinhas: 840,
    mesesDisponiveis: 2,
    linhaMaisNovaEm: "2026-08-14T08:00:10.000Z",
    mesesPresentes: ["2026-07", "2026-08"],
    ...parcial,
  };
}

// ---------------------------------------------------------------- situacao

describe("situacaoDoEtl", () => {
  it("diz 'nunca executado' sem nenhuma linha", () => {
    expect(situacaoDoEtl(null, new Date("2026-08-14T15:00:00Z"), AGENDA, LIMITES)).toBe(
      "nunca_executado",
    );
  });

  it("diz 'ok' logo depois de uma carga bem-sucedida", () => {
    const agora = new Date("2026-08-14T09:00:00Z");
    expect(situacaoDoEtl(execucao(), agora, AGENDA, LIMITES)).toBe("ok");
  });

  it("continua 'ok' de madrugada, quando a carga do dia ainda nao e devida", () => {
    // 04:00 UTC do dia 15: a proxima e as 08:00; a de ontem vale.
    const agora = new Date("2026-08-15T04:00:00Z");
    expect(situacaoDoEtl(execucao(), agora, AGENDA, LIMITES)).toBe("ok");
  });

  it("diz 'atrasado' quando a carga do dia nao veio e a tolerancia passou", () => {
    const agora = new Date("2026-08-15T09:31:00Z");
    expect(situacaoDoEtl(execucao(), agora, AGENDA, LIMITES)).toBe("atrasado");
  });

  it("nao diz 'atrasado' dentro da tolerancia", () => {
    const agora = new Date("2026-08-15T09:29:00Z");
    expect(situacaoDoEtl(execucao(), agora, AGENDA, LIMITES)).toBe("ok");
  });

  it("diz 'erro' quando a ultima execucao falhou", () => {
    const falha = execucao({ status: "failed", erro: "Athena query failed" });
    expect(situacaoDoEtl(falha, new Date("2026-08-14T09:00:00Z"), AGENDA, LIMITES)).toBe(
      "erro",
    );
  });

  it("diz 'executando' enquanto a carga esta aberta ha pouco", () => {
    const rodando = execucao({ status: "running", finalizadaEm: null });
    expect(situacaoDoEtl(rodando, new Date("2026-08-14T08:00:30Z"), AGENDA, LIMITES)).toBe(
      "executando",
    );
  });

  it("diz 'erro' -- e nao 'executando' -- quando a carga esta aberta ha tempo demais", () => {
    // O caso do processo morto por OOM: ninguem fecha a linha, e chama-la de
    // "em execucao" faria o painel afirmar que ha uma carga trabalhando ha
    // cinco horas.
    const rodando = execucao({ status: "running", finalizadaEm: null });
    expect(situacaoDoEtl(rodando, new Date("2026-08-14T13:00:00Z"), AGENDA, LIMITES)).toBe(
      "erro",
    );
  });
});

describe("duracaoSegundos", () => {
  it("mede o intervalo entre inicio e fim", () => {
    expect(duracaoSegundos(execucao())).toBe(12);
  });

  it("devolve null enquanto a execucao nao terminou", () => {
    expect(duracaoSegundos(execucao({ status: "running", finalizadaEm: null }))).toBeNull();
  });
});

// ------------------------------------------------------------ meses faltando

describe("mesesFaltando", () => {
  it("acha o buraco no meio da serie", () => {
    const c = conta({
      primeiroBillingMonth: "2026-06-01",
      ultimoBillingMonth: "2026-09-01",
      mesesPresentes: ["2026-06", "2026-09"],
    });
    expect(mesesFaltando(c)).toEqual(["2026-07", "2026-08"]);
  });

  it("nao acusa nada quando a serie e continua", () => {
    expect(mesesFaltando(conta())).toEqual([]);
  });

  it("ignora as PONTAS: mes anterior ao primeiro dado nao e buraco", () => {
    // Conta que so existe desde agosto nao tem "julho faltando" -- ela nao
    // existia em julho. Acusar isso encheria a tela de alerta falso.
    const c = conta({
      primeiroBillingMonth: "2026-08-01",
      ultimoBillingMonth: "2026-08-01",
      mesesPresentes: ["2026-08"],
    });
    expect(mesesFaltando(c)).toEqual([]);
  });

  it("devolve vazio quando nao ha mes nenhum", () => {
    const c = conta({
      primeiroBillingMonth: null,
      ultimoBillingMonth: null,
      mesesPresentes: [],
    });
    expect(mesesFaltando(c)).toEqual([]);
  });
});

// -------------------------------------------------------------------- redacao

describe("redigirErro", () => {
  it("redige senha em string de conexao do psycopg2", () => {
    const bruto =
      "OperationalError: connection to server failed: " +
      "host=127.0.0.1 user=finops_user password=SenhaDeProducao123 dbname=finops";
    const limpo = redigirErro(bruto);
    expect(limpo).not.toContain("SenhaDeProducao123");
    expect(limpo).toContain("password=***");
    // O resto da mensagem sobrevive: sem ele o alerta nao ajuda ninguem.
    expect(limpo).toContain("connection to server failed");
  });

  it("redige senha em URI", () => {
    const limpo = redigirErro("could not connect: postgresql://finops_user:abc123@10.0.0.1:5432/finops");
    expect(limpo).not.toContain("abc123");
    expect(limpo).toContain("finops_user:***@");
  });

  it("redige chave de acesso da AWS", () => {
    const limpo = redigirErro("ClientError: invalid key AKIAIOSFODNN7EXAMPLE used");
    expect(limpo).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redige eco de variavel de ambiente", () => {
    const limpo = redigirErro("KeyError while reading PG_PASSWORD: hunter2hunter2");
    expect(limpo).not.toContain("hunter2hunter2");
  });

  it("trunca mensagem gigante em vez de despejar log inteiro na tela", () => {
    const limpo = redigirErro("x".repeat(2000));
    expect(limpo).toHaveLength(500);
    expect(limpo?.endsWith("…")).toBe(true);
  });

  it("trata ausencia e string vazia como ausencia", () => {
    expect(redigirErro(null)).toBeNull();
    expect(redigirErro("   ")).toBeNull();
  });
});

// -------------------------------------------------------------------- alertas

function entrada(parcial: Partial<EntradaAlertas> = {}): EntradaAlertas {
  return {
    situacao: "ok",
    ultima: execucao(),
    contas: [conta()],
    agora: new Date("2026-08-14T12:00:00Z"),
    agenda: AGENDA,
    limites: LIMITES,
    fusoDaTela: "America/Sao_Paulo",
    monitoramentoInstalado: true,
    ...parcial,
  };
}

const chaves = (e: EntradaAlertas) => montarAlertas(e).map((a) => a.chave);

describe("montarAlertas", () => {
  it("nao inventa alerta quando esta tudo em ordem", () => {
    expect(montarAlertas(entrada())).toEqual([]);
  });

  it("com a migracao ausente, diz SO isso -- e nao 'nenhuma conta com dado'", () => {
    // Sem os objetos da 003 a consulta de frescor nao roda, entao a lista de
    // contas chega vazia. Deduzir dai que nao ha dado de custo seria falso: o
    // dado esta la, quem falta e a consulta.
    const alertas = montarAlertas(
      entrada({ monitoramentoInstalado: false, contas: [], ultima: null }),
    );
    expect(alertas.map((a) => a.chave)).toEqual(["monitoramento-ausente"]);
  });

  it("marca falha da ultima execucao como critica e repassa a mensagem", () => {
    const alertas = montarAlertas(
      entrada({
        situacao: "erro",
        ultima: execucao({ status: "failed", erro: "Athena query failed: FAILED" }),
      }),
    );
    const falha = alertas.find((a) => a.chave === "etl-falhou");
    expect(falha?.tom).toBe("critico");
    expect(falha?.detalhe).toContain("Athena query failed");
  });

  it("distingue execucao interrompida de execucao em andamento", () => {
    const rodando = execucao({ status: "running", finalizadaEm: null });
    expect(chaves(entrada({ situacao: "executando", ultima: rodando }))).not.toContain(
      "etl-interrompido",
    );
    expect(chaves(entrada({ situacao: "erro", ultima: rodando }))).toContain(
      "etl-interrompido",
    );
  });

  it("acusa atraso citando o horario no fuso de quem le", () => {
    const alertas = montarAlertas(entrada({ situacao: "atrasado" }));
    const atraso = alertas.find((a) => a.chave === "etl-atrasado");
    // 08:00 UTC lidos em Sao Paulo sao 05:00 -- e e assim que a tela precisa
    // dizer, senao a pessoa procura uma carga que nunca foi agendada para as 8h.
    expect(atraso?.detalhe).toContain("05:00");
  });

  it("avisa quando a conta nao tem dado no mes corrente", () => {
    const parada = conta({ ultimoBillingMonth: "2026-07-01", mesesPresentes: ["2026-07"] });
    expect(chaves(entrada({ contas: [parada] }))).toContain(
      `sem-mes-corrente-${parada.accountId}`,
    );
  });

  it("avisa quando a conta esta ha mais dias que o limite sem dado novo", () => {
    const antiga = conta({ ultimaUsageDate: "2026-08-01" });
    const alertas = montarAlertas(entrada({ contas: [antiga] }));
    const parada = alertas.find((a) => a.chave === `parada-${antiga.accountId}`);
    expect(parada?.titulo).toContain("13 dias");
  });

  it("nao acusa conta parada dentro do limite -- o CUR atrasa um dia por natureza", () => {
    expect(chaves(entrada())).not.toContain(`parada-${conta().accountId}`);
  });

  it("avisa quando a conta tem custo mensal e nenhuma linha diaria", () => {
    const semDiario = conta({ ultimaUsageDate: null, linhasDiarias: 0 });
    expect(chaves(entrada({ contas: [semDiario] }))).toContain(
      `sem-diario-${semDiario.accountId}`,
    );
  });

  it("avisa quando falta mes no meio da serie da conta", () => {
    const comBuraco = conta({
      primeiroBillingMonth: "2026-06-01",
      ultimoBillingMonth: "2026-08-01",
      mesesPresentes: ["2026-06", "2026-08"],
    });
    const alertas = montarAlertas(entrada({ contas: [comBuraco] }));
    const buraco = alertas.find((a) => a.chave === `buraco-mensal-${comBuraco.accountId}`);
    expect(buraco?.detalhe).toContain("2026-07");
  });

  it("acusa banco sem nenhuma conta como critico", () => {
    expect(chaves(entrada({ contas: [] }))).toContain("sem-contas");
  });

  it("ordena o critico antes do resto", () => {
    const alertas = montarAlertas(
      entrada({
        situacao: "erro",
        ultima: execucao({ status: "failed", erro: "x" }),
        contas: [conta({ ultimoBillingMonth: "2026-07-01" })],
      }),
    );
    expect(alertas[0].tom).toBe("critico");
    expect(alertas.at(-1)?.tom).toBe("atencao");
  });

  it("usa o fuso DA TELA para decidir qual e o mes corrente", () => {
    // 01/09 00:30 UTC ainda e 31/08 em Sao Paulo. Uma conta com dado ate agosto
    // esta em dia para quem le em Sao Paulo, e atrasada para quem le em UTC.
    const viradaDoMes = new Date("2026-09-01T00:30:00Z");
    const emAgosto = conta({ ultimoBillingMonth: "2026-08-01", ultimaUsageDate: "2026-08-31" });

    expect(
      chaves(entrada({ agora: viradaDoMes, contas: [emAgosto], fusoDaTela: "America/Sao_Paulo" })),
    ).not.toContain(`sem-mes-corrente-${emAgosto.accountId}`);

    expect(
      chaves(entrada({ agora: viradaDoMes, contas: [emAgosto], fusoDaTela: "Etc/UTC" })),
    ).toContain(`sem-mes-corrente-${emAgosto.accountId}`);
  });
});
