"use client";

import type { ReactNode } from "react";

import { CarregandoLinhas } from "@/components/ui/estado";
import type { Cotacao, MetaResposta, Resumo } from "@/lib/dashboard/tipos";
import {
  formatBRLEstimado,
  formatCotacao,
  formatDataDia,
  formatDataHora,
  formatInteiro,
  formatUSD,
  formatVariacao,
} from "@/lib/format";

/**
 * Linha de indicadores do painel.
 *
 * A hierarquia visual carrega uma regra de negocio, nao so estetica:
 *
 *   USD e o valor OFICIAL  -> card em destaque, numero grande, tinta forte
 *   BRL e ESTIMATIVA       -> card comum, numero menor, tinta secundaria,
 *                             prefixo "~" e a palavra "estimativa" no rotulo
 *
 * Quem bate o olho precisa saber, sem ler, qual dos dois numeros vale.
 */

function Cartao({
  rotulo,
  children,
  destaque,
  className,
}: {
  rotulo: string;
  children: ReactNode;
  destaque?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-5",
        destaque
          ? "border-veri-verde/40 bg-veri-verde/10"
          : "border-veri-offwhite bg-veri-branco",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-texto-suave">
        {rotulo}
      </p>
      {children}
    </div>
  );
}

export function CardsKpi({
  resumo,
  meta,
  carregando,
  tz,
}: {
  resumo: Resumo | null;
  meta: MetaResposta | null;
  carregando: boolean;
  tz: string;
}) {
  if (carregando && !resumo) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5">
            <CarregandoLinhas linhas={2} />
          </div>
        ))}
      </div>
    );
  }

  if (!resumo) return null;

  const cotacao = resumo.estimativaBRL.cotacao;
  const dias = meta?.periodo?.dias ?? resumo.diasComDado;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* ---------------------------------------------------- custo oficial */}
      <Cartao rotulo="Custo total do período" destaque>
        <p className="veri-numero veri-display mt-2 text-4xl text-veri-verde-escuro">
          {formatUSD(resumo.total)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          Valor oficial, em dólar, como a AWS fatura.{" "}
          {resumo.diasComDado > 0 ? (
            <>
              Média de{" "}
              <span className="veri-numero">{formatUSD(resumo.mediaDiaria)}</span> por dia
              com dado ({formatInteiro(resumo.diasComDado)} de {formatInteiro(dias)}).
            </>
          ) : (
            "Nenhum dia do período tem carga."
          )}
        </p>
      </Cartao>

      {/* -------------------------------------------------- estimativa BRL */}
      <Cartao rotulo="Estimativa em real">
        {/*
          Tinta secundaria: subordina visualmente a estimativa ao valor oficial
          em dolar. A ausencia de cotacao NAO e sinalizada por uma tinta ainda
          mais fraca -- nao existe tom mais claro que passe em contraste, e
          significado nao pode depender so de cor. Quem diz que falta cotacao e
          o proprio conteudo: o travessao aqui e a frase logo abaixo.
        */}
        <p className="veri-numero mt-2 text-3xl text-texto-suave">
          {formatBRLEstimado(resumo.estimativaBRL.total)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {resumo.estimativaBRL.total === null ? (
            <>Sem cotação disponível — o valor em dólar continua exato.</>
          ) : (
            <>
              Conversão indicativa. Não considera spread nem IOF da fatura, então{" "}
              <strong className="font-medium">não use para contabilidade</strong>.
            </>
          )}
        </p>
      </Cartao>

      {/* ------------------------------------------------------- cotacao */}
      <CardCotacao cotacao={cotacao} tz={tz} />

      {/* ------------------------------------------------------ variacao */}
      <Cartao rotulo="Contas e variação">
        <p className="veri-numero veri-display mt-2 text-3xl text-veri-verde-escuro">
          {formatInteiro(resumo.contasComCusto)}
          <span className="text-lg text-texto-suave">
            {" "}
            de {formatInteiro(resumo.contasAtivasCadastradas)}
          </span>
        </p>
        <p className="text-xs text-texto-suave">
          conta(s) com custo no período
        </p>
        <div className="mt-3 border-t border-veri-offwhite pt-3 text-xs leading-relaxed">
          <VariacaoPeriodo resumo={resumo} meta={meta} />
        </div>
      </Cartao>
    </div>
  );
}

