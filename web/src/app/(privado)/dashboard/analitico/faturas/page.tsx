import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PainelAnaliticoOvh } from "@/components/dashboard/painel-analitico-ovh";
import { CarregandoLinhas } from "@/components/ui/estado";

/**
 * /dashboard/analitico/faturas -- por fatura emitida.
 *
 * ---------------------------------------------------------------------------
 * ABA EXCLUSIVA DA VISAO OVH
 *
 * Nao existe equivalente AWS: esta leitura so faz sentido sobre as tabelas
 * `ovh_*`. Por isso a pagina FORCA `?provider=ovh` em vez de aceitar qualquer
 * valor -- sem isso, chegar aqui por link antigo ou digitando a URL mostraria o
 * cabecalho "Visao AWS" acima de uma tabela OVH, e as abas ao lado levariam de
 * volta para a AWS. A tela diria uma coisa e mostraria outra.
 *
 * O redirecionamento PRESERVA os demais parametros: perder o periodo escolhido
 * ao normalizar a URL faria o usuario refazer o filtro sem entender por que.
 *
 * `analytic:view` ja foi exigida no layout da area analitica.
 */

export const metadata = { title: "Faturas OVH" };

export default async function FaturasOvhPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (params.provider !== "ovh") {
    const busca = new URLSearchParams();
    for (const [chave, valor] of Object.entries(params)) {
      if (chave === "provider") continue;
      if (typeof valor === "string") busca.set(chave, valor);
    }
    busca.set("provider", "ovh");
    redirect(`/dashboard/analitico/faturas?${busca.toString()}`);
  }

  return (
    <Suspense fallback={<CarregandoLinhas linhas={10} />}>
      <PainelAnaliticoOvh aba="faturas" />
    </Suspense>
  );
}
