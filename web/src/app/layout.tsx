import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
