/**
 * O ciclo de uma fatura: quando fecha, quando vence, e o que isso significa
 * hoje.
 *
 * MODULO PURO -- sem banco, sem `server-only`, sem `new Date()` interno. Recebe
 * a configuracao da conta e a data de hoje; devolve as datas e a leitura.
 *
 * TUDO AQUI E DERIVADO, NADA E ARMAZENADO. "Fecha em 3 dias" nao e um campo:
 * e uma conta feita a cada requisicao a partir do dia configurado. Guardar
 * essa frase no banco criaria um valor que envelhece sozinho e passa a mentir
 * a cada meia-noite.
 *
 * O QUE ESTE MODULO NAO SABE
 *
 * Se a fatura foi paga. Isso nao se deduz de calendario nem de custo -- o
 * CUR/Data Export diz o que foi CONSUMIDO, jamais o que foi QUITADO. A situacao
 * de pagamento entra aqui como informacao vinda de fora, e o unico papel do
 * ciclo e cruzar as duas coisas.
 */

import { dataDoMes, diasEntre, somarMeses } from "@/lib/tempo/calendario";

// ------------------------------------------------------------- configuracao

export type ConfiguracaoDeFatura = {
  /** Dia do mes em que a fatura fecha. `null` = nao configurado. */
  diaDeFechamento: number | null;
  /** Dia do mes do vencimento. `null` = nao configurado. */
  diaDeVencimento: number | null;
  /** Antecedencia do aviso, em dias. */
  diasDeAviso: number;
};

// ------------------------------------------------------------------ leitura

/**
 * A situacao do ciclo, hoje.
 *
 * `sem_configuracao` e um estado de primeira classe, e nao um `null` a ser
 * tratado na tela: uma conta sem dia de fechamento nao esta "em dia" nem
 * "atrasada" -- ninguem disse quando ela fecha. Misturar esse caso com os
 * outros faria a tela afirmar coisas sobre um calendario que nao existe.
 */
export type SituacaoDoCiclo =
  | "sem_configuracao"
  | "aberta"
  | "fecha_em_breve"
  | "fecha_hoje"
  | "fechada";

export type CicloDeFatura = {
  situacao: SituacaoDoCiclo;
  /** Fechamento vigente: o proximo, ou o de hoje. "AAAA-MM-DD". */
  proximoFechamento: string | null;
  /** O fechamento anterior a hoje -- a fatura que ja esta fechada. */
  ultimoFechamento: string | null;
  /** Vencimento correspondente ao ULTIMO fechamento. */
  vencimentoDaFaturaFechada: string | null;
  /** Dias ate o proximo fechamento. 0 = hoje. `null` sem configuracao. */
  diasParaFechar: number | null;
  /** Dias desde o ultimo fechamento. `null` sem configuracao. */
  diasDesdeFechamento: number | null;
  /** Frase pronta para a tela, no vocabulario pedido. */
  descricao: string;
};

/**
 * Calcula o ciclo para uma conta, dada a data de HOJE no fuso de apresentacao.
 *
 * `hoje` chega como "AAAA-MM-DD" ja resolvido em America/Sao_Paulo pela camada
 * de cima. O ciclo nao converte fuso: se ele recebesse um `Date`, cada chamada
 * poderia interpretar a virada do dia de um jeito, e "fecha hoje" as 21h de Sao
 * Paulo viraria "fechou ontem" para quem calculou em UTC.
 */
