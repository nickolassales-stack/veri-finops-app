import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Botao da area administrativa.
 *
 * `carregando` desabilita E troca o texto. Só desabilitar deixaria o usuario
 * sem saber se o clique valeu; só trocar o texto permitiria o clique duplo que
 * cria dois usuarios.
 */

type Tom = "primario" | "secundario" | "perigo";

const ESTILOS: Record<Tom, string> = {
  primario:
    "bg-veri-verde-escuro text-veri-branco hover:bg-veri-verde-escuro/90 border-transparent",
  secundario:
    "bg-veri-branco text-veri-verde-escuro border-veri-verde-claro/60 hover:bg-veri-offwhite",
  perigo: "bg-veri-branco text-veri-vinho border-veri-vinho/40 hover:bg-veri-vinho/5",
};

export function Botao({
  tom = "primario",
  carregando = false,
  rotuloCarregando = "Salvando…",
  children,
  className,
  disabled,
  ...props
}: {
  tom?: Tom;
  carregando?: boolean;
  rotuloCarregando?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      // `type` explicito: sem ele o padrao e "submit", e um botao de cancelar
      // dentro de um formulario passaria a envia-lo.
      type={props.type ?? "button"}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2",
        "text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-veri-verde/50",
        "disabled:cursor-not-allowed disabled:opacity-60",
        ESTILOS[tom],
        className ?? "",
      ].join(" ")}
      {...props}
    >
      {carregando ? rotuloCarregando : children}
    </button>
  );
}
