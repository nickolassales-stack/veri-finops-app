import { types } from "pg";

/**
 * Como o driver traduz os tipos do Postgres para JavaScript.
 *
 * Os dois ajustes abaixo existem porque o padrao do `pg` produz data errada
 * neste banco. Sao registrados uma unica vez, antes de qualquer conexao.
 */

/** OIDs dos tipos que reescrevemos. Ver `SELECT oid, typname FROM pg_type`. */
const OID_DATE = 1082;
const OID_TIMESTAMP_SEM_FUSO = 1114;

let registrado = false;

export function registrarTiposPg(): void {
  if (registrado) return;
  registrado = true;

  /**
   * `date` -> string "AAAA-MM-DD", sem virar Date.
   *
   * O padrao do driver constroi `new Date(ano, mes, dia)` em horario LOCAL do
   * processo. Em fuso negativo, `2026-08-01` vira `2026-08-01T03:00:00Z`, e
   * qualquer formatacao em UTC (ou `toISOString()`) devolve o dia anterior.
   * Uma data de competencia nao tem hora nem fuso -- guardar como texto e o
   * unico jeito de ela nao mudar de dia no caminho.
   */
  types.setTypeParser(OID_DATE, (valor: string) => valor);

  /**
   * `timestamp without time zone` -> Date interpretando o valor como UTC.
   *
   * As tabelas do ETL usam `timestamp` puro e o servidor roda em `Etc/UTC`,
   * entao `now()` grava UTC. O driver, porem, le esse texto como horario local
   * do processo Node: em America/Sao_Paulo a carga das 08:00 UTC aparecia como
   * 08:00 BRT, tres horas adiantada.
   *
   * As tabelas de autenticacao usam `timestamptz` (OID 1184) e nao passam por
   * aqui -- aquelas o driver ja converte corretamente.
   */
  types.setTypeParser(OID_TIMESTAMP_SEM_FUSO, (valor: string) => {
    const data = new Date(`${valor.replace(" ", "T")}Z`);
    // "infinity", "-infinity" e datas AC nao casam com o formato ISO. Nessa
    // situacao devolvemos o texto cru em vez de um Invalid Date silencioso.
    return Number.isNaN(data.getTime()) ? valor : data;
  });
}
