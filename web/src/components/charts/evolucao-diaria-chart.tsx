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
import type { PontoDiario } from "@/lib/dashboard/tipos";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

export function rotuloDia(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/**
 * Evolucao diaria do custo.
 *
 * Serie unica -> sem legenda; o titulo do card nomeia a serie. A marca e o
 * verde escuro, unica cor da paleta que passa contraste -- numa linha de 2px o
 * verde claro desapareceria.
 *
 * DIA SEM CARGA VIRA LACUNA, NAO ZERO. O endpoint devolve `semDado: true` para
 * o dia que nao tem nenhuma linha na base; aqui esse ponto vai como `null` e a
 * linha se interrompe (`connectNulls={false}`). Desenhar zero faria falha de
 * pipeline parecer queda de consumo -- que e exatamente o erro que este projeto
 * se recusa a cometer.
 */
export function EvolucaoDiariaChart({ dados }: { dados: PontoDiario[] }) {
  const serie = dados.map((p) => ({
    data: p.data,
    total: p.semDado ? null : p.total,
    semDado: p.semDado,
    contas: p.contas,
  }));

  return (
    <div className="h-72 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 12, right: 16, bottom: 4, left: 8 }}>
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
            width={68}
            /*
             * Escala focada na faixa do dado. Em LINHA isso e legitimo: com base
             * em zero, uma variacao real de US$ 8,53 a US$ 10,21 vira uma reta e
             * esconde o movimento que o grafico existe para mostrar. (Em barra a
             * base zero e obrigatoria -- la o comprimento codifica magnitude.)
             */
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={
              <ChartTooltip
                rotuloExtra={(p) =>
                  p.semDado ? "sem carga do ETL" : `${p.contas} conta(s)`
                }
              />
            }
            labelFormatter={(l) => rotuloDia(String(l ?? ""))}
            cursor={{ stroke: CORES.eixo, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Line
            type="monotone"
            dataKey="total"
            name="Custo do dia"
            stroke={CORES.linha}
            strokeWidth={MARCAS.espessuraLinha}
            dot={false}
            connectNulls={false}
            activeDot={{
              r: MARCAS.tamanhoMarcador / 2,
              fill: CORES.linha,
              // Anel na cor da superficie: o marcador nao encosta na grade.
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
