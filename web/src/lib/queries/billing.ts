import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import type { FonteStatus, StatusPagamento } from "@/lib/billing/pagamento";
import { query, queryOne } from "@/lib/database";

import { aliasDisponivel, expressaoNomeDaConta, joinAlias } from "./alias-conta";

/**
 * Faturamento por conta AWS: fechamento, vencimento e situacao de pagamento.
 *
 * A LISTA sai sempre de `cloud_accounts` -- nenhum id de conta e fixo no
 * codigo. `app_account_settings` so acrescenta o que uma PESSOA configurou, por
 * LEFT JOIN: conta sem configuracao aparece igual, com os campos vazios e o
 * aviso de que falta configurar.
 *
 * NADA AQUI E DEDUZIDO DE CUSTO. As tabelas `aws_*` nao participam de nenhuma
 * consulta deste arquivo, e isso e proposital: elas dizem o que foi consumido e
 * jamais o que foi pago. Cruzar as duas coisas produziria um "pago" derivado de
 * evidencia que nao existe.
 */

// -------------------------------------------- disponibilidade da migracao 004

const TEMPO_DE_REPESCAGEM_MS = 30_000;

let colunasExistem: boolean | null = null;
let ultimaChecagem = 0;

/**
 * A migracao 004 rodou neste banco?
 *
 * Mesma politica das entregas anteriores: positivo definitivo, negativo
 * reconferido a cada 30s -- aplicar a migracao com o portal no ar passa a valer
 * sozinho, sem reinicio.
 *
 * Aqui a degradacao TIRA a tela de faturamento do ar, com mensagem dizendo o que
 * falta. E o comportamento certo: sem as colunas nao ha como exibir situacao de
 * pagamento, e inventar um padrao ("em dia") seria exatamente o defeito que esta
 * entrega existe para corrigir.
 */
export async function faturamentoDisponivel(): Promise<boolean> {
  if (colunasExistem === true) return true;

  const agora = Date.now();
  if (colunasExistem === false && agora - ultimaChecagem < TEMPO_DE_REPESCAGEM_MS) {
    return false;
  }

  const linhas = await query<{ existe: boolean }>(
    `SELECT count(*) = 8 AS existe
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'app_account_settings'
        AND column_name IN ('invoice_due_day', 'invoice_notification_days_before',
                            'billing_contact_email', 'payment_status_source',
                            'payment_reference', 'payment_due_date',
                            'payment_paid_at', 'payment_notes')`,
  );
  colunasExistem = linhas[0]?.existe ?? false;
  ultimaChecagem = agora;
  return colunasExistem;
}

/** Zera o cache. Existe para o teste; nao chame em codigo de producao. */
export function esquecerDisponibilidadeDeFaturamento(): void {
  colunasExistem = null;
  ultimaChecagem = 0;
}

function exigirMigracao(): never {
  throw new ErroDeApi(
    "banco-indisponivel",
    "As colunas de faturamento ainda nao existem neste banco. " +
      "Rode scripts/migrations/004-billing-fechamento-pagamento.sql.",
  );
}

// -------------------------------------------------------------------- leitura

export type ContaFaturamento = {
  accountId: string;
  nomeExibicao: string;
  /** O que o cadastro afirma. Aparece junto do alias, sempre. */
  accountName: string;
  ativa: boolean;
  invoiceCloseDay: number | null;
  invoiceDueDay: number | null;
  /** Nunca `null`: conta sem linha de configuracao herda o padrao de 5 dias. */
  invoiceNotificationDaysBefore: number;
  billingContactEmail: string | null;
  paymentStatus: StatusPagamento | null;
  paymentStatusSource: FonteStatus;
  paymentReference: string | null;
  paymentDueDate: string | null;
  /** Instante exato do pagamento, para quem precisar do dado cru. */
  paymentPaidAt: string | null;
  /** A DATA do pagamento no fuso da aplicacao -- e o que a tela mostra. */
  paymentPaidDate: string | null;
  paymentNotes: string | null;
  paymentStatusUpdatedAt: string | null;
  configurada: boolean;
};

