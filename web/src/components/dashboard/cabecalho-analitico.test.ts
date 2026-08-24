import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Uma indicação de visão no cabeçalho do Analítico — e só uma.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECEU
 *
 * O título trazia um `[Visão OVH]` inline E o selo ao lado dizia "Visão OVH". Na
 * tela saía "Analítico [VISÃO OVH] [VISÃO OVH]" — a mesma informação duas vezes,
 * com dois desenhos diferentes, a meio centímetro de distância.
 *
 * Repetição adjacente não reforça; ela faz o leitor procurar a diferença entre
 * as duas e não achar nenhuma. E ninguém revisando o diff de um dos dois trechos
 * vê o outro: eles nasceram em entregas diferentes.
 *
 * O teste é estrutural (lê a fonte) porque o projeto não tem testing-library —
 * mesma abordagem de `rotas-versionadas.test.ts` e do guarda de separação dos
 * exports em `analitico-ovh.test.ts`.
 */

const ARQUIVO = join(__dirname, "cabecalho-analitico.tsx");

/**
 * Só as linhas de CÓDIGO.
 *
 * O comentário deste componente CITA a string duplicada para explicar o que foi
 * removido. Uma busca por substring reprovaria a documentação correta — erro já
 * cometido duas vezes neste repositório.
 */
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

describe("cabeçalho do Analítico", () => {
  const fonte = codigo(ARQUIVO);

  it("o <h1> é só o nome da tela", () => {
    const h1 = /<h1[\s\S]*?<\/h1>/.exec(fonte);
    expect(h1, "não achei o <h1> — o teste precisa ser reescrito").not.toBeNull();
    expect(h1![0]).not.toMatch(/Vis[ãa]o/i);
    expect(h1![0]).not.toContain("ehOvh");
    expect(h1![0]).toContain("Analítico");
  });

  it("o selo é renderizado uma única vez", () => {
    // Duas ocorrências significam dois selos na tela — o defeito original.
    expect(fonte.match(/\{t\.selo\}/g)).toHaveLength(1);
  });

  it("nenhum rótulo de visão fica escrito direto no JSX", () => {
    // Os rótulos moram em `TEXTOS`. Um literal solto no JSX é como o duplicado
    // apareceu: fora da tabela que alguém pensaria em conferir.
    const jsx = fonte.slice(fonte.indexOf("return ("));
    expect(jsx).not.toMatch(/>\s*\[?Vis[ãa]o (OVH|AWS)\]?/i);
  });

  it("o seletor de visão continua no cabeçalho", () => {
    // Ele TAMBÉM mostra "Visão AWS / Visão OVH", e isso é correto: são botões de
    // troca, não um rótulo do estado atual. Este teste existe para que a
    // correção do duplicado não o leve junto.
    expect(fonte).toContain("SeletorVisao");
  });
});
