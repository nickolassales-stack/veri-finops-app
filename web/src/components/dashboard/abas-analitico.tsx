"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { ehVisaoOvh } from "@/lib/dashboard/ovh";

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

const ABAS_AWS = [
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

/**
 * A OVH tem QUATRO abas, e nao duas, porque o dado tem quatro recortes
 * legitimos que a AWS nao tem: a fatura e um documento com identidade propria, e
 * o projeto e uma dimensao do Public Cloud que nao existe do outro lado.
 *
 * Forcar simetria com a AWS -- duas abas dos dois lados -- obrigaria a esconder
 * fatura dentro de "custo mensal", onde ela nao cabe: uma fatura tem numero,
 * data de emissao e imposto, e nenhum dos tres e um custo por mes.
 */
const ABAS_OVH = [
  {
    href: "/dashboard/analitico",
    rotulo: "Por serviço/categoria",
    descricao: "o que a OVH cobrou, por linha de serviço",
  },
  {
    href: "/dashboard/analitico/projetos",
    rotulo: "Por projeto",
    descricao: "custo atribuído a projeto do Public Cloud",
  },
  {
    href: "/dashboard/analitico/faturas",
    rotulo: "Por fatura",
    descricao: "documentos emitidos, com imposto e total",
  },
  {
    href: "/dashboard/analitico/custos",
    rotulo: "Por custo mensal",
    descricao: "total por mês, conta e origem",
  },
];

/**
 * Sobrevivem a troca de aba.
 *
 * Os dois vocabularios NAO se misturam: `contas` e da AWS (multi-selecao por
 * account_id), `conta`/`projeto`/`fonte` sao da OVH. Levar `contas=123` para uma
 * aba OVH produziria erro de validacao em vez de tela -- e levar `fonte=invoice`
 * para a AWS seria descartado em silencio, com o filtro ainda visivel na URL
 * dizendo uma coisa enquanto a tela mostra outra.
 */
const COMPARTILHADOS_AWS = ["periodo", "de", "ate", "contas"];
const COMPARTILHADOS_OVH = ["periodo", "de", "ate", "conta", "projeto", "fonte", "moeda"];

export function AbasAnalitico() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const ehOvh = ehVisaoOvh(searchParams);
  const abas = ehOvh ? ABAS_OVH : ABAS_AWS;

  const preservados = new URLSearchParams();
  // `provider` viaja SEMPRE, e primeiro: sem ele, a segunda aba abriria em AWS e
  // o usuario veria dado de outro provedor sem ter pedido troca de visao.
  if (ehOvh) preservados.set("provider", "ovh");
  for (const chave of ehOvh ? COMPARTILHADOS_OVH : COMPARTILHADOS_AWS) {
    const valor = searchParams.get(chave);
    if (valor) preservados.set(chave, valor);
  }
  const query = preservados.toString();

  return (
    <nav aria-label="Visões analíticas" className="border-b border-veri-offwhite">
      <ul className="-mb-px flex flex-wrap gap-1">
        {abas.map((aba) => {
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
