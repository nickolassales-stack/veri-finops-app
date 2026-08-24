import { describe, expect, it } from "vitest";

import {
  avaliarOrigemCredenciais,
  resumoOrigem,
  type ContaCredencial,
} from "./credenciais-ovh";

function conta(
  accountId: string,
  { credencial = true, status = "conectado" as string | null } = {},
): ContaCredencial {
  return {
    accountId,
    nome: `Conta ${accountId}`,
    temCredencial: credencial,
    status: credencial ? status : null,
  };
}

describe("avaliarOrigemCredenciais", () => {
  it("separa banco de fallback", () => {
    const o = avaliarOrigemCredenciais([
      conta("ovh-a-ca"),
      conta("ovh-b-ca", { credencial: false }),
    ]);
    expect(o.noBanco.map((c) => c.accountId)).toEqual(["ovh-a-ca"]);
    expect(o.emFallback.map((c) => c.accountId)).toEqual(["ovh-b-ca"]);
  });

  it("sem contas em fallback, não alerta", () => {
    const o = avaliarOrigemCredenciais([conta("ovh-a-ca"), conta("ovh-b-ca")]);
    expect(o.alertas).toEqual([]);
  });

  it("alerta quando alguma conta depende do fallback", () => {
    const o = avaliarOrigemCredenciais([conta("ovh-b-ca", { credencial: false })]);
    expect(o.alertas).toHaveLength(1);
    expect(o.alertas[0].chave).toBe("ovh-fallback-ativo");
    // O id precisa estar na mensagem: com várias contas, "há fallback ativo"
    // obrigaria a descobrir qual por tentativa e erro.
    expect(o.alertas[0].detalhe).toContain("ovh-b-ca");
  });

  it("o alerta de fallback é atenção, não crítico", () => {
    // A coleta pode estar funcionando pelo arquivo. Pintar de vermelho algo que
    // está coletando faria o vermelho perder valor na tela onde ele precisa
    // significar "pare e olhe".
    const o = avaliarOrigemCredenciais([conta("ovh-b-ca", { credencial: false })]);
    expect(o.alertas[0].tom).toBe("atencao");
  });

  it("singular e plural na mensagem", () => {
    const um = avaliarOrigemCredenciais([conta("a", { credencial: false })]);
    const dois = avaliarOrigemCredenciais([
      conta("a", { credencial: false }),
      conta("b", { credencial: false }),
    ]);
    expect(um.alertas[0].titulo).toContain("1 conta");
    expect(dois.alertas[0].titulo).toContain("2 contas");
  });

  it("credencial inválida gera alerta crítico próprio", () => {
    // Conta com status `invalido` é PULADA pelo collector: não há tentativa
    // diária, e por isso ela não aparece como falha no histórico. Sem este
    // alerta, uma conta parada é indistinguível de uma conta sem custo.
    const o = avaliarOrigemCredenciais([conta("ovh-a-ca", { status: "invalido" })]);
    expect(o.invalidas).toHaveLength(1);
    expect(o.alertas[0].chave).toBe("ovh-credencial-invalida");
    expect(o.alertas[0].tom).toBe("critico");
  });

  it("nao_validado não é inválido", () => {
    // `nao_validado` COLETA — é credencial nova que ninguém testou ainda.
    // Alertar sobre ela transformaria o cadastro normal num alarme.
    const o = avaliarOrigemCredenciais([conta("ovh-a-ca", { status: "nao_validado" })]);
    expect(o.invalidas).toEqual([]);
    expect(o.alertas).toEqual([]);
  });

  it("os dois alertas coexistem", () => {
    const o = avaliarOrigemCredenciais([
      conta("ovh-a-ca", { status: "invalido" }),
      conta("ovh-b-ca", { credencial: false }),
    ]);
    expect(o.alertas.map((a) => a.chave).sort()).toEqual([
      "ovh-credencial-invalida",
      "ovh-fallback-ativo",
    ]);
  });

  it("lista vazia não alerta nem estoura", () => {
    const o = avaliarOrigemCredenciais([]);
    expect(o.alertas).toEqual([]);
    expect(o.noBanco).toEqual([]);
  });
});

describe("resumoOrigem", () => {
  it("declara o fallback inativo quando ninguém depende dele", () => {
    const o = avaliarOrigemCredenciais([conta("a"), conta("b")]);
    expect(resumoOrigem(o)).toContain("Fallback legado inativo");
  });

  it("conta quantas dependem do fallback", () => {
    const o = avaliarOrigemCredenciais([conta("a"), conta("b", { credencial: false })]);
    expect(resumoOrigem(o)).toContain("1 de 2");
  });

  it("sem conta OVH, diz isso em vez de somar zero", () => {
    expect(resumoOrigem(avaliarOrigemCredenciais([]))).toContain("Nenhuma conta OVH");
  });
});
