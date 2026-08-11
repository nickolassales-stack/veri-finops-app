import "server-only";

import { z } from "zod";

import {
  camposAnaliticos,
  regrasAnaliticas,
} from "@/lib/services/parametros-analiticos";

/**
 * Parametros aceitos pelas duas rotas de exportacao.
 *
 * E o MESMO conjunto de `/api/dashboard/analytic`, sem `page`/`pageSize`.
 * Exportar significa "tudo o que este filtro seleciona", nao "a pagina que
 * estava aberta" -- pedir a pagina 3 de um arquivo nao faz sentido, e aceitar o
 * parametro so criaria uma forma silenciosa de baixar um recorte incompleto.
 *
 * O objeto e o mesmo para CSV e XLSX: os dois formatos precisam responder ao
 * mesmo pedido com o mesmo conteudo, mudando so a embalagem.
 */
export const esquemaExportacao = z
  .object({ ...camposAnaliticos })
  .superRefine(regrasAnaliticas);

export type EntradaExportacao = z.infer<typeof esquemaExportacao>;
