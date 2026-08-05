import type { ReactNode } from "react";

/**
 * Numero-heroi. Nao e grafico: um valor unico se le melhor como texto grande.
 * Todo texto usa tokens de tinta -- nunca a cor de uma serie.
 */
export function Kpi({
  rotulo,
  valor,
  apoio,
  destaque,
}: {
  rotulo: string;
  valor: string;
  apoio?: ReactNode;
  /** Realca o indicador principal do painel. */
  destaque?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-5",
        destaque
          ? "border-veri-verde/40 bg-veri-verde/10"
          : "border-veri-offwhite bg-veri-branco",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-veri-verde-escuro/60">
        {rotulo}
      </p>
      <p
        className={[
          "veri-numero veri-display mt-2 text-veri-verde-escuro",
          destaque ? "text-4xl" : "text-3xl",
        ].join(" ")}
      >
        {valor}
      </p>
      {apoio && (
        <div className="mt-2 text-xs leading-relaxed text-veri-verde-escuro/70">
          {apoio}
        </div>
      )}
    </div>
  );
}

/** Variacao percentual. Sempre acompanhada de rotulo textual, nunca so cor. */
export function Variacao({
  fracao,
  comparavel,
}: {
  fracao: number | null;
  comparavel: boolean;
}) {
  if (fracao === null) {
    return <span className="text-veri-verde-escuro/60">sem base de comparacao</span>;
  }

  if (!comparavel) {
    return (
      <span className="text-veri-verde-escuro/70">
        variacao nao comparavel — o conjunto de contas com dado mudou entre os meses
      </span>
    );
  }

  const subiu = fracao > 0;
  const pct = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(fracao);

  return (
    <span className="veri-numero">
      {/* Custo subindo e o caso de atencao; caindo e realizacao. Semantica do
          brandbook: mostarda = atencao, verde = realizacao. Sempre com o texto
          ao lado, nunca cor isolada. */}
      <span className={subiu ? "text-veri-vinho" : "text-veri-verde-escuro"}>
        {pct}
      </span>{" "}
      <span className="text-veri-verde-escuro/70">
        {subiu ? "acima" : "abaixo"} do mes anterior
      </span>
    </span>
  );
}
