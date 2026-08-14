import type { z } from "zod";

/**
 * Contrato de resposta das rotas de dados.
 *
 * Sucesso: `{ dados, meta }`. Erro: `{ erro }`. Nunca os dois.
 *
 * Regra de vazamento: a mensagem que vai para o cliente e escrita por nos. Erro
 * de banco, stack trace, string de conexao e nome de host ficam no log do
 * servidor -- o cliente recebe codigo e frase generica. Erro de VALIDACAO e a
 * excecao proposital: ali o detalhe e do proprio usuario e ajuda a corrigir.
 */

export type MetaResposta = Record<string, unknown> & {
  moeda: "USD";
  timezone: string;
  geradoEm: string;
};

export type CodigoErro =
  | "nao-autenticado"
  | "sem-permissao"
  | "parametros-invalidos"
  | "conflito"
  | "nao-encontrado"
  | "consulta-excedeu-tempo"
  | "exportacao-muito-grande"
  | "banco-indisponivel"
  | "erro-interno";

const STATUS_POR_CODIGO: Record<CodigoErro, number> = {
  "nao-autenticado": 401,
  // 403 e nao 404: esconder a existencia da rota nao protege nada aqui -- os
  // caminhos da area administrativa sao fixos e conhecidos -- e devolver 404
  // faria quem tem acesso legitimo mas perdeu a permissao achar que a tela
  // sumiu, em vez de entender que precisa pedir acesso.
  "sem-permissao": 403,
  "parametros-invalidos": 400,
  // 409: a entrada e valida, mas colide com algo que ja existe (e-mail de
  // usuario, nome de grupo). Diferente de 400, que diz "voce escreveu errado".
  conflito: 409,
  "nao-encontrado": 404,
  // 413: o pedido e valido, o resultado e que nao cabe. 400 diria "voce errou o
  // parametro", que nao e o caso -- o filtro esta certo, so e largo demais.
  "exportacao-muito-grande": 413,
  "consulta-excedeu-tempo": 504,
  "banco-indisponivel": 503,
  "erro-interno": 500,
};

export type DetalheErro = { campo: string; mensagem: string };

/**
 * Falha que ja sabe qual codigo da API ela e.
 *
 * Existe para que uma camada de dominio (a exportacao, por exemplo) possa
 * recusar algo com a mensagem certa sem que `traduzirFalha` precise conhecer
 * cada modulo do sistema -- o que criaria dependencia da camada generica de HTTP
 * para dentro das regras de negocio.
 *
 * A mensagem AQUI e exibivel: quem lanca se compromete a nao colocar detalhe
 * tecnico, host ou stack nela.
 */
export class ErroDeApi extends Error {
  readonly codigo: CodigoErro;

  constructor(codigo: CodigoErro, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeApi";
    this.codigo = codigo;
  }
}

/** Erro de entrada do usuario. Sempre vira 400 com detalhe por campo. */
export class ErroDeValidacao extends Error {
  readonly detalhes: DetalheErro[];

  constructor(detalhes: DetalheErro[]) {
    super("Parametros invalidos.");
    this.name = "ErroDeValidacao";
    this.detalhes = detalhes;
  }
}

/**
 * Valida a entrada e devolve o objeto ja tipado, ou lanca `ErroDeValidacao`.
 *
 * Todo endpoint passa por aqui antes de tocar no banco.
 */
export function analisar<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return resultado.data;

  throw new ErroDeValidacao(
    resultado.error.issues.map((issue) => ({
      campo: issue.path.length > 0 ? issue.path.join(".") : "(geral)",
      mensagem: issue.message,
    })),
  );
}

// --------------------------------------------------------------- respostas

const CABECALHOS_BASE = {
  // Dado financeiro por sessao: nunca em cache de navegador ou intermediario.
  "cache-control": "no-store, private",
} as const;

export function respostaOk(dados: unknown, meta: MetaResposta): Response {
  return Response.json({ dados, meta }, { status: 200, headers: CABECALHOS_BASE });
}

export function respostaErro(
  codigo: CodigoErro,
  mensagem: string,
  detalhes?: DetalheErro[],
): Response {
  return Response.json(
    { erro: { codigo, mensagem, ...(detalhes?.length ? { detalhes } : {}) } },
    { status: STATUS_POR_CODIGO[codigo], headers: CABECALHOS_BASE },
  );
}

// ------------------------------------------------------- classificacao de erro

/** Codigos SQLSTATE que indicam problema transitorio, nao defeito de codigo. */
const SQLSTATE_TIMEOUT = new Set(["57014", "55P03"]);
const SQLSTATE_INDISPONIVEL = new Set(["08000", "08003", "08006", "53300", "57P01", "57P03"]);
const ERRNO_CONEXAO = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH"]);

function codigoDoErro(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

/**
 * Traduz uma falha em codigo de resposta, sem repassar a mensagem original.
 *
 * O `console.error` aqui e o unico lugar onde o detalhe aparece -- e vai para o
 * log do container, nao para o navegador.
 */
export function traduzirFalha(rota: string, err: unknown): Response {
  if (err instanceof ErroDeValidacao) {
    return respostaErro("parametros-invalidos", err.message, err.detalhes);
  }

  // Recusa deliberada de uma camada de dominio: a mensagem ja foi escrita para
  // o usuario final e nao passa pelo log de erro.
  if (err instanceof ErroDeApi) {
    return respostaErro(err.codigo, err.message);
  }

  const codigo = codigoDoErro(err);
  const mensagem = err instanceof Error ? err.message : String(err);

  console.error(`[api] ${rota} falhou`, { codigo, mensagem });

  if (codigo && SQLSTATE_TIMEOUT.has(codigo)) {
    return respostaErro(
      "consulta-excedeu-tempo",
      "A consulta demorou mais do que o limite. Reduza o periodo ou a quantidade de contas.",
    );
  }

  if (codigo && (SQLSTATE_INDISPONIVEL.has(codigo) || ERRNO_CONEXAO.has(codigo))) {
    return respostaErro(
      "banco-indisponivel",
      "Nao foi possivel falar com o banco de dados no momento.",
    );
  }

  return respostaErro("erro-interno", "Erro interno ao processar a consulta.");
}
