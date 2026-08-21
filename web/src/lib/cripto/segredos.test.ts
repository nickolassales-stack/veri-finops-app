import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CARACTERES_VISIVEIS,
  cifragemDisponivel,
  cifrar,
  decifrar,
  ErroDeCripto,
  impressaoDigital,
  mascarar,
  mesmaImpressao,
  type ContextoSegredo,
} from "./segredos";

/**
 * O arquivo mais sensivel do projeto, e por isso o mais testado.
 *
 * O que estes testes cobrem NAO e "a biblioteca de AES funciona" -- isso e do
 * Node. E o que O NOSSO desenho promete e que quebraria em silencio se alguem
 * "simplificasse" o modulo depois:
 *
 *   - IV novo a cada cifragem (reuso vaza a chave de autenticacao do GCM);
 *   - AAD amarrando o texto cifrado a conta e ao campo (sem isso, texto cifrado
 *     pode ser MOVIDO entre contas e decifra com sucesso);
 *   - falha de decifragem que LANCA em vez de devolver lixo;
 *   - chave de tamanho errado recusada, e nao esticada;
 *   - mascara que nao revela segredo curto.
 */

/** 32 bytes -- o unico tamanho aceito. Valor de teste, nunca de producao. */
const CHAVE_A = Buffer.alloc(32, 1).toString("base64");
const CHAVE_B = Buffer.alloc(32, 2).toString("base64");

const CTX: ContextoSegredo = {
  provider: "ovh",
  accountId: "ovh-main-ca",
  campo: "application_secret",
};

const original = process.env.APP_CREDENTIALS_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.APP_CREDENTIALS_ENCRYPTION_KEY = CHAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.APP_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.APP_CREDENTIALS_ENCRYPTION_KEY = original;
});

describe("chave-mestra", () => {
  it("ausente -> recusa, com instrucao de como gerar", () => {
    delete process.env.APP_CREDENTIALS_ENCRYPTION_KEY;
    expect(cifragemDisponivel()).toBe(false);
    expect(() => cifrar("x", CTX)).toThrow(ErroDeCripto);
    expect(() => cifrar("x", CTX)).toThrow(/openssl rand -base64 32/);
  });

  it("vazia ou so espaco -> tratada como ausente", () => {
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = "   ";
    expect(cifragemDisponivel()).toBe(false);
  });

  it("curta -> RECUSADA, nao esticada", () => {
    // 16 bytes serviriam para AES-128. Aceitar aqui daria a aparencia de AES-256
    // com metade da forca -- o tipo de fraqueza que ninguem percebe depois.
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(16, 9).toString("base64");
    expect(cifragemDisponivel()).toBe(false);
    expect(() => cifrar("x", CTX)).toThrow(/32 bytes/);
  });

  it("longa -> tambem recusada", () => {
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(64, 9).toString("base64");
    expect(() => cifrar("x", CTX)).toThrow(/32 bytes/);
  });

  it("a mensagem de erro nunca contem a chave", () => {
    const chave = Buffer.alloc(16, 7).toString("base64");
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = chave;
    try {
      cifrar("x", CTX);
      expect.unreachable("deveria ter lancado");
    } catch (e) {
      expect((e as Error).message).not.toContain(chave);
    }
  });

  it("chave valida -> disponivel", () => {
    expect(cifragemDisponivel()).toBe(true);
  });
});

describe("ida e volta", () => {
  it("decifrar(cifrar(x)) === x", () => {
    const segredo = "AbCdEf1234567890XyZ";
    expect(decifrar(cifrar(segredo, CTX), CTX)).toBe(segredo);
  });

  it("preserva acento e unicode", () => {
    const segredo = "sénha-çom-acento-日本語";
    expect(decifrar(cifrar(segredo, CTX), CTX)).toBe(segredo);
  });

  it("segredo longo", () => {
    const segredo = "z".repeat(512);
    expect(decifrar(cifrar(segredo, CTX), CTX)).toBe(segredo);
  });

  it("segredo vazio e recusado na cifragem", () => {
    expect(() => cifrar("", CTX)).toThrow(ErroDeCripto);
  });
});

describe("formato do envelope", () => {
  it("v1 com quatro partes", () => {
    const partes = cifrar("abc", CTX).split(":");
    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe("v1");
  });

  it("o texto claro NAO aparece no envelope", () => {
    const segredo = "credencial-que-nao-pode-vazar";
    const envelope = cifrar(segredo, CTX);
    expect(envelope).not.toContain(segredo);
    expect(Buffer.from(envelope.split(":")[2], "base64").toString("utf8")).not.toContain(
      segredo,
    );
  });

  it("IV DIFERENTE a cada chamada -- dois envelopes do mesmo valor divergem", () => {
    // Reusar IV em GCM com a mesma chave vaza a chave de autenticacao e permite
    // forjar tags. Se alguem "otimizar" para um IV fixo, este teste cai.
    const a = cifrar("mesmo-valor", CTX);
    const b = cifrar("mesmo-valor", CTX);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
    // E ainda assim os dois decifram para o mesmo texto.
    expect(decifrar(a, CTX)).toBe(decifrar(b, CTX));
  });
});

