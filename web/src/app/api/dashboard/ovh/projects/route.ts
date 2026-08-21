import { rotaComPermissao } from "@/lib/api/rota";
import { participacao } from "@/lib/dashboard/ovh";
import {
  getProjetosDisponiveisOvh,
  getProjetosOvh,
  getResumoOvh,
} from "@/lib/queries/dashboard-ovh";
import { resolverFiltroOvh } from "@/lib/services/dashboard-ovh";

/**
 * GET /api/dashboard/ovh/projects -- custo por projeto, e a lista do filtro.
 *
 * A lista de projetos disponiveis viaja no `meta` da mesma resposta em vez de ter
 * endpoint proprio: ela e derivada do MESMO recorte (origem e janela), e um
 * segundo endpoint poderia oferecer no seletor um projeto que o recorte atual
 * nao contem.
 *
 * `servicoDoProjeto: ""` e uma linha legitima, nao lixo: e o custo que a fatura
 * NAO atribui a projeto nenhum -- taxa de dominio, assinatura. O DDL usa string
 * vazia com o significado "nao se aplica" porque a coluna participa da chave
 * UNIQUE do upsert e, em indice do Postgres, NULL nunca e igual a NULL. A tela
 * mostra essa linha com rotulo proprio; esconde-la faria a soma por projeto nao
 * fechar com o total.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/projects",
  "dashboard:view",
  async ({ url, tz }) => {
    const { filtro, periodo, entrada, estado, meta } = await resolverFiltroOvh(url, tz);

    const disponiveis = await getProjetosDisponiveisOvh({
      deMes: periodo.deMes,
      ateMes: periodo.ateMes,
      source: entrada.source,
    });

    if (!filtro) {
      return {
        dados: [],
        meta: { ...meta, estado, totalDaJanela: null, projetosDisponiveis: disponiveis },
      };
    }

    const [projetos, resumo] = await Promise.all([
      getProjetosOvh(filtro),
      getResumoOvh(filtro),
    ]);

    return {
      dados: projetos.map((p) => ({
        servicoDoProjeto: p.servicoDoProjeto,
        nome: p.nome,
        /** `true` para a linha de custo sem projeto atribuido. */
        semProjeto: p.servicoDoProjeto === "",
        total: p.total,
        linhas: p.linhas,
        participacao: participacao(p.total, resumo.total),
      })),
      meta: {
        ...meta,
        estado,
        totalDaJanela: resumo.total,
        projetosDisponiveis: disponiveis,
        custoSemProjeto: resumo.custoSemProjeto,
      },
    };
  },
);
