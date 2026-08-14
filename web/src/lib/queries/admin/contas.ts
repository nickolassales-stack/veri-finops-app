import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import { query, queryOne } from "@/lib/database";

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
  a.environment    AS cad_environment
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

export type AtualizacaoDeConta = {
  alias?: string | null;
  businessUnit?: string | null;
  costCenter?: string | null;
  environment?: string | null;
  invoiceCloseDay?: number | null;
  paymentStatus?: string | null;
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
      account_id, alias, business_unit, cost_center, environment,
      invoice_close_day, payment_status, payment_status_updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END)
    ON CONFLICT (account_id) DO UPDATE SET
      alias             = CASE WHEN $9  THEN EXCLUDED.alias             ELSE app_account_settings.alias             END,
      business_unit     = CASE WHEN $10 THEN EXCLUDED.business_unit     ELSE app_account_settings.business_unit     END,
      cost_center       = CASE WHEN $11 THEN EXCLUDED.cost_center       ELSE app_account_settings.cost_center       END,
      environment       = CASE WHEN $12 THEN EXCLUDED.environment       ELSE app_account_settings.environment       END,
      invoice_close_day = CASE WHEN $13 THEN EXCLUDED.invoice_close_day ELSE app_account_settings.invoice_close_day END,
      payment_status    = CASE WHEN $8  THEN EXCLUDED.payment_status    ELSE app_account_settings.payment_status    END,
      -- O carimbo so anda quando a SITUACAO muda de fato. Reescrever a data a
      -- cada salvamento faria "atualizado ha 2 minutos" mentir sobre um campo
      -- que ninguem tocou.
      payment_status_updated_at = CASE
        WHEN $8 AND app_account_settings.payment_status IS DISTINCT FROM EXCLUDED.payment_status
          THEN now()
        ELSE app_account_settings.payment_status_updated_at
      END,
      updated_at = now()
    `,
    [
      accountId,
      limpar(dados.alias),
      limpar(dados.businessUnit),
      limpar(dados.costCenter),
      limpar(dados.environment),
      dados.invoiceCloseDay ?? null,
      limpar(dados.paymentStatus),
      informado("paymentStatus"),
      informado("alias"),
      informado("businessUnit"),
      informado("costCenter"),
      informado("environment"),
      informado("invoiceCloseDay"),
    ],
  );

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
