import { FONTES_OVH, type FonteOvh } from "@/lib/filtros/esquemas";
import {
  MAX_MESES_PERIODO,
  PRESETS_MES,
  PRESET_MES_PADRAO,
  ROTULOS_MES,
  contarMeses,
  ehMesISOValido,
  type PresetMes,
} from "@/lib/filtros/periodo-mensal";
import { ROTULO_FONTE } from "./ovh";

/**
 * Estado dos filtros da visao OVH. Modulo PURO -- sem React, sem fetch.
 *
 * A URL e a UNICA fonte de verdade, igual a visao AWS: o que esta na barra de
 * endereco e o que a tela mostra. O que muda em relacao a `filtros.ts` e o
 * vocabulario -- meses em vez de dias, origem e projeto em vez de contas --
 * porque a granularidade minima do dado OVH e o mes.
 *
 * `provider=ovh` acompanha os filtros de proposito: e ele que faz recarregar a
 * pagina manter a visao OVH em vez de cair na AWS.
 */

export type FiltrosOvh = {
  periodo: PresetMes;
  /** Preenchidos apenas quando `periodo` e "personalizado". Formato "AAAA-MM". */
  deMes: string;
  ateMes: string;
  source: FonteOvh;
  /** Vazio significa "todas as contas OVH". */
  conta: string;
  /** Vazio significa "todos os projetos". */
  projeto: string;
  /** Vazio significa "a moeda de maior volume, escolhida pelo servidor". */
  moeda: string;
};

export const FILTROS_OVH_PADRAO: FiltrosOvh = {
  periodo: PRESET_MES_PADRAO,
  deMes: "",
  ateMes: "",
  // `invoice` e o padrao porque e o custo REALIZADO. `usage_forecast` como
  // padrao poria uma projecao no card principal do painel executivo.
  source: "invoice",
  conta: "",
  projeto: "",
  moeda: "",
};

export const ROTULOS_PRESET_OVH = ROTULOS_MES;
export const PRESETS_OVH_VISIVEIS: readonly PresetMes[] = PRESETS_MES;
export const FONTES_VISIVEIS: readonly FonteOvh[] = FONTES_OVH;

const FORMATO_MOEDA = /^[A-Za-z]{3}$/;

/** Le os filtros de uma query string, caindo no padrao quando invalido. */
export function lerFiltrosOvh(params: URLSearchParams): FiltrosOvh {
  const periodoBruto = params.get("periodo") ?? "";
  const periodo = (PRESETS_MES as readonly string[]).includes(periodoBruto)
    ? (periodoBruto as PresetMes)
    : FILTROS_OVH_PADRAO.periodo;

  const sourceBruto = params.get("source") ?? "";
  const source = (FONTES_OVH as readonly string[]).includes(sourceBruto)
    ? (sourceBruto as FonteOvh)
    : FILTROS_OVH_PADRAO.source;

  const deMes = params.get("deMes") ?? "";
  const ateMes = params.get("ateMes") ?? "";
  const moeda = params.get("moeda") ?? "";

  return {
    periodo,
    deMes: ehMesISOValido(deMes) ? deMes : "",
    ateMes: ehMesISOValido(ateMes) ? ateMes : "",
    source,
    conta: (params.get("conta") ?? "").trim(),
    projeto: (params.get("projeto") ?? "").trim(),
    moeda: FORMATO_MOEDA.test(moeda) ? moeda.toUpperCase() : "",
  };
}

/**
 * Serializa para a URL, omitindo o que for padrao -- MENOS `provider`.
 *
 * `provider=ovh` sai sempre, mesmo sendo o unico valor que esta funcao produz:
 * sem ele, `/dashboard` volta para a visao AWS ao recarregar, e o link
 * compartilhado abriria na tela errada.
 */
