import { describe, expect, it } from "vitest";

import { deveMostrarBlocoOvh } from "@/lib/credenciais/plano";

import { can, PERMISSOES, PERMISSOES_DO_VIEWER, type Autorizacao, type Permissao } from "./permissoes";

/**
 * Por que credencial e protegida por PAPEL e nao por permissao.
 *
 * Este arquivo nao testa a rota -- testa a premissa que obrigou a rota a ser
 * diferente de todas as outras. Se a premissa deixar de valer, estes testes
 * quebram e o `rotaSomenteAdmin` passa a ser reavaliavel; enquanto valerem, ele
 * e necessario.
 *
 * A tentacao natural e criar `settings:credentials` e usar `rotaComPermissao`.
 * Os dois primeiros testes mostram por que isso seria uma ILUSAO de
 * exclusividade: qualquer permissao do catalogo pode ser concedida a um grupo, e
 * um grupo pode conter um VIEWER. A tela de grupos entregaria a chave da OVH em
 * dois cliques, sem nenhum aviso.
 */

function comGrupo(papel: "ADMIN" | "VIEWER", concedidas: Permissao[]): Autorizacao {
  return { papel, permissoes: new Set(concedidas) };
}

describe("nenhuma permissao do catalogo e exclusiva de ADMIN", () => {
  it("TODA permissao pode ser concedida a um VIEWER por grupo", () => {
    // O teste central. Ele varre o catalogo inteiro: se um dia alguem
    // acrescentar uma permissao acreditando que ela sera "so de admin", este
    // teste mostra que nao e.
    for (const p of PERMISSOES) {
      const viewer = comGrupo("VIEWER", [p]);
      expect(can(viewer, p), `${p} deveria ser concedivel a VIEWER`).toBe(true);
    }
  });

  it("logo, criar `settings:credentials` nao protegeria nada", () => {
    // Simulacao da permissao que NAO foi criada. Se ela existisse e a rota
    // usasse `rotaComPermissao`, este seria o caminho de escape.
    const permissaoHipotetica = "settings:accounts" as Permissao;
    const viewerComGrupo = comGrupo("VIEWER", [permissaoHipotetica]);
    expect(can(viewerComGrupo, permissaoHipotetica)).toBe(true);
  });

  it("o catalogo NAO tem permissao de credencial -- de proposito", () => {
    // Se aparecer, e sinal de que alguem tentou o caminho da permissao e o
    // portao por papel provavelmente foi trocado junto.
    const suspeitas = PERMISSOES.filter((p) => /credential|credencia|secret/i.test(p));
    expect(suspeitas).toEqual([]);
  });
});

describe("o papel, esse sim, separa", () => {
  it("ADMIN passa em tudo, mesmo sem grupo nenhum", () => {
    const admin = comGrupo("ADMIN", []);
    for (const p of PERMISSOES) expect(can(admin, p)).toBe(true);
  });

  it("VIEWER sem grupo tem apenas o piso", () => {
    const viewer = comGrupo("VIEWER", []);
    const permitidas = PERMISSOES.filter((p) => can(viewer, p));
    expect(permitidas).toEqual([...PERMISSOES_DO_VIEWER]);
  });

  it("VIEWER sem grupo NAO tem settings:accounts", () => {
    // Consequencia pratica: ele nem chega a tela de Contas Cloud.
    expect(can(comGrupo("VIEWER", []), "settings:accounts")).toBe(false);
  });
});

describe("o bloco de credenciais segue o papel, nao a permissao", () => {
  /**
   * O caso que motiva tudo: um VIEWER em grupo com `settings:accounts` E um
   * usuario legitimo da tela de Contas Cloud -- edita alias, unidade, centro de
   * custo. E nao pode ver credencial.
   *
   * Se a decisao fosse por permissao, os dois viriam juntos.
   */
  it("VIEWER com settings:accounts entra na tela, mas nao ve credencial", () => {
    const viewer = comGrupo("VIEWER", ["settings:accounts"]);

    // Entra na tela...
    expect(can(viewer, "settings:accounts")).toBe(true);
    // ...e o bloco nao aparece, porque a decisao e por papel.
    expect(deveMostrarBlocoOvh("ovh", viewer.papel === "ADMIN")).toBe(false);
  });

  it("ADMIN ve o bloco em conta OVH", () => {
    const admin = comGrupo("ADMIN", []);
    expect(deveMostrarBlocoOvh("ovh", admin.papel === "ADMIN")).toBe(true);
  });

  it("ADMIN nao ve o bloco em conta AWS -- provider tambem decide", () => {
    const admin = comGrupo("ADMIN", []);
    expect(deveMostrarBlocoOvh("aws", admin.papel === "ADMIN")).toBe(false);
  });

  it("as duas condicoes sao independentes: nenhuma sozinha basta", () => {
    // Matriz completa. Serve de documentacao executavel da regra.
    const casos: [string, boolean, boolean][] = [
      ["ovh", true, true],
      ["ovh", false, false],
      ["aws", true, false],
      ["aws", false, false],
    ];
    for (const [provider, ehAdmin, esperado] of casos) {
      expect(deveMostrarBlocoOvh(provider, ehAdmin), `${provider}/${ehAdmin}`).toBe(
        esperado,
      );
    }
  });
});
