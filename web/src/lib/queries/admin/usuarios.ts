import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import { hashPassword } from "@/lib/auth/password.mjs";
import { destruirSessoesDoUsuario } from "@/lib/auth/session";
import type { Papel } from "@/lib/auth/tipos";
import { getPool, query, queryOne } from "@/lib/database";

/**
 * Usuarios da area administrativa.
 *
 * Nada aqui devolve `password_hash`. Nao e so uma questao de nao exibir: o
 * campo nem sai do banco, entao nao existe caminho -- log, serializacao,
 * resposta de erro -- por onde ele possa escapar.
 */

export type UsuarioAdministravel = {
  id: string;
  nome: string | null;
  email: string;
  papel: Papel;
  ativo: boolean;
  ultimoLoginEm: string | null;
  criadoEm: string;
  grupos: { id: string; nome: string }[];
};

type LinhaUsuario = {
  id: string;
  name: string | null;
  email: string;
  role: Papel;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  grupos: { id: string; nome: string }[] | null;
};

/**
 * `LEFT JOIN LATERAL` com agregacao JSON em vez de duas consultas: traz os
 * grupos de cada usuario numa ida so. O `FILTER` descarta a linha nula que o
 * LEFT JOIN produz para quem nao tem grupo -- sem ele, o resultado seria
 * `[{id: null, nome: null}]` em vez de lista vazia.
 */
const SELECAO = `
  u.id, u.name, u.email, u.role, u.active, u.last_login_at, u.created_at,
  coalesce(
    (SELECT json_agg(json_build_object('id', g.id::text, 'nome', g.name) ORDER BY g.name)
       FROM app_user_groups ug
       JOIN app_groups g ON g.id = ug.group_id
      WHERE ug.user_id = u.id),
    '[]'::json
  ) AS grupos
`;

function mapear(l: LinhaUsuario): UsuarioAdministravel {
  return {
    id: String(l.id),
    nome: l.name,
    email: l.email,
    papel: l.role,
    ativo: l.active,
    ultimoLoginEm: l.last_login_at?.toISOString() ?? null,
    criadoEm: l.created_at.toISOString(),
    grupos: l.grupos ?? [],
  };
}

export async function listarUsuarios(): Promise<UsuarioAdministravel[]> {
  const linhas = await query<LinhaUsuario>(
    `SELECT ${SELECAO} FROM app_users u ORDER BY u.active DESC, lower(u.email) ASC`,
  );
  return linhas.map(mapear);
}

async function buscar(id: string): Promise<UsuarioAdministravel> {
  const linhas = await query<LinhaUsuario>(
    `SELECT ${SELECAO} FROM app_users u WHERE u.id = $1`,
    [id],
  );
  if (linhas.length === 0) {
    throw new ErroDeApi("nao-encontrado", "Usuario nao encontrado.");
  }
  return mapear(linhas[0]);
}

// -------------------------------------------------------------------- criar

export type NovoUsuario = {
  nome: string;
  email: string;
  senhaInicial: string;
  papel: Papel;
  ativo: boolean;
  grupos: string[];
};

export async function criarUsuario(dados: NovoUsuario): Promise<UsuarioAdministravel> {
  const hash = await hashPassword(dados.senhaInicial);

  // Transacao: usuario e vinculos entram juntos ou nao entram. Um usuario que
  // nascesse sem os grupos escolhidos ficaria sem acesso nenhum e daria a
  // impressao de que a criacao falhou.
  const pool = getPool();
  const conexao = await pool.connect();
  try {
    await conexao.query("BEGIN");

    const inseridos = await conexao.query<{ id: string }>(
      `INSERT INTO app_users (email, password_hash, name, role, active)
       VALUES ($1, $2, $3, $4, $5)
       -- O indice unico e sobre lower(email); o ON CONFLICT precisa citar a
       -- MESMA expressao para casar com ele.
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id`,
      [dados.email.trim(), hash, dados.nome.trim() || null, dados.papel, dados.ativo],
    );

    if (inseridos.rows.length === 0) {
      await conexao.query("ROLLBACK");
      throw new ErroDeApi("conflito", "Ja existe usuario com este e-mail.");
    }

    const id = inseridos.rows[0].id;
    if (dados.grupos.length > 0) {
      await conexao.query(
        `INSERT INTO app_user_groups (user_id, group_id)
         SELECT $1, g.id FROM app_groups g WHERE g.id = ANY($2::bigint[])`,
        [id, dados.grupos],
      );
    }

    await conexao.query("COMMIT");
    return await buscar(id);
  } catch (err) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conexao.release();
  }
}

