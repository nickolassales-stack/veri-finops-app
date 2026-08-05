/**
 * Navegacao do portal.
 *
 * A lista contem apenas rotas ja implementadas -- nada de link para tela que
 * ainda nao existe. Novas secoes (contas, orcamentos, alertas) entram aqui
 * quando a pagina correspondente for construida sobre o schema real.
 */
export type ItemNav = {
  href: string;
  label: string;
};

export const navPrincipal: ItemNav[] = [
  { href: "/", label: "Visao executiva" },
  { href: "/diagnostico", label: "Diagnostico" },
];
