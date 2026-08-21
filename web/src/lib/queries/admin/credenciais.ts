import "server-only";

import { query, queryOne } from "@/lib/database";

/**
 * Acesso a `cloud_provider_credentials` -- a camada que fala com o banco.
 *
 * ---------------------------------------------------------------------------
 * ESTE MODULO NAO DECIFRA NADA, E NAO E DESCUIDO
 *
 * Ele entrega e recebe ENVELOPES. A cifragem e a decifragem vivem em
 * `lib/services/credenciais-ovh.ts`, uma camada acima. A separacao e proposital:
 * uma consulta de listagem nunca precisa de segredo em claro, e mantendo a
 * decifragem fora daqui nenhuma consulta pode acidentalmente trazer um segredo
 * para um caminho que so queria contar linhas.
 *
 * Corolario pratico: NENHUMA funcao deste arquivo devolve `*_encrypted` num tipo
 * que va para a tela. As duas que devolvem envelope tem "Envelope" no nome.
 */

/** Status possiveis -- espelha o CHECK da migracao 006. */
export const STATUS_CREDENCIAL = ["nao_validado", "conectado", "invalido"] as const;
export type StatusCredencial = (typeof STATUS_CREDENCIAL)[number];

/**
 * O que a TELA pode saber sobre uma credencial.
 *
 * Note o que nao esta aqui: nenhum campo `*_encrypted`, nenhum fingerprint. O
 * fingerprint fica no banco para auditoria por consulta -- expo-lo na API daria
 * a quem tem a tela um oraculo para testar se uma credencial que ele ja possui e
 * a mesma que esta cadastrada.
 */
export type StatusCredencialOvh = {
  accountId: string;
  endpoint: string;
  status: StatusCredencial;
  /** Mascara `****abcd`. Preenchida pelo servico, que e quem decifra. */
  applicationKeyMascarada: string | null;
  consumerKeyMascarada: string | null;
  /** O secret nunca e mascarado nem exibido: so se existe. */
  temApplicationSecret: boolean;
  ultimaValidacao: string | null;
  ultimoErro: string | null;
  criadaEm: string;
  atualizadaEm: string;
};

/** Linha crua, com os envelopes. Nunca sai deste modulo para a tela. */
export type LinhaCredencialEnvelope = {
  accountId: string;
  endpoint: string;
  status: StatusCredencial;
  applicationKeyEncrypted: string;
  applicationSecretEncrypted: string;
  consumerKeyEncrypted: string;
  applicationKeyFingerprint: string;
  consumerKeyFingerprint: string;
  ultimaValidacao: string | null;
  ultimoErro: string | null;
  criadaEm: string;
  atualizadaEm: string;
};

const PROVIDER = "ovh";

// ------------------------------------------------------ guarda de migracao

let tabelaExiste: boolean | null = null;
const TEMPO_DE_REPESCAGEM_MS = 30_000;
let ultimaChecagem = 0;

/**
 * A migracao 006 rodou neste banco?
 *
 * Mesmo padrao de `aliasDisponivel`, e pelo mesmo motivo: sem a tabela, toda
 * consulta abaixo falha na ANALISE da query, nao em execucao, e nenhum
 * `coalesce` salvaria. A verificacao precisa ser uma viagem separada.
 *
 * O cache tem repescagem por tempo para o caso de a migracao ser aplicada com o
 * portal no ar -- sem isso, seria preciso reiniciar o container para a tela
 * enxergar a tabela nova.
 */
export async function credenciaisDisponiveis(): Promise<boolean> {
  if (tabelaExiste === true) return true;

  const agora = Date.now();
  if (tabelaExiste === false && agora - ultimaChecagem < TEMPO_DE_REPESCAGEM_MS) {
    return false;
  }

  const linha = await queryOne<{ existe: boolean }>(
    `SELECT to_regclass('public.cloud_provider_credentials') IS NOT NULL AS existe`,
  );
  tabelaExiste = linha?.existe ?? false;
  ultimaChecagem = agora;
  return tabelaExiste;
}

/** Zera o cache. Existe para o teste; nao chame em codigo de producao. */
export function esquecerDisponibilidadeCredenciais(): void {
  tabelaExiste = null;
  ultimaChecagem = 0;
}

// ------------------------------------------------------------------ leitura

