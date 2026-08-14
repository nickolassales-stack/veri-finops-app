/**
 * Saude do pipeline FinOps: o que o estado bruto do banco SIGNIFICA.
 *
 * MODULO PURO. Recebe o que foi lido e o instante atual; devolve status e
 * alertas. Nada aqui abre conexao, e e por isso que cada regra tem teste --
 * "a carga esta atrasada" e uma afirmacao que precisa estar certa as 04:59 e
 * as 05:01, e nao da para esperar amanhecer para conferir.
 */

import {
  diaEm,
  diasEntre,
  mesesEntre,
  passouDaHora,
  ultimaEsperada,
  type AgendaEtl,
} from "./agenda";

// ---------------------------------------------------------------- execucao

export type StatusExecucao = "running" | "success" | "failed";
export type OrigemExecucao = "manual" | "cron" | "unknown";

export type ExecucaoEtl = {
  id: string;
  iniciadaEm: string;
  finalizadaEm: string | null;
  status: StatusExecucao;
  origem: OrigemExecucao;
  linhasMensais: number | null;
  linhasDiarias: number | null;
  erro: string | null;
  caminhoDoLog: string | null;
};

/**
 * Situacao do pipeline.
 *
 * Os quatro primeiros sao os pedidos. `executando` foi acrescentado porque uma
 * carga em andamento nao e nenhum dos outros quatro: chama-la de "ok" afirmaria
 * um resultado que ainda nao existe, e de "atrasada" acusaria de falha quem
 * esta trabalhando. Sem esse estado, abrir a tela durante a carga da manha
 * mostraria sempre um diagnostico errado.
 */
export type SituacaoEtl =
  | "ok"
  | "atrasado"
  | "erro"
  | "executando"
  | "nunca_executado";

export type LimitesDiagnostico = {
  /** Idade a partir da qual uma execucao aberta e dada por interrompida. */
  execucaoOrfaMinutos: number;
  /** Dias sem dado novo antes de acusar conta parada. */
  diasSemAtualizacao: number;
};

const MS_POR_MINUTO = 60_000;

/** Duracao da execucao, em segundos. `null` enquanto ela nao terminou. */
export function duracaoSegundos(execucao: ExecucaoEtl): number | null {
  if (!execucao.finalizadaEm) return null;
  const inicio = new Date(execucao.iniciadaEm).getTime();
  const fim = new Date(execucao.finalizadaEm).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  return Math.max(0, Math.round((fim - inicio) / 1000));
}

/** Ha quantos minutos a execucao comecou. */
function idadeMinutos(execucao: ExecucaoEtl, agora: Date): number {
  const inicio = new Date(execucao.iniciadaEm).getTime();
  if (!Number.isFinite(inicio)) return 0;
  return (agora.getTime() - inicio) / MS_POR_MINUTO;
}

/**
 * O status atual do ETL.
 *
 * A ordem das perguntas e a propria regra:
 *
 * 1. Nunca executou -- nao ha o que julgar.
 * 2. Esta aberta ha tempo demais -- morreu sem conseguir dizer que morreu, e
 *    isso e ERRO, nao "executando". Sem esta pergunta, um ETL morto por OOM
 *    apareceria como "em andamento" indefinidamente.
 * 3. Esta aberta ha pouco -- esta rodando.
 * 4. A ultima terminou em falha -- erro.
 * 5. A ultima teve sucesso, mas comecou ANTES do horario esperado mais recente
 *    e a tolerancia ja passou -- atrasado.
 * 6. Caso contrario -- ok.
 *
 * O passo 5 compara com o horario ESPERADO e nao com "hoje": as 04:00 de Sao
 * Paulo, a carga das 05:00 de hoje ainda nao era devida, e a de ontem e a
 * ultima legitima. Perguntar "rodou hoje?" acusaria atraso todas as madrugadas.
 */
export function situacaoDoEtl(
  ultima: ExecucaoEtl | null,
  agora: Date,
  agenda: AgendaEtl,
  limites: LimitesDiagnostico,
): SituacaoEtl {
  if (!ultima) return "nunca_executado";

  if (ultima.status === "running") {
    return idadeMinutos(ultima, agora) > limites.execucaoOrfaMinutos
      ? "erro"
      : "executando";
  }

  if (ultima.status === "failed") return "erro";

  const esperada = ultimaEsperada(agenda, agora);
  const comecou = new Date(ultima.iniciadaEm).getTime();
  if (passouDaHora(agenda, agora) && comecou < esperada.getTime()) {
    return "atrasado";
  }

  return "ok";
}

export const ROTULO_SITUACAO: Record<SituacaoEtl, string> = {
  ok: "OK",
  atrasado: "Atrasado",
  erro: "Erro",
  executando: "Em execução",
  nunca_executado: "Nunca executado",
};

// ------------------------------------------------------------------ frescor

