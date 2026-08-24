import { analisar } from "@/lib/api/http";
import { rotaSomenteAdmin } from "@/lib/api/rota";
import { esquemaColetaOvh } from "@/lib/filtros/esquemas-credenciais";
import { enfileirarColetaOvh, getEstadoColetaOvh } from "@/lib/services/credenciais-ovh";

/**
 * Coleta OVH pedida pela tela de Diagnóstico.
 *
 *   POST /api/diagnostico/ovh/collect   { "scope": "all" }
 *                                       { "scope": "account", "accountId": "..." }
 *   GET  /api/diagnostico/ovh/collect   estado da fila por conta
 *
 * ---------------------------------------------------------------------------
 * ESTA ROTA NÃO EXECUTA COLETA
 *
 * Ela grava linhas em `cloud_sync_jobs`. O worker no host processa. O container
 * do portal não alcança o venv do collector, e executar shell a partir de rota
 * HTTP transformaria a tela de diagnóstico em superfície de execução de comando.
 *
 * É a mesma infraestrutura de `credentials/sync` — a diferença é o escopo: lá,
 * uma conta, no contexto de acabar de salvar a credencial dela; aqui, todas as
 * contas OVH ativas, no contexto de investigar por que o número não bateu.
 *
 * ---------------------------------------------------------------------------
 * SOMENTE ADMIN, por `rotaSomenteAdmin` e não por `diagnostics:view`
 *
 * Ver a tela é uma coisa; disparar trabalho contra a API de um provedor é outra.
 * E `can()` não consegue expressar "só ADMIN": ele dá tudo ao ADMIN mas também
 * deixa qualquer grupo conceder qualquer permissão a um não-ADMIN. Ver
 * lib/auth/permissoes.ts e rbac-credenciais.test.ts.
 *
 * Consequência deliberada: um usuário com `diagnostics:view` VÊ o painel e não
 * vê o botão. A tela esconder o botão não é a proteção — a proteção é esta rota.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = rotaSomenteAdmin(
  "POST /api/diagnostico/ovh/collect",
  async ({ corpo, sessao }) => {
    const entrada = analisar(esquemaColetaOvh, corpo);
    const resultado = await enfileirarColetaOvh(entrada, sessao.userId);

    // 200 mesmo com `ignoradas` preenchido. Enfileirar 2 de 3 contas é sucesso
    // parcial, não falha: devolver 4xx faria o cliente descartar a informação de
    // que duas coletas ESTÃO a caminho.
    return {
      dados: resultado,
      meta: {
        enfileiradas: resultado.jobs.length,
        ignoradas: resultado.ignoradas.length,
        pedidoEm: new Date().toISOString(),
      },
    };
  },
);

export const GET = rotaSomenteAdmin(
  "GET /api/diagnostico/ovh/collect",
  async () => ({ dados: await getEstadoColetaOvh() }),
);
