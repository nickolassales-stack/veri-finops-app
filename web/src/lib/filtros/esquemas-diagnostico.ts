import { z } from "zod";

/**
 * Validacao dos parametros das rotas de diagnostico.
 *
 * Sao poucos e todos numericos, mas passam por Zod pela mesma razao do resto do
 * sistema: o valor que chega a consulta e o que SAIU do esquema, nunca o que
 * veio da URL. `limite=999999` numa tabela de historico e um pedido de varredura
 * completa disfarcado de paginacao.
 *
 * Nenhum destes valores vira nome de coluna ou trecho de SQL -- todos entram por
 * placeholder. O esquema serve para dar limite e erro claro, nao para evitar
 * injecao, de que o parametro ja cuida.
 */

/** Quantas execucoes o historico devolve de uma vez. */
export const esquemaHistoricoEtl = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(10),
  /** Janela do resumo (total, sucessos, falhas, duracao media). */
  dias: z.coerce.number().int().min(1).max(365).default(30),
});

export type ParametrosHistoricoEtl = z.infer<typeof esquemaHistoricoEtl>;

/**
 * Sobrescrita do limite de "conta parada".
 *
 * Existe porque o limite bom depende da conta: uma de laboratorio pode passar
 * uma semana sem lancamento sem que isso signifique nada, e uma de producao
 * parada por dois dias e incidente. O padrao vem do ambiente
 * (DIAGNOSTICO_DIAS_SEM_ATUALIZACAO); este parametro permite conferir outro
 * corte sem reiniciar o portal.
 */
export const esquemaFrescor = z.object({
  diasSemAtualizacao: z.coerce.number().int().min(1).max(90).optional(),
});

export type ParametrosFrescor = z.infer<typeof esquemaFrescor>;
