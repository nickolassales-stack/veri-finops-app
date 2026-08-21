import type { Provider } from "./esquemas";

/**
 * Decisao sobre conta de provedor incompativel com a tela.
 *
 * Modulo PURO de proposito, seguindo o mesmo arranjo de `lib/diagnostico/etl.ts`
 * e `lib/billing/pagamento.ts`: a regra fica testavel sem banco e sem
 * `server-only`, e `services/filtro-custo.ts` so decide o que fazer com o
 * resultado.
 */

export type ContaComProvider = {
  accountId: string;
  provider: string;
};

/**
 * Mensagem de recusa, ou `null` quando nao ha nada a recusar.
 *
 * POR QUE ISTO E ERRO E NAO AVISO
 *
 * Uma conta que nao existe no cadastro gera aviso: a tela abre com as outras
 * contas e o total esta apenas incompleto. Uma conta de OUTRO provedor e
 * diferente -- ela EXISTE no cadastro, entao passa em toda verificacao de
 * existencia, e nao tem uma unica linha nas tabelas AWS. O total sairia como
 * "US$ 0,00" com aparencia de resposta legitima, e quem le concluiria que a
 * conta nao gastou nada.
 *
 * A mensagem nomeia cada conta e o provedor dela. Dizer so "ha conta invalida"
 * obrigaria quem selecionou cinco contas a descobrir qual por tentativa e erro.
 */
export function mensagemDeProviderIncompativel(
  divergentes: ContaComProvider[],
  esperado: Provider,
): string | null {
  if (divergentes.length === 0) return null;

  const descricao = divergentes
    .map((c) => `${c.accountId} (${c.provider.toUpperCase()})`)
    .join(", ");

  const rotulo = esperado.toUpperCase();
  return (
    `Esta tela exibe apenas contas ${rotulo}. Selecione contas ${rotulo} ou ` +
    `acesse Faturamento/OVH. Recebido: ${descricao}.`
  );
}
