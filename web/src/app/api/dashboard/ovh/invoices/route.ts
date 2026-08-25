import { rotaComPermissao } from "@/lib/api/rota";
import { getFaturasOvh } from "@/lib/queries/dashboard-ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/dashboard/ovh/invoices -- historico de faturas da janela.
 *
 * NAO filtra por origem, projeto nem moeda, e isso e proposital: cabecalho de
 * fatura nao tem `source` (ele E o faturado), a fatura pertence a conta e nao ao
 * projeto, e cada uma carrega a propria `currency`. Contar faturas de moedas
 * diferentes e legitimo; soma-las nao seria -- por isso a resposta traz linhas e
 * nenhum total agregado.
 *
 * `semMesAtribuido` no `meta` cobre um furo real do schema:
 * `ovh_invoice_headers.billing_month` e NULLABLE, e uma fatura sem esse campo
 * nao casa com nenhum filtro de periodo -- ela desapareceria de todas as janelas
 * em silencio. Contar essas linhas e o que impede a tela de dizer "3 faturas no
 * periodo" quando existem 4 no banco.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 60;

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/invoices",
  "dashboard:view",
  async ({ url, tz }) => {
    const { entrada, periodo, estado, meta } = await resolverFiltroOvh(url, tz);

    // A fatura nao tem `source` nem projeto, mas TEM conta: sem repassar
    // `contas`, esta lista mostraria faturas de contas que o usuario tirou do
    // recorte, e os totais da tela nao bateriam com as linhas exibidas.
    const { itens, semMesAtribuido } = await getFaturasOvh(
      { deMes: periodo.deMes, ateMes: periodo.ateMes, contas: entrada.conta },
      LIMITE,
    );

    return {
      dados: itens,
      meta: {
        ...meta,
        estado,
        semMesAtribuido,
        limite: LIMITE,
        truncado: itens.length === LIMITE,
      },
    };
  },
);
