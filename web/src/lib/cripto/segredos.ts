/**
 * Cifragem de credencial de provedor -- AES-256-GCM.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CIFRAR, E NAO GUARDAR HASH
 *
 * Senha de usuario vira hash porque o sistema nunca precisa da senha: precisa
 * apenas decidir se a apresentada e a mesma. Credencial de API e o contrario --
 * o collector tem de ENVIA-LA a OVH a cada coleta. Hash e via de mao unica,
 * entao hash aqui tornaria a credencial inutil no dia seguinte ao cadastro.
 *
 * Cifragem simetrica e a resposta certa, e o custo dela e explicito: quem tiver
 * a chave E o banco tem a credencial. A chave vive so no ambiente do processo
 * (`APP_CREDENTIALS_ENCRYPTION_KEY`), nunca no banco e nunca no Git -- e por
 * isso um dump do Postgres, sozinho, nao entrega nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AAD, E NAO SO GCM
 *
 * GCM garante que o texto cifrado nao foi ALTERADO. Nao garante que ele nao foi
 * MOVIDO. Sem dado associado, quem tivesse escrita no banco poderia copiar o
 * `application_secret_encrypted` da conta A para a conta B, e o portal
 * decifraria com sucesso -- passando a autenticar na OVH da conta A enquanto a
 * tela afirma que e a conta B.
 *
 * Cada segredo e cifrado com AAD = "provider:account_id:campo". Mover o valor
 * de lugar quebra a autenticacao do GCM e a decifragem falha, em vez de
 * silenciosamente devolver o segredo de outra conta.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DUAS SUBCHAVES
 *
 * A mesma chave nunca faz dois trabalhos. `hkdf` deriva uma subchave para
 * cifrar e outra para a impressao digital: se a de fingerprint vazasse -- e ela
 * sai do processo, gravada em coluna consultavel --, ela nao decifra nada.
 *
 * ---------------------------------------------------------------------------
 * O FINGERPRINT E HMAC, NAO SHA-256 CRU
 *
 * SHA-256 puro permitiria a quem tem o banco testar candidatos por dicionario.
 * Chave da OVH tem entropia alta e o ataque seria pouco pratico, mas HMAC com
 * subchave secreta custa o mesmo e fecha a porta: sem a chave, os fingerprints
 * sao opacos.
 *
 * Ele serve para AUDITORIA e COMPARACAO -- responder "a credencial mudou?" e
 * "esta e a mesma que estava aqui antes?" sem decifrar nada.
 *
 * ---------------------------------------------------------------------------
 * ESTE MODULO NAO PODE CHEGAR AO NAVEGADOR.
 *
 * Ele nao tem `server-only` de proposito: com essa marca o vitest recusa o
 * import e a cifragem ficaria sem teste -- o oposto do que se quer no arquivo
 * mais sensivel do projeto. A protecao e outra: nada em `components/` importa
 * daqui, e o que a tela recebe ja vem mascarado pelo servidor.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Prefixo do envelope. Versionado para trocar de algoritmo sem adivinhacao. */
const VERSAO = "v1";

const ALGORITMO = "aes-256-gcm";
const BYTES_IV = 12; // 96 bits -- o tamanho recomendado para GCM
const BYTES_CHAVE = 32; // AES-256
const BYTES_TAG = 16;

/**
 * Sal fixo do HKDF. Sal constante e aceitavel aqui, e nao e descuido: a entrada
 * ja e uma chave de 256 bits de entropia plena, e o papel que o sal teria --
 * separar derivacoes de uma MESMA chave -- e cumprido pelo `info`.
 */
const SAL = Buffer.from("veri-finops/credenciais");

const INFO_CIFRA = Buffer.from("cifra-credencial-v1");
const INFO_DIGITAL = Buffer.from("impressao-digital-v1");

export class ErroDeCripto extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeCripto";
  }
}

// --------------------------------------------------------------------- chave

type Subchaves = { cifra: Buffer; digital: Buffer };

let cache: { bruta: string; subchaves: Subchaves } | null = null;

/**
 * Le e valida a chave-mestra do ambiente.
 *
 * Exigir exatamente 32 bytes e proposital: aceitar chave curta, esticando com
 * padding, daria a aparencia de AES-256 com a forca de uma senha digitada. Erro
 * ruidoso na primeira operacao e melhor do que criptografia fraca silenciosa.
 *
 * O cache e por VALOR da variavel, e nao um booleano: em teste a chave muda
 * entre casos, e um cache cego devolveria a subchave da chave anterior.
 */
function subchaves(): Subchaves {
  const bruta = process.env.APP_CREDENTIALS_ENCRYPTION_KEY ?? "";

  if (bruta.trim() === "") {
    throw new ErroDeCripto(
      "APP_CREDENTIALS_ENCRYPTION_KEY nao definida. Sem ela o portal nao pode " +
        "guardar nem ler credencial de provedor. Gere com: openssl rand -base64 32",
    );
  }

  if (cache && cache.bruta === bruta) return cache.subchaves;

  const mestra = Buffer.from(bruta, "base64");

  if (mestra.length !== BYTES_CHAVE) {
    // O TAMANHO recebido entra na mensagem; o valor, nunca.
    throw new ErroDeCripto(
      `APP_CREDENTIALS_ENCRYPTION_KEY precisa decodificar para ${BYTES_CHAVE} bytes ` +
        `(recebi ${mestra.length}). Gere com: openssl rand -base64 32`,
    );
  }

  const derivadas: Subchaves = {
    cifra: Buffer.from(hkdfSync("sha256", mestra, SAL, INFO_CIFRA, BYTES_CHAVE)),
    digital: Buffer.from(hkdfSync("sha256", mestra, SAL, INFO_DIGITAL, BYTES_CHAVE)),
  };

  cache = { bruta, subchaves: derivadas };
  return derivadas;
}

