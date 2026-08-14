import { PainelGrupos } from "@/components/admin/painel-grupos";
import { Aviso } from "@/components/ui/aviso";
import { requirePermissao } from "@/lib/auth/autorizacao";

export const metadata = { title: "Permissoes" };

export default async function PermissoesPage() {
  await requirePermissao("settings:groups", "/dashboard/configuracoes/permissoes");

  return (
    <div className="space-y-6">
      <Aviso tom="info" titulo="Como o portal decide o que você pode fazer">
        <p>
          A permissão efetiva é a <strong>união</strong> de três origens: o perfil{" "}
          <strong>ADMIN</strong>, que libera tudo; o piso de leitura que todo usuário tem
          (visão executiva e analítico); e as permissões dos <strong>grupos ativos</strong>{" "}
          de que a pessoa participa.
        </p>
        <p>
          Grupo apenas <strong>concede</strong> — não existe permissão negativa. Assim,
          responder “por que fulano não consegue exportar?” é procurar quem concede, e não
          investigar o cruzamento de vários grupos.
        </p>
      </Aviso>

      <PainelGrupos modo="permissoes" />
    </div>
  );
}
