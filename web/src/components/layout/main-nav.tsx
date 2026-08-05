"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navPrincipal } from "@/lib/nav";

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegacao principal">
      <ul className="flex items-center gap-1">
        {navPrincipal.map((item) => {
          const ativo =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

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
