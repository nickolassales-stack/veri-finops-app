import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import { query, queryOne, queryOpcional } from "@/lib/database";

import { aliasDisponivel, expressaoNomeDaConta, joinAlias } from "../alias-conta";

/**
 * Metadados de conta mantidos pelo portal.
 *
 * A LISTA sai sempre de `cloud_accounts` -- nenhum id de conta e fixo no
 * codigo. `app_account_settings` so acrescenta o que o ADMIN digitou, por LEFT
 * JOIN: conta sem configuracao aparece igual, com os campos vazios.
 */

export type ContaAdministravel = {
  accountId: string;
  /** O que o portal exibe hoje, ja resolvido pela cascata. */
  nomeExibicao: string;
  /** O que o ADMIN digitou. `null` quando nunca foi definido. */
  alias: string | null;
  /** O que o cadastro de origem afirma. Somente leitura nesta tela. */
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  invoiceCloseDay: number | null;
  paymentStatus: string | null;
  paymentStatusUpdatedAt: string | null;
  ativa: boolean;
  /** `true` quando ja existe linha em `app_account_settings`. */
  configurada: boolean;
  /**
   * `cloud_accounts.provider`. Somente leitura nesta tela: trocar o provider de
   * uma conta que ja tem custo carregado a desligaria da sua origem de dado --
   * uma conta AWS marcada como OVH desapareceria do painel e nao apareceria em
   * Faturamento, porque nao existe linha correspondente em `ovh_monthly_costs`.
   * O cadastro do provider e do onboarding, nao da tela de alias.
   */
  provider: string;
};

const SELECAO = `
  a.account_id,
  a.account_name,
  a.active,
  s.alias,
  s.business_unit  AS cfg_business_unit,
  s.cost_center    AS cfg_cost_center,
  s.environment    AS cfg_environment,
  s.invoice_close_day,
  s.payment_status,
  s.payment_status_updated_at,
  (s.account_id IS NOT NULL) AS configurada,
  a.business_unit  AS cad_business_unit,
  a.cost_center    AS cad_cost_center,
  a.environment    AS cad_environment,
  a.provider
`;

type LinhaConta = {
  account_id: string;
  account_name: string;
  active: boolean | null;
  alias: string | null;
  cfg_business_unit: string | null;
  cfg_cost_center: string | null;
  cfg_environment: string | null;
  invoice_close_day: number | null;
  payment_status: string | null;
  payment_status_updated_at: Date | null;
  configurada: boolean;
  cad_business_unit: string | null;
  cad_cost_center: string | null;
  cad_environment: string | null;
  provider: string | null;
  nome_exibicao: string;
};

function mapear(l: LinhaConta): ContaAdministravel {
  return {
    accountId: l.account_id,
    nomeExibicao: l.nome_exibicao,
    alias: l.alias,
    accountName: l.account_name,
    // O valor do portal tem precedencia; sem ele, mostra o do cadastro. Assim o
    // formulario abre ja preenchido com o que esta valendo, em vez de em branco.
    businessUnit: l.cfg_business_unit ?? l.cad_business_unit,
    costCenter: l.cfg_cost_center ?? l.cad_cost_center,
    environment: l.cfg_environment ?? l.cad_environment,
    invoiceCloseDay: l.invoice_close_day,
    paymentStatus: l.payment_status,
    paymentStatusUpdatedAt: l.payment_status_updated_at?.toISOString() ?? null,
    ativa: l.active ?? false,
    configurada: l.configurada,
    provider: l.provider ?? "aws",
  };
}

export async function listarContasAdministraveis(): Promise<ContaAdministravel[]> {
  const comAlias = await aliasDisponivel();
  if (!comAlias) {
    throw new ErroDeApi(
      "banco-indisponivel",
      "A tabela de configuracoes de conta ainda nao existe. Rode a migracao 002.",
    );
  }

  const amarracao = { colunaId: "a.account_id", cadastro: "a" };
  const linhas = await query<LinhaConta>(
    `SELECT ${SELECAO},
            ${expressaoNomeDaConta(true, amarracao)} AS nome_exibicao
       FROM cloud_accounts a
       ${joinAlias(true, amarracao)}
      ORDER BY ${expressaoNomeDaConta(true, amarracao)} ASC, a.account_id ASC`,
  );

  return linhas.map(mapear);
}

