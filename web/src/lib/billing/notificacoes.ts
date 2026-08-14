/**
 * Avisos de faturamento.
 *
 * MODULO PURO. Recebe as contas ja resolvidas e a data de hoje; devolve a lista
 * de avisos. Nada aqui abre conexao, e por isso cada regra tem teste -- "faltam
 * 3 dias para fechar" precisa estar certo no dia 22 e no dia 25, e nao da para
 * esperar a semana passar para conferir.
 *
 * ---------------------------------------------------------------------------
 * AVISO E DERIVADO, NAO ARMAZENADO
 *
 * Nao existe tabela de notificacoes, e a ausencia e deliberada. Um aviso aqui e
 * uma FUNCAO do calendario e do estado atual: "fecha em 3 dias" vira "fecha em
 * 2 dias" sozinho a cada meia-noite. Gravado, ele envelheceria no banco e
 * exigiria um processo para reescrever o que ja se sabe calcular -- com a
 * chance extra de o processo falhar e a tela mostrar um aviso de ontem.
 *
 * O dia em que houver ENVIO (e-mail, Slack), o que precisara ser gravado e
 * outra coisa: "este aviso ja foi enviado para fulano", que e fato do passado e
 * nao se recalcula. Ver `CanalDeAviso` no fim do arquivo.
 * ---------------------------------------------------------------------------
 */

import { diasEntre } from "@/lib/tempo/calendario";

import { calcularCiclo, descreverFechada, type ConfiguracaoDeFatura } from "./ciclo";
import type { FonteStatus, StatusPagamento } from "./pagamento";

// --------------------------------------------------------------------- entrada

export type ContaParaAviso = {
  accountId: string;
  nomeExibicao: string;
  configuracao: ConfiguracaoDeFatura;
  status: StatusPagamento | null;
  fonte: FonteStatus;
  /** Vencimento efetivo desta fatura, quando registrado a mao. */
  vencimentoRegistrado: string | null;
};

// ---------------------------------------------------------------------- saida

export type TomAviso = "critico" | "atencao" | "info";

export type AvisoDeFatura = {
  /** Chave estavel: serve de `key` na tela, de asserção no teste e, no futuro, de chave de deduplicacao do envio. */
  chave: string;
  accountId: string;
  conta: string;
  tom: TomAviso;
  titulo: string;
  detalhe: string;
};

const ORDEM: Record<TomAviso, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Todos os avisos de faturamento, em uma funcao so.
 *
 * As tres situacoes pedidas, mais duas que aparecem sozinhas quando se olha o
 * problema de perto:
 *
 *   1. faltam X dias para o fechamento
 *   2. a fatura fecha hoje
 *   3. a fatura fechou e o pagamento nao esta marcado como pago
 *   4. passou do vencimento sem confirmacao          (o caso critico de 3)
 *   5. conta sem dia de fechamento configurado       (nao da para avisar de nada)
 *
 * O silencio significa "conferido e sem pendencia", nunca "ninguem olhou" --
 * por isso falta de configuracao vira aviso PROPRIO em vez de virar ausencia.
 */
