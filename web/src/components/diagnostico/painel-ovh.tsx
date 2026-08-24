import type { ReactNode } from "react";

import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { SeloProvider } from "@/components/ui/selo-provider";
import {
  resumoOrigem,
  type OrigemCredenciais,
} from "@/lib/diagnostico/credenciais-ovh";
import type { AlertaOvh } from "@/lib/diagnostico/ovh";
import type { Secao } from "@/lib/diagnostico/resiliencia";
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
 *
 * ---------------------------------------------------------------------------
 * CADA BLOCO CAI SOZINHO
 *
 * `ovh` e `origem` chegam como `Secao<…>` — resultado que pode ter falhado — e
 * não como o dado pronto. São TRÊS consultas independentes por trás deste
 * quadro: o histórico de execuções (`ovh_sync_runs`), a origem das credenciais
 * (`cloud_provider_credentials`) e a fila (`cloud_sync_jobs`). Elas falham por
 * motivos diferentes, e uma tabela ausente costuma atingir só uma delas.
 *
 * Receber o dado já pronto obrigaria quem chama a decidir antes: ou mostra o
 * quadro inteiro, ou não mostra nada. Justamente num quadro cujo propósito é
 * dizer o que ainda funciona, "nada" seria a pior resposta possível.
 */
export function PainelOvh({
  ovh: secaoOvh,
  tz,
  coleta,
  origem: secaoOrigem,
  alertasExtra = [],
}: {
  ovh: Secao<VisaoOvh>;
  tz: string;
  /** De onde cada conta OVH tira a credencial. Ausente = não avaliado. */
  origem?: Secao<OrigemCredenciais>;
  /**
   * Alertas apurados fora deste componente — fila parada, cifragem ausente.
   * Ficam aqui, e não numa faixa no topo da página, porque dizem respeito a
   * este pipeline: um alerta de fila OVH acima do quadro do ETL AWS sugeriria
   * que o problema é do ETL.
   */
  alertasExtra?: AlertaOvh[];
  /**
   * O bloco de coleta manual. Recebido como `ReactNode` e nao construido aqui de
   * proposito: este componente e de SERVIDOR, o botao e de cliente, e montar o
   * cliente aqui dentro arrastaria a fronteira para um arquivo que hoje so
   * formata numero.
   */
  coleta?: ReactNode;
}) {
  const ovh = secaoOvh.ok ? secaoOvh.valor : null;
  const origem = secaoOrigem?.ok ? secaoOrigem.valor : null;

  return (
    <Card
      titulo="OVH Collector"
      descricao="Coleta de faturamento OVHcloud. Independente do ETL AWS."
      acao={<SeloProvider provider="ovh" />}
    >
      <div className="space-y-4">
        {!secaoOvh.ok && (
          <Aviso tom="critico" titulo="Histórico de execuções indisponível">
            <p>
              Não foi possível ler <span className="veri-numero">ovh_sync_runs</span>.
              O que aparece abaixo sobre credenciais e coleta vem de outras tabelas e
              continua válido.
            </p>
            <p className="veri-numero break-words text-xs">{secaoOvh.erro}</p>
          </Aviso>
        )}

        {ovh?.alertas.map((a) => (
          <Aviso key={a.chave} tom={a.tom} titulo={a.titulo}>
            <p>{a.detalhe}</p>
          </Aviso>
        ))}

        {alertasExtra.map((a) => (
          <Aviso key={a.chave} tom={a.tom} titulo={a.titulo}>
            <p>{a.detalhe}</p>
          </Aviso>
        ))}

        {secaoOrigem && !secaoOrigem.ok && (
          <Aviso tom="critico" titulo="Origem das credenciais indisponível">
            <p>
              Não foi possível apurar de onde cada conta OVH tira a credencial. Isto
              não interrompe a coleta — só a verificação. Enquanto durar, não é
              possível confirmar por esta tela se alguma conta ainda depende do
              fallback legado.
            </p>
            <p className="veri-numero break-words text-xs">{secaoOrigem.erro}</p>
          </Aviso>
        )}

        {/* Alertas de ORIGEM DE CREDENCIAL vêm antes do botão de coleta: pedir
            uma coleta sem saber que a conta depende do arquivo é pedir a coleta
            errada. */}
        {origem?.alertas.map((a) => (
          <Aviso key={a.chave} tom={a.tom} titulo={a.titulo}>
            <p>{a.detalhe}</p>
          </Aviso>
        ))}

        {origem && <OrigemDasCredenciais origem={origem} />}

        {coleta}

        {/* `erro_de_leitura` some com o bloco de metricas: elas viriam todas
            "—", e uma grade de travessoes ao lado de um alerta vermelho sugere
            que a coleta zerou, quando o que falhou foi a leitura. */}
        {ovh && ovh.instalado && ovh.situacao !== "erro_de_leitura" && (
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
        {ovh && (
        <p className="text-xs text-texto-suave">
          Agendamento:{" "}
          {ovh.cronInstalado ? (
            <>
              <span className="font-medium">cron instalado</span>, diariamente às{" "}
              <span className="veri-numero">{ovh.horarioEsperado}</span> (
              {ovh.fusoDoAgendador}).{" "}
              {ovh.situacao !== "erro_de_leitura" &&
                (ovh.teveExecucaoAutomatica ? (
                  <>Já houve execução automática registrada.</>
                ) : (
                  <>
                    <strong>Nenhuma execução automática registrada ainda</strong> — as
                    coletas até agora foram manuais.
                  </>
                ))}
            </>
          ) : (
            <>
              <span className="font-medium">cron NÃO instalado</span>. A coleta só roda
              quando alguém executa <span className="veri-numero">run-ovh-etl.sh</span>{" "}
              à mão.
            </>
          )}{" "}
          Este estado vem de <span className="veri-numero">OVH_CRON_INSTALADO</span> e é{" "}
          <strong>declarado</strong>, não lido do crontab — o portal roda em container
          sem acesso ao host. Se alguém mudar o cron sem mudar a variável, esta linha
          passa a mentir.
        </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Uma linha por conta, dizendo de onde vem a credencial.
 *
 * Existe além do alerta porque o alerta só aparece quando há problema — e a
 * pergunta "de onde vem a credencial desta conta?" é legítima também quando está
 * tudo certo. Sem esta lista, confirmar que a migração terminou exigiria abrir o
 * banco.
 */
function OrigemDasCredenciais({ origem }: { origem: OrigemCredenciais }) {
  const contas = [...origem.noBanco, ...origem.emFallback].sort((a, b) =>
    a.accountId.localeCompare(b.accountId),
  );
  if (contas.length === 0) return null;

  return (
    <div className="rounded-lg border border-veri-offwhite bg-veri-offwhite/40 px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">
        Origem das credenciais OVH
      </h3>

      <ul className="mt-2 space-y-1 text-sm">
        {contas.map((c) => (
          <li key={c.accountId} className="flex flex-wrap items-baseline gap-2">
            <span className="veri-numero font-medium text-veri-verde-escuro">
              {c.accountId}
            </span>
            {c.temCredencial ? (
              <span className="inline-flex items-center rounded-full border border-veri-verde/50 bg-veri-verde/12 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-veri-verde-escuro">
                banco (cifrada)
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-veri-mostarda/50 bg-veri-mostarda/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-veri-verde-escuro">
                fallback legado
              </span>
            )}
            {c.status && (
              <span className="text-xs text-texto-suave">status: {c.status}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs leading-relaxed text-texto-suave">
        {resumoOrigem(origem)} O portal não lê o <span className="veri-numero">.env</span>{" "}
        do servidor: “fallback legado” significa que a conta está ativa e{" "}
        <strong>não tem</strong> credencial cadastrada — o collector usa o arquivo, ou
        não coleta a conta.
      </p>
    </div>
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
