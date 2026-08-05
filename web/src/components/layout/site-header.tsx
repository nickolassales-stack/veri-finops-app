import Image from "next/image";
import Link from "next/link";

import { MainNav } from "./main-nav";

export function SiteHeader() {
  return (
    <header className="border-b border-veri-offwhite bg-veri-branco">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="flex items-center gap-4" aria-label="Portal FinOps VERI">
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
          <span
            aria-hidden
            className="hidden h-8 w-px bg-veri-offwhite sm:block"
          />
          <span className="veri-display hidden text-lg text-veri-verde-escuro sm:block">
            Portal FinOps
          </span>
        </Link>

        <MainNav />
      </div>
    </header>
  );
}
