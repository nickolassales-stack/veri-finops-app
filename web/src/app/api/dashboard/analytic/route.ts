import { z } from "zod";

import { analisar } from "@/lib/api/http";
import { rotaProtegida } from "@/lib/api/rota";
import { converterParaBRL, obterCotacao } from "@/lib/exchange-rate";
import { MAX_TAMANHO_PAGINA, lerParametros } from "@/lib/filtros/esquemas";
import { getPaginaAnalitica, getRegioesDoPeriodo } from "@/lib/queries/analitico";
import { montarFiltro } from "@/lib/services/filtro-custo";
import {
  camposAnaliticos,
  entradaParaFiltro,
  regrasAnaliticas,
} from "@/lib/services/parametros-analiticos";

/**
 * GET /api/dashboard/analytic -- lancamentos de custo, linha a linha.
 *
 * PAGINACAO E SERVER-SIDE, sempre. A resposta traz `pageSize` linhas e o total
 * do filtro contado no banco; o navegador nunca recebe o historico inteiro nem
 * agrega nada.
 *
 * O contrato de filtros (nomes, validacao e traducao para o filtro interno) mora
 * em `lib/services/parametros-analiticos`, compartilhado com `/api/export/*`:
 * exportar tem de devolver exatamente as linhas que a tela mostra.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esquema = z
  .object({
    ...camposAnaliticos,

    page: z.coerce
      .number({ error: "page deve ser um numero inteiro." })
      .int("page deve ser um numero inteiro.")
      .min(1, "page comeca em 1.")
      .max(100_000, "page fora do intervalo permitido.")
      .default(1),

    pageSize: z.coerce
      .number({ error: "pageSize deve ser um numero inteiro." })
      .int("pageSize deve ser um numero inteiro.")
      .min(1, "pageSize minimo e 1.")
      .max(MAX_TAMANHO_PAGINA, `pageSize maximo e ${MAX_TAMANHO_PAGINA}.`)
      .default(50),
  })
  .superRefine(regrasAnaliticas);

export const GET = rotaProtegida("GET /api/dashboard/analytic", async ({ url, tz }) => {
  const entrada = analisar(esquema, lerParametros(url));

  const { filtro, meta } = await montarFiltro(entradaParaFiltro(entrada), tz);

  // Em paralelo: pagina, lista de regioes e cotacao. Nenhuma depende da outra, e
  // `obterCotacao()` nao lanca por contrato -- se o Banco Central estiver fora,
  // a tabela sai igual, so sem a coluna em BRL.
  const [pagina, regioes, cotacao] = await Promise.all([
    getPaginaAnalitica(filtro, {
      busca: entrada.serviceSearch,
      ordenarPor: entrada.sortBy,
      direcao: entrada.sortDirection,
      pagina: entrada.page,
      tamanho: entrada.pageSize,
    }),
    getRegioesDoPeriodo(filtro),
    obterCotacao(),
  ]);

  return {
    dados: pagina.linhas.map((linha) => ({
      ...linha,
      // Conversao POR LINHA feita aqui, no servidor: o navegador nao faz conta
      // com dinheiro. `null` quando nao ha cotacao -- nunca zero.
      estimatedBRL: converterParaBRL(linha.costUSD, cotacao),
    })),
    meta: {
      ...meta,
      paginacao: {
        page: entrada.page,
        pageSize: entrada.pageSize,
        total: pagina.total,
        pages: Math.max(1, Math.ceil(pagina.total / entrada.pageSize)),
      },
      ordenacao: { sortBy: entrada.sortBy, sortDirection: entrada.sortDirection },
      filtros: {
        ...(meta.filtros as Record<string, unknown>),
        serviceSearch: entrada.serviceSearch ?? null,
        region: entrada.region ?? null,
      },
      /** Soma de todas as linhas do filtro, nao apenas desta pagina. */
      somaUSD: pagina.somaUSD,
      somaBRL: converterParaBRL(pagina.somaUSD, cotacao),
      /** Cotacao usada em TODA a coluna de BRL desta resposta. */
      cotacao,
      regioesDisponiveis: regioes,
    },
  };
});
