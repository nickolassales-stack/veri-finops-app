import { analisar } from "@/lib/api/http";
import { rotaSomenteAdmin } from "@/lib/api/rota";
import { esquemaTesteCredencialOvh } from "@/lib/filtros/esquemas-credenciais";
import { testarCredencialAvulsa } from "@/lib/services/credenciais-ovh";

/**
 * POST /api/admin/ovh/test-credentials -- testa credencial SEM conta cadastrada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE FORA DE /accounts/:id/
 *
 * As outras rotas de credencial vivem sob um `accountId` porque operam sobre uma
 * conta existente. Esta nao tem conta: ela serve ao formulario de "Adicionar
 * conta OVH", em que testar antes de salvar e o ponto -- gravar primeiro deixaria
 * uma credencial invalida no banco e um cadastro que ninguem quis.
 *
 * Pendura-la num `accountId` que ainda nao existe exigiria inventar um id de
 * fantasia na URL, e a rota teria de decidir ignora-lo. Um caminho sem conta diz
 * a verdade sobre o que ela faz.
 *
 * ---------------------------------------------------------------------------
 * NAO PERSISTE NADA
 *
 * Nenhuma linha criada, nenhum status atualizado. O unico efeito e um GET /me na
 * API da OVH. O segredo chega no corpo, e o que volta e ok/mensagem/nichandle --
 * nunca a credencial.
 *
 * SOMENTE ADMIN, pelo mesmo motivo das demais: `can()` da tudo ao ADMIN mas
 * deixa qualquer grupo conceder qualquer permissao a um nao-ADMIN, entao nenhuma
 * permissao consegue expressar "so ADMIN". Ver lib/auth/permissoes.ts.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = rotaSomenteAdmin(
  "POST /api/admin/ovh/test-credentials",
  async ({ corpo }) => {
    const entrada = analisar(esquemaTesteCredencialOvh, corpo);
    return { dados: await testarCredencialAvulsa(entrada) };
  },
);
