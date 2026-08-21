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

  /**
   * Teto de linhas por exportacao (CSV ou XLSX).
   *
   * Existe porque exportar e a unica operacao da aplicacao cujo custo cresce com
   * o tamanho da base, e nao com o tamanho da tela. O container roda com 512 MiB
   * ao lado de um Metabase que ja sofreu OOM nesta instancia; um pedido de
   * "exporte tudo" nao pode derrubar o portal.
   *
   * Acima do teto a exportacao e RECUSADA com mensagem pedindo para estreitar o
   * filtro -- nunca truncada. Um arquivo cortado pela metade com cara de
   * completo e o pior desfecho possivel para um relatorio financeiro.
   *
   * 50 mil linhas cobrem folgadamente ~2 anos da base atual (660 linhas hoje).
   */
  EXPORT_MAX_ROWS: z.coerce
    .number({ error: "EXPORT_MAX_ROWS deve ser um numero inteiro." })
    .int()
    .positive()
    .max(1_000_000)
    .default(50_000),

  /**
   * Horario em que o ETL e esperado, no fuso de ETL_FUSO_AGENDAMENTO.
   *
   * O padrao reflete o CRON REAL da EC2 (`0 8 * * *` com o servidor em UTC), e
   * nao o horario que se gostaria de ter. A tela existe para dizer a verdade
   * sobre o pipeline; comecar com um valor otimista faria dela a primeira coisa
   * a mentir. Para mudar o horario de fato, mude o cron -- ver docs/RUNBOOK-app.md.
   */
  ETL_HORARIO_ESPERADO: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ETL_HORARIO_ESPERADO deve ser HH:MM (24h)")
    .default("08:00"),

  /**
   * Fuso em que o AGENDADOR interpreta esse horario.
   *
   * `Etc/UTC` porque a EC2 esta em UTC: `0 8 * * *` dispara as 08:00 UTC, que
   * sao 05:00 em Sao Paulo. Confundir os dois e um erro de tres horas na
   * pergunta "ja deveria ter rodado?".
   */
  ETL_FUSO_AGENDAMENTO: z.string().min(1).default("Etc/UTC"),

  /** Atraso tolerado antes de acusar a carga de atrasada. */
  ETL_TOLERANCIA_MINUTOS: z.coerce.number().int().positive().max(1440).default(90),

  /**
   * O cron do collector OVH esta instalado no host?
   *
   * DECLARADO, NAO MEDIDO -- mesma limitacao de ETL_HORARIO_ESPERADO e pelo
   * mesmo motivo: o portal roda em container sem acesso ao crontab do host, e
   * ler o cron exigiria executar comando la fora. Entao a variavel pode divergir
   * da realidade, e a tela diz explicitamente que o valor e declarado.
   *
   * O padrao e `false` porque instalacao nova nao tem cron nenhum. Foi instalado
   * na EC2 de producao em 20/08/2026 (`0 9 * * *`), e la a variavel precisa
   * valer `true` -- senao o Diagnostico afirma o contrario do que existe.
   */
  OVH_CRON_INSTALADO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Horario esperado do collector OVH, no fuso de ETL_FUSO_AGENDAMENTO. */
  OVH_HORARIO_ESPERADO: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "OVH_HORARIO_ESPERADO deve ser HH:MM (24h)")
    .default("09:00"),

  /**
   * Idade a partir da qual uma execucao ainda aberta e dada por interrompida.
   * Precisa ser MAIOR que a duracao normal da carga -- hoje, segundos.
   */
  ETL_EXECUCAO_ORFA_MINUTOS: z.coerce.number().int().positive().max(1440).default(120),

  /**
   * Dias sem dado novo antes de acusar conta parada. O CUR da AWS atrasa cerca
   * de um dia por natureza; 3 evita alerta falso e ainda pega conta parada.
   */
  DIAGNOSTICO_DIAS_SEM_ATUALIZACAO: z.coerce.number().int().positive().max(90).default(3),

  /**
   * Integracao com as APIs de faturamento da AWS.
   *
   * `false` e o padrao e continua sendo o valor correto hoje: nao ha integracao
   * implementada, o portal nao tem credencial AWS e -- o mais importante --
   * nenhuma API da AWS responde de forma confiavel se uma fatura FOI PAGA.
   *
   * Ligar isto sozinho nao ativa nada: `consultarSituacaoNaAws` continua
   * respondendo indisponivel. A variavel existe para que, no dia em que houver
   * implementacao, ela nasca desligada em producao e precise de ato explicito.
   * Ver docs/AWS-INVOICING.md.
   */
  AWS_INVOICING_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

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
