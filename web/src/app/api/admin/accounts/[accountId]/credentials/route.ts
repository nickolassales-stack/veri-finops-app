import { analisar } from "@/lib/api/http";
import { rotaSomenteAdmin } from "@/lib/api/rota";
import { esquemaIdDeConta } from "@/lib/filtros/esquemas-admin";
import { esquemaCredencialOvh } from "@/lib/filtros/esquemas-credenciais";
import {
  deleteOvhCredentials,
  getOvhCredentialStatus,
  saveOvhCredentials,
} from "@/lib/services/credenciais-ovh";

/**
 * Credenciais de API de UMA conta OVH.
 *
 *   GET    -- situacao e mascaras. Nunca o segredo.
 *   PUT    -- grava (cria ou substitui).
 *   DELETE -- remove.
 *
 * ---------------------------------------------------------------------------
 * `rotaSomenteAdmin` E NAO `rotaComPermissao`
 *
 * Papel, nao permissao. Permissao e delegavel a grupo, e grupo pode conter
 * VIEWER: `settings:credentials` daria a ILUSAO de exclusividade com uma tela de
 * grupos capaz de conceder a chave da OVH a qualquer usuario em dois cliques.
 *
 * ---------------------------------------------------------------------------
 * PUT E NAO PATCH, e a diferenca importa aqui
 *
 * As outras rotas administrativas usam PATCH porque editam campo a campo. Esta
 * substitui o CONJUNTO da credencial: as tres partes e o endpoint formam uma
 * unidade -- trocar a application key e manter o secret antigo nao produz uma
 * credencial "parcialmente atualizada", produz uma credencial invalida.
 *
 * O que PARECE PATCH -- campo de segredo vazio preservando o valor gravado -- e
 * uma regra de PREENCHIMENTO, nao de semantica HTTP: a tela nunca recebe o
 * segredo de volta, entao branco tem de significar "mantenha". Sem isso, abrir o
 * formulario para trocar so o endpoint apagaria a credencial.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaSomenteAdmin<{ accountId: string }>(
  "GET /api/admin/accounts/:accountId/credentials",
  async ({ params }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const credencial = await getOvhCredentialStatus(accountId);

    // `null` no corpo, e nao 404: "esta conta nao tem credencial cadastrada" e
    // uma resposta legitima sobre um recurso que existe, nao a ausencia do
    // recurso. 404 obrigaria a tela a tratar erro para desenhar o estado
    // "Nao configurado", que e o estado inicial normal de toda conta OVH.
    return { dados: credencial, meta: { configurada: credencial !== null } };
  },
);

export const PUT = rotaSomenteAdmin<{ accountId: string }>(
  "PUT /api/admin/accounts/:accountId/credentials",
  async ({ params, corpo, sessao }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const entrada = analisar(esquemaCredencialOvh, corpo);

    const { credencial, avisoContasDuplicadas } = await saveOvhCredentials(
      accountId,
      entrada,
      sessao.userId,
    );

    return {
      dados: credencial,
      meta: {
        // A duplicata sai em `meta` e nao como erro: pode ser legitima durante
        // uma migracao de conta. Mas o silencio seria pior -- duas contas com a
        // mesma chave coletam a MESMA conta da OVH, e os dois totais parecem
        // plausiveis, entao ninguem descobre pelo numero.
        avisoContasDuplicadas,
        // A gravacao nao valida contra a OVH de proposito: salvar tem de
        // funcionar com a internet fora do ar. A tela usa isto para sugerir o
        // teste em seguida.
        precisaTestar: true,
      },
    };
  },
);

export const DELETE = rotaSomenteAdmin<{ accountId: string }>(
  "DELETE /api/admin/accounts/:accountId/credentials",
  async ({ params }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const { removida } = await deleteOvhCredentials(accountId);

    // Remover duas vezes nao e erro -- o estado final e o pedido. Mas a tela diz
    // coisas diferentes, entao o booleano sobe.
    return { dados: { removida }, meta: {} };
  },
);