/**
 * A chave esta configurada e utilizavel?
 *
 * Existe para a tela dizer "a cifragem nao esta configurada neste ambiente" em
 * vez de estourar quando o ADMIN clica em salvar.
 */
export function cifragemDisponivel(): boolean {
  try {
    subchaves();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ contexto

/**
 * Identificacao do campo cifrado. Vira o AAD, e por isso e obrigatoria: sem ela
 * seria possivel mover texto cifrado entre contas.
 */
export type ContextoSegredo = {
  provider: string;
  accountId: string;
  /** Nome logico do campo. Mudar isto invalida o que ja esta gravado. */
  campo: "application_key" | "application_secret" | "consumer_key";
};

function aad(ctx: ContextoSegredo): Buffer {
  return Buffer.from(`${ctx.provider}:${ctx.accountId}:${ctx.campo}`, "utf8");
}

// ------------------------------------------------------------------ cifragem

/**
 * Cifra um segredo. Devolve o envelope pronto para a coluna `*_encrypted`.
 *
 * Formato: `v1:<iv b64>:<cifrado b64>:<tag b64>`. Autodescritivo de proposito --
 * quem abrir a coluna no psql consegue dizer o que e sem consultar o codigo, e o
 * prefixo de versao permite reconhecer envelope antigo numa troca de algoritmo.
 *
 * IV NOVO A CADA CHAMADA. Reusar IV em GCM com a mesma chave nao vaza apenas o
 * texto: vaza a chave de autenticacao e permite forjar tags. E por isso que este
 * modulo nunca aceita IV de fora.
 */
export function cifrar(claro: string, ctx: ContextoSegredo): string {
  if (claro === "") {
    throw new ErroDeCripto("Nao ha o que cifrar: segredo vazio.");
  }

  const { cifra } = subchaves();
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, cifra, iv, { authTagLength: BYTES_TAG });
  cifrador.setAAD(aad(ctx));

  const corpo = Buffer.concat([cifrador.update(claro, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    iv.toString("base64"),
    corpo.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

/**
 * Decifra um envelope. Falha -- nunca devolve lixo -- se a tag nao conferir.
 *
 * Falha tambem quando o AAD nao bate, e esse e o caso interessante: significa
 * que o texto cifrado nao pertence a esta conta ou a este campo.
 */
export function decifrar(envelope: string, ctx: ContextoSegredo): string {
  const partes = envelope.split(":");
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new ErroDeCripto(
      `Envelope de credencial em formato desconhecido (esperado ${VERSAO} com 4 partes).`,
    );
  }

  const ivB64 = partes[1];
  const corpoB64 = partes[2];
  const tagB64 = partes[3];
  const { cifra } = subchaves();

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== BYTES_IV || tag.length !== BYTES_TAG) {
    throw new ErroDeCripto("Envelope de credencial com IV ou tag de tamanho invalido.");
  }

  try {
    const decifrador = createDecipheriv(ALGORITMO, cifra, iv, { authTagLength: BYTES_TAG });
    decifrador.setAAD(aad(ctx));
    decifrador.setAuthTag(tag);
    return Buffer.concat([
      decifrador.update(Buffer.from(corpoB64, "base64")),
      decifrador.final(),
    ]).toString("utf8");
  } catch {
    // A causa original NAO sobe: a mensagem do OpenSSL nao ajuda quem le o log, e
    // a excecao poderia arrastar buffers para o relato de erro.
    throw new ErroDeCripto(
      "Nao foi possivel decifrar a credencial. A chave de cifragem mudou, ou o " +
        "registro foi alterado fora do portal.",
    );
  }
}

// --------------------------------------------------------------- fingerprint

/**
 * Impressao digital para auditoria e comparacao. HMAC-SHA256 em hex.
 *
 * NAO inclui o contexto, e isso e deliberado: o objetivo e poder responder
 * "esta mesma credencial ja esta cadastrada em outra conta?", pergunta que um
 * fingerprint amarrado a conta nao responderia. A protecao contra realocacao de
 * texto cifrado e do AAD, nao daqui.
 */
export function impressaoDigital(claro: string): string {
  const { digital } = subchaves();
  return createHmac("sha256", digital).update(claro, "utf8").digest("hex");
}

/** Comparacao de fingerprint em tempo constante. */
export function mesmaImpressao(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ------------------------------------------------------------------ mascara

/** Quantos caracteres finais a mascara revela. */
export const CARACTERES_VISIVEIS = 4;

/**
 * `****abcd` -- para a tela confirmar QUAL credencial esta gravada sem exibi-la.
 *
 * Segredo curto nao revela nada: abaixo de 8 caracteres a mascara vira `****`
 * inteira. Mostrar os 4 ultimos de um valor de 6 entregaria dois tercos dele.
 *
 * Aplicado a `application_key` e `consumer_key` apenas. `application_secret`
 * NUNCA e mascarado nem exibido -- dele a tela sabe somente se existe. Os dois
 * primeiros sao identificadores do lado da OVH; o terceiro e a senha.
 */
export function mascarar(claro: string): string {
  if (claro.length < CARACTERES_VISIVEIS * 2) return "****";
  return `****${claro.slice(-CARACTERES_VISIVEIS)}`;
}
