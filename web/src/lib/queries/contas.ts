import "server-only";

import {
  ConstrutorParams,
  escaparLike,
  identificadorPermitido,
  query,
} from "@/lib/database";
import type { Direcao, Provider } from "@/lib/filtros/esquemas";

import { aliasDisponivel, expressaoNomeDaConta, joinAlias } from "./alias-conta";

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
  /**
   * Nome JA RESOLVIDO pela cascata alias -> account_name -> conta-<id>.
   * Quem consome nao precisa (nem deve) saber de qual degrau veio.
   */
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  active: boolean;
  /**
   * `cloud_accounts.provider`. Sempre presente na resposta, inclusive quando o
   * filtro nao foi informado: quem consome precisa poder distinguir uma conta
   * AWS de uma OVH sem fazer uma segunda chamada.
   */
  provider: string;
};

export type ListaContas = {
  itens: Conta[];
  total: number;
};

export type ParametrosListaContas = {
  busca?: string;
  apenasAtivas: boolean;
  /** `"all"` (ou ausente) devolve todos os provedores. */
  provider?: Provider | "all";
  ordenarPor: OrdenacaoConta;
  direcao: Direcao;
  pagina: number;
  tamanho: number;
};

export async function listarContas(p: ParametrosListaContas): Promise<ListaContas> {
  const params = new ConstrutorParams();
  const condicoes: string[] = [];

  const comAlias = await aliasDisponivel();
  const amarracao = { colunaId: "a.account_id", cadastro: "a" };
  const nome = expressaoNomeDaConta(comAlias, amarracao);

  if (p.apenasAtivas) {
    condicoes.push("a.active");
  }

  if (p.provider && p.provider !== "all") {
    // Vai como PARAMETRO. O valor ja passou pelo enum do Zod, mas concatenar
    // um provider no texto do SQL criaria um caminho de input do usuario para
    // dentro da query sem nenhuma necessidade.
    condicoes.push(`a.provider = ${params.add(p.provider)}`);
  }

  if (p.busca) {
    // O termo vai como PARAMETRO; os curingas viram literais para que uma busca
    // por "%" nao retorne a base inteira.
    const termo = params.add(`%${escaparLike(p.busca)}%`);
    condicoes.push(
      // Busca pelo nome RESOLVIDO, nao por `account_name` cru: quem procura
      // "Financeiro" espera achar a conta cujo alias e Financeiro, ainda que o
      // cadastro a chame de "conta-147997123577".
      `(a.account_id ILIKE ${termo} ESCAPE '\\'
        OR ${nome} ILIKE ${termo} ESCAPE '\\'
        OR coalesce(a.business_unit, '') ILIKE ${termo} ESCAPE '\\'
        OR coalesce(a.cost_center, '') ILIKE ${termo} ESCAPE '\\')`,
    );
  }

  // Nome de coluna e direcao NAO podem ser parametro no protocolo do Postgres.
  // Por isso vem de mapa fechado, com a checagem explicita abaixo.
  if (!identificadorPermitido(p.ordenarPor, COLUNAS_ORDENACAO)) {
    throw new Error(`Campo de ordenacao invalido: ${p.ordenarPor}`);
  }
  // Ordenar por "nome" tem de seguir o nome EXIBIDO. Ordenar pela coluna crua
  // faria a lista aparecer fora de ordem alfabetica para quem le a tela.
  const ordenacao = p.ordenarPor === "nome" ? nome : `a.${COLUNAS_ORDENACAO[p.ordenarPor]}`;
  const direcao = p.direcao === "asc" ? "ASC" : "DESC";

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
  const limite = params.add(p.tamanho);
  const deslocamento = params.add((p.pagina - 1) * p.tamanho);

  const linhas = await query<{
    account_id: string;
    nome_exibicao: string;
    business_unit: string | null;
    cost_center: string | null;
    environment: string | null;
    active: boolean | null;
    provider: string | null;
    total_geral: string;
  }>(
    `
    SELECT a.account_id,
           ${nome} AS nome_exibicao,
           a.business_unit,
           a.cost_center,
           a.environment,
           a.active,
           a.provider,
           count(*) OVER () AS total_geral
      FROM cloud_accounts a
      ${joinAlias(comAlias, amarracao)}
      ${where}
     ORDER BY ${ordenacao} ${direcao} NULLS LAST, a.account_id ASC
     LIMIT ${limite} OFFSET ${deslocamento}
    `,
    params.lista,
  );

  return {
    total: linhas.length > 0 ? Number(linhas[0].total_geral) : 0,
    itens: linhas.map((l) => ({
      accountId: l.account_id,
      accountName: l.nome_exibicao,
      businessUnit: l.business_unit,
      costCenter: l.cost_center,
      environment: l.environment,
      active: l.active ?? false,
      // O DEFAULT da coluna e 'aws', mas ela e NULLABLE: linha inserida com
      // provider explicitamente nulo existiria. Tratada como AWS porque foi
      // assim que o cadastro nasceu -- so contas AWS existiam.
      provider: l.provider ?? "aws",
    })),
  };
}

/**
 * Nome amigavel de cada conta pedida, para descrever o recorte de uma
 * exportacao.
 *
 * Ler o nome das PROPRIAS linhas exportadas nao serve: uma conta filtrada que
 * nao teve custo no periodo nao aparece em nenhuma linha, e o cabecalho do
 * arquivo precisa dizer que ela estava no recorte mesmo assim -- caso contrario
 * o total parece de um filtro que nao foi o aplicado.
 */
export async function nomesDasContas(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const comAlias = await aliasDisponivel();
  const amarracao = { colunaId: "a.account_id", cadastro: "a" };

  const linhas = await query<{ account_id: string; nome_exibicao: string }>(
    `SELECT a.account_id,
            ${expressaoNomeDaConta(comAlias, amarracao)} AS nome_exibicao
       FROM cloud_accounts a
       ${joinAlias(comAlias, amarracao)}
      WHERE a.account_id = ANY($1)`,
    [ids],
  );

  return new Map(linhas.map((l) => [l.account_id, l.nome_exibicao]));
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

/**
 * Contas pedidas que NAO sao do provedor informado.
 *
 * Existe pelo mesmo motivo de `filtrarContasInexistentes`, e para um caso mais
 * traicoeiro: a conta OVH EXISTE em `cloud_accounts`, entao passa naquela
 * verificacao -- mas nao tem uma unica linha em `aws_daily_costs`. Sem esta
 * checagem, selecionar a conta OVH numa tela AWS devolve "US$ 0,00" com cara de
 * resposta legitima, e quem le conclui que a conta nao gastou nada.
 *
 * Devolve os ids divergentes com o provider de cada um, para que a mensagem de
 * erro possa dizer QUAL conta e de QUAL provedor em vez de so recusar.
 */
export async function contasDeOutroProvider(
  ids: string[],
  provider: Provider,
): Promise<{ accountId: string; provider: string }[]> {
  if (ids.length === 0) return [];

  const linhas = await query<{ account_id: string; provider: string | null }>(
    `SELECT account_id, provider
       FROM cloud_accounts
      WHERE account_id = ANY($1)
        AND coalesce(provider, 'aws') <> $2`,
    [ids, provider],
  );

  return linhas.map((l) => ({
    accountId: l.account_id,
    provider: l.provider ?? "aws",
  }));
}
