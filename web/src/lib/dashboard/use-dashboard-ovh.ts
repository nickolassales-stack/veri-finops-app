"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ErroDeRequisicao, buscarRecurso } from "./api";
import { paramsDaApiOvh, validarIntervaloOvh, type FiltrosOvh } from "./filtros-ovh";
import type {
  FaturaOvhCliente,
  MetaOvh,
  PontoMensalOvhCliente,
  ProjetoOvhCliente,
  ResumoOvhCliente,
  ServicoOvhCliente,
  SincronizacaoOvh,
} from "./tipos-ovh";
import type { Recurso } from "./use-dashboard";

/**
 * Carregamento da visao OVH.
 *
 * Mesmo arranjo de `useDashboard`: todos os recursos em PARALELO, cada um com o
 * proprio erro, e `Promise.allSettled` em vez de `Promise.all` -- com `all`, a
 * primeira falha descartaria as respostas que ja tinham chegado e um card
 * quebrado apagaria o painel inteiro.
 *
 * A `sincronizacao` e a excecao proposital: ela NAO depende dos filtros. O
 * estado do collector e o mesmo para qualquer janela, e refazer a consulta a
 * cada troca de periodo seria pedir duas vezes a mesma resposta.
 */

export type DadosOvh = {
  carregando: boolean;
  primeiraCarga: boolean;
  resumo: Recurso<ResumoOvhCliente>;
  mensal: Recurso<PontoMensalOvhCliente[]>;
  servicos: Recurso<ServicoOvhCliente[]>;
  projetos: Recurso<ProjetoOvhCliente[]>;
  faturas: Recurso<FaturaOvhCliente[]>;
  /** Independe dos filtros: buscada uma vez. */
  sincronizacao: Recurso<SincronizacaoOvh>;
  /** Meta do resumo -- periodo, moeda escolhida, estado do dado. */
  meta: MetaOvh | null;
  /** Meta de `services`: total da janela e o que foi agrupado em "Outros". */
  metaServicos: MetaOvh | null;
  /** Meta de `projects`: a lista de projetos do seletor. */
  metaProjetos: MetaOvh | null;
  /** Meta de `invoices`: faturas sem mes atribuido, truncamento. */
  metaFaturas: MetaOvh | null;
  erroGlobal: ErroDeRequisicao | null;
  recarregar: () => void;
};

const VAZIO = { dados: null, erro: null } as const;

function comoRecurso<T>(r: PromiseSettledResult<{ dados: T; meta: MetaOvh }>): Recurso<T> {
  if (r.status === "fulfilled") return { dados: r.value.dados, erro: null };
  return {
    dados: null,
    erro:
      r.reason instanceof ErroDeRequisicao
        ? r.reason
        : new ErroDeRequisicao(
            0,
            "falha-de-rede",
            "Não foi possível falar com o servidor.",
          ),
  };
}

function metaDe<T>(r: PromiseSettledResult<{ dados: T; meta: MetaOvh }>): MetaOvh | null {
  return r.status === "fulfilled" ? r.value.meta : null;
}

type Resultado = Omit<DadosOvh, "recarregar" | "carregando" | "primeiraCarga"> & {
  chave: string;
};

export function useDashboardOvh(filtros: FiltrosOvh): DadosOvh {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  // A query string e a dependencia real: comparar o objeto de filtros
  // dispararia busca a cada render, porque o objeto e novo toda vez.
  const busca = useMemo(() => {
    const problema = validarIntervaloOvh(filtros);
    return problema ? null : paramsDaApiOvh(filtros).toString();
  }, [filtros]);

  const chave = busca === null ? null : `${busca}|${gatilho}`;

  useEffect(() => {
    // Intervalo invalido: nao chama a API. A mensagem sai embaixo do campo.
    if (busca === null || chave === null) return;

    const controlador = new AbortController();
    const params = new URLSearchParams(busca);
    const sinal = controlador.signal;

    (async () => {
      const [resumo, mensal, servicos, projetos, faturas, sincronizacao] =
        await Promise.allSettled([
          buscarRecurso<ResumoOvhCliente, MetaOvh>(
            "/api/dashboard/ovh/summary",
            params,
            sinal,
          ),
          buscarRecurso<PontoMensalOvhCliente[], MetaOvh>(
            "/api/dashboard/ovh/monthly",
            params,
            sinal,
          ),
          buscarRecurso<ServicoOvhCliente[], MetaOvh>(
            "/api/dashboard/ovh/services",
            params,
            sinal,
          ),
          buscarRecurso<ProjetoOvhCliente[], MetaOvh>(
            "/api/dashboard/ovh/projects",
            params,
            sinal,
          ),
          buscarRecurso<FaturaOvhCliente[], MetaOvh>(
            "/api/dashboard/ovh/invoices",
            params,
            sinal,
          ),
          // Sem `params`: o estado do collector nao tem recorte.
          buscarRecurso<SincronizacaoOvh, MetaOvh>(
            "/api/dashboard/ovh/sync-status",
            new URLSearchParams(),
            sinal,
          ),
        ]);

      if (sinal.aborted) return;

      const todos = [resumo, mensal, servicos, projetos, faturas, sincronizacao];
      // Sessao expirada derruba tudo ao mesmo tempo: vale um aviso unico no
      // topo, em vez da mesma mensagem repetida em seis cards.
      const expirou = todos
        .map((r) => (r.status === "rejected" ? r.reason : null))
        .find(
          (e): e is ErroDeRequisicao => e instanceof ErroDeRequisicao && e.exigeLogin,
        );

      setResultado({
        chave,
        resumo: comoRecurso(resumo),
        mensal: comoRecurso(mensal),
        servicos: comoRecurso(servicos),
        projetos: comoRecurso(projetos),
        faturas: comoRecurso(faturas),
        sincronizacao: comoRecurso(sincronizacao),
        meta: metaDe(resumo),
        metaServicos: metaDe(servicos),
        metaProjetos: metaDe(projetos),
        metaFaturas: metaDe(faturas),
        erroGlobal: expirou ?? null,
      });
    })();

    return () => controlador.abort();
  }, [busca, chave]);

  // `carregando` e DERIVADO, nao guardado: e verdade sempre que o resultado em
  // maos nao corresponde a chave atual. Guardar em estado exigiria um setState
  // sincrono dentro do efeito, que provoca render em cascata.
  const carregando = chave !== null && resultado?.chave !== chave;

  const base: Omit<DadosOvh, "recarregar"> = resultado
    ? { ...resultado, carregando, primeiraCarga: false }
    : {
        carregando,
        primeiraCarga: true,
        resumo: VAZIO,
        mensal: VAZIO,
        servicos: VAZIO,
        projetos: VAZIO,
        faturas: VAZIO,
        sincronizacao: VAZIO,
        meta: null,
        metaServicos: null,
        metaProjetos: null,
        metaFaturas: null,
        erroGlobal: null,
      };

  return { ...base, recarregar };
}
