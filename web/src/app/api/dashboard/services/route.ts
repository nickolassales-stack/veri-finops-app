import { z } from "zod";

import { rotaProtegida } from "@/lib/api/rota";
import { camposContas, camposPeriodo, camposRegiao, regrasPeriodo } from "@/lib/filtros/esquemas";
import { getTopServicos } from "@/lib/queries/dashboard";
import { resolverFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/services -- maiores servicos do periodo.
 *
 * `limite` padrao 10, conforme a especificacao. `outros` traz a soma do que
 * ficou de fora, para o grafico nao dar a impressao de que o top N e o total.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_PADRAO = 10;

const esquema = z
  .object({
    ...camposPeriodo,
    ...camposContas,
    ...camposRegiao,
    limite: z.coerce.number().int().min(1).max(50).default(LIMITE_PADRAO),
  })
  .superRefine(regrasPeriodo);

export const GET = rotaProtegida("GET /api/dashboard/services", async ({ url, tz }) => {
  const { entrada, filtro, meta } = await resolverFiltroCusto(url, tz, esquema);
  const { itens, outros, totalDaJanela, servicosNaJanela } = await getTopServicos(
    filtro,
    entrada.limite,
  );

  return {
    dados: itens,
    meta: {
      ...meta,
      limite: entrada.limite,
      outros,
      totalDaJanela,
      servicosNaJanela,
    },
  };
});