/**
 * Cotacao usada na estimativa.
 *
 * Reune os tres fatos que qualificam o numero -- valor, momento de referencia e
 * fonte -- porque separa-los em cards distintos daria a um carimbo de data e ao
 * nome de uma instituicao o mesmo peso visual de um indicador financeiro.
 */
function CardCotacao({ cotacao, tz }: { cotacao: Cotacao; tz: string }) {
  const indisponivel = cotacao.status === "unavailable";

  return (
    <Cartao rotulo="Cotação USD/BRL">
      {/*
        Mesma regra do card de estimativa: a indisponibilidade aparece no
        conteudo (o travessao e a etiqueta logo abaixo), nunca so na tinta.
      */}
      <p className="veri-numero mt-2 text-3xl text-texto-suave">
        {indisponivel ? "—" : `R$ ${formatCotacao(cotacao.valor)}`}
      </p>

      <EtiquetaCotacao cotacao={cotacao} />

      <dl className="mt-3 space-y-1 border-t border-veri-offwhite pt-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-texto-suave">Referência</dt>
          <dd className="veri-numero text-right text-texto-suave">
            {cotacao.dataHoraReferencia
              ? formatDataHora(cotacao.dataHoraReferencia, tz)
              : formatDataDia(cotacao.dataReferencia)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-texto-suave">Fonte</dt>
          <dd className="text-right text-texto-suave">{cotacao.fonte}</dd>
        </div>
      </dl>

      {cotacao.mensagemErro && (
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {cotacao.mensagemErro}
        </p>
      )}
    </Cartao>
  );
}

/**
 * Estado da cotacao. Nunca por cor sozinha: cada estado tem texto proprio, e o
 * "desatualizada" ganha borda e icone alem da cor.
 */
function EtiquetaCotacao({ cotacao }: { cotacao: Cotacao }) {
  if (cotacao.status === "unavailable") {
    return (
      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-veri-offwhite px-2.5 py-0.5 text-xs text-texto-suave">
        <span aria-hidden>○</span> indisponível
      </p>
    );
  }

  if (cotacao.desatualizada) {
    return (
      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-veri-mostarda/60 bg-veri-amarelo/20 px-2.5 py-0.5 text-xs text-veri-verde-escuro">
        <span aria-hidden>!</span> desatualizada
      </p>
    );
  }

  if (cotacao.status === "cached") {
    return (
      <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-veri-offwhite px-2.5 py-0.5 text-xs text-texto-suave">
        <span aria-hidden>•</span> em cache
        {cotacao.idadeSegundos !== null && cotacao.idadeSegundos >= 60 && (
          <> · há {Math.floor(cotacao.idadeSegundos / 60)} min</>
        )}
      </p>
    );
  }

  return (
    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-veri-verde/15 px-2.5 py-0.5 text-xs text-veri-verde-escuro">
      <span aria-hidden>•</span> atualizada agora
    </p>
  );
}

/**
 * Variacao contra o periodo anterior equivalente.
 *
 * Quando o conjunto de contas com dado muda entre as janelas, o percentual NAO
 * e exibido: ele mediria ausencia de carga, nao consumo. Esta e a regra mais
 * importante do painel -- ver docs/DECISOES-dataviz.md.
 */
function VariacaoPeriodo({
  resumo,
  meta,
}: {
  resumo: Resumo;
  meta: MetaResposta | null;
}) {
  const anterior = meta?.periodo?.anterior;
  const intervalo = anterior
    ? `${formatDataDia(anterior.de)} a ${formatDataDia(anterior.ate)}`
    : "período anterior";

  if (resumo.variacao === null) {
    return (
      <span className="text-texto-suave">
        Sem base de comparação em {intervalo}.
      </span>
    );
  }

  if (!resumo.comparavel) {
    return (
      <span className="text-texto-suave">
        <strong className="font-medium">Variação não comparável:</strong> o conjunto de
        contas com dado mudou entre os períodos. O percentual mediria falta de carga,
        não consumo.
      </span>
    );
  }

  const subiu = resumo.variacao > 0;

  return (
    <span>
      <span
        className={[
          "veri-numero font-medium",
          subiu ? "text-veri-vinho" : "text-veri-verde-escuro",
        ].join(" ")}
      >
        {formatVariacao(resumo.variacao)}
      </span>{" "}
      <span className="text-texto-suave">
        {subiu ? "acima" : "abaixo"} de {intervalo} (
        <span className="veri-numero">{formatUSD(resumo.totalAnterior)}</span>)
      </span>
    </span>
  );
}
