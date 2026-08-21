import { ErroDeCotacao, type CotacaoBruta, type ProvedorCotacao } from "./tipos";

/**
 * Provedores de cotacao USD/BRL. Os dois sao do Banco Central do Brasil.
 *
 * Validado contra os servicos reais em 06/08/2026:
 *
 * - `CotacaoDolarDia` com a data de HOJE devolveu `[]` as 11:45 BRT. O boletim
 *   de fechamento sai por volta das 13:05, entao consultar "hoje" retorna vazio
 *   na maior parte do horario comercial -- e em fim de semana e feriado, o dia
 *   inteiro. Por isso o provedor PTAX consulta um PERIODO e pega o mais recente.
 * - `CotacaoDolarPeriodo` dos ultimos 10 dias devolveu 8 registros (os dias
 *   uteis), um por dia, o mais novo em 05/08 13:06:43 com venda 5,1154.
 * - A serie 1 do SGS devolveu o mesmo 5,1154 para 05/08, com payload menor,
 *   porem sem a hora do boletim.
 *
 * Nenhum dos dois exige autenticacao ou chave.
 */

/**
 * Janela de busca do PTAX, em dias corridos.
 *
 * Precisa cobrir a maior sequencia possivel sem boletim: feriado prolongado
 * emendado com fim de semana chega a 4-5 dias. 10 da folga confortavel sem
 * trazer payload grande.
 */
const JANELA_DIAS = 10;

/** Fuso dos boletins do BCB. O Brasil nao tem horario de verao desde 2019. */
const DESLOCAMENTO_BRT = "-03:00";

export const ROTULOS_FONTE: Record<Exclude<ProvedorCotacao, "nenhum">, string> = {
  ptax: "Banco Central do Brasil — PTAX (venda)",
  sgs: "Banco Central do Brasil — SGS série 1 (dólar PTAX venda)",
};

export type OpcoesProvedor = {
  timeoutMs: number;
  /** Injetavel para teste. Em producao e o `fetch` global do Node. */
  fetchImpl?: typeof fetch;
  /** Injetavel para teste. Em producao e o relogio do sistema. */
  agora?: Date;
};

// ------------------------------------------------------------------- utilidade

async function buscarJson(
  url: string,
  { timeoutMs, fetchImpl = fetch }: OpcoesProvedor,
): Promise<unknown> {
  let resposta: Response;

  try {
    resposta = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
      // A cotacao ja tem cache proprio nesta aplicacao; nao queremos uma
      // segunda camada de cache do runtime servindo valor antigo por baixo.
      cache: "no-store",
    });
  } catch (err) {
    // `AbortSignal.timeout` rejeita com TimeoutError; falha de rede vem como
    // TypeError. Os dois viram a mesma mensagem: o usuario nao precisa saber
    // qual foi, so que a cotacao nao veio.
    const ehTimeout = err instanceof Error && err.name === "TimeoutError";
    throw new ErroDeCotacao(
      ehTimeout
        ? `O Banco Central nao respondeu em ${timeoutMs} ms.`
        : "Nao foi possivel falar com o Banco Central.",
      err,
    );
  }

  if (!resposta.ok) {
    throw new ErroDeCotacao(
      `O Banco Central respondeu com erro (HTTP ${resposta.status}).`,
    );
  }

  try {
    return await resposta.json();
  } catch (err) {
    throw new ErroDeCotacao("O Banco Central devolveu uma resposta ilegivel.", err);
  }
}

