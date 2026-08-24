import "server-only";

import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/node";

import { obterCotacao, converterParaBRL, AVISO_ESTIMATIVA } from "@/lib/exchange-rate";
import type { Cotacao } from "@/lib/exchange-rate/tipos";
import { formatDataHora } from "@/lib/format";
import { nomesDasContas } from "@/lib/queries/contas";
import {
  getPaginaHistorico,
  type FiltroHistorico,
  type LinhaHistorico,
  type OrdenacaoHistorico,
} from "@/lib/queries/historico-custos";
import type { Direcao } from "@/lib/filtros/esquemas";

import {
  BOM,
  celulaCSV,
  citarCSV,
  linhaCSV,
  linhaMetadadoCSV,
  protegerFormula,
} from "./csv";
import type { Celula } from "./colunas";

/**
 * Exportacao do historico mensal.
 *
 * NAO reaproveita `dados.ts`/`colunas.ts`: aquele modulo e tipado sobre
 * `LinhaAnalitica` (um lancamento por dia, por servico) e transmite em fluxo
 * porque o volume justifica -- sao dezenas de milhares de linhas. Aqui uma
 * linha e um par (mes, conta): a serie inteira de um ano com dez contas da 120
 * linhas. Montar em memoria e mais simples e mais honesto do que espremer este
 * caso na maquinaria de streaming do outro.
 *
 * O que E reaproveitado e o que importa: o escape de CSV e a protecao contra
 * formula, de `csv.ts`. Reescrever isso criaria uma segunda chance de esquecer
 * o apostrofo antes de um `=` vindo do banco.
 */

const CASAS_MOEDA = 6;
const CASAS_PERCENTUAL = 4;

export type ColunaHistorico = {
  titulo: string;
  largura: number;
  ler: (linha: LinhaExportadaHistorico) => Celula;
};

export type LinhaExportadaHistorico = LinhaHistorico & {
  estimatedBRL: number | null;
};

/**
 * FONTE UNICA das colunas para CSV e XLSX.
 *
 * Se cada gerador tivesse a propria lista, uma coluna acrescentada num deles
 * sumiria do outro sem sinal nenhum, e quem comparasse os dois arquivos
 * encontraria numeros em posicoes diferentes.
 */
export const COLUNAS_HISTORICO: ColunaHistorico[] = [
  {
    titulo: "Mês de cobrança",
    largura: 16,
    // TEXTO e nao data: "2026-07" e um mes, nao um dia. Como data, o Excel
    // inventaria o dia 1 e a planilha passaria a afirmar algo que o dado nao diz.
    ler: (l) => ({ tipo: "texto", valor: l.mes }),
  },
  { titulo: "ID da conta", largura: 16, ler: (l) => ({ tipo: "texto", valor: l.accountId }) },
  { titulo: "Conta", largura: 28, ler: (l) => ({ tipo: "texto", valor: l.nomeExibicao }) },
  {
    titulo: "Alias",
    largura: 22,
    // Vazio quando nao ha alias -- e diferente de repetir o nome do cadastro,
    // que faria parecer que alguem definiu um alias igual ao nome.
    ler: (l) => ({ tipo: "texto", valor: l.alias }),
  },
  { titulo: "Unidade de negócio", largura: 20, ler: (l) => ({ tipo: "texto", valor: l.unidade }) },
  { titulo: "Centro de custo", largura: 18, ler: (l) => ({ tipo: "texto", valor: l.centroDeCusto }) },
  { titulo: "Ambiente", largura: 14, ler: (l) => ({ tipo: "texto", valor: l.ambiente }) },
  {
    titulo: "Custo (USD)",
    largura: 16,
    ler: (l) => ({ tipo: "numero", valor: l.custoUSD, casas: CASAS_MOEDA }),
  },
  {
    titulo: "Estimativa (BRL)",
    largura: 18,
    // `null` quando nao ha cotacao. NUNCA zero: zero seria um valor contabil.
    ler: (l) => ({ tipo: "numero", valor: l.estimatedBRL, casas: 2 }),
  },
  {
    titulo: "Mês anterior (USD)",
    largura: 18,
    ler: (l) => ({ tipo: "numero", valor: l.custoAnterior, casas: CASAS_MOEDA }),
  },
  {
    titulo: "Variação absoluta (USD)",
    largura: 22,
    ler: (l) => ({ tipo: "numero", valor: l.variacaoAbsoluta, casas: CASAS_MOEDA }),
  },
  {
    titulo: "Variação percentual",
    largura: 20,
    // Fracao, nao "12,3%": assim a celula e um numero de verdade e a planilha
    // pode formatar como porcentagem sem ninguem ter de desfazer texto.
    ler: (l) => ({ tipo: "numero", valor: l.variacaoPercentual, casas: CASAS_PERCENTUAL }),
  },
  {
    titulo: "Participação no total",
    largura: 20,
    ler: (l) => ({ tipo: "numero", valor: l.participacao, casas: CASAS_PERCENTUAL }),
  },
];

