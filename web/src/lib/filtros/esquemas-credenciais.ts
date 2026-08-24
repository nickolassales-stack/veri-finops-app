import { z } from "zod";

import { ENDPOINTS_OVH } from "@/lib/ovh/endpoints";

/**
 * Validacao da entrada do bloco de credenciais OVH.
 *
 * Arquivo separado de `esquemas-admin.ts` de proposito: aquele importa
 * `password.mjs`, que arrasta `node:crypto`, e por isso nenhum componente de
 * cliente pode importa-lo (ha um comentario em `painel-contas.tsx` sobre
 * exatamente essa armadilha). Este e puro -- so `zod` e uma lista de strings --,
 * entao a tela pode reusar os limites de tamanho sem consequencia.
 *
 * ---------------------------------------------------------------------------
 * A REGRA CENTRAL: CAMPO VAZIO SIGNIFICA "MANTENHA O QUE ESTA GRAVADO"
 *
 * A tela nunca recebe o segredo de volta -- so mascara. Entao, ao reabrir o
 * formulario para trocar o endpoint, os campos de segredo aparecem em branco.
 * Se branco significasse "apague", editar o endpoint destruiria a credencial.
 *
 * `undefined` (campo ausente ou string vazia) = mantenha.
 * Valor presente = substitua.
 *
 * No PRIMEIRO cadastro nao ha o que manter, e ai os tres viram obrigatorios --
 * regra que o esquema nao consegue expressar sozinho, porque depende do banco.
 * Ela vive em `planejarGravacao`, em lib/credenciais/plano.ts.
 */

/**
 * Segredo opcional na EDICAO.
 *
 * O trim e a conversao de "" para `undefined` acontecem aqui, uma vez, e nao em
 * cada consumidor: um `" "` colado por acidente nao pode virar credencial de um
 * espaco, e um campo em branco tem de ser indistinguivel de campo ausente.
 *
 * O maximo de 512 nao e cosmetico. Sem teto, um POST com megabytes chegaria a
 * cifragem e ao banco. As chaves da OVH tem dezenas de caracteres; 512 e folga
 * generosa e ainda assim um limite.
 */
const segredo = (rotulo: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return undefined;
      const limpo = v.trim();
      return limpo === "" ? undefined : limpo;
    })
    .refine((v) => v === undefined || v.length <= 512, {
      message: `${rotulo} excede 512 caracteres.`,
    })
    // Espaco no meio e quebra de linha nao existem em credencial da OVH e sao o
    // sintoma classico de copiar-e-colar torto. Recusar aqui poupa uma ida a API
    // que voltaria com "credencial invalida" e mandaria gerar chave nova.
    .refine((v) => v === undefined || !/\s/.test(v), {
      message: `${rotulo} nao pode conter espaco ou quebra de linha -- confira o que foi colado.`,
    });

export const esquemaCredencialOvh = z
  .object({
    endpoint: z.enum(ENDPOINTS_OVH, {
      error: () => `endpoint deve ser um de: ${ENDPOINTS_OVH.join(", ")}.`,
    }),
    applicationKey: segredo("Application Key"),
    applicationSecret: segredo("Application Secret"),
    consumerKey: segredo("Consumer Key"),
  })
  .strict();

export type EntradaCredencialOvh = z.output<typeof esquemaCredencialOvh>;

/**
 * Corpo do teste de conexao.
 *
 * Aceita os tres segredos porque "Testar conexao" tem de funcionar ANTES de
 * salvar -- e o pedido explicito, e e o comportamento certo: obrigar a gravar
 * para so depois descobrir que a credencial esta errada deixaria o banco com uma
 * credencial invalida e a tela com um erro que o operador nao pediu.
 *
 * Campo vazio aqui tambem significa "use o que esta gravado", o que permite
 * testar de novo uma credencial ja salva sem redigita-la.
 */
export const esquemaTesteCredencialOvh = esquemaCredencialOvh;

/**
 * A regra "no primeiro cadastro os tres sao obrigatorios" NAO esta aqui.
 *
 * Ela depende do banco (existe cadastro anterior?), e por isso Zod nao a
 * expressa. Mora em `lib/credenciais/plano.ts`, junto com a decisao de manter ou
 * substituir cada segredo -- as duas sao a mesma regra vista de dois angulos, e
 * separa-las convidaria a corrigir uma e esquecer a outra.
 */

/**
 * Corpo do pedido de coleta.
 *
 * `action` tem padrao em vez de ser obrigatorio: o caso principal e o botao da
 * tela, que sempre pede `first_sync`, e exigir o campo faria o cliente repetir
 * uma constante. `.strict()` continua valendo -- campo desconhecido e recusado,
 * para que uma tentativa de mandar `status: "success"` daqui nao passe em
 * silencio.
 */
export const esquemaEnfileirarColeta = z
  .object({
    action: z.enum(["first_sync", "manual_sync"]).default("first_sync"),
  })
  .strict();

export type EntradaEnfileirarColeta = z.output<typeof esquemaEnfileirarColeta>;

/**
 * Escopo da coleta pedida pela tela de Diagnóstico.
 *
 * União DISCRIMINADA, e não `{ scope, accountId? }` com validação depois: assim
 * `scope: "all"` com `accountId` junto é recusado pelo próprio esquema, em vez de
 * passar e deixar o servidor decidir qual dos dois obedecer. Um payload que diz
 * duas coisas contraditórias é erro do cliente, não ambiguidade a resolver.
 *
 * O `account_id` é revalidado no servidor contra `cloud_accounts` — este regex só
 * garante que a string é plausível, nunca que a conta existe ou que é OVH.
 */
const idDeConta = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,20}$/, "Identificador de conta invalido");

export const esquemaColetaOvh = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }).strict(),
  z.object({ scope: z.literal("account"), accountId: idDeConta }).strict(),
]);

export type EntradaColetaOvh = z.output<typeof esquemaColetaOvh>;
