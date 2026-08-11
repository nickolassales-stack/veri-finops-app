"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ErroDeRequisicao, buscarRecurso } from "./api";
import { paramsDaApi, validarIntervalo, type FiltrosDashboard } from "./filtros";
import type {
  Conta,
  CustoDaConta,
  CustoDoServico,
  DiarioPorServico,
  Envelope,
  MetaResposta,
  PontoDiario,
  Resumo,
} from "./tipos";

/**
 * Carregamento dos dados do dashboard.
 *
 * Todos os recursos sao pedidos EM PARALELO e cada um guarda o proprio erro:
 * se a serie por servico falhar, os KPIs e os demais graficos continuam na
 * tela. Um card quebrado nao derruba o painel.
 *
 * `Promise.allSettled` e proposital -- com `Promise.all`, a primeira falha
 * descartaria as respostas que ja tinham chegado.
 */

export type Recurso<T> = { dados: T | null; erro: ErroDeRequisicao | null };

const VAZIO = { dados: null, erro: null } as const;

export type DadosDashboard = {
  carregando: boolean;
  /** `true` apenas na primeira carga; trocar filtro nao volta ao esqueleto. */
  primeiraCarga: boolean;
  resumo: Recurso<Resumo>;
  porConta: Recurso<CustoDaConta[]>;
  servicos: Recurso<CustoDoServico[]>;
  diario: Recurso<PontoDiario[]>;
  diarioPorServico: Recurso<DiarioPorServico>;
  /** Meta do resumo: periodo aplicado, avisos, base temporal. */
  meta: MetaResposta | null;
  /** Meta de `services`, que traz `outros` e o total da janela. */
  metaServicos: MetaResposta | null;
  /** Erro que impede tudo (sessao expirada, por exemplo). */
  erroGlobal: ErroDeRequisicao | null;
  recarregar: () => void;
};

function comoRecurso<T>(
  resultado: PromiseSettledResult<Envelope<T>>,
): Recurso<T> {
  if (resultado.status === "fulfilled") {
    return { dados: resultado.value.dados, erro: null };
  }
  const motivo = resultado.reason;
  return {
    dados: null,
    erro:
      motivo instanceof ErroDeRequisicao
        ? motivo
        : new ErroDeRequisicao(0, "falha-de-rede", "Não foi possível falar com o servidor."),
  };
}

function metaDe<T>(resultado: PromiseSettledResult<Envelope<T>>): MetaResposta | null {
  return resultado.status === "fulfilled" ? resultado.value.meta : null;
}

/** Resultado de uma rodada de busca, marcado com a chave que a originou. */
type Resultado = Omit<DadosDashboard, "recarregar" | "carregando" | "primeiraCarga"> & {
  chave: string;
};

export function useDashboard(filtros: FiltrosDashboard): DadosDashboard {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  // A query string e a dependencia real do efeito. Comparar o objeto de
  // filtros dispararia busca a cada render, porque o objeto e novo toda vez.
  const busca = useMemo(() => {
    const problema = validarIntervalo(filtros);
    return problema ? null : paramsDaApi(filtros).toString();
  }, [filtros]);

  // A chave inclui o gatilho para que "tentar novamente" tambem conte como uma
  // rodada nova, mesmo com os filtros iguais.
  const chave = busca === null ? null : `${busca}|${gatilho}`;

  useEffect(() => {
    // Intervalo invalido: nao chama a API. A mensagem sai embaixo do campo.
    if (busca === null || chave === null) return;

    const controlador = new AbortController();
    const params = new URLSearchParams(busca);

    (async () => {
      const [resumo, porConta, servicos, diario, diarioPorServico] =
        await Promise.allSettled([
          buscarRecurso<Resumo>("/api/dashboard/summary", params, controlador.signal),
          buscarRecurso<CustoDaConta[]>("/api/dashboard/accounts", params, controlador.signal),
          buscarRecurso<CustoDoServico[]>("/api/dashboard/services", params, controlador.signal),
          buscarRecurso<PontoDiario[]>("/api/dashboard/daily", params, controlador.signal),
          buscarRecurso<DiarioPorServico>(
            "/api/dashboard/daily-by-service",
            params,
            controlador.signal,
          ),
        ]);

      if (controlador.signal.aborted) return;

      const recursos = [resumo, porConta, servicos, diario, diarioPorServico];
      // Sessao expirada derruba tudo ao mesmo tempo -- vale um aviso unico no
      // topo, em vez da mesma mensagem repetida em cinco cards.
      const expirou = recursos
        .map((r) => (r.status === "rejected" ? r.reason : null))
        .find((e): e is ErroDeRequisicao => e instanceof ErroDeRequisicao && e.exigeLogin);

      setResultado({
        chave,
        resumo: comoRecurso(resumo),
        porConta: comoRecurso(porConta),
        servicos: comoRecurso(servicos),
        diario: comoRecurso(diario),
        diarioPorServico: comoRecurso(diarioPorServico),
        meta: metaDe(resumo),
        metaServicos: metaDe(servicos),
        erroGlobal: expirou ?? null,
      });
    })();

    return () => controlador.abort();
  }, [busca, chave]);

  // `carregando` e DERIVADO, nao guardado: e verdade sempre que o resultado em
  // maos nao corresponde a chave atual. Guardar em estado exigiria um setState
  // sincrono dentro do efeito, que provoca render em cascata.
  const carregando = chave !== null && resultado?.chave !== chave;

  const base: Omit<DadosDashboard, "recarregar"> = resultado
    ? { ...resultado, carregando, primeiraCarga: false }
    : {
        carregando,
        primeiraCarga: true,
        resumo: VAZIO,
        porConta: VAZIO,
        servicos: VAZIO,
        diario: VAZIO,
        diarioPorServico: VAZIO,
        meta: null,
        metaServicos: null,
        erroGlobal: null,
      };

  return { ...base, recarregar };
}

/**
 * Cadastro de contas, para montar o filtro.
 *
 * Buscado uma vez so: nao depende de periodo nem de conta selecionada. Nenhum
 * id de conta e fixo no codigo -- a lista inteira vem de `cloud_accounts`.
 */
export function useContas(): Recurso<Conta[]> & { carregando: boolean } {
  const [estado, setEstado] = useState<Recurso<Conta[]> & { carregando: boolean }>({
    dados: null,
    erro: null,
    carregando: true,
  });

  useEffect(() => {
    const controlador = new AbortController();

    (async () => {
      try {
        const { dados } = await buscarRecurso<Conta[]>(
          "/api/accounts",
          new URLSearchParams({ tamanho: "200", ordenarPor: "nome", direcao: "asc" }),
          controlador.signal,
        );
        if (!controlador.signal.aborted) {
          setEstado({ dados, erro: null, carregando: false });
        }
      } catch (err) {
        if (controlador.signal.aborted) return;
        setEstado({
          dados: null,
          erro:
            err instanceof ErroDeRequisicao
              ? err
              : new ErroDeRequisicao(0, "falha-de-rede", "Não foi possível carregar as contas."),
          carregando: false,
        });
      }
    })();

    return () => controlador.abort();
  }, []);

  return estado;
}
