import { redirect } from "next/navigation";

/**
 * A raiz nao tem conteudo proprio: manda para o painel.
 *
 * Quem nao tem sessao e interceptado antes disto pelo `proxy.ts` e cai em
 * /login; quem tem, chega em /dashboard, onde a sessao e validada de verdade.
 */
export default function Raiz() {
  redirect("/dashboard");
}
