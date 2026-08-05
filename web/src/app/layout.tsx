import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Portal FinOps · VERI",
    template: "%s · Portal FinOps VERI",
  },
  description:
    "Acompanhamento de custos AWS, governanca de contas e orcamentos da VERI.",
  // Portal interno: nao deve ser indexado.
  robots: { index: false, follow: false },
};

/**
 * Layout raiz. Deliberadamente sem cabecalho e sem rodape: a tela de login nao
 * tem navegacao, e o chrome da aplicacao vive no layout de `(privado)`, que
 * exige sessao.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
