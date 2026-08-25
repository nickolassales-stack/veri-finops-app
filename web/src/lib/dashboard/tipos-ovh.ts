import type { EstadoDadoOvh, SituacaoCollector, TotalPorMoeda } from "./ovh";
import type { Cotacao } from "@/lib/exchange-rate/tipos";
import type { FonteOvh } from "@/lib/filtros/esquemas";

/**
 * Contrato das respostas da visao OVH, do ponto de vista do navegador.
 *
 * Declarado aqui, e nao reaproveitado de `lib/queries/dashboard-ovh.ts`, pela
 * mesma razao de `tipos.ts`: aquele modulo e `server-only` e carrega o driver do
 * Postgres. O que o cliente conhece e o JSON, que e uma fronteira propria.
 *
 * ---------------------------------------------------------------------------
 * `total: number | null` -- O NULL E O CONTRATO
 *
 * Todo valor monetario aqui e anulavel, e `null` NAO deve ser tratado como zero
 * em nenhum ponto da interface. `0` significa "a OVH cobrou zero"; `null`
 * significa "nao existe afirmacao sobre esse custo". Um `?? 0` no componente
 * transforma a segunda na primeira e faz o painel executivo mentir com
 * aparencia de precisao.
 * ---------------------------------------------------------------------------
 */

export type MetaPeriodoMensal = {
  preset: string;
  rotulo: string;
  deMes: string;
  ateMes: string;
  meses: number;
  anterior: { deMes: string; ateMes: string; meses: number };
};

export type MetaFiltrosOvh = {
  source: FonteOvh;
  /** Ids das contas do recorte. Vazio quando o recorte e "todas". */
  contas: string[];
  todasAsContas: boolean;
  projeto: string | null;
  todosOsProjetos: boolean;
  /**
   * A moeda AUTORITATIVA da resposta.
   *
   * Fica aqui, e nao no topo do `meta`, porque o envelope compartilhado grava
   * `moeda: "USD"` fixo depois de espalhar o meta da rota. Para a visao OVH,
   * este e o campo que vale.
   */
  moeda: string | null;
  moedasIgnoradas: TotalPorMoeda[];
};

export type MetaDisponibilidadeOvh = {
  instalado: boolean;
  temAlgumDado: boolean;
  fontesComDado: FonteOvh[];
  moedasNoPeriodo: TotalPorMoeda[];
};

export type MetaOvh = {
  moeda: "USD";
  timezone: string;
  geradoEm: string;
  periodo: MetaPeriodoMensal;
  filtros: MetaFiltrosOvh;
  disponibilidade: MetaDisponibilidadeOvh;
  estado: EstadoDadoOvh;
  ausencia: { mensagem: string | null; detalhe: string | null };
  base: { hoje: string; mesCorrente: string };
  avisos?: { codigo: string; mensagem: string }[];
  /** `services`: total da janela e o resto agrupado. */
  totalDaJanela?: number | null;
  outros?: number;
  servicosNaJanela?: number;
  agrupouEmOutros?: boolean;
  /** `monthly`: quantos meses da janela tem linha. */
  mesesComDado?: number;
  /** Opcoes do seletor de contas -- do CADASTRO do portal, nao do collector. */
  contasDisponiveis?: ContaOvhDisponivel[];
  /** `projects`: opcoes do seletor de projeto. */
  projetosDisponiveis?: ProjetoDisponivel[];
  custoSemProjeto?: number;
  /** `invoices`: faturas sem `billing_month` no banco. */
  semMesAtribuido?: number;
  limite?: number;
  truncado?: boolean;
};

export type EstimativaBRLOvh = {
  total: number | null;
  totalAnterior: number | null;
  cotacao: Cotacao;
  aviso: string;
};

export type ResumoOvhCliente = {
  estado: EstadoDadoOvh;
  total: number | null;
  totalAnterior: number | null;
  variacao: number | null;
  linhas: number;
  projetosComCusto: number;
  /** `count(*)` de `ovh_projects` -- independe de janela e de origem. */
  projetosCadastrados: number;
  servicos: number;
  mesesComDado: number;
  primeiroMes: string | null;
  ultimoMes: string | null;
  custoSemProjeto: number | null;
  faturas: number;
  /** `null` quando a moeda nao e USD: a cotacao do portal e USD/BRL. */
  estimativaBRL: EstimativaBRLOvh | null;
};

export type PontoMensalOvhCliente = {
  mes: string;
  /** `null` = mes sem fatura. A linha do grafico tem buraco, nao mergulha a zero. */
  total: number | null;
  linhas: number;
};

export type ServicoOvhCliente = {
  servico: string;
  /** `null` quando o rotulo aparece em mais de uma categoria, ou em nenhuma. */
  categoria: string | null;
  total: number;
  linhas: number;
  participacao: number;
};

export type ProjetoOvhCliente = {
  servicoDoProjeto: string;
  nome: string | null;
  /** Custo de fatura nao atribuido a projeto -- taxa de dominio, assinatura. */
  semProjeto: boolean;
  total: number;
  linhas: number;
  participacao: number;
};

export type ProjetoDisponivel = { servicoDoProjeto: string; nome: string };

/**
 * Uma conta OVH ativa, como o seletor a recebe.
 *
 * Espelha `ContaOvhDoCadastro` do servidor. `unidade` alimenta a segunda linha
 * do seletor, junto do id -- "ovh-main-ca · ti".
 */
export type ContaOvhDisponivel = {
  id: string;
  nome: string;
  unidade?: string | null;
};

export type FaturaOvhCliente = {
  billId: string;
  billDate: string | null;
  billingMonth: string | null;
  totalComImposto: number;
  totalSemImposto: number;
  imposto: number;
  /** Moeda da fatura. `"—"` quando o cabecalho veio sem `currency`. */
  moeda: string;
  linhas: number;
};

export type ExecucaoOvhCliente = {
  id: number;
  status: string;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  costRows: number;
  invoiceRows: number;
};

/** Conta OVH integrada. Espelha `ContaOvh` do servidor -- sem `nichandle`. */
export type ContaOvhCliente = {
  providerAccountId: string;
  alias: string | null;
  moeda: string | null;
  estado: string | null;
};

/** Situacao da ULTIMA coleta de UMA conta. Espelha `SituacaoContaOvh`. */
export type ContaColetadaCliente = {
  id: string;
  nome: string;
  ultimoStatus: string | null;
  ultimoFim: string | null;
  /** `null` quando a migracao 006 nao rodou -- "nao sei", nao "nao tem". */
  temCredencial: boolean | null;
};

export type SincronizacaoOvh = {
  situacao: SituacaoCollector;
  rotulo: string;
  tom: "ok" | "atencao" | "critico" | "neutro";
  ultima: ExecucaoOvhCliente | null;
  ultimoSucesso: ExecucaoOvhCliente | null;
  /** Vazio quando o collector nunca sincronizou conta alguma. */
  contas: ContaOvhCliente[];
  /** Uma linha por conta ATIVA do cadastro -- alimenta o resumo do recorte. */
  porConta: ContaColetadaCliente[];
};

export type { EstadoDadoOvh, FonteOvh, SituacaoCollector, TotalPorMoeda };
