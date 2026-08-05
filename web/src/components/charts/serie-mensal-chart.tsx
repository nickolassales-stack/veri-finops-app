"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUSD, formatUSDCompacto } from "@/lib/format";
import type { PontoMensal } from "@/lib/queries/custos";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

const MESES = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split("-");
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/**
 * Serie mensal. Barras, nao linha: com 3 pontos uma linha sugere tendencia que
 * o dado nao sustenta.
 *
 * Serie unica -> sem legenda (o titulo do card nomeia a serie). Meses lancados
 * adiantado recebem HACHURA na mesma cor, mais rotulo textual -- nunca uma cor
 * nova (ver chart-theme.ts).
 */
export function SerieMensalChart({ dados }: { dados: PontoMensal[] }) {
  const temFuturo = dados.some((d) => d.futuro);

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            margin={{ top: 24, right: 8, bottom: 4, left: 8 }}
            barCategoryGap={MARCAS.espacoEntreBarras * 6}
          >
            <defs>
              {/* Textura a 45 graus: distingue periodo futuro sem introduzir cor. */}
              <pattern
                id="hachura-futuro"
                patternUnits="userSpaceOnUse"
                width={6}
                height={6}
                patternTransform="rotate(45)"
              >
                <rect width={6} height={6} fill={CORES.superficie} />
                <line x1={0} y1={0} x2={0} y2={6} stroke={CORES.barra} strokeWidth={3} />
              </pattern>
            </defs>

            <XAxis
              dataKey="mes"
              tickFormatter={rotuloMes}
              tick={EIXO_TICK}
              axisLine={{ stroke: CORES.grade }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatUSDCompacto(v)}
              tick={EIXO_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              content={
                <ChartTooltip
                  rotuloExtra={(p) => (p.futuro ? "lancado adiantado" : null)}
                />
              }
              labelFormatter={(l) => rotuloMes(String(l ?? ""))}
              cursor={{ fill: CORES.grade, fillOpacity: 0.35 }}
            />
            <Bar
              dataKey="total"
              name="Custo mensal"
              radius={[MARCAS.raioBarra, MARCAS.raioBarra, 0, 0]}
              // Com poucas categorias a barra esticaria e viraria bloco.
              maxBarSize={96}
              isAnimationActive={false}
            >
              {dados.map((d) => (
                <Cell
                  key={d.mes}
                  fill={d.futuro ? "url(#hachura-futuro)" : CORES.barra}
                  stroke={d.futuro ? CORES.barra : undefined}
                  strokeWidth={d.futuro ? 1 : 0}
                />
              ))}
              {/* Rotulo direto: exigido porque o verde fica em 2,9:1 de contraste. */}
              <LabelList
                dataKey="total"
                position="top"
                formatter={(v) => formatUSD(v)}
                fill={CORES.texto}
                fontSize={11}
                className="veri-numero"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {temFuturo && (
        <p className="mt-2 flex items-center gap-2 text-xs text-veri-verde-escuro/70">
          <span
            aria-hidden
            className="inline-block h-3 w-6 rounded-sm border border-veri-verde"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg, #7F9C90 0 3px, #FFFFFF 3px 6px)",
            }}
          />
          Hachurado = periodo posterior ao mes atual (cobranca lancada adiantado).
        </p>
      )}
    </div>
  );
}
