import { headers } from "next/headers";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { requireSessao } from "@/lib/auth/dal";
import { HEADER_CAMINHO } from "@/proxy";

/**
 * Fronteira de autenticacao da aplicacao.
 *
 * Toda rota sob `(privado)` passa por aqui, e aqui a sessao e validada CONTRA O
 * BANCO -- token existe, nao expirou, usuario ativo. O `proxy.ts` so olha se o
 * cookie existe; cookie inventado chega ate este ponto e e recusado.
 */
export default async function LayoutPrivado({ children }: LayoutProps<"/">) {
  const caminho = (await headers()).get(HEADER_CAMINHO) ?? undefined;
  const sessao = await requireSessao(caminho);

  return (
    <>
      <SiteHeader sessao={sessao} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">{children}</main>
      <SiteFooter />
    </>
  );
}
