/**
 * Agenda do ETL: quando ele deveria ter rodado, e quando roda de novo.
 *
 * MODULO PURO -- sem banco, sem `server-only`. Recebe o instante como
 * argumento em vez de chamar `new Date()` por conta propria, o que torna cada
 * regra testavel em qualquer hora do dia sem relogio falso.
 *
 * POR QUE O FUSO DO AGENDAMENTO E SEPARADO DO FUSO DA TELA
 *
 * A EC2 esta em `Etc/UTC` e o cron e `0 8 * * *`. Isso dispara as 08:00 UTC,
 * que sao 05:00 em Sao Paulo -- NAO as 08:00 de Sao Paulo. Guardar so "8h"
 * obrigaria o codigo a adivinhar de qual 8h se trata, e a tela mostraria uma
 * proxima execucao tres horas errada.
 *
 * Entao sao duas informacoes distintas:
 *   `fuso` (ETL_FUSO_AGENDAMENTO) e o fuso em que o CRON entende o horario;
 *   APP_TZ e o fuso em que a PESSOA le a tela.
 * A conversao entre os dois e o unico trabalho deste arquivo.
 *
 * As contas de calendario que nao sao especificas de agendamento (que dia e hoje
 * neste fuso, quantos dias entre duas datas) moram em `@/lib/tempo/calendario`,
 * porque o faturamento faz as mesmas perguntas. Duas definicoes de "hoje"
 * divergiriam na primeira madrugada.
 */

import { partesEm } from "@/lib/tempo/calendario";

export type AgendaEtl = {
  /** Hora do agendamento, no fuso `fuso`. */
  hora: number;
  minuto: number;
  /** Fuso IANA em que o agendador interpreta o horario. */
  fuso: string;
  /** Atraso aceitavel antes de chamar a carga de atrasada. */
  toleranciaMinutos: number;
};

const MS_POR_MINUTO = 60_000;
const MS_POR_DIA = 86_400_000;

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number };

/** Deslocamento do fuso, em ms, no instante dado. */
function deslocamento(fuso: string, instante: Date): number {
  const p = partesEm(fuso, instante);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  // Segundos e ms vem do proprio instante: o formatador acima so devolve ate
  // minuto, e arredondar aqui deslocaria o resultado em ate 59s.
  const truncado = Math.floor(instante.getTime() / MS_POR_MINUTO) * MS_POR_MINUTO;
  return comoSeFosseUtc - truncado;
}

/**
 * O instante em que sao `hora:minuto` do dia (ano, mes, dia) NAQUELE fuso.
 *
 * Duas passadas: a primeira estima o deslocamento usando o palpite em UTC, a
 * segunda o recalcula ja perto do instante correto. E o que mantem o resultado
 * certo na virada de horario de verao -- o Brasil nao usa mais, mas o fuso do
 * agendamento e configuravel e pode ser qualquer um.
 */
function instanteEm(fuso: string, p: Partes): Date {
  const palpite = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto);
  const primeira = new Date(palpite - deslocamento(fuso, new Date(palpite)));
  return new Date(palpite - deslocamento(fuso, primeira));
}

/** O horario agendado do dia de calendario a que `instante` pertence. */
function agendadoNoDiaDe(agenda: AgendaEtl, instante: Date): Date {
  const p = partesEm(agenda.fuso, instante);
  return instanteEm(agenda.fuso, { ...p, hora: agenda.hora, minuto: agenda.minuto });
}

/**
 * Ultima execucao ESPERADA ate agora (inclusive).
 *
 * E a referencia de "deveria ter rodado": qualquer carga bem-sucedida iniciada
 * antes disto ja nao vale para o dia corrente.
 */
export function ultimaEsperada(agenda: AgendaEtl, agora: Date): Date {
  const hoje = agendadoNoDiaDe(agenda, agora);
  if (hoje.getTime() <= agora.getTime()) return hoje;

  // Um dia para tras pelo CALENDARIO do fuso, nao 24h no relogio: subtrair
  // 86.400.000 ms erraria por uma hora na virada de horario de verao.
  const ontem = partesEm(agenda.fuso, new Date(agora.getTime() - MS_POR_DIA));
  return instanteEm(agenda.fuso, {
    ...ontem,
    hora: agenda.hora,
    minuto: agenda.minuto,
  });
}

/** Proxima execucao esperada, sempre estritamente no futuro. */
export function proximaEsperada(agenda: AgendaEtl, agora: Date): Date {
  const hoje = agendadoNoDiaDe(agenda, agora);
  if (hoje.getTime() > agora.getTime()) return hoje;

  const amanha = partesEm(agenda.fuso, new Date(agora.getTime() + MS_POR_DIA));
  return instanteEm(agenda.fuso, {
    ...amanha,
    hora: agenda.hora,
    minuto: agenda.minuto,
  });
}

/**
 * Ja passou da hora, contada a tolerancia?
 *
 * A tolerancia existe porque a carga leva minutos e o cron nao dispara no
 * segundo exato: sem ela, a tela acusaria atraso todo dia entre 08:00 e o fim
 * da execucao.
 */
export function passouDaHora(agenda: AgendaEtl, agora: Date): boolean {
  const limite = ultimaEsperada(agenda, agora).getTime()
    + agenda.toleranciaMinutos * MS_POR_MINUTO;
  return agora.getTime() > limite;
}

// `diaEm`, `mesmoDia`, `mesCorrente`, `diasEntre` e `mesesEntre` vivem agora em
// `@/lib/tempo/calendario`. Quem importava daqui deve importar de la -- este
// arquivo trata de AGENDAMENTO, nao de calendario em geral.
