import { rotaComPermissao } from "@/lib/api/rota";
import { participacao } from "@/lib/dashboard/ovh";
import { getResumoOvh, getServicosOvh } from "@/lib/queries/dashboard-ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/dashboard/ovh/services -- top servicos por custo, e a distribuicao.
 *
 * Alimenta DOIS blocos da tela: o ranking em barras e a distribuicao percentual.
 * Um endpoint so porque as duas respondem a mesma consulta -- separa-los faria a
 * mesma agregacao rodar duas vezes e abriria a chance de as duas divergirem.
 *
 * `outros` vem no `meta`, e nao como um item da lista: "Outros" nao e um
 * servico, e sim o resto que nao entrou no topo. Como item, ele seria ordenavel
 * e clicavel como se fosse uma entidade real.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOPO = 10;

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/services",
  "dashboard:view",
  async ({ url, tz }) => {
    const { filtro, estado, meta } = await resolverFiltroOvh(url, tz);

    if (!filtro) {
      return {
        dados: [],
        meta: { ...meta, estado, totalDaJanela: null, outros: 0, servicosNaJanela: 0 },
      };
    }

    // O total da janela vem do resumo, e nao da soma do top 10: `outros` e a
    // diferenca entre os dois, e calcula-lo a partir da lista truncada daria
    // sempre zero.
    const [servicos, resumo] = await Promise.all([
      getServicosOvh(filtro, TOPO),
      getResumoOvh(filtro),
    ]);

    const somaDoTopo = servicos.reduce((s, x) => s + x.total, 0);

    return {
      dados: servicos.map((s) => ({
        servico: s.servico,
        categoria: s.categoria,
        total: s.total,
        linhas: s.linhas,
        participacao: participacao(s.total, resumo.total),
      })),
      meta: {
        ...meta,
        estado,
        totalDaJanela: resumo.total,
        // Arredondado no centavo: diferenca de ponto flutuante entre a soma do
        // topo e o total viraria um "Outros" de US$ 0,0000001 na legenda.
        outros: Math.max(0, Math.round((resumo.total - somaDoTopo) * 100) / 100),
        servicosNaJanela: resumo.servicos,
        agrupouEmOutros: resumo.servicos > servicos.length,
      },
    };
  },
);
