import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaIdNumerico, esquemaPatchGrupo } from "@/lib/filtros/esquemas-admin";
import { atualizarGrupo } from "@/lib/queries/admin/grupos";

/** PATCH /api/admin/groups/:id -- nome, descricao e ativacao. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = rotaComPermissao<{ id: string }>(
  "PATCH /api/admin/groups/:id",
  "settings:groups",
  async ({ params, corpo }) => {
    const id = analisar(esquemaIdNumerico, params.id);
    const entrada = analisar(esquemaPatchGrupo, corpo);

    return { dados: await atualizarGrupo(id, entrada) };
  },
);
