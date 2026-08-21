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

import { formatUSD } from "@/lib/format";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

/**
 * Barras horizontais de serie unica, com rotulo de valor direto.
 *
 * Base de "Custo por conta" e "Top 10 servicos". Horizontal porque nome de
 * conta e de servico da AWS e longo: em barra vertical viraria rotulo girado.
 *
 * O rotulo direto em cada barra NAO e decoracao. O verde de preenchimento fica
 * em 2,9:1 contra a superficie -- abaixo de 3:1 -- e o validador de paleta
 * exige alivio: rotulo visivel e visao de tabela. Sem isso a barra sozinha nao
 * garante leitura. Ver docs/DECISOES-dataviz.md.
 *
 * Base sempre em ZERO: em barra o comprimento codifica magnitude, e truncar a
 * base mentiria sobre a proporcao entre os itens.
 */

export type ItemBarra = {
  rotulo: string;
  valor: number;
  /** Segunda linha do eixo, ex. id da conta. */
  detalhe?: string;
  /** Aplica hachura -- usado em "Outros", que nao e uma entidade real. */
  textura?: boolean;
};

export function BarrasHorizontais({
  itens,
  nomeSerie,
  larguraRotulo = 150,
}: {
  itens: ItemBarra[];
  nomeSerie: string;
  larguraRotulo?: number;
}) {
  const altura = Math.max(180, itens.length * 38 + 24);
  const temTextura = itens.some((i) => i.textura);

  return (
    <>
      {/*
        A hachura vive num <defs> do SVG. Textura resolve a separacao visual sem
        introduzir cor nova, o que o brandbook proibe.
      */}
      {temTextura && (
        <svg aria-hidden width="0" height="0" className="absolute">
          <defs>
            <pattern
              id="hachura-barra"
              width="6"
              height="6"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width="6" height="6" fill={CORES.barra} />
              <line x1="0" y1="0" x2="0" y2="6" stroke={CORES.superficie} strokeWidth="2.5" />
            </pattern>
          </defs>
        </svg>
      )}

      <div style={{ height: altura }} className="w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={itens}
            layout="vertical"
            margin={{ top: 4, right: 96, bottom: 4, left: 4 }}
            barCategoryGap={MARCAS.espacoEntreBarras * 4}
          >
            {/* Eixo X oculto: o rotulo direto ja da o valor exato de cada barra,
                e um eixo numerico ali seria informacao repetida. */}
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis
              type="category"
              dataKey="rotulo"
              tick={EIXO_TICK}
              axisLine={false}
              tickLine={false}
              width={larguraRotulo}
              interval={0}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: CORES.grade, fillOpacity: 0.35 }}
            />
            <Bar
              dataKey="valor"
              name={nomeSerie}
              radius={[0, MARCAS.raioBarra, MARCAS.raioBarra, 0]}
              isAnimationActive={false}
            >
              {itens.map((item, i) => (
                <Cell
                  key={i}
                  fill={item.textura ? "url(#hachura-barra)" : CORES.barra}
                />
              ))}
              <LabelList
                dataKey="valor"
                position="right"
                // `formatUSD` aceita unknown e cai em "US$ 0,00" para nulo, o
                // que casa com o tipo largo que o recharts passa aqui.
                formatter={(v) => formatUSD(v)}
                style={{ fill: CORES.texto, fontSize: 12 }}
                className="veri-numero"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
