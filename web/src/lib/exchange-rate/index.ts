import { getEnv } from "@/lib/env";

import { comDeduplicacao, gravarCache, lerCache } from "./cache";
import { ROTULOS_FONTE, buscarNoProvedor } from "./provedores";
import {
  ErroDeCotacao,
  type Cotacao,
  type CotacaoBruta,
  type EstimativaBRL,
  type ProvedorCotacao,
} from "./tipos";

export { limparCacheDeCotacao } from "./cache";
export type {
  Cotacao,
  EstimativaBRL,
  ProvedorCotacao,
  StatusCotacao,
} from "./tipos";

/**
 * Orquestracao da cotacao USD/BRL.
 *
 * CONTRATO PRINCIPAL: `obterCotacao()` NUNCA lanca. Qualquer falha vira um
 * objeto com `status: "unavailable"` e mensagem amigavel. Isso e o que garante
 * que o dashboard continue funcionando -- e continue mostrando USD -- quando o
 * Banco Central estiver fora do ar. Ha teste especifico para isso.
 *
 * Ordem de tentativa:
 *   1. provedor desligado           -> unavailable, sem tocar na rede
 *   2. cache dentro do TTL          -> cached
 *   3. busca no provedor            -> current
 *   4. falhou e ha valor guardado   -> cached + desatualizada + mensagem
 *   5. falhou e nao ha nada         -> unavailable + mensagem
 */

export const AVISO_ESTIMATIVA =
  "Conversao meramente indicativa. O valor oficial da AWS e em USD; " +
  "a cotacao PTAX nao considera spread nem IOF da fatura.";

export type OpcoesCotacao = {
  provedor?: ProvedorCotacao;
  ttlSegundos?: number;
  timeoutMs?: number;
  /** Injetaveis para teste. */
  fetchImpl?: typeof fetch;
  agora?: Date;
};

function indisponivel(
  provedor: ProvedorCotacao,
  mensagem: string,
): Cotacao {
  return {
    valor: null,
    dataReferencia: null,
    dataHoraReferencia: null,
    fonte: provedor === "nenhum" ? "conversao desabilitada" : rotulo(provedor),
    provedor,
    status: "unavailable",
    desatualizada: false,
    mensagemErro: mensagem,
    obtidaEm: null,
    idadeSegundos: null,
  };
}

function rotulo(provedor: ProvedorCotacao): string {
  return provedor === "nenhum" ? "conversao desabilitada" : ROTULOS_FONTE[provedor];
}

function montar(
  bruta: CotacaoBruta,
  provedor: ProvedorCotacao,
  status: "current" | "cached",
  obtidaEm: number,
  agora: number,
  desatualizada: boolean,
  mensagemErro: string | null,
): Cotacao {
  return {
    valor: bruta.valor,
    dataReferencia: bruta.dataReferencia,
    dataHoraReferencia: bruta.dataHoraReferencia,
    fonte: rotulo(provedor),
    provedor,
    status,
    desatualizada,
    mensagemErro,
    obtidaEm: new Date(obtidaEm).toISOString(),
    idadeSegundos: Math.max(0, Math.round((agora - obtidaEm) / 1000)),
  };
}

const PADRAO = { ttlSegundos: 3_600, timeoutMs: 4_000 } as const;

/**
 * Resolve a configuracao efetiva.
 *
 * `getEnv()` lanca quando a configuracao do ambiente esta incompleta. Ate isso
 * precisa virar "sem cotacao" em vez de excecao: configuracao errada da cotacao
 * nao pode derrubar a tela de custo.
 */
function lerConfiguracao(opcoes: OpcoesCotacao): {
  provedor: ProvedorCotacao;
  ttlSegundos: number;
  timeoutMs: number;
  motivoDesligado: string;
} {
  try {
    const env = getEnv();
    return {
      provedor: opcoes.provedor ?? env.EXCHANGE_RATE_PROVIDER,
      ttlSegundos: opcoes.ttlSegundos ?? env.EXCHANGE_RATE_CACHE_TTL_SECONDS,
      timeoutMs: opcoes.timeoutMs ?? env.EXCHANGE_RATE_TIMEOUT_MS,
      motivoDesligado: "Conversao para BRL desabilitada nesta instalacao.",
    };
  } catch {
    return {
      provedor: opcoes.provedor ?? "nenhum",
      ttlSegundos: opcoes.ttlSegundos ?? PADRAO.ttlSegundos,
      timeoutMs: opcoes.timeoutMs ?? PADRAO.timeoutMs,
      motivoDesligado: "Cotacao nao configurada nesta instalacao.",
    };
  }
}

export async function obterCotacao(opcoes: OpcoesCotacao = {}): Promise<Cotacao> {
  const { provedor, ttlSegundos, timeoutMs, motivoDesligado } = lerConfiguracao(opcoes);
  const agora = (opcoes.agora ?? new Date()).getTime();

  // 1. Desligado: nem toca na rede.
  if (provedor === "nenhum") {
    return indisponivel("nenhum", motivoDesligado);
  }

  const guardada = lerCache(agora);

  // 2. Cache fresco: nem toca na rede.
  if (guardada && agora - guardada.obtidaEm < ttlSegundos * 1000) {
    return montar(guardada.cotacao, provedor, "cached", guardada.obtidaEm, agora, false, null);
  }

  // 3. Buscar.
  try {
    const bruta = await comDeduplicacao(() =>
      buscarNoProvedor(provedor, {
        timeoutMs,
        fetchImpl: opcoes.fetchImpl,
        agora: opcoes.agora,
      }),
    );
    gravarCache(bruta, agora);
    return montar(bruta, provedor, "current", agora, agora, false, null);
  } catch (err) {
    const mensagem =
      err instanceof ErroDeCotacao
        ? err.mensagemAmigavel
        : "Nao foi possivel obter a cotacao do dolar.";

    // O detalhe fica no log do servidor; o cliente recebe so a frase.
    console.error("[cotacao] falha ao buscar no provedor", {
      provedor,
      mensagem,
      detalhe: err instanceof Error ? err.message : String(err),
    });

    // 4. Reserva: melhor um valor de ontem marcado como velho do que nada.
    if (guardada) {
      return montar(
        guardada.cotacao,
        provedor,
        "cached",
        guardada.obtidaEm,
        agora,
        true,
        `${mensagem} Exibindo a ultima cotacao conhecida.`,
      );
    }

    // 5. Nada a mostrar. O dashboard segue em USD.
    return indisponivel(provedor, mensagem);
  }
}

/**
 * Converte um custo em USD para BRL usando a cotacao dada.
 *
 * Devolve `null` quando nao ha cotacao -- nunca zero. Zero seria lido como
 * "custo zero" e e exatamente o tipo de numero inventado que este projeto nao
 * exibe.
 */
export function converterParaBRL(usd: number, cotacao: Cotacao): number | null {
  if (cotacao.valor === null || !Number.isFinite(usd)) return null;
  return usd * cotacao.valor;
}

/** Monta o bloco de estimativa que acompanha os totais em USD. */
export function estimarBRL(
  totalUsd: number,
  totalAnteriorUsd: number,
  cotacao: Cotacao,
): EstimativaBRL {
  return {
    total: converterParaBRL(totalUsd, cotacao),
    totalAnterior: converterParaBRL(totalAnteriorUsd, cotacao),
    cotacao,
    aviso: AVISO_ESTIMATIVA,
  };
}
