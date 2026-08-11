import "server-only";

import { z } from "zod";

import {
  REGIAO_NAO_INFORMADA,
  camposContas,
  camposOrdenacao,
} from "@/lib/filtros/esquemas";
import { MAX_DIAS_PERIODO, contarDias, ehDataISOValida } from "@/lib/filtros/periodo";
import { CAMPOS_ORDENACAO_ANALITICA } from "@/lib/queries/analitico";

import type { EntradaFiltroCusto } from "./filtro-custo";

/**
 * Contrato de parametros da consulta analitica.
 *
 * VIVE FORA DAS ROTAS de proposito. `/api/dashboard/analytic` e as duas rotas de
 * exportacao precisam aplicar EXATAMENTE o mesmo recorte -- se o arquivo baixado
 * trouxesse linhas diferentes das que estao na tela, o numero exportado nao
 * poderia ser conferido contra o portal, e um relatorio que nao bate com a tela
 * e pior do que nenhum relatorio.
 *
 * Compartilhando os campos, a unica diferenca entre consultar e exportar passa a
 * ser a paginacao: a tela pede uma pagina, a exportacao percorre todas.
 *
 * Os nomes sao os do contrato desta familia de rotas (`startDate`, `accountIds`,
 * `serviceSearch`...), diferentes dos nomes em portugues usados pelos endpoints
 * do painel executivo.
 */

const dataISO = z
  .string()
  .trim()
  .refine(ehDataISOValida, "Use uma data real no formato AAAA-MM-DD.");

/** Campos aceitos por todas as rotas analiticas (consulta e exportacao). */
export const camposAnaliticos = {
  startDate: dataISO.optional(),
  endDate: dataISO.optional(),

  // Reaproveita a validacao de contas (lista, "todas", teto de 50, formato do
  // id) apenas trocando o nome do parametro.
  accountIds: camposContas.contas,

  serviceSearch: z
    .string()
    .trim()
    .max(100, "Busca por servico muito longa (maximo 100 caracteres).")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  region: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || v === REGIAO_NAO_INFORMADA || /^[A-Za-z0-9-]{1,32}$/.test(v),
      "Regiao invalida.",
    )
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  ...renomearOrdenacao(),
};

/** `camposOrdenacao` gera `ordenarPor`/`direcao`; aqui viram sortBy/sortDirection. */
function renomearOrdenacao() {
  const { ordenarPor, direcao } = camposOrdenacao(CAMPOS_ORDENACAO_ANALITICA, "usageDate");
  return { sortBy: ordenarPor, sortDirection: direcao };
}

export type EntradaAnalitica = {
  startDate?: string;
  endDate?: string;
  accountIds: string[];
  serviceSearch?: string;
  region?: string;
  sortBy: (typeof CAMPOS_ORDENACAO_ANALITICA)[number];
  sortDirection: "asc" | "desc";
};

/**
 * Regras que dependem de mais de um campo. Aplicada com `.superRefine()` por
 * toda rota que use `camposAnaliticos`.
 */
export function regrasAnaliticas(
  valor: { startDate?: string; endDate?: string },
  ctx: z.RefinementCtx,
): void {
  const { startDate, endDate } = valor;

  // Uma data sozinha nao define janela: seria adivinhar a outra ponta.
  if (Boolean(startDate) !== Boolean(endDate)) {
    ctx.addIssue({
      code: "custom",
      path: [startDate ? "endDate" : "startDate"],
      message: "Informe startDate e endDate juntos, ou nenhum dos dois.",
    });
    return;
  }

  if (!startDate || !endDate) return;

  if (startDate > endDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `endDate (${endDate}) nao pode ser anterior a startDate (${startDate}).`,
    });
    return;
  }

  const dias = contarDias(startDate, endDate);
  if (dias > MAX_DIAS_PERIODO) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `Periodo de ${dias} dias excede o maximo de ${MAX_DIAS_PERIODO}.`,
    });
  }
}

/**
 * Traduz a entrada validada para o formato que `montarFiltro` entende.
 *
 * Sem datas explicitas cai no periodo padrao -- o MESMO do painel executivo,
 * incluindo o corte pela ultima carga do ETL.
 */
export function entradaParaFiltro(entrada: EntradaAnalitica): EntradaFiltroCusto {
  return {
    periodo: entrada.startDate ? "personalizado" : undefined,
    de: entrada.startDate,
    ate: entrada.endDate,
    contas: entrada.accountIds,
    regiao: entrada.region,
  };
}
