import {
  FILTROS_PADRAO,
  escreverFiltros,
  lerFiltros,
  type FiltrosDashboard,
} from "./filtros";

/**
 * Estado dos filtros da tela analitica.
 *
 * ESTENDE os filtros globais (periodo + contas) em vez de substitui-los: a URL
 * usa os mesmos nomes de parametro do painel executivo, entao trocar de tela
 * preserva o recorte. Os campos proprios do analitico -- busca, regiao,
 * ordenacao, pagina -- se somam a eles.
 *
 * A URL segue sendo a unica fonte de verdade. Nenhum filtro vive em estado do
 * React.
 *
 * Modulo PURO: sem React, sem fetch. Testavel direto.
 */

export const CAMPOS_ORDENAVEIS = [
  "usageDate",
  "accountId",
  "accountName",
  "service",
  "region",
  "cost",
] as const;

export type CampoOrdenavel = (typeof CAMPOS_ORDENAVEIS)[number];
export type Direcao = "asc" | "desc";

export const TAMANHOS_PAGINA = [25, 50, 100, 200] as const;

export type FiltrosAnalitico = FiltrosDashboard & {
  busca: string;
  /** `""` = todas as regiões. `"nao-informado"` = linhas sem região. */
  regiao: string;
  ordenarPor: CampoOrdenavel;
  direcao: Direcao;
  pagina: number;
  tamanho: number;
};

export const PADRAO_ANALITICO: FiltrosAnalitico = {
  ...FILTROS_PADRAO,
  busca: "",
  regiao: "",
  ordenarPor: "usageDate",
  direcao: "desc",
  pagina: 1,
  tamanho: 50,
};

/** Rotulo de coluna, usado no cabecalho da tabela e no anuncio de ordenacao. */
export const ROTULOS_COLUNA: Record<CampoOrdenavel, string> = {
  usageDate: "Data de uso",
  accountId: "Conta",
  accountName: "Nome da conta",
  service: "Serviço",
  region: "Região",
  cost: "Valor (USD)",
};

function inteiroOu(valor: string | null, padrao: number, minimo: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= minimo ? n : padrao;
}

export function lerFiltrosAnalitico(params: URLSearchParams): FiltrosAnalitico {
  const globais = lerFiltros(params);

  const ordenarPor = params.get("ordenarPor");
  const direcao = params.get("direcao");
  const tamanho = inteiroOu(params.get("tamanho"), PADRAO_ANALITICO.tamanho, 1);

  return {
    ...globais,
    busca: (params.get("busca") ?? "").slice(0, 100),
    regiao: params.get("regiao") ?? "",
    ordenarPor: (CAMPOS_ORDENAVEIS as readonly string[]).includes(ordenarPor ?? "")
      ? (ordenarPor as CampoOrdenavel)
      : PADRAO_ANALITICO.ordenarPor,
    direcao: direcao === "asc" || direcao === "desc" ? direcao : PADRAO_ANALITICO.direcao,
    pagina: inteiroOu(params.get("pagina"), 1, 1),
    // Restringe ao conjunto oferecido: valor arbitrario na URL nao deve virar
    // um pageSize esquisito que a API depois recusa.
    tamanho: (TAMANHOS_PAGINA as readonly number[]).includes(tamanho)
      ? tamanho
      : PADRAO_ANALITICO.tamanho,
  };
}

/** Serializa para a URL da pagina, omitindo tudo que for padrao. */
export function escreverFiltrosAnalitico(f: FiltrosAnalitico): URLSearchParams {
  const params = escreverFiltros(f);

  if (f.busca.trim()) params.set("busca", f.busca.trim());
  if (f.regiao) params.set("regiao", f.regiao);
  if (f.ordenarPor !== PADRAO_ANALITICO.ordenarPor) params.set("ordenarPor", f.ordenarPor);
  if (f.direcao !== PADRAO_ANALITICO.direcao) params.set("direcao", f.direcao);
  if (f.pagina > 1) params.set("pagina", String(f.pagina));
  if (f.tamanho !== PADRAO_ANALITICO.tamanho) params.set("tamanho", String(f.tamanho));

  return params;
}

/**
 * Query string do endpoint `/api/dashboard/analytic`.
 *
 * A API desta rota usa nomes proprios (`startDate`, `accountIds`, `page`...),
 * diferentes dos da URL da pagina. A traducao mora aqui, num lugar so.
 *
 * `startDate`/`endDate` sao enviados APENAS no periodo personalizado: nos
 * presets, quem resolve a janela e o servidor -- assim analitico e painel
 * aplicam exatamente a mesma regra, incluindo o corte pela ultima carga do ETL.
 */