// ------------------------------------------------------------------ preparo

export type ExportacaoHistorico = {
  linhas: LinhaExportadaHistorico[];
  cotacao: Cotacao;
  contexto: {
    periodo: { de: string; ate: string; dias: number };
    contas: { id: string; nome: string | null }[];
    unidade: string | null;
    centroDeCusto: string | null;
    ambiente: string | null;
    ordenacao: { campo: string; direcao: string };
    totalLinhas: number;
    geradoEm: string;
    tz: string;
  };
  nome: (extensao: "csv" | "xlsx") => string;
};

/** Teto generoso: uma linha por (mes, conta) nao chega perto disso. */
const TETO_LINHAS = 50_000;

export async function prepararExportacaoHistorico(
  filtro: FiltroHistorico,
  opcoes: {
    ordenarPor: OrdenacaoHistorico;
    direcao: Direcao;
    periodo: { de: string; ate: string; dias: number };
    contas: string[];
    tz: string;
  },
): Promise<ExportacaoHistorico> {
  const [pagina, cotacao, nomes] = await Promise.all([
    getPaginaHistorico(filtro, {
      ordenarPor: opcoes.ordenarPor,
      direcao: opcoes.direcao,
      pagina: 1,
      tamanho: TETO_LINHAS,
    }),
    obterCotacao(),
    nomesDasContas(opcoes.contas),
  ]);

  return {
    linhas: pagina.linhas.map((l) => ({
      ...l,
      estimatedBRL: converterParaBRL(l.custoUSD, cotacao),
    })),
    cotacao,
    contexto: {
      periodo: opcoes.periodo,
      contas: opcoes.contas.map((id) => ({ id, nome: nomes.get(id) ?? null })),
      unidade: filtro.unidade ?? null,
      centroDeCusto: filtro.centroDeCusto ?? null,
      ambiente: filtro.ambiente ?? null,
      ordenacao: { campo: opcoes.ordenarPor, direcao: opcoes.direcao },
      totalLinhas: pagina.total,
      geradoEm: new Date().toISOString(),
      tz: opcoes.tz,
    },
    nome: (extensao) =>
      `veri-finops-aws-historico-${opcoes.periodo.de}_${opcoes.periodo.ate}.${extensao}`,
  };
}

// ---------------------------------------------------------------------- CSV

/**
 * Bloco de contexto no topo do arquivo.
 *
 * Um arquivo financeiro sem o recorte que o gerou e uma tabela de numeros sem
 * significado: quem o receber por e-mail, tres semanas depois, nao tem como
 * saber qual periodo, quais contas e qual criterio de data ele representa.
 */
function metadadosCSV(e: ExportacaoHistorico): string {
  const c = e.contexto;
  const linhas = [
    linhaMetadadoCSV("Relatorio", "Historico mensal de custos por conta"),
    linhaMetadadoCSV("Criterio de data", "Periodo de cobranca (billing_month), como no AWS Cost Explorer"),
    linhaMetadadoCSV("Periodo", `${c.periodo.de} a ${c.periodo.ate} (${c.periodo.dias} dia(s))`),
    linhaMetadadoCSV(
      "Contas",
      c.contas.length === 0
        ? "todas"
        : c.contas.map((x) => `${x.nome ?? "sem cadastro"} (${x.id})`).join(" | "),
    ),
    linhaMetadadoCSV("Unidade de negocio", c.unidade ?? "todas"),
    linhaMetadadoCSV("Centro de custo", c.centroDeCusto ?? "todos"),
    linhaMetadadoCSV("Ambiente", c.ambiente ?? "todos"),
    linhaMetadadoCSV("Ordenacao", `${c.ordenacao.campo} ${c.ordenacao.direcao}`),
    linhaMetadadoCSV("Linhas", String(c.totalLinhas)),
    linhaMetadadoCSV("Moeda oficial", "USD, conforme a origem do CUR"),
    linhaMetadadoCSV(
      "Cotacao USD/BRL",
      e.cotacao.status !== "unavailable"
        ? `${e.cotacao.valor} (${e.cotacao.fonte}) -- ${AVISO_ESTIMATIVA}`
        : `indisponivel -- a coluna de BRL sai vazia`,
    ),
    linhaMetadadoCSV("Gerado em", formatDataHora(c.geradoEm, c.tz)),
    "\r\n",
  ];
  return linhas.join("");
}

