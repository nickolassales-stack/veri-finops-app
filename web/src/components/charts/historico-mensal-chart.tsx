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

import { formatUSD, formatUSDCompacto, formatParticipacao } from "@/lib/format";

import { ChartTooltip } from "./chart-tooltip";
import { CORES, EIXO_TICK, MARCAS } from "./chart-theme";

/**
 * Historico mensal: linha por conta e composicao empilhada.
 *
 * O LIMITE DE DUAS CORES E DELIBERADO. O validador de paleta reprovou ate um
 * terceiro verde da identidade VERI (deltaE 5,4 contra o segundo) -- ver
 * `distribuicao-servicos-chart.tsx`. Inventar cor para uma terceira conta daria
 * um grafico que parece informativo e nao e: quem tem deficiencia de visao de
 * cores, e boa parte de quem nao tem, nao consegue separar as series.
 *
 * A saida e a mesma que o resto do portal ja adota: com ate duas contas, uma
 * linha para cada, nas duas cores aprovadas. Com tres ou mais, uma linha de
 * TOTAL -- e o detalhe por conta vai para as barras de composicao, onde a
 * identidade vem do ROTULO e nao da cor.
 */

export type PontoMensal = {
  mes: string;
  contas: { accountId: string; nomeExibicao: string; total: number }[];
  total: number;
};

/** "2026-07" -> "jul/26". Eixo com AAAA-MM fica ilegivel em tela estreita. */
export function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const indice = Number(mes) - 1;
  return nomes[indice] ? `${nomes[indice]}/${ano.slice(2)}` : iso;
}

const MAXIMO_DE_LINHAS = 2;

