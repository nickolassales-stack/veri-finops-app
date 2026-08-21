import { describe, expect, it } from "vitest";

import { analisar } from "@/lib/api/http";
import { esquemaCredencialOvh } from "@/lib/filtros/esquemas-credenciais";

import {
  deveMostrarBlocoOvh,
  ehEndpointValido,
  motivoRecusaDeProvider,
  planejarGravacao,
  quantosSubstituem,
  type EntradaPlano,
} from "./plano";

/**
 * As regras que erram na pratica.
 *
 * O caso que este arquivo existe para travar e o terceiro `describe`: editar o
 * endpoint de uma credencial ja gravada, com os campos de segredo em branco, NAO
 * pode apagar o segredo. E facil "consertar" `planejarGravacao` para tratar
 * branco como valor vazio, e o sintoma so apareceria na coleta do dia seguinte.
 */

const BASE: EntradaPlano = { endpoint: "ovh-ca" };

function plano(entrada: EntradaPlano, jaExiste: boolean) {
  const r = planejarGravacao(entrada, jaExiste);
  if (!r.ok) throw new Error(`esperava plano, veio faltante: ${JSON.stringify(r.faltantes)}`);
  return r.plano;
}

describe("primeiro cadastro: os tres sao obrigatorios", () => {
  it("nenhum campo -> tres faltantes", () => {
    const r = planejarGravacao(BASE, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes.map((f) => f.campo).sort()).toEqual([
      "applicationKey",
      "applicationSecret",
      "consumerKey",
    ]);
  });

  it("aponta O CAMPO, nao um erro geral", () => {
    const r = planejarGravacao({ ...BASE, applicationKey: "ak" }, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes).toHaveLength(2);
    expect(r.faltantes[0].mensagem).toMatch(/obrigatorio no primeiro cadastro/);
  });

  it("os tres presentes -> plano com tres substituicoes", () => {
    const p = plano(
      { ...BASE, applicationKey: "ak", applicationSecret: "as", consumerKey: "ck" },
      false,
    );
    expect(quantosSubstituem(p)).toBe(3);
    expect(p.applicationKey).toEqual({ acao: "substituir", valor: "ak" });
  });
});

describe("edicao: campo vazio MANTEM o que esta gravado", () => {
  it("nenhum segredo informado -> os tres mantidos, endpoint trocado", () => {
    // O caso central. Reabrir o formulario so para corrigir a regiao nao pode
    // destruir a credencial.
    const p = plano({ endpoint: "ovh-eu" }, true);
    expect(p.endpoint).toBe("ovh-eu");
    expect(p.applicationKey).toEqual({ acao: "manter" });
    expect(p.applicationSecret).toEqual({ acao: "manter" });
    expect(p.consumerKey).toEqual({ acao: "manter" });
    expect(quantosSubstituem(p)).toBe(0);
  });

  it("troca SO o secret -- os outros dois ficam", () => {
    const p = plano({ ...BASE, applicationSecret: "novo-secret" }, true);
    expect(p.applicationSecret).toEqual({ acao: "substituir", valor: "novo-secret" });
    expect(p.applicationKey).toEqual({ acao: "manter" });
    expect(p.consumerKey).toEqual({ acao: "manter" });
    expect(quantosSubstituem(p)).toBe(1);
  });

  it("troca as tres partes de uma vez", () => {
    const p = plano(
      { ...BASE, applicationKey: "a", applicationSecret: "b", consumerKey: "c" },
      true,
    );
    expect(quantosSubstituem(p)).toBe(3);
  });

  it("na edicao NUNCA ha faltante -- sempre da plano", () => {
    expect(planejarGravacao(BASE, true).ok).toBe(true);
  });
});

