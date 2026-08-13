import { Card } from "@/components/ui/card";
import { requireSessao } from "@/lib/auth/dal";
import { MIN_TAMANHO_SENHA } from "@/lib/auth/password.mjs";
import { getEnv } from "@/lib/env";
import { formatDataHora } from "@/lib/format";

import { TrocaSenhaForm } from "./troca-senha-form";

export const metadata = { title: "Minha conta" };

export default async function ContaPage() {
  const sessao = await requireSessao("/conta");
  const tz = getEnv().APP_TZ;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Minha conta</h1>
        <p className="mt-2 text-sm text-texto-suave">
          Dados da sessão e troca de senha.
        </p>
      </div>

      <Card titulo="Identificação">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-texto-suave">
              E-mail
            </dt>
            <dd className="veri-numero mt-1 text-sm">{sessao.email}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-texto-suave">
              Perfil
            </dt>
            <dd className="mt-1 text-sm">{sessao.papel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-texto-suave">
              Sessão expira em
            </dt>
            <dd className="veri-numero mt-1 text-sm">
              {formatDataHora(sessao.expiraEm, tz)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        titulo="Trocar senha"
        descricao="A senha atual é exigida mesmo com a sessão aberta."
      >
        <TrocaSenhaForm minimo={MIN_TAMANHO_SENHA} />
      </Card>
    </div>
  );
}
