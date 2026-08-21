import { z } from "zod";

import { MIN_TAMANHO_SENHA } from "./password.mjs";

/**
 * Regras de troca de senha, isoladas num modulo puro para poderem ser testadas
 * sem banco, sem cookie e sem contexto de requisicao.
 */

export const esquemaTrocaSenha = z
  .object({
    senhaAtual: z.string().min(1, "Informe a senha atual."),
    novaSenha: z
      .string()
      .min(
        MIN_TAMANHO_SENHA,
        `A nova senha precisa de ao menos ${MIN_TAMANHO_SENHA} caracteres.`,
      )
      .max(1024, "A nova senha e longa demais."),
    confirmacao: z.string().min(1, "Confirme a nova senha."),
  })
  .refine((d) => d.novaSenha === d.confirmacao, {
    path: ["confirmacao"],
    message: "A confirmacao nao confere com a nova senha.",
  })
  .refine((d) => d.novaSenha !== d.senhaAtual, {
    path: ["novaSenha"],
    message: "A nova senha precisa ser diferente da atual.",
  });

export type DadosTrocaSenha = z.infer<typeof esquemaTrocaSenha>;

/** Devolve a primeira mensagem de erro, ou `null` quando os dados sao validos. */
export function validarTrocaSenha(dados: unknown): string | null {
  const r = esquemaTrocaSenha.safeParse(dados);
  if (r.success) return null;
  return r.error.issues[0]?.message ?? "Dados invalidos.";
}
