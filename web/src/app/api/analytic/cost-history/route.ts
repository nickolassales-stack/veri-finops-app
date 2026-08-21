import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { lerParametros } from "@/lib/filtros/esquemas";
import {
  getOpcoesDeCadastro,
  getPaginaHistorico,
  getResumoHistorico,
  getSerieMensalPorConta,
} from "@/lib/queries/historico-custos";
import { montarFiltro } from "@/lib/services/filtro-custo";
import { esquemaHistorico, historicoParaFiltro } from "@/lib/services/parametros-historico";
import { converterParaBRL, obterCotacao } from "@/lib/exchange-rate";

/**
 * GET /api/analytic/cost-history -- historico mensal de custo por conta.
 *
 * Devolve os quatro blocos da tela numa unica ida: resumo, serie, tabela
 * paginada e opcoes dos seletores. Quatro requisicoes separadas poderiam
 * resolver periodos diferentes se o filtro mudasse no meio -- e o card diria
 * uma coisa enquanto a tabela dizia outra.
 *
 * A agregacao e SEMPRE por periodo de cobranca. Ver o cabecalho de
 * `lib/queries/historico-custos.ts`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/analytic/cost-history",
  "analytic:view",
  async ({ url, tz }) => {
    const entrada = analisar(esquemaHistorico, lerParametros(url));
    const { filtro, meta } = await montarFiltro(historicoParaFiltro(entrada), tz);

    const filtroHistorico = {
      ...filtro,
      unidade: entrada.unidade,
      centroDeCusto: entrada.centroDeCusto,
      ambiente: entrada.ambiente,
    };

    const [pagina, resumo, serie, opcoes, cotacao] = await Promise.all([
      getPaginaHistorico(filtroHistorico, {
        ordenarPor: entrada.ordenarPor,
        direcao: entrada.direcao,
        pagina: entrada.pagina,
        tamanho: entrada.tamanho,
      }),
      getResumoHistorico(filtroHistorico),
      getSerieMensalPorConta(filtroHistorico),
      getOpcoesDeCadastro(),
      // Nao lanca por contrato: sem cotacao a tela segue em dolar, com a coluna
      // de BRL vazia e o aviso correspondente.
      obterCotacao(),
    ]);

    return {
      // A conversao acontece AQUI, no servidor, com a MESMA cotacao do resumo.
      // Converter no navegador deixaria a tabela e o card usando taxas
      // diferentes se o boletim virasse entre um render e outro.
      dados: pagina.linhas.map((l) => ({
        ...l,
        estimatedBRL: converterParaBRL(l.custoUSD, cotacao),
      })),
      meta: {
        ...meta,
        resumo,
        serie,
        opcoes,
        cotacao,
        somaUSD: pagina.somaUSD,
        somaBRL: converterParaBRL(pagina.somaUSD, cotacao),
        paginacao: {
          pagina: entrada.pagina,
          tamanho: entrada.tamanho,
          total: pagina.total,
          paginas: Math.max(1, Math.ceil(pagina.total / entrada.tamanho)),
        },
        ordenacao: { campo: entrada.ordenarPor, direcao: entrada.direcao },
        filtros: {
          unidade: entrada.unidade ?? null,
          centroDeCusto: entrada.centroDeCusto ?? null,
          ambiente: entrada.ambiente ?? null,
        },
        criterioDeData: "periodo-de-cobranca",
      },
    };
  },
);
