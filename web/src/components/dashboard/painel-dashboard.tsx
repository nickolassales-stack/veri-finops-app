"use client";

import { useSearchParams } from "next/navigation";

import { PainelExecutivo } from "./painel-executivo";
import { PainelExecutivoOvh } from "./painel-executivo-ovh";

/**
 * Comutador entre a visao AWS e a visao OVH.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A DECISAO E NO CLIENTE, E NAO NO `page.tsx`
 *
 * Ler `searchParams` no Server Component funcionaria, mas os docs do Next 16 sao
 * explicitos sobre a escolha: use a prop `searchParams` quando o parametro
 * carrega DADO para a pagina, e `useSearchParams` quando ele e usado somente no
 * cliente.
 *
 * Aqui e o segundo caso. A pagina nao busca nada -- os dois paineis carregam por
 * `fetch` a partir dos endpoints protegidos, e ambos ja sao Client Components
 * que leem os proprios filtros da URL pelo mesmo hook. Passar `provider` pelo
 * servidor acrescentaria uma fronteira a mais sem nada em troca, e deixaria a
 * escolha do provedor em um lugar diferente da escolha de todos os outros
 * filtros.
 * ---------------------------------------------------------------------------
 *
 * `provider` desconhecido cai na visao AWS. Ela e o padrao historico de
 * `/dashboard` e o que um link antigo espera encontrar -- e nenhuma URL deve
 * levar a uma tela em branco.
 */
export function PainelDashboard({ tz }: { tz: string }) {
  const provider = useSearchParams().get("provider");

  return provider === "ovh" ? (
    <PainelExecutivoOvh tz={tz} />
  ) : (
    <PainelExecutivo tz={tz} />
  );
}