export function escreverFiltrosOvh(filtros: FiltrosOvh): URLSearchParams {
  const params = new URLSearchParams();
  params.set("provider", "ovh");

  if (filtros.periodo !== FILTROS_OVH_PADRAO.periodo) {
    params.set("periodo", filtros.periodo);
  }

  if (filtros.periodo === "personalizado") {
    if (filtros.deMes) params.set("deMes", filtros.deMes);
    if (filtros.ateMes) params.set("ateMes", filtros.ateMes);
  }

  if (filtros.source !== FILTROS_OVH_PADRAO.source) {
    params.set("source", filtros.source);
  }
  if (filtros.conta) params.set("conta", filtros.conta);
  if (filtros.projeto) params.set("projeto", filtros.projeto);
  if (filtros.moeda) params.set("moeda", filtros.moeda);

  return params;
}

/**
 * Query string enviada aos endpoints.
 *
 * Diferente de `escreverFiltrosOvh`: nao leva `provider` (a rota da API ja e
 * especifica de OVH) e a API exige os dois meses quando o periodo e
 * personalizado.
 */
export function paramsDaApiOvh(filtros: FiltrosOvh): URLSearchParams {
  const params = new URLSearchParams();

  if (filtros.periodo === "personalizado") {
    params.set("periodo", "personalizado");
    params.set("deMes", filtros.deMes);
    params.set("ateMes", filtros.ateMes);
  } else {
    params.set("periodo", filtros.periodo);
  }

  params.set("source", filtros.source);
  if (filtros.conta) params.set("conta", filtros.conta);
  if (filtros.projeto) params.set("projeto", filtros.projeto);
  if (filtros.moeda) params.set("moeda", filtros.moeda);

  return params;
}

// ------------------------------------------------------------------ validacao

export type ProblemaFiltroOvh = { campo: "deMes" | "ateMes"; mensagem: string } | null;

/**
 * Valida o intervalo personalizado ANTES de chamar a API.
 *
 * A API tambem valida -- esta e a primeira barreira, nao a unica. Vale a pena
 * porque troca um 400 por uma mensagem imediata embaixo do campo.
 */
export function validarIntervaloOvh(filtros: FiltrosOvh): ProblemaFiltroOvh {
  if (filtros.periodo !== "personalizado") return null;

  if (!filtros.deMes) return { campo: "deMes", mensagem: "Informe o mês inicial." };
  if (!filtros.ateMes) return { campo: "ateMes", mensagem: "Informe o mês final." };

  if (!ehMesISOValido(filtros.deMes)) {
    return { campo: "deMes", mensagem: "Mês inicial inexistente." };
  }
  if (!ehMesISOValido(filtros.ateMes)) {
    return { campo: "ateMes", mensagem: "Mês final inexistente." };
  }

  // Comparacao de string funciona porque "AAAA-MM" e ordenavel
  // lexicograficamente -- a mesma propriedade que faz o ISO ser usado no resto
  // do projeto.
  if (filtros.deMes > filtros.ateMes) {
    return {
      campo: "ateMes",
      mensagem: "O mês final não pode ser anterior ao inicial.",
    };
  }

  const meses = contarMeses(filtros.deMes, filtros.ateMes);
  if (meses > MAX_MESES_PERIODO) {
    return {
      campo: "ateMes",
      mensagem: `Período de ${meses} meses excede o máximo de ${MAX_MESES_PERIODO}.`,
    };
  }

  return null;
}

/** Resumo textual do que esta aplicado, para leitor de tela e para o cabecalho. */
export function descreverFiltrosOvh(
  filtros: FiltrosOvh,
  nomeDoProjeto?: string | null,
): string {
  const periodo = ROTULOS_MES[filtros.periodo];
  const origem = ROTULO_FONTE[filtros.source];
  const projeto = filtros.projeto
    ? `projeto ${nomeDoProjeto ?? filtros.projeto}`
    : "todos os projetos";

  return `${periodo} · ${origem} · ${projeto}`;
}

/** `true` quando algo foi mudado em relacao ao padrao -- habilita "Limpar". */
export function temFiltroOvhAplicado(filtros: FiltrosOvh): boolean {
  return (
    filtros.periodo !== FILTROS_OVH_PADRAO.periodo ||
    filtros.source !== FILTROS_OVH_PADRAO.source ||
    filtros.conta !== "" ||
    filtros.projeto !== "" ||
    filtros.moeda !== ""
  );
}
