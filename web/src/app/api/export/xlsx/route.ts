import { analisar } from "@/lib/api/http";
import { cabecalhosDeArquivo, rotaProtegidaArquivo } from "@/lib/api/rota";
import { prepararExportacao } from "@/lib/export/dados";
import { esquemaExportacao } from "@/lib/export/esquema";
import { gerarXLSX } from "@/lib/export/gerar-xlsx";
import { lerParametros } from "@/lib/filtros/esquemas";

/**
 * GET /api/export/xlsx -- os lancamentos do filtro atual, em planilha.
 *
 * Mesmos parametros e mesmo conteudo do CSV; muda a embalagem. Duas abas:
 * "Lançamentos" (dados puros, prontos para tabela dinamica) e "Contexto"
 * (periodo, contas, cotacao e avisos).
 *
 * Sem streaming aqui, e por um motivo do formato: xlsx e um zip de XML, que so
 * pode ser compactado depois de pronto. A protecao de memoria e o
 * `EXPORT_MAX_ROWS`, conferido antes de qualquer linha ser lida.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIPO_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = rotaProtegidaArquivo("GET /api/export/xlsx", async ({ url, tz }) => {
  const entrada = analisar(esquemaExportacao, lerParametros(url));

  const preparada = await prepararExportacao(entrada, tz);
  const planilha = await gerarXLSX(preparada);

  return new Response(new Uint8Array(planilha), {
    headers: {
      ...cabecalhosDeArquivo(preparada.nome("xlsx"), TIPO_XLSX),
      "content-length": String(planilha.byteLength),
    },
  });
});
