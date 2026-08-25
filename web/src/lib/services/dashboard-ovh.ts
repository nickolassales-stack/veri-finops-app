import "server-only";

import { analisar } from "@/lib/api/http";
import {
  decidirEstadoDado,
  detalheDeAusencia,
  escolherMoeda,
  mensagemDeAusencia,
  podeEstimarBRL,
  type EstadoDadoOvh,
} from "@/lib/dashboard/ovh";
import { lerParametros } from "@/lib/filtros/esquemas";
import {
  esquemaDashboardOvh,
  type EntradaDashboardOvh,
} from "@/lib/filtros/esquemas-ovh";
import {
  mesDe,
  resolverPeriodoMensal,
  type PeriodoMensalResolvido,
} from "@/lib/filtros/periodo-mensal";
import {
  avisoCadastroVazio,
  avisoContasDesconhecidas,
  avisoCustoForaDoCadastro,
  resolverRecorteContasOvh,
  type RecorteContasOvh,
} from "@/lib/dashboard/recorte-contas-ovh";
import {
  contarLinhasForaDoCadastroOvh,
  getContasOvhDoCadastro,
  getDisponibilidadeOvh,
  ovhInstaladoNoBanco,
  type ContaOvhDoCadastro,
  type DisponibilidadeOvh,
  type FiltroOvh,
} from "@/lib/queries/dashboard-ovh";
import { diaEm } from "@/lib/tempo/calendario";

/**
 * Traducao de "o que veio na URL" para "o que a query OVH aceita".
 *
 * Um unico lugar faz isso para os seis endpoints da visao OVH, pelo mesmo motivo
 * de `filtro-custo.ts` fazer para os cinco da AWS: se cada rota resolvesse o
 * periodo e escolhesse a moeda por conta propria, dois cards da mesma tela
 * poderiam mostrar janelas -- ou moedas -- diferentes.
 *
 * ---------------------------------------------------------------------------
 * DUAS COISAS QUE ESTE MODULO DECIDE, E QUE A ROTA NAO PODE DECIDIR SOZINHA
 *
 * 1. A MOEDA. `ovh_monthly_costs.currency` e por linha. Somar moedas produz um
 *    numero sem significado, e converter exigiria uma taxa EUR/USD que o portal
 *    nao tem -- a cotacao que ele consulta no Banco Central e USD/BRL. Entao a
 *    moeda e ESCOLHIDA (a de maior volume, ou a pedida na URL) e as outras
 *    aparecem na tela com o proprio valor, nunca somadas.
 *
 * 2. O ESTADO DO DADO. Quatro ausencias diferentes, cada uma com uma acao
 *    diferente do outro lado -- ver `dashboard/ovh.ts`. A rota recebe o estado
 *    ja decidido e nao tem como exibir "0,00" onde a verdade e "sem dado".
 * ---------------------------------------------------------------------------
 */

export type FiltroOvhResolvido = {
  entrada: EntradaDashboardOvh;
  periodo: PeriodoMensalResolvido;
  /**
   * `null` quando nao ha moeda a consultar -- sem integracao, sem dado, ou
   * janela vazia. A rota que receber `null` NAO deve consultar custo: nao ha
   * total a somar, e um `sum()` sobre conjunto vazio devolveria NULL que
   * viraria zero na serializacao.
   */
  filtro: FiltroOvh | null;
  estado: EstadoDadoOvh;
  /** `true` quando a estimativa em BRL pode ser calculada (moeda USD). */
  podeBRL: boolean;
  meta: Record<string, unknown>;
};

