import { FONTES_OVH, type FonteOvh } from "@/lib/filtros/esquemas";

/**
 * Regras da visao OVH do dashboard: o que a AUSENCIA de dado significa, e em
 * que moeda o recorte pode ser somado.
 *
 * MODULO PURO, no arranjo de `dashboard/analitico.ts` e `diagnostico/ovh.ts`:
 * recebe o que foi lido, devolve decisao. Nada aqui abre conexao, e por isso
 * cada regra e verificavel em teste.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE ESTE MODULO EXISTE PARA SUSTENTAR
 *
 * Ausencia de dado NAO e custo zero. Sao afirmacoes diferentes:
 *
 *   "US$ 0,00"     -> a OVH cobrou zero neste periodo
 *   "sem dado"     -> ninguem sabe quanto a OVH cobrou
 *
 * A primeira e uma informacao financeira; a segunda e a confissao de que ela
 * nao existe. Exibir a primeira quando a verdade e a segunda faz o portal
 * mentir com aparencia de precisao -- e num painel executivo, um zero passa por
 * "esta sob controle".
 *
 * Por isso `decidirEstadoDado` distingue QUATRO ausencias, cada uma com uma
 * acao diferente do outro lado:
 *
 *   sem-integracao    a migracao 005 nao rodou    -> rodar a migracao
 *   sem-nenhum-dado   o collector nunca importou  -> rodar o collector
 *   fonte-sem-dado    a API nao devolve essa origem -> nada a fazer, e normal
 *   periodo-sem-dado  ha dado, mas nao nesta janela -> mudar o filtro
 * ---------------------------------------------------------------------------
 */

export type EstadoDadoOvh =
  /** Tabelas `ovh_*` nao existem: migracao 005 nao aplicada. */
  | "sem-integracao"
  /** Tabelas existem e `ovh_monthly_costs` esta completamente vazia. */
  | "sem-nenhum-dado"
  /** Ha custo OVH no banco, mas nenhuma linha da origem escolhida. */
  | "fonte-sem-dado"
  /** A origem tem linha em algum mes, nenhuma dentro da janela pedida. */
  | "periodo-sem-dado"
  /** Ha dado para exibir. */
  | "ok";

export type EntradaEstadoOvh = {
  /** `false` quando a migracao 005 ainda nao rodou. */
  instalado: boolean;
  /** `true` quando existe pelo menos uma linha em `ovh_monthly_costs`. */
  temAlgumDado: boolean;
  /** Origens que possuem ao menos uma linha, em qualquer mes. */
  fontesComDado: readonly FonteOvh[];
  /** Origem escolhida no filtro. */
  source: FonteOvh;
  /** Linhas encontradas DENTRO da janela, para a origem escolhida. */
  linhasNoPeriodo: number;
};

export function decidirEstadoDado(e: EntradaEstadoOvh): EstadoDadoOvh {
  if (!e.instalado) return "sem-integracao";
  if (!e.temAlgumDado) return "sem-nenhum-dado";
  if (!e.fontesComDado.includes(e.source)) return "fonte-sem-dado";
  if (e.linhasNoPeriodo === 0) return "periodo-sem-dado";
  return "ok";
}

/** `true` quando nao ha numero para mostrar -- a tela exibe texto, nao "0,00". */
export function semDado(estado: EstadoDadoOvh): boolean {
  return estado !== "ok";
}

/**
 * A tela está na visão OVH?
 *
 * Regra única, em vez de `params.get("provider") === "ovh"` repetido no
 * cabeçalho, nas abas e no conteúdo. Os três precisam concordar: se divergirem,
 * o cabeçalho diz "Visão OVH" com tabela AWS embaixo — e ninguém percebe até
 * comparar um número com a fatura.
 *
 * Qualquer outro valor, inclusive nenhum, é AWS. Ela é o padrão histórico, e um
 * valor digitado errado na URL não deve trocar o provedor exibido em silêncio.
 */
export function ehVisaoOvh(params: { get(k: string): string | null }): boolean {
  return params.get("provider") === "ovh";
}

