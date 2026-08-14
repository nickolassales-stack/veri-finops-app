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
 */

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

/**
 * Le um instante nas partes de calendario de um fuso.
 *
 * `en-CA` com `hour12: false` produz partes numericas estaveis; usar
 * `formatToParts` evita depender do formato do locale.
 */
function partesEm(fuso: string, instante: Date): Partes {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);

  const valor = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? "0");

  // `hour12: false` produz 24 para a meia-noite em alguns runtimes; 24:00 e
  // 00:00 do mesmo dia, e tratar como 24 jogaria o calculo para o dia seguinte.
  const hora = valor("hour") % 24;

  return {
    ano: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora,
    minuto: valor("minute"),
  };
}

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

/** Mesmo dia de calendario NO FUSO indicado -- a base de "rodou hoje". */
export function mesmoDia(fuso: string, a: Date, b: Date): boolean {
  const x = partesEm(fuso, a);
  const y = partesEm(fuso, b);
  return x.ano === y.ano && x.mes === y.mes && x.dia === y.dia;
}

/** Data de calendario "AAAA-MM-DD" de um instante, num fuso. */
export function diaEm(fuso: string, instante: Date): string {
  const p = partesEm(fuso, instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** Primeiro dia do mes corrente, "AAAA-MM-01", no fuso indicado. */
export function mesCorrente(fuso: string, instante: Date): string {
  return `${diaEm(fuso, instante).slice(0, 7)}-01`;
}

/** Diferenca em dias inteiros entre duas datas de calendario "AAAA-MM-DD". */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / MS_POR_DIA);
}

/**
 * Meses de calendario entre dois "AAAA-MM", inclusive nas pontas.
 *
 * Serve para descobrir BURACO na serie: o que falta e o que esta nesta lista e
 * nao chegou do banco.
 */
export function mesesEntre(de: string, ate: string): string[] {
  const [anoDe, mesDe] = de.slice(0, 7).split("-").map(Number);
  const [anoAte, mesAte] = ate.slice(0, 7).split("-").map(Number);

  const meses: string[] = [];
  let ano = anoDe;
  let mes = mesDe;
  // Teto de seguranca: uma data absurda vinda do banco nao pode virar um laco
  // infinito dentro de uma requisicao.
  while ((ano < anoAte || (ano === anoAte && mes <= mesAte)) && meses.length < 240) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}
