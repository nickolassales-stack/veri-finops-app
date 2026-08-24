import { ListaAlertas } from "@/components/diagnostico/lista-alertas";
import { PainelEtl } from "@/components/diagnostico/painel-etl";
import { BotaoColetaOvh } from "@/components/diagnostico/botao-coleta-ovh";
import { PainelOvh } from "@/components/diagnostico/painel-ovh";
import { SeloSituacao } from "@/components/diagnostico/selo-situacao";
import { TabelaFrescor } from "@/components/diagnostico/tabela-frescor";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { ehAdminAtual, requirePermissao } from "@/lib/auth/autorizacao";
import { checkDbHealth } from "@/lib/database";
import { getEnv } from "@/lib/env";
import { formatDataDia, formatDataHora, formatInteiro } from "@/lib/format";
import { listarPrivilegiosDoApp, listarTabelas } from "@/lib/queries/diagnostico";
import { montarDiagnostico } from "@/lib/services/diagnostico";
import { getEstadoColetaOvh } from "@/lib/services/credenciais-ovh";
import { montarVisaoOvh } from "@/lib/services/ovh";

/**
 * Saude do pipeline FinOps.
 *
 * ESTA TELA REUNIU DUAS. Ate esta entrega havia `/diagnostico`, que mostrava a
 * estrutura do banco e os privilegios efetivos. Ela continua existindo como
 * redirecionamento permanente para ca (nenhum link ou favorito quebra) e o seu
 * conteudo virou a ultima secao daqui. Duas telas chamadas "diagnostico" em
 * lugares diferentes obrigariam a lembrar qual delas responde o que -- e a
 * pergunta "o dado esta atualizado?" e a mesma investigacao que "o banco esta
 * respondendo?".
 *
 * A pagina consulta o banco DIRETO, sem passar pelas proprias rotas de API: o
 * servidor ja tem a conexao em maos, e sair para HTTP contra si mesmo so
 * acrescentaria uma volta de rede e uma segunda forma de a mesma pergunta
 * falhar. As rotas e a pagina chamam `montarDiagnostico()`, que e uma so.
 */

export const metadata = { title: "Diagnóstico do pipeline" };

/** A tela e uma fotografia do agora; cache tornaria o diagnostico obsoleto. */
export const dynamic = "force-dynamic";

