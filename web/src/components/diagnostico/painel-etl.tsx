import { Card } from "@/components/ui/card";
import type { Diagnostico } from "@/lib/services/diagnostico";
import { formatDataHora, formatInteiro } from "@/lib/format";

import { SeloSituacao, formatDuracao } from "./selo-situacao";

/**
 * O bloco "como esta o ETL": situacao, ultima execucao, proxima esperada e
 * historico recente.
 *
 * Componente de SERVIDOR. Nao ha estado nem interacao aqui -- a pagina inteira e
 * uma fotografia do banco no instante da requisicao, e transformar isso em
 * componente de cliente so acrescentaria uma chamada de API para exibir os
 * mesmos numeros que o servidor ja tinha em maos.
 */

const ORIGEM: Record<string, string> = {
  cron: "agendada (cron)",
  manual: "manual",
  unknown: "não identificada",
};

export function PainelEtl({ d, tz }: { d: Diagnostico; tz: string }) {
  const { ultima, ultimoSucesso } = d;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* `min-w-0` nos dois: item de grid nasce com `min-width: auto`, ou seja,
          nao encolhe abaixo do min-content do que tem dentro. A tabela de
          execucoes tem largura minima de 34rem, e sem isto ela empurra a COLUNA
          -- que no celular e a mesma dos dois cards --, jogando a pagina inteira
          para 617px de largura num visor de 390px. O `overflow-x-auto` da
          tabela so passa a valer depois que o item pode encolher. */}
      <Card
        className="min-w-0"
        titulo="Situação do ETL"
        descricao="Carga Athena → PostgreSQL, executada na EC2 FinOps."
        acao={<SeloSituacao situacao={d.situacao} tamanho="grande" />}
      >
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Linha rotulo="Próxima execução esperada">
            {formatDataHora(d.agenda.proximaEsperada, tz)}
          </Linha>
          <Linha rotulo="Agendamento">
            {/* Os dois fusos aparecem juntos porque a diferenca entre eles ja
                custou uma leitura errada: o cron marca 08:00 no fuso do
                servidor, que nao e o fuso de quem le a tela. */}
            <span className="veri-numero">{d.agenda.horario}</span> em {d.agenda.fuso}
            <span className="block text-xs text-texto-suave">
              tolerância de {d.agenda.toleranciaMinutos} min antes de acusar atraso
            </span>
          </Linha>
          <Linha rotulo="Início da última execução">
            {ultima ? formatDataHora(ultima.iniciadaEm, tz) : "—"}
          </Linha>
          <Linha rotulo="Fim">
            {ultima?.finalizadaEm ? formatDataHora(ultima.finalizadaEm, tz) : "—"}
          </Linha>
          <Linha rotulo="Duração">
            {formatDuracao(ultima?.duracaoSegundos ?? null)}
          </Linha>
          <Linha rotulo="Origem">{ultima ? ORIGEM[ultima.origem] : "—"}</Linha>
          <Linha rotulo="Linhas mensais carregadas">
            {ultima?.linhasMensais === null || ultima === null
              ? "—"
              : formatInteiro(ultima.linhasMensais)}
          </Linha>
          <Linha rotulo="Linhas diárias carregadas">
            {ultima?.linhasDiarias === null || ultima === null
              ? "—"
              : formatInteiro(ultima.linhasDiarias)}
          </Linha>
        </dl>

        {ultima?.erro && (
          <p className="mt-4 rounded-lg border border-veri-vinho/40 bg-veri-vinho/8 px-4 py-3 text-sm text-veri-vinho">
            <span className="font-semibold">Mensagem registrada:</span>{" "}
            <span className="veri-numero break-words">{ultima.erro}</span>
          </p>
        )}

        {/* O caminho do log aparece; o CONTEUDO nunca. Ele traz saida bruta de
            Athena e traceback -- material que vaza id de consulta, bucket e, em
            erro de conexao, a string de conexao inteira. */}
        {ultima?.caminhoDoLog && (
          <p className="mt-3 text-xs text-texto-suave">
            Log completo na EC2:{" "}
            <span className="veri-numero">{ultima.caminhoDoLog}</span>. O portal não lê o
            conteúdo do arquivo.
          </p>
        )}

        {ultimoSucesso && ultima && ultimoSucesso.id !== ultima.id && (
          <p className="mt-3 rounded-lg border border-veri-mostarda/50 bg-veri-amarelo/15 px-4 py-3 text-sm">
            O dado exibido no portal é o da última carga bem-sucedida, de{" "}
            <span className="veri-numero">
              {formatDataHora(ultimoSucesso.iniciadaEm, tz)}
            </span>
            .
          </p>
        )}
      </Card>

      <Card
        className="min-w-0"
        titulo="Execuções recentes"
        descricao={
          d.resumo
            ? `${d.resumo.total} execução(ões) nos últimos 30 dias · ${d.resumo.falhas} falha(s) · duração média ${formatDuracao(d.resumo.duracaoMediaSegundos)}`
            : undefined
        }
      >
        {d.historico.length === 0 ? (
          <p className="text-sm text-texto-suave">
            Nenhuma execução registrada. O monitoramento passa a valer na próxima carga.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                  <th className="py-2 pr-4 font-medium">Início</th>
                  <th className="py-2 pr-4 font-medium">Situação</th>
                  <th className="py-2 pr-4 font-medium">Origem</th>
                  <th className="py-2 pr-4 text-right font-medium">Duração</th>
                  <th className="py-2 pr-4 text-right font-medium">Mensais</th>
                  <th className="py-2 text-right font-medium">Diárias</th>
                </tr>
              </thead>
              <tbody>
                {d.historico.map((e) => (
                  <tr key={e.id} className="border-b border-veri-offwhite/60 last:border-0">
                    <td className="veri-numero py-2 pr-4">
                      {formatDataHora(e.iniciadaEm, tz)}
                    </td>
                    <td className="py-2 pr-4">
                      {e.status === "success"
                        ? "sucesso"
                        : e.status === "failed"
                          ? "falha"
                          : "em execução"}
                    </td>
                    <td className="py-2 pr-4 text-texto-suave">{ORIGEM[e.origem]}</td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {formatDuracao(e.duracaoSegundos)}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {e.linhasMensais === null ? "—" : formatInteiro(e.linhasMensais)}
                    </td>
                    <td className="veri-numero py-2 text-right">
                      {e.linhasDiarias === null ? "—" : formatInteiro(e.linhasDiarias)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