export function paramsDaApiAnalitico(f: FiltrosAnalitico): URLSearchParams {
  const params = new URLSearchParams();

  if (f.periodo === "personalizado") {
    params.set("startDate", f.de);
    params.set("endDate", f.ate);
  } else if (f.periodo !== "mes-atual") {
    // Presets relativos precisam de datas concretas, porque a API do analitico
    // nao recebe preset. Resolvidos abaixo por `datasDoPreset`.
    const janela = datasDoPreset(f.periodo);
    if (janela) {
      params.set("startDate", janela.de);
      params.set("endDate", janela.ate);
    }
  }

  if (f.contas.length > 0) params.set("accountIds", f.contas.join(","));
  if (f.busca.trim()) params.set("serviceSearch", f.busca.trim());
  if (f.regiao) params.set("region", f.regiao);
  params.set("page", String(f.pagina));
  params.set("pageSize", String(f.tamanho));
  params.set("sortBy", f.ordenarPor);
  params.set("sortDirection", f.direcao);

  return params;
}

/**
 * Query string das rotas `/api/export/*`.
 *
 * DERIVA da query do analitico, removendo so a paginacao. Escrita a parte, ela
 * poderia divergir com o tempo e o arquivo baixado deixaria de corresponder a
 * tabela na tela -- que e o unico defeito realmente grave que uma exportacao
 * pode ter, porque ninguem descobre olhando o arquivo.
 */
export function paramsDaApiExportacao(f: FiltrosAnalitico): URLSearchParams {
  const params = paramsDaApiAnalitico(f);
  params.delete("page");
  params.delete("pageSize");
  return params;
}

/**
 * Converte os presets relativos em datas.
 *
 * Precisa acontecer no cliente porque a API do analitico recebe apenas datas.
 * "mes-atual" fica de fora de proposito: e o unico preset cujo fim depende da
 * ultima carga do ETL, informacao que so o servidor tem -- entao para ele
 * enviamos nada e deixamos o servidor aplicar o padrao.
 */
function datasDoPreset(
  preset: FiltrosDashboard["periodo"],
): { de: string; ate: string } | null {
  const hoje = hojeLocal();

  if (preset === "7d" || preset === "30d") {
    const dias = preset === "7d" ? 7 : 30;
    return { de: somar(hoje, -(dias - 1)), ate: hoje };
  }

  if (preset === "mes-anterior") {
    const [ano, mes] = hoje.split("-").map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 2, 1));
    const fim = new Date(Date.UTC(ano, mes - 1, 0));
    return { de: iso(inicio), ate: iso(fim) };
  }

  return null;
}

/** Hoje em America/Sao_Paulo -- a virada do dia que vale num relatorio brasileiro. */
function hojeLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somar(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/**
 * Regra de reset de pagina.
 *
 * Trocar filtro ou ordenacao volta para a pagina 1. Sem isso, quem esta na
 * pagina 7 e aplica uma busca que devolve 2 resultados cai numa pagina vazia e
 * parece que a busca nao achou nada.
 */
export function aplicarMudanca(
  atual: FiltrosAnalitico,
  mudanca: Partial<FiltrosAnalitico>,
): FiltrosAnalitico {
  const proximo = { ...atual, ...mudanca };

  const mexeuNoRecorte = (
    ["periodo", "de", "ate", "contas", "busca", "regiao", "tamanho", "ordenarPor", "direcao"] as const
  ).some((campo) => campo in mudanca);

  if (mexeuNoRecorte && !("pagina" in mudanca)) proximo.pagina = 1;

  // Preset diferente de personalizado nao carrega datas soltas: a API recusa.
  if (mudanca.periodo && mudanca.periodo !== "personalizado") {
    proximo.de = "";
    proximo.ate = "";
  }

  return proximo;
}

/** Alterna a direcao quando se clica na coluna que ja ordena. */
export function alternarOrdenacao(
  atual: FiltrosAnalitico,
  campo: CampoOrdenavel,
): Partial<FiltrosAnalitico> {
  if (atual.ordenarPor !== campo) {
    // Coluna nova: comeca pela ordem mais util. Data e valor descendo (mais
    // recente / mais caro primeiro); texto subindo (alfabetico).
    return {
      ordenarPor: campo,
      direcao: campo === "usageDate" || campo === "cost" ? "desc" : "asc",
    };
  }
  return { direcao: atual.direcao === "asc" ? "desc" : "asc" };
}
