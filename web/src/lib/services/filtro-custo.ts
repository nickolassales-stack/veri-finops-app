import "server-only";

import type { z } from "zod";

import { analisar } from "@/lib/api/http";
import { lerParametros } from "@/lib/filtros/esquemas";
import { resolverPeriodo, type PresetPeriodo } from "@/lib/filtros/periodo";
import { filtrarContasInexistentes } from "@/lib/queries/contas";
import { getContextoTemporal } from "@/lib/queries/dashboard";
import type { FiltroCusto } from "@/lib/queries/filtros-sql";

/**
 * Traducao de "o que veio na URL" para "o que a query aceita".
 *
 * Um unico lugar faz isso para os cinco endpoints de dashboard, o que garante
 * que todos apliquem o mesmo periodo padrao, o mesmo teto de dias e a mesma
 * regra de comparacao. Se cada rota resolvesse periodo por conta propria, dois
 * cards da mesma tela poderiam mostrar janelas diferentes.
 */

/** Formato minimo que um esquema de endpoint precisa produzir. */
export type EntradaFiltroCusto = {
  periodo?: PresetPeriodo;
  de?: string;
  ate?: string;
  contas: string[];
  regiao?: string;
};

export type FiltroResolvido<T extends EntradaFiltroCusto> = {
  entrada: T;
  filtro: FiltroCusto;
  /** Vai para o `meta` da resposta: o cliente precisa saber o que foi aplicado. */
  meta: Record<string, unknown>;
};

export async function resolverFiltroCusto<T extends EntradaFiltroCusto>(
  url: URL,
  tz: string,
  esquema: z.ZodType<T>,
): Promise<FiltroResolvido<T>> {
  const entrada = analisar(esquema, lerParametros(url));

  const contexto = await getContextoTemporal(tz);
  const periodo = resolverPeriodo(
    { preset: entrada.periodo, de: entrada.de, ate: entrada.ate },
    contexto,
  );

  // Conta que nao existe no cadastro produziria "US$ 0,00" silencioso, e quem
  // digitou o id errado concluiria que a conta nao gastou nada.
  const contasInexistentes = await filtrarContasInexistentes(entrada.contas);

  const filtro: FiltroCusto = {
    periodo,
    contas: entrada.contas,
    regiao: entrada.regiao,
  };

  return {
    entrada,
    filtro,
    meta: {
      periodo: {
        preset: periodo.preset,
        rotulo: periodo.rotulo,
        de: periodo.de,
        ate: periodo.ate,
        dias: periodo.dias,
        anterior: periodo.anterior,
        limitadoPorDadoDisponivel: periodo.limitadoPorDadoDisponivel,
        existeDadoAlemDaJanela: periodo.existeDadoAlemDaJanela,
      },
      filtros: {
        contas: entrada.contas,
        todasAsContas: entrada.contas.length === 0,
        regiao: entrada.regiao ?? null,
      },
      base: {
        hoje: contexto.hoje,
        maiorDataComDado: contexto.maiorDataComDado,
      },
      ...(contasInexistentes.length > 0
        ? {
            avisos: [
              {
                codigo: "conta-nao-cadastrada",
                mensagem:
                  "Conta(s) filtrada(s) que nao existem em cloud_accounts: " +
                  `${contasInexistentes.join(", ")}. O total pode vir zerado por isso.`,
              },
            ],
          }
        : {}),
    },
  };
}
