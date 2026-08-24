"use client";

import { useSearchParams } from "next/navigation";

import { ehVisaoOvh } from "@/lib/dashboard/ovh";

import { PainelAnaliticoOvh, type AbaOvh } from "./painel-analitico-ovh";

/**
 * Decide entre a visão AWS e a visão OVH numa aba do Analítico.
 *
 * A escolha é feita no CLIENTE pelo mesmo motivo do painel executivo: layouts do
 * App Router não recebem `searchParams`, e a área analítica precisa da mesma
 * decisão no cabeçalho, nas abas e no conteúdo. Fazê-la em três lugares
 * diferentes (um servidor, dois cliente) abriria espaço para os três
 * discordarem — o cabeçalho dizendo "Visão OVH" com tabela AWS embaixo.
 *
 * `provider` desconhecido cai na AWS. Ela é o padrão histórico da tela, e um
 * valor digitado errado na URL não deve trocar o provedor exibido.
 */
export function AnaliticoPorProvider({
  aba,
  aws,
}: {
  aba: AbaOvh;
  /** O painel AWS já existente desta aba. Renderizado quando não for OVH. */
  aws: React.ReactNode;
}) {
  const ehOvh = ehVisaoOvh(useSearchParams());
  return ehOvh ? <PainelAnaliticoOvh aba={aba} /> : <>{aws}</>;
}
