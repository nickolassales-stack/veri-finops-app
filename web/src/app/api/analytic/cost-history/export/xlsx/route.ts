import { analisar } from "@/lib/api/http";
import { cabecalhosDeArquivo, rotaComPermissaoArquivo } from "@/lib/api/rota";
import {
  gerarXLSXHistorico,
  prepararExportacaoHistorico,
} from "@/lib/export/historico";
import { lerParametros } from "@/lib/filtros/esquemas";
import { montarFiltro } from "@/lib/services/filtro-custo";
import {
  esquemaExportacaoHistorico,
  historicoParaFiltro,
} from "@/lib/services/parametros-historico";

/**
 * GET /api/analytic/cost-history/export/xlsx
 *
 * Mesmo pedido do CSV, mesma resposta, embalagem diferente. Duas abas:
 * "Histórico" com os dados puros -- para autofiltro e tabela dinâmica
 * funcionarem sem cabeçalho atravessado no meio -- e "Contexto" com o recorte
 * que gerou o arquivo.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissaoArquivo(
  "GET /api/analytic/cost-history/export/xlsx",
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

    const corpo = await gerarXLSXHistorico(preparada);

    return new Response(new Uint8Array(corpo), {
      headers: cabecalhosDeArquivo(
        preparada.nome("xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    });
  },
);