export const ROTULO_FONTE = {
  invoice: "Faturado",
  usage_current: "Uso corrente",
  usage_forecast: "Previsão",
} as const satisfies Record<FonteOvh, string>;

/**
 * O que cada origem significa. Sai no cabecalho do painel: sem isso, "Uso
 * corrente" e "Faturado" parecem dois jeitos de dizer a mesma coisa, e a
 * diferenca entre eles e exatamente o que impede de somar os dois.
 */
export const DESCRICAO_FONTE = {
  invoice: "custo realizado, o que a OVH efetivamente faturou",
  usage_current: "consumo do mês em andamento, ainda não faturado",
  usage_forecast: "projeção da OVH para o fechamento, nunca custo realizado",
} as const satisfies Record<FonteOvh, string>;

/**
 * Mensagens de ausencia, por estado.
 *
 * As duas de `usage_*` estao no texto exato pedido pela especificacao. Elas
 * dizem "retornados pela API OVH" de proposito: a ausencia dessas origens nao e
 * defeito do portal nem falha de coleta -- a API da OVH responde
 * `no usages found` para projeto Public Cloud sem consumo registrado, e foi
 * isso que aconteceu em producao. Culpar a coleta mandaria o operador procurar
 * um problema que nao existe.
 */
export function mensagemDeAusencia(
  estado: EstadoDadoOvh,
  source: FonteOvh,
): string | null {
  switch (estado) {
    case "sem-integracao":
      return "Integração OVH não instalada neste banco: as tabelas ovh_* não existem.";
    case "sem-nenhum-dado":
      return "Nenhum dado OVH importado ainda.";
    case "fonte-sem-dado":
      return source === "usage_current"
        ? "Sem dados de uso corrente retornados pela API OVH."
        : source === "usage_forecast"
          ? "Sem dados de previsão retornados pela API OVH."
          : "Nenhuma fatura OVH importada ainda.";
    case "periodo-sem-dado":
      return `Nenhum custo OVH com origem “${ROTULO_FONTE[source]}” no período selecionado.`;
    case "ok":
      return null;
  }
}

/**
 * Detalhe de apoio da mensagem acima. Separado do titulo porque o componente
 * `Vazio` recebe titulo e corpo, e porque a frase que diz "isto nao e custo
 * zero" precisa aparecer inteira, nao truncada num titulo.
 */
export function detalheDeAusencia(estado: EstadoDadoOvh): string | null {
  switch (estado) {
    case "sem-integracao":
      return "Rode scripts/migrations/005-ovh-collector.sql para habilitar a coleta.";
    case "sem-nenhum-dado":
      return (
        "Isto não é custo zero: é ausência de importação. Confira a última " +
        "execução do collector no bloco de sincronização abaixo."
      );
    case "fonte-sem-dado":
      return (
        "Não é falha da coleta: a API da OVH não devolveu linhas para esta " +
        "origem. As demais origens seguem disponíveis no filtro."
      );
    case "periodo-sem-dado":
      return (
        "Existe custo desta origem em outros meses. Amplie o período ou " +
        "remova o filtro de projeto."
      );
    case "ok":
      return null;
  }
}

// -------------------------------------------------------------------- moeda

export type TotalPorMoeda = { moeda: string; total: number; linhas: number };

export type EscolhaDeMoeda = {
  /** Moeda em que os graficos e o total serao apresentados. */
  moeda: string | null;
  /**
   * Moedas presentes no recorte que ficaram DE FORA. Nunca somadas ao total:
   * a tela lista cada uma com o proprio valor.
   */
  outras: TotalPorMoeda[];
};

/**
 * Escolhe UMA moeda para o recorte. Nunca soma duas.
 *
 * `ovh_monthly_costs.currency` e por linha e o DDL tem default 'EUR'. Hoje a
 * conta fatura em USD e as 512 linhas de producao sao todas USD, mas nada no
 * banco impede a segunda moeda -- basta uma conta europeia entrar no collector.
 *
 * No dia em que isso acontecer, somar produz um numero que nao responde
 * pergunta nenhuma, e converter exige uma taxa de cambio EUR/USD que o portal
 * nao tem (a cotacao do Banco Central que ele consulta e USD/BRL). Entao a
 * escolha e a maior por volume, dita na tela, com as outras listadas ao lado.
 *
 * `preferida` permite fixar a moeda pela URL, para quem quer olhar a menor.
 */
