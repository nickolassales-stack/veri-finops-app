import { describe, expect, it } from "vitest";

import { destinoInternoValido, montarUrlLogin } from "./destino";

describe("destinoInternoValido", () => {
  it.each([
    "/dashboard",
    "/dashboard/analitico",
    "/diagnostico?x=1",
    "/dashboard#topo",
  ])("aceita caminho interno: %s", (destino) => {
    expect(destinoInternoValido(destino)).toBe(true);
  });

  // Cada um destes, se aceito, viraria redirecionamento aberto: o usuario faz
  // login no dominio legitimo e e jogado num site controlado por terceiro.
  it.each([
    ["protocolo absoluto", "https://evil.com"],
    ["sem esquema", "//evil.com"],
    ["barra invertida", "/\\evil.com"],
    ["javascript:", "javascript:alert(1)"],
    ["caminho relativo", "dashboard"],
    ["vazio", ""],
    ["quebra de linha (injecao de header)", "/dashboard\nLocation: https://evil.com"],
    ["byte nulo", "/dashboard\u0000"],
  ])("recusa %s", (_titulo, destino) => {
    expect(destinoInternoValido(destino)).toBe(false);
  });
});

describe("montarUrlLogin", () => {
  it("sem destino, volta /login puro", () => {
    expect(montarUrlLogin()).toBe("/login");
  });

  it("preserva o destino interno codificado", () => {
    expect(montarUrlLogin("/dashboard/analitico")).toBe(
      "/login?next=%2Fdashboard%2Fanalitico",
    );
  });

  it("descarta destino externo em vez de propaga-lo", () => {
    expect(montarUrlLogin("https://evil.com")).toBe("/login");
    expect(montarUrlLogin("//evil.com")).toBe("/login");
  });
});
