/**
 * Validacao do parametro `next` usado no redirecionamento pos-login.
 *
 * Modulo sem dependencia de propósito: e uma funcao de seguranca, precisa ser
 * testavel sem carregar `server-only`, `next/navigation` nem o driver do banco.
 */

/**
 * Aceita apenas caminho interno.
 *
 * Bloqueia redirecionamento aberto: `//evil.com` e `https://evil.com` seriam
 * tratados pelo navegador como destino externo, e `/\evil.com` e interpretado
 * como `//evil.com` por alguns navegadores.
 */
export function destinoInternoValido(destino: string): boolean {
  if (typeof destino !== "string" || destino.length === 0) return false;
  if (!destino.startsWith("/")) return false;
  if (destino.startsWith("//")) return false;
  if (destino.startsWith("/\\")) return false;
  // Controle e nova linha abrem espaco para injecao de header no Location.
  if (/[\u0000-\u001F\u007F]/.test(destino)) return false;
  return true;
}

export function montarUrlLogin(caminhoAtual?: string): string {
  if (!caminhoAtual || !destinoInternoValido(caminhoAtual)) return "/login";
  return `/login?next=${encodeURIComponent(caminhoAtual)}`;
}
