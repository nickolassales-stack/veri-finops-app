import { ErroDeApi, analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaIdDeConta } from "@/lib/filtros/esquemas-admin";
import { esquemaStatusPagamento } from "@/lib/filtros/esquemas-billing";
import { salvarStatusDePagamento } from "@/lib/queries/billing";
import { montarFaturamento } from "@/lib/services/billing";

/**
 * /api/billing/status -- situacao de pagamento por conta.
 *
 * GET   exige `billing:view`   -- ver a situacao
 * PATCH exige `billing:manage` -- afirmar a situacao
 *
 * As duas permissoes existem separadas porque as duas acoes sao diferentes em
 * consequencia: ler nao muda nada, e registrar "pago" e uma afirmacao com peso
 * contabil que alguem vai usar para decidir nao pagar de novo.
 *
 * A FONTE NAO E ACEITA NO CORPO. Ela e cravada como `manual` no servidor.
 * Aceita-la do cliente permitiria que uma requisicao forjada -- ou um dia de
 * pressa -- fizesse um valor digitado a mao aparecer na tela com o selo de "AWS
 * Invoicing", que e exatamente o selo que existe para dizer quem afirmou.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao("GET /api/billing/status", "billing:view", async () => {
  const f = await montarFaturamento();

  return {
    dados: f.linhas.map((l) => ({
      accountId: l.accountId,
      conta: l.nomeExibicao,
      accountName: l.accountName,
      competencia: l.competencia,
      fechamento: l.ciclo.ultimoFechamento,
      proximoFechamento: l.ciclo.proximoFechamento,
      vencimento: l.vencimentoEfetivo,
      status: l.paymentStatus,
      fonte: l.paymentStatusSource,
      referencia: l.paymentReference,
      pagoEm: l.paymentPaidDate,
      observacoes: l.paymentNotes,
      atualizadoEm: l.paymentStatusUpdatedAt,
      diasDeAtraso: l.diasDeAtraso,
      situacaoDoCiclo: l.ciclo.situacao,
    })),
    meta: {
      hoje: f.hoje,
      resumo: f.resumo,
      // A tela mostra isto ao lado do status. Quem consulta por script precisa
      // da mesma advertencia: nenhum destes valores foi verificado com a AWS.
      integracaoAws: f.integracaoAws,
    },
  };
});

export const PATCH = rotaComPermissao(
  "PATCH /api/billing/status",
  "billing:manage",
  async ({ url, corpo, sessao, tz }) => {
    const accountId = analisar(
      esquemaIdDeConta,
      url.searchParams.get("conta") ?? "",
    );
    const entrada = analisar(esquemaStatusPagamento, corpo);

    // Redundante com o `refine` do esquema, e mantido: se um dia alguem afrouxar
    // a validacao de entrada, a recusa continua acontecendo antes da escrita --
    // e nao no CHECK do banco, que viraria erro 500 sem explicacao.
    if (entrada.paymentStatus === "paid" && !entrada.paymentPaidAt) {
      throw new ErroDeApi(
        "parametros-invalidos",
        'Para marcar como "Pago" é obrigatório informar a data do pagamento.',
      );
    }

    const conta = await salvarStatusDePagamento(
      accountId,
      entrada,
      sessao.email,
      tz,
    );

    return {
      dados: conta,
      meta: {
        // Dito de volta na resposta, e nao so gravado: quem chamou precisa ver
        // que a afirmacao ficou registrada como MANUAL, e por quem.
        fonte: conta.paymentStatusSource,
        registradoPor: sessao.email,
      },
    };
  },
);