/**
 * `$${posTz}` recebe o APP_TZ. Ele existe por causa de UMA coluna:
 * `payment_paid_at` e `timestamptz`, e o banco esta em UTC. Lida sem converter,
 * uma data gravada como "10/08 meio-dia em Sao Paulo" volta como 10/08 15:00
 * UTC -- ainda dia 10, tudo bem. Mas se alguem gravasse a meia-noite, voltaria
 * como dia 09 as 21:00 para quem le em Sao Paulo, e a tela mostraria o
 * pagamento um dia antes do que aconteceu.
 *
 * Duas defesas, e as duas sao necessarias: a gravacao ancora no MEIO-DIA do
 * fuso da aplicacao (longe das duas bordas do dia), e a leitura converte de
 * volta para o mesmo fuso antes de extrair a data.
 */
const SELECAO = (posTz: number) => `
  a.account_id,
  a.account_name,
  a.active,
  s.invoice_close_day,
  s.invoice_due_day,
  to_char(s.payment_paid_at AT TIME ZONE $${posTz}, 'YYYY-MM-DD') AS payment_paid_date,
  -- LEFT JOIN devolve NULL para conta sem linha de configuracao; o DEFAULT da
  -- coluna so vale na insercao. O coalesce aqui e o que faz o padrao de 5 dias
  -- valer tambem para quem nunca abriu a tela.
  coalesce(s.invoice_notification_days_before, 5) AS invoice_notification_days_before,
  s.billing_contact_email,
  s.payment_status,
  coalesce(s.payment_status_source, 'unknown') AS payment_status_source,
  s.payment_reference,
  to_char(s.payment_due_date, 'YYYY-MM-DD') AS payment_due_date,
  s.payment_paid_at,
  s.payment_notes,
  s.payment_status_updated_at,
  (s.account_id IS NOT NULL) AS configurada
`;

type LinhaFaturamento = {
  account_id: string;
  account_name: string;
  active: boolean | null;
  invoice_close_day: number | null;
  invoice_due_day: number | null;
  invoice_notification_days_before: number;
  billing_contact_email: string | null;
  payment_status: string | null;
  payment_status_source: string;
  payment_reference: string | null;
  payment_due_date: string | null;
  payment_paid_at: Date | null;
  payment_paid_date: string | null;
  payment_notes: string | null;
  payment_status_updated_at: Date | null;
  configurada: boolean;
  nome_exibicao: string;
};

const FONTES: FonteStatus[] = ["manual", "aws_invoicing", "unknown"];
const STATUS: StatusPagamento[] = ["unknown", "pending", "paid", "overdue", "manual_review"];

function mapear(l: LinhaFaturamento): ContaFaturamento {
  return {
    accountId: l.account_id,
    nomeExibicao: l.nome_exibicao,
    accountName: l.account_name,
    ativa: l.active ?? false,
    invoiceCloseDay: l.invoice_close_day,
    invoiceDueDay: l.invoice_due_day,
    invoiceNotificationDaysBefore: Number(l.invoice_notification_days_before),
    billingContactEmail: l.billing_contact_email,
    // O CHECK do banco ja garante o dominio; a conferencia aqui protege o tipo
    // de uma linha vinda de um banco onde a constraint tenha sido removida.
    paymentStatus: STATUS.includes(l.payment_status as StatusPagamento)
      ? (l.payment_status as StatusPagamento)
      : null,
    paymentStatusSource: FONTES.includes(l.payment_status_source as FonteStatus)
      ? (l.payment_status_source as FonteStatus)
      : "unknown",
    paymentReference: l.payment_reference,
    paymentDueDate: l.payment_due_date,
    paymentPaidAt: l.payment_paid_at?.toISOString() ?? null,
    paymentPaidDate: l.payment_paid_date,
    paymentNotes: l.payment_notes,
    paymentStatusUpdatedAt: l.payment_status_updated_at?.toISOString() ?? null,
    configurada: l.configurada,
  };
}

