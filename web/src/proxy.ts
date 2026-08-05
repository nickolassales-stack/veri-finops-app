import { NextResponse, type NextRequest } from "next/server";

import { NOME_COOKIE } from "@/lib/auth/cookie-name";

/**
 * Checagem OTIMISTA de autenticacao.
 *
 * Aqui so verificamos a PRESENCA do cookie -- nada de banco. O proxy roda em
 * toda rota, inclusive em prefetch de navegacao, e a documentacao do Next e
 * explicita: nao use proxy como solucao de sessao ou autorizacao.
 *
 * A verificacao real (token existe, nao expirou, usuario ativo, papel) acontece
 * em `requireSessao()` dentro do layout de `(privado)`. Ou seja: cookie
 * falsificado passa por aqui e e barrado la.
 *
 * O papel deste arquivo e so de experiencia de uso: quem nao tem cookie vai
 * direto para /login sem custo de render.
 */
/** Header com o caminho pedido, para o layout privado poder montar `?next=`. */
export const HEADER_CAMINHO = "x-caminho-atual";

export function proxy(request: NextRequest) {
  const temCookie = Boolean(request.cookies.get(NOME_COOKIE)?.value);

  if (temCookie) {
    // Repassa o caminho adiante: layouts nao recebem pathname, e sem isso o
    // redirecionamento por sessao expirada perderia o destino original.
    const cabecalhos = new Headers(request.headers);
    cabecalhos.set(HEADER_CAMINHO, request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers: cabecalhos } });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  const destino = request.nextUrl.pathname + request.nextUrl.search;
  if (destino && destino !== "/") {
    url.searchParams.set("next", destino);
  }

  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Roda em tudo, exceto:
   * - `login`            -> a propria tela de entrada
   * - `api/health`       -> consumido pelo HEALTHCHECK do container, sem sessao
   * - assets do Next, favicon, icon.png e a pasta `brand` (logos)
   */
  matcher: [
    "/((?!login|api/health|_next/static|_next/image|brand|icon.png|favicon.ico).*)",
  ],
};