export function gerarCSVHistorico(e: ExportacaoHistorico): string {
  const cabecalho = linhaCSV(
    COLUNAS_HISTORICO.map((c) => citarCSV(protegerFormula(c.titulo))),
  );

  const corpo = e.linhas
    .map((linha) => linhaCSV(COLUNAS_HISTORICO.map((c) => celulaCSV(c.ler(linha)))))
    .join("");

  // BOM na frente: sem ele o Excel no Windows abre UTF-8 como Latin-1 e
  // "Variação" vira "VariaÃ§Ã£o".
  return BOM + metadadosCSV(e) + cabecalho + corpo;
}

// --------------------------------------------------------------------- XLSX

/** Mesma aparencia sobria do outro gerador. */
const TINTA = "#384E46";
const FUNDO_CABECALHO = "#E7EBE6";

function celulaXLSX(celula: Celula): Cell {
  if (celula.valor === null || celula.valor === undefined) {
    // Celula VAZIA, nao zero nem "-": zero seria um valor contabil e "-" viraria
    // texto no meio de uma coluna numerica, quebrando soma e grafico.
    // `undefined` e nao `null` porque e assim que a biblioteca representa vazio.
    return { value: undefined, type: String };
  }
  if (celula.tipo === "numero") {
    return {
      value: celula.valor,
      type: Number,
      format: `0.${"0".repeat(celula.casas)}`,
    };
  }
  return { value: String(celula.valor), type: String };
}

export async function gerarXLSXHistorico(e: ExportacaoHistorico): Promise<Buffer> {
  const abaDados: SheetData = [
    COLUNAS_HISTORICO.map<Cell>((c) => ({
      value: c.titulo,
      type: String,
      fontWeight: "bold",
      color: TINTA,
      backgroundColor: FUNDO_CABECALHO,
      wrap: true,
    })),
    ...e.linhas.map((linha) => COLUNAS_HISTORICO.map((c) => celulaXLSX(c.ler(linha)))),
  ];

  const c = e.contexto;
  const contexto: [string, string][] = [
    ["Relatório", "Histórico mensal de custos por conta"],
    ["Critério de data", "Período de cobrança (billing_month), como no AWS Cost Explorer"],
    ["Período", `${c.periodo.de} a ${c.periodo.ate} (${c.periodo.dias} dia(s))`],
    [
      "Contas",
      c.contas.length === 0
        ? "todas"
        : c.contas.map((x) => `${x.nome ?? "sem cadastro"} (${x.id})`).join(" | "),
    ],
    ["Unidade de negócio", c.unidade ?? "todas"],
    ["Centro de custo", c.centroDeCusto ?? "todos"],
    ["Ambiente", c.ambiente ?? "todos"],
    ["Ordenação", `${c.ordenacao.campo} ${c.ordenacao.direcao}`],
    ["Linhas", String(c.totalLinhas)],
    ["Moeda oficial", "USD, conforme a origem do CUR"],
    [
      "Cotação USD/BRL",
      e.cotacao.status !== "unavailable"
        ? `${e.cotacao.valor} (${e.cotacao.fonte}) — ${AVISO_ESTIMATIVA}`
        : "indisponível — a coluna de BRL sai vazia",
    ],
    ["Gerado em", formatDataHora(c.geradoEm, c.tz)],
  ];

  const abaContexto: SheetData = contexto.map(([rotulo, valor]) => [
    { value: rotulo, type: String, fontWeight: "bold", color: TINTA },
    { value: valor, type: String },
  ]);

  return writeXlsxFile(
    [
      {
        data: abaDados,
        sheet: "Histórico",
        columns: COLUNAS_HISTORICO.map((col) => ({ width: col.largura })),
        // Cabecalho congelado: rolar a serie sem saber que coluna se esta lendo
        // e como nao ter cabecalho nenhum.
        stickyRowsCount: 1,
      },
      {
        data: abaContexto,
        sheet: "Contexto",
        columns: [{ width: 24 }, { width: 90 }],
      },
    ],
    { fontFamily: "Calibri", fontSize: 11 },
  ).toBuffer();
}