export async function listarFaturamento(tz: string): Promise<ContaFaturamento[]> {
  if (!(await faturamentoDisponivel())) exigirMigracao();

  // A tela de faturamento nomeia a conta pela MESMA cascata do resto do portal
  // (alias -> account_name -> conta-<id>). Um nome diferente aqui faria a mesma
  // conta parecer duas entre a tela de custo e a de fatura.
  const amarracao = { colunaId: "a.account_id", cadastro: "a", cfg: "s" };
  const nome = expressaoNomeDaConta(await aliasDisponivel(), amarracao);

  const linhas = await query<LinhaFaturamento>(
    `SELECT ${SELECAO(1)}, ${nome} AS nome_exibicao
       FROM cloud_accounts a
       ${joinAlias(true, amarracao)}
      ORDER BY ${nome} ASC, a.account_id ASC`,
    [tz],
  );

  return linhas.map(mapear);
}

async function lerUma(accountId: string, tz: string): Promise<ContaFaturamento> {
  const amarracao = { colunaId: "a.account_id", cadastro: "a", cfg: "s" };
  const nome = expressaoNomeDaConta(await aliasDisponivel(), amarracao);

  const linha = await queryOne<LinhaFaturamento>(
    `SELECT ${SELECAO(2)}, ${nome} AS nome_exibicao
       FROM cloud_accounts a
       ${joinAlias(true, amarracao)}
      WHERE a.account_id = $1`,
    [accountId, tz],
  );

  return mapear(linha);
}

async function exigirConta(accountId: string): Promise<void> {
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
}

// -------------------------------------------------- escrita: ciclo da fatura

export type ConfiguracaoDeFaturaEntrada = {
  invoiceCloseDay?: number | null;
  invoiceDueDay?: number | null;
  invoiceNotificationDaysBefore?: number;
  billingContactEmail?: string | null;
};

/**
 * Grava o CICLO da fatura de uma conta.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` porque a linha pode nao existir ainda, e o
 * `CASE WHEN informado` faz o PATCH ser parcial de verdade: campo que a tela nao
 * mandou preserva o valor atual em vez de virar NULL. Sem isso, editar so o dia
 * de vencimento apagaria o alias da conta -- que mora na mesma linha.
 */
export async function salvarConfiguracaoDeFatura(
  accountId: string,
  dados: ConfiguracaoDeFaturaEntrada,
  tz: string,
): Promise<ContaFaturamento> {
  if (!(await faturamentoDisponivel())) exigirMigracao();
  await exigirConta(accountId);

  const informado = (chave: keyof ConfiguracaoDeFaturaEntrada) => Object.hasOwn(dados, chave);
  const limpar = (v: string | null | undefined) =>
    v === undefined || v === null || v.trim() === "" ? null : v.trim();

  await query(
    `
    INSERT INTO app_account_settings (
      account_id, invoice_close_day, invoice_due_day,
      invoice_notification_days_before, billing_contact_email
    )
    VALUES ($1, $2, $3, coalesce($4, 5), $5)
    ON CONFLICT (account_id) DO UPDATE SET
      invoice_close_day     = CASE WHEN $6 THEN EXCLUDED.invoice_close_day     ELSE app_account_settings.invoice_close_day     END,
      invoice_due_day       = CASE WHEN $7 THEN EXCLUDED.invoice_due_day       ELSE app_account_settings.invoice_due_day       END,
      invoice_notification_days_before =
        CASE WHEN $8 THEN EXCLUDED.invoice_notification_days_before ELSE app_account_settings.invoice_notification_days_before END,
      billing_contact_email = CASE WHEN $9 THEN EXCLUDED.billing_contact_email ELSE app_account_settings.billing_contact_email END,
      updated_at = now()
    `,
    [
      accountId,
      dados.invoiceCloseDay ?? null,
      dados.invoiceDueDay ?? null,
      dados.invoiceNotificationDaysBefore ?? null,
      limpar(dados.billingContactEmail),
      informado("invoiceCloseDay"),
      informado("invoiceDueDay"),
      informado("invoiceNotificationDaysBefore"),
      informado("billingContactEmail"),
    ],
  );

  return lerUma(accountId, tz);
}

// ---------------------------------------------------- escrita: pagamento

export type StatusDePagamentoEntrada = {
  paymentStatus: StatusPagamento | null;
  paymentReference?: string | null;
  paymentDueDate?: string | null;
  paymentPaidAt?: string | null;
  paymentNotes?: string | null;
};

