import { z } from "zod";

import { STATUS_PAGAMENTO } from "@/lib/billing/pagamento";

/**
 * Validacao de tudo que a area de faturamento recebe.
 *
 * `.strict()` nos dois esquemas: campo desconhecido e ERRO, nao algo a ignorar
 * em silencio. Um PATCH com `{paymentPaid: true}` em vez de `{paymentStatus:
 * "paid"}` deve falhar dizendo o que esta errado, e nao responder 200 sem ter
 * mudado nada -- que e o jeito mais rapido de alguem concluir que a tela esta
 * quebrada e digitar de novo.
 *
 * Nenhum valor daqui vira nome de coluna ou trecho de SQL: todos entram por
 * placeholder. A validacao serve para dar limite e erro claro, e para impor as
 * REGRAS DE NEGOCIO que o banco tambem impoe -- ver `paid` abaixo.
 */

const diaDoMes = (rotulo: string) =>
  z.union([
    z
      .number({ error: `${rotulo} deve ser um número inteiro.` })
      .int()
      .min(1, `${rotulo} deve estar entre 1 e 31.`)
      .max(31, `${rotulo} deve estar entre 1 e 31.`),
    z.null(),
  ]);

/** "AAAA-MM-DD" e uma data que EXISTE -- 31/02 nao passa. */
const dataDeCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .refine((v) => {
    const [ano, mes, dia] = v.split("-").map(Number);
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return (
      d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
    );
  }, "Data inexistente no calendário.");

// ------------------------------------------------------- ciclo da fatura

export const esquemaConfiguracaoFatura = z
  .object({
    invoiceCloseDay: diaDoMes("O dia de fechamento").optional(),
    invoiceDueDay: diaDoMes("O dia de vencimento").optional(),
    // 0 e valido: significa "avise apenas no dia do fechamento". O teto de 30
    // existe porque avisar com 60 dias de antecedencia sobre um ciclo mensal
    // significa avisar sempre -- e aviso permanente e ruido, nao aviso.
    invoiceNotificationDaysBefore: z
      .number({ error: "A antecedência do aviso deve ser um número inteiro." })
      .int()
      .min(0, "A antecedência deve estar entre 0 e 30 dias.")
      .max(30, "A antecedência deve estar entre 0 e 30 dias.")
      .optional(),
    billingContactEmail: z
      .union([
        z
          .string()
          .trim()
          .max(320)
          // Sem `z.email()`: o endereco e digitado por quem administra e um
          // validador rigido recusa formas legitimas (subdominio interno, TLD
          // novo). O que importa e ter arroba e nao ter espaco.
          .refine(
            (v) => v === "" || /^[^\s@]+@[^\s@]+$/.test(v),
            "E-mail de contato inválido.",
          ),
        z.null(),
      ])
      .transform((v) => (v === null || v === "" ? null : v))
      .optional(),
  })
  .strict()
  .refine(
    (o) => Object.keys(o).length > 0,
    "Informe ao menos um campo para alterar.",
  );

export type ConfiguracaoFaturaEntrada = z.infer<typeof esquemaConfiguracaoFatura>;

// ---------------------------------------------------------------- pagamento

/**
 * `paymentStatusSource` NAO faz parte deste esquema, e a ausencia e a regra.
 *
 * A fonte e cravada como `'manual'` no servidor. Se ela viesse do cliente,
 * bastaria uma requisicao forjada para uma afirmacao digitada a mao aparecer
 * com o selo de "AWS Invoicing" -- e o selo existe justamente para dizer quem
 * afirmou.
 */
export const esquemaStatusPagamento = z
  .object({
    // `null` limpa a afirmacao e devolve a fonte para 'unknown'.
    paymentStatus: z.union([z.enum(STATUS_PAGAMENTO), z.null()]),
    paymentReference: z.union([z.string().trim().max(120), z.null()]).optional(),
    paymentDueDate: z.union([dataDeCalendario, z.null()]).optional(),
    paymentPaidAt: z.union([dataDeCalendario, z.null()]).optional(),
    paymentNotes: z.union([z.string().trim().max(2000), z.null()]).optional(),
  })
  .strict()
  .refine(
    // A MESMA regra que o CHECK do banco impoe, adiantada para virar erro
    // legivel em vez de 500. "Pago" sem data e afirmacao sem evidencia: o
    // sistema inteiro existe para nao dizer que algo foi pago sem que alguem
    // saiba QUANDO.
    (o) => o.paymentStatus !== "paid" || (o.paymentPaidAt ?? null) !== null,
    {
      error: 'Para marcar como "Pago" é obrigatório informar a data do pagamento.',
      path: ["paymentPaidAt"],
    },
  );

export type StatusPagamentoEntrada = z.infer<typeof esquemaStatusPagamento>;
