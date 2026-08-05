"use client";

import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUSD } from "@/lib/format";
import type { CustoServico } from "@/lib/queries/custos";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

/**
 * Ranking de servicos. Barras horizontais: os nomes de servico da AWS sao
 * longos e em barra vertical virariam rotulo rotacionado.
 *
 * Serie unica -> sem legenda. Rotulo de valor direto em cada barra, exigido
 * pelo contraste de 2,9:1 do verde de preenchimento.
 */
export function TopServicosChart({ dados }: { dados: CustoServico[] }) {
  const altura = Math.max(200, dados.length * 32 + 32);

  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={dados}
          layout="vertical"
          margin={{ top: 4, right: 88, bottom: 4, left: 8 }}
          barCategoryGap={MARCAS.espacoEntreBarras * 4}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="servico"
            tick={EIXO_TICK}
            axisLine={false}
            tickLine={false}
            width={148}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: CORES.grade, fillOpacity: 0.35 }}
          />
          <Bar
            dataKey="total"
            name="Custo no mes"
            fill={CORES.barra}
            radius={[0, MARCAS.raioBarra, MARCAS.raioBarra, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="total"
              position="right"
              formatter={(v) => formatUSD(v)}
              fill={CORES.texto}
              fontSize={11}
              className="veri-numero"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
