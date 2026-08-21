import "server-only";

import { LIMITACOES, invoicingHabilitado } from "@/lib/billing/aws-invoicing";
import {
  calcularCiclo,
  descreverFechada,
  type CicloDeFatura,
} from "@/lib/billing/ciclo";
import {
  CANAIS,
  montarAvisos,
  type AvisoDeFatura,
  type CanalDeAviso,
} from "@/lib/billing/notificacoes";
import { getEnv } from "@/lib/env";
import { listarFaturamento, type ContaFaturamento } from "@/lib/queries/billing";
import { diaEm, diasEntre } from "@/lib/tempo/calendario";

/**
 * Uma unica montagem do faturamento, consumida pela tela e pelas tres rotas.
 *
 * Se cada uma montasse a sua, a tela poderia dizer "fecha em 3 dias" enquanto
 * /api/billing/notifications dissesse "fecha hoje" -- e a area que existe para
 * avisar sobre prazo seria a primeira a discordar de si mesma sobre que dia e.
 */

export type LinhaDeFaturamento = ContaFaturamento & {
  ciclo: CicloDeFatura;
  /** "Fatura fechou há X dias", quando aplicavel. */
  descricaoDaFechada: string | null;
  /** Competencia da fatura ja fechada -- "AAAA-MM". */
  competencia: string | null;
  /** Vencimento em vigor: o registrado a mao vence a regra mensal. */
  vencimentoEfetivo: string | null;
  /** Dias de atraso, quando o vencimento ja passou e nao ha confirmacao. */
  diasDeAtraso: number | null;
};

export type ResumoFaturamento = {
  /** Contas cujo ciclo fecha dentro da antecedencia configurada (ou hoje). */
  proximasDoFechamento: number;
  /** Fatura fechada sem confirmacao de pagamento. */
  pagamentosPendentes: number;
  /** Passou do vencimento sem confirmacao. */
  pagamentosVencidos: number;
  /** Contas sem dia de fechamento configurado. */
  semConfiguracao: number;
};

export type Faturamento = {
  disponivel: boolean;
  hoje: string;
  linhas: LinhaDeFaturamento[];
  resumo: ResumoFaturamento;
  avisos: AvisoDeFatura[];
  canais: readonly CanalDeAviso[];
  integracaoAws: {
    habilitada: boolean;
    limitacoes: readonly string[];
  };
};

export async function montarFaturamento(): Promise<Faturamento> {
  const tz = getEnv().APP_TZ;
  // UM instante para toda a montagem. Calcular "hoje" em cada regra abriria a
  // chance de o resumo ser contado as 23:59:59 e a tabela as 00:00:00, com a
  // tela afirmando duas coisas incompativeis sobre o mesmo dia.
  const hoje = diaEm(tz, new Date());

  const contas = await listarFaturamento(tz);

  const linhas: LinhaDeFaturamento[] = contas.map((conta) => {
    const ciclo = calcularCiclo(
      {
        diaDeFechamento: conta.invoiceCloseDay,
        diaDeVencimento: conta.invoiceDueDay,
        diasDeAviso: conta.invoiceNotificationDaysBefore,
      },
      hoje,
    );

    // O vencimento registrado a mao tem precedencia sobre a regra mensal: ele e
    // o caso concreto (prorrogacao, feriado, acordo), e a regra e so o padrao.
    const vencimentoEfetivo = conta.paymentDueDate ?? ciclo.vencimentoDaFaturaFechada;

    const confirmado = conta.paymentStatus === "paid";
    const atraso =
      !confirmado && vencimentoEfetivo ? diasEntre(vencimentoEfetivo, hoje) : null;

    return {
      ...conta,
      ciclo,
      descricaoDaFechada: descreverFechada(ciclo),
      competencia: ciclo.ultimoFechamento?.slice(0, 7) ?? null,
      vencimentoEfetivo,
      diasDeAtraso: atraso !== null && atraso > 0 ? atraso : null,
    };
  });

  const avisos = montarAvisos(
    contas.map((c) => ({
      accountId: c.accountId,
      nomeExibicao: c.nomeExibicao,
      configuracao: {
        diaDeFechamento: c.invoiceCloseDay,
        diaDeVencimento: c.invoiceDueDay,
        diasDeAviso: c.invoiceNotificationDaysBefore,
      },
      status: c.paymentStatus,
      fonte: c.paymentStatusSource,
      vencimentoRegistrado: c.paymentDueDate,
    })),
    hoje,
  );

  return {
    disponivel: true,
    hoje,
    linhas,
    resumo: resumir(linhas),
    avisos,
    canais: CANAIS,
    integracaoAws: {
      habilitada: invoicingHabilitado(),
      limitacoes: LIMITACOES,
    },
  };
}

/**
 * Os quatro cards.
 *
 * "Pendente" aqui NAO e o status `pending` digitado: e a situacao de fato --
 * fatura fechada e sem confirmacao de pagamento. Contar apenas quem foi marcado
 * como `pending` esconderia justamente as contas que ninguem tocou, que sao as
 * que precisam de atencao. `manual_review` fica de fora dos dois contadores de
 * cobranca porque ja esta com alguem.
 */
function resumir(linhas: LinhaDeFaturamento[]): ResumoFaturamento {
  const semConfirmacao = (l: LinhaDeFaturamento) =>
    l.paymentStatus !== "paid" && l.paymentStatus !== "manual_review";

  return {
    proximasDoFechamento: linhas.filter(
      (l) => l.ciclo.situacao === "fecha_em_breve" || l.ciclo.situacao === "fecha_hoje",
    ).length,
    pagamentosPendentes: linhas.filter(
      (l) => l.ciclo.ultimoFechamento !== null && semConfirmacao(l) && l.diasDeAtraso === null,
    ).length,
    pagamentosVencidos: linhas.filter((l) => semConfirmacao(l) && l.diasDeAtraso !== null)
      .length,
    semConfiguracao: linhas.filter((l) => l.ciclo.situacao === "sem_configuracao").length,
  };
}
