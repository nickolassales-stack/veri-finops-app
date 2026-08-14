import { z } from "zod";

import { MIN_TAMANHO_SENHA } from "@/lib/auth/password.mjs";
import { PERMISSOES } from "@/lib/auth/permissoes";
import { PAPEIS } from "@/lib/auth/tipos";

/**
 * Validacao de tudo que a area administrativa recebe.
 *
 * Vale a mesma regra do resto do sistema: o resultado destes esquemas e a UNICA
 * coisa que a camada de query aceita. Aqui, porem, quase todo valor vira
 * PARAMETRO de query -- nao ha nome de coluna vindo do usuario --, entao a
 * validacao serve para dar erro claro e limitar tamanho, nao para evitar
 * injecao: disso o placeholder ja cuida.
 *
 * `.strict()` nos objetos de corpo: campo desconhecido e ERRO, nao algo a
 * ignorar em silencio. Um PATCH com `{ativa: true}` em vez de `{ativo: true}`
 * deve falhar dizendo o que esta errado, e nao responder 200 sem ter mudado
 * nada -- que e o jeito mais rapido de alguem concluir que a tela esta quebrada.
 */

const texto = (max: number) => z.string().trim().max(max);

/** Campo textual opcional: `null` e "" significam a mesma coisa -- apagar. */
const textoOpcional = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((v) => (v === null || v === "" ? null : v));

// ------------------------------------------------------------------- contas

/**
 * IDENTIDADE da conta -- e so isso.
 *
 * `invoiceCloseDay` e `paymentStatus` SAIRAM daqui na entrega de faturamento.
 * Eles moram nas mesmas colunas, mas passaram a ser editados por
 * `/api/billing/settings` e `/api/billing/status`, que exigem `billing:manage`.
 *
 * O motivo e de permissao, nao de arrumacao: enquanto o dia de fechamento
 * estava neste PATCH, quem tinha `settings:accounts` alterava dado de
 * faturamento sem ter `billing:manage`. Duas portas para o mesmo campo, com
 * exigencias diferentes, e um buraco que so aparece quando alguem usa a porta
 * errada -- e a tela de faturamento afirma que o registro tem dono.
 */
export const esquemaPatchConta = z
  .object({
    alias: textoOpcional(120).optional(),
    businessUnit: textoOpcional(120).optional(),
    costCenter: textoOpcional(120).optional(),
    environment: textoOpcional(60).optional(),
  })
  .strict()
  // PATCH vazio nao e erro de sintaxe, mas e quase certamente erro de uso: a
  // tela nao deveria disparar requisicao sem nada a salvar.
  .refine((o) => Object.keys(o).length > 0, "Informe ao menos um campo para alterar.");

// ----------------------------------------------------------------- usuarios

/**
 * Lista de ids de grupo. Chega como string do formulario e vira string aqui
 * mesmo: `app_groups.id` e `bigint`, que nao cabe em `number` com garantia, e o
 * driver aceita string sem perda.
 */
const idsDeGrupo = z.array(z.string().regex(/^\d{1,19}$/, "Id de grupo invalido")).max(50);

export const esquemaNovoUsuario = z
  .object({
    nome: texto(160).min(1, "Informe o nome"),
    // Sem `z.email()`: o cadastro e feito por um ADMIN que sabe o endereco, e um
    // validador rigido recusa formas legitimas (subdominio interno, TLD novo).
    // O que importa e ter arroba e nao ter espaco.
    email: texto(320)
      .min(3, "Informe o e-mail")
      .refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), "E-mail invalido"),
    senhaInicial: z
      .string()
      .min(MIN_TAMANHO_SENHA, `A senha inicial precisa de ao menos ${MIN_TAMANHO_SENHA} caracteres.`)
      .max(1024),
    papel: z.enum(PAPEIS as unknown as [string, ...string[]]).default("VIEWER"),
    ativo: z.boolean().default(true),
    grupos: idsDeGrupo.default([]),
  })
  .strict();

export const esquemaPatchUsuario = z
  .object({
    nome: textoOpcional(160).optional(),
    papel: z.enum(PAPEIS as unknown as [string, ...string[]]).optional(),
    ativo: z.boolean().optional(),
    grupos: idsDeGrupo.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "Informe ao menos um campo para alterar.");

// ------------------------------------------------------------------- grupos

export const esquemaNovoGrupo = z
  .object({
    nome: texto(80).min(1, "Informe o nome do grupo"),
    descricao: textoOpcional(280).optional(),
    ativo: z.boolean().default(true),
  })
  .strict();

export const esquemaPatchGrupo = z
  .object({
    nome: texto(80).min(1, "Informe o nome do grupo").optional(),
    descricao: textoOpcional(280).optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "Informe ao menos um campo para alterar.");

export const esquemaPermissoes = z
  .object({
    // Lista fechada vinda do catalogo em codigo. Permissao inventada nao chega
    // ao banco -- e sem isto a tabela viraria deposito de string sem sentido.
    permissoes: z.array(z.enum(PERMISSOES)).max(PERMISSOES.length),
  })
  .strict();

/** `account_id` e `varchar(20)`; o cadastro e livre, entao nao exigimos 12 digitos. */
export const esquemaIdDeConta = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,20}$/, "Identificador de conta invalido");

export const esquemaIdNumerico = z.string().regex(/^\d{1,19}$/, "Identificador invalido");
