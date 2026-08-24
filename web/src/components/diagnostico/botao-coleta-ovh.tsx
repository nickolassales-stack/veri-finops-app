"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Botao } from "@/components/ui/botao";
import { Selecao } from "@/components/ui/campo";
import { escrever, mensagemDoErro } from "@/lib/admin/cliente";
import {
  ESCOPO_TODAS,
  avaliarEscopo,
  corpoDaColeta,
  type ContaColeta,
} from "@/lib/diagnostico/coleta-manual";

/**
 * "Executar coleta OVH agora" — o botão de coleta manual do Diagnóstico.
 *
 * ---------------------------------------------------------------------------
 * O BOTÃO NÃO EXECUTA NADA
 *
 * Ele chama `POST /api/diagnostico/ovh/collect`, que grava linhas em
 * `cloud_sync_jobs`. Um worker no host processa. O container do portal não
 * alcança o venv do collector, e executar shell a partir de rota HTTP
 * transformaria esta tela em superfície de execução de comando.
 *
 * Consequência que a tela precisa comunicar com honestidade: **a coleta não é
 * instantânea.** O texto diz "enfileirada", nunca "executada", e o resultado
 * aparece quando o worker pega o job.
 *
 * ---------------------------------------------------------------------------
 * REFRESH CONTROLADO, NÃO POLLING
 *
 * `router.refresh()` no clique e num botão explícito. Polling automático foi
 * deixado de fora de propósito: uma tela de diagnóstico costuma ficar aberta e
 * esquecida, e um intervalo geraria requisição indefinidamente contra o mesmo
 * PostgreSQL que o Metabase usa — numa instância que já sofreu OOM.
 */

export type { ContaColeta };

type Estado =
  | { tipo: "normal" }
  | { tipo: "enviando" }
  | { tipo: "enfileirada"; jobs: number; ignoradas: { accountId: string; motivo: string }[] }
  | { tipo: "falha"; mensagem: string };

export function BotaoColetaOvh({
  ehAdmin,
  disponivel,
  contas,
}: {
  ehAdmin: boolean;
  /** `false` quando a migração 008 não rodou neste ambiente. */
  disponivel: boolean;
  contas: ContaColeta[];
}) {
  const router = useRouter();
  const [escopo, setEscopo] = useState<string>(ESCOPO_TODAS);
  const [estado, setEstado] = useState<Estado>({ tipo: "normal" });

  // ---- estados que impedem o clique, em ordem de precedência -------------
  if (!ehAdmin) {
    return (
      <Nota>
        Executar coleta é restrito a administradores. Você pode ver este painel, mas
        não disparar trabalho contra a API da OVH.
      </Nota>
    );
  }

  if (!disponivel) {
    return (
      <Nota>
        A fila de coleta não existe neste ambiente — a migração{" "}
        <span className="veri-numero">008-cloud-sync-jobs.sql</span> não foi aplicada.
        Colete pela EC2 com{" "}
        <span className="veri-numero">./run-ovh-etl.sh manual --all</span>.
      </Nota>
    );
  }

  if (contas.length === 0) {
    return <Nota>Nenhuma conta OVH ativa em cloud_accounts.</Nota>;
  }

  // A decisão mora em `lib/diagnostico/coleta-manual.ts`, com teste próprio: um
  // botão habilitado quando não deveria manda requisição que volta 4xx, e um
  // desabilitado quando não deveria impede trabalho legítimo sem dizer por quê.
  const { selecionadas, emAndamento, semCredencial, tudoEmAndamento, bloqueado } =
    avaliarEscopo(contas, escopo);

  async function executar() {
    setEstado({ tipo: "enviando" });
    try {
      const r = await escrever<{
        jobs: { accountId: string; jobId: string; criado: boolean }[];
        ignoradas: { accountId: string; motivo: string }[];
      }>("/api/diagnostico/ovh/collect", "POST", corpoDaColeta(escopo));

      setEstado({ tipo: "enfileirada", jobs: r.jobs.length, ignoradas: r.ignoradas });
      // Relê o painel para que "Últimas execuções" e o estado da fila reflitam o
      // pedido. O job ainda estará `queued` -- o worker roda a cada minuto.
      router.refresh();
    } catch (e) {
      setEstado({ tipo: "falha", mensagem: mensagemDoErro(e) });
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-veri-offwhite bg-veri-offwhite/40 px-4 py-4">
      <div className="flex flex-wrap items-end gap-3">
        {contas.length > 1 && (
          <div className="min-w-[16rem]">
            <Selecao
              rotulo="Escopo"
              value={escopo}
              onChange={(e) => {
                setEscopo(e.target.value);
                setEstado({ tipo: "normal" });
              }}
            >
              <option value={ESCOPO_TODAS}>Todas as contas OVH ({contas.length})</option>
              {contas.map((c) => (
                <option key={c.accountId} value={c.accountId}>
                  {c.nome} ({c.accountId})
                </option>
              ))}
            </Selecao>
          </div>
        )}

        <Botao
          type="button"
          carregando={estado.tipo === "enviando"}
          rotuloCarregando="Enfileirando…"
          disabled={bloqueado}
          onClick={() => void executar()}
        >
          Executar coleta OVH agora
        </Botao>

        <Botao type="button" tom="secundario" onClick={() => router.refresh()}>
          Atualizar
        </Botao>
      </div>

      {tudoEmAndamento && (
        <p role="status" className="text-sm text-veri-verde-escuro">
          <strong>Já existe uma coleta em andamento</strong>
          {selecionadas.length === 1
            ? "."
            : ` para todas as ${selecionadas.length} contas do escopo.`}{" "}
          Aguarde o worker concluir — no máximo um job vivo por conta.
        </p>
      )}

      {!tudoEmAndamento && emAndamento.length > 0 && (
        <p className="text-xs text-texto-suave">
          {emAndamento.length} de {selecionadas.length} já em andamento; serão puladas.
        </p>
      )}

      {semCredencial.length > 0 && (
        <p className="text-xs text-texto-suave">
          Sem credencial cadastrada:{" "}
          <span className="veri-numero">
            {semCredencial.map((c) => c.accountId).join(", ")}
          </span>{" "}
          — cadastre em Configurações › Contas Cloud.
        </p>
      )}

      {estado.tipo === "enfileirada" && (
        <div
          role="status"
          className="rounded-lg border border-veri-mostarda/40 bg-veri-mostarda/10 px-4 py-3 text-sm leading-relaxed text-veri-verde-escuro"
        >
          <strong>
            {estado.jobs === 1 ? "Coleta enfileirada" : `${estado.jobs} coletas enfileiradas`}
          </strong>
          . O worker processa a fila a cada minuto — o resultado aparece em{" "}
          <em>Últimas execuções</em> quando ele concluir. Use <strong>Atualizar</strong>.
          {estado.ignoradas.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {estado.ignoradas.map((i) => (
                <li key={i.accountId}>
                  <span className="veri-numero">{i.accountId}</span>: {i.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {estado.tipo === "falha" && (
        <p
          role="status"
          className="rounded-lg border border-veri-vinho/30 bg-veri-vinho/5 px-4 py-3 text-sm leading-relaxed text-veri-vinho"
        >
          {estado.mensagem}
        </p>
      )}
    </div>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-veri-offwhite bg-veri-offwhite/40 px-4 py-3 text-xs leading-relaxed text-texto-suave">
      {children}
    </p>
  );
}
