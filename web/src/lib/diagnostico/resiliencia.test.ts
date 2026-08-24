import { afterEach, describe, expect, it, vi } from "vitest";

import { mensagemDeFalha, tentarSecao, valorOu } from "./resiliencia";

afterEach(() => {
  vi.restoreAllMocks();
});

/** O log de erro é esperado nestes casos; silenciá-lo mantém a saída legível. */
function calarConsole() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("tentarSecao", () => {
  it("devolve o valor quando o carregador funciona", async () => {
    const s = await tentarSecao("etl", async () => 42);
    expect(s).toEqual({ ok: true, valor: 42 });
  });

  it("NUNCA rejeita — é a propriedade inteira deste módulo", async () => {
    calarConsole();
    // Se isto passar a rejeitar, o `Promise.all` da página volta a derrubar a
    // tela inteira, que é exatamente a falha que este módulo existe para acabar.
    await expect(
      tentarSecao("etl", async () => {
        throw new Error("Esperava 1 linha, recebi 0.");
      }),
    ).resolves.toEqual({ ok: false, erro: "Esperava 1 linha, recebi 0." });
  });

  it("sobrevive a coisas lançadas que não são Error", async () => {
    calarConsole();
    const s = await tentarSecao("etl", async () => {
      throw "string crua";
    });
    expect(s.ok).toBe(false);
  });

  it("uma seção que falha não impede as outras num Promise.all", async () => {
    calarConsole();
    // A reprodução exata do bug de produção: cinco carregamentos, um estoura.
    const [a, b, c] = await Promise.all([
      tentarSecao("a", async () => "ok-a"),
      tentarSecao("b", async () => {
        throw new Error("Esperava 1 linha, recebi 0.");
      }),
      tentarSecao("c", async () => "ok-c"),
    ]);
    expect(a).toEqual({ ok: true, valor: "ok-a" });
    expect(b.ok).toBe(false);
    expect(c).toEqual({ ok: true, valor: "ok-c" });
  });

  it("registra o rótulo no log, não só a mensagem", async () => {
    // "Esperava 1 linha, recebi 0." sozinho no log não diz QUAL das consultas
    // da página falhou — foi a dificuldade concreta ao investigar a quebra.
    const spy = calarConsole();
    await tentarSecao("origem-credenciais", async () => {
      throw new Error("falhou");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("origem-credenciais");
  });
});

describe("mensagemDeFalha", () => {
  it("passa a mensagem técnica adiante", () => {
    // Esta é a tela de diagnóstico: quem a abriu está investigando, e
    // "ocorreu um erro" só acrescenta um passo até o log.
    expect(mensagemDeFalha(new Error("relation cloud_sync_jobs does not exist"))).toContain(
      "does not exist",
    );
  });

  it("remove do texto qualquer coisa com forma de credencial", () => {
    // Mensagem de erro tem o hábito de ecoar o que recebeu, e o caminho de erro
    // é o que ninguém revisa.
    const m = mensagemDeFalha(new Error("auth falhou para AKIAIOSFODNN7EXAMPLEKEY"));
    expect(m).not.toContain("AKIAIOSFODNN7EXAMPLEKEY");
    expect(m).toContain("<omitido>");
  });

  it("nunca devolve string vazia", () => {
    // Um bloco de erro em branco na tela é indistinguível de um bug de layout.
    expect(mensagemDeFalha(new Error(""))).not.toBe("");
    expect(mensagemDeFalha(null)).not.toBe("");
    expect(mensagemDeFalha(undefined)).not.toBe("");
  });
});

describe("valorOu", () => {
  it("entrega o padrão quando a seção falhou", () => {
    expect(valorOu({ ok: false, erro: "x" }, [])).toEqual([]);
    expect(valorOu({ ok: true, valor: [1] }, [])).toEqual([1]);
  });
});
