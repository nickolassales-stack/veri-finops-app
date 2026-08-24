import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Lista recursiva de módulos `.ts` que NÃO são teste.
 *
 * Existe como arquivo próprio, e não dentro do `.test.ts`, porque `readdirSync`
 * recursivo aparece em mais de um guarda estrutural do projeto e duplicá-lo faz
 * os dois divergirem — um passa a varrer uma pasta que o outro ignora, sem que
 * nenhum dos dois falhe para avisar.
 */
export function listarArquivos(raiz: string): string[] {
  const saida: string[] = [];

  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    const caminho = join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      saida.push(...listarArquivos(caminho));
    } else if (entrada.name.endsWith(".ts") && !entrada.name.includes(".test.")) {
      saida.push(caminho);
    }
  }
  return saida;
}
