import { checkDbHealth } from "@/lib/database";

// Health check nunca pode ser cacheado nem prerenderizado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Usado pelo HEALTHCHECK do container e por monitoramento externo.
 * Retorna 503 quando o PostgreSQL nao responde -- a aplicacao sem banco nao
 * tem nada util a entregar.
 */
export async function GET() {
  const db = await checkDbHealth();

  return Response.json(
    {
      status: db.ok ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      db,
    },
    {
      status: db.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
