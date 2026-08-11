"use client";

import type { Conta } from "@/lib/dashboard/tipos";
import type { FiltrosDashboard, ProblemaFiltro } from "@/lib/dashboard/filtros";
import type { Recurso } from "@/lib/dashboard/use-dashboard";

import { FiltroContas } from "./filtro-contas";
import { FiltroPeriodo } from "./filtro-periodo";

/**
 * Barra de filtros globais.
 *
 * Fica numa `<section>` propria com rotulo, acima dos graficos, e vale para
 * TODO o painel -- nao existe filtro por card. Em telas estreitas os dois
 * grupos empilham; nenhum deles depende de largura para funcionar.
 */
export function BarraFiltros({
  filtros,
  contas,
  problema,
  carregando,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosDashboard;
  contas: Recurso<Conta[]> & { carregando: boolean };
  problema: ProblemaFiltro;
  carregando: boolean;
  aoMudar: (mudanca: Partial<FiltrosDashboard>) => void;
  aoLimpar: () => void;
}) {
  const temFiltroAplicado =
    filtros.periodo !== "mes-atual" || filtros.contas.length > 0;

  return (
    <section
      aria-label="Filtros do painel"
      className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:gap-8">
          <FiltroPeriodo filtros={filtros} problema={problema} aoMudar={aoMudar} />
          <FiltroContas
            contas={contas}
            selecionadas={filtros.contas}
            aoMudar={(c) => aoMudar({ contas: c })}
          />
        </div>

        <div className="flex items-center gap-3 lg:pt-6">
          {/* Indicador discreto de atualizacao. `aria-live` para quem nao ve
              o movimento saber que os numeros estao sendo trocados. */}
          <span
            aria-live="polite"
            className={[
              "text-xs text-veri-verde-escuro/60 transition-opacity",
              carregando ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {carregando ? "Atualizando…" : ""}
          </span>

          {temFiltroAplicado && (
            <button
              type="button"
              onClick={aoLimpar}
              className="rounded-full border border-veri-verde-claro/50 px-4 py-1.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
