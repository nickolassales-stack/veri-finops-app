import { PainelUsuarios } from "@/components/admin/painel-usuarios";
import { requirePermissao } from "@/lib/auth/autorizacao";

export const metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  // A sessao volta daqui para a tela saber qual linha e a do proprio usuario e
  // avisar antes do clique. A REGRA em si e do servidor -- ver
  // `garantirQueRestaAdmin` --, porque quem chama a API direto ignoraria a tela.
  const sessao = await requirePermissao(
    "settings:users",
    "/dashboard/configuracoes/usuarios",
  );

  return <PainelUsuarios idUsuarioAtual={sessao.userId} />;
}
