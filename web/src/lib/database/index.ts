/**
 * Camada centralizada de banco. Todo acesso ao PostgreSQL passa por aqui.
 *
 * - `client`  conexao, pool, execucao de query parametrizada, health check
 * - `sql`     montagem segura de filtros dinamicos e ordenacao
 * - `tipos-pg` traducao de `date` e `timestamp` para JavaScript
 */
export {
  checkDbHealth,
  getPool,
  query,
  queryForaDoEscopo,
  queryOne,
  type DbHealth,
} from "./client";

export { ConstrutorParams, escaparLike, identificadorPermitido } from "./sql";
