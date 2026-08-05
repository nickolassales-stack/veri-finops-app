/**
 * Nome do cookie de sessao, isolado num modulo sem dependencia.
 *
 * O `proxy.ts` precisa desta constante, e importar de `session.ts` arrastaria
 * `server-only`, `next/headers` e o driver `pg` para o bundle do proxy.
 */
export const NOME_COOKIE = "veri_finops_session";
