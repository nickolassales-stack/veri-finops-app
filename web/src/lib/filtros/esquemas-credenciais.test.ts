import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  esquemaCredencialOvh,
  esquemaEnfileirarColeta,
} from "./esquemas-credenciais";

describe("esquemaEnfileirarColeta", () => {
  it("assume first_sync quando action nao vem", () => {
    const r = esquemaEnfileirarColeta.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.action).toBe("first_sync");
  });

  it("aceita manual_sync", () => {
    const r = esquemaEnfileirarColeta.safeParse({ action: "manual_sync" });
    expect(r.success).toBe(true);
  });

  it("recusa action fora da lista", () => {
    expect(esquemaEnfileirarColeta.safeParse({ action: "success" }).success).toBe(false);
    expect(esquemaEnfileirarColeta.safeParse({ action: "" }).success).toBe(false);
  });

  it("recusa campo desconhecido", () => {
    // `.strict()` importa aqui: sem ele, uma tentativa de mandar `status` ou
    // `syncRunId` pela rota passaria em silencio e daria a impressao de que o
    // cliente pode escrever no estado do job. Ele nao pode -- o portal so tem
    // SELECT e INSERT em cloud_sync_jobs.
    expect(
      esquemaEnfileirarColeta.safeParse({ action: "first_sync", status: "success" })
        .success,
    ).toBe(false);
  });
});

describe("esquemaCredencialOvh: campo vazio significa manter", () => {
  it("converte string vazia em undefined", () => {
    const r = esquemaCredencialOvh.safeParse({
      endpoint: "ovh-ca",
      applicationKey: "",
      applicationSecret: null,
      consumerKey: "   ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.applicationKey).toBeUndefined();
      expect(r.data.applicationSecret).toBeUndefined();
      expect(r.data.consumerKey).toBeUndefined();
    }
  });

  it("recusa endpoint fora da lista do projeto", () => {
    expect(
      esquemaCredencialOvh.safeParse({ endpoint: "ovh-br" }).success,
    ).toBe(false);
  });

  it("aceita os tres endpoints reais", () => {
    for (const endpoint of ["ovh-ca", "ovh-eu", "ovh-us"]) {
      expect(esquemaCredencialOvh.safeParse({ endpoint }).success).toBe(true);
    }
  });
});

/**
 * As rotas de credencial precisam ser ADMIN por PAPEL, nao por permissao.
 *
 * `can()` da tudo ao ADMIN mas tambem deixa qualquer grupo conceder qualquer
 * permissao a um nao-ADMIN, entao nenhuma permissao consegue expressar "so
 * ADMIN" -- `rbac-credenciais.test.ts` prova isso varrendo PERMISSOES.
 *
 * Este teste guarda a consequencia: se alguem trocar `rotaSomenteAdmin` por
 * `rotaComPermissao` numa destas rotas, um VIEWER com a permissao certa passa a
 * gravar credencial. Ler o arquivo e grosseiro, e e o unico jeito de verificar
 * isso sem subir o servidor.
 */
describe("rotas de credencial usam rotaSomenteAdmin", () => {
  const RAIZ = join(__dirname, "..", "..", "app", "api", "admin", "accounts", "[accountId]");

  const ROTAS = [
    join(RAIZ, "credentials", "route.ts"),
    join(RAIZ, "credentials", "test", "route.ts"),
    join(RAIZ, "credentials", "sync", "route.ts"),
  ];

  for (const caminho of ROTAS) {
    it(`${caminho.split("api")[1]} exige ADMIN por papel`, () => {
      const fonte = readFileSync(caminho, "utf8");
      // Casa o BIND do handler, nao a mencao ao nome: os arquivos citam
      // `rotaComPermissao` em comentario, justamente para explicar por que nao a
      // usam. Uma busca por substring reprovaria a documentacao correta.
      const binds = [...fonte.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)/g)];
      expect(binds.length).toBeGreaterThan(0);
      for (const [, metodo, guarda] of binds) {
        expect(guarda, `${metodo} nesta rota`).toBe("rotaSomenteAdmin");
      }
    });
  }

  it("a rota de fila nao expoe DELETE", () => {
    // Cancelar job em `running` daria a impressao de interromper uma coleta que
    // segue correndo no host -- o worker nao observa cancelamento.
    const fonte = readFileSync(join(RAIZ, "credentials", "sync", "route.ts"), "utf8");
    expect(fonte).not.toContain("export const DELETE");
  });
});
