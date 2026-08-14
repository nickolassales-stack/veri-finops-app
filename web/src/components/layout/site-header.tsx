import Image from "next/image";
import Link from "next/link";

import { sair } from "@/lib/auth/actions";
import { getAutorizacao } from "@/lib/auth/autorizacao";
import { can } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/session";
import { navVisivelPor } from "@/lib/nav";

import { MainNav } from "./main-nav";

export async function SiteHeader({ sessao }: { sessao: Sessao }) {
  // O menu passou a depender de PERMISSAO, nao so de papel. A resolucao e feita
  // aqui, no servidor: `nav.ts` continua puro para nao arrastar o driver `pg`
  // para o bundle do `MainNav`, que e componente de cliente.
  const autorizacao = await getAutorizacao();
  const itens = navVisivelPor((p) => (autorizacao ? can(autorizacao, p) : false));

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

        {/*
          `flex-wrap` aqui e nao so no container externo.

          Este bloco (menu + separador + usuario + sair) era rigido e, com a
          entrada de "Configuracoes", passou a somar 559px -- mais que os 390px
          de um celular. O corpo inteiro ganhava rolagem horizontal, em TODAS as
          telas, inclusive as que ja existiam antes desta entrega.

          `justify-end` mantem o alinhamento a direita quando as linhas quebram.
        */}
        <div className="flex flex-wrap items-center justify-end gap-4">
          <MainNav itens={itens} />

          <span aria-hidden className="hidden h-8 w-px bg-veri-offwhite sm:block" />

          <div className="flex items-center gap-3">
            {/*
              O nome do usuario e o acesso a /conta, onde se troca a senha.

              Visivel em QUALQUER largura: escondido no celular, nao havia como
              saber com que conta se esta logado nem como chegar a troca de
              senha -- a unica outra porta para /conta. O cabecalho ja e
              `flex-wrap`, entao em tela estreita este bloco desce de linha em
              vez de espremer o logo.
            */}
            <Link
              href="/conta"
              className="rounded-lg px-2 py-1 text-right text-xs leading-tight transition-colors hover:bg-veri-offwhite"
            >
              <span className="block text-veri-verde-escuro">
                {sessao.nome ?? sessao.email}
              </span>
              <span className="block text-texto-suave">
                {sessao.papel} · minha conta
              </span>
            </Link>

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
