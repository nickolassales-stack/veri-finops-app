import { analisar } from "@/lib/api/http";
import { cabecalhosDeArquivo, rotaComPermissaoArquivo } from "@/lib/api/rota";
import { gerarCSVHistorico } from "@/lib/export/historico";
import { lerParametros } from "@/lib/filtros/esquemas";
import { montarFiltro } from "@/lib/services/filtro-custo";
import {
  esquemaExportacaoHistorico,
  historicoParaFiltro,
} from "@/lib/services/parametros-historico";
import { prepararExportacaoHistorico } from "@/lib/export/historico";

/**
 * GET /api/analytic/cost-history/export/csv
 *
 * Exige `analytic:export`, e nao apenas `analytic:view`: ver na tela e levar o
 * dado embora sao permissoes diferentes -- um arquivo sai do controle do portal
 * no instante em que e salvo.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissaoArquivo(
  "GET /api/analytic/cost-history/export/csv",
  "analytic:export",
  async ({ url, tz }) => {
    const entrada = analisar(esquemaExportacaoHistorico, lerParametros(url));
    const { filtro, meta } = await montarFiltro(historicoParaFiltro(entrada), tz);
    const periodo = meta.periodo as { de: string; ate: string; dias: number };

    const preparada = await prepararExportacaoHistorico(
      {
        ...filtro,
        unidade: entrada.unidade,
        centroDeCusto: entrada.centroDeCusto,
        ambiente: entrada.ambiente,
      },
      {
        ordenarPor: entrada.ordenarPor,
        direcao: entrada.direcao,
        periodo,
        contas: entrada.contas,
        tz,
      },
    );

    return new Response(gerarCSVHistorico(preparada), {
      headers: cabecalhosDeArquivo(preparada.nome("csv"), "text/csv; charset=utf-8"),
    });
  },
);
