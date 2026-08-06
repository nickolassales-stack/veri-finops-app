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
