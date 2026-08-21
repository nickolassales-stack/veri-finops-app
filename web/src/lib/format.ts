/**
 * Formatacao para o publico brasileiro.
 *
 * IMPORTANTE: os valores do CUR/Data Export chegam em USD, e USD e o valor
 * OFICIAL -- e assim que ele e somado, armazenado e exibido como numero
 * principal.
 *
 * A partir da integracao com o Banco Central existe tambem uma estimativa em
 * BRL, e ela e apenas indicativa: a PTAX de um dia nao e a taxa que a fatura
 * aplicou (que depende da data de fechamento do cambio, do spread do emissor e
 * do IOF). Por isso `formatBRLEstimado` prefixa o valor com "~" e a interface
 * o exibe sempre em tinta secundaria, subordinado ao numero em USD.
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

/**
 * Valor em uma moeda ARBITRARIA, com o codigo sempre visivel.
 *
 * Existe para a OVH, cuja moeda vem por linha do banco em vez de ser fixa como
 * no CUR. Nao converte nada: a moeda de referencia do portal e decisao de
 * negocio pendente, e exibir "US$" num valor em euro seria pior do que exibir
 * um codigo que o usuario nao esperava.
 *
 * Cache de `Intl.NumberFormat` por moeda: construir o formatador e caro e a
 * tabela mensal chama isto por celula.
 */
const formatadoresPorMoeda = new Map<string, Intl.NumberFormat>();

export function formatMoeda(valor: unknown, moeda: string): string {
  const codigo = (moeda || "USD").toUpperCase();
  let formatador = formatadoresPorMoeda.get(codigo);

  if (!formatador) {
    try {
      formatador = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: codigo,
        currencyDisplay: "code",
      });
    } catch {
      // Codigo de moeda que o ICU nao conhece. Cai para numero puro com o
      // codigo colado -- nunca para uma moeda diferente da que esta no banco.
      formatador = new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    formatadoresPorMoeda.set(codigo, formatador);
  }

  const numero = formatador.format(toNumber(valor));
  return numero.includes(codigo) ? numero : `${codigo} ${numero}`;
}

/**
 * Versao compacta de `formatMoeda`, para eixo de grafico.
 *
 * Existe pelo mesmo motivo de `formatUSDCompacto`: "USD 30.917,39" repetido em
 * seis marcas do eixo Y nao cabe em tela estreita. O que muda e a moeda vir por
 * parametro, porque a da OVH esta no banco por linha.
 */
const compactosPorMoeda = new Map<string, Intl.NumberFormat>();

export function formatMoedaCompacta(valor: unknown, moeda: string): string {
  const codigo = (moeda || "USD").toUpperCase();
  let formatador = compactosPorMoeda.get(codigo);

  if (!formatador) {
    try {
      formatador = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: codigo,
        currencyDisplay: "code",
        notation: "compact",
        maximumFractionDigits: 1,
      });
    } catch {
      // Codigo que o ICU nao conhece: numero compacto sem simbolo, nunca uma
      // moeda diferente da que esta no banco.
      formatador = new Intl.NumberFormat("pt-BR", {
        notation: "compact",
        maximumFractionDigits: 1,
      });
    }
    compactosPorMoeda.set(codigo, formatador);
  }

  return formatador.format(toNumber(valor));
}

export function formatInteiro(valor: unknown): string {
  return inteiro.format(toNumber(valor));
}

/** Recebe a variacao em fracao (0.12 => +12,0%). */
export function formatVariacao(fracao: number | null): string {
  if (fracao === null || !Number.isFinite(fracao)) return "—";
  return percentual.format(fracao);
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Estimativa em BRL. O "~" e parte do numero, nao enfeite: sinaliza em toda
 * ocorrencia que aquilo nao e valor contabil.
 */
export function formatBRLEstimado(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return `~${brl.format(valor)}`;
}

/** Cotacao com 4 casas, como o Banco Central publica. */
export function formatCotacao(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(valor);
}

/** Fracao 0..1 como percentual sem sinal (para participacao). */
export function formatParticipacao(fracao: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number.isFinite(fracao) ? fracao : 0);
}

/**
 * Data de CALENDARIO ("AAAA-MM-DD") em dd/mm/aaaa.
 *
 * Nao passa por `Date`: `new Date("2026-08-01")` e interpretado como meia-noite
 * UTC e, formatado em America/Sao_Paulo, volta como 31/07. Data de competencia
 * nao tem fuso -- formatar como texto e a unica forma de nao perder um dia.
 */
export function formatDataDia(iso: string | null): string {
  if (!iso || iso.length < 10) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Intervalo legivel: "01/08/2026 a 07/08/2026". */
export function formatIntervalo(de: string | null, ate: string | null): string {
  if (!de || !ate) return "—";
  return `${formatDataDia(de)} a ${formatDataDia(ate)}`;
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
