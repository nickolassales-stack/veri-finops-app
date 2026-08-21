import { analisar } from "@/lib/api/http";
import { rotaComPermissao } from "@/lib/api/rota";
import type { Papel } from "@/lib/auth/tipos";
import { esquemaNovoUsuario } from "@/lib/filtros/esquemas-admin";
import { criarUsuario, listarUsuarios } from "@/lib/queries/admin/usuarios";

/**
 * GET  /api/admin/users -- listagem.
 * POST /api/admin/users -- criacao pelo ADMIN.
 *
 * Nao existe cadastro publico: esta e a UNICA porta de entrada de usuario no
 * sistema, e ela exige `settings:users`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/admin/users",
  "settings:users",
  async () => {
    const usuarios = await listarUsuarios();
    return {
      dados: usuarios,
      meta: {
        total: usuarios.length,
        ativos: usuarios.filter((u) => u.ativo).length,
      },
    };
  },
);

export const POST = rotaComPermissao(
  "POST /api/admin/users",
  "settings:users",
  async ({ corpo }) => {
    const entrada = analisar(esquemaNovoUsuario, corpo);

    return {
      dados: await criarUsuario({
        nome: entrada.nome,
        email: entrada.email,
        senhaInicial: entrada.senhaInicial,
        papel: entrada.papel as Papel,
        ativo: entrada.ativo,
        grupos: entrada.grupos,
      }),
    };
  },
);
