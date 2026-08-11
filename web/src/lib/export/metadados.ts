import type { Cotacao } from "@/lib/exchange-rate/tipos";
import {
  formatCotacao,
  formatDataHora,
  formatInteiro,
  formatIntervalo,
} from "@/lib/format";

import { referenciaDaCotacao } from "./colunas";

/**
 * Cabecalho de contexto do arquivo exportado.
 *
 * Uma planilha de custo vira anexo de e-mail, entra em apresentacao e e aberta
 * meses depois por quem nao fez a consulta. Sem o recorte gravado DENTRO do
 * arquivo, ninguem consegue dizer se aqueles R$ referem-se a uma conta ou a
 * todas, a um mes ou ao ano -- e um numero sem recorte conhecido nao e
 * informacao, e armadilha.
 *
 * Modulo PURO: so recebe o que ja foi resolvido. Testavel direto.
 */

export type ParMetadado = { rotulo: string; valor: string };

export type ContaSelecionada = { id: string; nome: string | null };

export type ContextoExportacao = {
  periodo: {
    de: string;
    ate: string;
    dias: number;
    /** A janela terminou antes do pedido porque o ETL nao carregou alem disso. */
    limitadoPorDadoDisponivel: boolean;
  };
  /** Vazio significa "todas as contas" -- nunca ha id fixo no codigo. */
  contas: ContaSelecionada[];
  busca: string | null;
  regiao: string | null;
  ordenacao: { campo: string; direcao: "asc" | "desc" };
  totalLinhas: number;
  cotacao: Cotacao;
  /** Instante da exportacao, ISO. */
  geradoEm: string;
  tz: string;
};

export const AVISO_USD =
  "Os valores em USD são os oficiais, exatamente como vieram da AWS. " +
  "É esta a coluna que vale para conferência e contabilidade.";

export const AVISO_BRL =
  "Os valores em BRL são ESTIMATIVA, calculados na hora da exportação pela " +
  "cotação de referência informada acima. Não consideram spread do emissor " +
  "nem IOF, então não correspondem ao valor da fatura e não servem para " +
  "contabilidade.";

/** Rotulo legivel do campo de ordenacao, para o cabecalho do arquivo. */
const ROTULOS_ORDENACAO: Record<string, string> = {
  usageDate: "data de uso",
  accountId: "conta AWS",
  accountName: "nome da conta",
  service: "serviço",
  region: "região",
  cost: "valor USD",
};

/**
 * `veri-finops-AAAA-MM-DD_AAAA-MM-DD.csv`
 *
 * As datas sao as do periodo EFETIVAMENTE aplicado, ja resolvido pelo servidor
 * (inclusive o corte pela ultima carga do ETL). Assim dois arquivos com nomes
 * iguais tem o mesmo conteudo, e o nome nunca promete um periodo que o arquivo
 * nao contem.
 */
export function nomeDoArquivo(de: string, ate: string, extensao: "csv" | "xlsx"): string {
  return `veri-finops-${de}_${ate}.${extensao}`;
}

export function descreverContas(contas: ContaSelecionada[]): string {
  if (contas.length === 0) return "Todas as contas cadastradas";
  return contas
    .map((c) => (c.nome ? `${c.nome} (${c.id})` : `${c.id} (sem cadastro)`))
    .join("; ");
}

export function descreverStatusCotacao(cotacao: Cotacao): string {
  if (cotacao.status === "unavailable") {
    return `indisponível — ${cotacao.mensagemErro ?? "não foi possível obter a cotação"}`;
  }
  if (cotacao.status === "cached") {
    return cotacao.desatualizada
      ? "em cache e DESATUALIZADA — a renovação falhou; é o último valor conhecido"
      : "em cache (dentro da validade)";
  }
  return "atual — obtida do provedor nesta exportação";
}

export function montarMetadados(ctx: ContextoExportacao): ParMetadado[] {
  const { cotacao } = ctx;
  const semCotacao = cotacao.valor === null;

  const pares: ParMetadado[] = [
    { rotulo: "Relatório", valor: "VERI FinOps — analítico de custos AWS" },
    { rotulo: "Origem", valor: "PostgreSQL FinOps · tabela aws_daily_costs" },
    {
      rotulo: "Período da consulta",
      valor:
        `${formatIntervalo(ctx.periodo.de, ctx.periodo.ate)} (${formatInteiro(ctx.periodo.dias)} dia(s))` +
        (ctx.periodo.limitadoPorDadoDisponivel
          ? " — encurtado até a última carga do ETL"
          : ""),
    },
    { rotulo: "Contas selecionadas", valor: descreverContas(ctx.contas) },
    { rotulo: "Filtro de serviço", valor: ctx.busca ? `contém "${ctx.busca}"` : "nenhum" },
    {
      rotulo: "Filtro de região",
      valor:
        ctx.regiao === null
          ? "nenhum"
          : ctx.regiao === "nao-informado"
            ? "somente linhas sem região informada"
            : ctx.regiao,
    },
    {
      rotulo: "Ordenação",
      valor: `${ROTULOS_ORDENACAO[ctx.ordenacao.campo] ?? ctx.ordenacao.campo} (${
        ctx.ordenacao.direcao === "asc" ? "crescente" : "decrescente"
      })`,
    },
    { rotulo: "Linhas exportadas", valor: formatInteiro(ctx.totalLinhas) },
    {
      rotulo: "Data e hora da exportação",
      valor: `${formatDataHora(ctx.geradoEm, ctx.tz)} (${ctx.tz})`,
    },
    { rotulo: "Fonte da cotação", valor: cotacao.fonte },
    {
      rotulo: "Cotação utilizada",
      valor: semCotacao ? "—" : `R$ ${formatCotacao(cotacao.valor)} por US$ 1,00`,
    },
    {
      rotulo: "Referência da cotação",
      valor: referenciaDaCotacao({ cotacao, tz: ctx.tz }) ?? "—",
    },
    { rotulo: "Status da cotação", valor: descreverStatusCotacao(cotacao) },
    { rotulo: "Aviso — dólar", valor: AVISO_USD },
    {
      rotulo: "Aviso — real",
      valor: semCotacao
        ? "A cotação não estava disponível nesta exportação, então a coluna de " +
          "BRL saiu vazia. Os valores em USD acima seguem exatos."
        : AVISO_BRL,
    },
  ];

  return pares;
}
