import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaNovoGrupo } from "@/lib/filtros/esquemas-admin";
import { criarGrupo, listarGrupos } from "@/lib/queries/admin/grupos";

/**
 * GET  /api/admin/groups
 * POST /api/admin/groups
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/admin/groups",
  "settings:groups",
  async () => {
    const grupos = await listarGrupos();
    return { dados: grupos, meta: { total: grupos.length } };
  },
);

export const POST = rotaComPermissao(
  "POST /api/admin/groups",
  "settings:groups",
  async ({ corpo }) => {
    const entrada = analisar(esquemaNovoGrupo, corpo);
    return { dados: await criarGrupo(entrada) };
  },
);
