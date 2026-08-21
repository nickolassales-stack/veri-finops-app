"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { BarrasHorizontais, type ItemBarra } from "@/components/charts/barras-horizontais";
import { DistribuicaoServicosChart } from "@/components/charts/distribuicao-servicos-chart";
import { MensalOvhChart } from "@/components/charts/mensal-ovh-chart";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { Carregando, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { Num, VisaoTabela } from "@/components/ui/visao-tabela";
import {
  descreverFiltrosOvh,
  escreverFiltrosOvh,
  lerFiltrosOvh,
  validarIntervaloOvh,
  FILTROS_OVH_PADRAO,
  type FiltrosOvh,
} from "@/lib/dashboard/filtros-ovh";
import { ROTULO_FONTE } from "@/lib/dashboard/ovh";
import type { MetaOvh } from "@/lib/dashboard/tipos-ovh";
import { useDashboardOvh } from "@/lib/dashboard/use-dashboard-ovh";
import type { Recurso } from "@/lib/dashboard/use-dashboard";
import {
  formatDataDia,
  formatDataHora,
  formatInteiro,
  formatMoeda,
  formatParticipacao,
} from "@/lib/format";

import { CardsKpiOvh } from "./cards-kpi-ovh";
import { FiltrosOvhBarra } from "./filtros-ovh";
import { SeletorVisao } from "./seletor-visao";

/**
 * Visao executiva OVH.
 *
 * ARQUITETURA: identica a da visao AWS -- nada aqui toca no PostgreSQL. Todo
 * dado chega pelos endpoints protegidos (`/api/dashboard/ovh/*`), que validam a
 * sessao contra o banco antes de responder. A credencial nunca sai do servidor,
 * e nenhuma chave da OVH existe no bundle do navegador.
 *
 * A URL e o estado, tambem igual: trocar filtro reescreve a query string, e a
 * query string alimenta as requisicoes.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA NAO FAZ, DE PROPOSITO
 *
 * Nao soma nada com a AWS. Os dois provedores tem naturezas diferentes -- a AWS
 * e DIARIA e por uso, a OVH e MENSAL e faturada -- e um total combinado nao
 * responderia nem "quanto consumi" nem "quanto vou pagar". A consolidacao
 * multi-cloud e fase futura, e depende de duas decisoes de negocio que ainda
 * nao foram tomadas: a moeda de referencia e qual origem OVH representa custo
 * realizado quando comparada ao dia da AWS.
 * ---------------------------------------------------------------------------
 */
export function PainelExecutivoOvh({ tz }: { tz: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtros = useMemo(
    () => lerFiltrosOvh(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const problema = validarIntervaloOvh(filtros);
  const dados = useDashboardOvh(filtros);

  /**
   * Ultimo estado JA PEDIDO, mesmo que a URL ainda nao tenha mudado.
   *
   * `router.replace` e assincrono: duas mudancas dentro do intervalo entre a
   * chamada e a nova `searchParams` calculariam ambas a partir da URL antiga, e
   * a segunda apagaria a primeira. Mesma razao do painel AWS.
   */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    filtrosRef.current = filtros;
  }, [filtros]);

  const aplicar = useCallback(
    (mudanca: Partial<FiltrosOvh>) => {
      const proximo = { ...filtrosRef.current, ...mudanca };

      // Trocar de preset limpa os meses soltos: a API recusa `deMes`/`ateMes`
      // junto de qualquer preset que nao seja "personalizado".
      if (mudanca.periodo && mudanca.periodo !== "personalizado") {
        proximo.deMes = "";
        proximo.ateMes = "";
      }

      // Trocar de ORIGEM limpa o projeto: o conjunto de projetos com custo muda
      // entre origens, e um projeto que existe em `invoice` pode nao existir em
      // `usage_current`. Mantido, o filtro devolveria vazio com cara de "este
      // projeto nao gastou".
      if (mudanca.source && mudanca.source !== filtrosRef.current.source) {
        proximo.projeto = "";
      }

      filtrosRef.current = proximo;

      const busca = escreverFiltrosOvh(proximo).toString();
      router.replace(`${pathname}?${busca}`, { scroll: false });
    },
    [pathname, router],
  );

  const limpar = useCallback(() => {
    filtrosRef.current = { ...FILTROS_OVH_PADRAO };
    router.replace(`${pathname}?provider=ovh`, { scroll: false });
  }, [pathname, router]);

  const meta = dados.meta;
  const moeda = meta?.filtros.moeda ?? null;
  const formatar = useCallback(
    (v: unknown) => (moeda ? formatMoeda(v, moeda) : "—"),
    [moeda],
  );

  const projetosDisponiveis = dados.metaProjetos?.projetosDisponiveis ?? [];
  const nomeDoProjeto =
    projetosDisponiveis.find((p) => p.servicoDoProjeto === filtros.projeto)?.nome ?? null;

  const ausencia = meta?.ausencia;
  const estado = meta?.estado;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- cabecalho */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="veri-display text-3xl text-veri-verde-escuro">
            Visão executiva
          </h1>
          <SeletorVisao atual="ovh" />
        </div>
        <p className="mt-2 text-sm text-texto-suave">
          Custos OVH consolidados ·{" "}
          {/*
            O rotulo da moeda vem do SERVIDOR, nunca fixo no texto.
            `ovh_monthly_costs.currency` e por linha e o DDL tem default 'EUR' --
            escrever "USD" aqui faria a tela afirmar a moeda em vez de reporta-la,
            e a afirmacao ficaria errada no dia em que uma conta europeia entrar.
          */}
          {moeda ? (
            <>
              valores faturados em <span className="veri-numero">{moeda}</span>
            </>
          ) : (
            "moeda conforme a fatura"
          )}{" "}
          · origem {ROTULO_FONTE[filtros.source].toLowerCase()} OVH
        </p>
      </div>

      <FiltrosOvhBarra
        filtros={filtros}
        problema={problema}
        projetos={projetosDisponiveis}
        fontesComDado={meta?.disponibilidade.fontesComDado ?? []}
        carregando={dados.carregando}
        aoMudar={aplicar}
        aoLimpar={limpar}
      />

      {/* ------------------------------------------------ periodo em vigor */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-xl bg-veri-verde/8 px-5 py-3 text-sm"
      >
        <p className="text-veri-verde-escuro">
          <span className="text-texto-suave">Período analisado: </span>
          <strong className="veri-numero font-medium">
            {meta ? `${meta.periodo.deMes} a ${meta.periodo.ateMes}` : "—"}
          </strong>
          {meta && (
            <span className="text-texto-suave">
              {" "}
              · {formatInteiro(meta.periodo.meses)} mês(es) · {meta.periodo.rotulo}
            </span>
          )}
          {problema && (
            <span className="text-veri-vinho"> · intervalo informado é inválido</span>
          )}
        </p>
        <p className="text-texto-suave">
          {descreverFiltrosOvh(filtros, nomeDoProjeto)}
          {meta?.geradoEm && (
            <span className="hidden sm:inline">
              {" "}
              · consultado às{" "}
              <span className="veri-numero">{formatDataHora(meta.geradoEm, tz)}</span>
            </span>
          )}
        </p>
      </div>

      {/* --------------------------------------------------------- avisos */}
      {dados.erroGlobal?.exigeLogin && (
        <Aviso tom="critico" titulo="Sessão expirada">
          <p>
            Sua sessão não é mais válida.{" "}
            <a href="/login?next=%2Fdashboard%3Fprovider%3Dovh" className="underline">
              Entrar novamente
            </a>
            .
          </p>
        </Aviso>
      )}

      {(meta?.avisos ?? []).map((aviso) => (
        <Aviso key={aviso.codigo} tom="atencao" titulo="Atenção ao recorte">
          <p>{aviso.mensagem}</p>
        </Aviso>
      ))}

      {problema && (
        <Aviso tom="atencao" titulo="Intervalo inválido">
          <p>{problema.mensagem} Os números abaixo são do último período válido.</p>
        </Aviso>
      )}

      {/*
        Fatura sem `billing_month` no banco nao casa com NENHUM filtro de
        periodo -- ela desaparece de todas as janelas em silencio. Sem este
        aviso, a tela diria "3 faturas no periodo" com 4 no banco.
      */}
      {(dados.metaFaturas?.semMesAtribuido ?? 0) > 0 && (
        <Aviso tom="atencao" titulo="Há fatura sem mês de competência">
          <p>
            <strong className="font-medium">
              {formatInteiro(dados.metaFaturas?.semMesAtribuido)}
            </strong>{" "}
            fatura(s) no banco estão com <code className="veri-numero">billing_month</code>{" "}
            nulo. Elas <strong className="font-medium">não aparecem</strong> em nenhum
            filtro de período — nem neste — porque não há mês pelo qual filtrá-las. O
            número de faturas acima é o da janela, não o total do banco.
          </p>
        </Aviso>
      )}

      {/* Estado de ausencia: dito UMA vez, no topo, em vez de repetido em cada
          card vazio abaixo. */}
      {estado && estado !== "ok" && ausencia?.mensagem && (
        <Aviso
          tom={estado === "sem-integracao" ? "info" : "atencao"}
          titulo={ausencia.mensagem}
        >
          {ausencia.detalhe && <p>{ausencia.detalhe}</p>}
        </Aviso>
      )}

      {/* ----------------------------------------------------------- KPIs */}
      <CardsKpiOvh
        resumo={dados.resumo.dados}
        sincronizacao={dados.sincronizacao.dados}
        meta={meta}
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

      {/* -------------------------------------------------- evolucao mensal */}
      <Card
        titulo="Evolução mensal do custo faturado"
        descricao="Um ponto por mês de competência. Mês sem fatura interrompe a linha — lacuna é diferente de custo zero."
      >
        <BlocoOvh
          recurso={dados.mensal}
          carregando={dados.carregando}
          vazio={(serie) => serie.every((p) => p.total === null)}
          aoRecarregar={dados.recarregar}
          ausencia={ausencia}
        >
          {(serie) =>
            moeda ? <MensalOvhChart dados={serie} moeda={moeda} /> : null
          }
        </BlocoOvh>
      </Card>

      {/* ------------------------------------------------------ top servicos */}
      <Card
        titulo="Maiores serviços por custo"
        descricao={
          dados.metaServicos?.servicosNaJanela
            ? `Top ${(dados.servicos.dados ?? []).length} de ${dados.metaServicos.servicosNaJanela} serviços com custo no período.`
            : "Ranking de serviços OVH no período."
        }
      >
        <BlocoOvh
          recurso={dados.servicos}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          ausencia={ausencia}
        >
          {(itens) => (
            <>
              <BarrasHorizontais
                nomeSerie="Custo no período"
                larguraRotulo={180}
                formatar={formatar}
                itens={itens.map<ItemBarra>((s) => ({
                  rotulo: s.servico,
                  valor: s.total,
                }))}
              />
              <VisaoTabela
                colunas={[
                  { titulo: "Serviço" },
                  { titulo: "Categoria" },
                  { titulo: "Custo", alinharDireita: true },
                  { titulo: "Participação", alinharDireita: true },
                  { titulo: "Linhas", alinharDireita: true },
                ]}
              >
                {itens.map((s) => (
                  <tr
                    key={s.servico}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="py-2 pr-4">{s.servico}</td>
                    <td className="py-2 pr-4 text-texto-suave">
                      {/*
                        `null` quando o rotulo aparece em mais de uma categoria.
                        Mostrar uma das varias afirmaria uma classificacao que o
                        dado nao sustenta.
                      */}
                      {s.categoria ?? "—"}
                    </td>
                    <Num>{formatar(s.total)}</Num>
                    <Num>{formatParticipacao(s.participacao)}</Num>
                    <Num>{formatInteiro(s.linhas)}</Num>
                  </tr>
                ))}
              </VisaoTabela>
            </>
          )}
        </BlocoOvh>
      </Card>

      {/* ------------------------------------------------- custo por projeto */}
      <Card
        titulo="Custo por projeto OVH"
        descricao="Projetos Public Cloud. O custo de fatura que a OVH não atribui a projeto aparece em linha própria."
      >
        <BlocoOvh
          recurso={dados.projetos}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          ausencia={ausencia}
        >
          {(itens) => (
            <>
              <BarrasHorizontais
                nomeSerie="Custo no período"
                larguraRotulo={180}
                formatar={formatar}
                itens={itens.map<ItemBarra>((p) => ({
                  rotulo: p.semProjeto ? "Sem projeto atribuído" : (p.nome ?? p.servicoDoProjeto),
                  valor: p.total,
                  // Hachura na linha sem projeto: ela nao e um projeto, e sim o
                  // resto da fatura. Mesmo tratamento que "Outros" recebe.
                  textura: p.semProjeto,
                }))}
              />
              <VisaoTabela
                colunas={[
                  { titulo: "Projeto" },
                  { titulo: "Custo", alinharDireita: true },
                  { titulo: "Participação", alinharDireita: true },
                  { titulo: "Linhas", alinharDireita: true },
                ]}
              >
                {itens.map((p) => (
                  <tr
                    key={p.servicoDoProjeto || "sem-projeto"}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="py-2 pr-4">
                      {p.semProjeto ? (
                        <>
                          <span className="font-medium">Sem projeto atribuído</span>
                          <span className="block text-xs text-texto-suave">
                            custo de fatura — taxa, assinatura, item não vinculado a
                            projeto
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{p.nome}</span>
                          <span className="veri-numero block text-xs text-texto-suave">
                            {p.servicoDoProjeto}
                          </span>
                        </>
                      )}
                    </td>
                    <Num>{formatar(p.total)}</Num>
                    <Num>{formatParticipacao(p.participacao)}</Num>
                    <Num>{formatInteiro(p.linhas)}</Num>
                  </tr>
                ))}
              </VisaoTabela>
            </>
          )}
        </BlocoOvh>
      </Card>

      {/* -------------------------------------------- distribuicao percentual */}
      <Card
        titulo="Distribuição percentual por serviço"
        descricao="Participação de cada serviço no custo total do período."
      >
        <BlocoOvh
          recurso={dados.servicos}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          ausencia={ausencia}
        >
          {(itens) => (
            <DistribuicaoServicosChart
              itens={itens.map((s) => ({ servico: s.servico, total: s.total }))}
              outros={dados.metaServicos?.outros ?? 0}
              totalDaJanela={dados.metaServicos?.totalDaJanela ?? 0}
              formatar={formatar}
            />
          )}
        </BlocoOvh>
      </Card>

      {/* -------------------------------------------- historico de faturas */}
      <Card
        titulo="Histórico de faturas"
        descricao="Cabeçalhos importados de ovh_invoice_headers. Cada fatura exibe a própria moeda — faturas de moedas diferentes não são somadas."
      >
        <BlocoOvh
          recurso={dados.faturas}
          carregando={dados.carregando}
          vazio={(itens) => itens.length === 0}
          aoRecarregar={dados.recarregar}
          ausencia={ausencia}
          mensagemVazio="Nenhuma fatura OVH com mês de competência no período."
        >
          {(itens) => (
            <>
              <VisaoTabela
                colunas={[
                  { titulo: "Fatura" },
                  { titulo: "Competência" },
                  { titulo: "Emissão" },
                  { titulo: "Sem imposto", alinharDireita: true },
                  { titulo: "Imposto", alinharDireita: true },
                  { titulo: "Total", alinharDireita: true },
                  { titulo: "Linhas", alinharDireita: true },
                ]}
              >
                {itens.map((f) => (
                  <tr
                    key={f.billId}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="veri-numero py-2 pr-4">{f.billId}</td>
                    <td className="veri-numero py-2 pr-4">{f.billingMonth ?? "—"}</td>
                    <td className="veri-numero py-2 pr-4">
                      {f.billDate ? formatDataDia(f.billDate) : "—"}
                    </td>
                    {/* A moeda vem POR FATURA, e nao da escolha do recorte: o
                        cabecalho tem `currency` proprio. */}
                    <Num>{formatMoeda(f.totalSemImposto, f.moeda)}</Num>
                    <Num>{formatMoeda(f.imposto, f.moeda)}</Num>
                    <Num>{formatMoeda(f.totalComImposto, f.moeda)}</Num>
                    <Num>{formatInteiro(f.linhas)}</Num>
                  </tr>
                ))}
              </VisaoTabela>

              {dados.metaFaturas?.truncado && (
                <p className="mt-3 rounded-lg bg-veri-offwhite px-4 py-2.5 text-sm text-texto-suave">
                  A lista está limitada às{" "}
                  <span className="veri-numero">{dados.metaFaturas.limite}</span> faturas
                  mais recentes do período. Reduza a janela para ver as demais.
                </p>
              )}
            </>
          )}
        </BlocoOvh>
      </Card>
    </div>
  );
}

/**
 * Envelope de estado de um bloco OVH.
 *
 * Difere do `BlocoRecurso` da visao AWS em uma coisa, e ela e a razao de existir
 * separado: o texto do vazio vem do SERVIDOR (`meta.ausencia`), porque so o
 * servidor sabe QUAL das quatro ausencias aconteceu -- sem integracao, sem
 * nenhuma importacao, origem que a API nao devolve, ou janela sem linha. Cada
 * uma tem uma acao diferente do outro lado, e o cliente nao tem como distinguir.
 */
function BlocoOvh<T>({
  recurso,
  carregando,
  vazio,
  aoRecarregar,
  ausencia,
  mensagemVazio,
  children,
}: {
  recurso: Recurso<T>;
  carregando: boolean;
  vazio: (dados: T) => boolean;
  aoRecarregar: () => void;
  ausencia: MetaOvh["ausencia"] | undefined;
  mensagemVazio?: string;
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
    return carregando ? (
      <Carregando />
    ) : (
      <Vazio titulo={mensagemVazio ?? "Sem dado para exibir"} />
    );
  }

  if (vazio(recurso.dados)) {
    return (
      <Vazio titulo={ausencia?.mensagem ?? mensagemVazio ?? "Sem dado no período"}>
        {ausencia?.detalhe ? (
          <p>{ausencia.detalhe}</p>
        ) : (
          <p>
            Ausência de dado <strong className="font-medium">não é custo zero</strong>.
            Confira a última sincronização nos indicadores acima.
          </p>
        )}
      </Vazio>
    );
  }

  return <>{children(recurso.dados)}</>;
}
