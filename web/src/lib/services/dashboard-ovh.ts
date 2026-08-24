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
  getContasOvh,
  getDisponibilidadeOvh,
  type ContaOvh,
  ovhInstaladoNoBanco,
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

  const semMoeda = {
    deMes: periodo.deMes,
    ateMes: periodo.ateMes,
    source: entrada.source,
    conta: entrada.conta,
    projeto: entrada.projeto,
  };

  const instalado = await ovhInstaladoNoBanco();

  // Sem tabela nao ha o que consultar, e `getDisponibilidadeOvh` falharia na
  // analise sintatica -- por isso a verificacao vem antes, numa viagem propria.
  if (!instalado) {
    return montar({
      entrada,
      periodo,
      hoje,
      instalado: false,
      disponibilidade: { temAlgumDado: false, fontes: [], moedas: [] },
      escolha: { moeda: null, outras: [] },
    });
  }

  // `getContasOvh` entra no MESMO Promise.all: as duas leituras sao
  // independentes, e a lista de contas alimenta o seletor de TODAS as abas do
  // Analitico -- nao so a de projetos. Uma linha em `ovh_provider_accounts` por
  // conta, entao o custo e desprezivel perto de uma segunda ida ao banco.
  const [disponibilidade, contas] = await Promise.all([
    getDisponibilidadeOvh(semMoeda),
    getContasOvh(),
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
  });
}

function montar(ctx: {
  entrada: EntradaDashboardOvh;
  periodo: PeriodoMensalResolvido;
  hoje: string;
  instalado: boolean;
  disponibilidade: DisponibilidadeOvh;
  escolha: ReturnType<typeof escolherMoeda>;
  contas?: ContaOvh[];
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
          projeto: entrada.projeto,
          moeda: escolha.moeda,
        };

  const avisos: { codigo: string; mensagem: string }[] = [];

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
      contasDisponiveis: (ctx.contas ?? []).map((c) => ({
        id: c.providerAccountId,
        // `alias` e o rotulo humano; `nichandle` NAO entra -- e um e-mail, e
        // poria endereco de terceiro na tela e na URL do filtro.
        nome: c.alias ?? c.providerAccountId,
      })),
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
        mensagem: mensagemDeAusencia(estado, entrada.source),
        detalhe: detalheDeAusencia(estado),
      },
      base: { hoje: ctx.hoje, mesCorrente: mesDe(ctx.hoje) },
      ...(avisos.length > 0 ? { avisos } : {}),
    },
  };
}
