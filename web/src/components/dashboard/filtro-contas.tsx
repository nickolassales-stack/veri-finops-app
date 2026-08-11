"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Recurso } from "@/lib/dashboard/use-dashboard";
import type { Conta } from "@/lib/dashboard/tipos";

/**
 * Filtro de contas AWS: todas, uma ou varias.
 *
 * A lista vem inteira de `cloud_accounts` pela API -- nenhum id de conta e fixo
 * no codigo. Vazio significa "todas as contas", e e o padrao.
 *
 * Implementado com checkboxes reais dentro de um `<fieldset>` sob um botao que
 * abre e fecha o painel. Nao usa `<select multiple>`: em telas pequenas ele e
 * quase inutilizavel e nao mostra o nome amigavel junto do id.
 */
export function FiltroContas({
  contas,
  selecionadas,
  aoMudar,
}: {
  contas: Recurso<Conta[]> & { carregando: boolean };
  selecionadas: string[];
  aoMudar: (contas: string[]) => void;
}) {
  const idBase = useId();
  const idPainel = `${idBase}-painel`;
  const [aberto, setAberto] = useState(false);
  const container = useRef<HTMLFieldSetElement>(null);

  // Fecha ao clicar fora ou ao apertar Esc -- comportamento esperado de
  // qualquer painel suspenso, e o Esc e o unico caminho de saida por teclado.
  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (!container.current?.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const lista = contas.dados ?? [];
  const total = lista.length;
  const nenhumaSelecionada = selecionadas.length === 0;

  const resumo = nenhumaSelecionada
    ? total > 0
      ? `Todas as contas (${total})`
      : "Todas as contas"
    : selecionadas.length === 1
      ? (lista.find((c) => c.accountId === selecionadas[0])?.accountName ??
        selecionadas[0])
      : `${selecionadas.length} contas selecionadas`;

  function alternar(accountId: string) {
    aoMudar(
      selecionadas.includes(accountId)
        ? selecionadas.filter((c) => c !== accountId)
        : [...selecionadas, accountId],
    );
  }

  return (
    // `fieldset` + `legend`: e um grupo de controles relacionados, e a legenda
    // e o rotulo do grupo -- e o que o leitor de tela anuncia ao entrar nele.
    <fieldset ref={container} className="relative min-w-0">
      <legend
        id={`${idBase}-rotulo`}
        className="text-xs font-medium uppercase tracking-wide text-veri-verde-escuro/60"
      >
        Contas AWS
      </legend>

      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-controls={idPainel}
        aria-describedby={`${idBase}-rotulo`}
        disabled={contas.carregando || Boolean(contas.erro)}
        className="mt-2 flex w-full min-w-56 items-center justify-between gap-3 rounded-full border border-veri-verde-claro/50 bg-veri-branco px-4 py-1.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        <span className="truncate">
          {contas.carregando
            ? "Carregando contas…"
            : contas.erro
              ? "Contas indisponíveis"
              : resumo}
        </span>
        <span aria-hidden className="text-veri-verde-escuro/50">
          {aberto ? "▲" : "▼"}
        </span>
      </button>

      {aberto && (
        <div
          id={idPainel}
          className="absolute left-0 z-20 mt-2 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-veri-verde-claro/40 bg-veri-branco p-2 shadow-lg"
        >
          <div>
            <button
              type="button"
              onClick={() => aoMudar([])}
              className={[
                "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-veri-offwhite",
                nenhumaSelecionada
                  ? "font-medium text-veri-verde-escuro"
                  : "text-veri-verde-escuro/70",
              ].join(" ")}
            >
              Todas as contas
              {nenhumaSelecionada && <span aria-hidden> ✓</span>}
            </button>

            <hr className="my-2 border-veri-offwhite" />

            {lista.map((conta) => {
              const id = `${idBase}-${conta.accountId}`;
              return (
                <div key={conta.accountId} className="flex items-start gap-3 px-3 py-1.5">
                  <input
                    type="checkbox"
                    id={id}
                    checked={selecionadas.includes(conta.accountId)}
                    onChange={() => alternar(conta.accountId)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#384E46]"
                  />
                  <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
                    <span className="block truncate text-veri-verde-escuro">
                      {conta.accountName}
                      {!conta.active && (
                        <span className="text-veri-verde-escuro/50"> · inativa</span>
                      )}
                    </span>
                    <span className="veri-numero block truncate text-xs text-veri-verde-escuro/60">
                      {conta.accountId}
                      {conta.businessUnit && ` · ${conta.businessUnit}`}
                    </span>
                  </label>
                </div>
              );
            })}

            {lista.length === 0 && !contas.carregando && (
              <p className="px-3 py-2 text-sm text-veri-verde-escuro/60">
                Nenhuma conta cadastrada.
              </p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

