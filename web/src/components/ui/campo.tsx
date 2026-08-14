import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from "react";
import { useId } from "react";

/**
 * Primitivas de formulario da area administrativa.
 *
 * O rotulo e SEMPRE um `<label>` amarrado por id -- e nao um `<p>` acima do
 * campo. Sem a amarracao, o leitor de tela anuncia "caixa de edicao" sem dizer
 * de que, e clicar no texto nao foca o campo.
 *
 * A mensagem de erro entra em `aria-describedby` e a caixa recebe
 * `aria-invalid`: quem usa leitor de tela ouve o motivo junto do campo, em vez
 * de precisar procurar o texto vermelho na tela.
 */

const BASE_CAIXA =
  "w-full rounded-lg border bg-veri-branco px-3 py-2 text-sm text-veri-verde-escuro " +
  "outline-none transition-colors placeholder:text-texto-suave/70 " +
  "focus-visible:ring-2 focus-visible:ring-veri-verde/50 disabled:opacity-60";

function bordaDe(erro?: string): string {
  return erro ? "border-veri-vinho/60" : "border-veri-offwhite";
}

type BaseProps = {
  rotulo: string;
  /** Texto de apoio permanente. Nao some quando ha erro. */
  ajuda?: ReactNode;
  erro?: string;
};

export function Campo({
  rotulo,
  ajuda,
  erro,
  ...props
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const idAjuda = `${id}-ajuda`;
  const idErro = `${id}-erro`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-veri-verde-escuro">
        {rotulo}
      </label>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajuda ? idAjuda : null, erro ? idErro : null]
          .filter(Boolean)
          .join(" ")
          .trim() || undefined}
        className={`${BASE_CAIXA} ${bordaDe(erro)}`}
        {...props}
      />
      {ajuda && (
        <p id={idAjuda} className="text-xs leading-relaxed text-texto-suave">
          {ajuda}
        </p>
      )}
      {erro && (
        <p id={idErro} className="text-xs font-medium text-veri-vinho">
          {erro}
        </p>
      )}
    </div>
  );
}

export function Selecao({
  rotulo,
  ajuda,
  erro,
  children,
  ...props
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const idAjuda = `${id}-ajuda`;
  const idErro = `${id}-erro`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-veri-verde-escuro">
        {rotulo}
      </label>
      <select
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajuda ? idAjuda : null, erro ? idErro : null]
          .filter(Boolean)
          .join(" ")
          .trim() || undefined}
        className={`${BASE_CAIXA} ${bordaDe(erro)}`}
        {...props}
      >
        {children}
      </select>
      {ajuda && (
        <p id={idAjuda} className="text-xs leading-relaxed text-texto-suave">
          {ajuda}
        </p>
      )}
      {erro && (
        <p id={idErro} className="text-xs font-medium text-veri-vinho">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Caixa de marcacao com rotulo clicavel.
 *
 * O `<input>` fica DENTRO do `<label>`: assim a area de clique cobre o texto
 * inteiro sem depender de id, o que importa numa lista de dezenas de permissoes
 * em que os alvos ficariam pequenos demais no toque.
 */
export function Marcacao({
  rotulo,
  descricao,
  ...props
}: { rotulo: ReactNode; descricao?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-veri-offwhite/60">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-veri-verde-escuro"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm text-veri-verde-escuro">{rotulo}</span>
        {descricao && (
          <span className="block text-xs leading-relaxed text-texto-suave">
            {descricao}
          </span>
        )}
      </span>
    </label>
  );
}
