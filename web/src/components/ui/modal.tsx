"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Caixa de diálogo — sobre o `<dialog>` nativo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `<dialog>` E NÃO UMA `<div>` COM POSITION FIXED
 *
 * `showModal()` entrega de graça um conjunto de comportamentos que uma div
 * exigiria reimplementar, e que quase sempre saem pela metade:
 *
 *   - foco preso dentro do diálogo (Tab não escapa para a página atrás);
 *   - `Esc` fecha;
 *   - o resto da página vira inerte para leitor de tela — não só invisível;
 *   - renderização na camada superior, sem `z-index` competindo com nada.
 *
 * O custo é um `useEffect` para casar o atributo `aberto` com o método
 * imperativo, porque o elemento tem estado próprio no DOM.
 *
 * ---------------------------------------------------------------------------
 * FECHAR É SEMPRE DO CHAMADOR
 *
 * O componente não guarda `aberto` em estado interno. Quem abre decide quando
 * fecha — e isso importa num formulário que salva: fechar sozinho ao submeter
 * esconderia a mensagem de erro que acabou de chegar.
 *
 * O `onClose` nativo dispara também no `Esc` e no clique fora, então os três
 * caminhos de fechamento passam pelo mesmo lugar.
 */
export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  largura = "media",
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  largura?: "media" | "larga";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;

    // `open` no atributo abriria SEM modalidade — sem foco preso e sem inerte.
    // Só `showModal()` dá o comportamento completo.
    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      onClose={aoFechar}
      // Clique no ::backdrop chega como clique no próprio <dialog>: o conteúdo
      // interno é um filho, então comparar o alvo distingue fora de dentro.
      onClick={(e) => {
        if (e.target === ref.current) aoFechar();
      }}
      aria-labelledby="modal-titulo"
      className={[
        "w-[calc(100vw-2rem)] rounded-2xl border border-veri-offwhite bg-veri-branco p-0",
        "text-veri-verde-escuro shadow-xl backdrop:bg-veri-verde-escuro/40",
        largura === "larga" ? "max-w-2xl" : "max-w-lg",
      ].join(" ")}
    >
      {/* `max-h` + scroll interno: num celular deitado, o formulário OVH não
          cabe, e sem isto os botões de ação ficariam fora do alcance. */}
      <div className="max-h-[85vh] overflow-y-auto">
        <header className="flex items-start justify-between gap-4 border-b border-veri-offwhite px-6 py-4">
          <div>
            <h2 id="modal-titulo" className="veri-display text-lg text-veri-verde-escuro">
              {titulo}
            </h2>
            {descricao && (
              <p className="mt-1 text-sm text-texto-suave">{descricao}</p>
            )}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="-mr-2 -mt-1 rounded-lg px-2 py-1 text-xl leading-none text-texto-suave transition hover:bg-veri-offwhite hover:text-veri-verde-escuro focus-visible:outline focus-visible:outline-2 focus-visible:outline-veri-verde-escuro"
          >
            ×
          </button>
        </header>

        <div className="px-6 py-5">{children}</div>
      </div>
    </dialog>
  );
}
