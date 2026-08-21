"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { ItemNav } from "@/lib/nav";

export function MainNav({ itens }: { itens: ItemNav[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegacao principal">
      {/* `flex-wrap`: com quatro secoes o menu nao cabe numa linha de celular. */}
      <ul className="flex flex-wrap items-center gap-1">
        {itens.map((item) => {
          // /dashboard nao deve ficar ativo quando se esta em /dashboard/analitico
          const ativo =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={[
                  "block rounded-full px-4 py-2 text-sm transition-colors",
                  ativo
                    ? "bg-veri-verde-escuro text-veri-branco"
                    : "text-veri-verde-escuro hover:bg-veri-offwhite",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