/** Data no formato MM-DD-AAAA exigido pelo OData do Olinda. */
function formatarDataOlinda(d: Date): string {
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${mes}-${dia}-${d.getUTCFullYear()}`;
}

/**
 * "2026-08-05 13:06:43.148328" (horario de Brasilia, sem fuso no texto) ->
 * instante ISO.
 *
 * Dois cuidados: o texto nao traz fuso, entao aplicamos -03:00 explicitamente
 * (sem isso o Node interpretaria como horario local do container, que roda em
 * UTC, e a hora ficaria tres horas adiantada); e os microssegundos precisam ser
 * truncados para milissegundos, que e o que o `Date` do JavaScript representa.
 */
function instanteDoBoletim(texto: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(texto.trim());
  if (!m) return null;

  const milissegundos = (m[3] ?? "0").slice(0, 3).padEnd(3, "0");
  const data = new Date(`${m[1]}T${m[2]}.${milissegundos}${DESLOCAMENTO_BRT}`);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

// ----------------------------------------------------------------------- PTAX

type LinhaPtax = {
  cotacaoCompra?: unknown;
  cotacaoVenda?: unknown;
  dataHoraCotacao?: unknown;
};

/**
 * PTAX pelo OData do Olinda. Traz a hora exata do boletim.
 *
 * Usa a cotacao de VENDA: e a referencia usual para estimar quanto se paga por
 * um custo em dolar.
 */
export async function buscarPtax(opcoes: OpcoesProvedor): Promise<CotacaoBruta> {
  const agora = opcoes.agora ?? new Date();
  const inicio = new Date(agora.getTime() - JANELA_DIAS * 86_400_000);

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${formatarDataOlinda(inicio)}'` +
    `&@dataFinalCotacao='${formatarDataOlinda(agora)}'` +
    "&$top=1&$orderby=dataHoraCotacao%20desc&$format=json";

  const json = await buscarJson(url, opcoes);
  const linhas = (json as { value?: unknown })?.value;

  if (!Array.isArray(linhas) || linhas.length === 0) {
    throw new ErroDeCotacao(
      `O Banco Central nao tem boletim de cotacao nos ultimos ${JANELA_DIAS} dias.`,
    );
  }

  const linha = linhas[0] as LinhaPtax;
  const valor = Number(linha.cotacaoVenda);
  const dataHora =
    typeof linha.dataHoraCotacao === "string"
      ? instanteDoBoletim(linha.dataHoraCotacao)
      : null;

  if (!Number.isFinite(valor) || valor <= 0) {
    throw new ErroDeCotacao("O Banco Central devolveu uma cotacao invalida.");
  }

  return {
    valor,
    // O dia de referencia sai do proprio texto do boletim, nao do relogio local.
    dataReferencia:
      typeof linha.dataHoraCotacao === "string"
        ? linha.dataHoraCotacao.slice(0, 10)
        : (dataHora?.slice(0, 10) ?? ""),
    dataHoraReferencia: dataHora,
  };
}

// ------------------------------------------------------------------------ SGS

type LinhaSgs = { data?: unknown; valor?: unknown };

/**
 * Serie 1 do SGS (dolar comercial venda, mesma PTAX de fechamento).
 *
 * Payload menor e sem OData, mas informa apenas o DIA -- por isso
 * `dataHoraReferencia` volta `null` em vez de uma hora inventada.
 */
export async function buscarSgs(opcoes: OpcoesProvedor): Promise<CotacaoBruta> {
  const json = await buscarJson(
    "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json",
    opcoes,
  );

  if (!Array.isArray(json) || json.length === 0) {
    throw new ErroDeCotacao("O Banco Central nao devolveu nenhuma cotacao.");
  }

  const linha = json[0] as LinhaSgs;
  const valor = Number(linha.valor);
  const dia = typeof linha.data === "string" ? linha.data.trim() : "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dia);

  if (!Number.isFinite(valor) || valor <= 0 || !m) {
    throw new ErroDeCotacao("O Banco Central devolveu uma cotacao invalida.");
  }

  return {
    valor,
    dataReferencia: `${m[3]}-${m[2]}-${m[1]}`,
    dataHoraReferencia: null,
  };
}

export function buscarNoProvedor(
  provedor: Exclude<ProvedorCotacao, "nenhum">,
  opcoes: OpcoesProvedor,
): Promise<CotacaoBruta> {
  return provedor === "ptax" ? buscarPtax(opcoes) : buscarSgs(opcoes);
}
