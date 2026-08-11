import { PRESETS_PERIODO, type PresetPeriodo } from "@/lib/filtros/periodo";

/**
 * Estado dos filtros globais do dashboard.
 *
 * A URL e a UNICA fonte de verdade. Nao existe estado de filtro em memoria do
 * React: o que esta na barra de endereco e o que a tela mostra. Assim o link e
 * compartilhavel, o botao voltar funciona e recarregar a pagina nao perde nada.
 *
 * Modulo PURO -- sem React, sem fetch, sem `server-only`. Roda no servidor e no
 * cliente, e e testavel direto.
 */

export type FiltrosDashboard = {
  periodo: PresetPeriodo;
  /** Preenchidos apenas quando `periodo` e "personalizado". */
  de: string;
  ate: string;
  /** Vazio significa "todas as contas". */
  contas: string[];
};

export const FILTROS_PADRAO: FiltrosDashboard = {
  periodo: "mes-atual",
  de: "",
  ate: "",
  contas: [],
};

export const ROTULOS_PRESET: Record<PresetPeriodo, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "mes-atual": "Mês atual",
  "mes-anterior": "Mês anterior",
  personalizado: "Personalizado",
};

/** Presets na ordem em que aparecem na barra de filtros. */
export const PRESETS_VISIVEIS: readonly PresetPeriodo[] = PRESETS_PERIODO;

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Le os filtros de uma query string, caindo no padrao quando invalido. */
export function lerFiltros(params: URLSearchParams): FiltrosDashboard {
  const periodoBruto = params.get("periodo");
  const periodo = (PRESETS_PERIODO as readonly string[]).includes(periodoBruto ?? "")
    ? (periodoBruto as PresetPeriodo)
    : FILTROS_PADRAO.periodo;

  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";

  const contas = (params.get("contas") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.toLowerCase() !== "todas");

  return {
    periodo,
    de: FORMATO_DATA.test(de) ? de : "",
    ate: FORMATO_DATA.test(ate) ? ate : "",
    contas: [...new Set(contas)],
  };
}

/**
 * Serializa os filtros para a URL, omitindo tudo que for padrao.
 *
 * URL curta importa: `/dashboard` limpo significa "mes atual, todas as contas".
 * So aparece na barra de endereco o que o usuario mudou de fato.
 */
export function escreverFiltros(filtros: FiltrosDashboard): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.periodo !== FILTROS_PADRAO.periodo) {
    params.set("periodo", filtros.periodo);
  }

  if (filtros.periodo === "personalizado") {
    if (filtros.de) params.set("de", filtros.de);
    if (filtros.ate) params.set("ate", filtros.ate);
  }

  if (filtros.contas.length > 0) {
    params.set("contas", filtros.contas.join(","));
  }

  return params;
}

/**
 * Query string enviada aos endpoints.
 *
 * Diferente de `escreverFiltros`: a API exige as duas datas quando o periodo e
 * personalizado, e recusa `de`/`ate` junto de qualquer outro preset.
 */
export function paramsDaApi(filtros: FiltrosDashboard): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.periodo === "personalizado") {
    params.set("periodo", "personalizado");
    params.set("de", filtros.de);
    params.set("ate", filtros.ate);
  } else {
    params.set("periodo", filtros.periodo);
  }

  if (filtros.contas.length > 0) {
    params.set("contas", filtros.contas.join(","));
  }

  return params;
}

// ------------------------------------------------------------------ validacao

export type ProblemaFiltro = { campo: "de" | "ate"; mensagem: string } | null;

/** Teto de dias por consulta, igual ao da API (`MAX_DIAS_PERIODO`). */
const MAX_DIAS = 731;

/**
 * Valida o intervalo personalizado ANTES de chamar a API.
 *
 * A API tambem valida -- esta e a primeira barreira, nao a unica. Vale a pena
 * porque troca um 400 por uma mensagem imediata embaixo do campo.
 */
export function validarIntervalo(filtros: FiltrosDashboard): ProblemaFiltro {
  if (filtros.periodo !== "personalizado") return null;

  if (!filtros.de) return { campo: "de", mensagem: "Informe a data inicial." };
  if (!filtros.ate) return { campo: "ate", mensagem: "Informe a data final." };

  if (!ehDataReal(filtros.de)) {
    return { campo: "de", mensagem: "Data inicial inexistente." };
  }
  if (!ehDataReal(filtros.ate)) {
    return { campo: "ate", mensagem: "Data final inexistente." };
  }

  if (filtros.de > filtros.ate) {
    return {
      campo: "ate",
      mensagem: "A data final não pode ser anterior à inicial.",
    };
  }

  const dias =
    Math.floor(
      (Date.parse(`${filtros.ate}T00:00:00Z`) - Date.parse(`${filtros.de}T00:00:00Z`)) /
        86_400_000,
    ) + 1;

  if (dias > MAX_DIAS) {
    return {
      campo: "ate",
      mensagem: `Período de ${dias} dias excede o máximo de ${MAX_DIAS}.`,
    };
  }

  return null;
}

function ehDataReal(iso: string): boolean {
  if (!FORMATO_DATA.test(iso)) return false;
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  );
}

/** Resumo textual do que esta aplicado, para leitor de tela e para o cabecalho. */
export function descreverFiltros(
  filtros: FiltrosDashboard,
  totalDeContas: number | null,
): string {
  const periodo = ROTULOS_PRESET[filtros.periodo];
  const contas =
    filtros.contas.length === 0
      ? totalDeContas === null
        ? "todas as contas"
        : `todas as ${totalDeContas} contas`
      : filtros.contas.length === 1
        ? "1 conta"
        : `${filtros.contas.length} contas`;

  return `${periodo} · ${contas}`;
}
