import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A página de Diagnóstico não pode voltar a carregar tudo num `Promise.all` cru.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM GUARDA ESTRUTURAL
 *
 * O defeito não estava em nenhuma das funções: cada carregador fazia o seu
 * trabalho. Estava na COMPOSIÇÃO — `Promise.all` rejeita inteiro se qualquer
 * promessa rejeitar, então bastou uma consulta estourar para a página inteira
 * sumir, inclusive as quatro seções que tinham carregado bem.
 *
 * Um teste de unidade de qualquer um dos carregadores passa com folga nesse
 * cenário. O que precisa ser guardado é a forma de juntá-los, e ela é visível na
 * fonte: todo carregador passa por `tentarSecao`.
 *
 * Sem este guarda, a próxima seção acrescentada à página entra crua no
 * `Promise.all` — a correção some sem que nada falhe — e a tela volta a morrer
 * inteira por causa de uma consulta.
 */

const PAGINA = join(
  __dirname,
  "..",
  "..",
  "app",
  "(privado)",
  "dashboard",
  "diagnostico",
  "page.tsx",
);

function codigo(caminho: string): string {
  return readFileSync(caminho, "utf8")
    .split(/\r?\n/)
    .filter((l) => {
      const s = l.trim();
      return (
        s !== "" && !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*")
      );
    })
    .join("\n");
}

describe("Diagnóstico carrega por seção", () => {
  const fonte = codigo(PAGINA);

  it("encontra a página", () => {
    expect(fonte).toContain("DiagnosticoPipelinePage");
  });

  it("todo item de Promise.all passa por tentarSecao", () => {
    const blocos = fonte.match(/Promise\.all\(\[([\s\S]*?)\]\)/g) ?? [];
    expect(blocos.length).toBeGreaterThan(0);

    for (const bloco of blocos) {
      const itens = bloco
        .replace(/^Promise\.all\(\[/, "")
        .replace(/\]\)$/, "")
        .split(/,\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s !== "");

      for (const item of itens) {
        expect(item, `item cru em Promise.all: ${item}`).toContain("tentarSecao(");
      }
    }
  });

  it("nenhum carregador de dado é chamado sem proteção", () => {
    // A lista é dos que já derrubaram a tela ou podem derrubá-la: todos leem o
    // banco e todos podem lançar.
    const carregadores = [
      "montarDiagnostico",
      "montarVisaoOvh",
      "getEstadoColetaOvh",
      "getOrigemCredenciaisOvh",
      "listarTabelas",
      "listarPrivilegiosDoApp",
    ];

    for (const nome of carregadores) {
      // Chamada direta com `await`, fora de `tentarSecao`.
      const cru = new RegExp(`await\\s+${nome}\\s*\\(`);
      expect(cru.test(fonte), `${nome} é chamado com await cru`).toBe(false);
      expect(fonte, `${nome} sumiu da página`).toContain(nome);
    }
  });

  it("o resultado de cada seção é verificado antes de ser usado", () => {
    // `Secao<T>` é união discriminada: sem checar `.ok`, o TypeScript já barra o
    // acesso a `.valor`. Este teste guarda o outro lado — que a página de fato
    // desenha o ramo de falha em vez de silenciá-lo com `?? {}`.
    expect(fonte).toContain("SecaoIndisponivel");
    expect(fonte).toMatch(/d\.ok/);
  });
});
