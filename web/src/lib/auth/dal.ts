import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { montarUrlLogin } from "./destino";
import { lerSessao, type Sessao } from "./session";
import type { Papel } from "./tipos";

/**
 * Camada de acesso a sessao.
 *
 * A verificacao que vale e esta -- feita contra o banco, dentro do render de
 * cada rota protegida. O `proxy.ts` faz apenas checagem otimista de presenca de
 * cookie, conforme a propria recomendacao do Next: proxy roda em toda rota,
 * inclusive em prefetch, e nao deve consultar banco.
 *
 * `cache` do React memoiza por requisicao: o layout e a pagina podem chamar
 * `getSessao()` sem gerar duas consultas.
 */
export const getSessao = cache(lerSessao);

/** Redireciona para /login quando nao ha sessao valida. */
export async function requireSessao(caminhoAtual?: string): Promise<Sessao> {
  const sessao = await getSessao();
  if (!sessao) {
    redirect(montarUrlLogin(caminhoAtual));
  }
  return sessao;
}

/** Exige um papel especifico. Sem sessao vai para /login; com papel errado, 403. */
export async function requirePapel(
  papel: Papel,
  caminhoAtual?: string,
): Promise<Sessao> {
  const sessao = await requireSessao(caminhoAtual);
  if (sessao.papel !== papel) {
    redirect("/sem-permissao");
  }
  return sessao;
}
