import { describe, expect, it } from "vitest";

import { MIN_TAMANHO_SENHA } from "./password.mjs";
import { validarTrocaSenha } from "./troca-senha";

const VALIDA = {
  senhaAtual: "senha-atual-valida",
  novaSenha: "senha-nova-bem-forte",
  confirmacao: "senha-nova-bem-forte",
};

describe("validarTrocaSenha", () => {
  it("aceita dados corretos", () => {
    expect(validarTrocaSenha(VALIDA)).toBeNull();
  });

  it("exige a senha atual", () => {
    expect(validarTrocaSenha({ ...VALIDA, senhaAtual: "" })).toMatch(/senha atual/i);
  });

  it("recusa nova senha abaixo do minimo", () => {
    const curta = "a".repeat(MIN_TAMANHO_SENHA - 1);
    expect(
      validarTrocaSenha({ ...VALIDA, novaSenha: curta, confirmacao: curta }),
    ).toMatch(new RegExp(`${MIN_TAMANHO_SENHA} caracteres`));
  });

  it("recusa confirmacao divergente", () => {
    expect(
      validarTrocaSenha({ ...VALIDA, confirmacao: "outra-coisa-qualquer" }),
    ).toMatch(/confirma/i);
  });

  it("recusa nova senha igual a atual", () => {
    expect(
      validarTrocaSenha({
        senhaAtual: VALIDA.novaSenha,
        novaSenha: VALIDA.novaSenha,
        confirmacao: VALIDA.novaSenha,
      }),
    ).toMatch(/diferente da atual/i);
  });

  it("recusa entrada que nao e objeto", () => {
    expect(validarTrocaSenha(null)).not.toBeNull();
    expect(validarTrocaSenha("texto")).not.toBeNull();
  });
});
