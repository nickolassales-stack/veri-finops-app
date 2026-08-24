/**
 * Decisão de "esta coleta pode ser pedida?" — pura, sem React e sem banco.
 *
 * Separada do componente porque é a parte que erra em silêncio: um botão
 * habilitado quando não deveria manda uma requisição que volta 4xx, e um botão
 * desabilitado quando não deveria impede trabalho legítimo sem dizer por quê.
 * Nenhum dos dois aparece num teste de render; os dois aparecem aqui.
 */

export type ContaColeta = {
  accountId: string;
  nome: string;
  temCredencial: boolean;
  jobAtivo: { id: string; status: string } | null;
};

/** Valor do seletor que significa "todas as contas". */
export const ESCOPO_TODAS = "__todas__";

export type AvaliacaoEscopo = {
  /** As contas que o escopo alcança. */
  selecionadas: ContaColeta[];
  /** Já têm job vivo; serão puladas pelo índice único parcial. */
  emAndamento: ContaColeta[];
  /** Não têm credencial em `cloud_provider_credentials`. */
  semCredencial: ContaColeta[];
  /** `true` quando TODAS as do escopo já estão coletando. */
  tudoEmAndamento: boolean;
  /** `true` quando o botão deve ficar desabilitado. */
  bloqueado: boolean;
};

export function avaliarEscopo(
  contas: ContaColeta[],
  escopo: string,
): AvaliacaoEscopo {
  const selecionadas =
    escopo === ESCOPO_TODAS ? contas : contas.filter((c) => c.accountId === escopo);

  const emAndamento = selecionadas.filter((c) => c.jobAtivo !== null);
  const semCredencial = selecionadas.filter((c) => !c.temCredencial);

  // `length > 0 &&` importa: com zero contas selecionadas, `every` devolve `true`
  // por vacuidade e o botao ficaria "tudo em andamento" numa lista vazia.
  const tudoEmAndamento =
    selecionadas.length > 0 && emAndamento.length === selecionadas.length;

  // Bloqueia só quando NADA no escopo pode ser enfileirado. Com "Todas" e uma de
  // três em andamento, as outras duas ainda podem -- barrar as três faria uma
  // coleta em curso impedir as demais, que é o oposto do isolamento por conta.
  const restantes = selecionadas.filter((c) => c.temCredencial && c.jobAtivo === null);
  const bloqueado = restantes.length === 0;

  return { selecionadas, emAndamento, semCredencial, tudoEmAndamento, bloqueado };
}

/** Corpo do POST para o escopo escolhido. */
export function corpoDaColeta(
  escopo: string,
): { scope: "all" } | { scope: "account"; accountId: string } {
  return escopo === ESCOPO_TODAS
    ? { scope: "all" }
    : { scope: "account", accountId: escopo };
}
