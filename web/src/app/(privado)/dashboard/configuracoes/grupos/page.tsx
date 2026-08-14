import { PainelGrupos } from "@/components/admin/painel-grupos";
import { requirePermissao } from "@/lib/auth/autorizacao";

export const metadata = { title: "Grupos" };

export default async function GruposPage() {
  await requirePermissao("settings:groups", "/dashboard/configuracoes/grupos");
  return <PainelGrupos modo="grupos" />;
}