export function escolherMoeda(
  totais: readonly TotalPorMoeda[],
  preferida?: string,
): EscolhaDeMoeda {
  if (totais.length === 0) return { moeda: null, outras: [] };

  const alvo = preferida
    ? totais.find((t) => t.moeda === preferida.toUpperCase())
    : undefined;

  // Empate resolvido pelo codigo da moeda: sem isso a escolha dependeria da
  // ordem que o Postgres devolveu, e a tela trocaria de moeda entre dois
  // carregamentos iguais.
  const escolhida =
    alvo ??
    [...totais].sort((a, b) => b.total - a.total || a.moeda.localeCompare(b.moeda))[0];

  return {
    moeda: escolhida.moeda,
    outras: totais.filter((t) => t.moeda !== escolhida.moeda),
  };
}

/**
 * `true` quando a estimativa em BRL pode ser calculada.
 *
 * A cotacao que o portal busca no Banco Central e USD/BRL. Aplica-la a um valor
 * em euro daria um numero com cara de real e sem relacao com a fatura -- pior
 * do que nao mostrar estimativa nenhuma.
 */
export function podeEstimarBRL(moeda: string | null): boolean {
  return moeda === "USD";
}

// -------------------------------------------------------------- participacao

/** Fracao de cada item no total, para a barra de distribuicao. */
export function participacao(valor: number, total: number): number {
  return total > 0 ? valor / total : 0;
}

/**
 * Variacao entre janela atual e anterior.
 *
 * `null` quando a anterior e zero: dividir por zero daria Infinity, e "+∞%"
 * nao e informacao. A tela mostra "—" e o valor absoluto ao lado.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return (atual - anterior) / anterior;
}

/** As tres origens, na ordem em que aparecem no filtro. */
export const FONTES_NA_ORDEM: readonly FonteOvh[] = FONTES_OVH;

// ------------------------------------------------------- status do collector

/**
 * Rotulo curto de cada situacao do collector, para o card de status.
 *
 * A especificacao pediu quatro estados -- success / failed / atrasado / sem
 * execucao -- e `decidirSituacaoOvh` (em `diagnostico/ovh.ts`) devolve sete.
 * Este mapa nao COLAPSA os sete em quatro: ele traduz cada um, porque os tres
 * que sobram nao sao redundantes e agrupa-los perderia informacao acionavel.
 *
 *   em_execucao        nao e sucesso nem falha: e "espere dois minutos"
 *   nunca_teve_sucesso pior que "falhou": nenhum dado jamais foi completo
 *   erro_de_leitura    a TELA nao conseguiu perguntar; nao diz nada da coleta
 *
 * Chamar "falhou" a um dos tres mandaria o operador investigar a coisa errada.
 */
export const ROTULO_SITUACAO_COLLECTOR = {
  ok: "Coleta em dia",
  dado_velho: "Atrasado",
  ultima_falhou: "Última coleta falhou",
  nunca_teve_sucesso: "Nunca concluiu",
  nunca_executado: "Sem execução",
  em_execucao: "Em execução",
  erro_de_leitura: "Não foi possível ler",
  nao_instalado: "Não instalado",
} as const;

export type SituacaoCollector = keyof typeof ROTULO_SITUACAO_COLLECTOR;

/** Tom do selo. Só `ok` e verde -- qualquer outra coisa merece atenção visual. */
export function tomDaSituacao(
  situacao: SituacaoCollector,
): "ok" | "atencao" | "critico" | "neutro" {
  switch (situacao) {
    case "ok":
      return "ok";
    case "dado_velho":
    case "em_execucao":
      return "atencao";
    case "ultima_falhou":
    case "nunca_teve_sucesso":
    case "erro_de_leitura":
      return "critico";
    case "nunca_executado":
    case "nao_instalado":
      return "neutro";
  }
}
