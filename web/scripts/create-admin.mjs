#!/usr/bin/env node
/**
 * Cria (ou atualiza) um usuario do Portal FinOps.
 *
 * Nao existe cadastro publico: este comando e o unico caminho para o primeiro
 * administrador. Credenciais vem SEMPRE do ambiente -- nunca de argumento de
 * linha de comando, que ficaria visivel no `ps` e no historico do shell.
 *
 * Uso local (com node_modules disponivel):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/create-admin.mjs
 *
 * Uso em producao, dentro do container (que ja tem PG_* no ambiente):
 *   docker exec -i -e ADMIN_EMAIL -e ADMIN_PASSWORD finops-portal \
 *     node scripts/create-admin.mjs
 *
 * Variaveis:
 *   ADMIN_EMAIL     (obrigatoria)
 *   ADMIN_PASSWORD  (obrigatoria, minimo 12 caracteres)
 *   ADMIN_NAME      (opcional)
 *   ADMIN_ROLE      (opcional: ADMIN | VIEWER -- padrao ADMIN)
 *   PG_HOST, PG_PORT, PG_DB, PG_USER, PG_PASSWORD
 *
 * Idempotente: rodar de novo para o mesmo e-mail redefine a senha e o papel.
 */

import pg from "pg";

import { hashPassword, MIN_TAMANHO_SENHA } from "../src/lib/auth/password.mjs";

const PAPEIS = ["ADMIN", "VIEWER"];

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor || valor.trim() === "") {
    falhar(`variavel de ambiente ${nome} e obrigatoria`);
  }
  return valor;
}

function falhar(mensagem) {
  console.error(`\nERRO: ${mensagem}\n`);
  process.exit(1);
}

async function main() {
  const email = exigir("ADMIN_EMAIL").trim();
  const senha = exigir("ADMIN_PASSWORD");
  const nome = process.env.ADMIN_NAME?.trim() || null;
  const papel = (process.env.ADMIN_ROLE || "ADMIN").trim().toUpperCase();

  // Validacao simples e suficiente: o objetivo e pegar erro de digitacao, nao
  // reimplementar a RFC 5322.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    falhar(`e-mail invalido: ${email}`);
  }
  if (senha.length < MIN_TAMANHO_SENHA) {
    falhar(`a senha precisa de ao menos ${MIN_TAMANHO_SENHA} caracteres`);
  }
  if (!PAPEIS.includes(papel)) {
    falhar(`ADMIN_ROLE deve ser ${PAPEIS.join(" ou ")} -- recebido: ${papel}`);
  }

  const cliente = new pg.Client({
    host: exigir("PG_HOST"),
    port: Number(process.env.PG_PORT ?? 5432),
    database: exigir("PG_DB"),
    user: exigir("PG_USER"),
    password: exigir("PG_PASSWORD"),
    application_name: "finops-create-admin",
    connectionTimeoutMillis: 10_000,
  });

  await cliente.connect();

  try {
    const hash = await hashPassword(senha);

    const { rows } = await cliente.query(
      `INSERT INTO app_users (email, password_hash, name, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (lower(email)) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name          = coalesce(EXCLUDED.name, app_users.name),
             role          = EXCLUDED.role,
             active        = true,
             updated_at    = now()
       RETURNING id, email, name, role, active, created_at, updated_at,
                 (created_at = updated_at) AS recem_criado`,
      [email, hash, nome, papel],
    );

    const u = rows[0];

    // Trocar a senha invalida as sessoes existentes daquele usuario.
    const { rowCount: sessoesEncerradas } = await cliente.query(
      `DELETE FROM app_sessions WHERE user_id = $1`,
      [u.id],
    );

    console.log("");
    console.log(u.recem_criado ? "Usuario CRIADO:" : "Usuario ATUALIZADO:");
    console.log(`  id      : ${u.id}`);
    console.log(`  e-mail  : ${u.email}`);
    console.log(`  nome    : ${u.name ?? "(nao informado)"}`);
    console.log(`  papel   : ${u.role}`);
    console.log(`  ativo   : ${u.active}`);
    if (sessoesEncerradas > 0) {
      console.log(`  sessoes encerradas: ${sessoesEncerradas} (senha alterada)`);
    }
    console.log("");
    console.log("A senha nao e exibida nem registrada em log.");
    console.log("");
  } finally {
    await cliente.end();
  }
}

main().catch((erro) => {
  // Mensagens uteis para os erros previsiveis, sem vazar credencial.
  if (erro?.code === "42P01") {
    falhar(
      "tabela app_users nao existe. Rode antes: scripts/create-auth-tables.sql",
    );
  }
  if (erro?.code === "42501") {
    falhar(
      "sem permissao em app_users. Rode scripts/create-auth-tables.sql, que concede os GRANTs.",
    );
  }
  if (erro?.code === "ECONNREFUSED" || erro?.code === "ENOTFOUND") {
    falhar(`nao consegui conectar no PostgreSQL (${erro.code}). Confira PG_HOST/PG_PORT.`);
  }
  falhar(erro?.message ?? String(erro));
});
