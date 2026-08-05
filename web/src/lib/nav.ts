import type { Papel } from "@/lib/auth/tipos";

/**
 * Navegacao do portal.
 *
 * A lista contem apenas rotas ja implementadas -- nada de link para tela que
 * ainda nao existe. Novas secoes (contas, orcamentos, alertas) entram aqui
 * quando a pagina correspondente for construida.
 *
 * `papel` restringe a exibicao do item. Esconder o link NAO e a protecao: a
 * autorizacao de verdade esta em `requirePapel()` dentro da rota.
 */
export type ItemNav = {
  href: string;
  label: string;
  papel?: Papel;
};

export const navPrincipal: ItemNav[] = [
  { href: "/dashboard", label: "Visao executiva" },
  { href: "/dashboard/analitico", label: "Analitico" },
  { href: "/diagnostico", label: "Diagnostico", papel: "ADMIN" },
];

export function navVisivelPara(papel: Papel): ItemNav[] {
  return navPrincipal.filter((item) => !item.papel || item.papel === papel);
}
