import Link from "next/link";

import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { checkDbHealth } from "@/lib/db";

export const metadata = { title: "Visao executiva" };

/**
 * FASE ATUAL: a visao executiva ainda nao foi construida porque o schema real do
 * PostgreSQL nao foi inspecionado (ver scripts/inspect-schema.sql). Esta pagina
 * NAO exibe numero financeiro algum -- nao ha dado mockado no projeto. Ela mostra
 * apenas o estado real da integracao com o banco.
 */
export default async function Home() {
  const db = await checkDbHealth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Visao executiva</h1>
        <p className="mt-2 max-w-2xl text-sm text-veri-verde-escuro/70">
          Custos AWS consolidados a partir do PostgreSQL FinOps.
        </p>
      </div>

      {db.ok ? (
        <Card
          titulo="Conexao com o PostgreSQL FinOps"
          descricao="Integracao real verificada nesta requisicao."
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                Banco
              </dt>
              <dd className="veri-numero mt-1 text-base">{db.database}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                Servidor
              </dt>
              <dd className="veri-numero mt-1 text-base">{db.serverVersion}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                Latencia
              </dt>
              <dd className="veri-numero mt-1 text-base">{db.latencyMs} ms</dd>
            </div>
          </dl>
        </Card>
      ) : (
        <Aviso tom="critico" titulo="Sem conexao com o PostgreSQL FinOps">
          <p className="veri-numero break-words">{db.error}</p>
          <p>
            Confira as variaveis de ambiente do servico e se o container do banco esta
            no ar. Detalhes em <code>/api/health</code>.
          </p>
        </Aviso>
      )}

      <Aviso tom="atencao" titulo="Indicadores financeiros ainda nao publicados">
        <p>
          Os cards de custo serao construidos somente depois da inspecao do schema
          real do banco, para nao assumir nomes de tabela ou coluna a partir da
          documentacao. Nenhum numero exibido aqui e simulado.
        </p>
        <p>
          Enquanto isso, o{" "}
          <Link href="/diagnostico" className="underline underline-offset-2">
            diagnostico
          </Link>{" "}
          mostra o que existe de fato no banco.
        </p>
      </Aviso>
    </div>
  );
}
