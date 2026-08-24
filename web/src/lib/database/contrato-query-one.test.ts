import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listarArquivos } from "./listar-arquivos-de-teste";

/**
 * Guarda contra a armadilha que derrubou o Diagnóstico em produção.
 *
 * ---------------------------------------------------------------------------
 * A ARMADILHA
 *
 * `queryOne` devolve `Promise<T>` — tipo NÃO-NULÁVEL — e LANÇA quando não há
 * linha. Quem escreve
 *
 *     const linha = await queryOne<L>("… LIMIT 1");
 *     return linha ? mapear(linha) : null;
 *
 * escreve um teste de nulo que o TypeScript aceita em silêncio (`L` é objeto,
 * então `linha ?` é sempre verdadeiro) e que nunca roda. O autor acredita ter
 * tratado a ausência; o código lança.
 *
 * Nenhuma das defesas normais pega isso: o compilador não reclama, o lint não
 * reclama, e o teste com dado presente passa. A falha só aparece quando a linha
 * some — e para `cloud_sync_jobs` isso significou quebrar no instante em que a
 * última coleta terminou com sucesso, que é o estado de REPOUSO da fila.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE TESTE FAZ
 *
 * Lê o SQL de cada chamada a `queryOne` e reprova as duas formas em que zero
 * linhas é resultado legítimo e não defeito:
 *
 *   1. `ON CONFLICT DO NOTHING … RETURNING` — o conflito é o caminho esperado, e
 *      nele o `RETURNING` não devolve nada;
 *   2. `LIMIT 1` num SELECT sem agregação — escrever `LIMIT 1` é declarar que o
 *      filtro pode casar com várias linhas; o mesmo filtro pode casar com zero.
 *
 * Agregação (`count`, `sum`, `max`), `SELECT EXISTS` e `to_regclass` sempre
 * devolvem exatamente uma linha — para esses, `queryOne` é o certo, e é por isso
 * que o teste não os toca.
 *
 * A correção, nos dois casos, é `queryOpcional`, que devolve `T | null` e faz o
 * compilador exigir o tratamento.
 */

const RAIZ_QUERIES = join(__dirname, "..", "queries");

/** SQL de cada chamada a `queryOne` no arquivo, na ordem em que aparecem. */
function sqlDasChamadas(fonte: string, alvo: string): { linha: number; sql: string }[] {
  const achados: { linha: number; sql: string }[] = [];
  let de = 0;

  for (;;) {
    const i = fonte.indexOf(`${alvo}<`, de);
    if (i < 0) break;
    de = i + alvo.length;

    // O SQL é sempre um template literal. Do primeiro backtick depois da
    // chamada até o próximo — as consultas do projeto não aninham backtick, e
    // um dia já custou caro justamente por tentarem (ver dashboard-ovh.ts).
    const abre = fonte.indexOf("`", i);
    if (abre < 0) continue;
    const fecha = fonte.indexOf("`", abre + 1);
    if (fecha < 0) continue;

    achados.push({
      linha: fonte.slice(0, i).split("\n").length,
      sql: fonte.slice(abre + 1, fecha),
    });
  }
  return achados;
}

/** Devolve exatamente uma linha por construção, sempre. */
function sempreUmaLinha(sql: string): boolean {
  return (
    /\b(count|sum|max|min|avg)\s*\(/i.test(sql) ||
    /\bEXISTS\s*\(/i.test(sql) ||
    /to_regclass/i.test(sql)
  );
}

function podeVirVazia(sql: string): string | null {
  if (/\bON\s+CONFLICT\b[\s\S]*\bDO\s+NOTHING\b/i.test(sql) && /\bRETURNING\b/i.test(sql)) {
    return "ON CONFLICT DO NOTHING … RETURNING não devolve linha quando há conflito";
  }
  if (/\bLIMIT\s+1\b/i.test(sql) && !sempreUmaLinha(sql)) {
    return "SELECT … LIMIT 1 devolve zero linhas quando o filtro não casa";
  }
  return null;
}

describe("queryOne só onde zero linhas é defeito", () => {
  const arquivos = listarArquivos(RAIZ_QUERIES);

  it("encontra os módulos de query", () => {
    // Sem isto, um erro de caminho faria o teste passar sem inspecionar nada —
    // um guarda que aprova tudo é pior do que nenhum.
    expect(arquivos.length).toBeGreaterThan(3);
  });

  it("nenhuma chamada a queryOne pode legitimamente devolver zero linhas", () => {
    const infratores: string[] = [];

    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, "utf8");
      for (const { linha, sql } of sqlDasChamadas(fonte, "queryOne")) {
        const motivo = podeVirVazia(sql);
        if (motivo) {
          const curto = arquivo.split(/[\\/]/).slice(-2).join("/");
          infratores.push(`${curto}:${linha} — ${motivo}. Use queryOpcional.`);
        }
      }
    }

    expect(infratores).toEqual([]);
  });

  it("o teste reprova o padrão que quebrou em produção", () => {
    // Controle negativo. Sem ele, um erro na extração do SQL faria a lista de
    // infratores vir sempre vazia e o guarda aprovaria exatamente o bug que
    // existe para impedir.
    const comoEra = `
      SELECT id, status
        FROM cloud_sync_jobs
       WHERE provider = $1 AND account_id = $2 AND status = ANY($3)
       ORDER BY requested_at DESC
       LIMIT 1`;
    expect(podeVirVazia(comoEra)).toContain("LIMIT 1");

    const insercao = `
      INSERT INTO cloud_sync_jobs (provider, account_id)
      VALUES ($1, $2)
          ON CONFLICT DO NOTHING
       RETURNING id`;
    expect(podeVirVazia(insercao)).toContain("ON CONFLICT");
  });

  it("não reprova agregação, que sempre devolve uma linha", () => {
    expect(podeVirVazia("SELECT count(*) AS total FROM app_users WHERE active")).toBeNull();
    expect(
      podeVirVazia("SELECT EXISTS (SELECT 1 FROM cloud_accounts WHERE account_id = $1) AS existe"),
    ).toBeNull();
    expect(
      podeVirVazia("SELECT to_regclass('public.cloud_sync_jobs') IS NOT NULL AS existe"),
    ).toBeNull();
    expect(podeVirVazia("SELECT max(usage_date) AS maior FROM aws_daily_costs")).toBeNull();
  });
});
