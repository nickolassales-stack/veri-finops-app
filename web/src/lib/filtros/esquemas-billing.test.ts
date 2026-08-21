import { describe, expect, it } from "vitest";

import {
  esquemaConfiguracaoFatura,
  esquemaStatusPagamento,
} from "./esquemas-billing";

const okCfg = (entrada: unknown) => esquemaConfiguracaoFatura.safeParse(entrada).success;
const okStatus = (entrada: unknown) => esquemaStatusPagamento.safeParse(entrada).success;

describe("esquemaConfiguracaoFatura", () => {
  it("aceita dias validos e a limpeza por null", () => {
    expect(okCfg({ invoiceCloseDay: 1 })).toBe(true);
    expect(okCfg({ invoiceCloseDay: 31 })).toBe(true);
    expect(okCfg({ invoiceCloseDay: null })).toBe(true);
    expect(okCfg({ invoiceDueDay: 10, invoiceCloseDay: 25 })).toBe(true);
  });

  it("recusa dia fora de 1..31", () => {
    expect(okCfg({ invoiceCloseDay: 0 })).toBe(false);
    expect(okCfg({ invoiceCloseDay: 32 })).toBe(false);
    expect(okCfg({ invoiceDueDay: 0 })).toBe(false);
    expect(okCfg({ invoiceDueDay: 40 })).toBe(false);
    expect(okCfg({ invoiceCloseDay: 10.5 })).toBe(false);
  });

  it("aceita antecedencia de 0 a 30 e recusa fora disso", () => {
    // 0 e valido e significa "avise apenas no dia".
    expect(okCfg({ invoiceNotificationDaysBefore: 0 })).toBe(true);
    expect(okCfg({ invoiceNotificationDaysBefore: 30 })).toBe(true);
    expect(okCfg({ invoiceNotificationDaysBefore: -1 })).toBe(false);
    expect(okCfg({ invoiceNotificationDaysBefore: 31 })).toBe(false);
  });

  it("aceita e-mail com arroba, recusa com espaco", () => {
    expect(okCfg({ billingContactEmail: "financeiro@porveri.com.br" })).toBe(true);
    expect(okCfg({ billingContactEmail: "conta@interno.local" })).toBe(true);
    expect(okCfg({ billingContactEmail: "sem arroba" })).toBe(false);
    expect(okCfg({ billingContactEmail: "com espaco@x.com" })).toBe(false);
  });

  it("trata string vazia como limpar o campo", () => {
    const r = esquemaConfiguracaoFatura.safeParse({ billingContactEmail: "" });
    expect(r.success && r.data.billingContactEmail).toBeNull();
  });

  it("recusa PATCH vazio e campo desconhecido", () => {
    expect(okCfg({})).toBe(false);
    expect(okCfg({ invoiceCloseDayy: 10 })).toBe(false);
    expect(okCfg({ paymentStatus: "paid" })).toBe(false);
  });
});

describe("esquemaStatusPagamento", () => {
  it("aceita as situacoes do vocabulario", () => {
    expect(okStatus({ paymentStatus: "pending" })).toBe(true);
    expect(okStatus({ paymentStatus: "overdue" })).toBe(true);
    expect(okStatus({ paymentStatus: "manual_review" })).toBe(true);
    expect(okStatus({ paymentStatus: "unknown" })).toBe(true);
    expect(okStatus({ paymentStatus: null })).toBe(true);
  });

  it("recusa o vocabulario ANTIGO, que a migracao 004 aposentou", () => {
    expect(okStatus({ paymentStatus: "em_dia" })).toBe(false);
    expect(okStatus({ paymentStatus: "isento" })).toBe(false);
  });

  it('exige data para marcar como "Pago"', () => {
    // A regra central desta entrega: pagamento afirmado sem saber QUANDO e
    // afirmacao sem evidencia. O banco tambem recusa; aqui a recusa vira erro
    // legivel em vez de 500.
    expect(okStatus({ paymentStatus: "paid" })).toBe(false);
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: null })).toBe(false);
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: "2026-08-10" })).toBe(true);
  });

  it("aponta o erro no campo da data, e nao no formulario inteiro", () => {
    const r = esquemaStatusPagamento.safeParse({ paymentStatus: "paid" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["paymentPaidAt"]);
      expect(r.error.issues[0].message).toContain("data do pagamento");
    }
  });

  it("nao exige data para as demais situacoes", () => {
    expect(okStatus({ paymentStatus: "pending" })).toBe(true);
    expect(okStatus({ paymentStatus: "overdue" })).toBe(true);
  });

  it("recusa data inexistente no calendario", () => {
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: "2026-02-31" })).toBe(false);
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: "2026-13-01" })).toBe(false);
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: "10/08/2026" })).toBe(false);
    expect(okStatus({ paymentStatus: "paid", paymentPaidAt: "2028-02-29" })).toBe(true);
  });

  it("NAO aceita a fonte vinda do cliente", () => {
    // A trava desta entrega: a fonte e cravada como 'manual' no servidor. Se
    // pudesse vir no corpo, uma requisicao forjada faria um valor digitado a
    // mao aparecer com o selo de "AWS Invoicing".
    expect(
      okStatus({
        paymentStatus: "paid",
        paymentPaidAt: "2026-08-10",
        paymentStatusSource: "aws_invoicing",
      }),
    ).toBe(false);
  });

  it("exige a situacao -- nao da para mandar so a observacao", () => {
    expect(okStatus({ paymentNotes: "conversei com o financeiro" })).toBe(false);
  });
});
