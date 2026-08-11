import "server-only";

import { COLUNAS_EXPORTACAO, type ContextoColuna } from "./colunas";
import {
  BOM,
  celulaCSV,
  citarCSV,
  linhaCSV,
  linhaMetadadoCSV,
} from "./csv";
import { lotesDaExportacao, type ExportacaoPreparada } from "./dados";
import { montarMetadados } from "./metadados";

/**
 * Monta o CSV como FLUXO, nao como string.
 *
 * O corpo sai do servidor conforme e lido do banco: um lote e escrito, entregue
 * e descartado antes do proximo chegar. O pico de memoria fica no tamanho do
 * lote, e nao no do arquivo -- por isso o teto de linhas existe para proteger o
 * XLSX (que precisa montar a planilha inteira), nao este caminho.
 *
 * O `pull` do ReadableStream so busca o proximo lote quando o consumidor
 * consegue receber. Se a rede do usuario for lenta, as consultas ao banco
 * desaceleram junto, em vez de acumular resultado na memoria do container.
 */
export function fluxoCSV(preparada: ExportacaoPreparada): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  // Os lotes serao lidos a cada `pull`, ou seja, com a resposta ja em transito.
  const lotes = lotesDaExportacao(preparada, { foraDoEscopoDaRequisicao: true });
  const ctx: ContextoColuna = {
    cotacao: preparada.contexto.cotacao,
    tz: preparada.contexto.tz,
  };

  let cabecalhoEnviado = false;

  return new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        if (!cabecalhoEnviado) {
          cabecalhoEnviado = true;
          controlador.enqueue(codificador.encode(cabecalhoCSV(preparada)));
          return;
        }

        const { value, done } = await lotes.next();
        if (done) {
          controlador.close();
          return;
        }

        let bloco = "";
        for (const linha of value) {
          bloco += linhaCSV(COLUNAS_EXPORTACAO.map((c) => celulaCSV(c.ler(linha, ctx))));
        }
        controlador.enqueue(codificador.encode(bloco));
      } catch (err) {
        /*
         * Falha DEPOIS do primeiro byte nao tem como virar resposta de erro: o
         * status 200 e os cabecalhos ja foram enviados. O cliente so ve a
         * conexao cair no meio.
         *
         * Registrar aqui e a unica forma de essa falha deixar rastro. Sem este
         * log, um download truncado em producao seria indistinguivel de um
         * problema de rede -- e ninguem saberia onde procurar.
         */
        console.error("[api] GET /api/export/csv falhou durante o streaming", {
          mensagem: err instanceof Error ? err.message : String(err),
          codigo: (err as { code?: string })?.code,
        });
        controlador.error(err);
      }
    },

    // Usuario cancelou o download: encerra o gerador para nao deixar consulta
    // rodando contra o banco por um arquivo que ninguem vai receber.
    cancel() {
      void lotes.return(undefined);
    },
  });
}

/** BOM + bloco de contexto + linha em branco + titulos das colunas. */
function cabecalhoCSV(preparada: ExportacaoPreparada): string {
  const metadados = montarMetadados(preparada.contexto)
    .map((m) => linhaMetadadoCSV(m.rotulo, m.valor))
    .join("");

  const titulos = linhaCSV(COLUNAS_EXPORTACAO.map((c) => citarCSV(c.titulo)));

  // A linha em branco separa o contexto da tabela: no Excel e o que faz o
  // "formatar como tabela" e o autofiltro pegarem so os dados.
  return `${BOM}${metadados}${linhaCSV([])}${titulos}`;
}
