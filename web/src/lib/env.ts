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

  /** Validade da sessao. Sem renovacao deslizante: expira em tempo fixo. */
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),

  /**
   * Atributo `Secure` do cookie de sessao.
   *
   * Padrao `true`, que e o correto -- e funciona no fluxo de validacao atual,
   * porque navegadores tratam `http://localhost` como contexto seguro e aceitam
   * cookie Secure ali (o acesso hoje e por tunel SSH para 127.0.0.1).
   *
   * So mude para `false` se precisar acessar por HTTP em host que NAO seja
   * localhost -- e nesse caso a sessao viaja em claro na rede. O certo e
   * colocar Nginx + HTTPS na frente e manter `true`.
   */
  /**
   * Fonte da cotacao USD/BRL. `nenhum` desliga a estimativa: a aplicacao
   * continua exibindo USD normalmente, sem tentar sair para a internet.
   */
  EXCHANGE_RATE_PROVIDER: z.enum(["ptax", "sgs", "nenhum"]).default("ptax"),

  /**
   * Validade do cache da cotacao. Padrao 1 hora: o PTAX publica um boletim de
   * fechamento por dia util, entao buscar de hora em hora ja pega o novo valor
   * logo apos as 13h sem martelar o servico do Banco Central.
   */
  EXCHANGE_RATE_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(604_800)
    .default(3_600),

  /**
   * Teto de espera pela API externa. Curto de proposito: a cotacao e um
   * enfeite do dashboard e nao pode segurar a resposta do custo em USD.
   */
  EXCHANGE_RATE_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(4_000),

  AUTH_COOKIE_SECURE: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
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
