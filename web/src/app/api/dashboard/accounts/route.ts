import { z } from "zod";

import { rotaProtegida } from "@/lib/api/rota";
import {
  camposContas,
  camposOrdenacao,
  camposPaginacao,
  camposPeriodo,
  camposRegiao,
  regrasPeriodo,
} from "@/lib/filtros/esquemas";
import { CAMPOS_ORDENACAO_CUSTO, getCustoPorConta } from "@/lib/queries/dashboard";
import { resolverFiltroCusto } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/accounts -- custo por conta AWS no periodo.
 *
 * `temDadoNaJanela: false` distingue "a conta nao gastou" de "o ETL nao
 * carregou este periodo para a conta". Sao situacoes diferentes e a segunda
 * nao pode ser exibida como zero.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esquema = z
  .object({
    ...camposPeriodo,
    ...camposContas,
    ...camposRegiao,
    ...camposPaginacao,
    ...camposOrdenacao(CAMPOS_ORDENACAO_CUSTO, "custo"),
  })
  .superRefine(regrasPeriodo);

export const GET = rotaProtegida("GET /api/dashboard/accounts", async ({ url, tz }) => {
  const { entrada, filtro, meta } = await resolverFiltroCusto(url, tz, esquema);

  const { itens, total, totalDaJanela } = await getCustoPorConta(filtro, {
    ordenarPor: entrada.ordenarPor,
    direcao: entrada.direcao,
    pagina: entrada.pagina,
    tamanho: entrada.tamanho,
  });

  return {
    dados: itens,
    meta: {
      ...meta,
      totalDaJanela,
      paginacao: {
        pagina: entrada.pagina,
        tamanho: entrada.tamanho,
        total,
        paginas: Math.max(1, Math.ceil(total / entrada.tamanho)),
      },
      ordenacao: { campo: entrada.ordenarPor, direcao: entrada.direcao },
    },
  };
});