export default async function DiagnosticoPipelinePage() {
  await requirePermissao("diagnostics:view", "/dashboard/diagnostico");

  const tz = getEnv().APP_TZ;
  const db = await checkDbHealth();

  // Sem banco nao ha diagnostico nenhum -- e a propria falha e o diagnostico.
  if (!db.ok) {
    return (
      <div className="space-y-6">
        <Cabecalho />
        <Aviso tom="critico" titulo="Sem conexão com o PostgreSQL FinOps">
          <p className="veri-numero break-words">{db.error}</p>
          <p>
            Enquanto isto durar, nenhuma tela do portal exibe número — inclusive esta.
            O ETL e o Metabase são independentes do portal e podem estar funcionando.
          </p>
        </Aviso>
      </div>
    );
  }

  // Dois pipelines independentes, duas montagens independentes. A tabela mensal
  // da OVH nao interessa aqui, so o historico de execucoes -- por isso o limite 0.
  // `getEstadoColetaOvh` nunca lanca por tabela ausente -- devolve
  // `disponivel: false`. Isso importa: a tela de diagnostico e justamente a que
  // NAO pode quebrar quando o ambiente esta pela metade.
  const [d, ovh, ehAdmin, coleta] = await Promise.all([
    montarDiagnostico({ limiteHistorico: 10 }),
    montarVisaoOvh(0),
    ehAdminAtual(),
    getEstadoColetaOvh(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Cabecalho />
        <div className="flex flex-col items-end gap-1">
          <SeloSituacao situacao={d.situacao} tamanho="grande" />
          <span className="text-xs text-texto-suave">
            verificado em {formatDataHora(d.agora, tz)}
          </span>
        </div>
      </div>

      <ListaAlertas alertas={d.alertas} />

      {/* FORA do ramo `d.instalado`: aquele booleano diz se o monitoramento do
          ETL AWS existe, e o collector OVH nao depende dele. Amarrar os dois
          esconderia o estado da OVH justamente quando o pipeline AWS esta pela
          metade -- o momento em que saber o que ainda funciona importa mais. */}
      <PainelOvh
        ovh={ovh}
        tz={tz}
        coleta={
          <BotaoColetaOvh
            ehAdmin={ehAdmin}
            disponivel={coleta.disponivel}
            contas={coleta.contas.map((c) => ({
              accountId: c.accountId,
              nome: c.nome,
              temCredencial: c.temCredencial,
              jobAtivo: c.jobAtivo
                ? { id: c.jobAtivo.id, status: c.jobAtivo.status }
                : null,
            }))}
          />
        }
      />

      {d.instalado ? (
        <>
          <PainelEtl d={d} tz={tz} />

          <TabelaFrescor
            contas={d.contas}
            tz={tz}
            diasSemAtualizacao={d.limites.diasSemAtualizacao}
          />

          {d.cobertura && (
            <Card
              titulo="Cobertura do dado"
              descricao="O que existe hoje no PostgreSQL, somando todas as contas."
            >
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <Indicador rotulo="Contas com dado" valor={formatInteiro(d.cobertura.contas)} />
                <Indicador
                  rotulo="Linhas de custo"
                  valor={formatInteiro(d.cobertura.totalLinhas)}
                />
                <Indicador
                  rotulo="Meses de cobrança"
                  valor={formatInteiro(d.cobertura.mesesDisponiveis.length)}
                  detalhe={d.cobertura.mesesDisponiveis.join(", ") || undefined}
                />
                <Indicador
                  rotulo="Datas de uso"
                  valor={
                    d.cobertura.primeiraUsageDate && d.cobertura.ultimaUsageDate
                      ? `${formatDataDia(d.cobertura.primeiraUsageDate)} a ${formatDataDia(d.cobertura.ultimaUsageDate)}`
                      : "—"
                  }
                />
              </dl>
            </Card>
          )}
        </>
      ) : null}

      <Troubleshooting agenda={d.agenda.horario} fuso={d.agenda.fuso} />

      <EstruturaDoBanco db={db} />
    </div>
  );
}

function Cabecalho() {
  return (
    <div>
      <h1 className="veri-display text-3xl text-veri-verde-escuro">
        Diagnóstico do pipeline
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-texto-suave">
        Se a carga rodou, quando rodou, o que ela trouxe e até quando o dado de cada
        conta chega. Tudo vem do PostgreSQL FinOps — esta tela não fala com a AWS.
      </p>
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</dt>
      <dd className="veri-numero mt-1 text-lg text-veri-verde-escuro">{valor}</dd>
      {detalhe && <dd className="veri-numero mt-0.5 text-xs text-texto-suave">{detalhe}</dd>}
    </div>
  );
}

/**
 * O que fazer quando algo acima esta vermelho.
 *
 * Os comandos ficam na tela, e nao so no README, porque quem abre esta pagina
 * as 9h de um dia em que o numero nao bateu nao vai procurar documentacao --
 * vai procurar o proximo passo.
 */
function Troubleshooting({ agenda, fuso }: { agenda: string; fuso: string }) {
  return (
    <Card
      titulo="O que fazer quando algo aqui está vermelho"
      descricao="Procedimento completo em docs/RUNBOOK-app.md, seção 11."
    >
      <ol className="space-y-4 text-sm">
        <li>
          <span className="font-semibold">1. Ver o log da carga na EC2.</span> É a única
          fonte com a saída bruta; o portal não a lê.
          <pre className="veri-numero mt-1 overflow-x-auto rounded-lg bg-veri-offwhite px-4 py-2 text-xs">
            ssh ubuntu@&lt;ec2&gt; &apos;tail -50 /opt/finops/etl.log&apos;
          </pre>
        </li>
        <li>
          <span className="font-semibold">2. Reexecutar a carga à mão.</span> É
          idempotente — reexecutar não duplica linha, porque cada carga é um{" "}
          <span className="veri-numero">ON CONFLICT ... DO UPDATE</span>.
          <pre className="veri-numero mt-1 overflow-x-auto rounded-lg bg-veri-offwhite px-4 py-2 text-xs">
            ssh ubuntu@&lt;ec2&gt; &apos;/opt/finops/run-etl-with-status.sh manual&apos;
          </pre>
        </li>
        <li>
          <span className="font-semibold">3. Mês faltando no meio da série</span> costuma
          ser partição do Athena não adicionada. Ver{" "}
          <span className="veri-numero">add_partition.sql</span> na EC2 e o POP de
          inclusão de conta.
        </li>
        <li>
          <span className="font-semibold">4. Conferir o agendamento.</span> Esta tela
          espera a carga às <span className="veri-numero">{agenda}</span> no fuso{" "}
          <span className="veri-numero">{fuso}</span>. Esse valor é declarado em
          variável de ambiente e <em>não</em> é lido do crontab: se alguém mudar o cron
          sem mudar a variável, o horário exibido aqui fica errado.
          <pre className="veri-numero mt-1 overflow-x-auto rounded-lg bg-veri-offwhite px-4 py-2 text-xs">
            ssh ubuntu@&lt;ec2&gt; &apos;crontab -l | grep etl&apos;
          </pre>
        </li>
      </ol>
    </Card>
  );
}

/**
 * A antiga `/diagnostico`, agora como secao final.
 *
 * Continua valendo o que ela sempre disse: quem manda no que a aplicacao pode
 * fazer e o GRANT do banco, nao o codigo. Numa investigacao de carga, "o portal
 * consegue escrever aqui?" e pergunta legitima -- e a resposta esta abaixo, lida
 * do proprio catalogo.
 */
async function EstruturaDoBanco({
  db,
}: {
  db: Awaited<ReturnType<typeof checkDbHealth>>;
}) {
  const [tabelas, privilegios] = await Promise.all([
    listarTabelas(),
    listarPrivilegiosDoApp(),
  ]);

  const podeEscrever = privilegios.filter((p) => /INSERT|UPDATE|DELETE/.test(p.privilegios));

  return (
    <Card
      titulo="Banco de dados"
      descricao={
        db.ok
          ? `${db.database} · ${db.serverVersion} · latência de ${db.latencyMs} ms na checagem`
          : undefined
      }
    >
      {/* `min-w-0` nos dois: sem isso, as tabelas de largura minima empurram a
          coluna do grid e a pagina passa a rolar de lado no celular. Ver o
          comentario em painel-etl.tsx. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-veri-verde-escuro">
            Objetos encontrados ({tabelas.length})
          </h3>
          <p className="mt-1 text-xs text-texto-suave">
            Contagem de linhas é estimativa do planejador (pg_class.reltuples), não
            contagem exata.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                  <th className="py-2 pr-4 font-medium">Objeto</th>
                  <th className="py-2 pr-4 font-medium">Tipo</th>
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
                    <td className="py-2 pr-4 font-medium">{t.tabela}</td>
                    <td className="py-2 pr-4 text-texto-suave">{t.tipo}</td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {formatInteiro(t.linhasEstimadas)}
                    </td>
                    <td className="veri-numero py-2 text-right">{t.tamanho}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-veri-verde-escuro">
            Privilégios efetivos do portal
          </h3>
          <p className="mt-1 text-xs text-texto-suave">
            Quem manda é o GRANT no banco, não o código da aplicação.
          </p>

          {podeEscrever.length > 0 && (
            <p className="mt-3 rounded-lg border border-veri-verde/40 bg-veri-verde/10 px-4 py-2 text-xs text-veri-verde-escuro">
              Escrita permitida em: <span className="veri-numero">
                {podeEscrever.map((p) => p.tabela.replace("public.", "")).join(", ")}
              </span>
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                  <th className="py-2 pr-4 font-medium">Tabela</th>
                  <th className="py-2 font-medium">Privilégios</th>
                </tr>
              </thead>
              <tbody>
                {privilegios.map((p) => (
                  <tr key={p.tabela} className="border-b border-veri-offwhite/60 last:border-0">
                    <td className="py-2 pr-4 font-medium">{p.tabela.replace("public.", "")}</td>
                    <td className="veri-numero py-2 text-texto-suave">{p.privilegios}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}
