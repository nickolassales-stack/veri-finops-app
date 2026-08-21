import { createHash } from "node:crypto";

/**
 * As duas partes PURAS do protocolo da OVH: assinatura e sanitizacao.
 *
 * Separadas de `lib/ovh/api.ts` porque aquele modulo tem `server-only` -- e com
 * essa marca o vitest recusa o import, o que deixaria `sanitizar` sem teste. E
 * `sanitizar` e a funcao que impede um segredo de chegar a
 * `last_validation_error`, coluna que a TELA EXIBE. Justamente ela nao pode
 * ficar sem cobertura.
 *
 * Nao ha `server-only` aqui, mas tambem nao ha nada a esconder: as duas funcoes
 * recebem o que lhes dao e nao leem ambiente nem banco. O `node:crypto` impede
 * o uso acidental no cliente de qualquer forma.
 */

/**
 * Assinatura do protocolo da OVH: `$1$` + SHA-1 de `AS+CK+METHOD+URL+BODY+TS`.
 *
 * O SHA-1 e definido pelo PROVEDOR, nao escolhido por nos -- a API v1 nao oferece
 * alternativa. Ele autentica uma requisicao de leitura com timestamp; nao protege
 * segredo em repouso, o que e trabalho do AES-256-GCM em lib/cripto/segredos.ts.
 *
 * A URL tem de ser a ABSOLUTA, com host. Usar o caminho relativo e um erro facil
 * e o sintoma e um 403 indistinguivel de credencial errada -- que manda o
 * operador gerar chave nova para resolver um bug de codigo.
 */
export function assinar(
  applicationSecret: string,
  consumerKey: string,
  metodo: string,
  url: string,
  corpo: string,
  timestamp: number,
): string {
  const bruto = [
    applicationSecret,
    consumerKey,
    metodo,
    url,
    corpo,
    String(timestamp),
  ].join("+");
  return `$1$${createHash("sha1").update(bruto, "utf8").digest("hex")}`;
}

/**
 * Remove do texto qualquer coisa com FORMA de credencial, antes de ele virar log
 * ou coluna de banco.
 *
 * Nao e paranoia decorativa. `last_validation_error` e exibido na tela de Contas
 * Cloud, e mensagem de erro de API tem o habito de ecoar o que recebeu. Uma
 * resposta que devolvesse a application key no corpo a gravaria EM CLARO numa
 * coluna visivel -- exatamente o que a cifragem existe para impedir.
 *
 * O corte e por forma (sequencia longa de base64/hex), e nao por lista de valores
 * conhecidos: nao ha como enumerar o que a OVH pode ecoar. O custo e recortar
 * tambem palavra longa inocente, e essa troca esta certa -- perder uma palavra de
 * uma mensagem de erro custa menos do que publicar uma chave.
 */
export function sanitizar(texto: string, limite = 300): string {
  const semSegredo = texto.replace(/[A-Za-z0-9+/_-]{16,}/g, "<omitido>");
  const limpo = semSegredo.replace(/\s+/g, " ").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite)}...` : limpo;
}
