import { rotaComPermissao } from "@/lib/api/rota";
import { montarFaturamento } from "@/lib/services/billing";

/**
 * GET /api/billing/notifications -- os avisos de faturamento.
 *
 * Exige `billing:view`. Ver o aviso e ler informacao de fatura; agir sobre ele
 * (marcar como pago, configurar fechamento) exige `billing:manage`.
 *
 * OS AVISOS SAO DERIVADOS A CADA CHAMADA, e nao lidos de uma tabela. "Fecha em
 * 3 dias" vira "fecha em 2 dias" sozinho a cada meia-noite; gravado, seria um
 * valor que envelhece no banco e exigiria um processo para reescrever o que ja
 * se sabe calcular -- com a chance extra de o processo falhar e a tela mostrar
 * o aviso de ontem como se fosse de hoje.
 *
 * `canais` diz o que existe de fato: `in_app` disponivel, e-mail e Slack nao.
 * Aparece na resposta para que ninguem -- pessoa ou script -- fique esperando
 * uma mensagem que o portal nao tem como enviar.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/billing/notifications",
  "billing:view",
  async ({ url }) => {
    const f = await montarFaturamento();

    // Filtro opcional por tom, para monitoracao externa perguntar so pelo que
    // acorda alguem. Lista fechada: valor fora dela nao filtra nada em silencio.
    const tom = url.searchParams.get("tom");
    const tonsValidos = ["critico", "atencao", "info"];
    const avisos =
      tom && tonsValidos.includes(tom) ? f.avisos.filter((a) => a.tom === tom) : f.avisos;

    return {
      dados: avisos,
      meta: {
        hoje: f.hoje,
        total: f.avisos.length,
        criticos: f.avisos.filter((a) => a.tom === "critico").length,
        atencao: f.avisos.filter((a) => a.tom === "atencao").length,
        // Derivado, e nao um campo a manter em sincronia: e exatamente "nao ha
        // aviso critico".
        semPendenciaCritica: f.avisos.every((a) => a.tom !== "critico"),
        filtroDeTom: tom && tonsValidos.includes(tom) ? tom : null,
        canais: f.canais,
        resumo: f.resumo,
      },
    };
  },
);
