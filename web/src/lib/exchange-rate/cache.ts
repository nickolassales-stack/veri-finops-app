import type { CotacaoBruta } from "./tipos";

/**
 * Cache da cotacao, em memoria do processo.
 *
 * Duas camadas com propositos diferentes:
 *
 * 1. Dentro do TTL, evita ida a rede em toda requisicao.
 * 2. Passado o TTL, o valor NAO e descartado. Ele vira reserva: se a proxima
 *    busca falhar, e melhor mostrar a cotacao de ontem marcada como
 *    desatualizada do que nao mostrar nada. So e descartado depois de
 *    `RETENCAO_MAXIMA_MS`, quando ja nao serve nem para ordem de grandeza.
 *
 * LIMITACAO CONHECIDA: e por processo e some no restart do container. Nao
 * quebra nada -- a primeira requisicao depois do restart busca de novo, e se o
 * Banco Central estiver fora no exato momento, o dashboard segue em USD. Como
 * hoje roda uma replica so, nao vale a complexidade de persistir.
 */

/** Depois disso a reserva e velha demais para significar alguma coisa. */
const RETENCAO_MAXIMA_MS = 7 * 24 * 3600 * 1000;

export type EntradaCache = {
  cotacao: CotacaoBruta;
  /** Epoch em que ESTA aplicacao obteve o valor. */
  obtidaEm: number;
};

type EstadoCache = {
  entrada?: EntradaCache;
  /** Busca em andamento, para nao disparar N chamadas simultaneas. */
  emVoo?: Promise<CotacaoBruta>;
};

// Preso ao globalThis para sobreviver a recompilacao do dev server (HMR),
// mesmo motivo do pool do Postgres.
const global = globalThis as unknown as { finopsCotacao?: EstadoCache };

function estado(): EstadoCache {
  global.finopsCotacao ??= {};
  return global.finopsCotacao;
}

export function lerCache(agora: number): EntradaCache | undefined {
  const atual = estado().entrada;
  if (!atual) return undefined;

  if (agora - atual.obtidaEm > RETENCAO_MAXIMA_MS) {
    estado().entrada = undefined;
    return undefined;
  }

  return atual;
}

export function gravarCache(cotacao: CotacaoBruta, agora: number): void {
  estado().entrada = { cotacao, obtidaEm: agora };
}

/**
 * Garante uma unica busca simultanea.
 *
 * Sem isso, dez requisicoes chegando com o cache vencido virariam dez chamadas
 * ao Banco Central. Todas esperam a mesma promessa.
 */
export function comDeduplicacao(
  buscar: () => Promise<CotacaoBruta>,
): Promise<CotacaoBruta> {
  const e = estado();
  if (e.emVoo) return e.emVoo;

  const promessa = buscar().finally(() => {
    e.emVoo = undefined;
  });

  e.emVoo = promessa;
  return promessa;
}

/** Somente para teste: zera o estado entre casos. */
export function limparCacheDeCotacao(): void {
  global.finopsCotacao = {};
}
