import { describe, expect, it } from "vitest";

import {
  MIN_TAMANHO_SENHA,
  PARAMETROS,
  hashPassword,
  verifyPassword,
} from "./password.mjs";

const SENHA = "senha-de-teste-forte-123";

describe("hashPassword", () => {
  it("gera o formato scrypt$N$r$p$salt$hash", async () => {
    const hash = await hashPassword(SENHA);
    const partes = hash.split("$");

    expect(partes).toHaveLength(6);
    expect(partes[0]).toBe("scrypt");
    expect(Number(partes[1])).toBe(PARAMETROS.N);
    expect(Number(partes[2])).toBe(PARAMETROS.r);
    expect(Number(partes[3])).toBe(PARAMETROS.p);
    expect(Buffer.from(partes[4], "base64")).toHaveLength(PARAMETROS.tamanhoSalt);
    expect(Buffer.from(partes[5], "base64")).toHaveLength(PARAMETROS.tamanhoChave);
  });

  it("nunca contem a senha em claro", async () => {
    const hash = await hashPassword(SENHA);
    expect(hash).not.toContain(SENHA);
  });

  it("usa salt novo a cada chamada", async () => {
    const [a, b] = await Promise.all([hashPassword(SENHA), hashPassword(SENHA)]);
    expect(a).not.toBe(b);
  });

  it("recusa senha abaixo do minimo", async () => {
    await expect(hashPassword("a".repeat(MIN_TAMANHO_SENHA - 1))).rejects.toThrow();
  });
});

describe("verifyPassword", () => {
  it("aceita a senha correta", async () => {
    const hash = await hashPassword(SENHA);
    await expect(verifyPassword(SENHA, hash)).resolves.toBe(true);
  });

  it("recusa senha errada", async () => {
    const hash = await hashPassword(SENHA);
    await expect(verifyPassword(`${SENHA}x`, hash)).resolves.toBe(false);
  });

  it("trata acento composto e decomposto como a mesma senha", async () => {
    // Mesma senha visivel, bytes diferentes: U+00E7 (c-cedilha pre-composto) na
    // primeira, U+0063 + U+0327 (c + cedilha combinante) na segunda. O
    // `not.toBe` abaixo protege o teste: se algum editor normalizar o arquivo e
    // igualar as duas, o teste falha em vez de passar sem testar nada.
    const composta = "sença-com-acento-1";
    const decomposta = "sença-com-acento-1";
    expect(composta).not.toBe(decomposta);

    const hash = await hashPassword(composta);
    await expect(verifyPassword(decomposta, hash)).resolves.toBe(true);
  });

  // Nenhum destes pode lancar: um throw viraria 500 na tela de login e
  // diferenciaria "hash corrompido" de "senha errada" para quem sondasse.
  it.each([
    ["string vazia", ""],
    ["formato de outro algoritmo", "$2b$10$abcdefghijklmnopqrstuv"],
    ["numero de campos errado", "scrypt$65536$8$salt$hash"],
    ["prefixo desconhecido", "pbkdf2$65536$8$1$c2FsdA==$aGFzaA=="],
    ["N nao numerico", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
    ["N absurdo (exaustao de memoria)", "scrypt$999999999$8$1$c2FsdA==$aGFzaA=="],
    ["salt vazio", "scrypt$65536$8$1$$aGFzaA=="],
  ])("recusa sem lancar: %s", async (_titulo, armazenado) => {
    await expect(verifyPassword(SENHA, armazenado)).resolves.toBe(false);
  });

  it("recusa quando o hash armazenado nao e string", async () => {
    // @ts-expect-error validando defesa contra dado inesperado do banco
    await expect(verifyPassword(SENHA, null)).resolves.toBe(false);
  });
});
