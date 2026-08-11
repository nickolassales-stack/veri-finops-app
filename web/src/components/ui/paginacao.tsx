"use client";

import { formatInteiro } from "@/lib/format";

/**
 * Navegacao de paginas.
 *
 * Deliberadamente sem lista numerada de paginas: com dezenas de milhares de
 * linhas, a numeracao viraria "1 2 3 … 847" e ninguem clica em pagina 412. O
 * util e saber onde esta, quantas ha, e andar uma por vez ou pular para as
 * pontas.
 *
 * Botoes de verdade com `aria-label` explicito -- "‹" sozinho nao diz nada para
 * quem usa leitor de tela.
 */
export function Paginacao({
  pagina,
  paginas,
  total,
  tamanho,
  ocupado,
  aoIr,
}: {
  pagina: number;
  paginas: number;
  total: number;
  tamanho: number;
  ocupado: boolean;
  aoIr: (pagina: number) => void;
}) {
  const primeiraLinha = total === 0 ? 0 : (pagina - 1) * tamanho + 1;
  const ultimaLinha = Math.min(pagina * tamanho, total);

  const naPrimeira = pagina <= 1;
  const naUltima = pagina >= paginas;

  return (
    <nav
      aria-label="Navegação de páginas"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-veri-offwhite pt-4"
    >
      {/* `aria-live`: ao trocar de pagina o leitor de tela anuncia a nova faixa,
          senao as linhas mudam sem nenhum aviso. */}
      <p aria-live="polite" className="text-sm text-veri-verde-escuro/75">
        {total === 0 ? (
          "Nenhuma linha"
        ) : (
          <>
            Linhas{" "}
            <span className="veri-numero font-medium text-veri-verde-escuro">
              {formatInteiro(primeiraLinha)}–{formatInteiro(ultimaLinha)}
            </span>{" "}
            de <span className="veri-numero">{formatInteiro(total)}</span>
            <span className="text-veri-verde-escuro/60">
              {" "}
              · página {formatInteiro(pagina)} de {formatInteiro(paginas)}
            </span>
          </>
        )}
      </p>

      <div className="flex items-center gap-1.5">
        <Botao rotulo="Primeira página" simbolo="«" desabilitado={naPrimeira || ocupado} aoClicar={() => aoIr(1)} />
        <Botao rotulo="Página anterior" simbolo="‹" desabilitado={naPrimeira || ocupado} aoClicar={() => aoIr(pagina - 1)} />
        <Botao rotulo="Próxima página" simbolo="›" desabilitado={naUltima || ocupado} aoClicar={() => aoIr(pagina + 1)} />
        <Botao rotulo="Última página" simbolo="»" desabilitado={naUltima || ocupado} aoClicar={() => aoIr(paginas)} />
      </div>
    </nav>
  );
}

function Botao({
  rotulo,
  simbolo,
  desabilitado,
  aoClicar,
}: {
  rotulo: string;
  simbolo: string;
  desabilitado: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={desabilitado}
      aria-label={rotulo}
      title={rotulo}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-veri-verde-claro/50 bg-veri-branco text-veri-verde-escuro transition-colors hover:bg-veri-offwhite disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-veri-branco"
    >
      <span aria-hidden>{simbolo}</span>
    </button>
  );
}
