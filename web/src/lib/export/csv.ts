import type { Celula } from "./colunas";

/**
 * Serializacao CSV para abrir no Excel em portugues do Brasil.
 *
 * Tres decisoes que parecem detalhe e nao sao:
 *
 * 1. BOM UTF-8 no inicio. Sem ele o Excel do Windows abre o arquivo na
 *    codificacao ANSI da maquina e "Serviço" vira "Serviço". Nenhum usuario
 *    de gestao vai converter codificacao a mao.
 * 2. Separador `;`. O Excel em pt-BR usa o separador de lista do sistema, que e
 *    ponto-e-virgula. Com virgula, a planilha inteira cai numa coluna so.
 * 3. Decimal com virgula. `597,28` e numero para o Excel pt-BR; `597.28` vira
 *    texto -- e texto nao soma.
 *
 * Modulo PURO. Nada de fetch, nada de banco.
 */

/**
 * Marca de ordem de bytes: e o que faz o Excel reconhecer UTF-8.
 *
 * Escrito como escape, e nao como o caractere literal, porque o caractere e
 * invisivel no editor -- e um BOM invisivel apagado sem querer produziria um bug
 * de acentuacao sem nenhum rastro no diff.
 */
export const BOM = "\uFEFF";

export const SEPARADOR = ";";

/** CRLF: o que o Excel espera, e inofensivo em qualquer outro leitor. */
export const FIM_DE_LINHA = "\r\n";

/**
 * Caracteres que fazem o Excel/LibreOffice tratar a celula como FORMULA.
 *
 * O risco e concreto: `service` e `account_name` vem do ETL, e um valor como
 * `=HYPERLINK(...)` ou `=cmd|'/c calc'!A1` seria executado ao abrir a planilha
 * na maquina de quem recebeu o arquivo. E a injecao de formula em CSV (CWE-1236)
 * -- o parametro `$1` do Postgres protege o banco, nao o Excel de quem abre.
 */
const INICIAIS_PERIGOSAS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutraliza a formula prefixando com apostrofo.
 *
 * O apostrofo e a marca que o proprio Excel usa para "isto e texto"; ele nao
 * aparece na celula ao abrir a planilha.
 *
 * Aplicado SOMENTE a texto. Numeros sao gerados por `celulaCSV` a partir de um
 * `number`, entao so podem conter digitos, sinal e virgula -- e um custo
 * negativo (credito da AWS) precisa continuar sendo numero, nao virar `'-12,34`
 * e parar de somar.
 */
export function protegerFormula(texto: string): string {
  const primeiro = texto.charAt(0);
  return INICIAIS_PERIGOSAS.has(primeiro) ? `'${texto}` : texto;
}

/**
 * Aspas quando o conteudo pode confundir o parser.
 *
 * Inclui espaco na ponta: sem aspas, alguns leitores o descartam e o valor
 * exportado deixa de ser igual ao armazenado.
 */
export function citarCSV(texto: string): string {
  const precisa =
    texto.includes(SEPARADOR) ||
    texto.includes('"') ||
    texto.includes("\n") ||
    texto.includes("\r") ||
    texto !== texto.trim();

  return precisa ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** Numero em formato pt-BR: virgula decimal e SEM separador de milhar. */
export function numeroCSV(valor: number, casas: number): string {
  // Separador de milhar quebraria a leitura do Excel em locales que usam ponto,
  // e nao acrescenta nada num arquivo que sera lido por maquina.
  return valor.toFixed(casas).replace(".", ",");
}

/** Data de calendario "AAAA-MM-DD" -> "DD/MM/AAAA", sem passar por `Date`. */
export function dataCSV(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Uma celula ja classificada -> o texto que vai para o arquivo. */
export function celulaCSV(celula: Celula): string {
  if (celula.valor === null || celula.valor === undefined) return "";

  switch (celula.tipo) {
    case "numero":
      return numeroCSV(celula.valor, celula.casas);
    case "data":
      return citarCSV(dataCSV(celula.valor));
    default:
      return citarCSV(protegerFormula(celula.valor));
  }
}

export function linhaCSV(campos: string[]): string {
  return campos.join(SEPARADOR) + FIM_DE_LINHA;
}

/**
 * Linha de metadado: `# Rotulo;valor`.
 *
 * O `#` na frente marca visualmente que aquilo nao e dado -- e permite que
 * pandas/R pulem o cabecalho com `comment='#'`. O Excel simplesmente mostra o
 * texto nas primeiras linhas, que e o efeito desejado para quem so vai ler.
 */
export function linhaMetadadoCSV(rotulo: string, valor: string): string {
  // O valor tambem passa pela protecao de formula: o bloco carrega nome de
  // conta (vem do banco) e o termo de busca (vem do usuario), nao so texto
  // nosso. Celula de cabecalho executa formula igual a celula de dado.
  return linhaCSV([citarCSV(`# ${rotulo}`), citarCSV(protegerFormula(valor))]);
}
