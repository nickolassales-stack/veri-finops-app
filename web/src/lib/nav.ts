import type { Permissao } from "@/lib/auth/permissoes";

/**
 * Navegacao do portal.
 *
 * A lista contem apenas rotas ja implementadas -- nada de link para tela que
 * ainda nao existe.
 *
 * `permissao` restringe a EXIBICAO do item. Esconder o link NAO e a protecao: a
 * autorizacao de verdade esta em `requirePermissao()` dentro de cada pagina e em
 * `rotaComPermissao()` em cada rota de API. Digitar a URL na barra do navegador
 * para no mesmo lugar que clicar num link inexistente.
 *
 * A restricao mudou de PAPEL para PERMISSAO nesta entrega: com grupos, "quem ve
 * o menu de configuracoes" deixou de ser sinonimo de "quem e ADMIN" -- um
 * VIEWER de um grupo com `settings:view` tambem ve.
 */
export type ItemNav = {
  href: string;
  label: string;
  permissao?: Permissao;
};

export const navPrincipal: ItemNav[] = [
  { href: "/dashboard", label: "Visao executiva" },
  { href: "/dashboard/analitico", label: "Analitico" },
  { href: "/dashboard/configuracoes", label: "Configuracoes", permissao: "settings:view" },
  { href: "/diagnostico", label: "Diagnostico", permissao: "diagnostics:view" },
];

/**
 * Filtra pelo que o usuario pode ver.
 *
 * Recebe o decisor pronto em vez de consultar sozinho: `nav.ts` e importado por
 * componente de cliente, e puxar `autorizacao.ts` (que carrega `server-only` e o
 * driver `pg`) arrastaria codigo de servidor para o bundle do navegador.
 */
export function navVisivelPor(pode: (p: Permissao) => boolean): ItemNav[] {
  return navPrincipal.filter((item) => !item.permissao || pode(item.permissao));
}
