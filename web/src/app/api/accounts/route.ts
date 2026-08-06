import { z } from "zod";

import { analisar } from "@/lib/api/http";
import { rotaProtegida } from "@/lib/api/rota";
import {
  camposBusca,
  camposOrdenacao,
  camposPaginacao,
  lerParametros,
} from "@/lib/filtros/esquemas";
import { CAMPOS_ORDENACAO_CONTA, listarContas } from "@/lib/queries/contas";

/**
 * GET /api/accounts -- cadastro de contas AWS.
 *
 * Fonte das opcoes de filtro do dashboard. Nenhum id de conta e fixo no
 * codigo: a lista sai inteira de `cloud_accounts`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const esquema = z.object({
  ...camposBusca,
  ...camposPaginacao,
  ...camposOrdenacao(CAMPOS_ORDENACAO_CONTA, "nome", "asc"),
  apenasAtivas: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

export const GET = rotaProtegida("GET /api/accounts", async ({ url }) => {
  const entrada = analisar(esquema, lerParametros(url));
  const { itens, total } = await listarContas(entrada);

  return {
    dados: itens,
    meta: {
      paginacao: {
        pagina: entrada.pagina,
        tamanho: entrada.tamanho,
        total,
        paginas: Math.max(1, Math.ceil(total / entrada.tamanho)),
      },
      ordenacao: { campo: entrada.ordenarPor, direcao: entrada.direcao },
      filtros: {
        busca: entrada.busca ?? null,
        apenasAtivas: entrada.apenasAtivas,
      },
    },
  };
});
