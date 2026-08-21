import type { ReactNode } from "react";

/**
 * Visao de tabela de um grafico, recolhida num `<details>`.
 *
 * NAO E OPCIONAL. O verde de preenchimento das barras fica em 2,9:1 de
 * contraste contra a superficie, abaixo do minimo de 3:1. O validador de paleta
 * marca isso como WARN e o alivio exigido e exatamente este: rotulo de valor
 * visivel MAIS uma visao tabular. Remover a tabela reintroduz o problema de
 * acessibilidade. Ver docs/DECISOES-dataviz.md.
 *
 * Serve tambem a quem prefere numero a desenho, e a quem usa leitor de tela.
 */
export function VisaoTabela({
  colunas,
  children,
  rotulo = "Ver como tabela",
}: {
  colunas: { titulo: string; alinharDireita?: boolean }[];
  children: ReactNode;
  rotulo?: string;
}) {
  return (
    <details className="mt-4 group">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 text-xs text-texto-suave underline underline-offset-2 hover:text-veri-verde-escuro">
        {rotulo}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
              {colunas.map((c) => (
                <th
                  key={c.titulo}
                  scope="col"
                  className={[
                    "py-2 pr-4 font-medium",
                    c.alinharDireita ? "text-right" : "",
                  ].join(" ")}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Celula numerica: tabular, alinhada a direita. */
export function Num({ children }: { children: ReactNode }) {
  return <td className="veri-numero py-2 pr-4 text-right">{children}</td>;
}
