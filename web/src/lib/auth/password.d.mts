/** Tipos para `password.mjs` -- implementacao unica em ESM puro. */

export declare const PARAMETROS: Readonly<{
  N: number;
  r: number;
  p: number;
  tamanhoChave: number;
  tamanhoSalt: number;
}>;

export declare const MIN_TAMANHO_SENHA: number;

/** Gera `scrypt$N$r$p$salt$hash`. Lanca se a senha for curta demais. */
export declare function hashPassword(senha: string): Promise<string>;

/** Compara em tempo constante. Nunca lanca: formato invalido devolve `false`. */
export declare function verifyPassword(
  senha: string,
  armazenado: string,
): Promise<boolean>;