export type FrescorConta = {
  accountId: string;
  nomeExibicao: string;
  ultimaUsageDate: string | null;
  ultimoBillingMonth: string | null;
  primeiroBillingMonth: string | null;
  linhasDiarias: number;
  linhasMensais: number;
  totalLinhas: number;
  mesesDisponiveis: number;
  /**
   * Quando a linha MAIS NOVA desta conta entrou no banco.
   *
   * Nao e "quando o ETL rodou": a carga e um ON CONFLICT ... DO UPDATE, que nao
   * mexe em `created_at`. Uma conta cujo custo so foi reajustado hoje, sem dia
   * novo, mantem o carimbo antigo -- e isso e a informacao correta, porque nao
   * entrou dado novo. Quando o ETL rodou e pergunta de `app_etl_runs`.
   */
  linhaMaisNovaEm: string | null;
  /** Meses "AAAA-MM" presentes no mensal. Base da deteccao de buraco. */
  mesesPresentes: string[];
};

// -------------------------------------------------------------------- alertas

export type TomAlerta = "critico" | "atencao" | "info";

export type Alerta = {
  /** Chave estavel -- serve de `key` na tela e de asserção no teste. */
  chave: string;
  tom: TomAlerta;
  titulo: string;
  detalhe: string;
};

export type EntradaAlertas = {
  situacao: SituacaoEtl;
  ultima: ExecucaoEtl | null;
  contas: FrescorConta[];
  agora: Date;
  agenda: AgendaEtl;
  limites: LimitesDiagnostico;
  /** Fuso de apresentacao (APP_TZ) -- e nele que "hoje" e definido para o leitor. */
  fusoDaTela: string;
  /** `false` quando a migracao 003 ainda nao rodou. */
  monitoramentoInstalado: boolean;
};

const ORDEM_TOM: Record<TomAlerta, number> = { critico: 0, atencao: 1, info: 2 };

/**
 * Todos os alertas da tela, em uma funcao so.
 *
 * Concentrados aqui, e nao espalhados pelos componentes, porque alerta e
 * afirmacao sobre producao: precisa de teste, e teste de componente nao cobre
 * "o que acontece as 04:59 do dia seguinte".
 *
 * O silencio e significativo: lista vazia quer dizer "conferido e sem
 * problema", nunca "ninguem olhou". Por isso nenhuma regra devolve alerta
 * quando falta informacao -- falta de informacao vira alerta PROPRIO.
 */
export function montarAlertas(entrada: EntradaAlertas): Alerta[] {
  const { situacao, ultima, contas, agora, agenda, limites, fusoDaTela } = entrada;
  const alertas: Alerta[] = [];
  const hoje = diaEm(fusoDaTela, agora);

  if (!entrada.monitoramentoInstalado) {
    alertas.push({
      chave: "monitoramento-ausente",
      tom: "atencao",
      titulo: "Monitoramento do ETL não instalado",
      detalhe:
        "Os objetos app_etl_runs e app_data_freshness não existem neste banco, então " +
        "não há como saber se a carga rodou nem qual o frescor por conta. O restante " +
        "do portal continua funcionando normalmente — só o diagnóstico depende deles. " +
        "Aplique scripts/migrations/003-diagnostico-etl.sql.",
    });
    // Nada mais e afirmavel sem os objetos: seguir daqui produziria "nenhuma
    // conta com dado de custo", que e falso -- o dado esta la, quem falta e a
    // consulta. Um alerta certo vale mais do que cinco derivados de vazio.
    return alertas;
  }

  // ------------------------------------------------------------ o ETL em si
  if (situacao === "nunca_executado") {
    alertas.push({
      chave: "nunca-executado",
      tom: "info",
      titulo: "Nenhuma execução registrada ainda",
      detalhe:
        "O monitoramento foi instalado agora e a próxima carga será a primeira a " +
        "se registrar. Execuções anteriores a esta instalação não aparecem aqui.",
    });
  }

  if (ultima && ultima.status === "failed") {
    alertas.push({
      chave: "etl-falhou",
      tom: "critico",
      titulo: "A última execução do ETL falhou",
      detalhe: ultima.erro
        ? `Mensagem registrada: ${ultima.erro}`
        : "Nenhuma mensagem foi registrada. Consulte o log na EC2.",
    });
  }

  if (ultima && ultima.status === "running" && situacao === "erro") {
    alertas.push({
      chave: "etl-interrompido",
      tom: "critico",
      titulo: "Execução aberta e nunca encerrada",
      detalhe:
        `A execução começou há mais de ${limites.execucaoOrfaMinutos} minutos e não ` +
        "registrou fim. É o sintoma de processo morto sem chance de gravar nada " +
        "(OOM, reinício da instância). A próxima carga fecha esse registro sozinha.",
    });
  }

  if (situacao === "atrasado") {
    const esperada = ultimaEsperada(agenda, agora);
    alertas.push({
      chave: "etl-atrasado",
      tom: "critico",
      titulo: "O ETL não rodou no horário",
      detalhe:
        `A carga era esperada às ${horaDe(esperada, fusoDaTela)} e a tolerância de ` +
        `${agenda.toleranciaMinutos} minutos já passou. O dado exibido no portal é o ` +
        "da última carga bem-sucedida.",
    });
  }

  // ------------------------------------------------------------- por conta
  if (contas.length === 0) {
    alertas.push({
      chave: "sem-contas",
      tom: "critico",
      titulo: "Nenhuma conta com dado de custo",
      detalhe:
        "As tabelas de custo estão vazias para todas as contas. O portal não tem o " +
        "que exibir em nenhuma tela.",
    });
  }

  const mesCorrenteISO = `${hoje.slice(0, 7)}-01`;

  for (const conta of contas) {
    const nome = `${conta.nomeExibicao} (${conta.accountId})`;

    if (conta.ultimoBillingMonth !== mesCorrenteISO) {
      alertas.push({
        chave: `sem-mes-corrente-${conta.accountId}`,
        tom: "atencao",
        titulo: `Sem dado no mês corrente: ${nome}`,
        detalhe: conta.ultimoBillingMonth
          ? `O último mês de cobrança carregado é ${conta.ultimoBillingMonth.slice(0, 7)}. ` +
            "Pode ser conta encerrada, sem consumo no mês, ou partição do mês ausente no Athena."
          : "Não há nenhuma linha mensal para esta conta.",
      });
    }

    if (conta.ultimaUsageDate) {
      const dias = diasEntre(conta.ultimaUsageDate, hoje);
      if (dias > limites.diasSemAtualizacao) {
        alertas.push({
          chave: `parada-${conta.accountId}`,
          tom: "atencao",
          titulo: `Sem dado novo há ${dias} dias: ${nome}`,
          detalhe:
            `A data de uso mais recente é ${conta.ultimaUsageDate}. O CUR da AWS ` +
            `atrasa cerca de um dia; acima de ${limites.diasSemAtualizacao} dias, ` +
            "vale conferir a exportação da conta.",
        });
      }
    } else {
      alertas.push({
        chave: `sem-diario-${conta.accountId}`,
        tom: "atencao",
        titulo: `Sem nenhuma linha diária: ${nome}`,
        detalhe:
          "A conta tem custo mensal mas nenhum lançamento diário. A evolução diária " +
          "não mostra esta conta.",
      });
    }

    const faltando = mesesFaltando(conta);
    if (faltando.length > 0) {
      alertas.push({
        chave: `buraco-mensal-${conta.accountId}`,
        tom: "atencao",
        titulo: `Mês sem carga no meio da série: ${nome}`,
        detalhe:
          `Não há linha mensal para ${faltando.join(", ")}, embora existam meses antes ` +
          "e depois. É o sintoma clássico de partição do Athena não adicionada — ver " +
          "add_partition.sql na EC2.",
      });
    }
  }

  // Crítico primeiro. Dentro do mesmo tom, a ordem de insercao é preservada
  // (`sort` é estável), então o alerta do pipeline vem antes do das contas.
  return alertas.sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom]);
}

