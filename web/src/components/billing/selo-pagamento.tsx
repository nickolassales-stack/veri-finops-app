import {
  ROTULO_FONTE,
  ROTULO_STATUS,
  type FonteStatus,
  type StatusPagamento,
} from "@/lib/billing/pagamento";

/**
 * Situacao de pagamento, com a FONTE colada nela.
 *
 * As duas informacoes aparecem juntas e nunca separadas, porque "Pago" sozinho
 * e uma afirmacao sem autor. Numa tela que alguem consulta para decidir se paga
 * de novo, quem afirmou vale tanto quanto o que foi afirmado -- e hoje a
 * resposta e sempre "uma pessoa digitou", nunca a AWS.
 *
 * A cor nao carrega o significado sozinha: o rotulo esta escrito por extenso e
 * ha um simbolo com forma propria. Verde e vinho sao exatamente o par que quem
 * tem deuteranopia nao separa.
 */

const ESTILO: Record<StatusPagamento, { classe: string; simbolo: string }> = {
  paid: {
    classe: "border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro",
    simbolo: "✓",
  },
  pending: {
    classe: "border-veri-mostarda/60 bg-veri-amarelo/20 text-veri-verde-escuro",
    simbolo: "•",
  },
  overdue: { classe: "border-veri-vinho/50 bg-veri-vinho/10 text-veri-vinho", simbolo: "✕" },
  manual_review: {
    classe: "border-veri-verde-claro/60 bg-veri-verde-claro/12 text-veri-verde-escuro",
    simbolo: "◐",
  },
  unknown: { classe: "border-veri-offwhite bg-veri-offwhite text-texto-suave", simbolo: "–" },
};

export function SeloPagamento({
  status,
  fonte,
}: {
  status: StatusPagamento | null;
  fonte: FonteStatus;
}) {
  const efetivo: StatusPagamento = status ?? "unknown";
  const { classe, simbolo } = ESTILO[efetivo];

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${classe}`}
      >
        <span aria-hidden className="veri-numero">
          {simbolo}
        </span>
        {ROTULO_STATUS[efetivo]}
      </span>
      <span className="text-xs text-texto-suave">
        {efetivo === "unknown" ? "sem registro" : ROTULO_FONTE[fonte]}
      </span>
    </span>
  );
}
