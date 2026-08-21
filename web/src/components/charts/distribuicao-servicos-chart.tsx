"use client";

import { formatParticipacao, formatUSD } from "@/lib/format";

/**
 * Distribuicao percentual do custo por servico -- barra de composicao.
 *
 * POR QUE NAO PIZZA NEM ROSCA
 *
 * Uma pizza de 9 fatias exigiria 9 cores distinguiveis, e a paleta VERI nao tem
 * (o validador reprovou ate um terceiro verde: deltaE 5,4 contra o segundo). Sem
 * cor por fatia, pizza fica ilegivel: angulo proximo e dificil de comparar mesmo
 * com cor, e sem cor a fatia perde identidade.
 *
 * Uma barra unica de 100% resolve: comprimento e mais facil de comparar que
 * angulo, a soma-um fica explicita, e a IDENTIDADE VEM DO ROTULO -- nao de cor.
 * As fatias sao separadas por 2px da cor da superficie, e "Outros" recebe
 * hachura porque nao e uma entidade real, e sim um agrupamento.
 *
 * Construida em HTML/CSS, sem biblioteca de grafico: sao retangulos numa linha,
 * e assim a legenda participa do fluxo do texto e da tabulacao natural.
 */

/** Fatia menor que isto nao caberia um rotulo dentro. */
const MINIMO_PARA_ROTULO_INTERNO = 0.09;

/**
 * MINIMO ESTRUTURAL, e nao `CustoDoServico`.
 *
 * A barra so usa nome e valor. Exigir o tipo completo da AWS -- que carrega
 * `totalAnterior`, `variacao` e `participacao` -- obrigaria a visao OVH a
 * inventar campos que ela nao tem, so para satisfazer o compilador. Qualquer
 * objeto com estes dois campos serve, e `CustoDoServico` continua servindo.
 */
export type FatiaDeCusto = { servico: string; total: number };

export function DistribuicaoServicosChart({
  itens,
  outros,
  totalDaJanela,
  formatar = formatUSD,
}: {
  itens: FatiaDeCusto[];
  outros: number;
  totalDaJanela: number;
  /**
   * Formatador do valor. Padrao `formatUSD` -- a moeda fixa do CUR, entao
   * nenhum chamador da AWS muda de comportamento. A OVH injeta a moeda que o
   * servidor escolheu.
   */
  formatar?: (valor: unknown) => string;
}) {
  const fatias = [
    ...itens.map((s) => ({
      nome: s.servico,
      valor: s.total,
      fracao: totalDaJanela > 0 ? s.total / totalDaJanela : 0,
      agrupada: false,
    })),
    // "Outros" so entra se somar pelo menos um centavo. Abaixo disso a fatia e
    // invisivel e a linha da legenda diria "0,0% · US$ 0,00" -- ruido.
    ...(Math.round(outros * 100) > 0
      ? [
          {
            nome: "Outros",
            valor: outros,
            fracao: totalDaJanela > 0 ? outros / totalDaJanela : 0,
            agrupada: true,
          },
        ]
      : []),
  ];

  // Quantos servicos concentram 80% do custo -- a pergunta que um gestor de
  // FinOps faz olhando distribuicao, e que a barra sozinha nao responde.
  let acumulado = 0;
  let servicosPara80 = 0;
  for (const f of fatias) {
    if (acumulado >= 0.8) break;
    acumulado += f.fracao;
    servicosPara80 += 1;
  }

  return (
    <div>
      {/* ------------------------------------------- barra de composicao */}
      <div
        className="flex h-11 w-full overflow-hidden rounded-lg"
        role="img"
        aria-label={
          `Distribuição do custo entre ${fatias.length} itens. ` +
          fatias
            .map((f) => `${f.nome}: ${formatParticipacao(f.fracao)}`)
            .join(". ")
        }
      >
        {fatias.map((fatia, i) => (
          <div
            key={fatia.nome}
            className="relative h-full min-w-0 overflow-hidden"
            style={{
              // `flexBasis` em percentual: a barra e sempre exatamente 100%.
              flexBasis: `${fatia.fracao * 100}%`,
              // Verde-escuro, e nao o verde da marca, por causa do rotulo QUE
              // FICA DENTRO da fatia: branco sobre #7F9C90 da 2,97:1, abaixo dos
              // 4,5:1 da WCAG AA; sobre #384E46 sao 8,95:1. Trocar o tom aqui nao
              // custa informacao nenhuma -- nesta barra todas as fatias tem a
              // MESMA cor de proposito (a identidade vem do rotulo, ver o
              // cabecalho do arquivo), entao a cor nao codifica nada.
              backgroundColor: "#384E46",
              // Separador de 2px na cor da superficie entre fatias vizinhas.
              marginLeft: i === 0 ? 0 : 2,
            }}
            title={`${fatia.nome} · ${formatParticipacao(fatia.fracao)} · ${formatar(fatia.valor)}`}
          >
            {fatia.agrupada && (
              <span aria-hidden className="veri-textura absolute inset-0" />
            )}
            {fatia.fracao >= MINIMO_PARA_ROTULO_INTERNO && (
              <span className="veri-numero absolute inset-0 flex items-center justify-center px-1 text-xs font-medium text-veri-branco">
                {formatParticipacao(fatia.fracao)}
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-texto-suave">
        {servicosPara80 === 1 ? (
          <>
            <strong className="font-medium">1 serviço</strong> concentra mais de 80% do
            custo do período.
          </>
        ) : (
          <>
            Os <strong className="font-medium">{servicosPara80} maiores serviços</strong>{" "}
            concentram {formatParticipacao(acumulado)} do custo do período.
          </>
        )}
      </p>

      {/* ------------------------------------------------------- legenda */}
      {/* Legenda como lista de definicao: cada fatia tem nome, percentual e
          valor. E aqui que a identidade da fatia mora -- a cor nao distingue. */}
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fatias.map((fatia) => (
          <div
            key={fatia.nome}
            className="flex items-baseline justify-between gap-3 border-b border-veri-offwhite/70 pb-1.5 last:border-0"
          >
            <dt className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                // Mesmo tom da barra: o quadradinho so serve para amarrar a
                // linha da legenda a faixa acima.
                className={[
                  "h-2.5 w-2.5 shrink-0 rounded-sm bg-veri-verde-escuro",
                  fatia.agrupada ? "veri-textura" : "",
                ].join(" ")}
              />
              <span className="truncate text-sm text-veri-verde-escuro" title={fatia.nome}>
                {fatia.nome}
              </span>
            </dt>
            <dd className="veri-numero shrink-0 text-sm text-texto-suave">
              {formatParticipacao(fatia.fracao)}
              <span className="text-texto-suave"> · {formatar(fatia.valor)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
