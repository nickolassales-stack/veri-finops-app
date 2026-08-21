"use client";

import { formatUSD } from "@/lib/format";

type ItemTooltip = {
  name?: string;
  value?: number | string;
  payload?: Record<string, unknown>;
};

/**
 * Tooltip padrao. Texto sempre em tokens de tinta (nunca na cor da serie);
 * a identidade vem do marcador colorido ao lado.
 */
export function ChartTooltip({
  active,
  label,
  payload,
  rotuloExtra,
}: {
  active?: boolean;
  label?: string | number;
  payload?: ItemTooltip[];
  /** Texto adicional por ponto, ex. "lancado adiantado". */
  rotuloExtra?: (payload: Record<string, unknown>) => string | null;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-veri-offwhite bg-veri-branco px-3 py-2 shadow-md">
      <p className="text-xs font-semibold text-veri-verde-escuro">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((item, i) => {
          const extra = item.payload && rotuloExtra ? rotuloExtra(item.payload) : null;
          return (
            <li key={i} className="text-xs text-veri-verde-escuro">
              <span className="veri-numero font-medium">{formatUSD(item.value)}</span>
              {item.name && <span className="text-texto-suave"> · {item.name}</span>}
              {extra && (
                <span className="ml-1 text-texto-suave">({extra})</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
