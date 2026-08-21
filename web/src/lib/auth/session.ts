import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { query, queryOne } from "@/lib/database";
import { getEnv } from "@/lib/env";

/**
 * Sessao opaca persistida em `app_sessions`.
 *
 * O cookie carrega um token aleatorio de 32 bytes. No banco guardamos apenas o
 * SHA-256 desse token, nunca o token: um dump do banco (ou um SELECT via
 * Metabase) nao entrega sessao utilizavel.
 *
 * SHA-256 sem salt e proposital aqui e diferente do caso senha: o token tem 256
 * bits de entropia aleatoria, entao nao existe espaco de busca para dicionario
 * ou rainbow table. Salt/KDF resolveriam um problema que nao existe e custariam
 * latencia em toda requisicao autenticada.
 */

// Importado (e nao apenas reexportado) porque as funcoes abaixo usam a constante.
import { NOME_COOKIE } from "./cookie-name";
import type { Papel } from "./tipos";

export { NOME_COOKIE };
export type { Papel };

const TAMANHO_TOKEN = 32;

export type Sessao = {
  userId: string;
  email: string;
  nome: string | null;
  papel: Papel;
  expiraEm: Date;
};

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

// --------------------------------------------------------------------- criar

export async function criarSessao(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const env = getEnv();
  const token = randomBytes(TAMANHO_TOKEN).toString("base64url");
  const expiraEm = new Date(Date.now() + env.AUTH_SESSION_TTL_HOURS * 3600_000);

  await query(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      hashToken(token),
      userId,
      expiraEm,
      // inet invalido derrubaria o login; deixamos NULL quando nao da para confiar.
      normalizarIp(meta.ip),
      meta.userAgent?.slice(0, 500) ?? null,
    ],
  );

  const jar = await cookies();
  jar.set(NOME_COOKIE, token, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    // `lax` e nao `strict`: com strict, chegar por link externo nao enviaria o
    // cookie e o usuario cairia no login mesmo com sessao valida.
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });
}

// ----------------------------------------------------------------------- ler

/**
 * Le e valida a sessao contra o banco. Devolve `null` quando nao ha cookie,
 * quando o token nao existe, quando expirou ou quando o usuario foi desativado.
 */
export async function lerSessao(): Promise<Sessao | null> {
  const jar = await cookies();
  const token = jar.get(NOME_COOKIE)?.value;
  if (!token) return null;

  const linhas = await query<{
    user_id: string;
    email: string;
    name: string | null;
    role: Papel;
    expires_at: Date;
  }>(
    `SELECT s.user_id, u.email, u.name, u.role, s.expires_at
       FROM app_sessions s
       JOIN app_users   u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.active
      LIMIT 1`,
    [hashToken(token)],
  );

  const linha = linhas[0];
  if (!linha) return null;

  return {
    userId: linha.user_id,
    email: linha.email,
    nome: linha.name,
    papel: linha.role,
    expiraEm: linha.expires_at,
  };
}

// -------------------------------------------------------------------- apagar

/** Logout: remove a linha da sessao e o cookie. */
export async function destruirSessaoAtual(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(NOME_COOKIE)?.value;

  if (token) {
    await query(`DELETE FROM app_sessions WHERE token_hash = $1`, [hashToken(token)]);
  }

  jar.delete(NOME_COOKIE);
}

/** Encerra todas as sessoes de um usuario (troca de senha, desativacao). */
export async function destruirSessoesDoUsuario(userId: string): Promise<void> {
  await query(`DELETE FROM app_sessions WHERE user_id = $1`, [userId]);
}

/**
 * Remove sessoes vencidas. Chamado de forma oportunista no login -- evita
 * depender de cron para uma tabela que cresce devagar.
 */
export async function limparSessoesExpiradas(): Promise<number> {
  const linhas = await query<{ removidas: string }>(
    `WITH apagadas AS (
       DELETE FROM app_sessions WHERE expires_at <= now() RETURNING 1
     )
     SELECT count(*) AS removidas FROM apagadas`,
  );
  return Number(linhas[0]?.removidas ?? 0);
}

// ------------------------------------------------------------------ usuarios

export type UsuarioAutenticavel = {
  id: string;
  email: string;
  name: string | null;
  role: Papel;
  password_hash: string;
};

export async function buscarUsuarioPorEmail(
  email: string,
): Promise<UsuarioAutenticavel | null> {
  const linhas = await query<UsuarioAutenticavel>(
    `SELECT id, email, name, role, password_hash
       FROM app_users
      WHERE lower(email) = lower($1) AND active
      LIMIT 1`,
    [email],
  );
  return linhas[0] ?? null;
}

/** Hash da senha atual, para reconferir a credencial antes de troca-la. */
export async function buscarHashDeSenha(userId: string): Promise<string | null> {
  const linhas = await query<{ password_hash: string }>(
    `SELECT password_hash FROM app_users WHERE id = $1 AND active LIMIT 1`,
    [userId],
  );
  return linhas[0]?.password_hash ?? null;
}

export async function atualizarSenha(userId: string, novoHash: string): Promise<void> {
  await query(
    `UPDATE app_users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, novoHash],
  );
}

/**
 * Encerra as OUTRAS sessoes do usuario, preservando a atual.
 *
 * Trocar a senha deve derrubar qualquer sessao aberta em outro navegador ou
 * dispositivo -- e o unico jeito de expulsar quem tenha roubado um cookie. Quem
 * esta trocando a senha continua logado, para nao ser jogado na tela de login
 * logo depois de acertar tudo.
 */
export async function destruirOutrasSessoes(userId: string): Promise<number> {
  const jar = await cookies();
  const token = jar.get(NOME_COOKIE)?.value;

  const linhas = token
    ? await query<{ removidas: string }>(
        `WITH apagadas AS (
           DELETE FROM app_sessions
            WHERE user_id = $1 AND token_hash <> $2
            RETURNING 1
         )
         SELECT count(*) AS removidas FROM apagadas`,
        [userId, hashToken(token)],
      )
    : await query<{ removidas: string }>(
        `WITH apagadas AS (
           DELETE FROM app_sessions WHERE user_id = $1 RETURNING 1
         )
         SELECT count(*) AS removidas FROM apagadas`,
        [userId],
      );

  return Number(linhas[0]?.removidas ?? 0);
}

export async function marcarLogin(userId: string): Promise<void> {
  await query(
    `UPDATE app_users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
    [userId],
  );
}

export async function contarUsuariosAtivos(): Promise<number> {
  const linha = await queryOne<{ total: string }>(
    `SELECT count(*) AS total FROM app_users WHERE active`,
  );
  return Number(linha.total);
}

// ---------------------------------------------------------------------- util

/** Aceita apenas o que o Postgres consegue guardar em `inet`. */
function normalizarIp(valor: string | null | undefined): string | null {
  if (!valor) return null;
  // x-forwarded-for pode vir como lista: o primeiro e o cliente original.
  const primeiro = valor.split(",")[0]?.trim() ?? "";
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-fA-F:]+$/;
  if (ipv4.test(primeiro) || (primeiro.includes(":") && ipv6.test(primeiro))) {
    return primeiro;
  }
  return null;
}

/**
 * Comparacao de strings em tempo constante, para o caso de precisar comparar
 * segredo fora do fluxo de senha.
 */
export function compararSegredos(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
