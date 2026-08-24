import { ErroDeApi } from "@/lib/api/http";
import { cabecalhosDeArquivo, rotaComPermissaoArquivo } from "@/lib/api/rota";
import { ROTULO_FONTE } from "@/lib/dashboard/ovh";
import {
  LIMITE_LINHAS,
  gerarXLSXOvh,
  getLinhasExportOvh,
  nomeDoArquivoOvh,
} from "@/lib/export/ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/export/ovh/xlsx -- os custos OVH do filtro atual, em planilha.
 *
 * SEPARADO do export AWS, e nao um parametro dele. Le `ovh_monthly_costs`; o
 * export AWS le `aws_daily_costs`. Nenhum dos dois conhece a tabela do outro,
 * entao a separacao e estrutural e nao depende de alguem lembrar de aplicar.
 *
 * Exige `analytic:export`, e nao apenas `analytic:view`: ver na tela e levar o
 * dado embora sao permissoes diferentes -- um arquivo sai do controle do portal
 * no instante em que e salvo.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissaoArquivo(
  "GET /api/export/ovh/xlsx",
  "analytic:export",
  async ({ url, tz }) => {
    const { filtro, periodo, entrada, meta } = await resolverFiltroOvh(url, tz);

    // Sem moeda resolvida nao ha o que exportar: seria um arquivo so com
    // cabecalho, que parece exportacao vazia em vez de recorte sem dado.
    if (!filtro) {
      throw new ErroDeApi(
        "nao-encontrado",
        "Não há custo OVH neste recorte para exportar. Ajuste período ou origem.",
      );
    }

    const linhas = await getLinhasExportOvh(filtro);
    if (linhas.length > LIMITE_LINHAS) {
      throw new ErroDeApi(
        "parametros-invalidos",
        `O recorte tem mais de ${LIMITE_LINHAS} linhas. Reduza o período — ` +
          "um arquivo truncado em silêncio seria pior do que esta recusa.",
      );
    }

    const contexto = [
      "VERI FinOps — export da Visão OVH",
      `Período: ${periodo.deMes} a ${periodo.ateMes}`,
      `Origem: ${ROTULO_FONTE[entrada.source]} (${entrada.source})`,
      `Moeda: ${filtro.moeda}`,
      `Conta: ${entrada.conta ?? "todas as contas OVH"}`,
      `Projeto: ${entrada.projeto ?? "todos os projetos"}`,
      `Linhas: ${linhas.length}`,
      `Gerado em: ${new Date().toISOString()}`,
      "Origens NUNCA são somadas: faturado, uso corrente e previsão respondem perguntas diferentes.",
      `Fuso de apresentação: ${tz}${meta ? "" : ""}`,
    ];

    const planilha = await gerarXLSXOvh(linhas, contexto);

    return new Response(new Uint8Array(planilha), {
      headers: cabecalhosDeArquivo(
        nomeDoArquivoOvh(periodo.deMes, periodo.ateMes, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    });
  },
);
