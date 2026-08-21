import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaFrescor } from "@/lib/filtros/esquemas-diagnostico";
import { lerParametros } from "@/lib/filtros/esquemas";
import { montarDiagnostico } from "@/lib/services/diagnostico";

/**
 * GET /api/diagnostics/data-freshness -- o veredito.
 *
 * As outras duas rotas descrevem o estado; esta diz o que ele SIGNIFICA. E a
 * unica que devolve a lista de alertas, e e a que serve para monitoracao
 * externa: um alerta critico aqui e motivo de acordar alguem.
 *
 * LISTA VAZIA QUER DIZER "CONFERIDO E SEM PROBLEMA", nunca "ninguem olhou". Por
 * isso ausencia de informacao vira alerta proprio -- migracao nao aplicada, ETL
 * nunca executado, nenhuma conta com dado -- em vez de virar silencio.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/diagnostics/data-freshness",
  "diagnostics:view",
  async ({ url }) => {
    const { diasSemAtualizacao } = analisar(esquemaFrescor, lerParametros(url));

    const d = await montarDiagnostico({ diasSemAtualizacao, limiteHistorico: 1 });

    const criticos = d.alertas.filter((a) => a.tom === "critico");

    return {
      dados: {
        situacao: d.situacao,
        // `saudavel` e derivado, e nao um campo a mais para manter em sincronia:
        // e exatamente "nao ha alerta critico". Quem consome por script pode
        // parar de ler aqui.
        saudavel: criticos.length === 0,
        alertas: d.alertas,
        cobertura: d.cobertura,
        // Quando entrou a linha mais nova -- que NAO e "quando o ETL rodou".
        // Uma carga que so reajustou valores nao insere linha e nao move este
        // carimbo; para saber da execucao, ver `situacao` e /api/diagnostics/etl.
        linhaMaisNovaEm: d.cobertura?.linhaMaisNovaEm ?? null,
        proximaExecucaoEsperada: d.agenda.proximaEsperada,
      },
      meta: {
        instalado: d.instalado,
        criticos: criticos.length,
        atencao: d.alertas.filter((a) => a.tom === "atencao").length,
        contas: d.contas.length,
        limites: d.limites,
        agenda: {
          horario: d.agenda.horario,
          fuso: d.agenda.fuso,
        },
      },
    };
  },
);
