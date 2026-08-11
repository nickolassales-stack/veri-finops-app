"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { Paginacao } from "@/components/ui/paginacao";
import {
  PADRAO_ANALITICO,
  aplicarMudanca,
  escreverFiltrosAnalitico,
  lerFiltrosAnalitico,
  type FiltrosAnalitico as Filtros,
} from "@/lib/dashboard/analitico";
import {
  ROTULOS_PRESET,
  descreverFiltros,
  validarIntervalo,
} from "@/lib/dashboard/filtros";
import { useAnalitico } from "@/lib/dashboard/use-analitico";
import { useContas } from "@/lib/dashboard/use-dashboard";
import {
  formatBRLEstimado,
  formatDataDia,
  formatDataHora,
  formatInteiro,
  formatIntervalo,
  formatUSD,
} from "@/lib/format";

import { BarraFiltros } from "./barra-filtros";
import { FiltrosAnalitico } from "./filtros-analitico";
import { TabelaAnalitica } from "./tabela-analitica";

/**
 * Painel analitico.
 *
 * Consome `/api/dashboard/analytic`, que valida a sessao contra o banco e
 * pagina no servidor. O navegador nao fala com o PostgreSQL, nao agrega nada e
 * nunca recebe o historico inteiro -- so a pagina pedida.
 *
 * Os filtros globais (periodo e contas) usam os MESMOS nomes de parametro do
 * painel executivo, entao trocar de tela preserva o recorte.
 */
