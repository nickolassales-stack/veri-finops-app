"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErroDeRequisicao, buscarRecurso } from "./api";
import { paramsDaApiAnalitico, type FiltrosAnalitico } from "./analitico";
import type { Cotacao, MetaResposta } from "./tipos";

/**
 * Carregamento da pagina analitica.
 *
 * PAGINACAO SERVER-SIDE: cada requisicao traz `pageSize` linhas e o total
 * contado no banco. O navegador nunca acumula o historico -- trocar de pagina
 * substitui o conteudo, nao concatena.
 *
 * Enquanto a proxima pagina carrega, as linhas anteriores PERMANECEM na tela.
 * Esvaziar a tabela a cada clique faria o layout saltar e daria a impressao de
 * que o dado sumiu.
 */

export type LinhaAnalitica = {
  id: string;
  usageDate: string;
  accountId: string;
  accountName: string | null;
  service: string;
  region: string | null;
  costUSD: number;
  currency: string;
  /** `null` quando nao ha cotacao. Nunca zero. */
  estimatedBRL: number | null;
};

/**
 * `Omit<..., "paginacao">`: os outros endpoints paginam com chaves em portugues
 * (`pagina`, `tamanho`), este com as em ingles pedidas no contrato desta rota.
 * Sem o Omit, os dois formatos colidiriam no mesmo nome de campo.
 */
export type MetaAnalitica = Omit<MetaResposta, "paginacao"> & {
  paginacao?: { page: number; pageSize: number; total: number; pages: number };
  ordenacao?: { sortBy: string; sortDirection: string };
  somaUSD?: number;
  somaBRL?: number | null;
  cotacao?: Cotacao;
  regioesDisponiveis?: { valor: string | null; linhas: number }[];
};

export type DadosAnalitico = {
  linhas: LinhaAnalitica[] | null;
  meta: MetaAnalitica | null;
  erro: ErroDeRequisicao | null;
  /** Primeira carga: a tabela ainda nao existe na tela. */
  carregandoInicial: boolean;
  /** Trocando de pagina/filtro com dados ja visiveis. */
  carregandoPagina: boolean;
  recarregar: () => void;
};

type Resultado = {
  chave: string;
  linhas: LinhaAnalitica[];
  meta: MetaAnalitica;
  erro: ErroDeRequisicao | null;
};

export function useAnalitico(filtros: FiltrosAnalitico): DadosAnalitico {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  const busca = useMemo(() => paramsDaApiAnalitico(filtros).toString(), [filtros]);
  const chave = `${busca}|${gatilho}`;

  /**
   * Numero da requisicao mais recente.
   *
   * A regra e "a ultima vence", e NAO "descarte se o sinal foi abortado".
   * Descartar por `aborted` deixa um buraco: se a resposta chega depois do
   * abort e nenhuma requisicao nova assume o lugar, o estado nunca sai de
   * "atualizando" e a tabela fica esmaecida para sempre. Comparando o numero,
   * a ultima requisicao SEMPRE conclui o ciclo.
   */
  const ultimaRequisicao = useRef(0);

  useEffect(() => {
    const minha = ++ultimaRequisicao.current;
    const controlador = new AbortController();

    (async () => {
      try {
        const { dados, meta } = await buscarRecurso<LinhaAnalitica[], MetaAnalitica>(
          "/api/dashboard/analytic",
          new URLSearchParams(busca),
          controlador.signal,
        );
        if (ultimaRequisicao.current === minha) {
          setResultado({ chave, linhas: dados, meta, erro: null });
        }
      } catch (err) {
        // Requisicao superada por outra: some em silencio, quem assumiu resolve.
        if (ultimaRequisicao.current !== minha) return;
        // Abort da requisicao ATUAL so acontece no desmonte -- nada a atualizar.
        if (err instanceof Error && err.name === "AbortError") return;

        setResultado({
          chave,
          linhas: [],
          meta: {} as MetaAnalitica,
          erro:
            err instanceof ErroDeRequisicao
              ? err
              : new ErroDeRequisicao(0, "falha-de-rede", "Não foi possível falar com o servidor."),
        });
      }
    })();

    return () => controlador.abort();
  }, [busca, chave]);

  // Estado de carregamento DERIVADO: verdade sempre que o resultado em maos nao
  // corresponde a chave atual. Guardar em estado exigiria setState sincrono
  // dentro do efeito, que provoca render em cascata.
  const desatualizado = resultado?.chave !== chave;

  return {
    linhas: resultado?.erro ? [] : (resultado?.linhas ?? null),
    meta: resultado?.meta ?? null,
    erro: resultado?.erro ?? null,
    carregandoInicial: resultado === null,
    carregandoPagina: resultado !== null && desatualizado,
    recarregar,
  };
}
