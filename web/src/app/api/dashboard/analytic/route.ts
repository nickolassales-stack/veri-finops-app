import { z } from "zod";

import { analisar } from "@/lib/api/http";
import { rotaProtegida } from "@/lib/api/rota";
import { converterParaBRL, obterCotacao } from "@/lib/exchange-rate";
import {
  MAX_TAMANHO_PAGINA,
  REGIAO_NAO_INFORMADA,
  camposContas,
  camposOrdenacao,
  lerParametros,
} from "@/lib/filtros/esquemas";
import { ehDataISOValida, contarDias, MAX_DIAS_PERIODO } from "@/lib/filtros/periodo";
import {
  CAMPOS_ORDENACAO_ANALITICA,
  getPaginaAnalitica,
  getRegioesDoPeriodo,
} from "@/lib/queries/analitico";
import { montarFiltro } from "@/lib/services/filtro-custo";

/**
 * GET /api/dashboard/analytic -- lancamentos de custo, linha a linha.
 *
 * PAGINACAO E SERVER-SIDE, sempre. A resposta traz `pageSize` linhas e o total
 * do filtro contado no banco; o navegador nunca recebe o historico inteiro nem
 * agrega nada.
 *
 * NOMES DOS PARAMETROS: este endpoint usa `startDate`, `accountIds`, `page`...
 * enquanto os outros usam `de`, `contas`, `pagina`. A diferenca e deliberada --
 * foi o contrato pedido para esta rota. A traducao para o filtro interno
 * acontece aqui, e a resolucao de periodo continua sendo a MESMA de todas as
 * telas (`montarFiltro`), para que analitico e painel nunca mostrem janelas
 * diferentes com o mesmo filtro.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dataISO = z
  .string()
  .trim()
  .refine(ehDataISOValida, "Use uma data real no formato AAAA-MM-DD.");

const esquema = z
  .object({
    startDate: dataISO.optional(),
    endDate: dataISO.optional(),

    // Reaproveita a validacao de contas (lista, "todas", teto de 50, formato do
    // id) apenas trocando o nome do parametro.
    accountIds: camposContas.contas,

    serviceSearch: z
      .string()
      .trim()
      .max(100, "Busca por servico muito longa (maximo 100 caracteres).")
      .transform((v) => (v === "" ? undefined : v))
      .optional(),

    region: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || v === REGIAO_NAO_INFORMADA || /^[A-Za-z0-9-]{1,32}$/.test(v),
        "Regiao invalida.",
      )
      .transform((v) => (v === "" ? undefined : v))
      .optional(),

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

    ...renomearOrdenacao(),
  })
  .superRefine((valor, ctx) => {
    const { startDate, endDate } = valor;

    // Uma data sozinha nao define janela: seria adivinhar a outra ponta.
    if (Boolean(startDate) !== Boolean(endDate)) {
      ctx.addIssue({
        code: "custom",
        path: [startDate ? "endDate" : "startDate"],
        message: "Informe startDate e endDate juntos, ou nenhum dos dois.",
      });
      return;
    }

    if (startDate && endDate) {
      if (startDate > endDate) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `endDate (${endDate}) nao pode ser anterior a startDate (${startDate}).`,
        });
        return;
      }
      const dias = contarDias(startDate, endDate);
      if (dias > MAX_DIAS_PERIODO) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: `Periodo de ${dias} dias excede o maximo de ${MAX_DIAS_PERIODO}.`,
        });
      }
    }
  });

/** `camposOrdenacao` gera `ordenarPor`/`direcao`; aqui viram sortBy/sortDirection. */
function renomearOrdenacao() {
  const { ordenarPor, direcao } = camposOrdenacao(
    CAMPOS_ORDENACAO_ANALITICA,
    "usageDate",
  );
  return { sortBy: ordenarPor, sortDirection: direcao };
}

export const GET = rotaProtegida("GET /api/dashboard/analytic", async ({ url, tz }) => {
  const entrada = analisar(esquema, lerParametros(url));

  const { filtro, meta } = await montarFiltro(
    {
      // Sem datas explicitas, cai no periodo padrao -- o mesmo do painel.
      periodo: entrada.startDate ? "personalizado" : undefined,
      de: entrada.startDate,
      ate: entrada.endDate,
      contas: entrada.accountIds,
      regiao: entrada.region,
    },
    tz,
  );

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
