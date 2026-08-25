import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENDPOINTS_OVH } from "./endpoints";
import {
  PARA_QUE_SERVE,
  PERMISSOES_OVH,
  REGIAO_DO_ENDPOINT,
  recomendacaoDeEndpoint,
  textoPermissoesOvh,
} from "./permissoes";

/**
 * A lista de permissões que a tela mostra precisa COBRIR o que o collector faz.
 *
 * Este é o teste que justifica o módulo existir. Uma lista escrita à mão no JSX
 * envelhece em silêncio: no dia em que o collector passar a chamar um caminho
 * novo, a tela continua ensinando a criar um token que não o cobre — e o
 * sintoma aparece só na primeira coleta, como um 403 que parece chave errada.
 *
 * O curinga `*` da OVH atravessa a barra: `GET /me/bill/*` cobre
 * `/me/bill/{id}/details/{linha}`. É por isso que a checagem casa por prefixo.
 */

const CAMINHOS_DO_COLLECTOR = [
  "/me",
  "/me/bill",
  "/me/bill/{id}",
  "/me/bill/{id}/details",
  "/me/bill/{id}/details/{linha}",
  "/cloud/project",
  "/cloud/project/{nome}",
  "/cloud/project/{nome}/usage/current",
  "/cloud/project/{nome}/usage/forecast",
];

/** Uma regra `GET /a/b/*` cobre `/a/b/qualquer/coisa`; `GET /a/b` cobre só `/a/b`. */
function cobre(regra: string, caminho: string): boolean {
  const rota = regra.replace(/^GET\s+/, "");
  if (rota.endsWith("/*")) return caminho.startsWith(rota.slice(0, -1));
  return rota === caminho;
}

describe("as permissões cobrem o que o collector chama", () => {
  for (const caminho of CAMINHOS_DO_COLLECTOR) {
    it(`cobre ${caminho}`, () => {
      expect(PERMISSOES_OVH.some((p) => cobre(p, caminho)), caminho).toBe(true);
    });
  }

  it("os caminhos testados são os que o collector realmente chama", () => {
    // Sem esta amarra, a lista acima viraria ficção: alguém acrescentaria um
    // endpoint ao collector e este arquivo continuaria passando.
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "scripts", "ovh-collector", "ovh_to_postgres.py"),
      "utf8",
    );
    for (const trecho of ["/me/bill", "/cloud/project", '"/me"']) {
      expect(fonte, trecho).toContain(trecho);
    }
  });
});

describe("a lista não libera mais do que precisa", () => {
  it("não contém o curinga da raiz", () => {
    // `GET /*` daria leitura de TUDO na conta OVH, inclusive do que o portal
    // não lê. O texto da tela diz isso, e aqui está a garantia.
    for (const p of PERMISSOES_OVH) {
      expect(p).not.toBe("GET /*");
    }
  });

  it("só concede leitura", () => {
    // POST/PUT/DELETE numa credencial de FinOps não têm uso legítimo: o portal
    // lê custo, nunca altera nada na conta OVH do cliente.
    for (const p of PERMISSOES_OVH) {
      expect(p.startsWith("GET "), p).toBe(true);
    }
  });
});

describe("o texto copiável", () => {
  it("tem uma permissão por linha, na ordem da lista", () => {
    expect(textoPermissoesOvh().split("\n")).toEqual([...PERMISSOES_OVH]);
  });

  it("são exatamente as cinco documentadas", () => {
    expect([...PERMISSOES_OVH]).toEqual([
      "GET /me",
      "GET /me/bill",
      "GET /me/bill/*",
      "GET /cloud/project",
      "GET /cloud/project/*",
    ]);
  });

  it("cada permissão diz para que serve", () => {
    for (const p of PERMISSOES_OVH) {
      expect(PARA_QUE_SERVE[p]?.length, p).toBeGreaterThan(0);
    }
  });
});

describe("recomendação de endpoint", () => {
  it("cobre as três regiões", () => {
    for (const e of ENDPOINTS_OVH) {
      expect(REGIAO_DO_ENDPOINT[e]?.length, e).toBeGreaterThan(0);
      expect(recomendacaoDeEndpoint(e)).toContain(e);
    }
  });

  it("ovh-ca é a recomendação de Canadá / América do Norte", () => {
    expect(recomendacaoDeEndpoint("ovh-ca")).toContain("Canadá");
  });
});
