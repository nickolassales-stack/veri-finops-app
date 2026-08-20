import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { SeloProvider } from "@/components/ui/selo-provider";
import { formatDataHora, formatInteiro } from "@/lib/format";
import type { VisaoOvh } from "@/lib/services/ovh";

/**
 * Saude do collector OVH, lida de `ovh_sync_runs`.
 *
 * Bloco separado do painel do ETL AWS de proposito: sao dois pipelines
 * independentes, com agendas e falhas independentes. Um quadro unico obrigaria
 * a inventar uma situacao combinada -- e "parcialmente OK" nao informa qual dos
 * dois quebrou.
 *
 * A mensagem de erro exibida aqui vem SANITIZADA do collector: chaves de API e
 * o identificador de query da OVH sao substituidos antes de chegar ao banco.
 * Ainda assim ela aparece dentro de um bloco de largura limitada e truncada em
 * 500 caracteres pela query -- um stack inteiro na tela nao ajuda ninguem.
 */
export function PainelOvh({ ovh, tz }: { ovh: VisaoOvh; tz: string }) {
  return (
    <Card
      titulo="OVH Collector"
      descricao="Coleta de faturamento OVHcloud. Independente do ETL AWS."
      acao={<SeloProvider provider="ovh" />}
    >
      <div className="space-y-4">
        {ovh.alertas.map((a) => (
          <Aviso key={a.chave} tom={a.tom} titulo={a.titulo}>
            <p>{a.detalhe}</p>
          </Aviso>
        ))}

        {ovh.instalado && (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Item rotulo="Último status" valor={ovh.ultima?.status ?? "nunca executou"} />
              <Item
                rotulo="Início"
                valor={ovh.ultima ? formatDataHora(ovh.ultima.startedAt, tz) : "—"}
              />
              <Item
                rotulo="Fim"
                valor={
                  ovh.ultima?.finishedAt
                    ? formatDataHora(ovh.ultima.finishedAt, tz)
                    : ovh.ultima
                      ? "em aberto"
                      : "—"
                }
              />
              <Item
                rotulo="Origem"
                valor={ovh.ultima?.source ?? "—"}
              />
              <Item
                rotulo="Linhas de custo"
                valor={ovh.ultima ? formatInteiro(ovh.ultima.costRows) : "—"}
              />
              <Item
                rotulo="Faturas"
                valor={ovh.ultima ? formatInteiro(ovh.ultima.invoiceRows) : "—"}
              />
              <Item
                rotulo="Projetos"
                valor={ovh.ultima ? formatInteiro(ovh.ultima.projectsRows) : "—"}
              />
              <Item
                rotulo="Contas"
                valor={ovh.ultima ? formatInteiro(ovh.ultima.accountsRows) : "—"}
              />
            </dl>

            {ovh.ultima?.errorMessage && (
              <div>
                <p className="text-xs uppercase tracking-wide text-texto-suave">
                  Erro da última execução
                </p>
                <pre className="veri-numero mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-veri-vinho/30 bg-veri-vinho/5 p-3 text-xs text-veri-vinho">
                  {ovh.ultima.errorMessage}
                </pre>
                <p className="mt-1 text-xs text-texto-suave">
                  Mensagem sanitizada na origem pelo collector: chaves de API e
                  identificadores de query da OVH são substituídos antes de chegar ao
                  banco.
                </p>
              </div>
            )}

            {ovh.ultimoSucesso && ovh.ultima?.id !== ovh.ultimoSucesso.id && (
              <p className="text-xs text-texto-suave">
                Último sucesso: execução{" "}
                <span className="veri-numero">#{ovh.ultimoSucesso.id}</span> em{" "}
                {formatDataHora(
                  ovh.ultimoSucesso.finishedAt ?? ovh.ultimoSucesso.startedAt,
                  tz,
                )}{" "}
                — <span className="veri-numero">{formatInteiro(ovh.ultimoSucesso.costRows)}</span>{" "}
                linha(s) de custo. O dado exibido em Faturamento é desta execução.
              </p>
            )}

            {ovh.historico.length > 1 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <caption className="pb-2 text-left text-xs uppercase tracking-wide text-texto-suave">
                    Últimas execuções
                  </caption>
                  <thead>
                    <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                      <th className="py-2 pr-4 font-medium">#</th>
                      <th className="py-2 pr-4 font-medium">Início</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Origem</th>
                      <th className="py-2 pr-4 font-medium">Custos</th>
                      <th className="py-2 font-medium">Faturas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ovh.historico.map((e) => (
                      <tr key={e.id} className="border-b border-veri-offwhite/60 last:border-0">
                        <td className="veri-numero py-2 pr-4 text-texto-suave">{e.id}</td>
                        <td className="veri-numero py-2 pr-4">
                          {formatDataHora(e.startedAt, tz)}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={
                              e.status === "success"
                                ? "text-veri-verde-escuro"
                                : e.status === "running"
                                  ? "text-texto-suave"
                                  : "font-medium text-veri-vinho"
                            }
                          >
                            {e.status}
                          </span>
                        </td>
                        <td className="veri-numero py-2 pr-4 text-texto-suave">{e.source}</td>
                        <td className="veri-numero py-2 pr-4">{formatInteiro(e.costRows)}</td>
                        <td className="veri-numero py-2">{formatInteiro(e.invoiceRows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Declarado, nao medido. O portal roda em container sem acesso ao
            crontab do host -- mesma limitacao da agenda do ETL AWS, e pelo
            mesmo motivo esta escrito em vez de verificado. */}
        <p className="text-xs text-texto-suave">
          Agendamento:{" "}
          <span className="font-medium">
            {ovh.cronInstalado ? "cron instalado" : "cron NÃO instalado"}
          </span>
          . A coleta OVH só roda quando alguém executa{" "}
          <span className="veri-numero">run-ovh-etl.sh</span> à mão. Este estado é
          declarado pela aplicação, não lido do crontab — o portal não tem acesso ao
          host.
        </p>
      </div>
    </Card>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</dt>
      <dd className="veri-numero mt-0.5 text-sm text-veri-verde-escuro">{valor}</dd>
    </div>
  );
}
