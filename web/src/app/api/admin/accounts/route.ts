import { analisar } from "@/lib/api/http";
import { rotaComPermissao, rotaSomenteAdmin } from "@/lib/api/rota";
import { ehAdminAtual } from "@/lib/auth/autorizacao";
import {
  esquemaNovaContaOvh,
  esquemaProviderConsulta,
} from "@/lib/filtros/esquemas-credenciais";
import { contasComCustoSemCadastro } from "@/lib/queries/admin/contas";
import { contarFalhasRecentes, filaDisponivel } from "@/lib/queries/admin/jobs-sync";
import { ovhInstaladoNoBanco } from "@/lib/queries/dashboard-ovh";
import { getUltimoSucessoOvh } from "@/lib/queries/ovh";
import {
  criarContaOvh,
  listCloudAccountsWithCredentialStatus,
} from "@/lib/services/credenciais-ovh";

/**
 * GET  /api/admin/accounts        -- contas com metadados e situacao da credencial
 * POST /api/admin/accounts        -- cria uma conta OVH
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
  async ({ url }) => {
    // `?provider=` FILTRA NO SERVIDOR. Filtrar so na tela mandaria a lista OVH
    // inteira -- com a situacao de cada credencial -- para quem abriu a visao
    // AWS, e a separacao viraria cosmetica: o dado do outro provedor estaria no
    // payload, visivel em qualquer aba de rede.
    const provider = analisar(
      esquemaProviderConsulta,
      url.searchParams.get("provider") ?? undefined,
    );

    const admin = await ehAdminAtual();
    const todas = await listCloudAccountsWithCredentialStatus(admin);
    const contas = provider
      ? todas.filter((c) =>
          provider === "ovh" ? c.provider === "ovh" : c.provider !== "ovh",
        )
      : todas;

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

    // A fila pode nao existir (migracao 008 nao aplicada). `null` e nao `0`: zero
    // AFIRMA que nao ha falha, e afirmar isso sem ter consultado seria mentira.
    const temFila = await filaDisponivel();
    const coletasComFalha = temFila ? await contarFalhasRecentes() : null;

    // Contas com custo importado que ninguem cadastrou. Ver a pendencia de
    // auto-discovery em `contasComCustoSemCadastro`.
    const semCadastro = await contasComCustoSemCadastro();

    return {
      dados: contas,
      meta: {
        total: contas.length,
        // Os totais por provedor sao dos NAO FILTRADOS: os cartoes do topo
        // resumem o ambiente, e trocar de visao nao pode zerar o cartao do outro
        // provedor -- o numero pareceria ter caido a zero.
        contasAws: todas.filter((c) => c.provider !== "ovh").length,
        contasOvh: todas.filter((c) => c.provider === "ovh").length,
        ultimaSincronizacaoOvh,
        // A tela precisa saber POR QUE nao recebeu credencial nenhuma: sem esta
        // bandeira, "nenhuma conta OVH tem credencial" e "voce nao pode ver as
        // credenciais" chegam identicos, e a primeira leitura mandaria um
        // operador cadastrar algo que ja existe.
        podeVerCredenciais: admin,
        filaDisponivel: temFila,
        coletasComFalha,
        contasComCustoSemCadastro: semCadastro,
      },
    };
  },
);

/**
 * POST /api/admin/accounts -- cria uma conta OVH.
 *
 * ---------------------------------------------------------------------------
 * SOMENTE ADMIN, e nao `settings:accounts`
 *
 * O corpo carrega os TRES SEGREDOS da API OVH. `settings:accounts` e delegavel a
 * qualquer grupo, e um grupo pode conter um VIEWER -- entao ela nao consegue
 * expressar "so ADMIN". Mesma razao de `rotaSomenteAdmin` nas demais rotas de
 * credencial. Ver lib/auth/permissoes.ts e rbac-credenciais.test.ts.
 *
 * ---------------------------------------------------------------------------
 * SO OVH, POR DESENHO
 *
 * Nao existe POST para conta AWS, e a ausencia e proposital. Conta AWS nao se
 * cadastra: ela existe porque entregou custo no CUR, com um id de 12 digitos que
 * a AWS emitiu. Um formulario aqui criaria uma linha que nunca casa com dado
 * nenhum -- conta fantasma no filtro, somando zero para sempre.
 *
 * O botao "Adicionar conta AWS" da tela abre o procedimento operacional, que e o
 * que de fato faz a conta existir. A pendencia real -- o ETL nao cadastra a conta
 * automaticamente depois que o custo chega -- esta documentada em
 * docs/CONTAS-CLOUD.md e exposta na tela pelo `contasComCustoSemCadastro`.
 */
export const POST = rotaSomenteAdmin(
  "POST /api/admin/accounts",
  async ({ corpo, sessao }) => {
    const entrada = analisar(esquemaNovaContaOvh, corpo);
    const resultado = await criarContaOvh(entrada, sessao.userId);

    return {
      dados: resultado,
      meta: { accountId: entrada.accountId, criadaEm: new Date().toISOString() },
    };
  },
);
