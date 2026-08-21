import "server-only";

/**
 * Chamada assinada a API da OVHcloud -- somente o necessario para VALIDAR uma
 * credencial.
 *
 * ---------------------------------------------------------------------------
 * ISTO MUDA UM INVARIANTE DO PROJETO. Registre-se.
 *
 * A migracao 005 afirma, em comentario: "o portal nunca fala com a API da OVH".
 * Era verdade e era bom -- mantinha o portal sem saida para a internet e sem
 * credencial de provedor em memoria.
 *
 * O botao "Testar conexao" exige a quebra: nao existe forma de dizer a quem
 * acabou de digitar uma credencial que ela funciona sem tentar usa-la. A
 * alternativa -- gravar um pedido e esperar o collector validar no dia seguinte
 * -- transformaria um clique numa espera de 24h.
 *
 * A quebra e mantida no menor tamanho possivel:
 *
 *   - UM endpoint, `GET /me`, somente leitura. Nada de escrita, nada de fatura,
 *     nada de projeto. Se a resposta vier, a credencial vale; e isso e tudo que
 *     este modulo quer saber.
 *   - Sem biblioteca nova. A assinatura da OVH sao seis campos concatenados e um
 *     SHA-1; trazer um pacote npm para isso acrescentaria arvore de dependencia
 *     ao container que serve dado financeiro.
 *   - Timeout curto e obrigatorio. O portal nao pode ficar preso num provedor
 *     externo enquanto atende requisicao.
 *   - A COLETA CONTINUA SENDO DO COLLECTOR. Este modulo nunca busca custo.
 *
 * Consequencia operacional: o container do portal passa a precisar de saida
 * HTTPS para o dominio da API da OVH. Em rede sem essa saida o teste falha por
 * timeout, e a mensagem diz exatamente isso em vez de acusar a credencial.
 *
 * ---------------------------------------------------------------------------
 * SHA-1 nao e escolha nossa
 *
 * O esquema `$1$` da OVH e definido pelo provedor. Nao ha versao mais forte
 * disponivel na API v1. O SHA-1 aqui autentica uma requisicao de leitura com
 * timestamp; nao protege segredo em repouso -- disso cuida o AES-256-GCM em
 * lib/cripto/segredos.ts.
 *
 * A assinatura em si e a sanitizacao de mensagem vivem em `./protocolo`, que e
 * puro e testavel: `server-only` neste arquivo impediria o vitest de importa-las.
 */

import type { EndpointOvh } from "./endpoints";
import { assinar, sanitizar } from "./protocolo";

export { sanitizar };

/**
 * Mesmas URLs da biblioteca oficial. Fixas no codigo de proposito: sao dado de
 * protocolo, nao configuracao -- variavel de ambiente aqui permitiria apontar o
 * teste de credencial para um host arbitrario.
 *
 * A LISTA de endpoints validos nao esta aqui: mora em `./endpoints`, que e puro e
 * de onde a tela e o Zod tambem leem. Duas listas sairiam de sincronia, e o
 * sintoma seria um endpoint aceito pelo formulario e sem URL neste mapa.
 */
const BASE: Record<EndpointOvh, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
};

const TIMEOUT_MS = 8_000;

export type CredencialOvh = {
  endpoint: EndpointOvh;
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
};

export type ResultadoValidacao =
  | {
      ok: true;
      /** Identificador da conta do lado da OVH, conforme ela respondeu. */
      nichandle: string | null;
      /** Estado do cadastro na OVH (ex.: "complete"). */
      estado: string | null;
      moeda: string | null;
    }
  | {
      ok: false;
      /** Mensagem JA SANITIZADA, pronta para tela e para o banco. */
      mensagem: string;
      /** Classificacao para a tela decidir o tom. */
      causa: "credencial" | "permissao" | "rede" | "provedor" | "resposta";
    };

// ------------------------------------------------------------------ chamada

/**
 * Relogio do SERVIDOR da OVH, nao o nosso.
 *
 * A API recusa requisicao cujo timestamp esteja fora de uma janela estreita.
 * Container tende a acumular deriva de relogio, e usar `Date.now()` produziria
 * uma falha que se parece com credencial invalida -- o pior tipo de erro, o que
 * manda o operador gerar credencial nova sem necessidade.
 *
 * `/auth/time` nao exige autenticacao e devolve o epoch em texto puro.
 */
async function relogioDaOvh(base: string, sinal: AbortSignal): Promise<number> {
  const resposta = await fetch(`${base}/auth/time`, {
    method: "GET",
    signal: sinal,
    cache: "no-store",
  });
  if (!resposta.ok) {
    throw new Error(`/auth/time respondeu HTTP ${resposta.status}`);
  }
  const texto = (await resposta.text()).trim();
  const epoch = Number.parseInt(texto, 10);
  if (!Number.isFinite(epoch) || epoch <= 0) {
    throw new Error("/auth/time devolveu conteudo inesperado");
  }
  return epoch;
}

