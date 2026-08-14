import { z } from "zod";

import {
  camposContas,
  camposOrdenacao,
  camposPaginacao,
  camposPeriodo,
  regrasPeriodo,
} from "@/lib/filtros/esquemas";
import { CAMPOS_ORDENACAO_HISTORICO } from "@/lib/queries/historico-custos";
import type { EntradaFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * Parametros do historico mensal de custos.
 *
 * Reaproveita periodo, contas, paginacao e ordenacao dos esquemas gerais em vez
 * de redeclarar: o recorte precisa ser o MESMO das outras telas para que trocar
 * de aba preserve o filtro. Uma segunda definicao de "periodo" divergiria da
 * primeira no dia em que uma delas ganhasse uma regra nova.
 *
 * O que e proprio desta tela sao os tres filtros de cadastro. Eles vao para a
 * query como PARAMETRO ($1, $2...), entao o limite de tamanho aqui existe para
 * dar erro claro e limitar custo -- nao para evitar injecao, de que o
 * placeholder ja cuida.
 */

const cadastro = (nome: string) =>
  z
    .string()
    .trim()
    .max(120, `${nome} muito longo (maximo 120 caracteres).`)
    // "" e ausencia de filtro, nao busca por vazio. Sem esta normalizacao, um
    // seletor limpo mandaria `?unidade=` e a tela devolveria zero linhas.
    .transform((v) => (v === "" ? undefined : v))
    .optional();

export const camposHistorico = {
  ...camposPeriodo,
  ...camposContas,
  ...camposPaginacao,
  ...camposOrdenacao(CAMPOS_ORDENACAO_HISTORICO, "mes", "desc"),
  unidade: cadastro("Unidade"),
  centroDeCusto: cadastro("Centro de custo"),
  ambiente: cadastro("Ambiente"),
};

export const esquemaHistorico = z.object({ ...camposHistorico }).superRefine(regrasPeriodo);

export type EntradaHistorico = z.infer<typeof esquemaHistorico>;

/**
 * Exportacao: o mesmo conjunto SEM paginacao.
 *
 * Exportar e "tudo o que este filtro seleciona", nao "a pagina que estava
 * aberta". Aceitar `pagina` criaria uma forma silenciosa de baixar um recorte
 * incompleto com cara de completo.
 */
export const esquemaExportacaoHistorico = z
  .object({
    ...camposPeriodo,
    ...camposContas,
    ...camposOrdenacao(CAMPOS_ORDENACAO_HISTORICO, "mes", "desc"),
    unidade: cadastro("Unidade"),
    centroDeCusto: cadastro("Centro de custo"),
    ambiente: cadastro("Ambiente"),
  })
  .superRefine(regrasPeriodo);

export type EntradaExportacaoHistorico = z.infer<typeof esquemaExportacaoHistorico>;

/** Traduz a entrada validada para o que `montarFiltro` espera. */
export function historicoParaFiltro(
  entrada: EntradaHistorico | EntradaExportacaoHistorico,
): EntradaFiltroCusto {
  return {
    periodo: entrada.periodo,
    de: entrada.de,
    ate: entrada.ate,
    contas: entrada.contas,
    regiao: undefined,
  };
}