export function montarAvisos(contas: ContaParaAviso[], hoje: string): AvisoDeFatura[] {
  const avisos: AvisoDeFatura[] = [];

  for (const conta of contas) {
    const nome = `${conta.nomeExibicao} (${conta.accountId})`;
    const ciclo = calcularCiclo(conta.configuracao, hoje);

    if (ciclo.situacao === "sem_configuracao") {
      avisos.push({
        chave: `sem-fechamento-${conta.accountId}`,
        accountId: conta.accountId,
        conta: nome,
        tom: "info",
        titulo: `Sem dia de fechamento: ${nome}`,
        detalhe:
          "Nenhum aviso de fechamento ou de vencimento é possível para esta conta enquanto " +
          "o dia não for configurado em Faturamento.",
      });
      continue;
    }

    // ------------------------------------------------------- vai fechar
    if (ciclo.situacao === "fecha_hoje") {
      avisos.push({
        chave: `fecha-hoje-${conta.accountId}`,
        accountId: conta.accountId,
        conta: nome,
        tom: "atencao",
        titulo: `A fatura fecha hoje: ${nome}`,
        detalhe:
          `O ciclo se encerra em ${ciclo.proximoFechamento}. O custo lançado depois disso ` +
          "entra na fatura seguinte.",
      });
    } else if (ciclo.situacao === "fecha_em_breve") {
      avisos.push({
        chave: `fecha-em-breve-${conta.accountId}`,
        accountId: conta.accountId,
        conta: nome,
        tom: "info",
        titulo: `${ciclo.descricao}: ${nome}`,
        detalhe:
          `Fechamento em ${ciclo.proximoFechamento}. O aviso aparece com ` +
          `${conta.configuracao.diasDeAviso} dia(s) de antecedência, configurável por conta.`,
      });
    }

    // -------------------------------------------- fechou e nao esta pago
    const pago = conta.status === "paid";
    const emRevisao = conta.status === "manual_review";

    if (!pago && !emRevisao && ciclo.ultimoFechamento) {
      // O vencimento registrado a mao tem precedencia sobre a regra mensal: ele
      // e o caso concreto (prorrogacao, feriado, acordo) e a regra e so o
      // padrao. Usar a regra quando existe uma data especifica seria ignorar a
      // unica informacao que alguem se deu ao trabalho de conferir.
      const vencimento = conta.vencimentoRegistrado ?? ciclo.vencimentoDaFaturaFechada;
      const diasDeAtraso = vencimento ? diasEntre(vencimento, hoje) : null;

      if (diasDeAtraso !== null && diasDeAtraso > 0) {
        avisos.push({
          chave: `vencida-${conta.accountId}`,
          accountId: conta.accountId,
          conta: nome,
          tom: "critico",
          titulo: `Vencimento passou sem confirmação de pagamento: ${nome}`,
          detalhe:
            `Vencimento em ${vencimento}, há ${diasDeAtraso} dia(s). A situação registrada é ` +
            `"${conta.status ?? "unknown"}". O portal não sabe se foi pago — quem sabe é o ` +
            "financeiro, e o registro é manual.",
        });
      } else {
        avisos.push({
          chave: `aguardando-pagamento-${conta.accountId}`,
          accountId: conta.accountId,
          conta: nome,
          tom: "atencao",
          titulo: `${descreverFechada(ciclo)} e o pagamento não está confirmado: ${nome}`,
          detalhe: vencimento
            ? `Fechou em ${ciclo.ultimoFechamento}, vence em ${vencimento}. Marque a situação em Faturamento.`
            : `Fechou em ${ciclo.ultimoFechamento}. Sem dia de vencimento configurado, não há como dizer se está atrasada.`,
        });
      }
    }
  }

  // Crítico primeiro. `sort` é estável, então dentro do mesmo tom a ordem das
  // contas é preservada.
  return avisos.sort((a, b) => ORDEM[a.tom] - ORDEM[b.tom]);
}

// ------------------------------------------------------------------- canais

/**
 * Como um aviso sairia daqui para fora.
 *
 * ESTA INTERFACE NAO TEM IMPLEMENTACAO DE ENVIO, e isso e a entrega desta
 * etapa. Nao ha provedor de e-mail nem webhook de Slack configurado no portal:
 * a unica saida externa que a aplicacao tem hoje e HTTPS para o Banco Central,
 * para a cotacao. Escrever um `EnviadorDeEmail` agora produziria codigo que
 * nunca executou -- e codigo nao executado nao e preparacao, e divida.
 *
 * O que fica preparado e o CONTRATO e o ponto de plugagem. Um canal novo
 * precisa de tres coisas, e nenhuma delas depende de mudar o calculo acima:
 *
 *   1. implementar esta interface;
 *   2. registrar-se em `CANAIS`;
 *   3. uma tabela `app_billing_notifications_sent` -- que ainda NAO existe --
 *      guardando (chave do aviso, canal, destinatario, enviado_em), para o
 *      envio nao repetir todo dia o mesmo "fecha em 3 dias".
 *
 * O passo 3 e o unico que exige migracao, e por isso ele fica de fora agora:
 * criar tabela para um envio que nao existe seria adivinhar o formato do
 * problema antes de te-lo.
 */
export type CanalDeAviso = {
  chave: string;
  rotulo: string;
  /** `false` enquanto nao houver provedor configurado. */
  disponivel: boolean;
  /** Por que nao esta disponivel -- exibido na tela, para ninguem esperar e-mail que nao vem. */
  motivo?: string;
};

export const CANAIS: readonly CanalDeAviso[] = [
  {
    chave: "in_app",
    rotulo: "No portal",
    disponivel: true,
  },
  {
    chave: "email",
    rotulo: "E-mail",
    disponivel: false,
    motivo:
      "Não há provedor de e-mail configurado. O contato de cobrança já é guardado por conta, " +
      "mas o portal não envia mensagem nenhuma.",
  },
  {
    chave: "slack",
    rotulo: "Slack",
    disponivel: false,
    motivo: "Não há webhook configurado.",
  },
];
