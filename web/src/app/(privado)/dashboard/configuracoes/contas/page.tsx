import { PainelContas } from "@/components/admin/painel-contas";
import { requirePermissao } from "@/lib/auth/autorizacao";

export const metadata = { title: "Contas Cloud" };

export default async function ContasPage() {
  await requirePermissao("settings:accounts", "/dashboard/configuracoes/contas");
  return <PainelContas />;
}
