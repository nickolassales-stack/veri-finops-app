"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Navegacao entre as duas visoes analiticas.
 *
 * O RECORTE VIAJA JUNTO. Os links carregam a query string atual, entao passar
 * de "Por servico" para "Por custo" mantem periodo e contas. Sem isso, trocar
 * de aba jogaria o usuario no periodo padrao e ele teria de refazer o filtro --
 * e, pior, poderia comparar dois recortes diferentes sem perceber.
 *
 * Os parametros exclusivos de cada visao (busca por servico, regiao, ordenacao)
 * sao descartados na travessia: eles nao existem do outro lado, e levar
 * `ordenarPor=usageDate` para uma tela que nao tem essa coluna produziria erro
 * de validacao em vez de tela.
 */

const ABAS = [
  {
    href: "/dashboard/analitico",
    rotulo: "Por serviço",
    descricao: "lançamento a lançamento, por data de uso",
  },
  {
    href: "/dashboard/analitico/custos",
    rotulo: "Por custo mensal",
    descricao: "histórico por conta, por período de cobrança",
  },
];

/** Sobrevivem a troca de aba: sao os filtros GLOBAIS das duas telas. */
const COMPARTILHADOS = ["periodo", "de", "ate", "contas"];

export function AbasAnalitico() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preservados = new URLSearchParams();
  for (const chave of COMPARTILHADOS) {
    const valor = searchParams.get(chave);
    if (valor) preservados.set(chave, valor);
  }
  const query = preservados.toString();

  return (
    <nav aria-label="Visões analíticas" className="border-b border-veri-offwhite">
      <ul className="-mb-px flex flex-wrap gap-1">
        {ABAS.map((aba) => {
          const ativa = pathname === aba.href;
          return (
            <li key={aba.href}>
              <Link
                href={query ? `${aba.href}?${query}` : aba.href}
                aria-current={ativa ? "page" : undefined}
                className={[
                  "block border-b-2 px-4 py-2.5 transition-colors",
                  ativa
                    ? "border-veri-verde-escuro text-veri-verde-escuro"
                    : "border-transparent text-texto-suave hover:bg-veri-offwhite/60 hover:text-veri-verde-escuro",
                ].join(" ")}
              >
                <span className="block text-sm font-medium">{aba.rotulo}</span>
                <span className="block text-xs text-texto-suave">{aba.descricao}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
