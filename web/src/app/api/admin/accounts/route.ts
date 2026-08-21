import { rotaComPermissao } from "@/lib/api/rota";
import { ehAdminAtual } from "@/lib/auth/autorizacao";
import { ovhInstaladoNoBanco } from "@/lib/queries/dashboard-ovh";
import { getUltimoSucessoOvh } from "@/lib/queries/ovh";
import { listCloudAccountsWithCredentialStatus } from "@/lib/services/credenciais-ovh";

/**
 * GET /api/admin/accounts -- contas de TODOS os provedores com os metadados do
 * portal, e a situacao da credencial quando quem pergunta e ADMIN.
 *
 * A lista sai inteira de `cloud_accounts`: nenhum id de conta e fixo no codigo.
 *
 * ---------------------------------------------------------------------------
 * DUAS EXIGENCIAS DIFERENTES NA MESMA ROTA
 *
 * `settings:accounts` da acesso a lista e aos metadados -- alias, unidade, centro
 * de custo, ambiente. E delegavel por grupo, e continua assim.
 *
 * O bloco `credencial` de cada conta exige PAPEL ADMIN, verificado aqui
 * separadamente. Nao existe permissao capaz de expressar isso: qualquer
 * permissao pode ser concedida a um grupo, e um grupo pode conter um VIEWER --
 * ver o comentario de `rotaSomenteAdmin`.
 *
 * Para quem nao e ADMIN o campo sai `null` em todas as contas. Nao e a tela que
 * decide esconder: o dado nao sai do servidor. Um `curl` com sessao de VIEWER
 * recebe exatamente o mesmo JSON que o navegador dele receberia.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/admin/accounts",
  "settings:accounts",
  async () => {
    const admin = await ehAdminAtual();
    const contas = await listCloudAccountsWithCredentialStatus(admin);

    // "Ultima sincronizacao" sai DAQUI e nao de uma segunda chamada a
    // /api/dashboard/ovh/sync-status. Dois motivos: aquela rota exige
    // `dashboard:view`, e amarrar a tela de Contas Cloud a uma permissao de
    // dashboard faria um administrador sem ela ver o campo vazio sem explicacao;
    // e uma carga de tela com duas idas ao servidor para um campo nao se paga.
    //
    // O dado e do COLLECTOR (`ovh_sync_runs`), nao da credencial: cadastrar
    // credencial aqui nao dispara coleta, e a tela diz isso explicitamente.
    const ultimaSincronizacaoOvh =
      admin && (await ovhInstaladoNoBanco())
        ? ((await getUltimoSucessoOvh())?.finishedAt ?? null)
        : null;

    return {
      dados: contas,
      meta: {
        total: contas.length,
        ultimaSincronizacaoOvh,
        // A tela precisa saber POR QUE nao recebeu credencial nenhuma: sem esta
        // bandeira, "nenhuma conta OVH tem credencial" e "voce nao pode ver as
        // credenciais" chegam identicos, e a primeira leitura mandaria um
        // operador cadastrar algo que ja existe.
        podeVerCredenciais: admin,
        contasOvh: contas.filter((c) => c.provider === "ovh").length,
      },
    };
  },
);
