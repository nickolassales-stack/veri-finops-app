import type { ReactNode } from "react";

type CardProps = {
  titulo?: string;
  descricao?: string;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ titulo, descricao, acao, children, className }: CardProps) {
  return (
    <section
      className={[
        "rounded-2xl border border-veri-offwhite bg-veri-branco p-6 shadow-[0_1px_2px_rgba(56,78,70,0.04)]",
        className ?? "",
      ].join(" ")}
    >
      {(titulo || acao) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {titulo && (
              <h2 className="veri-display text-lg text-veri-verde-escuro">{titulo}</h2>
            )}
            {descricao && (
              <p className="mt-1 text-sm text-texto-suave">{descricao}</p>
            )}
          </div>
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}
