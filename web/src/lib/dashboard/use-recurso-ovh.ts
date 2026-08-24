"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buscarRecurso } from "./api";
import { paramsDaApiOvh, validarIntervaloOvh, type FiltrosOvh } from "./filtros-ovh";
import type { MetaOvh } from "./tipos-ovh";
import type { Recurso } from "./use-dashboard";

/**
 * Busca UM recurso OVH, com os filtros da URL.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO REUSAR `useDashboardOvh`
 *
 * Aquele hook busca **seis** recursos de uma vez — resumo, mensal, serviços,
 * projetos, faturas e status — porque o painel executivo mostra os seis na mesma
 * tela. O Analítico mostra **um por aba**.
 *
 * Reusá-lo faria cada aba disparar seis requisições e descartar cinco. Com o
 * PostgreSQL compartilhado com o Metabase e `PG_POOL_MAX=5`, cinco consultas
 * inúteis por navegação não são desprezíveis — e trocar de aba é o gesto mais
 * frequente desta tela.
 *
 * A lógica de filtro, aborto e validação de intervalo é a mesma, e vem dos
 * mesmos módulos: nada aqui reimplementa regra de filtro.
 */
export function useRecursoOvh<T>(caminho: string, filtros: FiltrosOvh): Recurso<T> & {
  carregando: boolean;
  meta: MetaOvh | null;
  recarregar: () => void;
} {
  const [estado, setEstado] = useState<{
    dados: T | null;
    erro: Recurso<T>["erro"];
    meta: MetaOvh | null;
    /** Chave já resolvida. `null` = nada carregado ainda. */
    chaveCarregada: string | null;
  }>({ dados: null, erro: null, meta: null, chaveCarregada: null });

  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  // A query string é a dependência real: comparar o objeto de filtros dispararia
  // busca a cada render, porque o objeto é novo toda vez.
  const busca = useMemo(() => {
    const problema = validarIntervaloOvh(filtros);
    return problema ? null : paramsDaApiOvh(filtros).toString();
  }, [filtros]);

  const chave = busca === null ? null : `${busca}|${gatilho}`;

  /**
   * `carregando` é DERIVADO, não guardado em estado.
   *
   * Marcá-lo dentro do efeito seria `set-state-in-effect` — o React alerta com
   * razão: um `setState` síncrono no efeito provoca um segundo render antes da
   * pintura, e no caso do intervalo inválido (que nem chega a buscar) provocaria
   * um render extra para dizer "não estou carregando", que já era verdade.
   *
   * Comparar a chave pedida com a última resolvida dá o mesmo resultado sem
   * render nenhum: enquanto forem diferentes, há busca em curso.
   */
  const carregando = chave !== null && estado.chaveCarregada !== chave;

  useEffect(() => {
    // Intervalo inválido: não chama a API. A mensagem sai embaixo do campo.
    if (busca === null || chave === null) return;

    const controlador = new AbortController();
    const sinal = controlador.signal;

    (async () => {
      try {
        const r = await buscarRecurso<T, MetaOvh>(
          caminho,
          new URLSearchParams(busca),
          sinal,
        );
        if (sinal.aborted) return;
        setEstado({ dados: r.dados, erro: null, meta: r.meta, chaveCarregada: chave });
      } catch (erro) {
        // `AbortError` não é falha: é troca de filtro antes de a anterior voltar.
        // Mostrá-lo pintaria a tela de vermelho a cada tecla digitada no filtro.
        if (sinal.aborted) return;
        setEstado({
          dados: null,
          erro: erro as Recurso<T>["erro"],
          meta: null,
          chaveCarregada: chave,
        });
      }
    })();

    return () => controlador.abort();
  }, [caminho, busca, chave]);

  return {
    dados: estado.dados,
    erro: estado.erro,
    meta: estado.meta,
    carregando,
    recarregar,
  };
}
