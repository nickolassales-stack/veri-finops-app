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

import { formatMoeda, formatMoedaCompacta } from "@/lib/format";
import type { PontoMensalOvhCliente } from "@/lib/dashboard/tipos-ovh";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";
import { rotuloMes } from "./historico-mensal-chart";

/**
 * Evolucao mensal do custo OVH -- serie unica.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `connectNulls={false}`, E POR QUE ISSO E A DECISAO INTEIRA
 *
 * A serie chega com um ponto para CADA mes da janela, e o mes sem fatura vem
 * como `total: null`. Duas alternativas foram descartadas:
 *
 *   `total: 0`             -> a linha mergulha ate a base e o mes parece de
 *                             custo zero. Na OVH isso e comum e falso: a fatura
 *                             chega dias depois do fim do mes, entao o mes
 *                             corrente legitimamente ainda nao tem `invoice`.
 *   omitir o mes           -> a linha liga dois meses distantes como se fossem
 *                             vizinhos, e a inclinacao do trecho passa a mentir
 *                             sobre a velocidade da variacao.
 *
 * Com `null` + `connectNulls={false}` fica um buraco, que e a verdade: nao ha
 * afirmacao sobre aquele mes.
 * ---------------------------------------------------------------------------
 *
 * Serie unica, entao SEM legenda: o titulo do card ja nomeia o que a linha e, e
 * uma caixinha de legenda com um item so e ruido. Duas cores existiriam se
 * houvesse duas series -- aqui a OVH tem uma conta e uma origem por vez.
 */
export function MensalOvhChart({
  dados,
  moeda,
}: {
  dados: PontoMensalOvhCliente[];
  /** Moeda escolhida pelo servidor. Nunca inferida no cliente. */
  moeda: string;
}) {
  if (dados.length === 0) return null;

  const formatar = (v: unknown) => formatMoeda(v, moeda);
  const comValor = dados.filter((p) => p.total !== null);

  return (
    <div className="w-full min-w-0">
      <div className="h-72 w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 12, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={CORES.grade} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="mes"
              tickFormatter={rotuloMes}
              tick={EIXO_TICK}
              axisLine={{ stroke: CORES.grade }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoedaCompacta(v, moeda)}
              tick={EIXO_TICK}
              axisLine={false}
              tickLine={false}
              width={74}
              // Em LINHA a escala focada e legitima: com base em zero, uma
              // variacao real vira uma reta e esconde o movimento que o grafico
              // existe para mostrar. Em barra, base zero e obrigatoria.
              domain={["auto", "auto"]}
            />
            <Tooltip
              content={({ active, payload, label }) => (
                <ChartTooltip
                  active={active}
                  label={typeof label === "string" ? rotuloMes(label) : label}
                  formatar={formatar}
                  payload={payload?.map((i) => ({
                    name: i.name === undefined ? undefined : String(i.name),
                    value: typeof i.value === "number" ? i.value : undefined,
                    payload: i.payload as Record<string, unknown> | undefined,
                  }))}
                />
              )}
            />
            <Line
              type="monotone"
              dataKey="total"
              name="Custo faturado"
              stroke={CORES.linha}
              strokeWidth={MARCAS.espessuraLinha}
              dot={{ r: 3, fill: CORES.linha, strokeWidth: 0 }}
              activeDot={{ r: MARCAS.tamanhoMarcador / 2 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/*
        O buraco no grafico e visivel, mas a CAUSA nao. Sem esta linha, quem ve a
        interrupcao pode concluir que a coleta falhou naqueles meses -- quando o
        normal e a fatura simplesmente ainda nao ter sido emitida.
      */}
      {comValor.length < dados.length && (
        <p className="mt-2 text-xs text-texto-suave">
          {dados.length - comValor.length} de {dados.length} mês(es) da janela sem
          fatura importada — a linha se interrompe neles.{" "}
          <strong className="font-medium">Interrupção não é custo zero:</strong> a OVH
          emite a fatura depois do fechamento do mês.
        </p>
      )}
    </div>
  );
}