export async function resolverFiltroOvh(
  url: URL,
  tz: string,
): Promise<FiltroOvhResolvido> {
  const entrada = analisar(esquemaDashboardOvh, lerParametros(url));

  // "Hoje" no fuso de apresentacao, e nao em UTC: um relatorio brasileiro vira
  // o mes as 00:00 em America/Sao_Paulo. Em UTC, o dia 1 as 21:00 do dia
  // anterior ja seria o mes novo, e a janela de 12 meses andaria um mes antes
  // da hora.
  const hoje = diaEm(tz, new Date());
  const periodo = resolverPeriodoMensal(
    entrada.periodo,
    hoje,
    entrada.deMes,
    entrada.ateMes,
  );

  // As duas leituras sao independentes: `cloud_accounts` existe desde sempre e
  // nao depende da migracao 005. A lista de contas e carregada AINDA QUE a
  // integracao nao esteja instalada -- e ela que alimenta o seletor, e um
  // seletor vazio numa tela sem dado nao diria se falta conta ou falta coleta.
  const [instalado, contas] = await Promise.all([
    ovhInstaladoNoBanco(),
    getContasOvhDoCadastro(),
  ]);

  // "TODAS" VIRA LISTA EXPLICITA AQUI, E NAO LA DENTRO DA QUERY.
  //
  // A resolucao precisa acontecer ANTES de `getDisponibilidadeOvh`, e nao em
  // paralelo com a carga das contas: aquela consulta e quem descobre QUAIS
  // MOEDAS existem no recorte. Resolvida depois, a moeda seria escolhida sobre
  // um conjunto de linhas maior do que o que os cards somam -- bastaria uma
  // conta desativada com fatura em EUR para a tela escolher EUR e todos os
  // numeros virem zerados, sem nada que ligasse uma coisa a outra.
  const recorte = resolverRecorteContasOvh(
    entrada.conta,
    contas.map((c) => c.id),
  );

  const semMoeda = {
    deMes: periodo.deMes,
    ateMes: periodo.ateMes,
    source: entrada.source,
    contas: recorte.ids,
    projeto: entrada.projeto,
  };

  // Sem tabela nao ha o que consultar, e `getDisponibilidadeOvh` falharia na
  // analise sintatica -- por isso a verificacao vem antes de consultar custo.
  if (!instalado) {
    return montar({
      entrada,
      periodo,
      hoje,
      instalado: false,
      disponibilidade: { temAlgumDado: false, fontes: [], moedas: [] },
      escolha: { moeda: null, outras: [] },
      contas,
      recorte,
      linhasForaDoCadastro: 0,
    });
  }

  // A contagem do que ficou de fora so e feita quando "todas" virou lista: com
  // selecao explicita, a exclusao e o que a pessoa pediu, e o aviso seria ruido.
  const [disponibilidade, linhasForaDoCadastro] = await Promise.all([
    getDisponibilidadeOvh(semMoeda),
    recorte.resolvidoParaAtivas
      ? contarLinhasForaDoCadastroOvh(
          {
            deMes: periodo.deMes,
            ateMes: periodo.ateMes,
            source: entrada.source,
            projeto: entrada.projeto,
          },
          recorte.ids ?? [],
        )
      : Promise.resolve(0),
  ]);
  const escolha = escolherMoeda(disponibilidade.moedas, entrada.moeda);

  return montar({
    entrada,
    periodo,
    hoje,
    instalado: true,
    disponibilidade,
    escolha,
    contas,
    recorte,
    linhasForaDoCadastro,
  });
}

