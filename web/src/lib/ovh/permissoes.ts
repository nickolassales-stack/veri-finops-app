import { type EndpointOvh } from "./endpoints";

/**
 * Direitos que a credencial OVH precisa ter -- a MESMA lista que a tela mostra,
 * que o botão copia e que a documentação publica.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É CÓDIGO, E NÃO TEXTO SOLTO NO JSX
 *
 * A lista estava só em `docs/CONTAS-CLOUD.md`. Quem cadastra uma conta está na
 * tela, não no repositório -- e uma credencial criada sem estes direitos falha
 * DEPOIS, na primeira coleta, com um 403 da OVH que se parece com chave errada.
 * O erro custa uma ida ao console da OVH para gerar tudo de novo.
 *
 * Sendo um módulo, o teste consegue afirmar que a lista continua cobrindo todos
 * os caminhos que o collector chama de verdade.
 *
 * ---------------------------------------------------------------------------
 * O CURINGA DA OVH ATRAVESSA A BARRA
 *
 * Nas regras de acesso da OVH, `*` casa qualquer sufixo, INCLUSIVE com `/`.
 * É por isso que `GET /me/bill/*` basta para `/me/bill/{id}/details/{linha}`, e
 * `GET /cloud/project/*` basta para `/cloud/project/{id}/usage/forecast`. Não é
 * necessário -- nem desejável -- listar cada nível.
 *
 * `GET /*` funcionaria e está fora de propósito: ele daria leitura de TUDO na
 * conta OVH, inclusive dados que o portal não lê e não deveria poder ler.
 */

/** Os cinco direitos, na ordem em que se lê. É o texto que o botão copia. */
export const PERMISSOES_OVH = [
  "GET /me",
  "GET /me/bill",
  "GET /me/bill/*",
  "GET /cloud/project",
  "GET /cloud/project/*",
] as const;

/** Para que serve cada um -- a tela mostra ao lado, em tabela. */
export const PARA_QUE_SERVE: Record<(typeof PERMISSOES_OVH)[number], string> = {
  "GET /me": "Identifica a conta. É o que o botão Testar conexão usa.",
  "GET /me/bill": "Lista as faturas do período.",
  "GET /me/bill/*": "Abre cada fatura e suas linhas de detalhe.",
  "GET /cloud/project": "Lista os projetos Public Cloud.",
  "GET /cloud/project/*": "Lê cada projeto, o uso corrente e a projeção.",
};

/** Bloco copiável, uma permissão por linha. */
export function textoPermissoesOvh(): string {
  return PERMISSOES_OVH.join("\n");
}

/**
 * Qual endpoint corresponde à região da conta.
 *
 * eu/ca/us são CONTAS SEPARADAS na OVH, e não latências diferentes: uma
 * credencial criada em `ovh-eu` não vale em `ovh-ca`. O sintoma de errar é um
 * 404 em `/me`, que se parece com credencial inválida e manda gerar chave nova
 * sem necessidade -- daí a recomendação aparecer junto do seletor.
 */
export const REGIAO_DO_ENDPOINT: Record<EndpointOvh, string> = {
  "ovh-eu": "Europa",
  "ovh-ca": "Canadá / América do Norte",
  "ovh-us": "Estados Unidos",
};

export function recomendacaoDeEndpoint(endpoint: EndpointOvh): string {
  return `Use ${endpoint} se a conta OVH for ${REGIAO_DO_ENDPOINT[endpoint]}.`;
}
