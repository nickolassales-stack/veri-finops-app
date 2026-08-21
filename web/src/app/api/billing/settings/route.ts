import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaIdDeConta } from "@/lib/filtros/esquemas-admin";
import { esquemaConfiguracaoFatura } from "@/lib/filtros/esquemas-billing";
import { salvarConfiguracaoDeFatura } from "@/lib/queries/billing";
import { montarFaturamento } from "@/lib/services/billing";

/**
 * /api/billing/settings -- o CICLO da fatura: fechamento, vencimento,
 * antecedencia do aviso e contato de cobranca.
 *
 * GET   exige `billing:view`
 * PATCH exige `billing:manage`
 *
 * ESTES CAMPOS SAIRAM DE /api/admin/accounts nesta entrega. Antes, o dia de
 * fechamento era editavel por quem tivesse `settings:accounts` -- o que
 * significava que a permissao de faturamento nao governava o dado de
 * faturamento. Duas portas para o mesmo campo, com exigencias diferentes, e um
 * buraco que so aparece quando alguem usa a porta errada.
 *
 * O contato de cobranca e GUARDADO E EXIBIDO, e nada mais: nao ha provedor de
 * e-mail configurado, e o portal nao envia mensagem nenhuma.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/billing/settings",
  "billing:view",
  async () => {
    const f = await montarFaturamento();

    return {
      dados: f.linhas.map((l) => ({
        accountId: l.accountId,
        conta: l.nomeExibicao,
        accountName: l.accountName,
        ativa: l.ativa,
        diaDeFechamento: l.invoiceCloseDay,
        diaDeVencimento: l.invoiceDueDay,
        diasDeAviso: l.invoiceNotificationDaysBefore,
        contatoDeCobranca: l.billingContactEmail,
        configurada: l.configurada,
        ciclo: l.ciclo,
      })),
      meta: {
        hoje: f.hoje,
        semConfiguracao: f.resumo.semConfiguracao,
        canais: f.canais,
      },
    };
  },
);

export const PATCH = rotaComPermissao(
  "PATCH /api/billing/settings",
  "billing:manage",
  async ({ url, corpo, tz }) => {
    const accountId = analisar(esquemaIdDeConta, url.searchParams.get("conta") ?? "");
    const entrada = analisar(esquemaConfiguracaoFatura, corpo);

    return { dados: await salvarConfiguracaoDeFatura(accountId, entrada, tz) };
  },
);
