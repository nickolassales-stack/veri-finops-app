import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaIdDeConta, esquemaPatchConta } from "@/lib/filtros/esquemas-admin";
import { salvarConfiguracaoDaConta } from "@/lib/queries/admin/contas";

/**
 * PATCH /api/admin/accounts/:accountId -- alias e metadados de uma conta.
 *
 * PATCH e nao PUT: a tela edita um campo de cada vez, e o que nao veio no corpo
 * PERMANECE. Um PUT obrigaria a reenviar o registro inteiro, e esquecer um
 * campo apagaria dado que ninguem pediu para apagar.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = rotaComPermissao<{ accountId: string }>(
  "PATCH /api/admin/accounts/:accountId",
  "settings:accounts",
  async ({ params, corpo }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const entrada = analisar(esquemaPatchConta, corpo);

    return { dados: await salvarConfiguracaoDaConta(accountId, entrada) };
  },
);
