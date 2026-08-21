import { z } from "zod";

import { rotaProtegida } from "@/lib/api/rota";
import { camposContas, camposPeriodo, camposRegiao, regrasPeriodo } from "@/lib/filtros/esquemas";
import { getSerieDiaria } from "@/lib/queries/dashboard";
import { resolverFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/daily -- evolucao diaria do custo.
 *
 * A serie vem com TODOS os dias do periodo, inclusive os que nao tem linha na
 * base. Esses vem com `semDado: true` e total zero: um dia sem carga precisa
 * aparecer como lacuna, nunca como queda de consumo a zero.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esquema = z
  .object({ ...camposPeriodo, ...camposContas, ...camposRegiao })
  .superRefine(regrasPeriodo);

export const GET = rotaProtegida("GET /api/dashboard/daily", async ({ url, tz }) => {
  const { filtro, meta } = await resolverFiltroCusto(url, tz, esquema);
  const serie = await getSerieDiaria(filtro);

  const diasSemDado = serie.filter((p) => p.semDado).length;

  return {
    dados: serie,
    meta: {
      ...meta,
      pontos: serie.length,
      diasSemDado,
      total: serie.reduce((acc, p) => acc + p.total, 0),
    },
  };
});