// ------------------------------------------------------------------ escrita

/**
 * Fechamento de fatura e situacao de pagamento NAO estao aqui.
 *
 * Eles moram nas mesmas colunas, e sao escritos por `lib/queries/billing.ts`,
 * atras de `billing:manage`. Manter uma segunda via de escrita neste modulo --
 * que exige apenas `settings:accounts` -- anularia essa exigencia.
 */
export type AtualizacaoDeConta = {
  alias?: string | null;
  businessUnit?: string | null;
  costCenter?: string | null;
  environment?: string | null;
};

/**
 * Grava a configuracao de UMA conta.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` porque a linha pode nao existir ainda: a
 * primeira edicao de uma conta e uma insercao, as seguintes sao atualizacoes, e
 * a tela nao precisa saber em qual dos dois casos esta.
 *
 * O `COALESCE(EXCLUDED.x, tabela.x)` faz o PATCH ser PARCIAL de verdade: campo
 * que a tela nao mandou preserva o valor atual em vez de virar NULL. Sem isso,
 * editar so o alias apagaria o centro de custo.
 */
export async function salvarConfiguracaoDaConta(
  accountId: string,
  dados: AtualizacaoDeConta,
): Promise<ContaAdministravel> {
  const existe = await queryOne<{ existe: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM cloud_accounts WHERE account_id = $1) AS existe`,
    [accountId],
  );
  if (!existe.existe) {
    throw new ErroDeApi(
      "nao-encontrado",
      "Conta nao encontrada no cadastro. Ela precisa existir em cloud_accounts.",
    );
  }

  // String vazia vira NULL: "apagar o alias" e voltar ao nome do cadastro, nao
  // gravar um nome em branco que a cascata teria de tratar depois.
  const limpar = (v: string | null | undefined) =>
    v === undefined ? null : v === null ? null : v.trim() === "" ? null : v.trim();

  const informado = (chave: keyof AtualizacaoDeConta) =>
    Object.hasOwn(dados, chave);

  await query(
    `
    INSERT INTO app_account_settings (
      account_id, alias, business_unit, cost_center, environment
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (account_id) DO UPDATE SET
      alias         = CASE WHEN $6 THEN EXCLUDED.alias         ELSE app_account_settings.alias         END,
      business_unit = CASE WHEN $7 THEN EXCLUDED.business_unit ELSE app_account_settings.business_unit END,
      cost_center   = CASE WHEN $8 THEN EXCLUDED.cost_center   ELSE app_account_settings.cost_center   END,
      environment   = CASE WHEN $9 THEN EXCLUDED.environment   ELSE app_account_settings.environment   END,
      updated_at = now()
    `,
    [
      accountId,
      limpar(dados.alias),
      limpar(dados.businessUnit),
      limpar(dados.costCenter),
      limpar(dados.environment),
      informado("alias"),
      informado("businessUnit"),
      informado("costCenter"),
      informado("environment"),
    ],
  );

  // A releitura passa por `lerConta` -- a mesma que a criacao usa. Duas copias
  // da mesma consulta divergiriam na primeira coluna acrescentada ao SELECAO.
  return lerConta(accountId);
}


// ------------------------------------------------- criacao de conta no portal

export type NovaConta = {
  accountId: string;
  provider: "ovh";
  accountName: string;
  businessUnit?: string | null;
  costCenter?: string | null;
  environment?: string | null;
};

/**
 * Cria uma conta em `cloud_accounts` -- hoje somente OVH.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SO OVH
 *
 * Conta AWS nao se CADASTRA: ela existe porque entregou custo no CUR, e o
 * identificador dela e o numero de 12 digitos que a AWS emitiu. Deixar alguem
 * digitar um account_id AWS aqui criaria uma linha que nunca casa com dado
 * nenhum -- uma conta fantasma no filtro do painel, somando zero para sempre.
 * Ver a pendencia de auto-discovery em docs/CONTAS-CLOUD.md.
 *
 * A conta OVH e o oposto: o `account_id` e uma etiqueta escolhida por nos
 * (`ovh-cliente-ca`), usada para amarrar credencial, jobs e custo. Ela precisa
 * existir ANTES da primeira coleta, porque e ela que o collector procura.
 *
 * ---------------------------------------------------------------------------
 * INSERT ... DO NOTHING, E NAO DO UPDATE
 *
 * Criar e diferente de editar. `DO UPDATE` transformaria um cadastro repetido --
 * dois cliques, duas abas -- numa sobrescrita silenciosa do que ja estava la,
 * inclusive de uma conta AWS existente que tivesse o mesmo id. Zero linhas
 * devolvidas significa "ja existe", e o chamador transforma isso em erro com
 * nome proprio.
 */
export async function criarConta(nova: NovaConta): Promise<ContaAdministravel> {
  const criada = await queryOpcional<{ account_id: string }>(
    `INSERT INTO cloud_accounts (account_id, account_name, provider, active)
     VALUES ($1, $2, $3, true)
         ON CONFLICT (account_id) DO NOTHING
      RETURNING account_id`,
    [nova.accountId, nova.accountName, nova.provider],
  );

  if (criada === null) {
    throw new ErroDeApi(
      "conflito",
      `Ja existe uma conta com o identificador "${nova.accountId}". ` +
        "Escolha outro, ou edite a conta existente na lista.",
    );
  }

  // Metadados vao para `app_account_settings`, o mesmo lugar em que a edicao os
  // grava -- e nao para as colunas homonimas de `cloud_accounts`. Duas origens
  // para o mesmo campo fariam a conta nova exibir um valor que o formulario de
  // edicao nao consegue alterar.
  const limpar = (v: string | null | undefined) => {
    if (v === undefined || v === null) return null;
    const s = v.trim();
    return s === "" ? null : s;
  };

  await query(
    `INSERT INTO app_account_settings (account_id, alias, business_unit, cost_center, environment)
     VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id) DO UPDATE SET
           alias         = EXCLUDED.alias,
           business_unit = EXCLUDED.business_unit,
           cost_center   = EXCLUDED.cost_center,
           environment   = EXCLUDED.environment,
           updated_at    = now()`,
    [
      nova.accountId,
      limpar(nova.accountName),
      limpar(nova.businessUnit),
      limpar(nova.costCenter),
      limpar(nova.environment),
    ],
  );

  return lerConta(nova.accountId);
}

/** Uma conta pelo id, ja com a cascata de nome resolvida. */
export async function lerConta(accountId: string): Promise<ContaAdministravel> {
  const amarracao = { colunaId: "a.account_id", cadastro: "a" };
  const linha = await queryOne<LinhaConta>(
    `SELECT ${SELECAO},
            ${expressaoNomeDaConta(true, amarracao)} AS nome_exibicao
       FROM cloud_accounts a
       ${joinAlias(true, amarracao)}
      WHERE a.account_id = $1`,
    [accountId],
  );
  return mapear(linha);
}

/**
 * Contas AWS que TEM custo importado mas NAO estao em `cloud_accounts`.
 *
 * ---------------------------------------------------------------------------
 * ISTO MEDE UMA LACUNA REAL DO PIPELINE
 *
 * O ETL nao cadastra conta. `scripts/onboard-cur-account.sh` diz isso na propria
 * saida ("o ETL nao cadastra contas; a aplicacao faz LEFT JOIN em
 * cloud_accounts") e imprime um INSERT para um humano executar. Se ninguem
 * executar, a conta some das telas que leem o cadastro -- Contas Cloud,
 * Faturamento, filtros -- enquanto o custo dela entra normalmente nos totais.
 *
 * O sintoma e cruel: o numero do painel sobe e nao ha conta a que atribui-lo.
 *
 * Esta consulta nao CORRIGE nada -- inserir sozinho seria adivinhar o alias e o
 * provider de uma conta que ninguem cadastrou. Ela apenas expoe a divergencia na
 * tela, para que o passo manual pare de ser invisivel.
 */
export async function contasComCustoSemCadastro(): Promise<string[]> {
  const linhas = await query<{ account_id: string }>(
    `SELECT DISTINCT d.account_id
       FROM aws_daily_costs d
       LEFT JOIN cloud_accounts a ON a.account_id = d.account_id
      WHERE a.account_id IS NULL
      ORDER BY d.account_id
      LIMIT 50`,
  );
  return linhas.map((l) => l.account_id);
}
