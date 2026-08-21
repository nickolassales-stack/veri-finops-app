"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  ComposicaoMensal,
  HistoricoMensalChart,
  rotuloMes,
  type PontoMensal,
} from "@/components/charts/historico-mensal-chart";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { Paginacao } from "@/components/ui/paginacao";
import { ErroDeRequisicao, buscarRecurso } from "@/lib/dashboard/api";
import {
  escreverFiltros,
  lerFiltros,
  validarIntervalo,
  type FiltrosDashboard,
} from "@/lib/dashboard/filtros";
import { useContas } from "@/lib/dashboard/use-dashboard";
import {
  formatBRLEstimado,
  formatDataHora,
  formatInteiro,
  formatParticipacao,
  formatUSD,
  formatVariacao,
} from "@/lib/format";

import { BarraFiltros } from "./barra-filtros";

/**
 * Historico mensal de custos por conta -- a visao FINANCEIRA do analitico.
 *
 * Consome `/api/analytic/cost-history`, que agrega por PERIODO DE COBRANCA e
 * pagina no servidor. O navegador nao soma nada: os cards, a serie e a tabela
 * vem prontos e coerentes entre si, da mesma ida ao banco.
 *
 * Os nomes de parametro de periodo e contas sao os MESMOS das outras telas,
 * entao trocar de aba preserva o recorte.
 */

type Linha = {
  mes: string;
  accountId: string;
  nomeExibicao: string;
  alias: string | null;
  unidade: string | null;
  centroDeCusto: string | null;
  ambiente: string | null;
  custoUSD: number;
  custoAnterior: number | null;
  variacaoAbsoluta: number | null;
  variacaoPercentual: number | null;
  participacao: number;
  estimatedBRL: number | null;
};

type Resumo = {
  total: number;
  mediaMensal: number;
  meses: number;
  maiorMes: { mes: string; total: number } | null;
  menorMes: { mes: string; total: number } | null;
  ultimoMes: { mes: string; total: number } | null;
  mesAnterior: { mes: string; total: number } | null;
  variacao: number | null;
};

type Meta = {
  resumo: Resumo;
  serie: PontoMensal[];
  opcoes: { unidades: string[]; centrosDeCusto: string[]; ambientes: string[] };
  cotacao: { status: string; valor?: number } | null;
  somaUSD: number;
  somaBRL: number | null;
  paginacao: { pagina: number; tamanho: number; total: number; paginas: number };
  ordenacao: { campo: string; direcao: string };
  periodo?: { de: string; ate: string; dias: number };
  geradoEm: string;
};

const ORDENACOES = [
  { valor: "mes", rotulo: "Mês" },
  { valor: "conta", rotulo: "Conta" },
  { valor: "custo", rotulo: "Custo" },
  { valor: "variacao", rotulo: "Variação" },
];

