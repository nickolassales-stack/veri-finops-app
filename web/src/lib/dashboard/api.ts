import type { Envelope, ErroApi } from "./tipos";

/**
 * Cliente HTTP do dashboard.
 *
 * O navegador NUNCA fala com o PostgreSQL. Toda leitura passa pelos endpoints
 * protegidos, que validam a sessao contra o banco antes de responder. Este
 * modulo e a unica porta de saida do cliente.
 *
 * O cookie de sessao viaja sozinho: mesma origem, `HttpOnly`. Nao existe token
 * em JavaScript para ser roubado.
 */

/** Erro ja traduzido para exibir na tela. */
export class ErroDeRequisicao extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalhes: { campo: string; mensagem: string }[];

  constructor(
    status: number,
    codigo: string,
    mensagem: string,
    detalhes: { campo: string; mensagem: string }[] = [],
  ) {
    super(mensagem);
    this.name = "ErroDeRequisicao";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }

  /** 401 exige voltar para o login; os outros erros sao exibidos no lugar. */
  get exigeLogin(): boolean {
    return this.status === 401;
  }
}

export async function buscarRecurso<T>(
  caminho: string,
  params: URLSearchParams,
  sinal?: AbortSignal,
): Promise<Envelope<T>> {
  const busca = params.toString();
  const url = busca ? `${caminho}?${busca}` : caminho;

  const resposta = await fetch(url, {
    signal: sinal,
    headers: { accept: "application/json" },
    // Dado financeiro por sessao: nunca do cache do navegador.
    cache: "no-store",
    credentials: "same-origin",
  });

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    // Resposta sem JSON (proxy, pagina de erro): cai no tratamento abaixo.
  }

  if (!resposta.ok) {
    const erro = (corpo as ErroApi | null)?.erro;
    throw new ErroDeRequisicao(
      resposta.status,
      erro?.codigo ?? "erro-desconhecido",
      erro?.mensagem ?? `Falha ao consultar ${caminho} (HTTP ${resposta.status}).`,
      erro?.detalhes ?? [],
    );
  }

  const envelope = corpo as Envelope<T> | null;
  if (!envelope || envelope.dados === undefined) {
    throw new ErroDeRequisicao(
      resposta.status,
      "resposta-inesperada",
      `A resposta de ${caminho} veio em formato inesperado.`,
    );
  }

  return envelope;
}
