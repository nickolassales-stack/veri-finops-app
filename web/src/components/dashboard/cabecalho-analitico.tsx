"use client";

import { useSearchParams } from "next/navigation";

import { ehVisaoOvh } from "@/lib/dashboard/ovh";

import { SeletorVisao } from "./seletor-visao";

/**
 * Título, selo e seletor do Analítico — muda inteiro conforme o provedor.
 *
 * ---------------------------------------------------------------------------
 * POR QUE É COMPONENTE DE CLIENTE, E NÃO PARTE DO LAYOUT DE SERVIDOR
 *
 * **Layouts do App Router não recebem `searchParams`.** O layout desta área não
 * tem como saber se a URL diz `?provider=ovh` — e era ele que trazia o título e
 * o selo "Visão AWS" fixos.
 *
 * Existiria a saída de ler o header `x-caminho-atual` que o proxy injeta (ele
 * carrega `pathname + search`), mas isso amarraria o cabeçalho a um detalhe do
 * proxy: no dia em que alguém mudar o que aquele header transporta, o título
 * passa a mentir sobre qual provedor está na tela.
 *
 * `AbasAnalitico` já era cliente e já lia `useSearchParams` pelo mesmo motivo.
 * Este componente segue o mesmo caminho — e é o mesmo que `PainelDashboard` faz
 * no painel executivo.
 */

const TEXTOS = {
  aws: {
    selo: "Visão AWS",
    descricao:
      "Duas leituras do mesmo custo: o que foi consumido, e quanto cada conta custou " +
      "por mês. Somente contas AWS — as contas OVH aparecem na Visão OVH.",
  },
  ovh: {
    selo: "Visão OVH",
    descricao:
      "Custos OVH faturados e detalhados por mês, projeto, serviço e origem. " +
      "Somente contas OVH — o dado é mensal, não diário.",
  },
} as const;

export function CabecalhoAnalitico() {
  const ehOvh = ehVisaoOvh(useSearchParams());
  const atual = ehOvh ? "ovh" : "aws";
  const t = TEXTOS[atual];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="veri-display text-3xl text-veri-verde-escuro">
            Analítico
            {ehOvh && (
              // No TÍTULO e não só no selo: o pedido é explícito, e um título que
              // se distingue sozinho sobrevive a print de tela e a colagem em
              // e-mail, onde o selo colorido ao lado se perde.
              <span className="ml-2 align-middle text-base font-semibold uppercase tracking-wide text-texto-suave">
                [Visão OVH]
              </span>
            )}
          </h1>
          <span
            className={[
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
              ehOvh
                ? "border border-veri-mostarda/50 bg-veri-mostarda/15 text-veri-verde-escuro"
                : "border border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro",
            ].join(" ")}
          >
            {t.selo}
          </span>
        </div>

        <SeletorVisao atual={atual} base="/dashboard/analitico" />
      </div>

      <p className="mt-2 max-w-2xl text-sm text-texto-suave">{t.descricao}</p>
    </div>
  );
}
