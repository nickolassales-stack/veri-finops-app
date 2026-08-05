import Image from "next/image";
import { redirect } from "next/navigation";

import { getSessao } from "@/lib/auth/dal";
import { destinoInternoValido } from "@/lib/auth/destino";

import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Sessao valida entrando em /login vai direto para o painel. A checagem aqui e
  // a real (contra o banco): cookie expirado ou falsificado cai no formulario.
  const sessao = await getSessao();

  const params = await searchParams;
  const bruto = params?.next;
  const next = typeof bruto === "string" && destinoInternoValido(bruto) ? bruto : undefined;

  if (sessao) {
    redirect(next ?? "/dashboard");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-veri-offwhite px-6 py-12">
      <div className="w-full max-w-sm">
        {/*
          Logo com descritor horizontal, versao primaria -- valida sobre fundo
          claro conforme o brandbook. Dimensoes intrinsecas do arquivo oficial e
          altura controlada por CSS: sem distorcao, sem recolorir, sem recortar.
        */}
        <div className="mb-8 flex justify-center">
          <Image
            src="/brand/veri-logo-horizontal-primario.png"
            alt="VERI por Veridiana Quirino"
            width={4919}
            height={1723}
            priority
            className="h-14 w-auto"
          />
        </div>

        <div className="rounded-2xl border border-veri-verde-claro/40 bg-veri-branco p-8 shadow-[0_1px_3px_rgba(56,78,70,0.06)]">
          <h1 className="veri-display text-2xl text-veri-verde-escuro">Portal FinOps</h1>
          <p className="mt-1 mb-6 text-sm text-veri-verde-escuro/70">
            Acesso restrito. Entre com suas credenciais.
          </p>

          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-xs text-veri-verde-escuro/60">
          Não há cadastro público. Solicite acesso ao administrador do portal.
        </p>
      </div>
    </main>
  );
}
