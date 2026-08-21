import "server-only";

import { getAutorizacao } from "@/lib/auth/autorizacao";
import { getSessao } from "@/lib/auth/dal";
import { can, type Permissao } from "@/lib/auth/permissoes";
import type { Sessao } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

import { respostaErro, respostaOk, traduzirFalha } from "./http";

/**
 * Envelope comum das rotas de dados.
 *
 * Concentra as tres coisas que TODA rota protegida precisa fazer igual:
 *
 * 1. Exigir sessao valida ANTES de qualquer outra coisa. A checagem e feita
 *    contra o banco (`getSessao` -> `app_sessions`), nao contra o cookie: o
 *    `proxy.ts` so faz uma triagem otimista e cookie forjado passa por la.
 *    Sem sessao a rota devolve 401 e nao chega a ler os parametros -- quem nao
 *    esta autenticado nem consegue sondar o comportamento da validacao.
 * 2. Padronizar sucesso (`{ dados, meta }`) e falha (`{ erro }`).
 * 3. Nunca deixar excecao escapar como stack trace para o cliente.
 */

export type ContextoRota = {
  url: URL;
  sessao: Sessao;
  /** Fuso de apresentacao (APP_TZ). Base de tudo que envolve "hoje". */
  tz: string;
};

export type ResultadoRota = {
  dados: unknown;
  /** Campos extras de `meta` (periodo aplicado, filtros, paginacao...). */
  meta?: Record<string, unknown>;
};

