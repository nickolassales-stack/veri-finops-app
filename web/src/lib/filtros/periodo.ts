/**
 * Resolucao de periodo. Modulo PURO: nao toca no banco, nao le ambiente, nao
 * chama `Date.now()` sem receber o contexto. Por isso e testavel de verdade.
 *
 * Toda data aqui e uma data de CALENDARIO no formato "AAAA-MM-DD", nunca um
 * instante. As colunas `usage_date` e `month` sao `date` no Postgres -- nao tem
 * hora nem fuso. Tratar isso como `Date` foi a origem de erro de um dia a menos
 * em fuso negativo, entao o tipo aqui e string do inicio ao fim.
 *
 * O unico lugar onde o fuso importa e a definicao de "hoje": um relatorio
 * brasileiro vira o dia as 00:00 em America/Sao_Paulo, nao em UTC. E o que
 * `hojeEm()` calcula.
 */

export const PRESETS_PERIODO = [
  "7d",
  "30d",
  "mes-atual",
  "mes-anterior",
  "personalizado",
] as const;

export type PresetPeriodo = (typeof PRESETS_PERIODO)[number];

export const ROTULOS_PERIODO: Record<PresetPeriodo, string> = {
  "7d": "Ultimos 7 dias",
  "30d": "Ultimos 30 dias",
  "mes-atual": "Mes atual",
  "mes-anterior": "Mes anterior",
  personalizado: "Periodo personalizado",
};

/** Teto de dias por consulta. Protege o Postgres compartilhado com o Metabase. */
export const MAX_DIAS_PERIODO = 731;

export type ContextoTemporal = {
  /** Hoje em America/Sao_Paulo, "AAAA-MM-DD". */
  hoje: string;
  /** `max(usage_date)` na base. `null` quando nao ha nenhuma linha de custo. */
  maiorDataComDado: string | null;
};

export type JanelaData = { de: string; ate: string; dias: number };

export type PeriodoResolvido = JanelaData & {
  preset: PresetPeriodo;
  rotulo: string;
  /**
   * Janela imediatamente anterior, de tamanho equivalente, para comparacao.
   * Ver `janelaAnterior()` para a regra de cada preset.
   */
  anterior: JanelaData;
  /**
   * `true` quando o fim da janela foi limitado pelo ultimo dia com dado, e nao
   * pelo fim natural do periodo. Serve para a interface dizer "ate 05/08 porque
   * e ate onde o ETL carregou", em vez de desenhar dias vazios no fim do grafico.
   */
  limitadoPorDadoDisponivel: boolean;
  /**
   * `true` quando existe custo lancado depois do fim da janela (cobranca anual
   * adiantada, por exemplo). Esse valor NAO entra nos totais do periodo.
   */
  existeDadoAlemDaJanela: boolean;
};

// ------------------------------------------------------------- data utilitaria

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Valida formato E existencia (rejeita 2026-02-30). */
export function ehDataISOValida(valor: string): boolean {
  if (!FORMATO_ISO.test(valor)) return false;
  const [ano, mes, dia] = valor.split("-").map(Number);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  );
}

/**
 * Data de calendario -> Date em UTC.
 *
 * UTC de proposito: e apenas um veiculo para fazer aritmetica de dias sem que o
 * fuso do processo (que muda entre a maquina do dev e o container) desloque o
 * resultado. Nunca exponha esse Date -- converta de volta com `paraISO`.
 */
function paraUTC(iso: string): Date {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(iso: string, dias: number): string {
  const d = paraUTC(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraISO(d);
}

/** Diferenca inclusiva: de 01 a 01 = 1 dia. */
export function contarDias(de: string, ate: string): number {
  const ms = paraUTC(ate).getTime() - paraUTC(de).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function primeiroDiaDoMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function ultimoDiaDoMes(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number);
  // Dia 0 do mes seguinte = ultimo dia deste mes. Resolve fevereiro bissexto
  // sem tabela de dias por mes.
  return paraISO(new Date(Date.UTC(ano, mes, 0)));
}

/**
 * Soma meses preservando o dia quando possivel.
 *
 * 31/03 menos um mes vira 28/02 (ou 29/02), nao 03/03. Sem esse ajuste, a
 * comparacao mensal de um dia 31 estouraria para o mes seguinte.
 */
export function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimoDia = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
  ).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimoDia));
  return paraISO(alvo);
}

