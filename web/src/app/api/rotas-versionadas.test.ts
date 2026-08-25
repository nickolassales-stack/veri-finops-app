import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Toda rota de API que existe no disco precisa estar RASTREADA pelo Git.
 *
 * Este teste existe por causa de um incidente real. O `.gitignore` tinha a linha
 * `credentials`, sem barra, que casa com qualquer arquivo ou diretorio de mesmo
 * nome em qualquer profundidade -- e engoliu
 * `src/app/api/admin/accounts/[accountId]/credentials/`.
 *
 * O modo de falha e o que torna isto necessario: `git add` ignora caminhos
 * ignorados em SILENCIO, `git status` nao os mostra, e lint, testes, build e
 * typecheck passam todos, porque na maquina de quem desenvolve os arquivos
 * estao la. So o container construido a partir do repositorio nao os tem, e a
 * tela responde 404 em producao depois de um deploy inteiramente verde.
 *
 * Nenhuma verificacao existente podia pegar isso: todas leem o disco. Esta le o
 * Git.
 */

const RAIZ_API = join(__dirname);

function rotasNoDisco(dir: string): string[] {
  const achadas: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) achadas.push(...rotasNoDisco(caminho));
    else if (entrada.name === "route.ts" || entrada.name === "route.tsx") achadas.push(caminho);
  }
  return achadas;
}

/**
 * Rotas que o Git ENXERGA -- rastreadas, ou nao rastreadas mas nao ignoradas.
 *
 * `--cached --others --exclude-standard`, e nao apenas `ls-files`. A diferenca
 * importa: com o padrao, toda rota recem-criada reprovava este teste ate alguem
 * rodar `git add`, e o autor recebia a mensagem "regra do .gitignore" para um
 * arquivo perfeitamente visivel. Um guarda que grita no caso normal e um guarda
 * que se aprende a ignorar -- e ele existe para o dia em que o alarme for real.
 *
 * `--exclude-standard` e a peca que preserva a deteccao: arquivo IGNORADO nao
 * aparece em `--others`, entao a rota engolida pelo .gitignore continua faltando
 * da lista e continua reprovando. Foi assim que duas rotas de credencial
 * viraram 404 em producao.
 *
 * `null` quando o Git nao esta disponivel -- dentro da imagem, `.git` nao existe.
 */
function visiveisParaOGit(): Set<string> | null {
  try {
    const saida = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "src/app/api"],
      {
      cwd: join(__dirname, "..", "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(saida.split("\n").filter(Boolean));
  } catch {
    return null;
  }
}

describe("rotas de API versionadas", () => {
  it("nenhuma rota existe no disco sem o Git enxergar", () => {
    const visiveis = visiveisParaOGit();
    if (visiveis === null) return; // sem Git: nada a verificar

    const raizWeb = join(__dirname, "..", "..", "..");
    const ausentes = rotasNoDisco(RAIZ_API)
      .map((p) => relative(raizWeb, p).split(sep).join("/"))
      .filter((p) => !visiveis.has(p));

    expect(
      ausentes,
      "Rota(s) de API invisiveis para o Git -- nem rastreadas, nem passiveis " +
        "de `git add`. E regra do .gitignore casando " +
        "um segmento do caminho. Confira com: git check-ignore -v <caminho>",
    ).toEqual([]);
  });

  it("encontra as rotas de credenciais, que foram o caso do incidente", () => {
    const rotas = rotasNoDisco(RAIZ_API).map((p) => p.split(sep).join("/"));
    expect(rotas.some((r) => r.endsWith("credentials/route.ts"))).toBe(true);
    expect(rotas.some((r) => r.endsWith("credentials/test/route.ts"))).toBe(true);
  });
});
