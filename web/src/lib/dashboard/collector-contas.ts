/**
 * Saúde do collector OVH **para o recorte selecionado** — regra pura.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM STATUS SÓ DEIXA DE SERVIR COM DUAS CONTAS
 *
 * O card lia a ÚLTIMA execução registrada, qualquer que fosse a conta. Com uma
 * conta isso é correto. Com duas, uma coleta bem-sucedida da conta A produz
 * "Coleta em dia" enquanto a conta B falha há uma semana — o painel afirmaria
 * saúde que não existe, e a conta quebrada seria justamente a que ninguém olha.
 *
 * A agregação certa é **pessimista**: o card mostra o pior estado entre as
 * contas do recorte. Um verde que esconde um vermelho é pior do que um amarelo
 * honesto, porque ninguém investiga o que está verde.
 *
 * ---------------------------------------------------------------------------
 * "SEM CREDENCIAL" É SEPARADO DE "FALHOU"
 *
 * São ações diferentes do outro lado. Falha manda olhar o log e tentar de novo;
 * ausência de credencial manda cadastrar em Configurações › Contas Cloud. E há
 * uma diferença mais dura: conta sem credencial **não é tentada** pelo collector,
 * então ela nunca aparece como falha no histórico — fica parada e silenciosa,
 * indistinguível de uma conta sem custo.
 */

export type ContaColetada = {
  id: string;
  nome: string;
  /** `status` da última execução. `null` = nunca coletada. */
  ultimoStatus: string | null;
  ultimoFim: string | null;
  /** `null` quando a migração 006 não rodou — "não sei", não "não tem". */
  temCredencial: boolean | null;
};

export type ResumoCollector = {
  /** Frase do card. */
  rotulo: string;
  tom: "ok" | "atencao" | "critico" | "neutro";
  /** Como o recorte de contas se lê. Requisito: nunca "Conta: OVH Principal" com várias. */
  descricaoContas: string;
  /** Um por problema encontrado. Vazio quando está tudo em dia. */
  alertas: string[];
  /** Quantas contas o recorte alcança. */
  total: number;
  /**
   * Fim da coleta mais recente ENTRE AS CONTAS DO RECORTE, ISO-8601.
   *
   * `null` quando nenhuma conta do recorte já terminou uma coleta.
   *
   * Não é a última execução do collector: aquela é global, e com duas contas ela
   * pode ser de uma conta que não está no recorte. Quem filtrou por uma conta
   * precisa do relógio DAQUELA conta -- ler o horário da outra e concluir que o
   * dado é fresco é exatamente o erro que o filtro deveria tornar impossível.
   */
  ultimaColeta: string | null;
};

/** Horas a partir das quais a última coleta bem-sucedida é considerada velha. */
export const HORAS_DADO_VELHO = 36;

function horasDesde(iso: string, agora: Date): number {
  return (agora.getTime() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * O `ultimoFim` mais recente do recorte.
 *
 * Comparação por `Date`, e não por ordem alfabética da string: as duas coincidem
 * em ISO-8601 UTC, mas nada aqui garante que o servidor devolva sempre `Z` --
 * um `-03:00` ordenaria errado como texto, e o erro seria de uma hora, invisível.
 */
function coletaMaisRecente(contas: ContaColetada[]): string | null {
  let melhor: string | null = null;
  for (const c of contas) {
    if (c.ultimoFim === null) continue;
    if (melhor === null || new Date(c.ultimoFim) > new Date(melhor)) melhor = c.ultimoFim;
  }
  return melhor;
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? `1 ${um}` : `${n} ${muitos}`;
}

/**
 * Como o recorte de contas se lê no card.
 *
 * Com UMA conta o nome dela é a informação útil; com várias, o nome de cada uma
 * não cabe e a contagem passa a ser a leitura certa. "Todas as contas OVH" só
 * quando nenhuma foi escolhida — dizer "todas" para uma seleção que por acaso
 * inclui todas mentiria sobre o que o filtro está fazendo.
 */
export function descreverRecorte(
  selecionadas: ContaColetada[],
  eTodas: boolean,
): string {
  if (eTodas) return "Contas: Todas as contas OVH";
  if (selecionadas.length === 1) return `Contas: ${selecionadas[0].nome}`;
  return `Contas: ${selecionadas.length} selecionadas`;
}

/**
 * Agrega a saúde das contas do recorte.
 *
 * `agora` entra como parâmetro em vez de vir de `new Date()` para que o teste
 * possa fixar o instante — mesma disciplina de `resolverPeriodoMensal`.
 */
export function resumirCollector(
  contas: ContaColetada[],
  idsSelecionados: string[],
  agora: Date,
): ResumoCollector {
  const eTodas = idsSelecionados.length === 0;
  const selecionadas = eTodas
    ? contas
    : contas.filter((c) => idsSelecionados.includes(c.id));

  const descricaoContas = descreverRecorte(selecionadas, eTodas);

  if (selecionadas.length === 0) {
    return {
      rotulo: "Nenhuma conta OVH no recorte",
      tom: "neutro",
      descricaoContas,
      alertas: [],
      total: 0,
      ultimaColeta: null,
    };
  }

  // `temCredencial === false` e não `!temCredencial`: `null` significa que a
  // migração 006 não rodou, e tratar isso como ausência mandaria cadastrar
  // credencial que pode já existir.
  const semCredencial = selecionadas.filter((c) => c.temCredencial === false);
  const falharam = selecionadas.filter((c) => c.ultimoStatus === "failed");
  const nuncaColetadas = selecionadas.filter((c) => c.ultimoStatus === null);
  const emExecucao = selecionadas.filter((c) => c.ultimoStatus === "running");

  const velhas = selecionadas.filter(
    (c) =>
      c.ultimoStatus === "success" &&
      c.ultimoFim !== null &&
      horasDesde(c.ultimoFim, agora) > HORAS_DADO_VELHO,
  );

  const alertas: string[] = [];
  if (falharam.length > 0) {
    alertas.push(
      `${plural(falharam.length, "conta com falha", "contas com falha")} na última coleta`,
    );
  }
  if (semCredencial.length > 0) {
    alertas.push(plural(semCredencial.length, "conta sem credencial", "contas sem credencial"));
  }
  if (nuncaColetadas.length > 0) {
    alertas.push(
      plural(nuncaColetadas.length, "conta nunca coletada", "contas nunca coletadas"),
    );
  }
  if (velhas.length > 0) {
    alertas.push(
      `${plural(velhas.length, "conta com dado", "contas com dado")} de mais de ${HORAS_DADO_VELHO} h`,
    );
  }

  const comum = {
    descricaoContas,
    alertas,
    total: selecionadas.length,
    ultimaColeta: coletaMaisRecente(selecionadas),
  };

  // A ORDEM É A PRIORIDADE, e ela é pessimista de propósito: o card mostra o
  // pior estado do recorte. Falha antes de ausência de credencial porque falha
  // significa que algo QUEBROU; ausência é configuração pendente.
  if (falharam.length > 0) {
    return { rotulo: "Coleta com falha", tom: "critico", ...comum };
  }
  if (semCredencial.length > 0 || nuncaColetadas.length > 0) {
    return { rotulo: "Coleta incompleta", tom: "atencao", ...comum };
  }
  if (velhas.length > 0) {
    return { rotulo: "Dado desatualizado", tom: "atencao", ...comum };
  }
  if (emExecucao.length > 0) {
    return { rotulo: "Coleta em execução", tom: "atencao", ...comum };
  }

  return { rotulo: "Coleta em dia", tom: "ok", ...comum };
}
