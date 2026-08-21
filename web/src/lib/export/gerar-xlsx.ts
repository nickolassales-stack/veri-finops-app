import "server-only";

import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/node";

import { COLUNAS_EXPORTACAO, type Celula, type ContextoColuna } from "./colunas";
import { lotesDaExportacao, type ExportacaoPreparada } from "./dados";
import { montarMetadados } from "./metadados";

/**
 * Geracao do XLSX.
 *
 * BIBLIOTECA: `write-excel-file` (MIT). Escolhida sobre `exceljs` por tres
 * motivos objetivos: uma unica dependencia (`fflate`) contra nove; publicacao
 * recente (4.1.1, junho/2026) contra 4.4.0 de dezembro/2024; e escopo de
 * ESCRITA apenas -- nao carregamos parser de xlsx/zip que so serviria para ler
 * arquivo de terceiro, que e justamente a superficie de ataque que nao queremos
 * num servidor que atende dado financeiro.
 *
 * MEMORIA: diferente do CSV, um xlsx e um zip de XML e precisa existir inteiro
 * antes de ser compactado. E este caminho que `EXPORT_MAX_ROWS` protege. A
 * leitura do banco continua em lotes -- o que nao da para adiar e a montagem da
 * planilha.
 *
 * DUAS ABAS: "Lançamentos" com os dados puros (autofiltro e tabela dinamica
 * funcionam direto, sem cabecalho atravessado no meio) e "Contexto" com os
 * metadados. No CSV, que nao tem abas, o mesmo bloco vai no topo comentado.
 */

/** Aparencia sobria, alinhada a identidade: verde escuro sobre off-white. */
const TINTA = "#384E46";
const FUNDO_CABECALHO = "#E7EBE6";

const ABA_DADOS = "Lançamentos";
const ABA_CONTEXTO = "Contexto";

export async function gerarXLSX(preparada: ExportacaoPreparada): Promise<Buffer> {
  const ctx: ContextoColuna = {
    cotacao: preparada.contexto.cotacao,
    tz: preparada.contexto.tz,
  };

  const dados: SheetData = [
    COLUNAS_EXPORTACAO.map((c) => ({
      value: c.titulo,
      fontWeight: "bold" as const,
      backgroundColor: FUNDO_CABECALHO,
      textColor: TINTA,
      align: "left" as const,
      wrap: true,
    })),
  ];

  for await (const lote of lotesDaExportacao(preparada)) {
    for (const linha of lote) {
      dados.push(COLUNAS_EXPORTACAO.map((c) => celulaXLSX(c.ler(linha, ctx))));
    }
  }

  return writeXlsxFile(
    [
      {
        data: dados,
        sheet: ABA_DADOS,
        columns: COLUNAS_EXPORTACAO.map((c) => ({ width: c.largura })),
        // Cabecalho congelado: rolar 5.000 linhas sem saber que coluna se esta
        // lendo e como nao ter cabecalho nenhum.
        stickyRowsCount: 1,
      },
      {
        data: abaContexto(preparada),
        sheet: ABA_CONTEXTO,
        columns: [{ width: 28 }, { width: 110 }],
      },
    ],
    { fontFamily: "Calibri", fontSize: 11 },
  ).toBuffer();
}

/** Uma celula classificada -> celula do xlsx, com o tipo REAL do Excel. */
function celulaXLSX(celula: Celula): Cell {
  // Celula vazia de verdade: `null` e filtravel como ausencia. Escrever "0" ou
  // "-" faria a coluna somar errado e mentir sobre o dado.
  if (celula.valor === null || celula.valor === undefined) return null;

  if (celula.tipo === "numero") {
    return {
      value: celula.valor,
      type: Number,
      // Codigo de formato do Excel: `,` e `.` sao trocados pelos separadores do
      // locale de quem abre, entao em pt-BR isto sai como 1.234,567890.
      format: `#,##0.${"0".repeat(celula.casas)}`,
      align: "right" as const,
    };
  }

  if (celula.tipo === "data") {
    return {
      // Data de CALENDARIO virando serial do Excel. Montada em UTC de proposito:
      // a biblioteca converte por `getTime()`, entao meia-noite local em fuso
      // negativo cairia no dia anterior na planilha.
      value: dataDeCalendario(celula.valor),
      type: Date,
      format: "dd/mm/yyyy",
      align: "left" as const,
    };
  }

  return { value: celula.valor, type: String };
}

function dataDeCalendario(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function abaContexto(preparada: ExportacaoPreparada): SheetData {
  const linhas: SheetData = [
    [
      {
        value: "Contexto desta exportação",
        fontWeight: "bold" as const,
        textColor: TINTA,
        fontSize: 14,
      },
      null,
    ],
    [null, null],
  ];

  for (const { rotulo, valor } of montarMetadados(preparada.contexto)) {
    linhas.push([
      { value: rotulo, fontWeight: "bold" as const, textColor: TINTA, alignVertical: "top" as const },
      // `wrap` porque os avisos sao frases longas: sem quebra, o texto some sob
      // a coluna seguinte e o aviso deixa de ser lido -- que e o oposto do
      // proposito de um aviso.
      { value: valor, wrap: true, alignVertical: "top" as const },
    ]);
  }

  return linhas;
}
