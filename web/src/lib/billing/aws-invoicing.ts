/**
 * Integracao com a AWS para situacao de pagamento -- DESLIGADA.
 *
 * ============================================================================
 * ESTE MODULO NAO FALA COM A AWS. E o ponto dele.
 * ============================================================================
 *
 * Ele existe para tres coisas:
 *
 *   1. dar UM lugar onde a integracao vai morar, isolado do resto;
 *   2. responder honestamente "da para saber pela AWS se esta fatura foi paga?"
 *      -- e a resposta, hoje, e NAO;
 *   3. garantir por construcao que nada neste portal marque uma fatura como
 *      paga sem evidencia.
 *
 * Nao ha `@aws-sdk` nas dependencias, e isso e deliberado. O portal roda num
 * container SEM credencial AWS, por decisao registrada no RUNBOOK: ele consome
 * o PostgreSQL e nada mais. Instalar o SDK agora acrescentaria peso e a
 * impressao de que basta ligar a flag -- quando o que falta e papel IAM,
 * credencial, egress e validacao em ambiente real.
 *
 * A investigacao completa (quais APIs, quais permissoes, quais limites) esta em
 * `docs/AWS-INVOICING.md`. O resumo executivo esta em `LIMITACOES` abaixo,
 * porque a tela mostra isso para quem estiver olhando o status.
 *
 * ---------------------------------------------------------------------------
 * O RESULTADO DA INVESTIGACAO, EM UMA FRASE
 *
 * As APIs de faturamento da AWS respondem QUANTO foi cobrado e QUANDO a fatura
 * foi emitida. Nenhuma delas responde, de forma confiavel e programatica, se o
 * boleto/cartao FOI QUITADO -- isso vive no meio de pagamento, fora da AWS,
 * quando o pagamento e feito por transferencia ou por um parceiro/reseller.
 * ---------------------------------------------------------------------------
 */

import { getEnv } from "@/lib/env";

import type { FonteStatus, StatusPagamento } from "./pagamento";

/** O que a integracao poderia dizer, se existisse e estivesse validada. */
export type ConsultaDeFatura = {
  accountId: string;
  /** "AAAA-MM" da competencia. */
  competencia: string;
};

export type RespostaInvoicing =
  | {
      disponivel: false;
      /** Motivo exibivel. Nunca detalhe de infraestrutura. */
      motivo: string;
    }
  | {
      disponivel: true;
      status: StatusPagamento;
      fonte: FonteStatus;
      referencia: string | null;
      /**
       * Evidencia que sustenta a afirmacao. Sem isto, `status` nao pode ser
       * usado para gravar nada -- ver `podeGravarAutomaticamente`.
       */
      evidencia: string;
    };

/**
 * A flag esta ligada?
 *
 * Padrao `false` no esquema de ambiente. Ligar SOZINHO nao ativa integracao
 * nenhuma: sem credencial e sem o codigo de chamada, a funcao abaixo continua
 * respondendo indisponivel. A flag existe para que, no dia em que houver
 * implementacao, ela nasca desligada em producao.
 */
export function invoicingHabilitado(): boolean {
  return getEnv().AWS_INVOICING_ENABLED;
}

/**
 * Consulta a situacao de pagamento na AWS.
 *
 * SEMPRE devolve `disponivel: false` nesta versao. A assinatura ja e a final --
 * quem chamar hoje continua funcionando quando a implementacao chegar, e quem
 * escrever a implementacao nao precisa mexer em chamador nenhum.
 *
 * NAO LANCA EXCECAO. Uma integracao externa que derruba a tela de faturamento
 * seria pior do que nao ter integracao: o resto da tela -- fechamento,
 * vencimento, status manual -- nao depende da AWS e precisa continuar de pe.
 */
export async function consultarSituacaoNaAws(
  _consulta: ConsultaDeFatura,
): Promise<RespostaInvoicing> {
  if (!invoicingHabilitado()) {
    return {
      disponivel: false,
      motivo:
        "Integração com a AWS desligada (AWS_INVOICING_ENABLED=false). A situação de " +
        "pagamento exibida é a registrada manualmente.",
    };
  }

  // Ligar a flag nao inventa integracao. Este ramo existe para que ligar por
  // engano em producao produza uma mensagem clara, e nao uma tela quebrada nem
  // -- pior -- um status fabricado.
  return {
    disponivel: false,
    motivo:
      "A flag está ligada, mas não há integração implementada: o portal não tem credencial " +
      "AWS nem SDK instalado. Ver docs/AWS-INVOICING.md antes de considerar isto pronto.",
  };
}

/**
 * A resposta da AWS pode virar gravacao automatica de `paid`?
 *
 * A resposta e NAO, sempre, nesta versao -- e a funcao existe para que essa
 * decisao tenha um lugar unico e testavel, em vez de virar um `if` esquecido no
 * meio de uma rota.
 *
 * Marcar como pago e uma afirmacao com consequencia contabil. Ela exige:
 *   - fonte identificavel (quem afirmou);
 *   - evidencia recuperavel (numero de fatura, transacao, protocolo);
 *   - validacao previa da integracao em ambiente real, com uma fatura conhecida.
 *
 * Enquanto os tres nao existirem, a integracao pode no maximo SUGERIR, e a
 * gravacao continua sendo ato de uma pessoa.
 */
export function podeGravarAutomaticamente(_resposta: RespostaInvoicing): boolean {
  return false;
}

/**
 * O que a tela precisa dizer sobre a automacao -- em portugues, sem eufemismo.
 *
 * Fica no codigo, e nao so na documentacao, porque quem esta olhando um status
 * "Pendente" as 18h de uma sexta-feira precisa saber, ali, que o portal nao vai
 * descobrir sozinho se aquilo foi pago.
 */
export const LIMITACOES: readonly string[] = [
  "O CUR / Data Export informa consumo e custo. Ele NÃO informa se a fatura foi paga — " +
    "nenhuma coluna dele responde essa pergunta.",
  "As APIs de faturamento da AWS expõem valores cobrados e faturas emitidas, não a " +
    "quitação. Pagamento por boleto, transferência ou reseller acontece fora da AWS.",
  "Conta dentro de uma organização não é faturada individualmente: a fatura é da conta " +
    "pagadora. Status por conta filha é, na melhor hipótese, um rateio.",
  "O portal não tem credencial AWS por decisão de arquitetura. Habilitar a integração " +
    "exige papel IAM, egress liberado e revalidação do isolamento atual.",
  "Enquanto isso não for validado com uma fatura real conhecida, todo status é manual — " +
    "e a tela sempre mostra a fonte ao lado do status.",
];
