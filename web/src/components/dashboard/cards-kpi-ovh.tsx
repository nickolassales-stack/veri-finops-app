"use client";

import type { ReactNode } from "react";

import { CarregandoLinhas } from "@/components/ui/estado";
import { resumirCollector } from "@/lib/dashboard/collector-contas";
import { DESCRICAO_FONTE, ROTULO_FONTE } from "@/lib/dashboard/ovh";
import type {
  MetaOvh,
  ResumoOvhCliente,
  SincronizacaoOvh,
} from "@/lib/dashboard/tipos-ovh";
import {
  formatBRLEstimado,
  formatCotacao,
  formatDataHora,
  formatInteiro,
  formatMoeda,
  formatVariacao,
} from "@/lib/format";

/**
 * Indicadores da visao OVH.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE GOVERNA TODOS OS SEIS CARDS
 *
 * `total === null` imprime "sem dado", nunca "US$ 0,00". As duas coisas nao sao
 * sinonimas:
 *
 *   0,00      a OVH cobrou zero neste periodo
 *   sem dado  ninguem sabe quanto a OVH cobrou
 *
 * Num painel executivo, um zero e lido como "esta sob controle". Escrever zero
 * onde a verdade e ausencia de importacao faz o portal mentir exatamente no
 * lugar onde a decisao e tomada.
 * ---------------------------------------------------------------------------
 *
 * Hierarquia visual, igual a da visao AWS: a moeda da fatura e o valor OFICIAL
 * (card em destaque, numero grande) e o BRL e ESTIMATIVA (card comum, tinta
 * secundaria, prefixo "~"). Quem bate o olho precisa saber, sem ler, qual dos
 * dois vale.
 */

const SEM_DADO = <span className="text-texto-suave">sem dado</span>;

function Cartao({
  rotulo,
  children,
  destaque,
}: {
  rotulo: string;
  children: ReactNode;
  destaque?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-5",
        destaque
          ? "border-veri-verde/40 bg-veri-verde/10"
          : "border-veri-offwhite bg-veri-branco",
      ].join(" ")}
    >
      <p className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</p>
      {children}
    </div>
  );
}

const TOM_SELO = {
  ok: "border-veri-verde/50 bg-veri-verde/15 text-veri-verde-escuro",
  atencao: "border-veri-mostarda/60 bg-veri-amarelo/20 text-veri-verde-escuro",
  critico: "border-veri-vinho/40 bg-veri-vinho/8 text-veri-vinho",
  neutro: "border-veri-offwhite bg-veri-offwhite text-texto-suave",
} as const;

