/**
 * Montagem de SQL dinamico sem concatenar valor.
 *
 * Filtros opcionais (contas, periodo, regiao, busca) mudam a quantidade de
 * parametros de uma query para outra. O jeito perigoso de resolver isso e
 * interpolar o valor no texto do SQL. `ConstrutorParams` resolve do jeito
 * certo: o valor vai para o array de parametros e o SQL recebe apenas o
 * placeholder ($1, $2...) que o proprio construtor numera.
 *
 * Nomes de coluna e direcao de ordenacao NUNCA podem ser parametrizados pelo
 * protocolo do Postgres -- por isso `identificadorPermitido` obriga a passar
 * por uma lista fechada antes de qualquer nome ir para o texto da query.
 */

export class ConstrutorParams {
  private readonly valores: unknown[] = [];

  /** Registra o valor e devolve o placeholder correspondente. */
  add(valor: unknown): string {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }

  /** Array na ordem exata dos placeholders, para passar ao driver. */
  get lista(): unknown[] {
    return this.valores;
  }

  get quantidade(): number {
    return this.valores.length;
  }
}

/**
 * Garante que um identificador (coluna, direcao) veio de lista fechada.
 *
 * Chamar isto e obrigatorio antes de colocar qualquer nome no texto do SQL.
 * Mesmo quando a origem ja e um enum validado por Zod, a checagem aqui impede
 * que uma refatoracao futura transforme ordenacao em injecao de SQL.
 */
export function identificadorPermitido<T extends string>(
  valor: string,
  permitidos: Readonly<Record<T, string>> | readonly T[],
): valor is T {
  return Array.isArray(permitidos)
    ? (permitidos as readonly string[]).includes(valor)
    : Object.hasOwn(permitidos as object, valor);
}

/**
 * Escapa os curingas de LIKE/ILIKE.
 *
 * Sem isso, uma busca por "100%" casaria com tudo que comeca em "100", e uma
 * busca so com "%" listaria a base inteira. Nao e falha de seguranca (o valor
 * continua indo como parametro), e sim de correcao do resultado.
 *
 * O `\` precisa ser escapado primeiro, senao escaparia os escapes seguintes.
 */
export function escaparLike(termo: string): string {
  return termo.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
