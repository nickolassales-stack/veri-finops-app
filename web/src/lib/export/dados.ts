import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { converterParaBRL, obterCotacao } from "@/lib/exchange-rate";
import { formatInteiro } from "@/lib/format";
import {
  contarLinhasAnaliticas,
  getPaginaAnalitica,
  getTetoDeId,
} from "@/lib/queries/analitico";
import { nomesDasContas } from "@/lib/queries/contas";
import type { FiltroCusto } from "@/lib/queries/filtros-sql";
import { montarFiltro } from "@/lib/services/filtro-custo";
import {
  entradaParaFiltro,
  type EntradaAnalitica,
} from "@/lib/services/parametros-analiticos";

import type { LinhaExportada } from "./colunas";
import { nomeDoArquivo, type ContextoExportacao } from "./metadados";

/**
 * Leitura do banco para exportacao.
 *
 * DUAS GARANTIAS que este modulo existe para dar:
 *
 * 1. O arquivo contem exatamente as linhas da tela. Filtro, ordenacao e periodo
 *    saem do mesmo contrato (`parametros-analiticos`) e da mesma query
 *    (`getPaginaAnalitica`) que o `/api/dashboard/analytic` usa. Nao ha um
 *    "SELECT da exportacao" paralelo que possa divergir.
 *
 * 2. A memoria do processo nao cresce com o tamanho da base. O banco e lido em
 *    LOTES e o teto de linhas e conferido ANTES de comecar; nenhum caminho
 *    carrega o historico inteiro de uma vez.
 */

/**
 * Linhas por ida ao banco.
 *
 * 2.000 e o meio-termo: lote pequeno multiplica viagens de rede, lote grande
 * anula a economia de memoria. Com o teto padrao de 50.000 sao 25 consultas.
 */
export const TAMANHO_DO_LOTE = 2_000;

/** Recusa por volume. Vira HTTP 413, com a mensagem abaixo indo para a tela. */
export class ExportacaoMuitoGrande extends ErroDeApi {
  readonly total: number;
  readonly teto: number;

  constructor(total: number, teto: number) {
    super(
      "exportacao-muito-grande",
      `A consulta selecionou ${formatInteiro(total)} lançamentos e o limite por ` +
        `exportação é ${formatInteiro(teto)}. Estreite o período, escolha menos ` +
        `contas ou filtre por serviço e exporte em partes.`,
    );
    this.name = "ExportacaoMuitoGrande";
    this.total = total;
    this.teto = teto;
  }
}

export type ExportacaoPreparada = {
  filtro: FiltroCusto;
  entrada: EntradaAnalitica;
  /** Foto da tabela: nenhum lote enxerga linha inserida depois deste ponto. */
  tetoId: string | null;
  total: number;
  /** Cabecalho de contexto, pronto para os dois formatos. */
  contexto: ContextoExportacao;
  /** `veri-finops-AAAA-MM-DD_AAAA-MM-DD.<ext>` */
  nome: (extensao: "csv" | "xlsx") => string;
};

/**
 * Resolve o recorte, confere o volume e monta o cabecalho -- sem trazer linha
 * nenhuma.
 *
 * Conferir o teto ANTES de gerar e o ponto principal: descobrir o excesso no
 * meio da escrita so permitiria truncar, e um relatorio financeiro truncado com
 * cara de completo e pior do que um erro claro.
 */
export async function prepararExportacao(
  entrada: EntradaAnalitica,
  tz: string,
): Promise<ExportacaoPreparada> {
  const { filtro, meta } = await montarFiltro(entradaParaFiltro(entrada), tz);
  const tetoId = await getTetoDeId();

  const [total, cotacao, nomes] = await Promise.all([
    contarLinhasAnaliticas(filtro, entrada.serviceSearch, tetoId ?? undefined),
    // Nao lanca por contrato: sem cotacao o arquivo sai igual, com a coluna de
    // BRL vazia e o aviso correspondente no cabecalho.
    obterCotacao(),
    nomesDasContas(entrada.accountIds),
  ]);

  const tetoLinhas = getEnv().EXPORT_MAX_ROWS;
  if (total > tetoLinhas) throw new ExportacaoMuitoGrande(total, tetoLinhas);

  const periodo = meta.periodo as {
    de: string;
    ate: string;
    dias: number;
    limitadoPorDadoDisponivel: boolean;
  };

  return {
    filtro,
    entrada,
    tetoId,
    total,
    contexto: {
      periodo,
      contas: entrada.accountIds.map((id) => ({ id, nome: nomes.get(id) ?? null })),
      busca: entrada.serviceSearch ?? null,
      regiao: entrada.region ?? null,
      ordenacao: { campo: entrada.sortBy, direcao: entrada.sortDirection },
      totalLinhas: total,
      cotacao,
      geradoEm: new Date().toISOString(),
      tz,
    },
    nome: (extensao) => nomeDoArquivo(periodo.de, periodo.ate, extensao),
  };
}

/**
 * Percorre o resultado em lotes, convertendo BRL no servidor.
 *
 * Gerador assincrono de proposito: quem consome escreve o lote e o descarta, e o
 * pico de memoria fica em `TAMANHO_DO_LOTE` linhas -- nao no total exportado.
 */
export async function* lotesDaExportacao(
  preparada: ExportacaoPreparada,
  opcoes: {
    /**
     * O consumidor le os lotes DEPOIS que a resposta comecou a ser transmitida
     * (caso do CSV). O XLSX monta a planilha ainda dentro do manipulador, entao
     * fica no padrao. Ver `queryForaDoEscopo`.
     */
    foraDoEscopoDaRequisicao?: boolean;
  } = {},
): AsyncGenerator<LinhaExportada[]> {
  const { filtro, entrada, tetoId, total, contexto } = preparada;
  if (total === 0) return;

  const paginas = Math.ceil(total / TAMANHO_DO_LOTE);

  for (let pagina = 1; pagina <= paginas; pagina++) {
    const lote = await getPaginaAnalitica(filtro, {
      busca: entrada.serviceSearch,
      ordenarPor: entrada.sortBy,
      direcao: entrada.sortDirection,
      pagina,
      tamanho: TAMANHO_DO_LOTE,
      tetoId: tetoId ?? undefined,
      foraDoEscopoDaRequisicao: opcoes.foraDoEscopoDaRequisicao,
    });

    if (lote.linhas.length === 0) return;

    yield lote.linhas.map((linha) => ({
      ...linha,
      // A conta com dinheiro acontece aqui, no servidor, com a MESMA cotacao do
      // cabecalho. `null` quando nao ha cotacao -- nunca zero.
      estimatedBRL: converterParaBRL(linha.costUSD, contexto.cotacao),
    }));
  }
}
