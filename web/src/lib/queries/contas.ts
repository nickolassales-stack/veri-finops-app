import "server-only";

import {
  ConstrutorParams,
  escaparLike,
  identificadorPermitido,
  query,
} from "@/lib/database";
import type { Direcao } from "@/lib/filtros/esquemas";

/**
 * Cadastro de contas (`cloud_accounts`).
 *
 * Tabela pequena (2 linhas hoje) mas a paginacao existe desde ja: a lista de
 * contas cresce com a adesao dos clientes e o endpoint nao pode virar um
 * SELECT sem limite depois.
 */

/** Nome logico exposto na API -> coluna real. Lista FECHADA. */
const COLUNAS_ORDENACAO = {
  conta: "account_id",
  nome: "account_name",
  unidade: "business_unit",
  centroCusto: "cost_center",
  ambiente: "environment",
  ativa: "active",
} as const;

export type OrdenacaoConta = keyof typeof COLUNAS_ORDENACAO;

export const CAMPOS_ORDENACAO_CONTA = Object.keys(COLUNAS_ORDENACAO) as [
  OrdenacaoConta,
  ...OrdenacaoConta[],
];

export type Conta = {
  accountId: string;
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  active: boolean;
};

export type ListaContas = {
  itens: Conta[];
  total: number;
};

export type ParametrosListaContas = {
  busca?: string;
  apenasAtivas: boolean;
  ordenarPor: OrdenacaoConta;
  direcao: Direcao;
  pagina: number;
  tamanho: number;
};

export async function listarContas(p: ParametrosListaContas): Promise<ListaContas> {
  const params = new ConstrutorParams();
  const condicoes: string[] = [];

  if (p.apenasAtivas) {
    condicoes.push("a.active");
  }

  if (p.busca) {
    // O termo vai como PARAMETRO; os curingas viram literais para que uma busca
    // por "%" nao retorne a base inteira.
    const termo = params.add(`%${escaparLike(p.busca)}%`);
    condicoes.push(
      `(a.account_id ILIKE ${termo} ESCAPE '\\'
        OR a.account_name ILIKE ${termo} ESCAPE '\\'
        OR coalesce(a.business_unit, '') ILIKE ${termo} ESCAPE '\\'
        OR coalesce(a.cost_center, '') ILIKE ${termo} ESCAPE '\\')`,
    );
  }

  // Nome de coluna e direcao NAO podem ser parametro no protocolo do Postgres.
  // Por isso vem de mapa fechado, com a checagem explicita abaixo.
  if (!identificadorPermitido(p.ordenarPor, COLUNAS_ORDENACAO)) {
    throw new Error(`Campo de ordenacao invalido: ${p.ordenarPor}`);
  }
  const coluna = COLUNAS_ORDENACAO[p.ordenarPor];
  const direcao = p.direcao === "asc" ? "ASC" : "DESC";

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
  const limite = params.add(p.tamanho);
  const deslocamento = params.add((p.pagina - 1) * p.tamanho);

  const linhas = await query<{
    account_id: string;
    account_name: string | null;
    business_unit: string | null;
    cost_center: string | null;
    environment: string | null;
    active: boolean | null;
    total_geral: string;
  }>(
    `
    SELECT a.account_id,
           a.account_name,
           a.business_unit,
           a.cost_center,
           a.environment,
           a.active,
           count(*) OVER () AS total_geral
      FROM cloud_accounts a
      ${where}
     ORDER BY a.${coluna} ${direcao} NULLS LAST, a.account_id ASC
     LIMIT ${limite} OFFSET ${deslocamento}
    `,
    params.lista,
  );

  return {
    total: linhas.length > 0 ? Number(linhas[0].total_geral) : 0,
    itens: linhas.map((l) => ({
      accountId: l.account_id,
      // `account_name` e NOT NULL no schema; o fallback cobre o caso de a
      // constraint mudar sem a aplicacao saber.
      accountName: l.account_name ?? `Conta ${l.account_id}`,
      businessUnit: l.business_unit,
      costCenter: l.cost_center,
      environment: l.environment,
      active: l.active ?? false,
    })),
  };
}

/**
 * Verifica quais dos ids informados existem no cadastro.
 *
 * Usado para avisar quando o filtro aponta para conta inexistente: sem isso o
 * usuario veria "US$ 0,00" e concluiria que a conta nao gastou, quando na
 * verdade digitou um id errado.
 */
export async function filtrarContasInexistentes(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];

  const linhas = await query<{ account_id: string }>(
    `SELECT account_id FROM cloud_accounts WHERE account_id = ANY($1)`,
    [ids],
  );

  const existentes = new Set(linhas.map((l) => l.account_id));
  return ids.filter((id) => !existentes.has(id));
}
