import "server-only";

import { ConstrutorParams } from "@/lib/database";
import { REGIAO_NAO_INFORMADA, REGIAO_CRUA_INVALIDA } from "@/lib/filtros/esquemas";
import type { PeriodoResolvido } from "@/lib/filtros/periodo";

/**
 * Pedacos de SQL compartilhados pelas queries de custo.
 *
 * Toda funcao daqui recebe o `ConstrutorParams` e devolve texto de SQL contendo
 * SOMENTE placeholders -- nenhum valor de usuario e concatenado.
 */

export type FiltroCusto = {
  periodo: PeriodoResolvido;
  /** Vazio significa "todas as contas". Nunca ha id fixo no codigo. */
  contas: string[];
  /** `undefined` = sem corte por regiao. */
  regiao?: string;
};

/** Placeholders das duas janelas, para reuso dentro da mesma query. */
export type Janelas = {
  atual: string;
  anterior: string;
  qualquerUmaDasDuas: string;
};

export function janelas(
  p: ConstrutorParams,
  filtro: FiltroCusto,
  alias = "d",
): Janelas {
  const { periodo } = filtro;
  const de = p.add(periodo.de);
  const ate = p.add(periodo.ate);
  const anteriorDe = p.add(periodo.anterior.de);
  const anteriorAte = p.add(periodo.anterior.ate);

  const atual = `${alias}.usage_date BETWEEN ${de} AND ${ate}`;
  const anterior = `${alias}.usage_date BETWEEN ${anteriorDe} AND ${anteriorAte}`;

  return { atual, anterior, qualquerUmaDasDuas: `(${atual} OR ${anterior})` };
}

/**
 * Condicoes de conta e regiao, ja como texto pronto para entrar num WHERE.
 *
 * Devolve array para o chamador decidir onde encaixar: na serie diaria elas
 * precisam ir na condicao do LEFT JOIN, nao no WHERE, senao o dia sem dado
 * some do grafico em vez de aparecer como zero.
 */
export function condicoesDeCorte(
  p: ConstrutorParams,
  filtro: FiltroCusto,
  alias = "d",
): string[] {
  const condicoes: string[] = [];

  if (filtro.contas.length > 0) {
    // = ANY($n) aceita o array inteiro como UM parametro. Montar um IN (...)
    // com N placeholders geraria um texto de SQL diferente a cada chamada.
    condicoes.push(`${alias}.account_id = ANY(${p.add(filtro.contas)})`);
  }

  if (filtro.regiao === REGIAO_NAO_INFORMADA) {
    // O ETL grava a string "nan" (NaN do pandas) quando nao sabe a regiao.
    // NULL nao aparece hoje, mas entra na condicao porque seria o valor
    // correto se o ETL for consertado.
    condicoes.push(
      `(${alias}.region IS NULL OR ${alias}.region = ${p.add(REGIAO_CRUA_INVALIDA)})`,
    );
  } else if (filtro.regiao) {
    condicoes.push(`${alias}.region = ${p.add(filtro.regiao)}`);
  }

  return condicoes;
}

/** Junta condicoes com AND, devolvendo "true" quando nao ha nenhuma. */
export function juntarE(condicoes: string[]): string {
  return condicoes.length > 0 ? condicoes.join("\n       AND ") : "true";
}
