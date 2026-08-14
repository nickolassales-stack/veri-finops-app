import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { query } from "@/lib/database";

import { getSessao, requireSessao } from "./dal";
import {
  can,
  ehPermissaoConhecida,
  type Autorizacao,
  type Permissao,
} from "./permissoes";
import type { Sessao } from "./session";

/**
 * Resolucao das permissoes do usuario da requisicao.
 *
 * `cache` do React memoiza por requisicao: layout, pagina e componentes podem
 * perguntar a vontade sem multiplicar consulta.
 */

const VAZIO: ReadonlySet<Permissao> = new Set();

/**
 * Permissoes concedidas pelos grupos ATIVOS do usuario.
 *
 * DEGRADA FECHADO se as tabelas de grupo nao existirem (42P01, migracao 002
 * ainda nao aplicada): devolve conjunto vazio em vez de estourar.
 *
 * Isso e o oposto da decisao tomada na migracao 001 -- la o fallback silencioso
 * foi recusado, aqui e adotado -- e a diferenca importa. La, seguir sem a coluna
 * exibiria um NUMERO ERRADO como se fosse certo. Aqui, seguir sem a tabela so
 * concede MENOS acesso: o ADMIN continua entrando por curto-circuito de papel,
 * o VIEWER mantem o piso, e ninguem ganha nada a que nao teria direito. Falha
 * fechada e segura; numero errado nao e.
 */
async function carregarPermissoesDeGrupo(userId: string): Promise<ReadonlySet<Permissao>> {
  try {
    const linhas = await query<{ permission: string }>(
      `SELECT DISTINCT p.permission
         FROM app_user_groups       ug
         JOIN app_groups            g ON g.id = ug.group_id AND g.active
         JOIN app_group_permissions p ON p.group_id = g.id
        WHERE ug.user_id = $1`,
      [userId],
    );

    // Filtra contra o catalogo: permissao que o codigo nao conhece nao decide nada.
    return new Set(linhas.map((l) => l.permission).filter(ehPermissaoConhecida));
  } catch (err) {
    const codigo =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;

    if (codigo === "42P01") {
      console.warn(
        "[auth] tabelas de grupo ausentes -- rode scripts/migrations/002-admin-configuracoes.sql. " +
          "Seguindo apenas com as permissoes do papel.",
      );
      return VAZIO;
    }
    throw err;
  }
}

/** Autorizacao do usuario da requisicao, ou `null` se nao ha sessao. */
export const getAutorizacao = cache(async (): Promise<Autorizacao | null> => {
  const sessao = await getSessao();
  if (!sessao) return null;

  // ADMIN pode tudo por curto-circuito. Evitar a consulta aqui nao e so
  // economia: mantem o administrador capaz de entrar na area de configuracoes
  // para CONSERTAR grupos, mesmo que a tabela de grupos esteja indisponivel.
  if (sessao.papel === "ADMIN") {
    return { papel: sessao.papel, permissoes: VAZIO };
  }

  return {
    papel: sessao.papel,
    permissoes: await carregarPermissoesDeGrupo(sessao.userId),
  };
});

/** Pergunta de autorizacao para a requisicao atual. Sem sessao, sempre `false`. */
export async function podeAtual(permissao: Permissao): Promise<boolean> {
  const autorizacao = await getAutorizacao();
  return autorizacao ? can(autorizacao, permissao) : false;
}

/**
 * Exige uma permissao numa PAGINA.
 *
 * Sem sessao vai para /login (via `requireSessao`); com sessao e sem a
 * permissao, vai para /sem-permissao -- tela amigavel, nao erro cru.
 */
export async function requirePermissao(
  permissao: Permissao,
  caminhoAtual?: string,
): Promise<Sessao> {
  const sessao = await requireSessao(caminhoAtual);

  if (!(await podeAtual(permissao))) {
    redirect(`/sem-permissao?requer=${encodeURIComponent(permissao)}`);
  }

  return sessao;
}
