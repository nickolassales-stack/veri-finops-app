import "server-only";

import { query } from "@/lib/database";

/**
 * Nome de exibicao de uma conta AWS -- UMA definicao, usada em toda parte.
 *
 * A regra pedida e uma cascata de tres degraus:
 *
 *     app_account_settings.alias      o que o ADMIN digitou
 *     cloud_accounts.account_name     o que o cadastro afirma
 *     conta-<account_id>              ultimo recurso, nunca vazio
 *
 * `nullif(btrim(...), '')` em cada degrau: alias com espacos, ou salvo vazio por
 * uma tela antiga, precisa CAIR para o proximo degrau em vez de exibir um nome
 * em branco. Confiar so em NULL deixaria essa fresta aberta.
 *
 * Esta expressao existe num lugar so porque ela aparece no filtro, nos cards, na
 * tabela analitica e nas exportacoes. Duplicada, viraria quatro definicoes que
 * divergem na primeira mudanca -- e um nome de conta diferente entre a tela e o
 * arquivo exportado e exatamente o tipo de coisa que faz alguem desconfiar do
 * numero ao lado.
 */

// ------------------------------------------------- disponibilidade da tabela

const TEMPO_DE_REPESCAGEM_MS = 30_000;

let tabelaExiste: boolean | null = null;
let ultimaChecagem = 0;

/**
 * A tabela de aliases existe neste banco?
 *
 * DEGRADA para o comportamento anterior quando a migracao 002 ainda nao rodou:
 * sem a tabela, o nome cai em `account_name` e o portal segue exatamente como
 * antes desta entrega.
 *
 * Vale a mesma distincao aplicada as permissoes: degradar aqui mostra um ROTULO
 * ANTERIOR, nunca um valor incorreto. Foi o oposto na migracao 001, onde seguir
 * sem a coluna exibiria custo errado com cara de certo -- por isso la a
 * dependencia e dura e aqui nao. Degradacao boa e a que tira funcionalidade;
 * degradacao ruim e a que mente.
 *
 * O resultado positivo e definitivo (tabela nao some em operacao normal). O
 * negativo e reconferido a cada 30s, para que aplicar a migracao com o portal
 * no ar passe a valer sozinho, sem reinicio.
 */
export async function aliasDisponivel(): Promise<boolean> {
  if (tabelaExiste === true) return true;

  const agora = Date.now();
  if (tabelaExiste === false && agora - ultimaChecagem < TEMPO_DE_REPESCAGEM_MS) {
    return false;
  }

  const linhas = await query<{ existe: boolean }>(
    `SELECT to_regclass('public.app_account_settings') IS NOT NULL AS existe`,
  );
  tabelaExiste = linhas[0]?.existe ?? false;
  ultimaChecagem = agora;
  return tabelaExiste;
}

/** Zera o cache. Existe para o teste; nao chame em codigo de producao. */
export function esquecerDisponibilidade(): void {
  tabelaExiste = null;
  ultimaChecagem = 0;
}

// -------------------------------------------------------------- montagem SQL

/**
 * Como amarrar a cascata numa consulta especifica.
 *
 * `colunaId` e explicito, e nao derivado do alias da tabela de cadastro, por um
 * motivo concreto: em `getCustoPorConta` o `cloud_accounts` entra por LEFT JOIN
 * sobre o agregado de custo, entao conta COM custo e SEM cadastro tem
 * `a.account_id` nulo. Usar `a.account_id` no ultimo degrau devolveria NULL
 * justamente na linha que mais precisa de nome. O id vem do lado que sempre
 * existe -- o agregado.
 */
export type AmarracaoAlias = {
  /** Coluna do id da conta que SEMPRE tem valor. Ex.: `g.account_id`. */
  colunaId: string;
  /** Tabela do cadastro, quando ela participa da consulta. Ex.: `a`. */
  cadastro?: string;
  /** Apelido da tabela de configuracoes. */
  cfg?: string;
};

/**
 * `LEFT JOIN` das configuracoes, ou string vazia quando a tabela nao existe.
 *
 * LEFT e nao INNER: conta sem linha de configuracao e o caso NORMAL -- so ganha
 * linha quem teve algum campo editado. INNER faria as contas nao configuradas
 * desaparecerem do dashboard.
 */
export function joinAlias(disponivel: boolean, amarracao: AmarracaoAlias): string {
  if (!disponivel) return "";
  const cfg = amarracao.cfg ?? "s";
  return `LEFT JOIN app_account_settings ${cfg} ON ${cfg}.account_id = ${amarracao.colunaId}`;
}

/**
 * Metadados de conta com a MESMA precedencia do alias: o que o portal guarda
 * vence o que o cadastro afirma.
 *
 * Sem isto, a tela de configuracoes deixaria o ADMIN corrigir o centro de custo
 * e o filtro do historico continuaria usando o valor antigo de
 * `cloud_accounts` -- dois numeros para a mesma pergunta.
 */
export type CampoDeConta = "business_unit" | "cost_center" | "environment";

export function expressaoCampoDaConta(
  disponivel: boolean,
  campo: CampoDeConta,
  amarracao: AmarracaoAlias,
): string {
  const cfg = amarracao.cfg ?? "s";
  const degraus = [
    ...(disponivel ? [`nullif(btrim(${cfg}.${campo}), '')`] : []),
    ...(amarracao.cadastro ? [`nullif(btrim(${amarracao.cadastro}.${campo}), '')`] : []),
  ];
  // Sem nenhum degrau disponivel a expressao precisa continuar valida em SQL.
  return degraus.length > 0 ? `coalesce(${degraus.join(", ")})` : "NULL::text";
}

/** A cascata de nomes, pronta para entrar num SELECT ou num ORDER BY. */
export function expressaoNomeDaConta(
  disponivel: boolean,
  amarracao: AmarracaoAlias,
): string {
  const cfg = amarracao.cfg ?? "s";
  const degraus = [
    ...(disponivel ? [`nullif(btrim(${cfg}.alias), '')`] : []),
    ...(amarracao.cadastro ? [`nullif(btrim(${amarracao.cadastro}.account_name), '')`] : []),
    `'conta-' || ${amarracao.colunaId}`,
  ];
  return `coalesce(${degraus.join(", ")})`;
}