/**
 * Meses ausentes ENTRE o primeiro e o ultimo mes com dado.
 *
 * Buraco no meio e sintoma de partição faltando; ausencia na PONTA nao e --
 * antes do primeiro mes a conta pode nem existir, e depois do ultimo o mes
 * pode simplesmente ainda nao ter fechado. Acusar as pontas encheria a tela
 * de alerta falso todo dia 1o.
 */
export function mesesFaltando(conta: FrescorConta): string[] {
  if (!conta.primeiroBillingMonth || !conta.ultimoBillingMonth) return [];

  const presentes = new Set(conta.mesesPresentes);
  return mesesEntre(conta.primeiroBillingMonth, conta.ultimoBillingMonth).filter(
    (mes) => !presentes.has(mes),
  );
}

// ------------------------------------------------------------------- redacao

/**
 * Redacao de ULTIMA HORA na mensagem de erro, antes de ela chegar ao navegador.
 *
 * O gravador ja sanitiza (ver scripts/etl/athena_to_postgres.py). Esta e a
 * SEGUNDA barreira, e existe por um motivo concreto: linha gravada por uma
 * versao anterior do script -- ou a mao, por alguem com pressa -- nao passou
 * por aquela primeira. Uma expressao regular custa menos do que uma senha
 * exibida em tela.
 *
 * Mora no modulo puro, e nao na camada de banco, exatamente para poder ter
 * teste: e a unica funcao desta entrega cujo defeito e um vazamento.
 */
const REDACOES: [RegExp, string][] = [
  [/(password\s*=\s*)(\S+)/gi, "$1***"],
  [/(PG_PASSWORD\s*[=:]\s*)(\S+)/gi, "$1***"],
  [/:\/\/([^:/\s]+):([^@/\s]+)@/g, "://$1:***@"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "***"],
];

const LIMITE_MENSAGEM = 500;

export function redigirErro(mensagem: string | null): string | null {
  if (!mensagem) return null;
  let texto = mensagem;
  for (const [padrao, troca] of REDACOES) texto = texto.replace(padrao, troca);
  texto = texto.trim();
  if (texto === "") return null;
  return texto.length > LIMITE_MENSAGEM ? `${texto.slice(0, LIMITE_MENSAGEM - 1)}…` : texto;
}

function horaDe(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fuso,
  }).format(instante);
}
