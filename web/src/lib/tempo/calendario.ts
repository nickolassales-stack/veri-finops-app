/**
 * Calendario em um fuso -- as contas de data que o portal inteiro compartilha.
 *
 * MODULO PURO. Nenhuma funcao daqui chama `new Date()` sozinha: o instante
 * sempre chega por argumento, o que torna cada regra testavel em qualquer hora
 * do dia sem relogio falso.
 *
 * POR QUE ISTO EXISTE SEPARADO
 *
 * Estas funcoes nasceram em `diagnostico/agenda.ts`, para responder "o ETL ja
 * deveria ter rodado?". O faturamento faz perguntas da mesma natureza -- "a
 * fatura ja fechou?" -- e a resposta das duas depende de acertar a mesma coisa:
 * QUAL DIA E HOJE, e para quem.
 *
 * "Hoje" nao e uma constante. 01/09 00:30 UTC ainda e 31/08 em Sao Paulo, e uma
 * fatura que fecha no dia 31 fecha ou nao fecha conforme o fuso em que se
 * pergunta. Duplicar essa conta em dois modulos seria criar duas definicoes de
 * hoje que divergem na primeira madrugada.
 */

const MS_POR_DIA = 86_400_000;

export type PartesDeData = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
};

/**
 * Le um instante nas partes de calendario de um fuso.
 *
 * `en-CA` com `hour12: false` produz partes numericas estaveis; `formatToParts`
 * evita depender do formato do locale.
 */
export function partesEm(fuso: string, instante: Date): PartesDeData {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);

  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");

  // `hour12: false` devolve 24 para a meia-noite em alguns runtimes; 24:00 e
  // 00:00 do mesmo dia, e tratar como 24 jogaria o calculo para o dia seguinte.
  return {
    ano: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour") % 24,
    minuto: valor("minute"),
  };
}

/** Data de calendario "AAAA-MM-DD" de um instante, num fuso. */
export function diaEm(fuso: string, instante: Date): string {
  const p = partesEm(fuso, instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

/** Mesmo dia de calendario NO FUSO indicado. */
export function mesmoDia(fuso: string, a: Date, b: Date): boolean {
  return diaEm(fuso, a) === diaEm(fuso, b);
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
 * Serve para descobrir BURACO numa serie: o que falta e o que esta nesta lista
 * e nao chegou do banco.
 */
export function mesesEntre(de: string, ate: string): string[] {
  const [anoDe, mesDe] = de.slice(0, 7).split("-").map(Number);
  const [anoAte, mesAte] = ate.slice(0, 7).split("-").map(Number);

  const meses: string[] = [];
  let ano = anoDe;
  let mes = mesDe;
  // Teto de seguranca: uma data absurda vinda do banco nao pode virar laco
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

/** Quantos dias tem o mes. `Date.UTC(ano, mes, 0)` devolve o ultimo dia do anterior. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * O dia `desejado` dentro de (ano, mes), encurtado ao ultimo dia quando o mes
 * nao chega la.
 *
 * E a regra de fevereiro. Uma fatura configurada para fechar no dia 31 precisa
 * fechar em ALGUM dia de fevereiro -- e o unico dia defensavel e o ultimo.
 * Empurrar para 1o de marco mudaria a fatura de mes; ignorar o mes deixaria a
 * conta sem fechamento quatro vezes por ano.
 */
export function diaValidoDoMes(ano: number, mes: number, desejado: number): number {
  return Math.min(desejado, ultimoDiaDoMes(ano, mes));
}

/** Monta "AAAA-MM-DD" a partir das partes, ja encurtando o dia se preciso. */
export function dataDoMes(ano: number, mes: number, dia: number): string {
  const d = diaValidoDoMes(ano, mes, dia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Soma meses a um par (ano, mes), normalizando a virada de ano. */
export function somarMeses(ano: number, mes: number, quantidade: number): [number, number] {
  const total = ano * 12 + (mes - 1) + quantidade;
  return [Math.floor(total / 12), (total % 12) + 1];
}
