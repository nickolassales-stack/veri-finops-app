import { headers } from "next/headers";

import { AbasAnalitico } from "@/components/dashboard/abas-analitico";
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
 * `analytic:view` e exigida UMA vez, aqui, e vale para as duas abas: as duas
 * mostram o mesmo dado, com recortes diferentes. Exportar exige `analytic:export`,
 * verificada na propria rota do arquivo.
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
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="veri-display text-3xl text-veri-verde-escuro">Analítico</h1>
          {/* No layout, e nao em cada aba: as duas leem tabelas AWS
              (`aws_daily_costs` e `aws_monthly_costs`) e o recorte e o mesmo. */}
          <span className="inline-flex items-center rounded-full border border-veri-verde/50 bg-veri-verde/12 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-veri-verde-escuro">
            Visão AWS
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-texto-suave">
          Duas leituras do mesmo custo: o que foi consumido, e quanto cada conta custou
          por mês. Somente contas AWS — as contas OVH aparecem em Faturamento.
        </p>
      </div>

      <AbasAnalitico />

      {children}
    </div>
  );
}
