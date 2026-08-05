"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUSDCompacto } from "@/lib/format";
import type { PontoDiario } from "@/lib/queries/custos";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

function rotuloDia(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/**
 * Evolucao diaria. Serie unica -> sem legenda. Marca de linha em verde escuro,
 * que passa o contraste minimo (o verde claro nao passaria numa linha de 2px).
 * Marcador aparece no hover, com 8px, junto do crosshair.
 */
export function SerieDiariaChart({ dados }: { dados: PontoDiario[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dados} margin={{ top: 12, right: 12, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={CORES.grade} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={rotuloDia}
            tick={EIXO_TICK}
            axisLine={{ stroke: CORES.grade }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v: number) => formatUSDCompacto(v)}
            tick={EIXO_TICK}
            axisLine={false}
            tickLine={false}
            width={64}
            /*
             * Escala focada na faixa do dado, nao ancorada em zero. Em linha
             * isso e legitimo e necessario: com base em zero, uma variacao real
             * de US$ 8,53 a US$ 10,21 virava uma reta e escondia o movimento.
             * (Barra e diferente: la a base zero e obrigatoria, porque o
             * comprimento da barra codifica a magnitude.)
             */
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<ChartTooltip />}
            labelFormatter={(l) => rotuloDia(String(l ?? ""))}
            cursor={{ stroke: CORES.eixo, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Line
            type="monotone"
            dataKey="total"
            name="Custo diario"
            stroke={CORES.linha}
            strokeWidth={MARCAS.espessuraLinha}
            dot={false}
            activeDot={{
              r: MARCAS.tamanhoMarcador / 2,
              fill: CORES.linha,
              // Anel de 2px na cor da superficie, para o marcador nao encostar
              // na grade nem na linha.
              stroke: CORES.superficie,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