// --------------------------------------------------------------- atualizar

export type AtualizacaoDeUsuario = {
  nome?: string | null;
  papel?: Papel;
  ativo?: boolean;
  grupos?: string[];
};

/**
 * Protecoes contra o administrador se trancar do lado de fora.
 *
 * Duas regras, e as duas existem porque o estrago e IRREVERSIVEL PELA TELA: um
 * sistema sem nenhum ADMIN ativo so volta por acesso direto ao banco.
 *
 *   1. Ninguem desativa nem rebaixa a si mesmo. E o erro de clique classico, e
 *      a vitima e sempre quem esta com a tela aberta.
 *   2. Ninguem desativa nem rebaixa o ULTIMO ADMIN ativo, mesmo sendo outra
 *      pessoa. A regra 1 sozinha nao cobre isto: com dois administradores, cada
 *      um pode derrubar o outro e o segundo a clicar deixa o sistema sem
 *      nenhum.
 */
async function garantirQueRestaAdmin(
  idAlvo: string,
  idAtual: string,
  mudanca: AtualizacaoDeUsuario,
): Promise<void> {
  const perdeAdmin = mudanca.ativo === false || (mudanca.papel && mudanca.papel !== "ADMIN");
  if (!perdeAdmin) return;

  const alvo = await queryOne<{ role: Papel; active: boolean }>(
    `SELECT role, active FROM app_users WHERE id = $1`,
    [idAlvo],
  );
  if (alvo.role !== "ADMIN" || !alvo.active) return;

  if (idAlvo === idAtual) {
    throw new ErroDeApi(
      "conflito",
      mudanca.ativo === false
        ? "Voce nao pode desativar a propria conta."
        : "Voce nao pode remover o proprio perfil de administrador.",
    );
  }

  const restantes = await queryOne<{ total: string }>(
    `SELECT count(*) AS total FROM app_users WHERE role = 'ADMIN' AND active AND id <> $1`,
    [idAlvo],
  );
  if (Number(restantes.total) === 0) {
    throw new ErroDeApi(
      "conflito",
      "Este e o unico administrador ativo. Promova outro antes de alterar este.",
    );
  }
}

export async function atualizarUsuario(
  id: string,
  dados: AtualizacaoDeUsuario,
  idUsuarioAtual: string,
): Promise<UsuarioAdministravel> {
  await garantirQueRestaAdmin(id, idUsuarioAtual, dados);

  const pool = getPool();
  const conexao = await pool.connect();
  try {
    await conexao.query("BEGIN");

    const atualizados = await conexao.query(
      `UPDATE app_users
          SET name   = CASE WHEN $2 THEN $3         ELSE name   END,
              role   = CASE WHEN $4 THEN $5::text   ELSE role   END,
              active = CASE WHEN $6 THEN $7::boolean ELSE active END,
              updated_at = now()
        WHERE id = $1`,
      [
        id,
        Object.hasOwn(dados, "nome"),
        dados.nome?.trim() || null,
        dados.papel !== undefined,
        dados.papel ?? null,
        dados.ativo !== undefined,
        dados.ativo ?? null,
      ],
    );

    if (atualizados.rowCount === 0) {
      await conexao.query("ROLLBACK");
      throw new ErroDeApi("nao-encontrado", "Usuario nao encontrado.");
    }

    // Substituicao total, nao merge: a tela envia o conjunto completo de grupos
    // e o que nao veio foi tirado de proposito.
    if (dados.grupos !== undefined) {
      await conexao.query(`DELETE FROM app_user_groups WHERE user_id = $1`, [id]);
      if (dados.grupos.length > 0) {
        await conexao.query(
          `INSERT INTO app_user_groups (user_id, group_id)
           SELECT $1, g.id FROM app_groups g WHERE g.id = ANY($2::bigint[])`,
          [id, dados.grupos],
        );
      }
    }

    await conexao.query("COMMIT");
  } catch (err) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conexao.release();
  }

  // Desativar tem de EXPULSAR. Sem isto, a sessao ja aberta continuaria valendo
  // ate expirar -- desativar viraria um pedido educado.
  if (dados.ativo === false) {
    await destruirSessoesDoUsuario(id);
  }

  return await buscar(id);
}