export function rotaProtegida(
  nome: string,
  manipulador: (ctx: ContextoRota) => Promise<ResultadoRota>,
) {
  return async function handler(request: Request): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      const tz = getEnv().APP_TZ;
      const { dados, meta } = await manipulador({
        url: new URL(request.url),
        sessao,
        tz,
      });

      // `meta` do manipulador vem primeiro: os campos fixos abaixo nao podem
      // ser sobrescritos por engano por uma rota.
      return respostaOk(dados, {
        ...meta,
        moeda: "USD",
        timezone: tz,
        geradoEm: new Date().toISOString(),
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Envelope das rotas ADMINISTRATIVAS: sessao + permissao + parametros de rota.
 *
 * Tres diferencas em relacao a `rotaProtegida`:
 *
 * 1. Alem da sessao, exige uma PERMISSAO. Sem ela, 403 -- e a checagem vem
 *    antes de ler qualquer parametro, entao quem nao pode nem consegue sondar
 *    a validacao da rota.
 * 2. Entrega `params` ja resolvidos (no Next 16 eles chegam como Promise).
 * 3. Aceita o corpo da requisicao, que as rotas de leitura nao usam. O corpo e
 *    lido aqui, uma vez: `Request` so pode ser consumido uma vez, e deixar isso
 *    para o manipulador convidaria ao erro de ler duas vezes.
 *
 * Esconder o link na navegacao NAO e protecao. A autorizacao de verdade e esta
 * -- e a de `requirePermissao()` nas paginas.
 */
export type ContextoAdmin<P> = ContextoRota & {
  params: P;
  /** Corpo JSON ja parseado. `{}` quando nao ha corpo ou nao e JSON valido. */
  corpo: unknown;
};

export function rotaComPermissao<P extends Record<string, string> = Record<string, never>>(
  nome: string,
  permissao: Permissao,
  manipulador: (ctx: ContextoAdmin<P>) => Promise<ResultadoRota>,
) {
  return async function handler(
    request: Request,
    contexto?: { params: Promise<P> },
  ): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      const autorizacao = await getAutorizacao();
      if (!autorizacao || !can(autorizacao, permissao)) {
        return respostaErro(
          "sem-permissao",
          "Seu perfil nao tem permissao para esta operacao.",
        );
      }

      const params = ((await contexto?.params) ?? {}) as P;

      // GET/DELETE nao tem corpo; tentar ler lanca ou devolve vazio conforme o
      // runtime. `{}` e a resposta certa nos dois casos -- a validacao Zod do
      // manipulador e quem decide se faltou campo.
      let corpo: unknown = {};
      if (request.method !== "GET" && request.method !== "HEAD") {
        corpo = await request.json().catch(() => ({}));
      }

      const tz = getEnv().APP_TZ;
      const { dados, meta } = await manipulador({
        url: new URL(request.url),
        sessao,
        tz,
        params,
        corpo,
      });

      return respostaOk(dados, {
        ...meta,
        moeda: "USD",
        timezone: tz,
        geradoEm: new Date().toISOString(),
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Envelope das rotas que exigem PAPEL ADMIN -- nao uma permissao.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NAO DA PARA FAZER ISSO COM `rotaComPermissao`
 *
 * `can()` tem duas saidas antes de olhar o conjunto do usuario: ADMIN recebe
 * `true` para tudo, e qualquer permissao pode ser CONCEDIDA A UM GRUPO. Um
 * VIEWER num grupo com `settings:credentials` passaria por
 * `rotaComPermissao(..., "settings:credentials", ...)`.
 *
 * Isso e correto para o resto do sistema -- o desenho de grupos existe
 * justamente para delegar. Mas "somente ADMIN pode mexer em credencial" e um
 * requisito sobre PAPEL, e nenhuma permissao consegue expressa-lo: criar
 * `settings:credentials` daria a ILUSAO de exclusividade, com uma tela de
 * grupos capaz de conceder a chave a qualquer um, em dois cliques e sem aviso.
 *
 * Por isso a checagem aqui e `sessao.papel !== "ADMIN"`, direta, sem passar por
 * `can()`. E o unico ponto do sistema que decide por papel em vez de permissao,
 * e a excecao esta registrada porque um leitor futuro tenderia a "corrigi-la"
 * para o padrao.
 *
 * A permissao `settings:accounts` continua valendo para o RESTO da tela de
 * Contas Cloud: alias, unidade, centro de custo e ambiente seguem delegaveis.
 * So o bloco de credencial e que nao.
 */
export function rotaSomenteAdmin<P extends Record<string, string> = Record<string, never>>(
  nome: string,
  manipulador: (ctx: ContextoAdmin<P>) => Promise<ResultadoRota>,
) {
  return async function handler(
    request: Request,
    contexto?: { params: Promise<P> },
  ): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      if (sessao.papel !== "ADMIN") {
        // A recusa vem ANTES de ler o corpo: quem nao pode nem consegue sondar a
        // validacao para descobrir quais campos a rota espera.
        return respostaErro(
          "sem-permissao",
          "Somente administradores podem consultar ou alterar credenciais de provedor.",
        );
      }

      const params = ((await contexto?.params) ?? {}) as P;

      let corpo: unknown = {};
      if (request.method !== "GET" && request.method !== "HEAD") {
        corpo = await request.json().catch(() => ({}));
      }

      const tz = getEnv().APP_TZ;
      const { dados, meta } = await manipulador({
        url: new URL(request.url),
        sessao,
        tz,
        params,
        corpo,
      });

      return respostaOk(dados, {
        ...meta,
        moeda: "USD",
        timezone: tz,
        geradoEm: new Date().toISOString(),
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Variante para rotas que devolvem ARQUIVO, nao o envelope `{ dados, meta }`.
 *
 * Mesma porta de entrada: sessao verificada contra o banco antes de qualquer
 * outra coisa, mesma taxonomia de erro. So o sucesso muda de forma -- o
 * manipulador monta a propria `Response` com o corpo e os cabecalhos do
 * download.
 *
 * O FRACASSO continua saindo em JSON de proposito: quem baixa e a tela, por
 * `fetch`, e ela precisa da mesma estrutura de erro que ja sabe interpretar.
 */
export function rotaProtegidaArquivo(
  nome: string,
  manipulador: (ctx: ContextoRota) => Promise<Response>,
) {
  return async function handler(request: Request): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      return await manipulador({
        url: new URL(request.url),
        sessao,
        tz: getEnv().APP_TZ,
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Rota de ARQUIVO que exige permissao.
 *
 * `rotaProtegidaArquivo` mais a checagem de permissao, feita ANTES de ler
 * qualquer parametro e antes de abrir o fluxo -- uma recusa precisa sair como
 * JSON de erro, e depois do primeiro byte do arquivo isso ja nao seria possivel.
 *
 * Existe separada de `rotaComPermissao` porque o sucesso aqui nao e o envelope
 * `{ dados, meta }`: o manipulador monta a propria `Response`, com o corpo e os
 * cabecalhos do download.
 */
export function rotaComPermissaoArquivo(
  nome: string,
  permissao: Permissao,
  manipulador: (ctx: ContextoRota) => Promise<Response>,
) {
  return async function handler(request: Request): Promise<Response> {
    try {
      const sessao = await getSessao();
      if (!sessao) {
        return respostaErro(
          "nao-autenticado",
          "Sessao ausente ou expirada. Entre novamente.",
        );
      }

      const autorizacao = await getAutorizacao();
      if (!autorizacao || !can(autorizacao, permissao)) {
        return respostaErro(
          "sem-permissao",
          "Seu perfil nao tem permissao para exportar dados.",
        );
      }

      return await manipulador({
        url: new URL(request.url),
        sessao,
        tz: getEnv().APP_TZ,
      });
    } catch (err) {
      return traduzirFalha(nome, err);
    }
  };
}

/**
 * Cabecalhos de download.
 *
 * `filename*` (RFC 5987) alem de `filename`: o nome carrega so ASCII hoje, mas
 * um acento futuro sem essa forma chegaria corrompido no navegador.
 */
export function cabecalhosDeArquivo(nome: string, tipo: string): HeadersInit {
  return {
    "content-type": tipo,
    "content-disposition":
      `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    // Dado financeiro por sessao: nunca em cache de navegador ou intermediario.
    "cache-control": "no-store, private",
    // O corpo e um arquivo; nao deve ser interpretado como nada mais.
    "x-content-type-options": "nosniff",
  };
}
