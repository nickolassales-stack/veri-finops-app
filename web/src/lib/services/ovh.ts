import "server-only";

import {
  decidirSituacaoOvh,
  montarAlertasOvh,
  type AlertaOvh,
  type SituacaoOvh,
} from "@/lib/diagnostico/ovh";
import { getEnv } from "@/lib/env";
import {
  getExecucoesOvh,
  getMensalOvh,
  getResumoFaturasOvh,
  getTotaisOvhPorOrigem,
  getUltimoSucessoOvh,
  ovhInstalado,
  type ExecucaoOvh,
  type LinhaMensalOvh,
  type ResumoFaturasOvh,
  type TotalPorOrigem,
} from "@/lib/queries/ovh";

/**
 * Montagem unica da visao OVH, consumida por Faturamento e por Diagnostico.
 *
 * As duas telas fazem perguntas diferentes -- "quanto foi faturado" e "a coleta
 * esta de pe" -- mas leem as MESMAS tabelas. Se cada uma montasse o seu, o
 * Faturamento poderia exibir dado de uma coleta que o Diagnostico chama de
 * falhada, e a tela cuja funcao e dizer se o dado presta seria a primeira a
 * discordar da que o exibe.
 */

export type { AlertaOvh, SituacaoOvh };

export type VisaoOvh = {
  instalado: boolean;
  situacao: SituacaoOvh;
  /** `true` quando existe pelo menos uma linha de custo. */
  temDado: boolean;
  /** `true` quando alguma das ultimas execucoes teve `source='cron'`. */
  teveExecucaoAutomatica: boolean;
  ultima: ExecucaoOvh | null;
  ultimoSucesso: ExecucaoOvh | null;
  historico: ExecucaoOvh[];
  totaisPorOrigem: TotalPorOrigem[];
  faturas: ResumoFaturasOvh[];
  mensal: LinhaMensalOvh[];
  alertas: AlertaOvh[];
  /**
   * Estado do agendamento, vindo de `OVH_CRON_INSTALADO`.
   *
   * DECLARADO, NAO MEDIDO: o portal roda em container sem acesso ao crontab do
   * host. Mesma limitacao de `agendaConfigurada()` em services/diagnostico.ts, e
   * pelo mesmo motivo -- por isso a tela avisa que o valor e declarado, em vez de
   * apresenta-lo como verificado.
   */
  cronInstalado: boolean;
  /** Horario declarado do agendamento, no fuso do agendador. */
  horarioEsperado: string;
  /** Fuso em que o agendador interpreta o horario acima. */
  fusoDoAgendador: string;
  agora: string;
};

export async function montarVisaoOvh(limiteMensal = 200): Promise<VisaoOvh> {
  // UM instante para toda a montagem, pelo mesmo motivo de montarDiagnostico():
  // duas leituras de relogio poderiam classificar a mesma execucao de dois
  // jeitos dentro da mesma tela.
  const agora = new Date();
  const env = getEnv();
  const agendamento = {
    cronInstalado: env.OVH_CRON_INSTALADO,
    horarioEsperado: env.OVH_HORARIO_ESPERADO,
    fusoDoAgendador: env.ETL_FUSO_AGENDAMENTO,
  };
  const vazio = {
    instalado: false,
    temDado: false,
    teveExecucaoAutomatica: false,
    ultima: null,
    ultimoSucesso: null,
    historico: [],
    totaisPorOrigem: [],
    faturas: [],
    mensal: [],
    ...agendamento,
    agora: agora.toISOString(),
  };

  if (!(await ovhInstalado())) {
    return {
      ...vazio,
      situacao: "nao_instalado",
      alertas: montarAlertasOvh({
        situacao: "nao_instalado",
        ultima: null,
        ultimoSucesso: null,
        temDado: false,
        teveExecucaoAutomatica: false,
        cronInstalado: agendamento.cronInstalado,
        agora,
      }),
    };
  }

  // A leitura inteira num try: se qualquer uma das cinco consultas falhar, esta
  // funcao devolve ESTADO em vez de propagar excecao.
  //
  // Por que isto existe: `montarVisaoOvh` e chamada por Faturamento e por
  // Diagnostico, as duas em Server Components. Excecao ali derruba a pagina
  // INTEIRA com "A server error occurred" -- foi o que aconteceu em 20/08/2026,
  // quando uma coluna `date` tipada como `Date` levou as duas telas embora.
  // A secao OVH nao vale o diagnostico do ETL AWS.
  //
  // Nao mascara o defeito: `situacao` fica `erro_de_leitura`, um alerta critico
  // aparece na tela e o motivo real vai para o log do servidor.
  let historico: ExecucaoOvh[];
  let ultimoSucesso: ExecucaoOvh | null;
  let totaisPorOrigem: TotalPorOrigem[];
  let faturas: ResumoFaturasOvh[];
  let mensal: LinhaMensalOvh[];

  try {
    [historico, ultimoSucesso, totaisPorOrigem, faturas, mensal] = await Promise.all([
      getExecucoesOvh(10),
      getUltimoSucessoOvh(),
      getTotaisOvhPorOrigem(),
      getResumoFaturasOvh(),
      getMensalOvh(limiteMensal),
    ]);
  } catch (err) {
    // Log do SERVIDOR, com a mensagem tecnica. Nada disso vai para o navegador:
    // a tela recebe o texto generico do alerta.
    console.error("[ovh] falha ao montar a visao OVH", {
      mensagem: err instanceof Error ? err.message : String(err),
    });
    return {
      ...vazio,
      instalado: true,
      situacao: "erro_de_leitura",
      alertas: montarAlertasOvh({
        situacao: "erro_de_leitura",
        ultima: null,
        ultimoSucesso: null,
        temDado: false,
        teveExecucaoAutomatica: false,
        cronInstalado: agendamento.cronInstalado,
        agora,
      }),
    };
  }

  const ultima = historico[0] ?? null;
  const temDado = totaisPorOrigem.length > 0;
  // O historico traz as 10 ultimas; se `cron` nao aparecer em nenhuma delas, a
  // coleta automatica ainda nao rodou -- ou parou de rodar ha dez execucoes.
  const teveExecucaoAutomatica = historico.some((e) => e.source === "cron");
  const situacao = decidirSituacaoOvh(ultima, ultimoSucesso, agora);

  return {
    instalado: true,
    situacao,
    temDado,
    ultima,
    ultimoSucesso,
    historico,
    totaisPorOrigem,
    faturas,
    mensal,
    teveExecucaoAutomatica,
    alertas: montarAlertasOvh({
      situacao,
      ultima,
      ultimoSucesso,
      temDado,
      teveExecucaoAutomatica,
      cronInstalado: agendamento.cronInstalado,
      agora,
    }),
    ...agendamento,
    agora: agora.toISOString(),
  };
}

/** Rotulo humano de cada origem. Usado nos cards e na tabela. */
export const ROTULO_FONTE_OVH = {
  invoice: "Faturado",
  usage_current: "Uso corrente",
  usage_forecast: "Previsão",
} as const;

/** O que cada origem significa, para o texto de apoio dos cards. */
export const DESCRICAO_FONTE_OVH = {
  invoice: "O que a OVH efetivamente faturou",
  usage_current: "Consumo do mês em andamento, ainda não faturado",
  usage_forecast: "Projeção da OVH para o fechamento",
} as const;
