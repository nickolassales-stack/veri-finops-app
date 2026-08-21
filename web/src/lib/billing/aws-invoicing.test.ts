import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O que estes testes protegem
 * ---------------------------
 * Uma unica coisa, e ela e a razao de o modulo existir: **o portal nao pode
 * marcar uma fatura como paga sem evidencia**. A integracao com a AWS esta
 * desligada, e ligar a flag por engano nao pode transformar isso em status
 * fabricado na tela.
 *
 * `vi.resetModules()` entre os casos porque `getEnv()` memoiza a leitura do
 * ambiente na primeira chamada -- sem o reset, o segundo caso leria a
 * configuracao do primeiro.
 */

const AMBIENTE_MINIMO = {
  PG_HOST: "127.0.0.1",
  PG_DB: "finops",
  PG_USER: "finops_app",
  PG_PASSWORD: "irrelevante-para-este-teste",
};

const original = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, AMBIENTE_MINIMO);
});

afterEach(() => {
  process.env = { ...original };
});

async function carregar(flag?: string) {
  if (flag === undefined) delete process.env.AWS_INVOICING_ENABLED;
  else process.env.AWS_INVOICING_ENABLED = flag;
  return import("./aws-invoicing");
}

describe("com a flag ausente (o padrao de producao)", () => {
  it("a integracao nasce desligada", async () => {
    const m = await carregar(undefined);
    expect(m.invoicingHabilitado()).toBe(false);
  });

  it("a consulta responde indisponivel, sem lancar excecao", async () => {
    const m = await carregar(undefined);
    const r = await m.consultarSituacaoNaAws({
      accountId: "800168045394",
      competencia: "2026-08",
    });

    expect(r.disponivel).toBe(false);
    if (!r.disponivel) {
      expect(r.motivo).toContain("AWS_INVOICING_ENABLED=false");
      expect(r.motivo).toContain("manualmente");
    }
  });
});

describe("com a flag ligada", () => {
  it("continua sem integracao -- e diz isso, em vez de inventar status", async () => {
    // Ligar a flag nao cria credencial, SDK nem rede. O ramo existe para que
    // ligar por engano produza uma mensagem clara, e nao um "pago" fabricado.
    const m = await carregar("true");
    expect(m.invoicingHabilitado()).toBe(true);

    const r = await m.consultarSituacaoNaAws({
      accountId: "800168045394",
      competencia: "2026-08",
    });
    expect(r.disponivel).toBe(false);
    if (!r.disponivel) expect(r.motivo).toContain("não há integração implementada");
  });

  it("aceita 1 como equivalente a true", async () => {
    const m = await carregar("1");
    expect(m.invoicingHabilitado()).toBe(true);
  });
});

describe("gravacao automatica", () => {
  it("e recusada em qualquer cenario", async () => {
    const m = await carregar("true");

    // Inclusive diante de uma resposta que AFIRMA estar disponivel e paga --
    // o caso que existiria se a implementacao chegasse sem validacao.
    const respostaOtimista = {
      disponivel: true as const,
      status: "paid" as const,
      fonte: "aws_invoicing" as const,
      referencia: "INV-123",
      evidencia: "resposta da API",
    };

    expect(m.podeGravarAutomaticamente(respostaOtimista)).toBe(false);
    expect(
      m.podeGravarAutomaticamente({ disponivel: false, motivo: "qualquer" }),
    ).toBe(false);
  });
});

describe("LIMITACOES", () => {
  it("dizem, em portugues, que o CUR nao responde sobre pagamento", async () => {
    const m = await carregar(undefined);
    expect(m.LIMITACOES.length).toBeGreaterThan(0);
    expect(m.LIMITACOES.join(" ")).toMatch(/CUR/);
    expect(m.LIMITACOES.join(" ")).toMatch(/NÃO informa se a fatura foi paga/);
  });
});
