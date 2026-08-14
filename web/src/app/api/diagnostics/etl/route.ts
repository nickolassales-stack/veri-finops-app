import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { esquemaHistoricoEtl } from "@/lib/filtros/esquemas-diagnostico";
import { lerParametros } from "@/lib/filtros/esquemas";
import { montarDiagnostico } from "@/lib/services/diagnostico";

/**
 * GET /api/diagnostics/etl -- estado do pipeline.
 *
 * Responde tres perguntas na mesma ida: em que situacao o ETL esta, o que
 * aconteceu na ultima execucao, e quando a proxima e esperada.
 *
 * O QUE ESTA ROTA NAO DEVOLVE, DE PROPOSITO
 *
 * Conteudo de log. Devolve o CAMINHO do arquivo na EC2 e nada mais. O log tem
 * saida bruta de Athena e traceback -- material que vaza id de consulta, nome de
 * bucket e, em erro de conexao, string de conexao inteira. A mensagem de erro
 * que sai daqui e a curta e sanitizada que o ETL gravou, redigida uma segunda
 * vez na leitura.
 *
 * Exige `diagnostics:view`, e nao apenas sessao: e informacao de infraestrutura.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/diagnostics/etl",
  "diagnostics:view",
  async ({ url }) => {
    const { limite, dias } = analisar(esquemaHistoricoEtl, lerParametros(url));

    const d = await montarDiagnostico({ limiteHistorico: limite, diasDeResumo: dias });

    return {
      dados: {
        situacao: d.situacao,
        ultima: d.ultima,
        ultimoSucesso: d.ultimoSucesso,
        historico: d.historico,
        resumo: d.resumo,
      },
      meta: {
        instalado: d.instalado,
        agenda: {
          horario: d.agenda.horario,
          fuso: d.agenda.fuso,
          toleranciaMinutos: d.agenda.toleranciaMinutos,
          ultimaEsperada: d.agenda.ultimaEsperada,
          proximaEsperada: d.agenda.proximaEsperada,
        },
        limites: d.limites,
        janelaDoResumoDias: dias,
        historicoLimite: limite,
      },
    };
  },
);
