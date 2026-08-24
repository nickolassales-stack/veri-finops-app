import { analisar } from "@/lib/api/http";
import { rotaSomenteAdmin } from "@/lib/api/rota";
import { esquemaIdDeConta } from "@/lib/filtros/esquemas-admin";
import { esquemaTesteCredencialOvh } from "@/lib/filtros/esquemas-credenciais";
import { validateOvhCredentials } from "@/lib/services/credenciais-ovh";

/**
 * POST /api/admin/accounts/:accountId/credentials/test -- valida a credencial
 * contra a API da OVH.
 *
 * ---------------------------------------------------------------------------
 * ROTA PROPRIA, E NAO UMA FLAG NO PUT
 *
 * Salvar e testar sao operacoes com falhas independentes, e juntar as duas
 * amarraria uma na outra do jeito errado:
 *
 *   - Salvar com a OVH fora do ar TEM de funcionar. Se o PUT validasse, uma
 *     indisponibilidade do provedor impediria o cadastro.
 *   - Testar SEM salvar tem de funcionar. E o caso principal: conferir a
 *     credencial antes de gravar, para nao deixar no banco uma que nao serve.
 *
 * Por isso o teste aceita os tres segredos no corpo. Campo vazio cai para o que
 * esta gravado, o que permite retestar uma credencial existente sem redigita-la
 * -- que e como se descobre que uma coleta parou porque a chave foi revogada no
 * console da OVH.
 *
 * ---------------------------------------------------------------------------
 * POST, ainda que nada seja criado
 *
 * O teste tem efeito: sai para a internet e, quando ja existe cadastro, grava o
 * veredito em `status`/`last_validated_at`. GET com corpo de segredo tambem
 * arriscaria a credencial ir para query string em algum intermediario.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = rotaSomenteAdmin<{ accountId: string }>(
  "POST /api/admin/accounts/:accountId/credentials/test",
  async ({ params, corpo, sessao }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const entrada = analisar(esquemaTesteCredencialOvh, corpo);

    const resultado = await validateOvhCredentials(accountId, entrada, sessao.userId);

    // HTTP 200 mesmo quando `ok: false`. A requisicao foi bem atendida -- o
    // portal perguntou a OVH e obteve resposta. Devolver 4xx faria o cliente
    // tratar como falha de chamada e perder a mensagem, que aqui e o produto.
    return {
      dados: resultado,
      meta: { validadoEm: new Date().toISOString() },
    };
  },
);