function montar(ctx: {
  entrada: EntradaDashboardOvh;
  periodo: PeriodoMensalResolvido;
  hoje: string;
  instalado: boolean;
  disponibilidade: DisponibilidadeOvh;
  escolha: ReturnType<typeof escolherMoeda>;
  contas?: ContaOvhDoCadastro[];
  recorte: RecorteContasOvh;
  linhasForaDoCadastro: number;
}): FiltroOvhResolvido {
  const { entrada, periodo, disponibilidade, escolha } = ctx;

  const daMoeda = disponibilidade.moedas.find((m) => m.moeda === escolha.moeda);

  const estado = decidirEstadoDado({
    instalado: ctx.instalado,
    temAlgumDado: disponibilidade.temAlgumDado,
    fontesComDado: disponibilidade.fontes,
    source: entrada.source,
    linhasNoPeriodo: daMoeda?.linhas ?? 0,
  });

  const filtro: FiltroOvh | null =
    escolha.moeda === null
      ? null
      : {
          deMes: periodo.deMes,
          ateMes: periodo.ateMes,
          source: entrada.source,
          // `contas` ESTAVA FALTANDO AQUI. O campo chegava a `semMoeda` -- usado
          // so para descobrir quais moedas existem no recorte -- e nao ao filtro
          // que alimenta os cards, os graficos e as tabelas. Consequencia:
          // `?conta=x` mudava a moeda escolhida e mais nada; todos os numeros
          // continuavam sendo de TODAS as contas, sem nenhum sinal na tela.
          //
          // Agora vem do recorte RESOLVIDO -- a mesma lista que decidiu a moeda.
          contas: ctx.recorte.ids,
          projeto: entrada.projeto,
          moeda: escolha.moeda,
        };

  const avisos: { codigo: string; mensagem: string }[] = [];

  // As tres consequencias de resolver "todas" em lista explicita, cada uma dita
  // na tela. Um recorte que muda os numeros sem se explicar e o modo de falha
  // que este painel existe para nao ter.
  for (const aviso of [
    avisoCadastroVazio(ctx.recorte),
    avisoContasDesconhecidas(ctx.recorte),
    avisoCustoForaDoCadastro(ctx.recorte, ctx.linhasForaDoCadastro),
  ]) {
    if (aviso) avisos.push(aviso);
  }

  // Segunda moeda no recorte: a tela mostra UMA e precisa dizer que a outra
  // existe. Sem este aviso, o total exibido passaria por total do periodo.
  if (escolha.outras.length > 0) {
    avisos.push({
      codigo: "ovh-multimoeda",
      mensagem:
        `O recorte tem mais de uma moeda. Os números abaixo são de ${escolha.moeda} ` +
        `e NÃO incluem: ${escolha.outras
          .map((m) => `${m.moeda} (${m.linhas} linha(s))`)
          .join(", ")}. Moedas não são somadas nem convertidas.`,
    });
  }

  // Origem pedida na URL que existe no catalogo mas nao no banco. Cai em
  // `fonte-sem-dado`, e o aviso complementa dizendo o que existe.
  if (
    ctx.instalado &&
    disponibilidade.temAlgumDado &&
    !disponibilidade.fontes.includes(entrada.source)
  ) {
    avisos.push({
      codigo: "ovh-fonte-ausente",
      mensagem:
        `A origem "${entrada.source}" não tem nenhuma linha neste banco. ` +
        `Origens com dado: ${disponibilidade.fontes.join(", ") || "nenhuma"}.`,
    });
  }

  return {
    entrada,
    periodo,
    filtro,
    estado,
    podeBRL: podeEstimarBRL(escolha.moeda),
    meta: {
      // Rotulo humano do cadastro do portal. O `nichandle` da OVH NAO entra --
      // e um e-mail, e poria endereco de terceiro na tela e na URL do filtro.
      contasDisponiveis: ctx.contas ?? [],
      periodo: {
        preset: periodo.preset,
        rotulo: periodo.rotulo,
        deMes: periodo.deMes,
        ateMes: periodo.ateMes,
        meses: periodo.meses,
        anterior: periodo.anterior,
      },
      filtros: {
        source: entrada.source,
        // O QUE A PESSOA MARCOU, e nao o que a query recebeu. As caixas do
        // seletor sao desenhadas a partir daqui: devolver a lista resolvida
        // faria "todas" voltar com todas as caixas MARCADAS, e o proximo clique
        // -- desmarcar uma -- viraria um recorte que ninguem pediu.
        contas: entrada.conta ?? [],
        todasAsContas: entrada.conta === undefined,
        // O que de fato foi para `provider_account_id = ANY(...)`. `null` so no
        // caso de cadastro vazio, em que nao houve filtro de conta.
        contasConsultadas: ctx.recorte.ids ?? null,
        projeto: entrada.projeto ?? null,
        todosOsProjetos: entrada.projeto === undefined,
        /**
         * A MOEDA AUTORITATIVA DESTA RESPOSTA.
         *
         * Fica aqui dentro, e nao no topo do `meta`, porque `rotaProtegida`
         * grava `moeda: "USD"` fixo no envelope DEPOIS de espalhar este
         * objeto -- um campo de nivel superior com este nome seria sobrescrito
         * em silencio. Quem consome a visao OVH le `meta.filtros.moeda`.
         */
        moeda: escolha.moeda,
        moedasIgnoradas: escolha.outras,
      },
      disponibilidade: {
        instalado: ctx.instalado,
        temAlgumDado: disponibilidade.temAlgumDado,
        fontesComDado: disponibilidade.fontes,
        moedasNoPeriodo: disponibilidade.moedas,
      },
      estado,
      ausencia: {
        mensagem: mensagemDeAusencia(
          estado,
          entrada.source,
          entrada.conta?.length ?? 0,
        ),
        detalhe: detalheDeAusencia(estado),
      },
      base: { hoje: ctx.hoje, mesCorrente: mesDe(ctx.hoje) },
      ...(avisos.length > 0 ? { avisos } : {}),
    },
  };
}
