import { rotaComPermissao } from "@/lib/api/rota";
import { listarContasAdministraveis } from "@/lib/queries/admin/contas";

/**
 * GET /api/admin/accounts -- contas AWS com os metadados do portal.
 *
 * A lista sai inteira de `cloud_accounts`: nenhum id de conta e fixo no codigo.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/admin/accounts",
  "settings:accounts",
  async () => {
    const contas = await listarContasAdministraveis();
    return { dados: contas, meta: { total: contas.length } };
  },
);
