import { rotaComPermissao } from "@/lib/api/rota";
import { estimarBRL, obterCotacao } from "@/lib/exchange-rate";
import { variacao } from "@/lib/dashboard/ovh";
import {
  contarFaturasOvh,
  contarProjetosOvh,
  getResumoOvh,
  getTotalOvh,
} from "@/lib/queries/dashboard-ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/dashboard/ovh/summary -- numeros de cabecalho da visao OVH.
 *
 * `dashboard:view` e exigido aqui, e os endpoints AWS equivalentes usam
 * `rotaProtegida` (so sessao). A diferenca e deliberada e vale registrar:
 * `dashboard:view` esta em `PERMISSOES_DO_VIEWER`, entao HOJE todo usuario
 * autenticado a tem e a checagem nao recusa ninguem. Ela existe para o dia em
 * que a permissao sair do piso -- e a inconsistencia aponta para o lado seguro:
 * a tela nova exige, a antiga nao.
 *
 * Quando nao ha dado, os totais saem `null` -- nunca `0`. Zero seria uma
 * afirmacao sobre o custo da OVH; `null` diz que a afirmacao nao existe, e a
 * tela escreve "sem dado" em vez de "US$ 0,00".
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/summary",
  "dashboard:view",
  async ({ url, tz }) => {
    const { entrada, filtro, periodo, estado, podeBRL, meta } =
      await resolverFiltroOvh(url, tz);

    // `projetosCadastrados` e `faturas` nao dependem de moeda nem de origem, e
    // por isso continuam valendo mesmo quando nao ha custo a somar: saber que
    // existem 3 projetos e 0 faturas no periodo E informacao.
    //
    // `contas` PRECISA ser repassado: sem ele o card "Faturas no periodo"
    // contaria as faturas de TODAS as contas ao lado de um custo recortado por
    // uma so -- dois numeros da mesma linha respondendo perguntas diferentes.
    const [projetosCadastrados, faturas] = await Promise.all([
      contarProjetosOvh(),
      contarFaturasOvh({
        deMes: periodo.deMes,
        ateMes: periodo.ateMes,
        contas: entrada.conta,
      }),
    ]);

    if (!filtro) {
      return {
        dados: {
          estado,
          total: null,
          totalAnterior: null,
          variacao: null,
          linhas: 0,
          projetosComCusto: 0,
          projetosCadastrados,
          servicos: 0,
          mesesComDado: 0,
          primeiroMes: null,
          ultimoMes: null,
          custoSemProjeto: null,
          faturas,
          estimativaBRL: null,
        },
        meta,
      };
    }

    // A cotacao em paralelo com o custo, e nao em sequencia: ela nao pode somar
    // latencia ao numero principal. `obterCotacao()` nao lanca por contrato.
    const [resumo, totalAnterior, cotacao] = await Promise.all([
      getResumoOvh(filtro),
      getTotalOvh({
        ...filtro,
        deMes: periodo.anterior.deMes,
        ateMes: periodo.anterior.ateMes,
      }),
      obterCotacao(),
    ]);

    return {
      dados: {
        estado,
        total: resumo.total,
        totalAnterior,
        variacao: variacao(resumo.total, totalAnterior),
        linhas: resumo.linhas,
        projetosComCusto: resumo.projetosComCusto,
        projetosCadastrados,
        servicos: resumo.servicos,
        mesesComDado: resumo.mesesComDado,
        primeiroMes: resumo.primeiroMes,
        ultimoMes: resumo.ultimoMes,
        custoSemProjeto: resumo.custoSemProjeto,
        faturas,
        // `null` e nao um objeto com `total: null`: a estimativa em BRL so
        // existe se a moeda for USD, porque a cotacao do Banco Central e
        // USD/BRL. Aplica-la a euro daria um numero com cara de real e sem
        // relacao com a fatura.
        estimativaBRL: podeBRL
          ? estimarBRL(resumo.total, totalAnterior, cotacao)
          : null,
      },
      meta,
    };
  },
);
