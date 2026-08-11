import "server-only";

import { getSessao } from "@/lib/auth/dal";
import type { Sessao } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

import { respostaErro, respostaOk, traduzirFalha } from "./http";

/**
 * Envelope comum das rotas de dados.
 *
 * Concentra as tres coisas que TODA rota protegida precisa fazer igual:
 *
 * 1. Exigir sessao valida ANTES de qualquer outra coisa. A checagem e feita
 *    contra o banco (`getSessao` -> `app_sessions`), nao contra o cookie: o
 *    `proxy.ts` so faz uma triagem otimista e cookie forjado passa por la.
 *    Sem sessao a rota devolve 401 e nao chega a ler os parametros -- quem nao
 *    esta autenticado nem consegue sondar o comportamento da validacao.
 * 2. Padronizar sucesso (`{ dados, meta }`) e falha (`{ erro }`).
 * 3. Nunca deixar excecao escapar como stack trace para o cliente.
 */

export type ContextoRota = {
  url: URL;
  sessao: Sessao;
  /** Fuso de apresentacao (APP_TZ). Base de tudo que envolve "hoje". */
  tz: string;
};

export type ResultadoRota = {
  dados: unknown;
  /** Campos extras de `meta` (periodo aplicado, filtros, paginacao...). */
  meta?: Record<string, unknown>;
};

export function rotaProtegida(
  nome: string,
  manipulador: (ctx: ContextoRota) => Promise<ResultadoRota>,
) {
  return async function handler(request: Request): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      const tz = getEnv().APP_TZ;
      const { dados, meta } = await manipulador({
        url: new URL(request.url),
        sessao,
        tz,
      });

      // `meta` do manipulador vem primeiro: os campos fixos abaixo nao podem
      // ser sobrescritos por engano por uma rota.
      return respostaOk(dados, {
        ...meta,
        moeda: "USD",
        timezone: tz,
        geradoEm: new Date().toISOString(),
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Variante para rotas que devolvem ARQUIVO, nao o envelope `{ dados, meta }`.
 *
 * Mesma porta de entrada: sessao verificada contra o banco antes de qualquer
 * outra coisa, mesma taxonomia de erro. So o sucesso muda de forma -- o
 * manipulador monta a propria `Response` com o corpo e os cabecalhos do
 * download.
 *
 * O FRACASSO continua saindo em JSON de proposito: quem baixa e a tela, por
 * `fetch`, e ela precisa da mesma estrutura de erro que ja sabe interpretar.
 */
export function rotaProtegidaArquivo(
  nome: string,
  manipulador: (ctx: ContextoRota) => Promise<Response>,
) {
  return async function handler(request: Request): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      return await manipulador({
        url: new URL(request.url),
        sessao,
        tz: getEnv().APP_TZ,
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Cabecalhos de download.
 *
 * `filename*` (RFC 5987) alem de `filename`: o nome carrega so ASCII hoje, mas
 * um acento futuro sem essa forma chegaria corrompido no navegador.
 */
export function cabecalhosDeArquivo(nome: string, tipo: string): HeadersInit {
  return {
    "content-type": tipo,
    "content-disposition":
      `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    // Dado financeiro por sessao: nunca em cache de navegador ou intermediario.
    "cache-control": "no-store, private",
    // O corpo e um arquivo; nao deve ser interpretado como nada mais.
    "x-content-type-options": "nosniff",
  };
}
