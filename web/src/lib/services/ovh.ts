import "server-only";

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

/** Idade a partir da qual a ultima coleta bem-sucedida e considerada velha. */
const HORAS_PARA_DADO_VELHO = 36;

export type SituacaoOvh =
  /** Migracao 005 nao aplicada: nao ha nem tabela. */
  | "nao_instalado"
  /** Tabelas existem, nenhuma execucao registrada. */
  | "nunca_executado"
  /** Nenhuma execucao jamais terminou em success. */
  | "nunca_teve_sucesso"
  /** A ultima execucao falhou, mas existe sucesso anterior. */
  | "ultima_falhou"
  /** Ultimo sucesso mais antigo que HORAS_PARA_DADO_VELHO. */
  | "dado_velho"
  /** Ha execucao em andamento agora. */
  | "em_execucao"
  | "ok";

export type AlertaOvh = {
  chave: string;
  tom: "info" | "atencao" | "critico";
  titulo: string;
  detalhe: string;
};

export type VisaoOvh = {
  instalado: boolean;
  situacao: SituacaoOvh;
  /** `true` quando existe pelo menos uma linha de custo. */
  temDado: boolean;
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

function horasDesde(iso: string, agora: Date): number {
  return (agora.getTime() - new Date(iso).getTime()) / 3_600_000;
}

function decidirSituacao(
  ultima: ExecucaoOvh | null,
  ultimoSucesso: ExecucaoOvh | null,
  agora: Date,
): SituacaoOvh {
  if (!ultima) return "nunca_executado";
  // Ordem importa: uma execucao em andamento nao e falha nem sucesso, e
  // classifica-la como qualquer um dos dois faria a tela alarmar durante os dois
  // minutos normais de uma coleta.
  if (ultima.status === "running") return "em_execucao";
  if (!ultimoSucesso) return "nunca_teve_sucesso";
  if (ultima.status !== "success") return "ultima_falhou";
  const referencia = ultimoSucesso.finishedAt ?? ultimoSucesso.startedAt;
  if (horasDesde(referencia, agora) > HORAS_PARA_DADO_VELHO) return "dado_velho";
  return "ok";
}

function montarAlertas(
  situacao: SituacaoOvh,
  ultima: ExecucaoOvh | null,
  ultimoSucesso: ExecucaoOvh | null,
  temDado: boolean,
  agora: Date,
): AlertaOvh[] {
  const alertas: AlertaOvh[] = [];

  switch (situacao) {
    case "nao_instalado":
      alertas.push({
        chave: "ovh-nao-instalado",
        tom: "info",
        titulo: "Integração OVH não instalada",
        detalhe:
          "As tabelas ovh_* não existem neste banco. Rode a migração 005 " +
          "(scripts/migrations/005-ovh-collector.sql) para habilitar a coleta.",
      });
      break;
    case "nunca_executado":
      alertas.push({
        chave: "ovh-nunca-executado",
        tom: "atencao",
        titulo: "Collector OVH nunca executou",
        detalhe:
          "As tabelas existem e estão vazias. Nenhum registro em ovh_sync_runs: " +
          "o collector ainda não rodou nem uma vez.",
      });
      break;
    case "nunca_teve_sucesso":
      alertas.push({
        chave: "ovh-nunca-sucesso",
        tom: "critico",
        titulo: "Collector OVH nunca concluiu com sucesso",
        detalhe:
          `Já houve ${ultima ? "execução" : "tentativa"}, mas nenhuma terminou em ` +
          "success. Nenhum dado OVH nesta tela foi coletado por uma execução " +
          "completa — trate o que aparece como parcial.",
      });
      break;
    case "ultima_falhou":
      alertas.push({
        chave: "ovh-ultima-falhou",
        tom: "critico",
        titulo: "A última coleta OVH falhou",
        detalhe:
          "O dado exibido é do último sucesso, não do agora. " +
          (ultimoSucesso
            ? `Última coleta bem-sucedida: ${ultimoSucesso.finishedAt ?? ultimoSucesso.startedAt}.`
            : ""),
      });
      break;
    case "dado_velho":
      alertas.push({
        chave: "ovh-dado-velho",
        tom: "atencao",
        titulo: "Dado OVH desatualizado",
        detalhe:
          ultimoSucesso
            ? `A última coleta bem-sucedida foi há ${Math.floor(
                horasDesde(ultimoSucesso.finishedAt ?? ultimoSucesso.startedAt, agora),
              )} horas, acima do limite de ${HORAS_PARA_DADO_VELHO}h.`
            : "Sem coleta recente.",
      });
      break;
    case "em_execucao":
      alertas.push({
        chave: "ovh-em-execucao",
        tom: "info",
        titulo: "Coleta OVH em andamento",
        detalhe:
          "Há uma execução aberta em ovh_sync_runs. Os números podem mudar até " +
          "ela terminar.",
      });
      break;
    case "ok":
      break;
  }

  // Independe da situacao: coleta que termina em success sem trazer linha e um
  // caso real -- foi o que aconteceu enquanto a credencial estava invalida.
  // "success" sem dado nao pode ser lido como "custo zero".
  if (situacao !== "nao_instalado" && situacao !== "nunca_executado" && !temDado) {
    alertas.push({
      chave: "ovh-sem-linha",
      tom: "atencao",
      titulo: "Nenhuma linha de custo OVH",
      detalhe:
        "O collector já executou, mas ovh_monthly_costs está vazia. Isto não " +
        "significa custo zero: significa que nada foi importado.",
    });
  }

  return alertas;
}

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
      alertas: montarAlertas("nao_instalado", null, null, false, agora),
    };
  }

  const [historico, ultimoSucesso, totaisPorOrigem, faturas, mensal] = await Promise.all([
    getExecucoesOvh(10),
    getUltimoSucessoOvh(),
    getTotaisOvhPorOrigem(),
    getResumoFaturasOvh(),
    getMensalOvh(limiteMensal),
  ]);

  const ultima = historico[0] ?? null;
  const temDado = totaisPorOrigem.length > 0;
  const situacao = decidirSituacao(ultima, ultimoSucesso, agora);

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
    alertas: montarAlertas(situacao, ultima, ultimoSucesso, temDado, agora),
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
