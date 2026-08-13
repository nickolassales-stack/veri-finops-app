"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

import { formatUSD, formatUSDCompacto } from "@/lib/format";
import type { DiarioPorServico } from "@/lib/dashboard/tipos";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, MARCAS } from "./chart-theme";
import { rotuloDia } from "./evolucao-diaria-chart";

/**
 * Evolucao diaria QUEBRADA POR SERVICO, em small multiples.
 *
 * POR QUE NAO UM GRAFICO DE VARIAS LINHAS
 *
 * Identificar 9 series exigiria 9 cores categoricas distinguiveis. A paleta VERI
 * tem dois verdes utilizaveis, e o validador reprovou incluir um terceiro:
 * `#92ACA0` contra `#7F9C90` da deltaE 5,4 -- abaixo do piso de 15, ou seja,
 * indistinguivel ate para quem tem visao de cores normal. Mostarda e vinho estao
 * reservados para status. Criar cor nova e proibido pelo brandbook.
 *
 * Com uma cor so, nove linhas sobrepostas viram emaranhado. Small multiples
 * resolve sem cor nenhuma: cada servico tem seu proprio quadro, todos com a
 * MESMA escala vertical, entao a comparacao entre eles continua valida e a
 * identidade vem do titulo -- nao de cor que ninguem distingue.
 *
 * Ganho colateral: "qual servico mudou de patamar" fica obvio, o que num
 * emaranhado de linhas se perde.
 */
export function DiarioPorServicoChart({ dados }: { dados: DiarioPorServico }) {
  // Escala compartilhada: sem isto, cada quadro se auto-escalaria e um servico
  // de US$ 0,10 pareceria do mesmo tamanho de um de US$ 30.
  const maximo = Math.max(
    ...dados.series.flatMap((s) => s.valores),
    0,
  );

  return (
    <div>
      <p className="mb-4 text-sm text-texto-suave">
        Um quadro por serviço, todos na <strong className="font-medium">mesma escala
        vertical</strong> (até {formatUSDCompacto(maximo)}) — por isso a altura das
        curvas é comparável entre quadros.
      </p>

      <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {dados.series.map((serie) => {
          const pontos = dados.dias.map((dia, i) => ({
            data: dia,
            total: serie.valores[i] ?? 0,
          }));

          return (
            <li key={serie.nome} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <h3
                  className="truncate text-sm font-medium text-veri-verde-escuro"
                  title={serie.nome}
                >
                  {serie.nome}
                </h3>
                <span className="veri-numero shrink-0 text-xs text-texto-suave">
                  {formatUSD(serie.total)}
                </span>
              </div>

              <div className="mt-1.5 h-20 w-full min-w-0 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={pontos}
                    margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
                  >
                    {/*
                      Eixo escondido mas com dominio FIXO e compartilhado. Base em
                      zero aqui de proposito: em quadro pequeno sem eixo visivel, a
                      escala focada faria ruido de centavos parecer disparada.
                    */}
                    <YAxis hide domain={[0, maximo]} />
                    <Tooltip
                      content={<ChartTooltip />}
                      labelFormatter={(l) => rotuloDia(String(l ?? ""))}
                      cursor={{
                        stroke: CORES.eixo,
                        strokeWidth: 1,
                        strokeDasharray: "3 3",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name={serie.nome}
                      stroke={CORES.linha}
                      strokeWidth={MARCAS.espessuraLinha}
                      dot={false}
                      activeDot={{
                        r: MARCAS.tamanhoMarcador / 2,
                        fill: CORES.linha,
                        stroke: CORES.superficie,
                        strokeWidth: 2,
                      }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p className="mt-0.5 flex justify-between text-[11px] text-texto-suave">
                <span className="veri-numero">{rotuloDia(dados.dias[0] ?? "")}</span>
                <span className="veri-numero">
                  {rotuloDia(dados.dias[dados.dias.length - 1] ?? "")}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
