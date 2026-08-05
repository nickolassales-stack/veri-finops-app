/**
 * Tipos de auth sem nenhuma dependencia de runtime.
 *
 * Separados de `session.ts` (que carrega `server-only` e o driver `pg`) para
 * poderem ser usados tambem por componentes de cliente sem risco de arrastar
 * codigo de servidor para o bundle do navegador.
 */
export type Papel = "ADMIN" | "VIEWER";

export const PAPEIS: readonly Papel[] = ["ADMIN", "VIEWER"] as const;
