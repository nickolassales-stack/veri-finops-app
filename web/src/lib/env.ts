import { z } from "zod";

/**
 * Validacao das variaveis de ambiente.
 *
 * A leitura e LAZY de proposito: `next build` roda dentro do Docker sem acesso
 * ao banco e sem as variaveis de conexao. Validar no import quebraria o build.
 * Portanto a validacao acontece na primeira requisicao que precisa do banco.
 */
const envSchema = z.object({
  PG_HOST: z.string().min(1, "PG_HOST e obrigatorio"),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_DB: z.string().min(1, "PG_DB e obrigatorio"),
  PG_USER: z.string().min(1, "PG_USER e obrigatorio"),
  PG_PASSWORD: z.string().min(1, "PG_PASSWORD e obrigatorio"),

  /** Conexoes simultaneas. Mantido baixo: o Postgres e compartilhado com o Metabase. */
  PG_POOL_MAX: z.coerce.number().int().positive().max(20).default(5),

  /** Corta query travada antes que ela prejudique o banco de producao. */
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  /** Fuso usado para formatar datas na interface. */
  APP_TZ: z.string().min(1).default("America/Sao_Paulo"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuracao de ambiente invalida.\n${detalhes}\n` +
        "Verifique o arquivo .env usado pelo docker compose (ver infra/.env.example).",
    );
  }

  cached = parsed.data;
  return cached;
}