/**
 * Valida a credencial com uma unica leitura: `GET /me`.
 *
 * NUNCA LANCA. Toda falha vira `{ ok: false }` com mensagem sanitizada -- quem
 * chama grava o resultado no banco e mostra na tela, e uma excecao vazando daqui
 * viraria stack trace numa rota administrativa.
 */
export async function validarCredencialOvh(
  cred: CredencialOvh,
): Promise<ResultadoValidacao> {
  const base = BASE[cred.endpoint];
  const url = `${base}/me`;

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const timestamp = await relogioDaOvh(base, controlador.signal);

    const resposta = await fetch(url, {
      method: "GET",
      headers: {
        "X-Ovh-Application": cred.applicationKey,
        "X-Ovh-Consumer": cred.consumerKey,
        "X-Ovh-Timestamp": String(timestamp),
        "X-Ovh-Signature": assinar(
          cred.applicationSecret,
          cred.consumerKey,
          "GET",
          url,
          "",
          timestamp,
        ),
        accept: "application/json",
      },
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!resposta.ok) {
      return traduzirRecusa(resposta.status, await resposta.text().catch(() => ""));
    }

    const corpo: unknown = await resposta.json().catch(() => null);
    if (corpo === null || typeof corpo !== "object") {
      return {
        ok: false,
        causa: "resposta",
        mensagem: "A OVH respondeu com sucesso, mas o corpo nao era JSON de conta.",
      };
    }

    const c = corpo as Record<string, unknown>;
    const texto = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

    return {
      ok: true,
      nichandle: texto(c.nichandle),
      estado: texto(c.state),
      moeda:
        typeof c.currency === "object" && c.currency !== null
          ? texto((c.currency as Record<string, unknown>).code)
          : texto(c.currency),
    };
  } catch (err) {
    // `abort` chega como AbortError; qualquer outra coisa e falha de rede/DNS.
    const abortado =
      typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";

    if (abortado) {
      return {
        ok: false,
        causa: "rede",
        mensagem:
          `A OVH nao respondeu em ${TIMEOUT_MS / 1000}s. Isso costuma ser falta de ` +
          "saida HTTPS do container para a API da OVH -- nao necessariamente credencial errada.",
      };
    }

    return {
      ok: false,
      causa: "rede",
      mensagem: `Nao foi possivel falar com a API da OVH: ${sanitizar(
        err instanceof Error ? err.message : String(err),
        160,
      )}`,
    };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Traduz a recusa para uma frase que diz O QUE FAZER.
 *
 * A distincao entre 401/403 e 404 importa na pratica: as duas primeiras sao a
 * credencial; a terceira, quase sempre, e endpoint errado -- a chave foi criada
 * em `ovh-eu` e cadastrada como `ovh-ca`, e as duas regioes sao contas
 * separadas. "Credencial invalida" mandaria o operador gerar chave nova para
 * resolver um erro de escolha de regiao.
 */
function traduzirRecusa(status: number, corpo: string): ResultadoValidacao {
  // Da OVH aproveitamos apenas `class`, que e um identificador fixo do
  // provedor. `message` e texto livre e nao entra: e por ali que uma API ecoa o
  // que recebeu.
  let classe: string | null = null;
  try {
    const j = JSON.parse(corpo) as Record<string, unknown>;
    if (typeof j.class === "string") classe = sanitizar(j.class, 60);
  } catch {
    // Corpo nao-JSON: ignorado de proposito, nao vai para a mensagem.
  }
  const sufixo = classe ? ` (${classe})` : "";

  if (status === 401 || status === 403) {
    return {
      ok: false,
      causa: status === 403 ? "permissao" : "credencial",
      mensagem:
        status === 403
          ? `A OVH aceitou a identidade mas negou o acesso a /me${sufixo}. ` +
            "A consumer key provavelmente nao tem direito sobre /me -- refaca a " +
            "autorizacao incluindo GET /me e GET /me/bill*."
          : `A OVH recusou a credencial${sufixo}. Confira application key, secret e ` +
            "consumer key, e se a consumer key foi validada no link de autorizacao.",
    };
  }

  if (status === 404) {
    return {
      ok: false,
      causa: "credencial",
      mensagem:
        `A OVH respondeu 404 em /me${sufixo}. O endpoint provavelmente esta errado: ` +
        "ovh-eu, ovh-ca e ovh-us sao contas SEPARADAS, e a credencial vale so na regiao " +
        "em que foi criada.",
    };
  }

  if (status === 429) {
    return {
      ok: false,
      causa: "provedor",
      mensagem: `A OVH limitou a taxa de requisicoes (429)${sufixo}. Tente de novo em alguns minutos.`,
    };
  }

  return {
    ok: false,
    causa: "provedor",
    mensagem: `A OVH respondeu HTTP ${status}${sufixo}. A credencial nao pode ser confirmada agora.`,
  };
}
