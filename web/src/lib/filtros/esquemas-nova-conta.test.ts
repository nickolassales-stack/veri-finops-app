import { describe, expect, it } from "vitest";

import { esquemaNovaContaOvh, esquemaProviderConsulta } from "./esquemas-credenciais";

const BASE = {
  accountId: "ovh-cliente-ca",
  alias: "Cliente CA",
  endpoint: "ovh-ca",
};

const CHAVES = {
  applicationKey: "chaveDeAplicacao123",
  applicationSecret: "segredoDeAplicacao456",
  consumerKey: "chaveDeConsumidor789",
};

function analisar(entrada: unknown) {
  return esquemaNovaContaOvh.safeParse(entrada);
}

describe("esquemaNovaContaOvh — identidade", () => {
  it("aceita o mínimo: id, alias e endpoint", () => {
    // Cadastrar sem credencial é legítimo: permite criar a conta agora e colar
    // as chaves quando quem tem acesso à OVH estiver disponível.
    const r = analisar(BASE);
    expect(r.success).toBe(true);
  });

  it("recusa id vazio", () => {
    expect(analisar({ ...BASE, accountId: "" }).success).toBe(false);
  });

  it("recusa id com caractere que o banco não comporta", () => {
    // `cloud_accounts.account_id` é varchar(20) e vira chave de tudo: espaço,
    // barra e acento aqui viram um id impossível de digitar na URL depois.
    for (const ruim of ["ovh cliente", "ovh/cliente", "ovh-clienté", "a".repeat(21)]) {
      expect(analisar({ ...BASE, accountId: ruim }).success, ruim).toBe(false);
    }
  });

  it("recusa alias vazio", () => {
    // Sem alias a conta apareceria só pelo id na lista inteira do portal.
    expect(analisar({ ...BASE, alias: "" }).success).toBe(false);
    expect(analisar({ ...BASE, alias: "   " }).success).toBe(false);
  });

  it("recusa endpoint que não é da OVH", () => {
    expect(analisar({ ...BASE, endpoint: "https://evil.example" }).success).toBe(false);
    expect(analisar({ ...BASE, endpoint: "aws" }).success).toBe(false);
  });

  it("recusa campo desconhecido em vez de ignorá-lo", () => {
    // `.strict()`: um POST com `provider: "aws"` deve FALHAR dizendo o que está
    // errado, e não responder 200 tendo criado uma conta OVH.
    expect(analisar({ ...BASE, provider: "aws" }).success).toBe(false);
    expect(analisar({ ...BASE, active: false }).success).toBe(false);
  });

  it("não existe campo `provider` — esta rota só cria OVH", () => {
    const r = analisar(BASE);
    expect(r.success && "provider" in r.data).toBe(false);
  });
});

describe("esquemaNovaContaOvh — as três chaves andam juntas", () => {
  it("as três presentes: aceita", () => {
    expect(analisar({ ...BASE, ...CHAVES }).success).toBe(true);
  });

  it("nenhuma presente: aceita", () => {
    expect(analisar(BASE).success).toBe(true);
  });

  it("só uma ou só duas: recusa", () => {
    // Gravar meia credencial deixaria a conta falhando na primeira chamada, com
    // um erro da OVH difícil de ligar à causa.
    expect(analisar({ ...BASE, applicationKey: CHAVES.applicationKey }).success).toBe(false);
    expect(
      analisar({
        ...BASE,
        applicationKey: CHAVES.applicationKey,
        consumerKey: CHAVES.consumerKey,
      }).success,
    ).toBe(false);
  });

  it("string vazia conta como ausente, não como valor", () => {
    // O formulário manda "" quando o campo não foi tocado. Tratá-lo como valor
    // gravaria uma credencial de string vazia.
    expect(
      analisar({ ...BASE, applicationKey: "", applicationSecret: "", consumerKey: "" })
        .success,
    ).toBe(true);
  });

  it("recusa segredo com espaço — sintoma de colagem torta", () => {
    expect(
      analisar({ ...BASE, ...CHAVES, applicationSecret: "com espaco no meio" }).success,
    ).toBe(false);
  });

  it("recusa segredo absurdamente longo", () => {
    expect(
      analisar({ ...BASE, ...CHAVES, consumerKey: "x".repeat(513) }).success,
    ).toBe(false);
  });
});

describe("esquemaNovaContaOvh — primeira coleta", () => {
  it("o padrão é não coletar", () => {
    const r = analisar(BASE);
    expect(r.success && r.data.coletarAgora).toBe(false);
  });

  it("coletar com as três chaves: aceita", () => {
    expect(analisar({ ...BASE, ...CHAVES, coletarAgora: true }).success).toBe(true);
  });

  it("coletar SEM credencial: recusa", () => {
    // Enfileiraria um job destinado a falhar, e a tela mostraria "coleta
    // enfileirada" seguida de erro minutos depois.
    const r = analisar({ ...BASE, coletarAgora: true });
    expect(r.success).toBe(false);
  });
});

describe("esquemaProviderConsulta", () => {
  it("aceita os dois provedores", () => {
    expect(esquemaProviderConsulta.parse("aws")).toBe("aws");
    expect(esquemaProviderConsulta.parse("ovh")).toBe("ovh");
  });

  it("ausente significa todas — não quebra quem já consome a rota", () => {
    expect(esquemaProviderConsulta.parse(undefined)).toBeUndefined();
  });

  it("recusa provedor inventado", () => {
    expect(esquemaProviderConsulta.safeParse("gcp").success).toBe(false);
  });
});
