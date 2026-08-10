import { rotaProtegida } from "@/lib/api/rota";
import { AVISO_ESTIMATIVA, obterCotacao } from "@/lib/exchange-rate";

/**
 * GET /api/exchange-rate -- cotacao USD/BRL usada nas estimativas.
 *
 * Responde 200 tambem quando a cotacao esta indisponivel: o endpoint funcionou,
 * quem falhou foi a fonte externa. O que aconteceu esta em `status` e
 * `mensagemErro` -- devolver 503 faria o cliente tratar como erro de
 * infraestrutura da aplicacao, que nao e o caso.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaProtegida("GET /api/exchange-rate", async () => {
  const cotacao = await obterCotacao();

  return {
    dados: cotacao,
    meta: { par: "USD/BRL", aviso: AVISO_ESTIMATIVA },
  };
});
