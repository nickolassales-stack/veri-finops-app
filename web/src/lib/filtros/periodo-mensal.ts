/**
 * Resolucao de periodo em MESES. Modulo PURO: nao toca no banco, nao le
 * ambiente, nao chama `Date.now()` sem receber o contexto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM SEGUNDO MODULO DE PERIODO, E NAO UM PRESET NOVO EM `periodo.ts`
 *
 * O periodo da AWS e uma janela de DIAS: `aws_daily_costs.usage_date` tem uma
 * linha por dia, e "ultimos 30 dias" e uma pergunta que a tabela responde.
 * `ovh_monthly_costs.billing_month` e `date` com CHECK de que o valor e sempre
 * o dia 1 do mes -- a granularidade minima do dado OVH e o MES.
 *
 * Acrescentar "12m" a `PRESETS_PERIODO` faria os endpoints da AWS aceitarem um
 * preset que eles nao sabem resolver, e faria a tela OVH aceitar "7d", que na
 * OVH ou devolve um mes inteiro ou devolve nada -- as duas leituras erradas.
 * Dois vocabularios separados porque as duas perguntas sao diferentes.
 * ---------------------------------------------------------------------------
 *
 * Todo mes aqui e a string "AAAA-MM", nunca um `Date`. Mesma disciplina de
 * `periodo.ts`, e pelo mesmo motivo: `date` do Postgres nao tem hora nem fuso,
 * e trata-lo como instante produz erro de um mes em fuso negativo.
 */

export const PRESETS_MES = [
  "6m",
  "12m",
  "24m",
  "ano-atual",
  "personalizado",
] as const;

export type PresetMes = (typeof PRESETS_MES)[number];

/** Padrao da visao OVH: 12 meses fechados ate o mes corrente. */
export const PRESET_MES_PADRAO: PresetMes = "12m";

export const ROTULOS_MES: Record<PresetMes, string> = {
  "6m": "Últimos 6 meses",
  "12m": "Últimos 12 meses",
  "24m": "Últimos 24 meses",
  "ano-atual": "Ano atual",
  personalizado: "Período personalizado",
};

/**
 * Teto de meses por consulta. Cinco anos cobre qualquer analise real de fatura
 * e impede que uma URL montada a mao varra a tabela inteira.
 */
export const MAX_MESES_PERIODO = 60;

const FORMATO_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export type JanelaMes = {
  /** Primeiro mes da janela, "AAAA-MM". */
  deMes: string;
  /** Ultimo mes da janela, "AAAA-MM". Inclusivo. */
  ateMes: string;
  /** Quantidade de meses, inclusiva: de 2026-08 a 2026-08 = 1. */
  meses: number;
};

export type PeriodoMensalResolvido = JanelaMes & {
  preset: PresetMes;
  rotulo: string;
  /** Janela imediatamente anterior, do MESMO tamanho, para comparacao. */
  anterior: JanelaMes;
};

// ------------------------------------------------------- aritmetica de meses

/** Valida formato E faixa do mes (rejeita 2026-13 e 2026-00). */
export function ehMesISOValido(valor: string): boolean {
  return FORMATO_MES.test(valor);
}

/**
 * "AAAA-MM" -> indice absoluto de mes (ano * 12 + mes - 1).
 *
 * ESTA E A FUNCAO QUE EVITA O BUG. A tentacao e calcular "12 meses atras"
 * mexendo em ano e mes separadamente, com um `if` para o caso de virar o ano.
 * Foi exatamente isso que quebrou a janela do collector OVH: a expressao
 * `ano - (1 if mes <= MESES % 12 else 0)` devolvia sempre janeiro do ano
 * corrente, e a coleta perdeu 16 meses sem erro nenhum.
 *
 * Em indice absoluto nao existe virada de ano: subtrair 12 e subtrair 12.
 */
export function indiceDoMes(iso: string): number {
  const [ano, mes] = iso.split("-").map(Number);
  return ano * 12 + (mes - 1);
}

/** Inverso de `indiceDoMes`. */
export function mesDoIndice(indice: number): string {
  const ano = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
}

export function somarMeses(iso: string, meses: number): string {
  return mesDoIndice(indiceDoMes(iso) + meses);
}

/** Diferenca inclusiva: de 2026-01 a 2026-01 = 1 mes. */
export function contarMeses(deMes: string, ateMes: string): number {
  return indiceDoMes(ateMes) - indiceDoMes(deMes) + 1;
}

/** "2026-08-17" -> "2026-08". Aceita tambem "2026-08". */
export function mesDe(dataISO: string): string {
  return dataISO.slice(0, 7);
}

// ------------------------------------------------------------------ resolucao

/**
 * Janela anterior de tamanho equivalente.
 *
 * Sempre os N meses imediatamente antes de `deMes`, inclusive para
 * "ano-atual": comparar os 8 meses de 2026 com os 8 meses anteriores
 * (mai/2025 a dez/2025) responde "o custo subiu?". Comparar com o ano de 2025
 * inteiro compararia 8 meses com 12 e a variacao seria sempre negativa.
 */
function janelaAnterior(janela: JanelaMes): JanelaMes {
  const ateMes = somarMeses(janela.deMes, -1);
  const deMes = somarMeses(ateMes, -(janela.meses - 1));
  return { deMes, ateMes, meses: janela.meses };
}

/**
 * Resolve o preset em uma janela de meses concreta.
 *
 * `hoje` entra como parametro em vez de vir de `new Date()` para que o teste
 * possa fixar o mes corrente -- a mesma razao de `resolverPeriodo()` receber o
 * contexto temporal.
 *
 * Diferente da AWS, a janela NAO e encurtada pelo ultimo mes com dado. Na OVH
 * uma fatura chega dias depois do fim do mes, e o mes corrente legitimamente
 * ainda nao tem linha de `invoice`. Cortar a janela ali esconderia justamente o
 * mes que o usuario quer ver aparecer.
 */
export function resolverPeriodoMensal(
  preset: PresetMes,
  hoje: string,
  deMes?: string,
  ateMes?: string,
): PeriodoMensalResolvido {
  const mesCorrente = mesDe(hoje);

  const janela = ((): JanelaMes => {
    switch (preset) {
      case "personalizado": {
        // O chamador garante os dois valores (Zod recusa antes de chegar aqui).
        // O fallback existe para nao lancar num caminho de tipo impossivel.
        const de = deMes ?? mesCorrente;
        const ate = ateMes ?? mesCorrente;
        return { deMes: de, ateMes: ate, meses: contarMeses(de, ate) };
      }
      case "ano-atual": {
        const de = `${mesCorrente.slice(0, 4)}-01`;
        return { deMes: de, ateMes: mesCorrente, meses: contarMeses(de, mesCorrente) };
      }
      default: {
        const total = Number(preset.replace("m", ""));
        return {
          deMes: somarMeses(mesCorrente, -(total - 1)),
          ateMes: mesCorrente,
          meses: total,
        };
      }
    }
  })();

  return {
    ...janela,
    preset,
    rotulo: ROTULOS_MES[preset],
    anterior: janelaAnterior(janela),
  };
}

/**
 * Todos os meses da janela, em ordem crescente.
 *
 * O grafico de evolucao precisa dos meses SEM dado tambem: um mes ausente da
 * consulta e um mes sem fatura, e a linha deve ter buraco ali em vez de ligar
 * dois meses distantes como se fossem vizinhos.
 */
export function mesesDaJanela(janela: JanelaMes): string[] {
  const inicio = indiceDoMes(janela.deMes);
  return Array.from({ length: janela.meses }, (_, i) => mesDoIndice(inicio + i));
}