/**
 * Grava a SITUACAO DE PAGAMENTO de uma conta.
 *
 * A fonte e cravada em `'manual'` AQUI, e nao recebida da tela. Isso e uma
 * trava, nao uma economia de campo: se a fonte viesse do cliente, bastaria uma
 * requisicao forjada -- ou um dia de pressa -- para uma afirmacao digitada a mao
 * aparecer na tela com o selo de "AWS Invoicing". A unica coisa que pode
 * escrever `aws_invoicing` e uma integracao validada, que ainda nao existe
 * (ver docs/AWS-INVOICING.md).
 *
 * Limpar o status devolve a fonte para `'unknown'`: sem afirmacao nao ha autor.
 */
export async function salvarStatusDePagamento(
  accountId: string,
  dados: StatusDePagamentoEntrada,
  autor: string,
  tz: string,
): Promise<ContaFaturamento> {
  if (!(await faturamentoDisponivel())) exigirMigracao();
  await exigirConta(accountId);

  const informado = (chave: keyof StatusDePagamentoEntrada) => Object.hasOwn(dados, chave);
  const limpar = (v: string | null | undefined) =>
    v === undefined || v === null || v.trim() === "" ? null : v.trim();

  const fonte: FonteStatus = dados.paymentStatus === null ? "unknown" : "manual";

  await query(
    `
    INSERT INTO app_account_settings (
      account_id, payment_status, payment_status_source, payment_reference,
      payment_due_date, payment_paid_at, payment_notes, payment_status_updated_at
    )
    -- A data de pagamento chega como "AAAA-MM-DD" e e ancorada no MEIO-DIA do
    -- fuso da aplicacao. Meia-noite ficaria a uma hora da borda do dia: em UTC-3
    -- ela volta como 21:00 do dia ANTERIOR, e a tela mostraria o pagamento um
    -- dia antes do que aconteceu. Meio-dia esta a doze horas de qualquer borda.
    VALUES ($1, $2, $3, $4, $5::date,
            (($6::date + time '12:00') AT TIME ZONE $12), $7, now())
    ON CONFLICT (account_id) DO UPDATE SET
      payment_status        = EXCLUDED.payment_status,
      payment_status_source = EXCLUDED.payment_status_source,
      payment_reference = CASE WHEN $8  THEN EXCLUDED.payment_reference ELSE app_account_settings.payment_reference END,
      payment_due_date  = CASE WHEN $9  THEN EXCLUDED.payment_due_date  ELSE app_account_settings.payment_due_date  END,
      payment_paid_at   = CASE WHEN $10 THEN EXCLUDED.payment_paid_at   ELSE app_account_settings.payment_paid_at   END,
      payment_notes     = CASE WHEN $11 THEN EXCLUDED.payment_notes     ELSE app_account_settings.payment_notes     END,
      -- O carimbo so anda quando a SITUACAO muda de fato. Reescrever a data a
      -- cada salvamento faria "atualizado ha 2 minutos" mentir sobre um campo
      -- que ninguem tocou -- e numa tela de auditoria isso e o pior tipo de
      -- ruido: o que parece evidencia recente e so o ultimo clique em salvar.
      payment_status_updated_at = CASE
        WHEN app_account_settings.payment_status IS DISTINCT FROM EXCLUDED.payment_status
          THEN now()
        ELSE app_account_settings.payment_status_updated_at
      END,
      updated_at = now()
    `,
    [
      accountId,
      dados.paymentStatus,
      fonte,
      limpar(dados.paymentReference),
      limpar(dados.paymentDueDate),
      limpar(dados.paymentPaidAt),
      // Quem registrou fica na propria observacao: a tabela nao tem coluna de
      // autor, e acrescentar uma sem historico daria a impressao de auditoria
      // que ela nao teria -- guardaria apenas o ULTIMO autor.
      registrarAutor(limpar(dados.paymentNotes), autor, informado("paymentNotes")),
      informado("paymentReference"),
      informado("paymentDueDate"),
      informado("paymentPaidAt"),
      informado("paymentNotes"),
      tz,
    ],
  );

  return lerUma(accountId, tz);
}

/** Acrescenta a assinatura de quem escreveu a observacao, quando ha observacao. */
function registrarAutor(notas: string | null, autor: string, informado: boolean): string | null {
  if (!informado || notas === null) return notas;
  return `${notas}\n— ${autor}`;
}
