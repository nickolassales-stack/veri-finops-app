import type { Cotacao } from "@/lib/exchange-rate/tipos";
import { formatDataHora } from "@/lib/format";
import type { LinhaAnalitica } from "@/lib/queries/analitico";

/**
 * As colunas do arquivo exportado -- FONTE UNICA para CSV e XLSX.
 *
 * Os dois formatos leem daqui. Se cada gerador tivesse a propria lista, uma
 * coluna acrescentada num deles sumiria do outro sem nenhum sinal, e quem
 * comparasse os dois arquivos encontraria numeros em posicoes diferentes.
 *
 * Modulo PURO: `import type` e apagado na compilacao, entao nada de `server-only`
 * entra aqui e o arquivo pode ser testado direto.
 */

/** Linha do banco ja com a estimativa em BRL calculada no servidor. */
export type LinhaExportada = LinhaAnalitica & {
  /** `null` quando nao ha cotacao. Nunca zero. */
  estimatedBRL: number | null;
};

/**
 * Celula ja classificada por TIPO, nao por aparencia.
 *
 * O CSV precisa saber se pode aplicar a protecao contra formula (so em texto) e
 * o XLSX precisa saber se grava numero ou string. Decidir isso na hora de
 * escrever, olhando o conteudo, seria adivinhacao.
 */
export type Celula =
  | { tipo: "texto"; valor: string | null }
  /** Data de calendario "AAAA-MM-DD" -- sem fuso, sem hora. */
  | { tipo: "data"; valor: string | null }
  | { tipo: "numero"; valor: number | null; casas: number };

/** O que e igual para todas as linhas do arquivo. */
export type ContextoColuna = {
  cotacao: Cotacao;
  /** Fuso de apresentacao (APP_TZ), para a hora do boletim da cotacao. */
  tz: string;
};

export type ColunaExportacao = {
  titulo: string;
  /** Largura em caracteres, usada pelo XLSX. */
  largura: number;
  ler: (linha: LinhaExportada, ctx: ContextoColuna) => Celula;
};

/**
 * `cost_amount` e `numeric(18,6)` no banco (verificado em 11/08/2026) e ha
 * lancamentos de US$ 0,000001. Exportar com 2 casas -- como a tela mostra --
 * zeraria linhas reais. O arquivo carrega a escala da COLUNA, nao a da tela.
 */
const CASAS_MOEDA = 6;

/** Cotacao com 4 casas, como o Banco Central publica. */
const CASAS_COTACAO = 4;

export const COLUNAS_EXPORTACAO: ColunaExportacao[] = [
  {
    titulo: "Data de uso",
    largura: 12,
    ler: (l) => ({ tipo: "data", valor: l.usageDate }),
  },
  {
    titulo: "Conta AWS",
    largura: 16,
    // Texto, e nao numero, de proposito: id de conta AWS tem zeros a esquerda
    // que o Excel comeria se tratasse como numero.
    ler: (l) => ({ tipo: "texto", valor: l.accountId }),
  },
  {
    titulo: "Nome da conta",
    largura: 28,
    ler: (l) => ({ tipo: "texto", valor: l.accountName }),
  },
  {
    titulo: "Serviço AWS",
    largura: 34,
    ler: (l) => ({ tipo: "texto", valor: l.service }),
  },
  {
    titulo: "Região",
    largura: 16,
    // `null` vira vazio, nao "não informada": em planilha, celula vazia e
    // filtravel como ausencia; um texto inventado viraria uma "regiao" a mais na
    // lista do autofiltro.
    ler: (l) => ({ tipo: "texto", valor: l.region }),
  },
  {
    titulo: "Valor USD (oficial)",
    largura: 18,
    ler: (l) => ({ tipo: "numero", valor: l.costUSD, casas: CASAS_MOEDA }),
  },
  {
    titulo: "Valor BRL (estimado)",
    largura: 20,
    ler: (l) => ({ tipo: "numero", valor: l.estimatedBRL, casas: CASAS_MOEDA }),
  },
  {
    titulo: "Cotação utilizada",
    largura: 18,
    // Repetida em toda linha, ao contrario da tela (onde vive no rodape): numa
    // planilha a linha precisa se sustentar sozinha depois de filtrada,
    // ordenada ou colada em outro lugar.
    ler: (_l, { cotacao }) => ({
      tipo: "numero",
      valor: cotacao.valor,
      casas: CASAS_COTACAO,
    }),
  },
  {
    titulo: "Data/hora da cotação",
    largura: 22,
    ler: (_l, ctx) => ({ tipo: "texto", valor: referenciaDaCotacao(ctx) }),
  },
];

/**
 * Instante do boletim, legivel.
 *
 * `dataHoraReferencia` so existe no PTAX (que publica a hora do boletim). No
 * SGS ha apenas o dia -- e nao inventamos hora que a fonte nao deu, entao cai
 * para a data pura.
 */
export function referenciaDaCotacao({ cotacao, tz }: ContextoColuna): string | null {
  if (cotacao.dataHoraReferencia) return formatDataHora(cotacao.dataHoraReferencia, tz);
  if (!cotacao.dataReferencia) return null;

  // Data de calendario e formatada como TEXTO: passar por `Date` traria o
  // problema de fuso de volta (meia-noite UTC vira o dia anterior no Brasil).
  const [ano, mes, dia] = cotacao.dataReferencia.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
