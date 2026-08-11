"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BarrasHorizontais, type ItemBarra } from "@/components/charts/barras-horizontais";
import { DiarioPorServicoChart } from "@/components/charts/diario-por-servico-chart";
import { DistribuicaoServicosChart } from "@/components/charts/distribuicao-servicos-chart";
import { EvolucaoDiariaChart } from "@/components/charts/evolucao-diaria-chart";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { Carregando, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { Num, VisaoTabela } from "@/components/ui/visao-tabela";
import {
  descreverFiltros,
  escreverFiltros,
  lerFiltros,
  validarIntervalo,
  type FiltrosDashboard,
} from "@/lib/dashboard/filtros";
import { useContas, useDashboard, type Recurso } from "@/lib/dashboard/use-dashboard";
import {
  formatDataDia,
  formatDataHora,
  formatInteiro,
  formatIntervalo,
  formatParticipacao,
  formatUSD,
  formatVariacao,
} from "@/lib/format";

import { BarraFiltros } from "./barra-filtros";
import { CardsKpi } from "./cards-kpi";

/**
 * Painel executivo.
 *
 * ARQUITETURA: nada aqui toca no PostgreSQL. Todo dado chega pelos endpoints
 * protegidos (`/api/dashboard/*`), que validam a sessao contra o banco antes de
 * responder. A credencial do banco nunca sai do servidor.
 *
 * A URL e o estado. Trocar filtro reescreve a query string, e a query string
 * alimenta as requisicoes -- por isso o link e compartilhavel e o botao voltar
 * do navegador desfaz o filtro.
 */
export function PainelExecutivo({ tz }: { tz: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtros = useMemo(
    () => lerFiltros(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const problema = validarIntervalo(filtros);
  const contas = useContas();
  const dados = useDashboard(filtros);

  /**
   * Ultimo estado de filtro JA PEDIDO, mesmo que a URL ainda nao tenha mudado.
   *
   * `router.replace` e assincrono: entre a chamada e a nova `searchParams` chegar
   * ha um intervalo. Duas mudancas dentro desse intervalo -- preencher "de" e
   * "ate" em seguida, por exemplo -- calculariam ambas a partir da URL antiga, e
   * a segunda apagaria a primeira. Este ref e atualizado de forma sincrona, por
   * isso a mudanca seguinte sempre parte do estado correto.
   */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    // Ressincroniza quando a URL muda por fora: botao voltar, link colado.
    filtrosRef.current = filtros;
  }, [filtros]);

  const aplicar = useCallback(
    (mudanca: Partial<FiltrosDashboard>) => {
      const proximo = { ...filtrosRef.current, ...mudanca };

      // Trocar de preset limpa as datas soltas: a API recusa `de`/`ate` junto
      // de qualquer preset que nao seja "personalizado".
      if (mudanca.periodo && mudanca.periodo !== "personalizado") {
        proximo.de = "";
        proximo.ate = "";
      }

      filtrosRef.current = proximo;

      const busca = escreverFiltros(proximo).toString();
      // `replace` e nao `push`: mexer no filtro nao deve empilhar uma entrada de
      // historico por clique. `scroll: false` mantem a posicao da pagina.
      router.replace(busca ? `${pathname}?${busca}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const limpar = useCallback(() => {
    filtrosRef.current = { periodo: "mes-atual", de: "", ate: "", contas: [] };
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  const periodo = dados.meta?.periodo;
  const avisos = dados.meta?.avisos ?? [];

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- cabecalho */}
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">
          Visão executiva
        </h1>
        <p className="mt-2 text-sm text-veri-verde-escuro/70">
          Custos AWS consolidados · valores oficiais em{" "}
          <abbr title="dólar norte-americano" className="no-underline">
            USD
          </abbr>
          , conforme a origem do CUR
        </p>
      </div>

      <BarraFiltros
        filtros={filtros}
        contas={contas}
        problema={problema}
        carregando={dados.carregando}
        aoMudar={aplicar}
        aoLimpar={limpar}
      />

      {/* -------------------------------------------- periodo em vigor */}
      <PeriodoAplicado
        filtros={filtros}
        periodo={periodo}
        totalDeContas={contas.dados?.length ?? null}
        problema={Boolean(problema)}
        tz={tz}
        geradoEm={dados.meta?.geradoEm ?? null}
      />

      {/* --------------------------------------------- avisos de integridade */}
      {dados.erroGlobal?.exigeLogin && (
        <Aviso tom="critico" titulo="Sessão expirada">
          <p>
            Sua sessão não é mais válida.{" "}
            <a href="/login?next=%2Fdashboard" className="underline">
              Entrar novamente
            </a>
            .
          </p>
        </Aviso>
      )}

      {avisos.map((aviso) => (
        <Aviso key={aviso.codigo} tom="atencao" titulo="Atenção ao filtro">
          <p>{aviso.mensagem}</p>
        </Aviso>
      ))}

      {periodo?.limitadoPorDadoDisponivel && (
        <Aviso tom="info" titulo="O período foi encurtado até a última carga do ETL">
          <p>
            A janela termina em{" "}
            <strong className="font-medium">{formatDataDia(periodo.ate)}</strong> porque é
            até onde há dado carregado. Sem esse corte, o gráfico exibiria dias zerados
            no fim — que pareceriam queda de consumo, não ausência de carga.
          </p>
        </Aviso>
      )}

      {periodo?.existeDadoAlemDaJanela && (
        <Aviso tom="info" titulo="Há custo lançado além do período">
          <p>
            A base tem registros com data posterior a{" "}
            <strong className="font-medium">{formatDataDia(periodo.ate)}</strong> — típico
            de cobrança anual lançada adiantado. Esse valor não entra em nenhum número
            desta tela.
          </p>
        </Aviso>
      )}

      {problema && (
        <Aviso tom="atencao" titulo="Intervalo inválido">
          <p>{problema.mensagem} Os números abaixo são do último período válido.</p>
        </Aviso>
      )}

      {/* --------------------------------------------------------- KPIs */}
      <CardsKpi
        resumo={dados.resumo.dados}
        meta={dados.meta}
        carregando={dados.carregando}
        tz={tz}
      />

      {dados.resumo.erro && !dados.resumo.erro.exigeLogin && (
        <ErroDoBloco
          titulo="Não foi possível carregar os indicadores"
          mensagem={dados.resumo.erro.message}
          detalhes={dados.resumo.erro.detalhes}
          aoTentarNovamente={dados.recarregar}
        />
      )}

      {/* ------------------------------------------------ custo por conta */}
      <Card
        titulo="Custo por conta AWS"
        descricao="Comparação com o período anterior equivalente. Conta sem carga aparece como “sem dado”, não como zero."
      >
        <BlocoRecurso
          recurso={dados.porConta}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          mensagemVazio="Nenhuma conta teve custo no período selecionado."
        >
          {(itens) => (
            <>
              {/*
                Somente contas COM dado entram no grafico. Uma conta sem carga
                viraria barra de comprimento zero -- invisivel, indistinguivel de
                "gastou zero" e ocupando uma linha do eixo. A ausencia e dita em
                texto abaixo, que e a forma honesta de mostrar o que nao existe.
              */}
              <BarrasHorizontais
                nomeSerie="Custo no período"
                larguraRotulo={170}
                itens={itens
                  .filter((c) => c.temDadoNaJanela)
                  .map<ItemBarra>((c) => ({
                    rotulo: c.accountName,
                    valor: c.total,
                  }))}
              />

              {itens.some((c) => !c.temDadoNaJanela) && (
                <p className="mt-3 rounded-lg bg-veri-offwhite px-4 py-2.5 text-sm text-veri-verde-escuro/75">
                  <strong className="font-medium">Sem dado no período:</strong>{" "}
                  {itens
                    .filter((c) => !c.temDadoNaJanela)
                    .map((c) => `${c.accountName} (${c.accountId})`)
                    .join(", ")}
                  . Não é custo zero — é ausência de carga do ETL, então essas contas
                  não aparecem no gráfico.
                </p>
              )}

              <VisaoTabela
                colunas={[
                  { titulo: "Conta" },
                  { titulo: "Unidade" },
                  { titulo: "Período", alinharDireita: true },
                  { titulo: "Anterior", alinharDireita: true },
                  { titulo: "Variação", alinharDireita: true },
                  { titulo: "Participação", alinharDireita: true },
                ]}
              >
                {itens.map((c) => (
                  <tr
                    key={c.accountId}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="py-2 pr-4">
                      <span className="font-medium">{c.accountName}</span>
                      <span className="veri-numero block text-xs text-veri-verde-escuro/60">
                        {c.accountId}
                        {!c.cadastrada && " · fora do cadastro"}
                        {c.cadastrada && !c.active && " · inativa"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-veri-verde-escuro/70">
                      {c.businessUnit ?? "—"}
                    </td>
                    <Num>
                      {c.temDadoNaJanela ? (
                        formatUSD(c.total)
                      ) : (
                        <span className="text-veri-verde-escuro/50">sem dado</span>
                      )}
                    </Num>
                    <Num>{formatUSD(c.totalAnterior)}</Num>
                    <Num>{formatVariacao(c.variacao)}</Num>
                    <Num>{formatParticipacao(c.participacao)}</Num>
                  </tr>
                ))}
              </VisaoTabela>
            </>
          )}
        </BlocoRecurso>
      </Card>

      {/* --------------------------------------------------- top servicos */}
      <Card
        titulo="Maiores serviços por custo"
        descricao={
          dados.metaServicos?.servicosNaJanela
            ? `Top ${(dados.servicos.dados ?? []).length} de ${dados.metaServicos.servicosNaJanela} serviços com custo no período.`
            : "Ranking de serviços no período."
        }
      >
        <BlocoRecurso
          recurso={dados.servicos}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          mensagemVazio="Nenhum serviço com custo acima de zero no período."
        >
          {(itens) => (
            <>
              <BarrasHorizontais
                nomeSerie="Custo no período"
                larguraRotulo={160}
                itens={itens.map<ItemBarra>((s) => ({
                  rotulo: s.servico,
                  valor: s.total,
                }))}
              />
              <VisaoTabela
                colunas={[
                  { titulo: "Serviço" },
                  { titulo: "Período", alinharDireita: true },
                  { titulo: "Anterior", alinharDireita: true },
                  { titulo: "Variação", alinharDireita: true },
                  { titulo: "Participação", alinharDireita: true },
                ]}
              >
                {itens.map((s) => (
                  <tr
                    key={s.servico}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="py-2 pr-4">{s.servico}</td>
                    <Num>{formatUSD(s.total)}</Num>
                    <Num>{formatUSD(s.totalAnterior)}</Num>
                    <Num>{formatVariacao(s.variacao)}</Num>
                    <Num>{formatParticipacao(s.participacao)}</Num>
                  </tr>
                ))}
              </VisaoTabela>
            </>
          )}
        </BlocoRecurso>
      </Card>

      {/* ----------------------------------------------- evolucao diaria */}
      <Card
        titulo="Evolução diária dos custos"
        descricao={
          dados.meta?.diasSemDado
            ? "A linha se interrompe nos dias sem carga do ETL — lacuna é diferente de custo zero."
            : "Soma diária no período selecionado."
        }
      >
        <BlocoRecurso
          recurso={dados.diario}
          carregando={dados.carregando}
          vazio={(serie) => serie.length === 0 || serie.every((p) => p.semDado)}
          aoRecarregar={dados.recarregar}
          mensagemVazio="Nenhum dia do período tem dado carregado."
        >
          {(serie) => <EvolucaoDiariaChart dados={serie} />}
        </BlocoRecurso>
      </Card>

      {/* -------------------------------------- evolucao diaria por servico */}
      <Card
        titulo="Evolução diária por serviço"
        descricao="Um quadro por serviço, em escala compartilhada. Serviços fora do topo entram agrupados em “Outros”."
      >
        <BlocoRecurso
          recurso={dados.diarioPorServico}
          carregando={dados.carregando}
          vazio={(d) => d.series.length === 0}
          aoRecarregar={dados.recarregar}
          mensagemVazio="Nenhum serviço com custo no período."
        >
          {(d) => <DiarioPorServicoChart dados={d} />}
        </BlocoRecurso>
      </Card>

      {/* ---------------------------------------- distribuicao percentual */}
      <Card
        titulo="Distribuição percentual por serviço"
        descricao="Participação de cada serviço no custo total do período."
      >
        <BlocoRecurso
          recurso={dados.servicos}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          mensagemVazio="Nenhum serviço com custo no período."
        >
          {(itens) => (
            <DistribuicaoServicosChart
              itens={itens}
              outros={dados.metaServicos?.outros ?? 0}
              totalDaJanela={dados.metaServicos?.totalDaJanela ?? 0}
            />
          )}
        </BlocoRecurso>
      </Card>
    </div>
  );
}

/**
 * Envelope de estado de um bloco: carregando, erro, vazio ou conteudo.
 *
 * Existe para que cada card resolva o proprio estado sem repetir a arvore de
 * `if` cinco vezes -- e para que uma falha isolada nao apague o painel inteiro.
 */
function BlocoRecurso<T>({
  recurso,
  carregando,
  vazio,
  mensagemVazio,
  aoRecarregar,
  children,
}: {
  recurso: Recurso<T>;
  carregando: boolean;
  vazio: (dados: T) => boolean;
  mensagemVazio: string;
  aoRecarregar: () => void;
  children: (dados: T) => React.ReactNode;
}) {
  if (recurso.erro) {
    if (recurso.erro.exigeLogin) return null;
    return (
      <ErroDoBloco
        mensagem={recurso.erro.message}
        detalhes={recurso.erro.detalhes}
        aoTentarNovamente={aoRecarregar}
      />
    );
  }

  if (!recurso.dados) {
    return carregando ? <Carregando /> : <Vazio titulo={mensagemVazio} />;
  }

  if (vazio(recurso.dados)) {
    return (
      <Vazio titulo={mensagemVazio}>
        <p>
          Isso pode ser custo realmente inexistente ou o ETL não ter carregado o
          período. Confira a última carga em <code>/diagnostico</code>.
        </p>
      </Vazio>
    );
  }

  return <>{children(recurso.dados)}</>;
}

/** Faixa que diz, em texto, exatamente qual janela e qual recorte estao valendo. */
function PeriodoAplicado({
  filtros,
  periodo,
  totalDeContas,
  problema,
  tz,
  geradoEm,
}: {
  filtros: FiltrosDashboard;
  periodo: { de: string; ate: string; dias: number; rotulo: string } | undefined;
  totalDeContas: number | null;
  problema: boolean;
  tz: string;
  geradoEm: string | null;
}) {
  return (
    <div
      // `aria-live`: quem usa leitor de tela precisa ouvir a janela mudar ao
      // trocar o filtro, senao os numeros trocam sem contexto.
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
            · {formatInteiro(periodo.dias)} dia(s) · {periodo.rotulo}
          </span>
        )}
        {problema && (
          <span className="text-veri-vinho"> · intervalo informado é inválido</span>
        )}
      </p>
      <p className="text-veri-verde-escuro/70">
        {descreverFiltros(filtros, totalDeContas)}
        {geradoEm && (
          <span className="hidden sm:inline">
            {" "}
            · consultado às{" "}
            <span className="veri-numero">{formatDataHora(geradoEm, tz)}</span>
          </span>
        )}
      </p>
    </div>
  );
}
