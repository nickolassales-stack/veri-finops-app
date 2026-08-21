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

/**
 * Como uma linha e atribuida a um periodo.
 *
 * `cobranca` -- visao FINANCEIRA. E o que reconcilia com o AWS Cost Explorer,
 *               porque segue a fatura em que a AWS cobrou.
 * `uso`      -- visao OPERACIONAL. Segue o dia em que o recurso rodou. E o
 *               unico criterio que responde "em que dia isso aconteceu", e por
 *               isso continua valendo na evolucao diaria.
 *
 * Os dois numeros PODEM divergir, e isso nao e erro: uma cobranca pontual
 * (registro de dominio, taxa anual, reserva) entra na fatura de um mes com data
 * de uso em outro.
 */
export type CriterioDeData = "cobranca" | "uso";

/**
 * Mes de cobranca da linha.
 *
 * O `coalesce` e o que torna a mudanca segura de implantar: enquanto o backfill
 * nao rodou, `billing_month` e NULL, a expressao cai no mes da data de uso e
 * TODA consulta se comporta exatamente como antes. Nao existe janela em que o
 * portal fique inconsistente entre a migracao e a carga.
 */
function mesDeCobranca(alias: string): string {
  return `coalesce(${alias}.billing_month, ${mesDeUso(alias)})`;
}

/**
 * Mes da data de uso.
 *
 * O `::timestamp` e obrigatorio. Sem ele, `date_trunc('month', <date>)` resolve
 * para a sobrecarga que recebe `timestamptz`: o resultado passa a depender do
 * fuso da SESSAO, e um servidor configurado fora de UTC jogaria o dia 1o de
 * cada mes para o mes anterior. Fixar em `timestamp` torna a expressao
 * deterministica -- e e o mesmo texto do indice criado na migracao 001, que so
 * e aproveitado se casar caractere a caractere.
 */
function mesDeUso(alias: string): string {
  return `date_trunc('month', ${alias}.usage_date::timestamp)::date`;
}

/**
 * Condicao de uma janela, no criterio pedido.
 *
 * No criterio `cobranca` os dois casos sao MUTUAMENTE EXCLUSIVOS de proposito:
 *
 *   linha normal     (cobranca no mesmo mes do uso) -> filtra por usage_date,
 *                     preservando a precisao de dia que os filtros oferecem;
 *   linha deslocada  (cobranca em outro mes)        -> filtra SO pelo mes de
 *                     cobranca.
 *
 * Sem a exclusividade, a linha deslocada apareceria duas vezes: no mes da
 * fatura (por cobranca) e no mes do uso (por data). Somar o ano inteiro traria
 * o valor em dobro -- justamente o tipo de erro que esta correcao existe para
 * eliminar.
 */
function condicaoDeJanela(
  alias: string,
  criterio: CriterioDeData,
  de: string,
  ate: string,
): string {
  const porUso = `${alias}.usage_date BETWEEN ${de} AND ${ate}`;
  if (criterio === "uso") return porUso;

  const cobranca = mesDeCobranca(alias);
  const uso = mesDeUso(alias);

  return `(
         (${cobranca} =  ${uso} AND ${porUso})
      OR (${cobranca} <> ${uso}
          AND ${cobranca} BETWEEN date_trunc('month', ${de}::timestamp)::date
                              AND date_trunc('month', ${ate}::timestamp)::date)
    )`;
}

/**
 * Só a janela ATUAL, sem a de comparacao.
 *
 * Existe separada de `janelas()` porque aquela registra QUATRO parametros (as
 * duas pontas de cada janela). Quem so precisa da atual e usasse `janelas()`
 * deixaria dois valores pendurados na lista de parametros, sem nada no SQL
 * apontando para eles -- funciona, mas e uma armadilha para a proxima pessoa
 * que for numerar placeholders na mao.
 */
export function janelaAtual(
  p: ConstrutorParams,
  filtro: FiltroCusto,
  alias = "d",
  criterio: CriterioDeData = "cobranca",
): string {
  const de = p.add(filtro.periodo.de);
  const ate = p.add(filtro.periodo.ate);
  return condicaoDeJanela(alias, criterio, de, ate);
}

export function janelas(
  p: ConstrutorParams,
  filtro: FiltroCusto,
  alias = "d",
  criterio: CriterioDeData = "cobranca",
): Janelas {
  const { periodo } = filtro;
  const de = p.add(periodo.de);
  const ate = p.add(periodo.ate);
  const anteriorDe = p.add(periodo.anterior.de);
  const anteriorAte = p.add(periodo.anterior.ate);

  const atual = condicaoDeJanela(alias, criterio, de, ate);
  const anterior = condicaoDeJanela(alias, criterio, anteriorDe, anteriorAte);

  return { atual, anterior, qualquerUmaDasDuas: `(${atual} OR ${anterior})` };
}

/**
 * Ha linha DESLOCADA dentro da janela? (cobranca num mes, uso em outro)
 *
 * A interface usa isto para explicar por que o total financeiro nao bate com a
 * soma do grafico diario -- sem esse aviso, a diferenca parece defeito.
 */
export function condicaoDeslocada(alias = "d"): string {
  return `${mesDeCobranca(alias)} <> ${mesDeUso(alias)}`;
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
