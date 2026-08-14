/**
 * Situacoes de pagamento de uma conta AWS.
 *
 * ARQUIVO PURO, E ISSO E O PONTO. Estas constantes sao usadas pelo esquema Zod
 * (servidor) E pelo formulario de contas (cliente). Elas moravam em
 * `esquemas-admin.ts`, que importa `MIN_TAMANHO_SENHA` de `password.mjs` -- e
 * `password.mjs` executa `promisify(scrypt)` na avaliacao do modulo.
 *
 * Resultado: o componente de cliente puxava `node:crypto` para o bundle do
 * navegador e a tela morria com
 *
 *     TypeError: The "original" argument must be of type Function
 *
 * A rota de API nao sentia nada, porque la o modulo roda no servidor. Por isso
 * o que os dois lados compartilham fica AQUI, sem nenhuma dependencia.
 */

export const PAGAMENTOS = ["em_dia", "pendente", "atrasado", "isento"] as const;

export type SituacaoDePagamento = (typeof PAGAMENTOS)[number];

export const ROTULO_PAGAMENTO: Record<SituacaoDePagamento, string> = {
  em_dia: "Em dia",
  pendente: "Pendente",
  atrasado: "Atrasado",
  isento: "Isento",
};
