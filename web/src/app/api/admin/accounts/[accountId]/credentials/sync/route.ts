import { analisar } from "@/lib/api/http";
import { rotaSomenteAdmin } from "@/lib/api/rota";
import { esquemaIdDeConta } from "@/lib/filtros/esquemas-admin";
import { esquemaEnfileirarColeta } from "@/lib/filtros/esquemas-credenciais";
import { getOvhSyncJobStatus, triggerOvhFirstSync } from "@/lib/services/credenciais-ovh";

/**
 * Fila de coleta de uma conta OVH.
 *
 *   POST /api/admin/accounts/:accountId/credentials/sync   -- enfileira
 *   GET  /api/admin/accounts/:accountId/credentials/sync   -- job vivo + ultimo
 *
 * ---------------------------------------------------------------------------
 * ESTA ROTA NAO EXECUTA COLETA
 *
 * Ela grava uma linha em `cloud_sync_jobs`. Um worker no host processa. A
 * distincao e o ponto: executar shell a partir de rota HTTP transformaria a tela
 * de configuracao em superficie de execucao de comando, e o container do portal
 * nem alcanca o venv do collector.
 *
 * Por isso tambem nao existe DELETE aqui. Cancelar job em `running` daria a
 * impressao de interromper uma coleta que segue correndo no host -- o worker nao
 * observa cancelamento. Um cancelamento honesto exige o worker verificar o status
 * entre etapas, e isso nao esta implementado.
 *
 * ---------------------------------------------------------------------------
 * SOMENTE ADMIN, por `rotaSomenteAdmin`
 *
 * Pelo mesmo motivo das outras rotas de credencial: `can()` da tudo ao ADMIN mas
 * tambem deixa qualquer grupo conceder qualquer permissao a um nao-ADMIN, entao
 * nenhuma permissao consegue expressar "so ADMIN". Ver lib/auth/permissoes.ts e o
 * teste rbac-credenciais.test.ts.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = rotaSomenteAdmin<{ accountId: string }>(
  "POST /api/admin/accounts/:accountId/credentials/sync",
  async ({ params, corpo, sessao }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    const { action } = analisar(esquemaEnfileirarColeta, corpo);

    const { job, criado } = await triggerOvhFirstSync(accountId, sessao.userId, action);

    // 200 tambem quando `criado: false`. Ja havia job vivo para a conta: o pedido
    // FOI ATENDIDO, e devolver 409 faria o segundo clique de um botao que
    // funcionou aparecer como erro. `criado` diz a tela qual frase mostrar.
    return {
      dados: { job, criado },
      meta: { jobId: job.id, enfileiradoEm: new Date().toISOString() },
    };
  },
);

export const GET = rotaSomenteAdmin<{ accountId: string }>(
  "GET /api/admin/accounts/:accountId/credentials/sync",
  async ({ params }) => {
    const accountId = analisar(esquemaIdDeConta, params.accountId);
    return { dados: await getOvhSyncJobStatus(accountId) };
  },
);
