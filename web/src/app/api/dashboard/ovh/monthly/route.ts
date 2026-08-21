import { rotaComPermissao } from "@/lib/api/rota";
import { mesesDaJanela } from "@/lib/filtros/periodo-mensal";
import { getMensalOvh } from "@/lib/queries/dashboard-ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/dashboard/ovh/monthly -- evolucao mensal do custo.
 *
 * A serie sai com TODOS os meses da janela, inclusive os sem fatura, e o mes sem
 * fatura vem com `total: null` -- nao com zero.
 *
 * A diferenca decide o desenho do grafico. Com zero, a linha mergulha ate a base
 * e o mes parece de custo nulo. Com `null`, `connectNulls={false}` deixa um
 * buraco, que e a verdade: a OVH fatura dias depois do fim do mes, e o mes
 * corrente legitimamente ainda nao tem linha de `invoice`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/monthly",
  "dashboard:view",
  async ({ url, tz }) => {
    const { filtro, periodo, estado, meta } = await resolverFiltroOvh(url, tz);

    const meses = mesesDaJanela(periodo);

    if (!filtro) {
      return {
        dados: meses.map((mes) => ({ mes, total: null, linhas: 0 })),
        meta: { ...meta, estado, mesesComDado: 0 },
      };
    }

    const encontrados = await getMensalOvh(filtro);
    const porMes = new Map(encontrados.map((p) => [p.mes, p]));

    return {
      dados: meses.map((mes) => {
        const ponto = porMes.get(mes);
        return {
          mes,
          total: ponto ? ponto.total : null,
          linhas: ponto?.linhas ?? 0,
        };
      }),
      meta: { ...meta, estado, mesesComDado: encontrados.length },
    };
  },
);
