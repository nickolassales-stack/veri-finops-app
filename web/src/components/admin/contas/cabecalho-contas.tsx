"use client";

import { SeletorVisao } from "@/components/dashboard/seletor-visao";
import type { Provider } from "@/lib/admin/contas-provider";

/**
 * Cabeçalho de Contas Cloud.
 *
 * ---------------------------------------------------------------------------
 * O TEXTO LONGO SAIU DAQUI
 *
 * Havia um aviso de três parágrafos no topo, sempre aberto, explicando alias,
 * provedores e credenciais. Ele estava certo e era ignorado: um bloco desse
 * tamanho antes do conteúdo é lido uma vez e pulado para sempre, e enquanto isso
 * empurrava a primeira conta para baixo da dobra em qualquer notebook.
 *
 * A explicação foi para "Como funciona", fechado por padrão — continua a um
 * clique de quem precisa dela, e some do caminho de quem já sabe.
 *
 * O seletor é o MESMO componente do painel executivo e do Analítico. Reusá-lo
 * mantém o gesto idêntico nas três telas; uma cópia local divergiria na primeira
 * mudança de estilo.
 */
export function CabecalhoContas({ provider }: { provider: Provider }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {/* `h2` e nao `h1`: o layout de Configuracoes ja emite o `h1` da area.
            Dois `h1` na mesma pagina fazem o leitor de tela anunciar dois titulos
            de pagina e desalinham o indice de cabecalhos que a navegacao por
            teclado usa. O tamanho visual continua o de um titulo de tela. */}
        <h2 className="veri-display text-2xl text-veri-verde-escuro">Contas Cloud</h2>
        <p className="mt-1 text-sm text-texto-suave">
          Gerencie aliases, metadados e integrações por provedor.
        </p>
      </div>

      <SeletorVisao atual={provider} base="/dashboard/configuracoes/contas" />
    </div>
  );
}
