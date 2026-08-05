import Link from "next/link";

import { Aviso } from "@/components/ui/aviso";
import { requireSessao } from "@/lib/auth/dal";

export const metadata = { title: "Sem permissao" };

export default async function SemPermissaoPage() {
  const sessao = await requireSessao();

  return (
    <div className="space-y-6">
      <h1 className="veri-display text-3xl text-veri-verde-escuro">Sem permissao</h1>

      <Aviso tom="atencao" titulo="Esta area exige perfil ADMIN">
        <p>
          Você está autenticado como <span className="veri-numero">{sessao.email}</span>{" "}
          com perfil <strong>{sessao.papel}</strong>, que não tem acesso a esta tela.
        </p>
        <p>
          <Link href="/dashboard" className="underline underline-offset-2">
            Voltar à visão executiva
          </Link>
        </p>
      </Aviso>
    </div>
  );
}
