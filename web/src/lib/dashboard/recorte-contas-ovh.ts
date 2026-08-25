/**
 * Qual lista de contas OVH cada consulta recebe -- regra pura.
 *
 * ---------------------------------------------------------------------------
 * "TODAS" PASSOU A SER LISTA EXPLÍCITA, E ISSO FOI UMA DECISÃO PEDIDA
 *
 * Antes, "todas" era a AUSÊNCIA de filtro: `ovh_monthly_costs` só contém linha
 * OVH, então não filtrar não podia trazer dado de outro provedor. O requisito
 * atual é outro -- "se Todas as contas: usar todas as contas OVH ativas" -- e é
 * ele que está implementado aqui.
 *
 * A consequência tem nome e precisa ser dita: **custo de conta que não está no
 * cadastro ativo deixa de entrar no total**. Isso acontece de verdade, porque o
 * collector grava custo por `provider_account_id` e ninguém garante que toda
 * conta com custo tenha linha `active` em `cloud_accounts` -- a conta pode ter
 * sido desativada depois de meses de fatura, ou o custo pode ter sido importado
 * antes de alguém cadastrá-la.
 *
 * Por isso a resolução vem acompanhada de duas defesas, e não sozinha:
 *
 *   1. `cadastroVazio` -- sem nenhuma conta ativa, "todas" NÃO vira lista vazia.
 *      `= ANY('{}')` não devolve linha nenhuma: o painel inteiro mostraria zero
 *      onde antes mostrava tudo, e um zero desses passa por custo real. Nesse
 *      caso o filtro é omitido e a tela diz por quê.
 *   2. `idsDesconhecidos` -- id selecionado que não está no cadastro ativo é
 *      MANTIDO no filtro (ele pode ter custo legítimo) e sinalizado, para que
 *      "USD 0,00" venha com explicação em vez de passar por resposta.
 */

export type RecorteContasOvh = {
  /**
   * Ids que vão para `provider_account_id = ANY(...)`.
   * `undefined` = sem filtro de conta (só o caso `cadastroVazio`).
   */
  ids: string[] | undefined;
  /** A pessoa escolheu contas na URL? */
  selecaoExplicita: boolean;
  /** "Todas" foi resolvido para a lista de ativas? */
  resolvidoParaAtivas: boolean;
  /** Não há conta OVH ativa cadastrada: "todas" degradou para sem filtro. */
  cadastroVazio: boolean;
  /** Ids pedidos que não constam no cadastro ativo. Continuam no filtro. */
  idsDesconhecidos: string[];
};

export function resolverRecorteContasOvh(
  selecionadas: string[] | undefined,
  idsAtivos: string[],
): RecorteContasOvh {
  const ativos = new Set(idsAtivos);

  if (selecionadas !== undefined && selecionadas.length > 0) {
    return {
      ids: selecionadas,
      selecaoExplicita: true,
      resolvidoParaAtivas: false,
      cadastroVazio: idsAtivos.length === 0,
      idsDesconhecidos: selecionadas.filter((id) => !ativos.has(id)),
    };
  }

  if (idsAtivos.length === 0) {
    return {
      ids: undefined,
      selecaoExplicita: false,
      resolvidoParaAtivas: false,
      cadastroVazio: true,
      idsDesconhecidos: [],
    };
  }

  return {
    ids: idsAtivos,
    selecaoExplicita: false,
    resolvidoParaAtivas: true,
    cadastroVazio: false,
    idsDesconhecidos: [],
  };
}

/**
 * Aviso de custo que o recorte "todas" deixou de fora.
 *
 * Só faz sentido quando "todas" virou lista explícita: com seleção explícita, a
 * exclusão é o que a pessoa pediu, e avisar seria ruído.
 *
 * `linhasDeFora` vem de uma contagem no banco -- linhas do período e da origem
 * cujo `provider_account_id` não está entre as contas ativas.
 */
export function avisoCustoForaDoCadastro(
  recorte: RecorteContasOvh,
  linhasDeFora: number,
): { codigo: string; mensagem: string } | null {
  if (!recorte.resolvidoParaAtivas || linhasDeFora <= 0) return null;

  return {
    codigo: "ovh-custo-fora-do-cadastro",
    mensagem:
      `${linhasDeFora} linha(s) de custo do período pertencem a contas OVH que não ` +
      `estão ativas em Contas Cloud e ficaram DE FORA dos números. ` +
      `Reative a conta ou cadastre-a para incluí-la.`,
  };
}

/** Aviso de id pedido que o cadastro não conhece. */
export function avisoContasDesconhecidas(
  recorte: RecorteContasOvh,
): { codigo: string; mensagem: string } | null {
  if (recorte.idsDesconhecidos.length === 0) return null;

  return {
    codigo: "ovh-conta-desconhecida",
    mensagem:
      `Filtrando por conta(s) que não constam no cadastro OVH ativo: ` +
      `${recorte.idsDesconhecidos.join(", ")}. ` +
      `Se os números vierem zerados, confira o id — ele não é de uma conta OVH ativa.`,
  };
}

/** Aviso de cadastro vazio: "todas" não pôde ser resolvido. */
export function avisoCadastroVazio(
  recorte: RecorteContasOvh,
): { codigo: string; mensagem: string } | null {
  if (!recorte.cadastroVazio || recorte.selecaoExplicita) return null;

  return {
    codigo: "ovh-cadastro-vazio",
    mensagem:
      "Nenhuma conta OVH ativa está cadastrada em Contas Cloud. Os números abaixo " +
      "são de todo o custo OVH importado, sem recorte por conta.",
  };
}
