import { z } from "zod";

import { rotaProtegida } from "@/lib/api/rota";
import { camposContas, camposPeriodo, camposRegiao, regrasPeriodo } from "@/lib/filtros/esquemas";
import { getSerieDiariaPorServico } from "@/lib/queries/dashboard";
import { resolverFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/daily-by-service -- evolucao diaria quebrada por servico.
 *
 * Formato de matriz: `dias` e o eixo e cada serie traz `valores` alinhados
 * indice a indice. Fica bem menor que repetir a data em cada ponto e e o que o
 * grafico consome direto.
 *
 * Servicos alem do `limite` sao somados em "Outros" -- agregado no banco. Alem
 * de limitar o payload, isso respeita a regra de cores do projeto: a paleta
 * categorica e uma lista fixa e nao pode ser reciclada para uma serie N+1.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_PADRAO = 8;

const esquema = z
  .object({
    ...camposPeriodo,
    ...camposContas,
    ...camposRegiao,
    limite: z.coerce.number().int().min(1).max(20).default(LIMITE_PADRAO),
  })
  .superRefine(regrasPeriodo);

export const GET = rotaProtegida(
  "GET /api/dashboard/daily-by-service",
  async ({ url, tz }) => {
    const { entrada, filtro, meta } = await resolverFiltroCusto(url, tz, esquema);
    const { dias, series, agrupou, servicosNaJanela } = await getSerieDiariaPorServico(
      filtro,
      entrada.limite,
    );

    return {
      dados: { dias, series },
      meta: {
        ...meta,
        limite: entrada.limite,
        agrupouEmOutros: agrupou,
        servicosNaJanela,
        pontos: dias.length,
      },
    };
  },
);
