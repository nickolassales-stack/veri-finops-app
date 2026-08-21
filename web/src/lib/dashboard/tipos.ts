import type { Cotacao } from "@/lib/exchange-rate/tipos";

/**
 * Contrato das respostas da API, do ponto de vista do navegador.
 *
 * Declarado aqui, e nao reaproveitado de `lib/queries/*`, de proposito: aqueles
 * modulos sao `server-only` e carregam o driver do Postgres. O que o cliente
 * conhece e o JSON -- que e uma fronteira propria e deve poder mudar de forma
 * independente do formato das linhas do banco.
 */

export type MetaPeriodo = {
  preset: string;
  rotulo: string;
  de: string;
  ate: string;
  dias: number;
  anterior: { de: string; ate: string; dias: number };
  limitadoPorDadoDisponivel: boolean;
  existeDadoAlemDaJanela: boolean;
};

export type Aviso = { codigo: string; mensagem: string };

export type MetaResposta = {
  moeda: "USD";
  timezone: string;
  geradoEm: string;
  periodo?: MetaPeriodo;
  filtros?: { contas: string[]; todasAsContas: boolean; regiao: string | null };
  base?: { hoje: string; maiorDataComDado: string | null };
  avisos?: Aviso[];
  paginacao?: { pagina: number; tamanho: number; total: number; paginas: number };
  totalDaJanela?: number;
  outros?: number;
  servicosNaJanela?: number;
  diasSemDado?: number;
  agrupouEmOutros?: boolean;
};

export type Envelope<T> = { dados: T; meta: MetaResposta };

export type ErroApi = {
  erro: { codigo: string; mensagem: string; detalhes?: { campo: string; mensagem: string }[] };
};

// ------------------------------------------------------------------- recursos

export type Conta = {
  accountId: string;
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  active: boolean;
  /** `cloud_accounts.provider`: "aws" ou "ovh". */
  provider: string;
};

export type EstimativaBRL = {
  total: number | null;
  totalAnterior: number | null;
  cotacao: Cotacao;
  aviso: string;
};

export type Resumo = {
  total: number;
  totalAnterior: number;
  variacao: number | null;
  comparavel: boolean;
  contasComCusto: number;
  contasComCustoAnterior: number;
  contasAtivasCadastradas: number;
  servicos: number;
  diasComDado: number;
  primeiroDiaComDado: string | null;
  ultimoDiaComDado: string | null;
  mediaDiaria: number;
  /**
   * Parte do `total` que a AWS faturou neste periodo com data de uso em OUTRO
   * mes -- tipicamente cobranca pontual (registro de dominio, taxa anual).
   *
   * Zero na quase totalidade dos recortes. Quando nao e zero, e exatamente a
   * diferenca entre este card e a soma do grafico diario, que segue a data de
   * uso. A tela precisa dizer isso, senao a divergencia parece erro de conta.
   */
  custoDeslocado: number;
  linhasDeslocadas: number;
  estimativaBRL: EstimativaBRL;
};

export type CustoDaConta = {
  accountId: string;
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  active: boolean;
  cadastrada: boolean;
  total: number;
  totalAnterior: number;
  variacao: number | null;
  participacao: number;
  temDadoNaJanela: boolean;
};

export type CustoDoServico = {
  servico: string;
  total: number;
  totalAnterior: number;
  variacao: number | null;
  participacao: number;
};

export type PontoDiario = {
  data: string;
  total: number;
  contas: number;
  semDado: boolean;
};

export type SerieDeServico = { nome: string; total: number; valores: number[] };

export type DiarioPorServico = { dias: string[]; series: SerieDeServico[] };

export type { Cotacao };
