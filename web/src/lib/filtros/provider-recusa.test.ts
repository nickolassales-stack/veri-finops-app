import { describe, expect, it } from "vitest";

import { mensagemDeProviderIncompativel } from "./provider";

/**
 * A barreira que impede uma conta OVH de virar "US$ 0,00" numa tela AWS.
 *
 * A regra e testada aqui, pura. O SQL que descobre o provider de cada conta foi
 * validado a parte, executado contra o PostgreSQL de producao -- sao duas
 * perguntas diferentes, cada uma respondida onde pode ser respondida de
 * verdade.
 *
 * `services/filtro-custo.ts` chama esta funcao e transforma a mensagem em 400.
 * Ele e o funil de TODA leitura de custo AWS -- cinco endpoints do painel, tres
 * do analitico e as duas exportacoes -- entao a regra vale para os dez.
 */

describe("mensagemDeProviderIncompativel", () => {
  it("nao recusa quando nao ha divergencia", () => {
    expect(mensagemDeProviderIncompativel([], "aws")).toBeNull();
  });

  it("recusa uma conta OVH numa tela AWS", () => {
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "ovh-main-ca", provider: "ovh" }],
      "aws",
    );
    expect(m).not.toBeNull();
    expect(m).toContain("apenas contas AWS");
  });

  it("a mensagem diz para onde ir", () => {
    // Recusar sem apontar a alternativa deixa o usuario sem proximo passo.
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "ovh-main-ca", provider: "ovh" }],
      "aws",
    );
    expect(m).toContain("Faturamento");
  });

  it("nomeia a conta e o provedor dela", () => {
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "ovh-main-ca", provider: "ovh" }],
      "aws",
    );
    expect(m).toContain("ovh-main-ca");
    expect(m).toContain("OVH");
  });

  it("lista TODAS as divergentes, nao so a primeira", () => {
    // Com varias contas selecionadas, "alguma esta errada" obrigaria a
    // descobrir qual por tentativa e erro.
    const m = mensagemDeProviderIncompativel(
      [
        { accountId: "ovh-main-ca", provider: "ovh" },
        { accountId: "ovh-secundaria", provider: "ovh" },
      ],
      "aws",
    );
    expect(m).toContain("ovh-main-ca");
    expect(m).toContain("ovh-secundaria");
  });

  it("recusa tambem a MISTURA -- o caso perigoso", () => {
    // Uma conta OVH entre AWS produziria um total com cara de completo,
    // faltando exatamente a parte que a tela nao sabe ler. A recusa vale para
    // a requisicao inteira, nao para a conta.
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "ovh-main-ca", provider: "ovh" }],
      "aws",
    );
    expect(m).not.toBeNull();
  });

  it("provedor desconhecido tambem e recusado, com o valor cru", () => {
    // Conta inserida a mao com provider='azure' nao tem tabela de custo
    // nenhuma. Recusar mostrando o valor real e melhor do que trata-la como AWS.
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "conta-x", provider: "azure" }],
      "aws",
    );
    expect(m).toContain("AZURE");
  });

  it("serve para o sentido inverso, se um dia houver tela OVH-only", () => {
    const m = mensagemDeProviderIncompativel(
      [{ accountId: "800168045394", provider: "aws" }],
      "ovh",
    );
    expect(m).toContain("apenas contas OVH");
    expect(m).toContain("800168045394");
  });
});
