"use client";

import type { Recurso } from "@/lib/dashboard/use-dashboard";
import type { Conta } from "@/lib/dashboard/tipos";

import { CloudAccountMultiSelect } from "./cloud-account-multi-select";

/**
 * Filtro de contas AWS.
 *
 * O painel, as caixas de marcação, o Esc e o "nenhuma = todas" moram em
 * `CloudAccountMultiSelect`, compartilhado com a visão OVH. O que sobrou aqui é
 * o que de fato é da AWS: o formato do `Recurso<Conta[]>` da API e a escolha do
 * que vai na segunda linha de cada conta.
 *
 * A lista vem inteira de `cloud_accounts` pela API -- nenhum id de conta é fixo
 * no código. Vazio significa "todas as contas", e é o padrão.
 */
export function FiltroContas({
  contas,
  selecionadas,
  aoMudar,
}: {
  contas: Recurso<Conta[]> & { carregando: boolean };
  selecionadas: string[];
  aoMudar: (contas: string[]) => void;
}) {
  const lista = (contas.dados ?? []).map((c) => ({
    id: c.accountId,
    nome: c.accountName,
    detalhe: c.businessUnit,
    inativa: !c.active,
  }));

  return (
    <CloudAccountMultiSelect
      provider="aws"
      contas={lista}
      selecionadas={selecionadas}
      aoMudar={aoMudar}
      rotulo="Contas AWS"
      rotuloTodas="Todas as contas"
      // A contagem junto de "todas" é comportamento que já existia nesta visão.
      mostrarTotalEmTodas
      carregando={contas.carregando}
      erro={Boolean(contas.erro)}
    />
  );
}
