"use client";

import Link from "next/link";

/**
 * Seletor entre a visao AWS e a visao OVH do painel executivo.
 *
 * ---------------------------------------------------------------------------
 * LINKS, E NAO BOTOES OU RADIOS
 *
 * Trocar de visao E uma navegacao: muda a URL, muda o conteudo inteiro da tela e
 * o usuario vai querer desfazer com o botao voltar. `<a href>` da isso de graca,
 * mais abrir em nova aba, copiar o endereco e funcionar antes de o JavaScript
 * carregar. Um `<button onClick>` com `router.push` perderia as tres coisas e
 * teria de reimplementar a primeira.
 *
 * `aria-current="page"` e o que anuncia a visao ativa no leitor de tela -- a cor
 * de fundo sozinha nao informa.
 * ---------------------------------------------------------------------------
 *
 * O DESTINO NAO CARREGA OS FILTROS DA VISAO DE ORIGEM, de proposito. Os dois
 * vocabularios sao incompativeis: `?periodo=30d` nao existe na OVH (a
 * granularidade minima do dado e o mes) e `?periodo=12m` nao existe na AWS.
 * Repassar a query string faria a tela de destino descartar o parametro em
 * silencio e mostrar o padrao -- com o filtro antigo ainda visivel na URL,
 * dizendo uma coisa enquanto a tela mostra outra.
 */

/**
 * `base` existe porque o mesmo seletor serve o painel executivo e o Analitico.
 * Duplicar o componente duplicaria as decisoes acima -- e a proxima tela a ganhar
 * visao OVH herdaria a copia que alguem esquecesse de atualizar.
 */
export function SeletorVisao({
  atual,
  base = "/dashboard",
}: {
  atual: "aws" | "ovh";
  base?: string;
}) {
  const VISOES = [
    { provider: "aws", rotulo: "Visão AWS", href: base },
    { provider: "ovh", rotulo: "Visão OVH", href: `${base}?provider=ovh` },
  ] as const;

  return (
    <nav
      aria-label="Provedor exibido no painel"
      className="inline-flex items-center gap-1 rounded-full border border-veri-offwhite bg-veri-branco p-0.5"
    >
      {VISOES.map((visao) => {
        const ativo = visao.provider === atual;

        return (
          <Link
            key={visao.provider}
            href={visao.href}
            aria-current={ativo ? "page" : undefined}
            // `scroll` padrao (topo): a tela troca inteira, entao manter a
            // posicao deixaria o usuario no meio de um conteudo novo.
            className={[
              "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-veri-verde-escuro",
              ativo
                ? "bg-veri-verde-escuro text-veri-branco"
                : "text-texto-suave hover:bg-veri-offwhite hover:text-veri-verde-escuro",
            ].join(" ")}
          >
            {visao.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
