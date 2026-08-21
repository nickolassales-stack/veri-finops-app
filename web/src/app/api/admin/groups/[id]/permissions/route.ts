import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaIdNumerico, esquemaPermissoes } from "@/lib/filtros/esquemas-admin";
import { definirPermissoesDoGrupo } from "@/lib/queries/admin/grupos";

/**
 * PATCH /api/admin/groups/:id/permissions
 *
 * Recebe o conjunto COMPLETO de permissoes do grupo, nao um delta. A tela e uma
 * lista de caixas: o que chega e o estado final delas, e o que nao veio foi
 * desmarcado. Delta exigiria a tela saber o que mudou e abriria a chance de
 * duas abas abertas se sobrescreverem pela metade.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = rotaComPermissao<{ id: string }>(
  "PATCH /api/admin/groups/:id/permissions",
  "settings:groups",
  async ({ params, corpo }) => {
    const id = analisar(esquemaIdNumerico, params.id);
    const { permissoes } = analisar(esquemaPermissoes, corpo);

    return { dados: await definirPermissoesDoGrupo(id, permissoes) };
  },
);
