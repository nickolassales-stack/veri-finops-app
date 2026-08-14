/**
 * Vocabulario de pagamento -- a lista fechada de situacoes e de FONTES.
 *
 * ARQUIVO PURO, sem nenhuma dependencia. Vale a mesma razao do antigo
 * `lib/admin/pagamentos.ts` que ele substitui: estas constantes sao usadas pelo
 * esquema Zod (servidor) E pelo formulario (cliente), e o formulario nao pode
 * arrastar `node:crypto` para o bundle do navegador por tabela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `unknown` E O PADRAO
 *
 * Porque e a verdade. O portal le CUR/Data Export, e o CUR responde o que foi
 * CONSUMIDO -- nunca o que foi PAGO. Nao existe, em nenhuma tabela deste banco,
 * informacao que autorize dizer que uma fatura foi quitada.
 *
 * Um padrao otimista ('em dia', como na versao anterior deste campo) faria a
 * tela afirmar, para toda conta recem-cadastrada, algo que ninguem verificou --
 * e o unico jeito de descobrir o erro seria pela cobranca.
 * ---------------------------------------------------------------------------
 */

export const STATUS_PAGAMENTO = [
  "unknown",
  "pending",
  "paid",
  "overdue",
  "manual_review",
] as const;

export type StatusPagamento = (typeof STATUS_PAGAMENTO)[number];

export const ROTULO_STATUS: Record<StatusPagamento, string> = {
  unknown: "Não informado",
  pending: "Pendente",
  paid: "Pago",
  overdue: "Vencido",
  manual_review: "Revisão manual",
};

export const DESCRICAO_STATUS: Record<StatusPagamento, string> = {
  unknown: "Ninguém afirmou nada sobre esta fatura. É o estado inicial de toda conta.",
  pending: "A fatura fechou e o pagamento ainda não foi confirmado.",
  paid: "Alguém confirmou o pagamento. Exige a data em que ele ocorreu.",
  overdue: "Passou do vencimento sem confirmação de pagamento.",
  manual_review: "Precisa de análise humana: divergência, contestação ou acordo à parte.",
};

/**
 * De onde veio a afirmacao.
 *
 * E a informacao que impede "Pago" de ser uma frase sem autor. Numa tela de
 * faturamento, quem digitou importa tanto quanto o que foi digitado.
 */
export const FONTES_STATUS = ["manual", "aws_invoicing", "unknown"] as const;

export type FonteStatus = (typeof FONTES_STATUS)[number];

export const ROTULO_FONTE: Record<FonteStatus, string> = {
  manual: "Registro manual",
  aws_invoicing: "AWS Invoicing",
  unknown: "Sem origem definida",
};

/**
 * Situacoes que uma PESSOA pode escolher na tela.
 *
 * `unknown` fica de fora: ele e o estado de quem nunca disse nada, e nao uma
 * escolha. Voltar deliberadamente para "não informado" e apagar a afirmacao, o
 * que a tela oferece como limpar o campo -- caminho separado, e nao um item de
 * lista que se seleciona por engano.
 */
export const STATUS_SELECIONAVEIS: readonly StatusPagamento[] = [
  "pending",
  "paid",
  "overdue",
  "manual_review",
];

/** `paid` sem data de pagamento e afirmacao sem evidencia. O banco tambem recusa. */
export function exigeDataDePagamento(status: StatusPagamento): boolean {
  return status === "paid";
}
