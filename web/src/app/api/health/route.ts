import { getSessao } from "@/lib/auth/dal";
import { checkDbHealth } from "@/lib/database";

// Health check nunca pode ser cacheado nem prerenderizado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Usado pelo HEALTHCHECK do container e por monitoramento externo.
 * Retorna 503 quando o PostgreSQL nao responde -- a aplicacao sem banco nao
 * tem nada util a entregar.
 *
 * UNICA rota fora do `proxy.ts`, portanto a unica alcancavel sem sessao. Por
 * isso a resposta e deliberadamente pobre para quem nao esta autenticado:
 * `status`, `timestamp` e o booleano `db.ok` -- o suficiente para o `wget` do
 * HEALTHCHECK e para um monitor externo decidir se a instancia esta viva.
 *
 * O DETALHE (versao do PostgreSQL, nome do banco, latencia e, principalmente, a
 * mensagem de erro do driver) so sai com sessao valida. A mensagem de erro e o
 * que mais pesa aqui: uma falha de conexao devolve texto do tipo
 * `password authentication failed for user "finops_app"` ou
 * `getaddrinfo ENOTFOUND postgres`, entregando usuario e host do banco a quem
 * so precisava saber se o servico esta de pe.
 */
export async function GET() {
  const db = await checkDbHealth();

  // A sessao e opcional aqui: o healthcheck do container roda sem cookie e nao
  // pode falhar por causa disso.
  const autenticado = Boolean(await getSessao().catch(() => null));

  return Response.json(
    {
      status: db.ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      db: autenticado ? db : { ok: db.ok },
    },
    {
      status: db.ok ? 200 : 503,
      headers: { "cache-control": "no-store, private" },
    },
  );
}
