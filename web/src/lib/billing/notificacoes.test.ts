import { describe, expect, it } from "vitest";

import { CANAIS, montarAvisos, type ContaParaAviso } from "./notificacoes";

/**
 * Um aviso errado tem dois custos opostos, e os dois aparecem aqui:
 * avisar demais treina quem le a ignorar a tela; deixar de avisar de uma fatura
 * vencida e o que a tela existe para impedir.
 */

const conta = (parcial: Partial<ContaParaAviso> = {}): ContaParaAviso => ({
  accountId: "800168045394",
  nomeExibicao: "Produção — TI",
  configuracao: { diaDeFechamento: 25, diaDeVencimento: 10, diasDeAviso: 5 },
  status: null,
  fonte: "unknown",
  vencimentoRegistrado: null,
  ...parcial,
});

const chaves = (contas: ContaParaAviso[], hoje: string) =>
  montarAvisos(contas, hoje).map((a) => a.chave);

describe("montarAvisos -- fechamento", () => {
  it("fica em silencio longe do fechamento e com a fatura anterior paga", () => {
    const paga = conta({ status: "paid", fonte: "manual" });
    expect(montarAvisos([paga], "2026-08-14")).toEqual([]);
  });

  it("avisa dentro da antecedencia configurada", () => {
    const c = conta({ status: "paid" });
    expect(chaves([c], "2026-08-19")).not.toContain(`fecha-em-breve-${c.accountId}`);
    expect(chaves([c], "2026-08-20")).toContain(`fecha-em-breve-${c.accountId}`);
  });

  it("avisa no dia do fechamento, com tom proprio", () => {
    const c = conta({ status: "paid" });
    const avisos = montarAvisos([c], "2026-08-25");
    const hoje = avisos.find((a) => a.chave === `fecha-hoje-${c.accountId}`);
    expect(hoje?.tom).toBe("atencao");
    expect(hoje?.detalhe).toContain("2026-08-25");
  });

  it("uma conta com aviso de 0 dias so avisa no proprio dia", () => {
    const c = conta({
      status: "paid",
      configuracao: { diaDeFechamento: 25, diaDeVencimento: 10, diasDeAviso: 0 },
    });
    expect(chaves([c], "2026-08-24")).toEqual([]);
    expect(chaves([c], "2026-08-25")).toContain(`fecha-hoje-${c.accountId}`);
  });
});

describe("montarAvisos -- pagamento", () => {
  it("avisa que a fatura fechou e o pagamento nao esta confirmado", () => {
    // Fecha dia 25, vence dia 10 do mes seguinte. Em 01/09 a de agosto fechou
    // e ainda nao venceu.
    const avisos = montarAvisos([conta()], "2026-09-01");
    const a = avisos.find((x) => x.chave.startsWith("aguardando-pagamento"));
    expect(a?.tom).toBe("atencao");
    expect(a?.titulo).toContain("fechou há 7 dias");
  });

  it("escala para critico depois do vencimento", () => {
    const avisos = montarAvisos([conta()], "2026-09-15");
    const a = avisos.find((x) => x.chave.startsWith("vencida"));
    expect(a?.tom).toBe("critico");
    expect(a?.detalhe).toContain("2026-09-10");
    expect(a?.detalhe).toContain("5 dia(s)");
  });

  it("nao cobra pagamento de fatura marcada como paga", () => {
    expect(chaves([conta({ status: "paid" })], "2026-09-15")).toEqual([]);
  });

  it("nao cobra fatura em revisao manual -- ela ja esta com alguem", () => {
    expect(chaves([conta({ status: "manual_review" })], "2026-09-15")).toEqual([]);
  });

  it("continua cobrando o que foi marcado como pendente ou vencido", () => {
    expect(chaves([conta({ status: "pending" })], "2026-09-15")).toContain(
      "vencida-800168045394",
    );
    expect(chaves([conta({ status: "overdue" })], "2026-09-15")).toContain(
      "vencida-800168045394",
    );
  });

  it("o vencimento registrado a mao vence a regra mensal", () => {
    // A regra daria 10/09; a prorrogacao registrada diz 30/09. Em 15/09 nao ha
    // atraso nenhum -- e usar a regra acusaria uma conta que esta em dia.
    const prorrogada = conta({ vencimentoRegistrado: "2026-09-30" });
    const avisos = montarAvisos([prorrogada], "2026-09-15");
    expect(avisos.map((a) => a.chave)).toContain("aguardando-pagamento-800168045394");
    expect(avisos.map((a) => a.chave)).not.toContain("vencida-800168045394");
  });

  it("sem dia de vencimento, avisa mas nao afirma atraso", () => {
    const semVencimento = conta({
      configuracao: { diaDeFechamento: 25, diaDeVencimento: null, diasDeAviso: 5 },
    });
    const a = montarAvisos([semVencimento], "2026-09-15")[0];
    expect(a.chave).toBe("aguardando-pagamento-800168045394");
    expect(a.detalhe).toContain("não há como dizer se está atrasada");
  });
});

describe("montarAvisos -- sem configuracao", () => {
  it("acusa a falta em vez de ficar em silencio", () => {
    // Silencio aqui seria lido como "esta tudo bem", quando o certo e "nao da
    // para saber".
    const sem = conta({
      configuracao: { diaDeFechamento: null, diaDeVencimento: null, diasDeAviso: 5 },
    });
    const avisos = montarAvisos([sem], "2026-08-14");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].chave).toBe("sem-fechamento-800168045394");
    expect(avisos[0].tom).toBe("info");
  });
});

describe("montarAvisos -- ordem e identificacao", () => {
  it("poe o critico antes do resto", () => {
    const vencida = conta({ accountId: "111", nomeExibicao: "Vencida" });
    const proxima = conta({
      accountId: "222",
      nomeExibicao: "Próxima",
      status: "paid",
      configuracao: { diaDeFechamento: 20, diaDeVencimento: 10, diasDeAviso: 5 },
    });

    const avisos = montarAvisos([proxima, vencida], "2026-09-15");
    expect(avisos[0].tom).toBe("critico");
  });

  it("todo aviso carrega o account_id junto do nome", () => {
    for (const a of montarAvisos([conta()], "2026-09-15")) {
      expect(a.accountId).toBe("800168045394");
      expect(a.conta).toContain("800168045394");
      expect(a.conta).toContain("Produção — TI");
    }
  });
});

describe("CANAIS", () => {
  it("declara o portal como o unico canal disponivel", () => {
    const disponiveis = CANAIS.filter((c) => c.disponivel).map((c) => c.chave);
    expect(disponiveis).toEqual(["in_app"]);
  });

  it("todo canal indisponivel explica o motivo", () => {
    // Sem o motivo, a tela diria apenas "e-mail: não" e alguem tentaria
    // descobrir se e defeito ou decisao.
    for (const canal of CANAIS.filter((c) => !c.disponivel)) {
      expect(canal.motivo, `canal ${canal.chave}`).toBeTruthy();
    }
  });
});
