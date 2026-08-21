import { analisar } from "@/lib/api/http";
import { cabecalhosDeArquivo, rotaProtegidaArquivo } from "@/lib/api/rota";
import { prepararExportacao } from "@/lib/export/dados";
import { esquemaExportacao } from "@/lib/export/esquema";
import { fluxoCSV } from "@/lib/export/gerar-csv";
import { lerParametros } from "@/lib/filtros/esquemas";

/**
 * GET /api/export/csv -- os lancamentos do filtro atual, em CSV.
 *
 * Aceita EXATAMENTE os mesmos parametros de `/api/dashboard/analytic`, menos a
 * paginacao: exportar e "a tela inteira", nao "a pagina que esta na tela".
 *
 * O corpo e transmitido em fluxo, conforme o banco e lido em lotes -- nenhum
 * ponto do caminho tem o arquivo inteiro na memoria.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaProtegidaArquivo("GET /api/export/csv", async ({ url, tz }) => {
  const entrada = analisar(esquemaExportacao, lerParametros(url));

  // Resolve periodo, confere o teto de linhas e monta o cabecalho ANTES de
  // abrir o fluxo: uma recusa precisa sair como JSON de erro, e depois do
  // primeiro byte do arquivo isso ja nao seria possivel.
  const preparada = await prepararExportacao(entrada, tz);

  return new Response(fluxoCSV(preparada), {
    headers: cabecalhosDeArquivo(preparada.nome("csv"), "text/csv; charset=utf-8"),
  });
});
