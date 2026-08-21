/**
 * Regioes da API da OVHcloud.
 *
 * MODULO PURO, sem `server-only` e sem `node:crypto`. Existe separado de
 * `lib/ovh/api.ts` por um motivo concreto: a tela precisa montar o seletor de
 * endpoint e o esquema Zod precisa da lista, mas `api.ts` e servidor-apenas --
 * importa-lo no cliente falharia o build.
 *
 * eu/ca/us sao CONTAS SEPARADAS na OVH, nao apenas latencias diferentes. Uma
 * credencial criada em ovh-eu nao vale em ovh-ca, e o sintoma de escolher
 * errado e um 404 em `/me` -- que se parece com credencial invalida e manda o
 * operador gerar chave nova sem necessidade.
 */

export const ENDPOINTS_OVH = ["ovh-eu", "ovh-ca", "ovh-us"] as const;

export type EndpointOvh = (typeof ENDPOINTS_OVH)[number];

const CONJUNTO: ReadonlySet<string> = new Set(ENDPOINTS_OVH);

export function ehEndpointOvh(valor: string): valor is EndpointOvh {
  return CONJUNTO.has(valor);
}

/** Rotulo de tela. O codigo tecnico aparece junto -- e ele que vai no cadastro. */
export const ROTULO_ENDPOINT: Record<EndpointOvh, string> = {
  "ovh-eu": "Europa (ovh-eu)",
  "ovh-ca": "Canada (ovh-ca)",
  "ovh-us": "Estados Unidos (ovh-us)",
};

/** Onde criar a credencial, por regiao. Vai na ajuda do formulario. */
export const URL_CRIAR_TOKEN: Record<EndpointOvh, string> = {
  "ovh-eu": "https://eu.api.ovh.com/createToken/",
  "ovh-ca": "https://ca.api.ovh.com/createToken/",
  "ovh-us": "https://api.us.ovhcloud.com/createToken/",
};