export function PainelHistorico({ tz, podeExportar }: { tz: string; podeExportar: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const busca = searchParams.toString();
  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [erro, setErro] = useState<ErroDeRequisicao | null>(null);

  // Carga dentro do efeito, sem setState sincrono no corpo -- mesmo padrao de
  // `use-analitico.ts`.
  useEffect(() => {
    let vivo = true;
    const controlador = new AbortController();

    void (async () => {
      try {
        const r = await buscarRecurso<Linha[], Meta>(
          "/api/analytic/cost-history",
          new URLSearchParams(busca),
          controlador.signal,
        );
        if (!vivo) return;
        setErro(null);
        setLinhas(r.dados);
        setMeta(r.meta);
      } catch (e) {
        if (!vivo || (e instanceof Error && e.name === "AbortError")) return;
        setErro(
          e instanceof ErroDeRequisicao
            ? e
            : new ErroDeRequisicao(0, "falha-de-rede", "Não foi possível falar com o servidor."),
        );
        setLinhas([]);
      }
    })();

    return () => {
      vivo = false;
      controlador.abort();
    };
  }, [busca, gatilho]);

  const irPara = useCallback(
    (mudancas: Record<string, string | undefined>) => {
      const p = new URLSearchParams(busca);
      for (const [chave, valor] of Object.entries(mudancas)) {
        if (valor === undefined || valor === "") p.delete(chave);
        else p.set(chave, valor);
      }
      // Trocar filtro volta para a primeira pagina: manter a pagina 7 de um
      // recorte que agora tem 2 paginas mostraria uma tabela vazia.
      if (!("pagina" in mudancas)) p.delete("pagina");
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [busca, pathname, router],
  );

  // Os filtros GLOBAIS (periodo e contas) usam os mesmos nomes de parametro das
  // outras telas, entao a barra e literalmente a mesma e o recorte atravessa.
  const filtrosGlobais = useMemo(
    () => lerFiltros(new URLSearchParams(busca)),
    [busca],
  );
  const contas = useContas();
  const problema = validarIntervalo(filtrosGlobais);

  const aplicarGlobais = useCallback(
    (mudanca: Partial<FiltrosDashboard>) => {
      const p = escreverFiltros({ ...filtrosGlobais, ...mudanca });
      // Preserva o que e proprio desta tela; a paginacao volta ao inicio.
      for (const chave of ["unidade", "centroDeCusto", "ambiente", "ordenarPor", "direcao"]) {
        const valor = searchParams.get(chave);
        if (valor) p.set(chave, valor);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [filtrosGlobais, pathname, router, searchParams],
  );

  const limparGlobais = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const urlExportacao = useMemo(() => {
    const p = new URLSearchParams(busca);
    // Exportar e "tudo o que este filtro seleciona", nao a pagina aberta.
    p.delete("pagina");
    p.delete("tamanho");
    return p.toString();
  }, [busca]);

  if (erro && !linhas?.length) {
    return (
      <ErroDoBloco
        mensagem={erro.message}
        detalhes={erro.detalhes}
        aoTentarNovamente={recarregar}
      />
    );
  }
  if (linhas === null || meta === null) return <CarregandoLinhas linhas={8} />;

  const { resumo, opcoes } = meta;
  const semCotacao = !meta.cotacao || meta.cotacao.status === "unavailable";

  return (
    <div className="space-y-6">
      {/* Filtros globais: os MESMOS da visão executiva e do analítico por
          serviço, e o recorte atravessa de uma tela para a outra. */}
      <BarraFiltros
        filtros={filtrosGlobais}
        contas={contas}
        problema={problema}
        carregando={false}
        aoMudar={aplicarGlobais}
        aoLimpar={limparGlobais}
      />

      {/* ---------------------------------------------- filtros de cadastro */}
      <Card
        titulo="Recorte por cadastro"
        descricao="As opções vêm do cadastro de contas, não das linhas de custo — uma conta sem gasto no período continua listada."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SeletorDeCadastro
            rotulo="Unidade de negócio"
            valor={searchParams.get("unidade") ?? ""}
            opcoes={opcoes.unidades}
            aoMudar={(v) => irPara({ unidade: v })}
          />
          <SeletorDeCadastro
            rotulo="Centro de custo"
            valor={searchParams.get("centroDeCusto") ?? ""}
            opcoes={opcoes.centrosDeCusto}
            aoMudar={(v) => irPara({ centroDeCusto: v })}
          />
          <SeletorDeCadastro
            rotulo="Ambiente"
            valor={searchParams.get("ambiente") ?? ""}
            opcoes={opcoes.ambientes}
            aoMudar={(v) => irPara({ ambiente: v })}
          />
        </div>
      </Card>

      <Aviso tom="info" titulo="Esta tela usa o período de cobrança">
        <p>
          Os valores são agrupados pelo mês em que a AWS <strong>faturou</strong>
          {" "}(<span className="veri-numero">billing_month</span>), o mesmo critério do
          AWS Cost Explorer. Uma cobrança pontual com data de uso em outro mês entra no
          mês da fatura.
        </p>
        <p>
          Valores em <strong>USD</strong> são provenientes da AWS. O <strong>BRL</strong>{" "}
          é estimativa pela cotação de referência e <strong>não serve para
          contabilidade</strong>. A evolução diária da visão executiva segue a data de uso
          e é operacional — não use para reconciliação financeira.
        </p>
      </Aviso>

      {/* ------------------------------------------------------------ cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <CardResumo
          rotulo="Custo total do período"
          valor={formatUSD(resumo.total)}
          apoio={`${resumo.meses} mês(es) com dado`}
          destaque
        />
        <CardResumo
          rotulo="Média mensal"
          valor={formatUSD(resumo.mediaMensal)}
          apoio="por mês com carga, não do calendário"
        />
        <CardResumo
          rotulo="Maior mês"
          valor={resumo.maiorMes ? formatUSD(resumo.maiorMes.total) : "—"}
          apoio={resumo.maiorMes ? rotuloMes(resumo.maiorMes.mes) : "sem dado"}
        />
        <CardResumo
          rotulo="Menor mês"
          valor={resumo.menorMes ? formatUSD(resumo.menorMes.total) : "—"}
          apoio={resumo.menorMes ? rotuloMes(resumo.menorMes.mes) : "sem dado"}
        />
        <CardResumo
          rotulo="Variação vs mês anterior"
          valor={resumo.variacao === null ? "—" : formatVariacao(resumo.variacao)}
          apoio={
            resumo.mesAnterior && resumo.ultimoMes
              ? `${rotuloMes(resumo.ultimoMes.mes)} sobre ${rotuloMes(resumo.mesAnterior.mes)}`
              : "sem base de comparação"
          }
        />
      </div>

      {/* --------------------------------------------------------- graficos */}
      {meta.serie.length === 0 ? (
        <Vazio titulo="Nenhum custo no período">
          Ajuste o período ou os filtros de cadastro.
        </Vazio>
      ) : (
        <>
          <Card
            titulo="Evolução mensal"
            descricao="Por período de cobrança. Mês sem carga aparece como falha na linha, não como zero."
          >
            <HistoricoMensalChart dados={meta.serie} />
          </Card>

          <Card
            titulo="Composição por conta"
            descricao="Escala compartilhada entre os meses — a largura da barra é proporcional ao maior mês da série."
          >
            <ComposicaoMensal dados={meta.serie} />
          </Card>
        </>
      )}

      {/* ---------------------------------------------------------- tabela */}
      <Card
        titulo="Variação mensal por conta"
        descricao={`${formatInteiro(meta.paginacao.total)} linha(s). Soma do recorte: ${formatUSD(meta.somaUSD)}${
          semCotacao ? "" : ` · ${formatBRLEstimado(meta.somaBRL)}`
        }`}
        acao={
          podeExportar && meta.paginacao.total > 0 ? (
            <div className="flex gap-2">
              <a
                href={`/api/analytic/cost-history/export/csv?${urlExportacao}`}
                className="rounded-full border border-veri-verde-claro/60 px-4 py-2 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
              >
                CSV
              </a>
              <a
                href={`/api/analytic/cost-history/export/xlsx?${urlExportacao}`}
                className="rounded-full border border-veri-verde-claro/60 px-4 py-2 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
              >
                XLSX
              </a>
            </div>
          ) : null
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-texto-suave">Ordenar por</span>
          {ORDENACOES.map((o) => {
            const ativo = (meta.ordenacao.campo ?? "mes") === o.valor;
            return (
              <button
                key={o.valor}
                type="button"
                onClick={() =>
                  irPara({
                    ordenarPor: o.valor,
                    // Clicar no campo ja ativo INVERTE a direcao; trocar de
                    // campo comeca em desc, que e o que interessa em dinheiro.
                    direcao: ativo && meta.ordenacao.direcao === "desc" ? "asc" : "desc",
                  })
                }
                aria-pressed={ativo}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  ativo
                    ? "border-transparent bg-veri-verde-escuro text-veri-branco"
                    : "border-veri-verde-claro/60 text-veri-verde-escuro hover:bg-veri-offwhite",
                ].join(" ")}
              >
                {o.rotulo}
                {ativo && (meta.ordenacao.direcao === "desc" ? " ↓" : " ↑")}
              </button>
            );
          })}
        </div>

        {linhas.length === 0 ? (
          <Vazio titulo="Nenhuma linha no recorte" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                  <th className="py-2 pr-4 font-medium">Mês</th>
                  <th className="py-2 pr-4 font-medium">Conta</th>
                  <th className="py-2 pr-4 font-medium">Alias</th>
                  <th className="py-2 pr-4 text-right font-medium">Custo USD</th>
                  <th className="py-2 pr-4 text-right font-medium">Est. BRL</th>
                  <th className="py-2 pr-4 text-right font-medium">Variação</th>
                  <th className="py-2 pr-4 text-right font-medium">%</th>
                  <th className="py-2 text-right font-medium">Participação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr
                    key={`${l.mes}|${l.accountId}`}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="veri-numero py-2 pr-4">{rotuloMes(l.mes)}</td>
                    <td className="py-2 pr-4">
                      <span className="block max-w-[14rem] truncate" title={l.nomeExibicao}>
                        {l.nomeExibicao}
                      </span>
                      {/* O ID SEMPRE visível: é ele que identifica a conta na AWS. */}
                      <span className="veri-numero block text-xs text-texto-suave">
                        {l.accountId}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-texto-suave">
                      {l.alias ?? <span title="Usando o nome do cadastro">—</span>}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">{formatUSD(l.custoUSD)}</td>
                    <td className="veri-numero py-2 pr-4 text-right text-texto-suave">
                      {l.estimatedBRL === null ? "—" : formatBRLEstimado(l.estimatedBRL)}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {l.variacaoAbsoluta === null ? (
                        <span className="text-texto-suave" title="Primeiro mês da série desta conta">
                          —
                        </span>
                      ) : (
                        formatUSD(l.variacaoAbsoluta)
                      )}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {l.variacaoPercentual === null ? (
                        <span className="text-texto-suave">—</span>
                      ) : (
                        formatVariacao(l.variacaoPercentual)
                      )}
                    </td>
                    <td className="veri-numero py-2 text-right text-texto-suave">
                      {formatParticipacao(l.participacao)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Paginacao
            pagina={meta.paginacao.pagina}
            paginas={meta.paginacao.paginas}
            total={meta.paginacao.total}
            tamanho={meta.paginacao.tamanho}
            ocupado={false}
            aoIr={(p) => irPara({ pagina: String(p) })}
          />
        </div>
      </Card>

      <p className="text-xs text-texto-suave">
        Consultado às {formatDataHora(meta.geradoEm, tz)} · valores oficiais em USD,
        conforme a origem do CUR.
      </p>
    </div>
  );
}

function CardResumo({
  rotulo,
  valor,
  apoio,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  apoio: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-5",
        destaque
          ? "border-veri-verde/40 bg-veri-verde/8"
          : "border-veri-offwhite bg-veri-branco",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</p>
      <p className="veri-numero mt-1 text-2xl text-veri-verde-escuro">{valor}</p>
      <p className="mt-1 text-xs leading-relaxed text-texto-suave">{apoio}</p>
    </div>
  );
}

function SeletorDeCadastro({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  opcoes: string[];
  aoMudar: (v: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs uppercase tracking-wide text-texto-suave">{rotulo}</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="w-full rounded-lg border border-veri-offwhite bg-veri-branco px-3 py-2 text-sm text-veri-verde-escuro outline-none focus-visible:ring-2 focus-visible:ring-veri-verde/50"
      >
        <option value="">Todas</option>
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
