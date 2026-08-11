import type { ReactNode } from "react";

/**
 * Estados de um bloco de dados: carregando, erro e vazio.
 *
 * Os tres ocupam altura parecida com a do conteudo real, para a pagina nao
 * saltar quando o dado chega.
 */

/**
 * Esqueleto de carregamento.
 *
 * `aria-hidden` + `role="status"` no container: o leitor de tela anuncia
 * "Carregando" uma vez, em vez de ler as barras cinzas de enfeite.
 */
export function Carregando({
  altura = "h-64",
  rotulo = "Carregando dados",
}: {
  altura?: string;
  rotulo?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={`${altura} w-full`}>
      <span className="sr-only">{rotulo}…</span>
      <div
        aria-hidden
        className="veri-pulsando h-full w-full rounded-xl bg-veri-offwhite"
      />
    </div>
  );
}

/** Linhas de esqueleto para listas e tabelas. */
export function CarregandoLinhas({ linhas = 4 }: { linhas?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Carregando dados…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="veri-pulsando h-8 rounded-lg bg-veri-offwhite"
          style={{ width: `${100 - i * 8}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Erro de um bloco. Traz o motivo e um caminho de saida -- nunca so
 * "algo deu errado".
 */
export function ErroDoBloco({
  titulo = "Não foi possível carregar",
  mensagem,
  detalhes,
  aoTentarNovamente,
}: {
  titulo?: string;
  mensagem: string;
  detalhes?: { campo: string; mensagem: string }[];
  aoTentarNovamente?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-veri-vinho/30 bg-veri-vinho/5 px-5 py-4 text-sm"
    >
      <p className="font-semibold text-veri-vinho">{titulo}</p>
      <p className="mt-1 text-veri-verde-escuro/80">{mensagem}</p>
      {detalhes && detalhes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-veri-verde-escuro/80">
          {detalhes.map((d, i) => (
            <li key={i}>
              <span className="font-medium">{d.campo}</span>: {d.mensagem}
            </li>
          ))}
        </ul>
      )}
      {aoTentarNovamente && (
        <button
          type="button"
          onClick={aoTentarNovamente}
          className="mt-3 rounded-full border border-veri-verde-claro/60 px-4 py-1.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-branco"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/**
 * Vazio. Distingue "nao ha custo no periodo" de "falhou" -- sao coisas
 * diferentes e o usuario precisa saber qual das duas aconteceu.
 */
export function Vazio({
  titulo = "Nenhum dado no período",
  children,
}: {
  titulo?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-veri-verde-claro/50 px-5 py-8 text-center">
      <p className="text-sm font-medium text-veri-verde-escuro">{titulo}</p>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-veri-verde-escuro/70">
          {children}
        </div>
      )}
    </div>
  );
}
