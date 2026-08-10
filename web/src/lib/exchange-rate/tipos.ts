/**
 * Cotacao USD/BRL.
 *
 * ATENCAO AO SIGNIFICADO DO NUMERO: a conversao para BRL nesta aplicacao e
 * ESTIMATIVA VISUAL. O valor contabil e o que a AWS fatura, em USD. A cotacao
 * PTAX de um dia nao e a taxa que o cartao ou o contrato de cambio aplicou na
 * fatura -- essa depende da data de fechamento, do spread do emissor e do IOF.
 *
 * Por isso nada daqui e gravado nas tabelas financeiras. A estimativa e
 * calculada na hora da leitura e some junto com a resposta.
 */

/** Sem dependencia de runtime: pode ser importado por componente de cliente. */

export type ProvedorCotacao = "ptax" | "sgs" | "nenhum";

/**
 * - `current`      buscada do provedor agora
 * - `cached`       veio do cache (ver `desatualizada` para saber se ainda vale)
 * - `unavailable`  nao ha cotacao para exibir; a tela continua em USD
 */
export type StatusCotacao = "current" | "cached" | "unavailable";

export type Cotacao = {
  /** Reais por dolar. `null` quando `status` e `unavailable`. */
  valor: number | null;

  /** Dia de referencia da cotacao, "AAAA-MM-DD". */
  dataReferencia: string | null;

  /**
   * Instante exato do boletim, em ISO. `null` quando a fonte informa apenas o
   * dia (caso do SGS) -- nao inventamos hora que a fonte nao deu.
   */
  dataHoraReferencia: string | null;

  /** Rotulo legivel da origem, para exibir junto do numero. */
  fonte: string;

  provedor: ProvedorCotacao;

  status: StatusCotacao;

  /**
   * `true` quando o cache passou do TTL e a tentativa de renovar falhou. O
   * numero ainda serve para dar ordem de grandeza, mas a interface precisa
   * marcar visualmente que esta velho.
   */
  desatualizada: boolean;

  /** Frase pronta para o usuario. `null` quando deu tudo certo. */
  mensagemErro: string | null;

  /** Quando ESTA aplicacao obteve o valor do provedor, em ISO. */
  obtidaEm: string | null;

  /** Idade do dado em cache, em segundos. `null` quando recem-buscada. */
  idadeSegundos: number | null;
};

/** O que um provedor devolve. O resto do objeto e montado pelo orquestrador. */
export type CotacaoBruta = {
  valor: number;
  dataReferencia: string;
  dataHoraReferencia: string | null;
};

/** Erro de integracao com mensagem ja amigavel para o usuario final. */
export class ErroDeCotacao extends Error {
  /** Texto exibivel. Sem detalhe tecnico, host ou stack. */
  readonly mensagemAmigavel: string;

  constructor(mensagemAmigavel: string, causa?: unknown) {
    super(mensagemAmigavel, causa === undefined ? undefined : { cause: causa });
    this.name = "ErroDeCotacao";
    this.mensagemAmigavel = mensagemAmigavel;
  }
}

/** Estimativa de custo em BRL a partir de um valor em USD. */
export type EstimativaBRL = {
  /** `null` quando nao ha cotacao disponivel -- nunca zero, que seria mentira. */
  total: number | null;
  totalAnterior: number | null;
  cotacao: Cotacao;
  /** Lembrete que acompanha o numero em toda resposta da API. */
  aviso: string;
};