/** Hoje no fuso informado, como data de calendario. */
export function hojeEm(timeZone: string): string {
  // "en-CA" produz exatamente AAAA-MM-DD -- e o formato oficial do Canada.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const menor = (a: string, b: string) => (a <= b ? a : b);
const maior = (a: string, b: string) => (a >= b ? a : b);

// -------------------------------------------------------------- janela anterior

/**
 * Janela de comparacao.
 *
 * Para os presets de mes, desloca um mes de calendario: comparar 01-06/08 com
 * 01-06/07 responde "como estamos indo em relacao ao mesmo ponto do mes
 * passado". Deslocar por quantidade de dias responderia outra pergunta
 * (compararia com o fim de julho) e confundiria quem le.
 *
 * Para os demais, desloca pelo tamanho da janela: os N dias imediatamente
 * anteriores.
 */
export function janelaAnterior(
  preset: PresetPeriodo,
  de: string,
  ate: string,
): JanelaData {
  if (preset === "mes-atual" || preset === "mes-anterior") {
    const anteriorDe = somarMeses(de, -1);
    const anteriorAte =
      // Mes fechado compara com o mes fechado anterior inteiro; mes em curso
      // compara com o mesmo intervalo de dias do mes anterior.
      ate === ultimoDiaDoMes(ate)
        ? ultimoDiaDoMes(anteriorDe)
        : menor(somarMeses(ate, -1), ultimoDiaDoMes(anteriorDe));
    return { de: anteriorDe, ate: anteriorAte, dias: contarDias(anteriorDe, anteriorAte) };
  }

  const dias = contarDias(de, ate);
  const anteriorAte = somarDias(de, -1);
  const anteriorDe = somarDias(anteriorAte, -(dias - 1));
  return { de: anteriorDe, ate: anteriorAte, dias };
}

// ------------------------------------------------------------------- resolucao

export type EntradaPeriodo = {
  preset?: PresetPeriodo;
  de?: string;
  ate?: string;
};

/**
 * Converte a intencao do usuario em datas concretas.
 *
 * Regra padrao (sem parametro nenhum): do primeiro dia do mes corrente ate a
 * data mais recente disponivel na base.
 *
 * Duas travas vem da realidade do dado, nao da especificacao:
 *
 * 1) O fim da janela nunca passa de HOJE. A base tem `usage_date` em setembro
 *    (cobranca anual lancada adiantado) com hoje em agosto; usar `max(usage_date)`
 *    cru colocaria o mes que vem dentro do "mes atual".
 *
 * 2) O fim tambem nao passa do ultimo dia com dado. Sem isso o grafico do mes
 *    corrente termina com dias zerados que parecem queda de consumo, quando na
 *    verdade o ETL ainda nao carregou.
 */
export function resolverPeriodo(
  entrada: EntradaPeriodo,
  contexto: ContextoTemporal,
): PeriodoResolvido {
  const { hoje, maiorDataComDado } = contexto;
  const preset: PresetPeriodo = entrada.preset ?? (entrada.de ? "personalizado" : "mes-atual");

  /** Ultimo dia que faz sentido exibir: nem no futuro, nem depois da carga. */
  const tetoDisponivel = maiorDataComDado ? menor(maiorDataComDado, hoje) : hoje;

  let de: string;
  let ate: string;
  let limitadoPorDadoDisponivel = false;

  switch (preset) {
    case "7d":
    case "30d": {
      const dias = preset === "7d" ? 7 : 30;
      ate = hoje;
      de = somarDias(ate, -(dias - 1));
      break;
    }

    case "mes-atual": {
      de = primeiroDiaDoMes(hoje);
      const fimNatural = menor(ultimoDiaDoMes(hoje), hoje);
      // `maior(de, ...)`: se a carga mais recente for anterior ao mes corrente,
      // a janela nao pode inverter -- fica no primeiro dia do mes.
      ate = maior(de, menor(fimNatural, tetoDisponivel));
      limitadoPorDadoDisponivel = ate < fimNatural;
      break;
    }

    case "mes-anterior": {
      const dentroDoMesAnterior = somarMeses(primeiroDiaDoMes(hoje), -1);
      de = dentroDoMesAnterior;
      ate = ultimoDiaDoMes(dentroDoMesAnterior);
      break;
    }

    case "personalizado": {
      // O esquema Zod ja garante presenca e ordem; o fallback existe so para o
      // caso de alguem chamar esta funcao direto.
      de = entrada.de ?? primeiroDiaDoMes(hoje);
      ate = entrada.ate ?? hoje;
      break;
    }
  }

  return {
    preset,
    rotulo: ROTULOS_PERIODO[preset],
    de,
    ate,
    dias: contarDias(de, ate),
    anterior: janelaAnterior(preset, de, ate),
    limitadoPorDadoDisponivel,
    existeDadoAlemDaJanela: Boolean(maiorDataComDado && maiorDataComDado > ate),
  };
}
