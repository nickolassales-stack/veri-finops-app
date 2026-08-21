import type { Papel } from "./tipos";

/**
 * Catalogo de permissoes -- a FONTE DA VERDADE.
 *
 * Nao ha tabela de catalogo no banco de proposito. Uma permissao so significa
 * alguma coisa se alguma rota a verifica, entao quem define o conjunto e o
 * codigo. Duas fontes (aqui e uma tabela) sairiam de sincronia no primeiro
 * deploy em que uma migracao ficasse para tras.
 *
 * `app_group_permissions.permission` guarda texto livre. A entrada e validada
 * contra esta lista por Zod antes de chegar ao banco, e uma permissao
 * desconhecida que porventura exista la e ignorada na leitura -- remover uma
 * permissao daqui a torna inerte, nunca perigosa.
 *
 * ESTE ARQUIVO E PURO. Sem `server-only`, sem driver de banco: a tela precisa
 * dos rotulos e o teste precisa de `can()` sem subir Postgres.
 */

export const PERMISSOES = [
  "dashboard:view",
  "analytic:view",
  "analytic:export",
  "settings:view",
  "settings:accounts",
  "settings:users",
  "settings:groups",
  "diagnostics:view",
  "billing:view",
  "billing:manage",
] as const;

export type Permissao = (typeof PERMISSOES)[number];

const CONJUNTO_PERMISSOES: ReadonlySet<string> = new Set(PERMISSOES);

/** Descarta o que nao esta no catalogo. Usado ao ler do banco. */
export function ehPermissaoConhecida(valor: string): valor is Permissao {
  return CONJUNTO_PERMISSOES.has(valor);
}

// ------------------------------------------------------------------- rotulos

export type DescricaoPermissao = {
  /** Agrupamento na tela de permissoes. */
  area: string;
  titulo: string;
  descricao: string;
};

export const ROTULOS: Record<Permissao, DescricaoPermissao> = {
  "dashboard:view": {
    area: "Custos",
    titulo: "Ver a visao executiva",
    descricao: "Abrir /dashboard e consultar os indicadores consolidados.",
  },
  "analytic:view": {
    area: "Custos",
    titulo: "Ver o analitico",
    descricao: "Abrir /dashboard/analitico e navegar lancamento a lancamento.",
  },
  "analytic:export": {
    area: "Custos",
    titulo: "Exportar dados",
    descricao: "Baixar o recorte atual em CSV ou XLSX.",
  },
  "settings:view": {
    area: "Configuracoes",
    titulo: "Abrir configuracoes",
    descricao: "Entrar na area administrativa. Sem isto, as demais nao valem nada.",
  },
  "settings:accounts": {
    area: "Configuracoes",
    titulo: "Gerenciar contas AWS",
    descricao: "Editar alias, unidade, centro de custo e fechamento de fatura.",
  },
  "settings:users": {
    area: "Configuracoes",
    titulo: "Gerenciar usuarios",
    descricao: "Criar usuario, ativar, desativar e vincular a grupos.",
  },
  "settings:groups": {
    area: "Configuracoes",
    titulo: "Gerenciar grupos e permissoes",
    descricao: "Criar grupo e decidir o que cada um pode fazer.",
  },
  "diagnostics:view": {
    area: "Operacao",
    titulo: "Ver diagnostico",
    descricao: "Consultar estrutura do banco, privilegios e ultima carga do ETL.",
  },
  "billing:view": {
    area: "Faturamento",
    titulo: "Ver faturamento",
    descricao: "Consultar fechamento de fatura e situacao de pagamento.",
  },
  "billing:manage": {
    area: "Faturamento",
    titulo: "Gerenciar faturamento",
    descricao: "Alterar dia de fechamento e situacao de pagamento das contas.",
  },
};

/** Ordem de exibicao das areas na tela de permissoes. */
export const AREAS = ["Custos", "Configuracoes", "Operacao", "Faturamento"] as const;

// --------------------------------------------------------------------- papel

/**
 * Piso garantido pelo PAPEL, antes de qualquer grupo.
 *
 * ADMIN nao aparece aqui porque nao e uma lista: e curto-circuito em `can()`.
 * Enumerar as permissoes do ADMIN criaria a chance de esquecer de acrescentar
 * uma permissao nova a lista e deixar o administrador trancado do lado de fora
 * da propria tela que a introduziu.
 */
export const PERMISSOES_DO_VIEWER: readonly Permissao[] = [
  "dashboard:view",
  "analytic:view",
] as const;

// ------------------------------------------------------------------- decisao

export type Autorizacao = {
  papel: Papel;
  /** Permissoes vindas dos grupos ATIVOS de que o usuario participa. */
  permissoes: ReadonlySet<Permissao>;
};

/**
 * A pergunta unica de autorizacao do sistema.
 *
 * Regra: ADMIN pode tudo; qualquer outro papel soma o seu piso as permissoes
 * dos grupos. Grupo concede, nunca revoga -- nao existe negacao explicita, e
 * isso e deliberado: permissao negativa transforma "por que fulano nao
 * consegue?" numa investigacao, em vez de uma leitura.
 */
export function can(usuario: Autorizacao, permissao: Permissao): boolean {
  if (usuario.papel === "ADMIN") return true;
  if (PERMISSOES_DO_VIEWER.includes(permissao)) return true;
  return usuario.permissoes.has(permissao);
}

/** Conjunto efetivo, para a tela mostrar o que o usuario tem. */
export function permissoesEfetivas(usuario: Autorizacao): Permissao[] {
  return PERMISSOES.filter((p) => can(usuario, p));
}
