"use client";

import { useId } from "react";

import {
  PRESETS_VISIVEIS,
  ROTULOS_PRESET,
  type FiltrosDashboard,
  type ProblemaFiltro,
} from "@/lib/dashboard/filtros";
import type { PresetPeriodo } from "@/lib/filtros/periodo";

/**
 * Filtro de periodo.
 *
 * Radios de verdade dentro de um `fieldset`, e nao botoes: o navegador ja da
 * de graca a navegacao por setas, o anuncio de "opcao 3 de 5" no leitor de tela
 * e o agrupamento semantico. O visual de pilha e so CSS sobre o radio nativo.
 */
export function FiltroPeriodo({
  filtros,
  problema,
  aoMudar,
}: {
  filtros: FiltrosDashboard;
  problema: ProblemaFiltro;
  aoMudar: (mudanca: Partial<FiltrosDashboard>) => void;
}) {
  const idBase = useId();
  const idDe = `${idBase}-de`;
  const idAte = `${idBase}-ate`;
  const idErro = `${idBase}-erro`;

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium uppercase tracking-wide text-veri-verde-escuro/60">
        Período
      </legend>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS_VISIVEIS.map((preset: PresetPeriodo) => {
          const id = `${idBase}-${preset}`;
          const ativo = filtros.periodo === preset;

          return (
            <div key={preset} className="relative">
              <input
                type="radio"
                id={id}
                name={`${idBase}-periodo`}
                value={preset}
                checked={ativo}
                onChange={() => aoMudar({ periodo: preset })}
                // `sr-only` e nao `hidden`: o radio continua focavel e
                // navegavel por setas, so nao e desenhado.
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={[
                  "block cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  "peer-focus-visible:outline peer-focus-visible:outline-2",
                  "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-veri-verde-escuro",
                  ativo
                    ? "border-veri-verde-escuro bg-veri-verde-escuro text-veri-branco"
                    : "border-veri-verde-claro/50 bg-veri-branco text-veri-verde-escuro hover:bg-veri-offwhite",
                ].join(" ")}
              >
                {ROTULOS_PRESET[preset]}
              </label>
            </div>
          );
        })}
      </div>

      {filtros.periodo === "personalizado" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor={idDe}
              className="block text-xs text-veri-verde-escuro/70"
            >
              De
            </label>
            <input
              type="date"
              id={idDe}
              value={filtros.de}
              max={filtros.ate || undefined}
              onChange={(e) => aoMudar({ de: e.target.value })}
              aria-invalid={problema?.campo === "de" || undefined}
              aria-describedby={problema ? idErro : undefined}
              className={campoData(problema?.campo === "de")}
            />
          </div>

          <div>
            <label
              htmlFor={idAte}
              className="block text-xs text-veri-verde-escuro/70"
            >
              Até
            </label>
            <input
              type="date"
              id={idAte}
              value={filtros.ate}
              min={filtros.de || undefined}
              onChange={(e) => aoMudar({ ate: e.target.value })}
              aria-invalid={problema?.campo === "ate" || undefined}
              aria-describedby={problema ? idErro : undefined}
              className={campoData(problema?.campo === "ate")}
            />
          </div>

          {problema && (
            // `role="alert"` para o erro ser anunciado assim que aparece.
            <p
              id={idErro}
              role="alert"
              className="w-full text-sm text-veri-vinho sm:w-auto"
            >
              {problema.mensagem}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function campoData(comErro: boolean): string {
  return [
    "mt-1 rounded-lg border bg-veri-branco px-3 py-1.5 text-sm text-veri-verde-escuro",
    comErro ? "border-veri-vinho" : "border-veri-verde-claro/50",
  ].join(" ");
}