export function CardsKpiOvh({
  resumo,
  sincronizacao,
  meta,
  carregando,
  tz,
  contasSelecionadas = [],
}: {
  resumo: ResumoOvhCliente | null;
  sincronizacao: SincronizacaoOvh | null;
  meta: MetaOvh | null;
  carregando: boolean;
  tz: string;
  /** Ids do recorte. Vazio = todas as contas. */
  contasSelecionadas?: string[];
}) {
  // O resumo do collector e do RECORTE, e por isso e calculado aqui e nao no
  // servidor: `sync-status` nao conhece os filtros (ele e buscado uma vez, sem
  // params, porque a saude do collector nao muda com o periodo). O que muda com
  // o filtro e QUAIS contas interessam -- e isso e agregacao, nao consulta.
  const resumoCollector =
    sincronizacao && sincronizacao.porConta.length > 0
      ? resumirCollector(sincronizacao.porConta, contasSelecionadas, new Date())
      : null;
  if (carregando && !resumo) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5"
          >
            <CarregandoLinhas linhas={2} />
          </div>
        ))}
      </div>
    );
  }

  if (!resumo) return null;

  const moeda = meta?.filtros.moeda;
  const origem = meta?.filtros.source ?? "invoice";
  const temTotal = resumo.total !== null && moeda !== null && moeda !== undefined;
  const brl = resumo.estimativaBRL;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {/* ------------------------------------------------ custo faturado */}
      <Cartao rotulo={`Custo ${ROTULO_FONTE[origem].toLowerCase()} no período`} destaque>
        <p className="veri-numero veri-display mt-2 text-4xl text-veri-verde-escuro">
          {temTotal ? formatMoeda(resumo.total, moeda) : SEM_DADO}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {DESCRICAO_FONTE[origem].charAt(0).toUpperCase() +
            DESCRICAO_FONTE[origem].slice(1)}
          .{" "}
          {temTotal ? (
            <>
              Comparado ao período anterior equivalente:{" "}
              <span className="veri-numero">{formatVariacao(resumo.variacao)}</span>
              {resumo.totalAnterior !== null && (
                <>
                  {" "}
                  (era{" "}
                  <span className="veri-numero">
                    {formatMoeda(resumo.totalAnterior, moeda)}
                  </span>
                  )
                </>
              )}
              .
            </>
          ) : (
            "Nenhum valor importado para esta origem no período."
          )}
        </p>
      </Cartao>

      {/* --------------------------------------------- estimativa em BRL */}
      <Cartao rotulo="Estimativa em real">
        <p className="veri-numero mt-2 text-2xl text-texto-suave">
          {brl ? formatBRLEstimado(brl.total) : SEM_DADO}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {brl ? (
            <>
              Estimativa, não valor contábil.{" "}
              {brl.cotacao.valor !== null ? (
                <>
                  Cotação de {formatCotacao(brl.cotacao.valor)} por dólar. {brl.aviso}
                </>
              ) : (
                "Cotação indisponível no momento — o valor oficial em dólar permanece ao lado."
              )}
            </>
          ) : (
            <>
              {/*
                A ausencia aqui tem DUAS causas diferentes, e dizer qual e o que
                impede o usuario de procurar o problema errado.
              */}
              {temTotal
                ? `A cotação que o portal consulta no Banco Central é USD/BRL, e este recorte está em ${moeda}. Converter com a taxa errada daria um número com cara de real e sem relação com a fatura.`
                : "Sem custo importado no período, não há o que estimar."}
            </>
          )}
        </p>
      </Cartao>

      {/* -------------------------------------------------- projetos OVH */}
      <Cartao rotulo="Projetos OVH">
        <p className="veri-numero mt-2 text-2xl text-veri-verde-escuro">
          {formatInteiro(resumo.projetosCadastrados)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          Projetos Public Cloud cadastrados na conta.{" "}
          {temTotal ? (
            <>
              <span className="veri-numero">
                {formatInteiro(resumo.projetosComCusto)}
              </span>{" "}
              com custo no período.
            </>
          ) : (
            "Sem custo no período para comparar."
          )}
          {/*
            Custo de fatura que a OVH nao atribui a projeto -- taxa de dominio,
            assinatura. Sem esta linha, a soma por projeto parece nao fechar com
            o total, e a diferenca passaria por erro de conta.
          */}
          {resumo.custoSemProjeto !== null &&
            resumo.custoSemProjeto > 0 &&
            moeda != null && (
              <>
                {" "}
                <span className="veri-numero">
                  {formatMoeda(resumo.custoSemProjeto, moeda)}
                </span>{" "}
                do total não pertence a projeto nenhum.
              </>
            )}
        </p>
      </Cartao>

      {/* --------------------------------------------- faturas no periodo */}
      <Cartao rotulo="Faturas no período">
        <p className="veri-numero mt-2 text-2xl text-veri-verde-escuro">
          {formatInteiro(resumo.faturas)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          Cabeçalhos de fatura com mês de competência dentro da janela.
          {resumo.mesesComDado > 0 && (
            <>
              {" "}
              Custo importado em{" "}
              <span className="veri-numero">{formatInteiro(resumo.mesesComDado)}</span>{" "}
              mês(es)
              {resumo.primeiroMes && resumo.ultimoMes && (
                <>
                  , de <span className="veri-numero">{resumo.primeiroMes}</span> a{" "}
                  <span className="veri-numero">{resumo.ultimoMes}</span>
                </>
              )}
              .
            </>
          )}
        </p>
      </Cartao>

      {/* ------------------------------------------ ultima sincronizacao */}
      <Cartao rotulo="Última sincronização OVH">
        <p className="veri-numero mt-2 text-lg text-veri-verde-escuro">
          {sincronizacao?.ultima
            ? formatDataHora(
                sincronizacao.ultima.finishedAt ?? sincronizacao.ultima.startedAt,
                tz,
              )
            : SEM_DADO}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {sincronizacao?.ultima ? (
            <>
              Execução{" "}
              <span className="veri-numero">#{sincronizacao.ultima.id}</span>, origem{" "}
              <span className="veri-numero">{sincronizacao.ultima.source}</span> —{" "}
              <span className="veri-numero">
                {formatInteiro(sincronizacao.ultima.costRows)}
              </span>{" "}
              linha(s) de custo e{" "}
              <span className="veri-numero">
                {formatInteiro(sincronizacao.ultima.invoiceRows)}
              </span>{" "}
              fatura(s).
              {/*
                Quando a ultima falhou, o dado da tela e de outra execucao. Dizer
                QUAL evita que o usuario atribua os numeros a uma coleta que nao
                os produziu.
              */}
              {sincronizacao.ultimoSucesso &&
                sincronizacao.ultimoSucesso.id !== sincronizacao.ultima.id && (
                  <>
                    {" "}
                    O dado exibido é do último sucesso, execução{" "}
                    <span className="veri-numero">#{sincronizacao.ultimoSucesso.id}</span>.
                  </>
                )}
            </>
          ) : (
            "Nenhuma execução registrada em ovh_sync_runs."
          )}
        </p>
      </Cartao>

      {/* ------------------------------------------- status do collector */}
      <Cartao rotulo="Status do collector">
        <p className="mt-2">
          {resumoCollector ? (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${
                TOM_SELO[resumoCollector.tom]
              }`}
            >
              {resumoCollector.rotulo}
            </span>
          ) : sincronizacao ? (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-semibold ${
                TOM_SELO[sincronizacao.tom]
              }`}
            >
              {sincronizacao.rotulo}
            </span>
          ) : (
            <span className="veri-numero text-2xl">{SEM_DADO}</span>
          )}
        </p>

        {/* Um alerta por PROBLEMA, e nao um resumo unico. "1 conta com falha" e
            "1 conta sem credencial" pedem acoes diferentes: a primeira manda
            olhar o log, a segunda manda cadastrar em Contas Cloud. */}
        {resumoCollector && resumoCollector.alertas.length > 0 && (
          <ul className="mt-2 space-y-1">
            {resumoCollector.alertas.map((a) => (
              <li key={a} className="text-xs font-medium text-veri-vinho">
                {a}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs leading-relaxed text-texto-suave">
          {/*
            O texto carrega o estado, e nao so a cor: mostarda e vinho ficam
            reservados para status no brandbook, mas cor sozinha nao e leitura --
            quem tem deficiencia de visao de cores precisa do rotulo.
          */}
          Saúde da coleta OVH, pela mesma regra de{" "}
          <code className="veri-numero">/dashboard/diagnostico</code>. Detalhe do erro,
          histórico e agendamento ficam lá.
        </p>
        {/*
          Procedencia da visao: DE QUAL conta OVH sao estes numeros. Selo
          discreto, sem cor de status -- nao e um estado, e uma identificacao.
          Lista vazia com collector instalado e informacao propria: a integracao
          existe mas nunca sincronizou conta alguma.
        */}
        {/*
          Procedencia do RECORTE, e nao a lista fixa de contas integradas. Com
          duas contas e um filtro aplicado, "Conta: OVH Principal" afirmaria
          procedencia errada -- os numeros acima sao das contas SELECIONADAS.
        */}
        {resumoCollector !== null && (
          <div className="mt-3 space-y-1 border-t border-veri-offwhite pt-3 text-xs text-texto-suave">
            <p>
              {resumoCollector.total === 0
                ? "Nenhuma conta OVH ativa no cadastro."
                : resumoCollector.descricaoContas}
            </p>
            {/*
              A coleta mais recente DO RECORTE, e nao a ultima execucao do
              collector -- aquela fica no card ao lado e e global. Com um filtro
              de conta aplicado as duas divergem, e e esta que responde "o numero
              que estou vendo e de quando?".
            */}
            {resumoCollector.total > 0 && (
              <p>
                Última coleta mais recente:{" "}
                <span className="veri-numero">
                  {resumoCollector.ultimaColeta
                    ? formatDataHora(resumoCollector.ultimaColeta, tz)
                    : "nenhuma concluída"}
                </span>
              </p>
            )}
          </div>
        )}
      </Cartao>
    </div>
  );
}
