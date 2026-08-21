import Link from "next/link";
import { headers } from "next/headers";

import { requirePermissao } from "@/lib/auth/autorizacao";
import { HEADER_CAMINHO } from "@/proxy";

/**
 * Fronteira da area administrativa.
 *
 * `settings:view` e exigida UMA vez, aqui, e vale para toda subrota. Cada tela
 * ainda pede a sua permissao especifica (`settings:accounts`, `settings:users`,
 * `settings:groups`) -- quem entra na area nao entra automaticamente em tudo.
 *
 * Esconder o link no menu nao e protecao: a autorizacao esta aqui e nas rotas
 * de API. Digitar a URL na barra do navegador para no mesmo lugar.
 */

const ABAS = [
  { href: "/dashboard/configuracoes", label: "Visao geral", exato: true },
  { href: "/dashboard/configuracoes/contas", label: "Contas AWS" },
  { href: "/dashboard/configuracoes/usuarios", label: "Usuarios" },
  { href: "/dashboard/configuracoes/grupos", label: "Grupos" },
  { href: "/dashboard/configuracoes/permissoes", label: "Permissoes" },
];

export default async function LayoutConfiguracoes({
  children,
}: LayoutProps<"/dashboard/configuracoes">) {
  const caminho = (await headers()).get(HEADER_CAMINHO) ?? undefined;
  await requirePermissao("settings:view", caminho);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Configurações</h1>
        <p className="mt-2 max-w-2xl text-sm text-texto-suave">
          Área administrativa do portal. O que é alterado aqui vale para todos os
          usuários.
        </p>
      </div>

      <nav aria-label="Seções de configuração" className="border-b border-veri-offwhite">
        <ul className="-mb-px flex flex-wrap gap-1">
          {ABAS.map((aba) => (
            <li key={aba.href}>
              <Link
                href={aba.href}
                className="block rounded-t-lg px-4 py-2.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
              >
                {aba.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {children}
    </div>
  );
}