export function PainelAnalitico({ tz }: { tz: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtros = useMemo(
    () => lerFiltrosAnalitico(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const problema = validarIntervalo(filtros);
  const contas = useContas();
  const dados = useAnalitico(filtros);

  /**
   * Ultimo estado JA PEDIDO, atualizado de forma sincrona.
   *
   * `router.replace` e assincrono: duas mudancas dentro do mesmo intervalo
   * calculariam ambas a partir da URL antiga, e a segunda apagaria a primeira.
   */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    filtrosRef.current = filtros;
  }, [filtros]);

  const aplicar = useCallback(
    (mudanca: Partial<Filtros>) => {
      const proximo = aplicarMudanca(filtrosRef.current, mudanca);
      filtrosRef.current = proximo;

      const busca = escreverFiltrosAnalitico(proximo).toString();
      router.replace(busca ? `${pathname}?${busca}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const limpar = useCallback(() => {
    filtrosRef.current = { ...PADRAO_ANALITICO };
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const meta = dados.meta;
  const paginacao = meta?.paginacao;
  const periodo = meta?.periodo;
  const linhas = dados.linhas ?? [];
  const temFiltroDeRefino = Boolean(filtros.busca.trim() || filtros.regiao);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">
          Analítico de custos
        </h1>
        <p className="mt-2 text-sm text-veri-verde-escuro/70">
          Lançamento a lançamento, direto de <code>aws_daily_costs</code> · valores
          oficiais em USD · paginação no servidor
        </p>
      </div>

      {/* Filtros globais: os mesmos da visão executiva, e o recorte atravessa
          de uma tela para a outra. */}
      <BarraFiltros
        filtros={filtros}
        contas={contas}
        problema={problema}
        carregando={dados.carregandoPagina}
        aoMudar={aplicar}
        aoLimpar={limpar}
      />

      {/* Filtros de refino, próprios desta tela. */}
      <section
        aria-label="Filtros da tabela analítica"
        className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5"
      >
        <FiltrosAnalitico
          filtros={filtros}
          regioes={meta?.regioesDisponiveis ?? []}
          aoMudar={aplicar}
        />
      </section>

      {/* ------------------------------------------- periodo e recorte */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl bg-veri-verde/8 px-5 py-3 text-sm"
      >
        <p className="text-veri-verde-escuro">
          <span className="text-veri-verde-escuro/70">Período analisado: </span>
          <strong className="veri-numero font-medium">
            {periodo ? formatIntervalo(periodo.de, periodo.ate) : "—"}
          </strong>
          {periodo && (
            <span className="text-veri-verde-escuro/70">
              {" "}
              · {formatInteiro(periodo.dias)} dia(s) ·{" "}
              {/*
                Rotulo vem do preset ESCOLHIDO, nao de `periodo.rotulo` da API.
                Presets relativos sao traduzidos em datas antes de chegar ao
                endpoint (que so aceita startDate/endDate), entao o servidor os
                classifica como "personalizado" -- e a tela diria "Período
                personalizado" para quem clicou em "Mês anterior".
              */}
              {ROTULOS_PRESET[filtros.periodo]}
            </span>
          )}
        </p>
        <p className="text-veri-verde-escuro/70">
          {descreverFiltros(filtros, contas.dados?.length ?? null)}
          {meta?.geradoEm && (
            <span className="hidden sm:inline">
              {" "}
              · consultado às{" "}
              <span className="veri-numero">{formatDataHora(meta.geradoEm, tz)}</span>
            </span>
          )}
        </p>
      </div>

      {problema && (
        <Aviso tom="atencao" titulo="Intervalo inválido">
          <p>{problema.mensagem} A tabela mostra o último período válido.</p>
        </Aviso>
      )}

      {periodo?.limitadoPorDadoDisponivel && (
        <Aviso tom="info" titulo="O período foi encurtado até a última carga do ETL">
          <p>
            A janela termina em{" "}
            <strong className="font-medium">{formatDataDia(periodo.ate)}</strong>{" "}
            porque é até onde há dado carregado.
          </p>
        </Aviso>
      )}

      {/* ------------------------------------------------ total do filtro */}
      {paginacao && paginacao.total > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Total
            rotulo="Lançamentos no filtro"
            valor={formatInteiro(paginacao.total)}
            apoio={`em ${formatInteiro(paginacao.pages)} página(s) de ${formatInteiro(paginacao.pageSize)}`}
          />
          <Total
            rotulo="Soma em dólar"
            valor={formatUSD(meta?.somaUSD ?? 0)}
            apoio="valor oficial · todas as linhas do filtro"
            destaque
          />
          <Total
            rotulo="Soma estimada em real"
            valor={formatBRLEstimado(meta?.somaBRL ?? null)}
            apoio="estimativa · não use para contabilidade"
            fraco
          />
        </div>
      )}

      {/* ------------------------------------------------------- tabela */}
      <Card
        titulo="Lançamentos"
        descricao="Uma linha por conta, serviço, região e dia — como o ETL gravou."
      >
        {dados.erro ? (
          dados.erro.exigeLogin ? (
            <Aviso tom="critico" titulo="Sessão expirada">
              <p>
                Sua sessão não é mais válida.{" "}
                <a href="/login?next=%2Fdashboard%2Fanalitico" className="underline">
                  Entrar novamente
                </a>
                .
              </p>
            </Aviso>
          ) : (
            <ErroDoBloco
              mensagem={dados.erro.message}
              detalhes={dados.erro.detalhes}
              aoTentarNovamente={dados.recarregar}
            />
          )
        ) : dados.carregandoInicial ? (
          <CarregandoLinhas linhas={8} />
        ) : linhas.length === 0 ? (
          temFiltroDeRefino ? (
            <Vazio titulo="Nenhum lançamento para estes filtros">
              <p>
                Não há linha com{" "}
                {filtros.busca.trim() && (
                  <>
                    serviço contendo{" "}
                    <strong className="font-medium">“{filtros.busca.trim()}”</strong>
                  </>
                )}
                {filtros.busca.trim() && filtros.regiao && " e "}
                {filtros.regiao && (
                  <>
                    região{" "}
                    <strong className="font-medium">
                      {filtros.regiao === "nao-informado" ? "não informada" : filtros.regiao}
                    </strong>
                  </>
                )}{" "}
                no período. Os filtros de refino são cumulativos — tente remover um.
              </p>
            </Vazio>
          ) : (
            <Vazio titulo="Nenhum lançamento no período">
              <p>
                Pode ser custo realmente inexistente ou o ETL não ter carregado o
                período. Confira a última carga em <code>/diagnostico</code>.
              </p>
            </Vazio>
          )
        ) : (
          <>
            <TabelaAnalitica
              linhas={linhas}
              filtros={filtros}
              cotacao={meta?.cotacao}
              ocupado={dados.carregandoPagina}
              aoMudar={aplicar}
            />
            {paginacao && (
              <Paginacao
                pagina={paginacao.page}
                paginas={paginacao.pages}
                total={paginacao.total}
                tamanho={paginacao.pageSize}
                ocupado={dados.carregandoPagina}
                aoIr={(pagina) => aplicar({ pagina })}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Total({
  rotulo,
  valor,
  apoio,
  destaque,
  fraco,
}: {
  rotulo: string;
  valor: string;
  apoio: string;
  destaque?: boolean;
  fraco?: boolean;
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
      <p className="text-xs uppercase tracking-wide text-veri-verde-escuro/60">
        {rotulo}
      </p>
      <p
        className={[
          "veri-numero mt-2 text-2xl",
          fraco ? "text-veri-verde-escuro/70" : "veri-display text-veri-verde-escuro",
        ].join(" ")}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-veri-verde-escuro/70">{apoio}</p>
    </div>
  );
}
