import type { AlertaOvh } from "./ovh";

/**
 * De onde cada conta OVH tira a credencial — e o alerta quando ainda é do arquivo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA APARECER NO DIAGNÓSTICO
 *
 * O fallback legado (`.env` / `accounts.d`) funciona bem demais para o próprio
 * bem: uma conta que caiu nele **coleta normalmente**, e o painel fica verde. Não
 * há sintoma — até o dia em que alguém rotaciona a credencial pela tela e a
 * coleta continua usando a chave antiga do arquivo, ou em que o arquivo some num
 * redeploy e a coleta para sem que ninguém tenha mudado nada.
 *
 * Um caminho de transição sem indicador vira um caminho permanente. Este bloco é
 * o indicador.
 *
 * ---------------------------------------------------------------------------
 * O QUE O PORTAL SABE, E O QUE ELE NÃO SABE
 *
 * O portal roda em container e **não lê o `.env` do collector**. Ele não pode
 * afirmar "esta conta está usando `accounts.d`". O que ele sabe com certeza é o
 * complemento: a conta está ativa em `cloud_accounts` e **não tem** linha em
 * `cloud_provider_credentials`.
 *
 * Para o collector, isso significa exatamente uma de duas coisas — ele cai no
 * fallback, ou não coleta a conta de forma alguma. As duas merecem alerta, e a
 * mensagem diz as duas em vez de escolher a mais provável e arriscar mentir.
 *
 * Módulo PURO: a regra fica testável sem banco, no mesmo arranjo de
 * `lib/diagnostico/etl.ts` e `lib/billing/pagamento.ts`.
 */

export type ContaCredencial = {
  accountId: string;
  nome: string;
  /** Existe linha em `cloud_provider_credentials` para esta conta? */
  temCredencial: boolean;
  /** `nao_validado` | `conectado` | `invalido` | `null` quando não há credencial. */
  status: string | null;
};

export type OrigemCredenciais = {
  noBanco: ContaCredencial[];
  /** Ativas sem credencial no banco: o collector usa o legado, ou não coleta. */
  emFallback: ContaCredencial[];
  /** Credencial cadastrada que a OVH já recusou num teste. */
  invalidas: ContaCredencial[];
  alertas: AlertaOvh[];
};

export function avaliarOrigemCredenciais(contas: ContaCredencial[]): OrigemCredenciais {
  const noBanco = contas.filter((c) => c.temCredencial);
  const emFallback = contas.filter((c) => !c.temCredencial);
  const invalidas = noBanco.filter((c) => c.status === "invalido");

  const alertas: AlertaOvh[] = [];

  if (emFallback.length > 0) {
    alertas.push({
      chave: "ovh-fallback-ativo",
      // `atencao` e não `critico`: a coleta pode estar funcionando pelo arquivo.
      // Pintar de vermelho algo que está coletando faria o vermelho perder valor
      // justamente na tela onde ele precisa significar "pare e olhe".
      tom: "atencao",
      titulo:
        emFallback.length === 1
          ? "1 conta OVH ainda depende do fallback legado"
          : `${emFallback.length} contas OVH ainda dependem do fallback legado`,
      detalhe:
        `Sem credencial cadastrada em Contas Cloud: ${emFallback
          .map((c) => c.accountId)
          .join(", ")}. ` +
        "O collector usa o .env/accounts.d do servidor para elas — ou não as coleta. " +
        "Enquanto isso durar, uma rotação feita pela tela não tem efeito sobre essas " +
        "contas. Cadastre a credencial em Configurações › Contas Cloud.",
    });
  }

  if (invalidas.length > 0) {
    alertas.push({
      chave: "ovh-credencial-invalida",
      tom: "critico",
      titulo: `${invalidas.length} credencial(is) OVH marcada(s) como inválida(s)`,
      detalhe:
        `A OVH recusou: ${invalidas.map((c) => c.accountId).join(", ")}. ` +
        "Contas com status `invalido` são PULADAS pelo collector — não há tentativa " +
        "diária, e por isso não aparecem como falha no histórico. Recadastre ou " +
        "teste de novo pela tela para reativar.",
    });
  }

  return { noBanco, emFallback, invalidas, alertas };
}

/** Frase curta para o rodapé do bloco. */
export function resumoOrigem(o: OrigemCredenciais): string {
  const total = o.noBanco.length + o.emFallback.length;
  if (total === 0) return "Nenhuma conta OVH ativa no cadastro.";
  if (o.emFallback.length === 0) {
    return total === 1
      ? "A única conta OVH ativa usa credencial cifrada no banco. Fallback legado inativo."
      : `As ${total} contas OVH ativas usam credencial cifrada no banco. Fallback legado inativo.`;
  }
  return `${o.noBanco.length} de ${total} contas usam credencial do banco; ${o.emFallback.length} dependem do fallback legado.`;
}
