/**
 * Hash de senha com scrypt do `node:crypto`.
 *
 * Implementacao UNICA, compartilhada entre a aplicacao (login, que verifica) e
 * o comando de criacao de administrador (scripts/create-admin.mjs, que gera).
 * Por isso e ESM puro sem dependencia: roda dentro do bundle do Next e tambem
 * como script solto no container, sem toolchain.
 *
 * Por que scrypt e nao bcrypt/argon2: os dois sao modulos nativos (node-gyp) e
 * exigiriam toolchain de compilacao na imagem alpine. scrypt e memory-hard,
 * recomendado pela OWASP para armazenamento de senha, e vem embutido no Node.
 *
 * Formato armazenado:  scrypt$N$r$p$<salt base64>$<hash base64>
 * Os parametros ficam no proprio registro para poderem ser endurecidos no
 * futuro sem invalidar as senhas ja cadastradas.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * N=2^16 com r=8 consome ~64 MB por derivacao. Cabe no limite de 512 MB do
 * container para o volume de login de um portal interno.
 */
export const PARAMETROS = Object.freeze({
  N: 65536,
  r: 8,
  p: 1,
  tamanhoChave: 64,
  tamanhoSalt: 16,
});

/** 128 * N * r = ~67 MB; a margem cobre variacao de parametro. */
const MAX_MEMORIA = 192 * 1024 * 1024;

/** Piso de tamanho de senha na criacao. Login nao aplica politica, so verifica. */
export const MIN_TAMANHO_SENHA = 12;

const PREFIXO = "scrypt";

/**
 * Normaliza a senha antes de derivar. Sem isso, um "ç" digitado como caractere
 * composto e outro como decomposto gerariam hashes diferentes para a mesma
 * senha visivel.
 */
function normalizar(senha) {
  return senha.normalize("NFKC");
}

/** @param {string} senha */
export async function hashPassword(senha) {
  if (typeof senha !== "string") {
    throw new TypeError("senha deve ser string");
  }
  if (normalizar(senha).length < MIN_TAMANHO_SENHA) {
    throw new Error(`senha deve ter ao menos ${MIN_TAMANHO_SENHA} caracteres`);
  }

  const { N, r, p, tamanhoChave, tamanhoSalt } = PARAMETROS;
  const salt = randomBytes(tamanhoSalt);
  const chave = await scrypt(normalizar(senha), salt, tamanhoChave, {
    N,
    r,
    p,
    maxmem: MAX_MEMORIA,
  });

  return [
    PREFIXO,
    N,
    r,
    p,
    salt.toString("base64"),
    chave.toString("base64"),
  ].join("$");
}

/**
 * Verifica a senha em tempo constante.
 *
 * Nunca lanca: qualquer formato inesperado no banco resulta em `false`. Um
 * throw aqui viraria erro 500 no login e diferenciaria "hash corrompido" de
 * "senha errada" para quem estivesse sondando.
 *
 * @param {string} senha
 * @param {string} armazenado
 */
export async function verifyPassword(senha, armazenado) {
  try {
    if (typeof senha !== "string" || typeof armazenado !== "string") return false;

    const partes = armazenado.split("$");
    if (partes.length !== 6) return false;

    const [prefixo, nTexto, rTexto, pTexto, saltB64, hashB64] = partes;
    if (prefixo !== PREFIXO) return false;

    const N = Number(nTexto);
    const r = Number(rTexto);
    const p = Number(pTexto);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Teto defensivo: um N absurdo vindo do banco viraria exaustao de memoria.
    if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

    const salt = Buffer.from(saltB64, "base64");
    const esperado = Buffer.from(hashB64, "base64");
    if (salt.length === 0 || esperado.length === 0) return false;

    const obtido = await scrypt(normalizar(senha), salt, esperado.length, {
      N,
      r,
      p,
      maxmem: MAX_MEMORIA,
    });

    // timingSafeEqual exige mesmo tamanho -- garantido pelo esperado.length acima.
    return timingSafeEqual(obtido, esperado);
  } catch {
    return false;
  }
}
