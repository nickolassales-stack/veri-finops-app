import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import { mesesFaltando } from "@/lib/diagnostico/etl";
import { esquemaFrescor } from "@/lib/filtros/esquemas-diagnostico";
import { lerParametros } from "@/lib/filtros/esquemas";
import { montarDiagnostico } from "@/lib/services/diagnostico";

/**
 * GET /api/diagnostics/accounts -- frescor da carga, conta a conta.
 *
 * Uma linha por conta com dado: ultima data de uso, ultimo mes de cobranca,
 * volume, quando foi carregada e quais meses faltam no meio da serie.
 *
 * O ALIAS APARECE, E O account_id TAMBEM. Sempre os dois. Numa tela de
 * diagnostico, apelido sozinho obrigaria a abrir outra tela para descobrir de
 * que conta se fala -- e o account_id e o que se leva para o console da AWS.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/diagnostics/accounts",
  "diagnostics:view",
  async ({ url }) => {
    const { diasSemAtualizacao } = analisar(esquemaFrescor, lerParametros(url));

    const d = await montarDiagnostico({ diasSemAtualizacao, limiteHistorico: 1 });

    return {
      dados: d.contas.map((c) => ({
        ...c,
        // Calculado aqui, e nao no banco: a regra de "buraco no meio da serie"
        // ignora as pontas de proposito, e essa decisao vive no modulo puro que
        // tem teste -- nao numa expressao SQL que ninguem consegue exercitar.
        mesesFaltando: mesesFaltando(c),
      })),
      meta: {
        instalado: d.instalado,
        total: d.contas.length,
        cobertura: d.cobertura,
        limites: d.limites,
      },
    };
  },
);
