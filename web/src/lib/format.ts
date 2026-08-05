/**
 * Formatacao para o publico brasileiro.
 *
 * IMPORTANTE: os valores do CUR/Data Export chegam em USD. Nao existe regra
 * oficial de conversao para BRL definida (ver docs/documentacao_finops_aws_dashboard.docx,
 * secao 14). Enquanto nao houver, a interface exibe USD e nunca converte por
 * conta propria -- inventar uma taxa produziria numero financeiro errado.
 */

const usd = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const percentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Converte numeric/decimal do Postgres (que o driver devolve como string) em number. */
export function toNumber(valor: unknown): number {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function formatUSD(valor: unknown): string {
  return usd.format(toNumber(valor));
}

export function formatUSDCompacto(valor: unknown): string {
  return usdCompacto.format(toNumber(valor));
}

export function formatInteiro(valor: unknown): string {
  return inteiro.format(toNumber(valor));
}

/** Recebe a variacao em fracao (0.12 => +12,0%). */
export function formatVariacao(fracao: number | null): string {
  if (fracao === null || !Number.isFinite(fracao)) return "—";
  return percentual.format(fracao);
}

export function formatData(valor: Date | string | null, timeZone: string): string {
  if (!valor) return "—";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone }).format(d);
}

export function formatDataHora(valor: Date | string | null, timeZone: string): string {
  if (!valor) return "—";
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(d);
}
