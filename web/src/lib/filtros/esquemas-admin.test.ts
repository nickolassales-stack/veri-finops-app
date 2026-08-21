import { describe, expect, it } from "vitest";

import {
  esquemaIdDeConta,
  esquemaNovoGrupo,
  esquemaNovoUsuario,
  esquemaPatchConta,
  esquemaPatchUsuario,
  esquemaPermissoes,
} from "./esquemas-admin";

/** Atalho: valida e devolve a mensagem do primeiro campo que falhou. */
function erroDe(esquema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, valor: unknown) {
  const r = esquema.safeParse(valor);
  return r.success ? null : (r.error?.issues[0]?.message ?? "erro");
}

describe("esquemaPatchConta", () => {
  it("aceita alteracao de um unico campo -- o PATCH e parcial de proposito", () => {
    const r = esquemaPatchConta.safeParse({ alias: "Financeiro" });
    expect(r.success).toBe(true);
  });

  it("trata string vazia como pedido de APAGAR, virando null", () => {
    const r = esquemaPatchConta.safeParse({ alias: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.alias).toBeNull();
  });

  it("apara espacos, para 'Financeiro ' e 'Financeiro' nao virarem nomes diferentes", () => {
    const r = esquemaPatchConta.safeParse({ alias: "  Financeiro  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.alias).toBe("Financeiro");
  });

  it("recusa corpo vazio: requisicao que nao altera nada e erro de uso", () => {
    expect(erroDe(esquemaPatchConta, {})).toBeTruthy();
  });

  /**
   * `.strict()` existe para que um erro de digitacao no nome do campo FALHE em
   * vez de responder 200 sem ter mudado nada -- que e o jeito mais rapido de
   * alguem concluir que a tela esta quebrada.
   */
  it("recusa campo desconhecido em vez de ignorar em silencio", () => {
    expect(erroDe(esquemaPatchConta, { aliass: "x" })).toBeTruthy();
  });

  it("RECUSA campos de faturamento -- eles exigem billing:manage", () => {
    // Fechamento e situacao de pagamento moram nas mesmas colunas, mas sairam
    // deste PATCH na entrega de faturamento. Enquanto estavam aqui, quem tinha
    // `settings:accounts` alterava dado de fatura sem ter `billing:manage`:
    // duas portas para o mesmo campo, com exigencias diferentes.
    //
    // O `.strict()` e o que fecha a porta, e este teste e o que impede alguem
    // de reabri-la por conveniencia.
    expect(esquemaPatchConta.safeParse({ invoiceCloseDay: 10 }).success).toBe(false);
    expect(esquemaPatchConta.safeParse({ paymentStatus: "paid" }).success).toBe(false);
    expect(esquemaPatchConta.safeParse({ invoiceDueDay: 5 }).success).toBe(false);
    expect(esquemaPatchConta.safeParse({ billingContactEmail: "a@b.com" }).success).toBe(
      false,
    );
  });
});

describe("esquemaNovoUsuario", () => {
  const valido = {
    nome: "Fulano de Tal",
    email: "fulano@porveri.com.br",
    senhaInicial: "senha-bem-longa-123",
    papel: "VIEWER",
    ativo: true,
    grupos: ["1", "2"],
  };

  it("aceita um cadastro completo", () => {
    expect(esquemaNovoUsuario.safeParse(valido).success).toBe(true);
  });

  it("aplica os padroes de papel, ativacao e grupos", () => {
    const r = esquemaNovoUsuario.safeParse({
      nome: "Fulano",
      email: "f@x.com",
      senhaInicial: "senha-bem-longa-123",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.papel).toBe("VIEWER");
      expect(r.data.ativo).toBe(true);
      expect(r.data.grupos).toEqual([]);
    }
  });

  it("recusa senha inicial curta -- o limite e o mesmo do hash", () => {
    expect(esquemaNovoUsuario.safeParse({ ...valido, senhaInicial: "curta" }).success).toBe(
      false,
    );
  });

  it("recusa e-mail sem arroba ou com espaco", () => {
    expect(esquemaNovoUsuario.safeParse({ ...valido, email: "fulano" }).success).toBe(false);
    expect(esquemaNovoUsuario.safeParse({ ...valido, email: "a b@x.com" }).success).toBe(
      false,
    );
  });

  it("recusa papel fora de ADMIN/VIEWER", () => {
    expect(esquemaNovoUsuario.safeParse({ ...valido, papel: "ROOT" }).success).toBe(false);
  });

  it("recusa id de grupo que nao seja numerico", () => {
    expect(esquemaNovoUsuario.safeParse({ ...valido, grupos: ["1; DROP"] }).success).toBe(
      false,
    );
  });
});

describe("esquemaPatchUsuario", () => {
  it("permite enviar so o que mudou", () => {
    expect(esquemaPatchUsuario.safeParse({ ativo: false }).success).toBe(true);
    expect(esquemaPatchUsuario.safeParse({ grupos: [] }).success).toBe(true);
  });

  it("recusa corpo vazio", () => {
    expect(esquemaPatchUsuario.safeParse({}).success).toBe(false);
  });

  /** A senha se troca em /conta, pelo proprio dono. Nao ha caminho por aqui. */
  it("nao aceita troca de senha por esta rota", () => {
    expect(
      esquemaPatchUsuario.safeParse({ senhaInicial: "outra-senha-longa" }).success,
    ).toBe(false);
  });
});

describe("esquemaNovoGrupo", () => {
  it("exige nome", () => {
    expect(esquemaNovoGrupo.safeParse({ nome: "" }).success).toBe(false);
    expect(esquemaNovoGrupo.safeParse({ nome: "Financeiro" }).success).toBe(true);
  });

  it("nasce ativo por padrao", () => {
    const r = esquemaNovoGrupo.safeParse({ nome: "Financeiro" });
    if (r.success) expect(r.data.ativo).toBe(true);
  });
});

describe("esquemaPermissoes", () => {
  it("aceita lista vazia -- tirar tudo de um grupo e uma operacao legitima", () => {
    expect(esquemaPermissoes.safeParse({ permissoes: [] }).success).toBe(true);
  });

  it("aceita permissoes do catalogo", () => {
    expect(
      esquemaPermissoes.safeParse({ permissoes: ["dashboard:view", "billing:manage"] })
        .success,
    ).toBe(true);
  });

  /** Sem esta trava, `app_group_permissions` viraria deposito de string sem sentido. */
  it("recusa permissao inventada", () => {
    expect(esquemaPermissoes.safeParse({ permissoes: ["settings:tudo"] }).success).toBe(
      false,
    );
  });
});

describe("esquemaIdDeConta", () => {
  it("aceita o formato do cadastro, que e livre e nao so os 12 digitos da AWS", () => {
    expect(esquemaIdDeConta.safeParse("800168045394").success).toBe(true);
    expect(esquemaIdDeConta.safeParse("conta_teste-1").success).toBe(true);
  });

  it("recusa o que nao cabe na coluna ou traz caractere estranho", () => {
    expect(esquemaIdDeConta.safeParse("").success).toBe(false);
    expect(esquemaIdDeConta.safeParse("a".repeat(21)).success).toBe(false);
    expect(esquemaIdDeConta.safeParse("800168045394'").success).toBe(false);
  });
});
