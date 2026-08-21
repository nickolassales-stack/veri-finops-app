import { describe, expect, it } from "vitest";

import { assinar, sanitizar } from "./protocolo";

/**
 * `sanitizar` e a ultima barreira antes de um texto virar
 * `last_validation_error` -- coluna que a tela de Contas Cloud EXIBE. Se ela
 * falhar, uma mensagem de erro da OVH que ecoe a credencial a publica em claro,
 * anulando toda a cifragem.
 */

describe("sanitizar: segredo nao passa", () => {
  it("recorta sequencia longa com forma de credencial", () => {
    const chave = "aBcDeF1234567890GhIjKl";
    const saida = sanitizar(`Invalid signature for key ${chave}`);
    expect(saida).not.toContain(chave);
    expect(saida).toContain("<omitido>");
  });

  it("recorta MAIS DE UM segredo na mesma mensagem", () => {
    const a = "AAAAAAAAAAAAAAAAAAAA";
    const b = "BBBBBBBBBBBBBBBBBBBB";
    const saida = sanitizar(`falhou com ${a} e ${b}`);
    expect(saida).not.toContain(a);
    expect(saida).not.toContain(b);
  });

  it("recorta base64 com + e /", () => {
    const token = "ab+cd/efghijklmnop+qrs";
    expect(sanitizar(`token ${token}`)).not.toContain(token);
  });

  it("recorta hex longo", () => {
    const hex = "a".repeat(64);
    expect(sanitizar(`fingerprint ${hex}`)).not.toContain(hex);
  });

  it("no limite de 16 caracteres, recorta", () => {
    const dezesseis = "a1B2c3D4e5F6g7H8";
    expect(dezesseis).toHaveLength(16);
    expect(sanitizar(dezesseis)).toBe("<omitido>");
  });

  it("abaixo do limite, preserva -- palavra curta nao e segredo", () => {
    expect(sanitizar("Forbidden")).toBe("Forbidden");
    expect(sanitizar("erro 403")).toBe("erro 403");
  });

  it("preserva o texto util em volta", () => {
    const saida = sanitizar("A OVH recusou a chave ABCDEFGHIJKLMNOPQRST no endpoint");
    expect(saida).toContain("A OVH recusou a chave");
    expect(saida).toContain("no endpoint");
  });

  it("colapsa espaco e quebra de linha", () => {
    expect(sanitizar("linha um\n\n  linha  dois")).toBe("linha um linha dois");
  });

  it("respeita o limite de tamanho, com reticencia", () => {
    const saida = sanitizar("palavra ".repeat(200), 50);
    expect(saida.length).toBeLessThanOrEqual(53);
    expect(saida.endsWith("...")).toBe(true);
  });

  it("texto vazio nao quebra", () => {
    expect(sanitizar("")).toBe("");
    expect(sanitizar("   ")).toBe("");
  });

  it("uma credencial REAL da OVH nao sobrevive", () => {
    // Formato tipico: 16 e 32 caracteres alfanumericos.
    for (const forma of ["a1b2c3d4e5f6g7h8", "A".repeat(32), "z9Y8x7W6v5U4t3S2r1Q0"]) {
      expect(sanitizar(`chave=${forma}`)).not.toContain(forma);
    }
  });
});

describe("assinar", () => {
  const AS = "segredo";
  const CK = "consumidor";
  const URL = "https://ca.api.ovh.com/1.0/me";

  it("prefixo $1$ e 40 hex -- o formato que a OVH espera", () => {
    expect(assinar(AS, CK, "GET", URL, "", 1_700_000_000)).toMatch(/^\$1\$[0-9a-f]{40}$/);
  });

  it("deterministica: mesma entrada, mesma assinatura", () => {
    const a = assinar(AS, CK, "GET", URL, "", 1_700_000_000);
    const b = assinar(AS, CK, "GET", URL, "", 1_700_000_000);
    expect(a).toBe(b);
  });

  it("cada campo entra de fato na assinatura", () => {
    const base = assinar(AS, CK, "GET", URL, "", 1_700_000_000);
    expect(assinar("outro", CK, "GET", URL, "", 1_700_000_000)).not.toBe(base);
    expect(assinar(AS, "outro", "GET", URL, "", 1_700_000_000)).not.toBe(base);
    expect(assinar(AS, CK, "POST", URL, "", 1_700_000_000)).not.toBe(base);
    expect(assinar(AS, CK, "GET", `${URL}/x`, "", 1_700_000_000)).not.toBe(base);
    expect(assinar(AS, CK, "GET", URL, "{}", 1_700_000_000)).not.toBe(base);
    expect(assinar(AS, CK, "GET", URL, "", 1_700_000_001)).not.toBe(base);
  });

  it("timestamp diferente muda a assinatura -- e o que impede replay", () => {
    const a = assinar(AS, CK, "GET", URL, "", 1_700_000_000);
    const b = assinar(AS, CK, "GET", URL, "", 1_700_000_060);
    expect(a).not.toBe(b);
  });

  it("a assinatura nao contem o secret", () => {
    expect(assinar(AS, CK, "GET", URL, "", 1_700_000_000)).not.toContain(AS);
  });

  it("URL relativa produz assinatura DIFERENTE da absoluta", () => {
    // Registra o erro classico: a OVH assina a URL absoluta, e usar `/me` gera
    // um 403 que se parece com credencial invalida.
    expect(assinar(AS, CK, "GET", "/me", "", 1_700_000_000)).not.toBe(
      assinar(AS, CK, "GET", URL, "", 1_700_000_000),
    );
  });
});
