import { z } from "zod";

import { rotaProtegida } from "@/lib/api/rota";
import { camposContas, camposPeriodo, camposRegiao, regrasPeriodo } from "@/lib/filtros/esquemas";
import { getResumo } from "@/lib/queries/dashboard";
import { resolverFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/summary -- numeros de cabecalho do periodo.
 *
 * Devolve `comparavel: false` quando o conjunto de contas com dado muda entre a
 * janela atual e a anterior. Nesse caso a variacao percentual existe no JSON
 * mas NAO representa mudanca de consumo -- representa ausencia de carga. Quem
 * consome precisa exibir o aviso em vez do numero.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esquema = z
  .object({ ...camposPeriodo, ...camposContas, ...camposRegiao })
  .superRefine(regrasPeriodo);

export const GET = rotaProtegida("GET /api/dashboard/summary", async ({ url, tz }) => {
  const { filtro, meta } = await resolverFiltroCusto(url, tz, esquema);
  const resumo = await getResumo(filtro);

  return { dados: resumo, meta };
});
