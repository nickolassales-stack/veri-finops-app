import type { Resumo } from "@/lib/admin/contas-provider";

/**
 * Os números do ambiente, no topo.
 *
 * ---------------------------------------------------------------------------
 * CARTÃO QUE NÃO TEM RESPOSTA NÃO APARECE
 *
 * "Credenciais conectadas" some para quem não é ADMIN — o servidor não envia o
 * dado, e desenhar o cartão com um travessão anunciaria a existência de uma
 * informação que aquela pessoa nunca vai ver. "Coletas com falha" some quando
 * não há falha, seguindo o pedido ("se houver"): um zero permanente ao lado de
 * três números que variam vira ruído, e no dia em que virar 1 ninguém repara.
 *
 * A contrapartida é que o cartão aparecendo JÁ É o alerta — por isso ele é o
 * único pintado de vermelho.
 */
export function ResumoContas({ resumo }: { resumo: Resumo }) {
  const cartoes: { rotulo: string; valor: number; alerta?: boolean }[] = [
    { rotulo: "Contas AWS", valor: resumo.contasAws },
    { rotulo: "Contas OVH", valor: resumo.contasOvh },
  ];

  if (resumo.credenciaisConectadas !== null) {
    cartoes.push({
      rotulo: "Credenciais OVH conectadas",
      valor: resumo.credenciaisConectadas,
    });
  }

  if (resumo.coletasComFalha !== null && resumo.coletasComFalha > 0) {
    cartoes.push({
      rotulo: "Coletas com falha (7 dias)",
      valor: resumo.coletasComFalha,
      alerta: true,
    });
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cartoes.map((c) => (
        <div
          key={c.rotulo}
          className={[
            "rounded-xl border px-4 py-3",
            c.alerta
              ? "border-veri-vinho/40 bg-veri-vinho/8"
              : "border-veri-offwhite bg-veri-branco",
          ].join(" ")}
        >
          <dt className="text-xs uppercase tracking-wide text-texto-suave">{c.rotulo}</dt>
          <dd
            className={[
              "veri-numero mt-1 text-2xl",
              c.alerta ? "text-veri-vinho" : "text-veri-verde-escuro",
            ].join(" ")}
          >
            {c.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}
