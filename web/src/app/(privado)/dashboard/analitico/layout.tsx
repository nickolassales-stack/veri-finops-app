import { headers } from "next/headers";
import { Suspense } from "react";

import { AbasAnalitico } from "@/components/dashboard/abas-analitico";
import { CabecalhoAnalitico } from "@/components/dashboard/cabecalho-analitico";
import { requirePermissao } from "@/lib/auth/autorizacao";
import { HEADER_CAMINHO } from "@/proxy";

/**
 * Fronteira da area analitica, com as duas visoes.
 *
 * POR QUE `/dashboard/analitico` CONTINUA SENDO A VISAO POR SERVICO
 *
 * A sugestao era `/servicos` e `/custos`. Manter a rota atual como "Por
 * servico" e acrescentar `/custos` ao lado preserva todo link, favorito e
 * historico de navegador que ja apontam para `/dashboard/analitico` -- mover a
 * tela existente para uma rota nova quebraria todos eles em troca de simetria
 * no caminho.
 *
 * `analytic:view` e exigida UMA vez, aqui, e vale para TODAS as abas das duas
 * visoes: todas mostram custo, com recortes diferentes. Exportar exige
 * `analytic:export`, verificada na propria rota do arquivo.
 *
 * A ROTA SERVE DUAS VISOES, como o painel executivo: `?provider=ovh` mostra a
 * visao OVH e qualquer outro valor mostra a AWS. A escolha e feita no CLIENTE
 * porque layout do App Router nao recebe `searchParams` -- ver
 * `cabecalho-analitico.tsx`.
 */
export default async function LayoutAnalitico({
  children,
}: {
  children: React.ReactNode;
}) {
  const caminho = (await headers()).get(HEADER_CAMINHO) ?? undefined;
  await requirePermissao("analytic:view", caminho);

  return (
    <div className="space-y-6">
      {/* Cabecalho e abas sao de CLIENTE porque dependem de `?provider=`, e
          layouts do App Router nao recebem `searchParams`. Suspense em volta
          porque `useSearchParams` exige fronteira. */}
      <Suspense fallback={<div className="h-20" />}>
        <CabecalhoAnalitico />
      </Suspense>

      <Suspense fallback={<div className="h-14" />}>
        <AbasAnalitico />
      </Suspense>

      {children}
    </div>
  );
}