describe("o Zod normaliza antes de o plano decidir", () => {
  /**
   * A dupla importa: e o Zod que transforma `""`, `null` e `"   "` em
   * `undefined`, e e o plano que le `undefined` como "manter". Testar os dois
   * juntos e o que garante que a tela pode mandar string vazia sem pensar.
   */
  const analisado = (corpo: unknown) => analisar(esquemaCredencialOvh, corpo);

  it("string vazia vira manter", () => {
    const e = analisado({ endpoint: "ovh-ca", applicationKey: "" });
    expect(e.applicationKey).toBeUndefined();
    expect(plano(e, true).applicationKey).toEqual({ acao: "manter" });
  });

  it("null vira manter", () => {
    const e = analisado({ endpoint: "ovh-ca", applicationSecret: null });
    expect(e.applicationSecret).toBeUndefined();
    expect(plano(e, true).applicationSecret).toEqual({ acao: "manter" });
  });

  it("so espacos vira manter -- nao credencial de um espaco", () => {
    const e = analisado({ endpoint: "ovh-ca", consumerKey: "    " });
    expect(e.consumerKey).toBeUndefined();
  });

  it("valor com espaco em volta e aparado", () => {
    const e = analisado({ endpoint: "ovh-ca", applicationKey: "  chave  " });
    expect(e.applicationKey).toBe("chave");
  });

  it("espaco NO MEIO e recusado -- sintoma de copiar-e-colar torto", () => {
    expect(() => analisado({ endpoint: "ovh-ca", applicationKey: "cha ve" })).toThrow();
  });

  it("quebra de linha NO MEIO e recusada; no fim, aparada", () => {
    // A distincao e proposital. Colar do console costuma trazer a quebra no
    // fim, e recusar isso seria hostil sem motivo -- o trim resolve. Quebra no
    // MEIO e outra coisa: sao duas linhas colhidas juntas, e nenhuma e a chave.
    const noMeio = ["cha", "ve"].join("\n");
    const noFim = `chave\n`;
    expect(() => analisado({ endpoint: "ovh-ca", consumerKey: noMeio })).toThrow();
    expect(analisado({ endpoint: "ovh-ca", consumerKey: noFim }).consumerKey).toBe(
      "chave",
    );
  });

  it("acima de 512 caracteres e recusado", () => {
    expect(() =>
      analisado({ endpoint: "ovh-ca", applicationSecret: "x".repeat(513) }),
    ).toThrow();
  });

  it("endpoint invalido e recusado", () => {
    expect(() => analisado({ endpoint: "ovh-br" })).toThrow();
    expect(() => analisado({ endpoint: "" })).toThrow();
  });

  it("os tres endpoints reais passam", () => {
    for (const endpoint of ["ovh-eu", "ovh-ca", "ovh-us"]) {
      expect(analisado({ endpoint }).endpoint).toBe(endpoint);
    }
  });

  it("campo desconhecido e ERRO, nao ignorado em silencio", () => {
    // `.strict()`: um `applicationkey` minusculo tem de falhar dizendo o que
    // esta errado, em vez de responder 200 sem ter gravado nada.
    expect(() =>
      analisado({ endpoint: "ovh-ca", applicationkey: "ak" }),
    ).toThrow();
  });

  it("endpoint ausente e erro -- nao ha padrao seguro para regiao", () => {
    expect(() => analisado({ applicationKey: "ak" })).toThrow();
  });
});

describe("provider: credencial OVH nao entra em conta de outro provedor", () => {
  it("ovh -> permitido", () => {
    expect(motivoRecusaDeProvider("ovh-main-ca", "ovh")).toBeNull();
  });

  it("aws -> recusado, e a mensagem diz QUAL provider foi encontrado", () => {
    const m = motivoRecusaDeProvider("800168045394", "aws");
    expect(m).not.toBeNull();
    expect(m).toContain("800168045394");
    expect(m).toContain('"aws"');
  });

  it("provider desconhecido -> recusado tambem", () => {
    // `cloud_accounts.provider` e `text` livre. 'azure' inserido a mao nao pode
    // virar conta OVH por omissao.
    expect(motivoRecusaDeProvider("x", "azure")).not.toBeNull();
    expect(motivoRecusaDeProvider("x", "")).not.toBeNull();
    expect(motivoRecusaDeProvider("x", "OVH")).not.toBeNull();
  });
});

describe("o bloco de credenciais aparece para quem e onde?", () => {
  it("conta OVH + ADMIN -> mostra", () => {
    expect(deveMostrarBlocoOvh("ovh", true)).toBe(true);
  });

  it("conta OVH + nao-ADMIN -> nao mostra", () => {
    expect(deveMostrarBlocoOvh("ovh", false)).toBe(false);
  });

  it("conta AWS + ADMIN -> nao mostra", () => {
    // A AWS nao tem credencial a guardar: autentica por IAM role da instancia.
    expect(deveMostrarBlocoOvh("aws", true)).toBe(false);
  });

  it("conta AWS + nao-ADMIN -> nao mostra", () => {
    expect(deveMostrarBlocoOvh("aws", false)).toBe(false);
  });
});

describe("ehEndpointValido", () => {
  it("aceita os tres", () => {
    expect(ehEndpointValido("ovh-eu")).toBe(true);
    expect(ehEndpointValido("ovh-ca")).toBe(true);
    expect(ehEndpointValido("ovh-us")).toBe(true);
  });

  it("recusa o resto", () => {
    expect(ehEndpointValido("ovh-br")).toBe(false);
    expect(ehEndpointValido("kimsufi-eu")).toBe(false);
    expect(ehEndpointValido("")).toBe(false);
  });
});