type LinhaBanco = {
  account_id: string;
  endpoint: string;
  status: string;
  application_key_encrypted: string;
  application_secret_encrypted: string;
  consumer_key_encrypted: string;
  application_key_fingerprint: string;
  consumer_key_fingerprint: string;
  last_validated_at: Date | null;
  last_validation_error: string | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * `status` chega como `text`. O CHECK do banco garante a lista, mas o driver nao
 * sabe disso: se o CHECK mudar sem o codigo saber, cair em `nao_validado` e
 * melhor do que propagar um valor que a tela nao sabe desenhar.
 */
function normalizarStatus(valor: string): StatusCredencial {
  return (STATUS_CREDENCIAL as readonly string[]).includes(valor)
    ? (valor as StatusCredencial)
    : "nao_validado";
}

function mapear(l: LinhaBanco): LinhaCredencialEnvelope {
  return {
    accountId: l.account_id,
    endpoint: l.endpoint,
    status: normalizarStatus(l.status),
    applicationKeyEncrypted: l.application_key_encrypted,
    applicationSecretEncrypted: l.application_secret_encrypted,
    consumerKeyEncrypted: l.consumer_key_encrypted,
    applicationKeyFingerprint: l.application_key_fingerprint,
    consumerKeyFingerprint: l.consumer_key_fingerprint,
    ultimaValidacao: l.last_validated_at?.toISOString() ?? null,
    ultimoErro: l.last_validation_error,
    criadaEm: l.created_at.toISOString(),
    atualizadaEm: l.updated_at.toISOString(),
  };
}

const COLUNAS = `
  account_id, endpoint, status,
  application_key_encrypted, application_secret_encrypted, consumer_key_encrypted,
  application_key_fingerprint, consumer_key_fingerprint,
  last_validated_at, last_validation_error, created_at, updated_at
`;

/**
 * Credencial de UMA conta, com envelopes. `null` quando nao ha cadastro.
 *
 * "Envelope" no nome de proposito: quem chama tem de saber que esta recebendo
 * material cifrado e que decifra-lo e uma decisao consciente.
 */
export async function getCredencialEnvelope(
  accountId: string,
): Promise<LinhaCredencialEnvelope | null> {
  if (!(await credenciaisDisponiveis())) return null;

  const linhas = await query<LinhaBanco>(
    `SELECT ${COLUNAS}
       FROM cloud_provider_credentials
      WHERE provider = $1 AND account_id = $2`,
    [PROVIDER, accountId],
  );

  return linhas.length > 0 ? mapear(linhas[0]) : null;
}

/**
 * Situacao de todas as credenciais, indexada por conta.
 *
 * `Map` e nao array: quem chama esta cruzando com a lista de contas e faria uma
 * busca linear por conta -- com 5 contas nao importa, mas o `Map` deixa a
 * intencao explicita e nao piora com o cadastro crescendo.
 *
 * Devolve ENVELOPE porque o servico precisa decifrar para montar a mascara. A
 * alternativa seria gravar a mascara numa coluna, o que significaria uma copia
 * derivada do segredo a mais no banco -- pior troca.
 */
export async function getCredenciaisPorConta(): Promise<
  Map<string, LinhaCredencialEnvelope>
> {
  if (!(await credenciaisDisponiveis())) return new Map();

  const linhas = await query<LinhaBanco>(
    `SELECT ${COLUNAS} FROM cloud_provider_credentials WHERE provider = $1`,
    [PROVIDER],
  );

  return new Map(linhas.map((l) => [l.account_id, mapear(l)]));
}

// ------------------------------------------------------------------ escrita

export type GravacaoCredencial = {
  accountId: string;
  endpoint: string;
  applicationKeyEncrypted: string;
  applicationSecretEncrypted: string;
  consumerKeyEncrypted: string;
  applicationKeyFingerprint: string;
  consumerKeyFingerprint: string;
  /** `app_users.id` de quem salvou. */
  usuarioId: string;
};

/**
 * Grava (ou substitui) a credencial de uma conta.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` sobre a UNIQUE (provider, account_id): o
 * primeiro cadastro e insercao, os seguintes sao substituicao, e a tela nao
 * precisa saber em qual caso esta.
 *
 * O `status` volta para `nao_validado` a cada gravacao, e isso NAO e reset
 * gratuito: uma credencial nova nunca foi testada. Manter `conectado` de uma
 * credencial anterior faria a tela afirmar que a atual funciona -- afirmacao que
 * ninguem verificou, sobre o campo em que errar e mais caro.
 *
 * `created_by` e preservado no UPDATE (`COALESCE` do valor antigo): quem criou o
 * registro nao muda quando outra pessoa o edita. `updated_by` recebe o autor da
 * vez, e e a dupla que responde "quem mexeu nisso" numa auditoria.
 */
export async function gravarCredencial(
  g: GravacaoCredencial,
): Promise<LinhaCredencialEnvelope> {
  const linha = await queryOne<LinhaBanco>(
    `
    INSERT INTO cloud_provider_credentials (
      provider, account_id, endpoint,
      application_key_encrypted, application_secret_encrypted, consumer_key_encrypted,
      application_key_fingerprint, consumer_key_fingerprint,
      status, last_validated_at, last_validation_error,
      created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'nao_validado', NULL, NULL, $9, $9)
    ON CONFLICT (provider, account_id) DO UPDATE SET
      endpoint                     = EXCLUDED.endpoint,
      application_key_encrypted    = EXCLUDED.application_key_encrypted,
      application_secret_encrypted = EXCLUDED.application_secret_encrypted,
      consumer_key_encrypted       = EXCLUDED.consumer_key_encrypted,
      application_key_fingerprint  = EXCLUDED.application_key_fingerprint,
      consumer_key_fingerprint     = EXCLUDED.consumer_key_fingerprint,
      status                       = 'nao_validado',
      last_validated_at            = NULL,
      last_validation_error        = NULL,
      created_by                   = COALESCE(cloud_provider_credentials.created_by, EXCLUDED.created_by),
      updated_by                   = EXCLUDED.updated_by
    RETURNING ${COLUNAS}
    `,
    [
      PROVIDER,
      g.accountId,
      g.endpoint,
      g.applicationKeyEncrypted,
      g.applicationSecretEncrypted,
      g.consumerKeyEncrypted,
      g.applicationKeyFingerprint,
      g.consumerKeyFingerprint,
      g.usuarioId,
    ],
  );

  return mapear(linha);
}

/**
 * Registra o resultado de uma validacao.
 *
 * Separado de `gravarCredencial` porque o teste de conexao acontece SEM
 * gravacao: o ADMIN pode testar uma credencial ja salva, e nesse caso nada de
 * segredo muda -- so o veredito.
 *
 * `last_validation_error` recebe `null` no sucesso, e nao o erro anterior: um
 * erro antigo ao lado de "conectado" e contradicao na tela.
 */
export async function registrarValidacao(
  accountId: string,
  status: StatusCredencial,
  erroSanitizado: string | null,
  usuarioId: string,
): Promise<LinhaCredencialEnvelope | null> {
  if (!(await credenciaisDisponiveis())) return null;

  const linhas = await query<LinhaBanco>(
    `UPDATE cloud_provider_credentials
        SET status                = $3,
            last_validated_at     = now(),
            last_validation_error = $4,
            updated_by            = $5
      WHERE provider = $1 AND account_id = $2
      RETURNING ${COLUNAS}`,
    [PROVIDER, accountId, status, erroSanitizado, usuarioId],
  );

  return linhas.length > 0 ? mapear(linhas[0]) : null;
}

/**
 * Remove a credencial. Devolve `true` quando havia algo para remover.
 *
 * O booleano existe para a rota distinguir 200 de "nao havia nada": apagar duas
 * vezes nao e erro, mas a tela deve dizer coisas diferentes.
 */
export async function apagarCredencial(accountId: string): Promise<boolean> {
  if (!(await credenciaisDisponiveis())) return false;

  const linhas = await query<{ account_id: string }>(
    `DELETE FROM cloud_provider_credentials
      WHERE provider = $1 AND account_id = $2
      RETURNING account_id`,
    [PROVIDER, accountId],
  );

  return linhas.length > 0;
}

/**
 * Outras contas que usam a MESMA credencial, por fingerprint.
 *
 * Existe porque cadastrar a mesma application key em duas contas e um erro que
 * nao da sintoma nenhum: as duas coletam, e as duas coletam a MESMA conta da
 * OVH. Uma delas passa a exibir custo que nao e dela, e ninguem descobre por
 * numero -- os dois totais parecem plausiveis.
 *
 * Compara sem decifrar: e para isto que o fingerprint existe.
 */
export async function contasComMesmaChave(
  fingerprint: string,
  exceto: string,
): Promise<string[]> {
  if (!(await credenciaisDisponiveis())) return [];

  const linhas = await query<{ account_id: string }>(
    `SELECT account_id
       FROM cloud_provider_credentials
      WHERE provider = $1
        AND application_key_fingerprint = $2
        AND account_id <> $3
      ORDER BY account_id`,
    [PROVIDER, fingerprint, exceto],
  );

  return linhas.map((l) => l.account_id);
}
