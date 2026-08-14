import "server-only";

import {
  montarAlertas,
  situacaoDoEtl,
  duracaoSegundos,
  type Alerta,
  type ExecucaoEtl,
  type FrescorConta,
  type LimitesDiagnostico,
  type SituacaoEtl,
} from "@/lib/diagnostico/etl";
import { proximaEsperada, ultimaEsperada, type AgendaEtl } from "@/lib/diagnostico/agenda";
import { getEnv } from "@/lib/env";
import {
  diagnosticoInstalado,
  getCobertura,
  getExecucoes,
  getFrescorPorConta,
  getResumoExecucoes,
  getUltimoSucesso,
  type CoberturaDoDado,
  type ResumoExecucoes,
} from "@/lib/queries/diagnostico-etl";

/**
 * Uma unica montagem do diagnostico, consumida por QUATRO lugares: a pagina e as
 * tres rotas de API.
 *
 * Se cada uma montasse o seu, a tela poderia dizer "OK" enquanto
 * /api/diagnostics/etl dissesse "atrasado" -- e a tela cuja funcao e ser a fonte
 * confiavel sobre o pipeline seria a primeira a discordar de si mesma.
 */

export type AgendaResolvida = AgendaEtl & {
  /** Horario como veio da configuracao, ex.: "08:00". */
  horario: string;
  ultimaEsperada: string;
  proximaEsperada: string;
};

/**
 * A agenda vem do ambiente e NAO e lida do crontab.
 *
 * Ler o cron exigiria que o portal executasse comando no host -- um container
 * sem shell no servidor, por bom motivo. Entao a agenda e declarada, e a
 * declaracao pode divergir da realidade: se alguem mudar o cron sem mudar a
 * variavel, esta tela passa a mentir sobre o horario. Por isso o README amarra
 * as duas coisas no mesmo procedimento, e o padrao da variavel foi escolhido
 * para bater com o cron que existe hoje (08:00 UTC).
 */
export function agendaConfigurada(agora: Date): AgendaResolvida {
  const env = getEnv();
  const [hora, minuto] = env.ETL_HORARIO_ESPERADO.split(":").map(Number);

  const agenda: AgendaEtl = {
    hora,
    minuto,
    fuso: env.ETL_FUSO_AGENDAMENTO,
    toleranciaMinutos: env.ETL_TOLERANCIA_MINUTOS,
  };

  return {
    ...agenda,
    horario: env.ETL_HORARIO_ESPERADO,
    ultimaEsperada: ultimaEsperada(agenda, agora).toISOString(),
    proximaEsperada: proximaEsperada(agenda, agora).toISOString(),
  };
}

export function limitesConfigurados(diasSemAtualizacao?: number): LimitesDiagnostico {
  const env = getEnv();
  return {
    execucaoOrfaMinutos: env.ETL_EXECUCAO_ORFA_MINUTOS,
    diasSemAtualizacao: diasSemAtualizacao ?? env.DIAGNOSTICO_DIAS_SEM_ATUALIZACAO,
  };
}

export type ExecucaoComDuracao = ExecucaoEtl & { duracaoSegundos: number | null };

export type Diagnostico = {
  instalado: boolean;
  situacao: SituacaoEtl;
  ultima: ExecucaoComDuracao | null;
  /** A ultima que deu certo, que nem sempre e a ultima. */
  ultimoSucesso: ExecucaoComDuracao | null;
  historico: ExecucaoComDuracao[];
  resumo: ResumoExecucoes | null;
  agenda: AgendaResolvida;
  limites: LimitesDiagnostico;
  contas: FrescorConta[];
  cobertura: CoberturaDoDado | null;
  alertas: Alerta[];
  agora: string;
};

export type OpcoesDiagnostico = {
  /** Quantas execucoes trazer no historico. */
  limiteHistorico?: number;
  /** Janela do resumo, em dias. */
  diasDeResumo?: number;
  diasSemAtualizacao?: number;
};

export async function montarDiagnostico(
  opcoes: OpcoesDiagnostico = {},
): Promise<Diagnostico> {
  const env = getEnv();
  // UM instante para toda a montagem. Chamar `new Date()` em cada regra abriria
  // a chance de a situacao ser calculada as 07:59:59 e o "proxima execucao"
  // as 08:00:00, com a tela afirmando duas coisas incompativeis.
  const agora = new Date();

  const agenda = agendaConfigurada(agora);
  const limites = limitesConfigurados(opcoes.diasSemAtualizacao);
  const instalado = await diagnosticoInstalado();

  if (!instalado) {
    return {
      instalado: false,
      situacao: "nunca_executado",
      ultima: null,
      ultimoSucesso: null,
      historico: [],
      resumo: null,
      agenda,
      limites,
      contas: [],
      cobertura: null,
      alertas: montarAlertas({
        situacao: "nunca_executado",
        ultima: null,
        contas: [],
        agora,
        agenda,
        limites,
        fusoDaTela: env.APP_TZ,
        monitoramentoInstalado: false,
      }),
      agora: agora.toISOString(),
    };
  }

  const [historico, ultimoSucesso, resumo, contas, cobertura] = await Promise.all([
    getExecucoes(opcoes.limiteHistorico ?? 10),
    getUltimoSucesso(),
    getResumoExecucoes(opcoes.diasDeResumo ?? 30),
    getFrescorPorConta(),
    getCobertura(),
  ]);

  const ultima = historico[0] ?? null;
  const situacao = situacaoDoEtl(ultima, agora, agenda, limites);

  return {
    instalado: true,
    situacao,
    ultima: ultima ? comDuracao(ultima) : null,
    ultimoSucesso: ultimoSucesso ? comDuracao(ultimoSucesso) : null,
    historico: historico.map(comDuracao),
    resumo,
    agenda,
    limites,
    contas,
    cobertura,
    alertas: montarAlertas({
      situacao,
      ultima,
      contas,
      agora,
      agenda,
      limites,
      fusoDaTela: env.APP_TZ,
      monitoramentoInstalado: true,
    }),
    agora: agora.toISOString(),
  };
}

function comDuracao(execucao: ExecucaoEtl): ExecucaoComDuracao {
  return { ...execucao, duracaoSegundos: duracaoSegundos(execucao) };
}