export function HistoricoMensalChart({ dados }: { dados: PontoMensal[] }) {
  if (dados.length === 0) return null;

  // Contas presentes em QUALQUER mes da serie -- uma conta que so gastou em
  // agosto precisa existir na linha, com buraco nos meses sem custo.
  const contas = [...new Map(
    dados.flatMap((p) => p.contas.map((c) => [c.accountId, c.nomeExibicao] as const)),
  ).entries()].map(([accountId, nome]) => ({ accountId, nome }));

  const porConta = contas.length > 0 && contas.length <= MAXIMO_DE_LINHAS;

  const serie = dados.map((p) => {
    const linha: Record<string, string | number | null> = { mes: p.mes, total: p.total };
    if (porConta) {
      for (const c of contas) {
        // `null` e nao 0: mes sem carga nao e mes de custo zero, e a linha deve
        // ter um buraco em vez de mergulhar ate a base.
        linha[c.accountId] = p.contas.find((x) => x.accountId === c.accountId)?.total ?? null;
      }
    }
    return linha;
  });

  const cores = [CORES.linha, CORES.barra];

  return (
    <div className="h-72 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 12, right: 16, bottom: 4, left: 8 }}>
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
            tickFormatter={(v: number) => formatUSDCompacto(v)}
            tick={EIXO_TICK}
            axisLine={false}
            tickLine={false}
            width={68}
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
                // O payload do Recharts e readonly e tipa `name` como
                // string|number. A normalizacao para string satisfaz o tooltip
                // compartilhado sem alterar valor nenhum.
                payload={payload?.map((i) => ({
                  name: i.name === undefined ? undefined : String(i.name),
                  value: typeof i.value === "number" ? i.value : undefined,
                  payload: i.payload as Record<string, unknown> | undefined,
                }))}
              />
            )}
          />

          {porConta ? (
            contas.map((c, i) => (
              <Line
                key={c.accountId}
                type="monotone"
                dataKey={c.accountId}
                name={c.nome}
                stroke={cores[i]}
                strokeWidth={MARCAS.espessuraLinha}
                dot={{ r: 3, fill: cores[i], strokeWidth: 0 }}
                activeDot={{ r: MARCAS.tamanhoMarcador / 2 }}
                connectNulls={false}
              />
            ))
          ) : (
            <Line
              type="monotone"
              dataKey="total"
              name="Total"
              stroke={CORES.linha}
              strokeWidth={MARCAS.espessuraLinha}
              dot={{ r: 3, fill: CORES.linha, strokeWidth: 0 }}
              activeDot={{ r: MARCAS.tamanhoMarcador / 2 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {porConta && (
        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-texto-suave">
          {contas.map((c, i) => (
            <li key={c.accountId} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-4 rounded-full"
                style={{ backgroundColor: cores[i] }}
              />
              {c.nome}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------ composicao por mes

/** Acima disto, as contas restantes viram "Outros". */
const TOPO = 4;

/**
 * Barras de composicao, uma por mes.
 *
 * HTML/CSS puro, como a distribuicao por servico: sao retangulos numa linha, e
 * assim a legenda participa do fluxo do texto e da tabulacao natural. A
 * identidade vem do ROTULO; a cor so separa segmentos vizinhos, com 2px da cor
 * da superficie entre eles.
 *
 * "Outros" recebe hachura porque nao e uma entidade real, e sim um agrupamento
 * -- dar a ele o mesmo tratamento visual de uma conta faria parecer que existe
 * uma conta chamada Outros.
 */
export function ComposicaoMensal({ dados }: { dados: PontoMensal[] }) {
  if (dados.length === 0) return null;

  // Escala COMPARTILHADA entre os meses: cada barra e proporcional ao maior mes,
  // nao a si mesma. Normalizar cada barra para 100% faria um mes de US$ 10 e um
  // de US$ 1.000 parecerem iguais.
  const maior = Math.max(...dados.map((p) => p.total));

  return (
    <div className="space-y-4">
      {dados.map((ponto) => {
        const ordenadas = [...ponto.contas].sort((a, b) => b.total - a.total);
        const topo = ordenadas.slice(0, TOPO);
        const resto = ordenadas.slice(TOPO);
        const outros = resto.reduce((s, c) => s + c.total, 0);

        const segmentos = [
          ...topo.map((c, i) => ({
            chave: c.accountId,
            rotulo: c.nomeExibicao,
            valor: c.total,
            cor: i % 2 === 0 ? CORES.linha : CORES.barra,
            hachurado: false,
          })),
          ...(outros > 0
            ? [{
                chave: "outros",
                rotulo: `Outros (${resto.length} conta${resto.length > 1 ? "s" : ""})`,
                valor: outros,
                cor: CORES.barra,
                hachurado: true,
              }]
            : []),
        ];

        const larguraDaBarra = maior > 0 ? (ponto.total / maior) * 100 : 0;

        return (
          <div key={ponto.mes}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-veri-verde-escuro">{rotuloMes(ponto.mes)}</span>
              <span className="veri-numero text-texto-suave">{formatUSD(ponto.total)}</span>
            </div>

            <div className="mt-1 h-6 w-full" style={{ maxWidth: `${larguraDaBarra}%` }}>
              <div className="flex h-full w-full overflow-hidden rounded-md">
                {segmentos.map((s, i) => (
                  <div
                    key={s.chave}
                    title={`${s.rotulo}: ${formatUSD(s.valor)} (${formatParticipacao(
                      ponto.total > 0 ? s.valor / ponto.total : 0,
                    )})`}
                    style={{
                      width: `${ponto.total > 0 ? (s.valor / ponto.total) * 100 : 0}%`,
                      backgroundColor: s.cor,
                      // 2px da cor da superficie entre segmentos vizinhos.
                      marginLeft: i === 0 ? 0 : MARCAS.espacoEntreBarras,
                      backgroundImage: s.hachurado
                        ? `repeating-linear-gradient(45deg, ${CORES.superficie}55 0 3px, transparent 3px 6px)`
                        : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-texto-suave">
              {segmentos.map((s) => (
                <li key={s.chave}>
                  {s.rotulo} · <span className="veri-numero">{formatUSD(s.valor)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
