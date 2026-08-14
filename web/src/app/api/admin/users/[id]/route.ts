import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import type { Papel } from "@/lib/auth/tipos";
import { esquemaIdNumerico, esquemaPatchUsuario } from "@/lib/filtros/esquemas-admin";
import { atualizarUsuario } from "@/lib/queries/admin/usuarios";

/**
 * PATCH /api/admin/users/:id -- nome, papel, ativacao e grupos.
 *
 * A sessao de quem chama vai junto para a camada de dados: e ela que sustenta a
 * regra de nao deixar o administrador desativar ou rebaixar a si mesmo. Essa
 * decisao NAO pode ficar na tela -- quem chama a API direto passaria por cima.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const PATCH = rotaComPermissao<{ id: string }>(
  "PATCH /api/admin/users/:id",
  "settings:users",
  async ({ params, corpo, sessao }) => {
    const id = analisar(esquemaIdNumerico, params.id);
    const entrada = analisar(esquemaPatchUsuario, corpo);

    return {
      dados: await atualizarUsuario(
        id,
        { ...entrada, papel: entrada.papel as Papel | undefined },
        sessao.userId,
      ),
    };
  },
);
