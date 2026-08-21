import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  FONTES_OVH,
  PROVIDERS,
  camposFonteOvh,
  camposProvider,
  ehProvider,
} from "./esquemas";

/**
 * Separacao por provider na entrada.
 *
 * O que estes testes protegem: a allowlist e a UNICA barreira entre um
 * `?provider=` qualquer e uma consulta que nao existe. Uma conta marcada com um
 * provedor que a aplicacao nao sabe ler nao tem tabela de custo nenhuma, e
 * apareceria como zero -- exatamente o defeito que a separacao por provider
 * existe para eliminar.
 */

const esquemaProvider = z.object({ ...camposProvider });
const esquemaFonte = z.object({ ...camposFonteOvh });

describe("camposProvider", () => {
  it("aceita os provedores conhecidos", () => {
    for (const p of PROVIDERS) {
      expect(esquemaProvider.parse({ provider: p }).provider).toBe(p);
    }
  });

  it('aceita "all"', () => {
    expect(esquemaProvider.parse({ provider: "all" }).provider).toBe("all");
  });

  it('sem o parametro, o padrao e "all" -- nunca "aws"', () => {
    // Se o padrao fosse "aws", o Admin teria de saber pedir os outros
    // provedores para ve-los, e uma conta OVH ficaria invisivel para quem nao
    // soubesse que ela existe.
    expect(esquemaProvider.parse({}).provider).toBe("all");
  });

  it("recusa provedor fora da allowlist", () => {
    for (const invalido of ["azure", "gcp", "AWS ", "aws;--", ""]) {
      expect(esquemaProvider.safeParse({ provider: invalido }).success).toBe(false);
    }
  });

  it("a mensagem de erro diz quais valores servem", () => {
    const r = esquemaProvider.safeParse({ provider: "azure" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("aws");
      expect(r.error.issues[0].message).toContain("ovh");
      expect(r.error.issues[0].message).toContain("all");
    }
  });

  it("nao aceita tentativa de injecao pelo nome do provider", () => {
    // `provider` vai para a query como PARAMETRO, mas o enum e a garantia de
    // que nem uma string estranha chega la.
    const r = esquemaProvider.safeParse({
      provider: "aws' OR '1'='1",
    });
    expect(r.success).toBe(false);
  });
});

describe("ehProvider", () => {
  it("reconhece os da lista e recusa o resto", () => {
    expect(ehProvider("aws")).toBe(true);
    expect(ehProvider("ovh")).toBe(true);
    expect(ehProvider("azure")).toBe(false);
    // Sensivel a caixa de proposito: a coluna guarda minusculas, e aceitar
    // "AWS" aqui faria o selo tratar como conhecido um valor que o filtro
    // `provider = 'AWS'` nao encontraria no banco.
    expect(ehProvider("AWS")).toBe(false);
  });
});

describe("camposFonteOvh", () => {
  it("aceita as tres origens", () => {
    for (const f of FONTES_OVH) {
      expect(esquemaFonte.parse({ source: f }).source).toBe(f);
    }
  });

  it("as tres origens sao exatamente as do CHECK do banco", () => {
    // Se a migracao 005 mudar o CHECK e esta lista nao, a aplicacao passaria a
    // recusar um valor valido ou aceitar um invalido.
    expect([...FONTES_OVH]).toEqual(["invoice", "usage_current", "usage_forecast"]);
  });

  it("origem e opcional, mas nunca vira um valor padrao", () => {
    // Nao existe origem padrao de proposito: escolher uma faria a tela somar
    // ou exibir uma das tres como se fosse "o custo OVH".
    expect(esquemaFonte.parse({}).source).toBeUndefined();
  });

  it("recusa origem desconhecida", () => {
    for (const invalido of ["usage", "faturado", "invoice,usage_current", "INVOICE"]) {
      expect(esquemaFonte.safeParse({ source: invalido }).success).toBe(false);
    }
  });
});
