"use client";

import {
  ROTULOS_COLUNA,
  alternarOrdenacao,
  type CampoOrdenavel,
  type FiltrosAnalitico,
} from "@/lib/dashboard/analitico";
import type { LinhaAnalitica } from "@/lib/dashboard/use-analitico";
import type { Cotacao } from "@/lib/dashboard/tipos";
import {
  formatBRLEstimado,
  formatCotacao,
  formatDataDia,
  formatUSD,
} from "@/lib/format";

/**
 * Tabela de lancamentos.
 *
 * Cada linha e um registro de `aws_daily_costs`. Nada e agregado aqui -- o que
 * chega da API ja e a pagina final.
 *
 * MOBILE: a tabela nao vira cartao. Rola horizontalmente dentro do proprio
 * contêiner (`overflow-x-auto` + `min-width`), preservando o alinhamento das
 * colunas de valor -- que e justamente o que permite comparar numeros de olho.
 * Cartao empilhado quebraria essa leitura.
 */

/** Colunas na ordem de exibicao. `ordenavel` casa com a allowlist da API. */
const COLUNAS: {
  campo: CampoOrdenavel | null;
  titulo: string;
  numerica?: boolean;
}[] = [
  { campo: "usageDate", titulo: ROTULOS_COLUNA.usageDate },
  { campo: "accountName", titulo: "Conta AWS" },
  { campo: "service", titulo: ROTULOS_COLUNA.service },
  { campo: "region", titulo: ROTULOS_COLUNA.region },
  { campo: "cost", titulo: "Valor (USD)", numerica: true },
  { campo: null, titulo: "Estimativa (BRL)", numerica: true },
];

export function TabelaAnalitica({
  linhas,
  filtros,
  cotacao,
  ocupado,
  aoMudar,
}: {
  linhas: LinhaAnalitica[];
  filtros: FiltrosAnalitico;
  cotacao: Cotacao | undefined;
  ocupado: boolean;
  aoMudar: (mudanca: Partial<FiltrosAnalitico>) => void;
}) {
  const semCotacao = !cotacao || cotacao.valor === null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <caption className="sr-only">
          Lançamentos de custo, {linhas.length} linha(s) nesta página. Valores
          oficiais em dólar; a coluna em real é estimativa.
        </caption>

        <thead>
          <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
            {COLUNAS.map((coluna) => {
              const ativa = coluna.campo === filtros.ordenarPor;
              return (
                <th
                  key={coluna.titulo}
                  scope="col"
                  // `aria-sort` no cabecalho e o que o leitor de tela usa para
                  // anunciar "ordenado crescente" -- a seta visual sozinha nao
                  // transmite isso.
                  aria-sort={
                    ativa
                      ? filtros.direcao === "asc"
                        ? "ascending"
                        : "descending"
                      : coluna.campo
                        ? "none"
                        : undefined
                  }
                  className={[
                    "py-2 pr-4 font-medium whitespace-nowrap",
                    coluna.numerica ? "text-right" : "",
                  ].join(" ")}
                >
                  {coluna.campo ? (
                    <button
                      type="button"
                      onClick={() => aoMudar(alternarOrdenacao(filtros, coluna.campo!))}
                      disabled={ocupado}
                      className={[
                        "inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:text-veri-verde-escuro disabled:cursor-not-allowed",
                        ativa ? "text-veri-verde-escuro" : "",
                      ].join(" ")}
                    >
                      {coluna.titulo}
                      <span aria-hidden className={ativa ? "" : "opacity-30"}>
                        {ativa ? (filtros.direcao === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span className="px-1">{coluna.titulo}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody
          // Enquanto a proxima pagina chega, o conteudo antigo fica visivel mas
          // esmaecido: sinaliza "atualizando" sem esvaziar a tabela.
          className={ocupado ? "opacity-50 transition-opacity" : "transition-opacity"}
        >
          {linhas.map((linha) => (
            <tr
              key={linha.id}
              className="border-b border-veri-offwhite/60 last:border-0"
            >
              <td className="veri-numero py-2 pr-4 whitespace-nowrap">
                {formatDataDia(linha.usageDate)}
              </td>

              <td className="py-2 pr-4">
                {/* Nome amigavel quando existe; o id sempre, porque e ele que
                    identifica a conta na AWS. */}
                <span className="block max-w-[16rem] truncate">
                  {linha.accountName ?? (
                    <span className="text-veri-verde-escuro/60">sem cadastro</span>
                  )}
                </span>
                <span className="veri-numero block text-xs text-veri-verde-escuro/60">
                  {linha.accountId}
                </span>
              </td>

              <td className="py-2 pr-4">
                <span className="block max-w-[14rem] truncate" title={linha.service}>
                  {linha.service}
                </span>
              </td>

              <td className="py-2 pr-4 whitespace-nowrap text-veri-verde-escuro/75">
                {linha.region ?? (
                  <span className="text-veri-verde-escuro/45">não informada</span>
                )}
              </td>

              {/* Valor OFICIAL: tinta forte, peso maior. */}
              <td className="veri-numero py-2 pr-4 text-right font-medium whitespace-nowrap">
                {formatUSD(linha.costUSD)}
              </td>

              {/* ESTIMATIVA: tinta secundaria e prefixo "~". A diferenca de peso
                  entre esta coluna e a anterior e a propria informacao. */}
              <td className="veri-numero py-2 text-right whitespace-nowrap text-veri-verde-escuro/60">
                {linha.estimatedBRL === null ? (
                  <span
                    className="text-veri-verde-escuro/40"
                    title={cotacao?.mensagemErro ?? "Cotação indisponível"}
                  >
                    indisponível
                  </span>
                ) : (
                  formatBRLEstimado(linha.estimatedBRL)
                )}
              </td>
            </tr>
          ))}
        </tbody>

        {/*
          Cotacao usada no rodape, e nao repetida em cada linha: e a MESMA para
          toda a tabela. Repeti-la 200 vezes seria ruido, e mostraria como dado
          por linha algo que e contexto da consulta.
        */}
        <tfoot>
          <tr>
            <td colSpan={COLUNAS.length} className="pt-3">
              <p className="text-xs leading-relaxed text-veri-verde-escuro/70">
                {semCotacao ? (
                  <>
                    <strong className="font-medium">Cotação indisponível.</strong>{" "}
                    {cotacao?.mensagemErro ?? "A conversão para real não está disponível."}{" "}
                    Os valores em dólar acima seguem exatos.
                  </>
                ) : (
                  <>
                    Coluna em real convertida por{" "}
                    <strong className="veri-numero font-medium">
                      R$ {formatCotacao(cotacao.valor)}
                    </strong>{" "}
                    ({cotacao.fonte}, referência{" "}
                    <span className="veri-numero">
                      {formatDataDia(cotacao.dataReferencia)}
                    </span>
                    {cotacao.desatualizada && (
                      <span className="text-veri-vinho"> · cotação desatualizada</span>
                    )}
                    ). <strong className="font-medium">Estimativa</strong> — não
                    considera spread nem IOF, então não serve para contabilidade.
                  </>
                )}
              </p>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
