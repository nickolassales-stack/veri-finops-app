/**
 * Tokens de grafico -- derivados da paleta VERI (docs/skill-veri.md).
 *
 * Validado com o validador de paleta (6 checagens), resultado registrado em
 * docs/DECISOES-dataviz.md. Resumo do que a validacao determinou:
 *
 * - `#384E46` (verde escuro) passa contraste >= 3:1 contra superficie clara
 *   -> usado em marcas de LINHA e em enfase primaria.
 * - `#7F9C90` (verde) fica em 2,9:1 -> permitido apenas COM rotulo direto de
 *   valor e visao de tabela ao lado. Nunca sozinho como unica pista.
 * - O par `#384E46` + `#7F9C90` passa separacao CVD e visao normal com
 *   deltaE 26,4 -> unico par autorizado para duas series.
 * - Periodo lancado no futuro usa TEXTURA (hachura) na mesma cor, nao uma cor
 *   nova: mostarda contra verde da deltaE 14,1 (abaixo do piso de 15).
 * - Mostarda e vinho ficam reservados para status, sempre com rotulo textual.
 */

export const CORES = {
  /** Marca principal de linha e enfase. Contraste aprovado. */
  linha: "#384E46",
  /** Preenchimento de barra. Exige rotulo direto de valor. */
  barra: "#7F9C90",
  /** Segunda serie, quando houver exatamente duas. */
  barraSecundaria: "#384E46",
  grade: "#DDE3DD",
  eixo: "#5C7168",
  texto: "#384E46",
  superficie: "#FFFFFF",
} as const;

/** Marcas finas e recessivas, conforme especificacao de marcas. */
export const MARCAS = {
  espessuraLinha: 2,
  raioBarra: 4,
  tamanhoMarcador: 8,
  espacoEntreBarras: 2,
} as const;

export const EIXO_TICK = {
  fill: CORES.eixo,
  fontSize: 11,
} as const;
