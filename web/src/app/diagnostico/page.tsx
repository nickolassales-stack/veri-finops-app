import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { checkDbHealth } from "@/lib/db";
import { formatInteiro } from "@/lib/format";
import { listarPrivilegiosDoApp, listarTabelas } from "@/lib/queries/diagnostico";

export const metadata = { title: "Diagnostico" };

export default async function DiagnosticoPage() {
  const db = await checkDbHealth();

  if (!db.ok) {
    return (
      <div className="space-y-6">
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Diagnostico</h1>
        <Aviso tom="critico" titulo="Sem conexao com o PostgreSQL FinOps">
          <p className="veri-numero break-words">{db.error}</p>
        </Aviso>
      </div>
    );
  }

  const [tabelas, privilegios] = await Promise.all([
    listarTabelas(),
    listarPrivilegiosDoApp(),
  ]);

  const podeEscrever = privilegios.filter((p) =>
    /INSERT|UPDATE|DELETE/.test(p.privilegios),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Diagnostico</h1>
        <p className="mt-2 max-w-2xl text-sm text-veri-verde-escuro/70">
          Estado real da integracao com o PostgreSQL FinOps. Tudo nesta pagina vem do
          catalogo do proprio banco, sem assumir nenhum schema.
        </p>
      </div>

      <Card titulo="Conexao" descricao={`Banco ${db.database} · ${db.serverVersion}`}>
        <p className="text-sm">
          Latencia da checagem: <span className="veri-numero">{db.latencyMs} ms</span>
        </p>
      </Card>

      <Card
        titulo="Objetos encontrados no banco"
        descricao={`${tabelas.length} objeto(s). Contagem de linhas e estimativa do planejador (pg_class.reltuples).`}
      >
        {tabelas.length === 0 ? (
          <p className="text-sm text-veri-verde-escuro/70">
            Nenhum objeto visivel para este usuario.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                  <th className="py-2 pr-4 font-medium">Schema</th>
                  <th className="py-2 pr-4 font-medium">Objeto</th>
                  <th className="py-2 pr-4 font-medium">Tipo</th>
                  <th className="py-2 pr-4 text-right font-medium">Colunas</th>
                  <th className="py-2 pr-4 text-right font-medium">Linhas (est.)</th>
                  <th className="py-2 text-right font-medium">Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {tabelas.map((t) => (
                  <tr
                    key={`${t.schema}.${t.tabela}`}
                    className="border-b border-veri-offwhite/60 last:border-0"
                  >
                    <td className="py-2 pr-4">{t.schema}</td>
                    <td className="py-2 pr-4 font-medium">{t.tabela}</td>
                    <td className="py-2 pr-4 text-veri-verde-escuro/70">{t.tipo}</td>
                    <td className="veri-numero py-2 pr-4 text-right">{t.colunas}</td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {formatInteiro(t.linhasEstimadas)}
                    </td>
                    <td className="veri-numero py-2 text-right">{t.tamanho}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        titulo="Permissoes efetivas da aplicacao"
        descricao="Quem manda e o GRANT no banco, nao o codigo da aplicacao."
      >
        {podeEscrever.length > 0 ? (
          <Aviso tom="info" titulo="Tabelas com permissao de escrita">
            <p className="veri-numero">
              {podeEscrever.map((p) => p.tabela).join(", ")}
            </p>
          </Aviso>
        ) : (
          <Aviso tom="info" titulo="Somente leitura">
            <p>
              Este usuario nao tem INSERT/UPDATE/DELETE em nenhuma tabela. As telas de
              governanca (contas, orcamentos, alertas) precisam de GRANT explicito.
            </p>
          </Aviso>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                <th className="py-2 pr-4 font-medium">Tabela</th>
                <th className="py-2 font-medium">Privilegios</th>
              </tr>
            </thead>
            <tbody>
              {privilegios.map((p) => (
                <tr
                  key={p.tabela}
                  className="border-b border-veri-offwhite/60 last:border-0"
                >
                  <td className="py-2 pr-4 font-medium">{p.tabela}</td>
                  <td className="veri-numero py-2 text-veri-verde-escuro/70">
                    {p.privilegios}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
