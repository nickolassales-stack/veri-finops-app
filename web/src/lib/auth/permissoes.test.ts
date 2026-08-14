import { describe, expect, it } from "vitest";

import {
  PERMISSOES,
  PERMISSOES_DO_VIEWER,
  ROTULOS,
  can,
  ehPermissaoConhecida,
  permissoesEfetivas,
  type Autorizacao,
  type Permissao,
} from "./permissoes";

const semGrupo = (papel: "ADMIN" | "VIEWER"): Autorizacao => ({
  papel,
  permissoes: new Set(),
});

const comGrupos = (...permissoes: Permissao[]): Autorizacao => ({
  papel: "VIEWER",
  permissoes: new Set(permissoes),
});

describe("can", () => {
  it("da ao ADMIN todas as permissoes do catalogo, sem depender de grupo", () => {
    const admin = semGrupo("ADMIN");
    for (const p of PERMISSOES) {
      expect(can(admin, p), `ADMIN deveria ter ${p}`).toBe(true);
    }
  });

  it("garante o piso de leitura ao VIEWER sem nenhum grupo", () => {
    const viewer = semGrupo("VIEWER");
    expect(can(viewer, "dashboard:view")).toBe(true);
    expect(can(viewer, "analytic:view")).toBe(true);
  });

  it("nega ao VIEWER sem grupo tudo que esta alem do piso", () => {
    const viewer = semGrupo("VIEWER");
    const alemDoPiso = PERMISSOES.filter((p) => !PERMISSOES_DO_VIEWER.includes(p));

    expect(alemDoPiso.length).toBeGreaterThan(0);
    for (const p of alemDoPiso) {
      expect(can(viewer, p), `VIEWER nao deveria ter ${p}`).toBe(false);
    }
  });

  it("soma ao piso o que os grupos concedem", () => {
    const financeiro = comGrupos("analytic:export", "billing:view");

    expect(can(financeiro, "analytic:export")).toBe(true);
    expect(can(financeiro, "billing:view")).toBe(true);
    // O piso continua valendo...
    expect(can(financeiro, "dashboard:view")).toBe(true);
    // ...e o que ninguem concedeu segue negado.
    expect(can(financeiro, "settings:users")).toBe(false);
  });

  /**
   * O modelo e de UNIAO: grupo concede, nunca revoga. Sem esta garantia,
   * "por que fulano nao consegue?" viraria investigacao pela intersecao de
   * varios grupos, em vez de uma busca por quem concede.
   */
  it("nunca deixa um grupo retirar o que o papel ja garante", () => {
    const admin: Autorizacao = { papel: "ADMIN", permissoes: new Set() };
    expect(can(admin, "settings:users")).toBe(true);

    const viewerComUmGrupoQualquer = comGrupos("diagnostics:view");
    expect(can(viewerComUmGrupoQualquer, "dashboard:view")).toBe(true);
  });
});

describe("permissoesEfetivas", () => {
  it("devolve o catalogo inteiro para ADMIN", () => {
    expect(permissoesEfetivas(semGrupo("ADMIN"))).toEqual([...PERMISSOES]);
  });

  it("devolve exatamente o piso para VIEWER sem grupo", () => {
    expect(permissoesEfetivas(semGrupo("VIEWER"))).toEqual([...PERMISSOES_DO_VIEWER]);
  });

  it("preserva a ordem do catalogo, e nao a ordem de concessao", () => {
    const fora = comGrupos("billing:manage", "settings:view");
    expect(permissoesEfetivas(fora)).toEqual([
      "dashboard:view",
      "analytic:view",
      "settings:view",
      "billing:manage",
    ]);
  });
});

describe("ehPermissaoConhecida", () => {
  it("aceita o que esta no catalogo", () => {
    for (const p of PERMISSOES) {
      expect(ehPermissaoConhecida(p)).toBe(true);
    }
  });

  /**
   * O banco guarda `permission` como texto livre. Este filtro e o que garante
   * que uma linha orfa -- de uma permissao renomeada ou removida do codigo --
   * nao volte a decidir nada.
   */
  it("descarta o que o codigo nao conhece", () => {
    expect(ehPermissaoConhecida("settings:tudo")).toBe(false);
    expect(ehPermissaoConhecida("")).toBe(false);
    expect(ehPermissaoConhecida("DASHBOARD:VIEW")).toBe(false);
  });
});

describe("catalogo", () => {
  it("descreve toda permissao, para nenhuma caixa aparecer sem explicacao na tela", () => {
    for (const p of PERMISSOES) {
      expect(ROTULOS[p], `falta rotulo de ${p}`).toBeDefined();
      expect(ROTULOS[p].titulo.length).toBeGreaterThan(0);
      expect(ROTULOS[p].descricao.length).toBeGreaterThan(0);
      expect(ROTULOS[p].area.length).toBeGreaterThan(0);
    }
  });

  it("nao repete chave", () => {
    expect(new Set(PERMISSOES).size).toBe(PERMISSOES.length);
  });

  it("mantem o piso do VIEWER dentro do catalogo", () => {
    for (const p of PERMISSOES_DO_VIEWER) {
      expect(PERMISSOES).toContain(p);
    }
  });
});
