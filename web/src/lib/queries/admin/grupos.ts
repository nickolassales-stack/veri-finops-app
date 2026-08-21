import "server-only";

import { ErroDeApi } from "@/lib/api/http";
import { ehPermissaoConhecida, type Permissao } from "@/lib/auth/permissoes";
import { getPool, query } from "@/lib/database";

/**
 * Grupos e as permissoes que eles concedem.
 *
 * Grupo CONCEDE, nunca revoga. Nao ha permissao negativa, e isso e deliberado:
 * com negacao, responder "por que fulano nao consegue exportar?" vira uma
 * investigacao pela intersecao de varios grupos. Sem ela, a resposta e a uniao
 * -- basta procurar quem concede.
 */

export type GrupoAdministravel = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  membros: number;
  permissoes: Permissao[];
  criadoEm: string;
};

type LinhaGrupo = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  membros: string;
  permissoes: string[] | null;
  created_at: Date;
};

const SELECAO = `
  g.id, g.name, g.description, g.active, g.created_at,
  (SELECT count(*) FROM app_user_groups ug WHERE ug.group_id = g.id) AS membros,
  coalesce(
    (SELECT array_agg(p.permission ORDER BY p.permission)
       FROM app_group_permissions p WHERE p.group_id = g.id),
    ARRAY[]::text[]
  ) AS permissoes
`;

function mapear(l: LinhaGrupo): GrupoAdministravel {
  return {
    id: String(l.id),
    nome: l.name,
    descricao: l.description,
    ativo: l.active,
    membros: Number(l.membros),
    // Filtra contra o catalogo: permissao que o codigo nao conhece mais nao
    // deve aparecer na tela como se ainda decidisse alguma coisa.
    permissoes: (l.permissoes ?? []).filter(ehPermissaoConhecida),
    criadoEm: l.created_at.toISOString(),
  };
}

export async function listarGrupos(): Promise<GrupoAdministravel[]> {
  const linhas = await query<LinhaGrupo>(
    `SELECT ${SELECAO} FROM app_groups g ORDER BY g.active DESC, lower(g.name) ASC`,
  );
  return linhas.map(mapear);
}

async function buscar(id: string): Promise<GrupoAdministravel> {
  const linhas = await query<LinhaGrupo>(
    `SELECT ${SELECAO} FROM app_groups g WHERE g.id = $1`,
    [id],
  );
  if (linhas.length === 0) {
    throw new ErroDeApi("nao-encontrado", "Grupo nao encontrado.");
  }
  return mapear(linhas[0]);
}

// -------------------------------------------------------------------- criar

export async function criarGrupo(dados: {
  nome: string;
  descricao?: string | null;
  ativo?: boolean;
}): Promise<GrupoAdministravel> {
  const linhas = await query<{ id: string }>(
    `INSERT INTO app_groups (name, description, active)
     VALUES ($1, $2, $3)
     -- Casa com o indice unico sobre lower(btrim(name)).
     ON CONFLICT (lower(btrim(name))) DO NOTHING
     RETURNING id`,
    [dados.nome.trim(), dados.descricao?.trim() || null, dados.ativo ?? true],
  );

  if (linhas.length === 0) {
    throw new ErroDeApi("conflito", "Ja existe um grupo com este nome.");
  }
  return await buscar(linhas[0].id);
}

// ---------------------------------------------------------------- atualizar

export async function atualizarGrupo(
  id: string,
  dados: { nome?: string; descricao?: string | null; ativo?: boolean },
): Promise<GrupoAdministravel> {
  try {
    const resultado = await query(
      `UPDATE app_groups
          SET name        = CASE WHEN $2 THEN $3          ELSE name        END,
              description = CASE WHEN $4 THEN $5          ELSE description END,
              active      = CASE WHEN $6 THEN $7::boolean ELSE active      END,
              updated_at  = now()
        WHERE id = $1
        RETURNING id`,
      [
        id,
        dados.nome !== undefined,
        dados.nome?.trim() ?? null,
        Object.hasOwn(dados, "descricao"),
        dados.descricao?.trim() || null,
        dados.ativo !== undefined,
        dados.ativo ?? null,
      ],
    );
    if (resultado.length === 0) {
      throw new ErroDeApi("nao-encontrado", "Grupo nao encontrado.");
    }
  } catch (err) {
    // 23505 = unique_violation. Renomear para um nome ja usado e erro do
    // usuario, nao defeito -- merece 409 com explicacao, nao 500.
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      throw new ErroDeApi("conflito", "Ja existe um grupo com este nome.");
    }
    throw err;
  }

  return await buscar(id);
}

// ----------------------------------------------------------------- permissoes

/**
 * Substitui o conjunto de permissoes do grupo.
 *
 * Substituicao total e nao incremental: a tela manda o estado completo das
 * caixas marcadas, e o que nao veio foi desmarcado de proposito. Numa
 * transacao, para que ninguem consiga observar o grupo com zero permissoes no
 * meio da troca.
 */
export async function definirPermissoesDoGrupo(
  id: string,
  permissoes: Permissao[],
): Promise<GrupoAdministravel> {
  const pool = getPool();
  const conexao = await pool.connect();
  try {
    await conexao.query("BEGIN");

    const existe = await conexao.query(`SELECT 1 FROM app_groups WHERE id = $1`, [id]);
    if (existe.rowCount === 0) {
      await conexao.query("ROLLBACK");
      throw new ErroDeApi("nao-encontrado", "Grupo nao encontrado.");
    }

    await conexao.query(`DELETE FROM app_group_permissions WHERE group_id = $1`, [id]);

    if (permissoes.length > 0) {
      await conexao.query(
        `INSERT INTO app_group_permissions (group_id, permission)
         SELECT $1, unnest($2::text[])`,
        [id, permissoes],
      );
    }

    await conexao.query("COMMIT");
  } catch (err) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    conexao.release();
  }

  return await buscar(id);
}
