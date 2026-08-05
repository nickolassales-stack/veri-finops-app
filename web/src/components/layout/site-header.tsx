import Image from "next/image";
import Link from "next/link";

import { sair } from "@/lib/auth/actions";
import type { Sessao } from "@/lib/auth/session";
import { navVisivelPara } from "@/lib/nav";

import { MainNav } from "./main-nav";

export function SiteHeader({ sessao }: { sessao: Sessao }) {
  return (
    <header className="border-b border-veri-offwhite bg-veri-branco">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-4"
          aria-label="Portal FinOps VERI"
        >
          {/*
            Logo com descritor horizontal, versao primaria -- valida sobre fundo
            branco/claro conforme o brandbook. As dimensoes intrinsecas sao as do
            arquivo oficial; a altura visual e controlada por CSS, sem distorcao.
          */}
          <Image
            src="/brand/veri-logo-horizontal-primario.png"
            alt="VERI por Veridiana Quirino"
            width={4919}
            height={1723}
            priority
            className="h-12 w-auto"
          />
          <span className="sr-only">Portal FinOps</span>
          <span aria-hidden className="hidden h-8 w-px bg-veri-offwhite sm:block" />
          <span className="veri-display hidden text-lg text-veri-verde-escuro sm:block">
            Portal FinOps
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <MainNav itens={navVisivelPara(sessao.papel)} />

          <span aria-hidden className="hidden h-8 w-px bg-veri-offwhite sm:block" />

          <div className="flex items-center gap-3">
            <span className="hidden text-right text-xs leading-tight sm:block">
              <span className="block text-veri-verde-escuro">
                {sessao.nome ?? sessao.email}
              </span>
              <span className="block text-veri-verde-escuro/60">{sessao.papel}</span>
            </span>

            {/* Server action direto no form: logout funciona sem JS no cliente. */}
            <form action={sair}>
              <button
                type="submit"
                className="rounded-full border border-veri-verde-claro/60 px-4 py-2 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
