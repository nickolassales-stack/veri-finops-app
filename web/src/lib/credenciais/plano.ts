import { ENDPOINTS_OVH, type EndpointOvh } from "@/lib/ovh/endpoints";

/**
 * As DECISOES de uma gravacao de credencial, separadas da execucao.
 *
 * MODULO PURO. Sem `server-only`, sem banco, sem `node:crypto`. Existe porque as
 * regras abaixo sao as que erram na pratica, e elas precisam de teste direto:
 *
 *   - campo vazio significa MANTER, nao apagar;
 *   - no primeiro cadastro nao ha o que manter, e os tres viram obrigatorios;
 *   - credencial OVH nao entra em conta AWS.
 *
 * Enquanto isso morava dentro do servico -- que importa banco e cifragem --,
 * testar "editar o endpoint sem apagar o secret" exigiria simular Postgres. O
 * servico agora e a execucao do plano, e o plano se testa numa linha.
 */

/** O que fazer com cada segredo. */
export type AcaoSegredo =
  | { acao: "manter" }
  | { acao: "substituir"; valor: string };

export type PlanoCredencial = {
  endpoint: EndpointOvh;
  applicationKey: AcaoSegredo;
  applicationSecret: AcaoSegredo;
  consumerKey: AcaoSegredo;
};

export type CampoFaltante = { campo: string; mensagem: string };

export type ResultadoPlano =
  | { ok: true; plano: PlanoCredencial }
  | { ok: false; faltantes: CampoFaltante[] };

/** Entrada ja normalizada pelo Zod: `undefined` = campo vazio ou ausente. */
export type EntradaPlano = {
  endpoint: EndpointOvh;
  applicationKey?: string | undefined;
  applicationSecret?: string | undefined;
  consumerKey?: string | undefined;
};

const CAMPOS: [keyof Omit<EntradaPlano, "endpoint">, string][] = [
  ["applicationKey", "Application Key"],
  ["applicationSecret", "Application Secret"],
  ["consumerKey", "Consumer Key"],
];

/**
 * Monta o plano de gravacao.
 *
 * `jaExiste` e o unico fato externo de que a decisao precisa, e por isso ele
 * entra como booleano em vez de a funcao ir ao banco: e o que a torna pura.
 *
 * ---------------------------------------------------------------------------
 * POR QUE VAZIO = MANTER, E NAO VAZIO = APAGAR
 *
 * O servidor nunca devolve o segredo a tela -- so a mascara. Entao, ao reabrir o
 * formulario para trocar o endpoint, os tres campos aparecem em branco. Se
 * branco significasse "apague", uma edicao de endpoint destruiria a credencial e
 * a coleta pararia no dia seguinte, sem ninguem ter pedido isso.
 *
 * Apagar credencial tem porta propria: o botao "Remover credenciais", que chama
 * DELETE. Nunca acontece por omissao.
 */
export function planejarGravacao(
  entrada: EntradaPlano,
  jaExiste: boolean,
): ResultadoPlano {
  if (!jaExiste) {
    const faltantes = CAMPOS.filter(([chave]) => entrada[chave] === undefined).map(
      ([chave, rotulo]) => ({
        campo: String(chave),
        mensagem: `${rotulo} e obrigatorio no primeiro cadastro.`,
      }),
    );
    if (faltantes.length > 0) return { ok: false, faltantes };
  }

  const acao = (valor: string | undefined): AcaoSegredo =>
    valor === undefined ? { acao: "manter" } : { acao: "substituir", valor };

  return {
    ok: true,
    plano: {
      endpoint: entrada.endpoint,
      applicationKey: acao(entrada.applicationKey),
      applicationSecret: acao(entrada.applicationSecret),
      consumerKey: acao(entrada.consumerKey),
    },
  };
}

/** Quantos segredos o plano de fato substitui. Usado para decidir o que recifrar. */
export function quantosSubstituem(plano: PlanoCredencial): number {
  return [plano.applicationKey, plano.applicationSecret, plano.consumerKey].filter(
    (a) => a.acao === "substituir",
  ).length;
}

/**
 * Recusa credencial OVH em conta que nao e OVH. `null` quando pode seguir.
 *
 * A AWS nao esta na lista e nao e esquecimento: ela autentica por IAM role da
 * instancia, e nao ha segredo para guardar. Aceitar credencial "OVH" numa conta
 * AWS criaria uma linha que o collector tentaria usar para coletar uma conta que
 * nao existe na OVH.
 *
 * Devolve a MENSAGEM e nao um booleano porque quem chama vai exibi-la, e a frase
 * precisa dizer o provider encontrado -- "conta invalida" mandaria o operador
 * procurar sozinho o que esta errado.
 */
export function motivoRecusaDeProvider(
  accountId: string,
  provider: string,
): string | null {
  if (provider === "ovh") return null;

  return (
    `A conta ${accountId} esta cadastrada como "${provider}". Credencial de API OVH ` +
    "so pode ser cadastrada em conta com provider ovh. O provider vem do onboarding e " +
    "nao e editavel nesta tela."
  );
}

/** O bloco de credenciais deve aparecer para esta conta e este usuario? */
export function deveMostrarBlocoOvh(provider: string, ehAdmin: boolean): boolean {
  return provider === "ovh" && ehAdmin;
}

export function ehEndpointValido(valor: string): valor is EndpointOvh {
  return (ENDPOINTS_OVH as readonly string[]).includes(valor);
}
