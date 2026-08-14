import { rotaComPermissao } from "@/lib/api/rota";
import { getAutorizacao } from "@/lib/auth/autorizacao";
import {
  AREAS,
  PERMISSOES,
  PERMISSOES_DO_VIEWER,
  ROTULOS,
  permissoesEfetivas,
} from "@/lib/auth/permissoes";

/**
 * GET /api/admin/permissions -- o catalogo de permissoes.
 *
 * Vem do CODIGO, nao de tabela: uma permissao so significa alguma coisa se
 * alguma rota a verifica. A tela de grupos monta as caixas a partir daqui, o
 * que garante que nunca aparece opcao que o sistema nao sabe aplicar.
 *
 * Protegida por `settings:view` e nao por `settings:groups`: e leitura de
 * catalogo, sem dado de ninguem, e a tela de configuracoes precisa dela para
 * explicar o modelo mesmo a quem nao edita grupos.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/admin/permissions",
  "settings:view",
  async () => {
    const autorizacao = await getAutorizacao();

    return {
      dados: PERMISSOES.map((chave) => ({
        chave,
        ...ROTULOS[chave],
        /** Concedida a todo VIEWER independentemente de grupo. */
        piso: PERMISSOES_DO_VIEWER.includes(chave),
      })),
      meta: {
        areas: AREAS,
        total: PERMISSOES.length,
        // O que QUEM PERGUNTA tem hoje -- a tela usa para mostrar "voce ja pode
        // isto" sem precisar de uma segunda chamada.
        minhas: autorizacao ? permissoesEfetivas(autorizacao) : [],
      },
    };
  },
);