describe("AAD: o texto cifrado esta preso a conta e ao campo", () => {
  it("mesma conta, CAMPO diferente -> nao decifra", () => {
    const envelope = cifrar("segredo", CTX);
    expect(() => decifrar(envelope, { ...CTX, campo: "consumer_key" })).toThrow(
      ErroDeCripto,
    );
  });

  it("mesmo campo, CONTA diferente -> nao decifra", () => {
    // O ataque real: com escrita no banco, copiar o secret da conta A para a
    // conta B faria o portal autenticar na OVH de A exibindo o nome de B.
    const envelope = cifrar("segredo", CTX);
    expect(() => decifrar(envelope, { ...CTX, accountId: "outra-conta" })).toThrow(
      ErroDeCripto,
    );
  });

  it("PROVIDER diferente -> nao decifra", () => {
    const envelope = cifrar("segredo", CTX);
    expect(() => decifrar(envelope, { ...CTX, provider: "aws" })).toThrow(ErroDeCripto);
  });
});

describe("integridade e chave trocada", () => {
  it("chave diferente -> nao decifra, e nao devolve lixo", () => {
    const envelope = cifrar("segredo", CTX);
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = CHAVE_B;
    expect(() => decifrar(envelope, CTX)).toThrow(ErroDeCripto);
  });

  it("corpo alterado -> tag nao confere", () => {
    const partes = cifrar("segredo", CTX).split(":");
    const corpo = Buffer.from(partes[2], "base64");
    corpo[0] = corpo[0] ^ 0xff;
    partes[2] = corpo.toString("base64");
    expect(() => decifrar(partes.join(":"), CTX)).toThrow(ErroDeCripto);
  });

  it("tag alterada -> recusa", () => {
    const partes = cifrar("segredo", CTX).split(":");
    const tag = Buffer.from(partes[3], "base64");
    tag[0] = tag[0] ^ 0xff;
    partes[3] = tag.toString("base64");
    expect(() => decifrar(partes.join(":"), CTX)).toThrow(ErroDeCripto);
  });

  it("versao desconhecida -> mensagem propria", () => {
    const envelope = cifrar("segredo", CTX).replace(/^v1:/, "v9:");
    expect(() => decifrar(envelope, CTX)).toThrow(/formato desconhecido/);
  });

  it("numero errado de partes -> mensagem propria", () => {
    expect(() => decifrar("v1:so-duas", CTX)).toThrow(/formato desconhecido/);
  });

  it("IV de tamanho invalido -> recusa antes de tentar decifrar", () => {
    const partes = cifrar("segredo", CTX).split(":");
    partes[1] = Buffer.alloc(8, 0).toString("base64");
    expect(() => decifrar(partes.join(":"), CTX)).toThrow(/tamanho invalido/);
  });

  it("texto em CLARO na coluna nao passa por decifragem", () => {
    // O cenario e INSERT feito a mao no psql. O CHECK do banco tambem barra,
    // mas o codigo nao pode depender disso.
    expect(() => decifrar("minha-chave-em-claro", CTX)).toThrow(ErroDeCripto);
  });
});

describe("impressao digital", () => {
  it("estavel para o mesmo valor", () => {
    expect(impressaoDigital("chave")).toBe(impressaoDigital("chave"));
  });

  it("64 hex -- o formato que o CHECK do banco exige", () => {
    expect(impressaoDigital("chave")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("valores diferentes -> digitais diferentes", () => {
    expect(impressaoDigital("chave-a")).not.toBe(impressaoDigital("chave-b"));
  });

  it("NAO e SHA-256 puro do valor -- depende da subchave secreta", () => {
    // Se fosse SHA-256 cru, quem tem o banco poderia testar candidatos. Trocar a
    // chave-mestra tem de mudar a digital.
    const comA = impressaoDigital("chave");
    process.env.APP_CREDENTIALS_ENCRYPTION_KEY = CHAVE_B;
    expect(impressaoDigital("chave")).not.toBe(comA);
  });

  it("independe do contexto -- e o que permite achar chave repetida entre contas", () => {
    // A digital nao leva conta nem campo de proposito: e assim que
    // `contasComMesmaChave` descobre a mesma credencial cadastrada duas vezes.
    expect(impressaoDigital("chave")).toBe(impressaoDigital("chave"));
  });

  it("nao contem o valor em claro", () => {
    expect(impressaoDigital("valor-secreto")).not.toContain("valor-secreto");
  });

  it("mesmaImpressao compara sem estourar em tamanhos diferentes", () => {
    expect(mesmaImpressao("abc", "abc")).toBe(true);
    expect(mesmaImpressao("abc", "abcd")).toBe(false);
    expect(mesmaImpressao(impressaoDigital("x"), impressaoDigital("x"))).toBe(true);
    expect(mesmaImpressao(impressaoDigital("x"), impressaoDigital("y"))).toBe(false);
  });
});

describe("mascara", () => {
  it("revela apenas os ultimos caracteres", () => {
    expect(mascarar("abcdefghijkl")).toBe("****ijkl");
  });

  it("segredo curto vira mascara inteira", () => {
    // Mostrar 4 de 6 entregaria dois tercos do valor.
    expect(mascarar("abcdef")).toBe("****");
    expect(mascarar("a")).toBe("****");
  });

  it("no limite, ainda mascara tudo", () => {
    expect(mascarar("a".repeat(CARACTERES_VISIVEIS * 2 - 1))).toBe("****");
  });

  it("acima do limite, revela o fim", () => {
    expect(mascarar("12345678")).toBe("****5678");
  });

  it("nunca devolve o valor inteiro", () => {
    for (const v of ["abcdefgh", "chave-de-api-longa-abcd", "x".repeat(64)]) {
      expect(mascarar(v)).not.toBe(v);
      expect(mascarar(v).length).toBeLessThanOrEqual(4 + CARACTERES_VISIVEIS);
    }
  });
});