export function calcularCiclo(cfg: ConfiguracaoDeFatura, hoje: string): CicloDeFatura {
  if (cfg.diaDeFechamento === null) {
    return {
      situacao: "sem_configuracao",
      proximoFechamento: null,
      ultimoFechamento: null,
      vencimentoDaFaturaFechada: null,
      diasParaFechar: null,
      diasDesdeFechamento: null,
      descricao: "Sem dia de fechamento configurado",
    };
  }

  const [ano, mes] = hoje.split("-").map(Number);

  // O fechamento DESTE mes -- ja encurtado quando o mes nao tem o dia pedido.
  const desteMes = dataDoMes(ano, mes, cfg.diaDeFechamento);
  const distancia = diasEntre(hoje, desteMes);

  let proximoFechamento: string;
  let ultimoFechamento: string;

  if (distancia > 0) {
    // Ainda vai fechar neste mes; o ultimo fechamento foi no mes passado.
    proximoFechamento = desteMes;
    const [anoAnt, mesAnt] = somarMeses(ano, mes, -1);
    ultimoFechamento = dataDoMes(anoAnt, mesAnt, cfg.diaDeFechamento);
  } else if (distancia === 0) {
    // Fecha HOJE. O ultimo fechamento continua sendo o do mes passado -- a
    // fatura de hoje ainda esta fechando, nao fechada.
    proximoFechamento = desteMes;
    const [anoAnt, mesAnt] = somarMeses(ano, mes, -1);
    ultimoFechamento = dataDoMes(anoAnt, mesAnt, cfg.diaDeFechamento);
  } else {
    // Ja passou neste mes: o proximo e no mes que vem.
    const [anoProx, mesProx] = somarMeses(ano, mes, 1);
    proximoFechamento = dataDoMes(anoProx, mesProx, cfg.diaDeFechamento);
    ultimoFechamento = desteMes;
  }

  const diasParaFechar = diasEntre(hoje, proximoFechamento);
  const diasDesdeFechamento = diasEntre(ultimoFechamento, hoje);

  const situacao: SituacaoDoCiclo =
    diasParaFechar === 0
      ? "fecha_hoje"
      : diasParaFechar <= cfg.diasDeAviso
        ? "fecha_em_breve"
        : "aberta";

  return {
    situacao,
    proximoFechamento,
    ultimoFechamento,
    vencimentoDaFaturaFechada: calcularVencimento(cfg, ultimoFechamento),
    diasParaFechar,
    diasDesdeFechamento,
    descricao:
      diasParaFechar === 0
        ? "Fatura fecha hoje"
        : `Fatura fecha em ${diasParaFechar} dia${diasParaFechar === 1 ? "" : "s"}`,
  };
}

/**
 * O vencimento da fatura que fechou em `fechamento`.
 *
 * A regra do mes seguinte: se o dia de vencimento for MENOR OU IGUAL ao de
 * fechamento, ele so pode se referir ao mes seguinte -- fatura que fecha dia 25
 * e vence dia 10 vence em 10 do mes que vem, nao quinze dias antes de existir.
 * Sem essa regra, a configuracao mais comum do mercado produziria vencimento no
 * passado, e a tela chamaria de "vencida" toda fatura recem-fechada.
 */
export function calcularVencimento(
  cfg: ConfiguracaoDeFatura,
  fechamento: string | null,
): string | null {
  if (cfg.diaDeVencimento === null || fechamento === null) return null;

  const [ano, mes, dia] = fechamento.split("-").map(Number);
  const mesmoMes = cfg.diaDeVencimento > dia;
  const [anoV, mesV] = mesmoMes ? [ano, mes] : somarMeses(ano, mes, 1);

  return dataDoMes(anoV, mesV, cfg.diaDeVencimento);
}

/** Frase de "fechou ha X dias", para a fatura ja fechada. */
export function descreverFechada(ciclo: CicloDeFatura): string | null {
  if (ciclo.diasDesdeFechamento === null) return null;
  const d = ciclo.diasDesdeFechamento;
  if (d === 0) return "Fatura fechou hoje";
  return `Fatura fechou há ${d} dia${d === 1 ? "" : "s"}`;
}

/** O periodo de competencia da fatura que fechou -- "AAAA-MM". */
export function competenciaDaFaturaFechada(ciclo: CicloDeFatura): string | null {
  return ciclo.ultimoFechamento?.slice(0, 7) ?? null;
}
