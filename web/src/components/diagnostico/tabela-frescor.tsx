import { Card } from "@/components/ui/card";
import { mesesFaltando, type FrescorConta } from "@/lib/diagnostico/etl";
import { formatDataDia, formatDataHora, formatInteiro } from "@/lib/format";

/**
 * Ultima data de custo por conta.
 *
 * ALIAS E account_id JUNTOS, sempre. Nas telas de custo o account_id e ruido; em
 * diagnostico ele e o dado operacional -- e o que se digita no console da AWS,
 * no Athena e no `add_partition.sql`. Mostrar so o apelido obrigaria a abrir a
 * tela de configuracoes no meio de uma investigacao.
 *
 * As duas datas tambem aparecem juntas, pelo mesmo motivo que separam as duas
 * abas do analitico: `usage_date` responde "ate quando ha consumo registrado" e
 * `billing_month` responde "ate que fatura o dado chega". Uma conta pode estar
 * em dia numa e atrasada na outra, e e exatamente essa divergencia que interessa
 * a quem veio conferir a carga.
 */

export function TabelaFrescor({
  contas,
  tz,
  diasSemAtualizacao,
}: {
  contas: FrescorConta[];
  tz: string;
  diasSemAtualizacao: number;
}) {
  return (
    <Card
      titulo="Última data de custo por conta"
      descricao={
        `${contas.length} conta(s) com dado. "Linha mais nova" é quando entrou no ` +
        `PostgreSQL o lançamento mais recente desta conta; "uso" e "cobrança" são as ` +
        `datas do próprio custo.`
      }
    >
      {contas.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Nenhuma conta com dado de custo neste banco.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">account_id</th>
                <th className="py-2 pr-4 font-medium">Último uso</th>
                <th className="py-2 pr-4 font-medium">Último mês de cobrança</th>
                <th className="py-2 pr-4 text-right font-medium">Meses</th>
                <th className="py-2 pr-4 text-right font-medium">Linhas</th>
                <th className="py-2 font-medium">Linha mais nova</th>
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => {
                const faltando = mesesFaltando(c);
                return (
                  <tr
                    key={c.accountId}
                    className="border-b border-veri-offwhite/60 last:border-0 align-top"
                  >
                    <td className="py-2 pr-4 font-medium">
                      {c.nomeExibicao}
                      {faltando.length > 0 && (
                        <span className="mt-0.5 block text-xs font-normal text-veri-vinho">
                          sem carga em {faltando.join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-texto-suave">{c.accountId}</td>
                    <td className="veri-numero py-2 pr-4">
                      {formatDataDia(c.ultimaUsageDate)}
                    </td>
                    <td className="veri-numero py-2 pr-4">
                      {c.ultimoBillingMonth ? c.ultimoBillingMonth.slice(0, 7) : "—"}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {formatInteiro(c.mesesDisponiveis)}
                    </td>
                    <td className="veri-numero py-2 pr-4 text-right">
                      {formatInteiro(c.totalLinhas)}
                      <span className="block text-xs text-texto-suave">
                        {formatInteiro(c.linhasDiarias)} diárias ·{" "}
                        {formatInteiro(c.linhasMensais)} mensais
                      </span>
                    </td>
                    <td className="veri-numero py-2">
                      {c.linhaMaisNovaEm ? formatDataHora(c.linhaMaisNovaEm, tz) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-texto-suave">
        Uma conta é apontada como parada depois de {diasSemAtualizacao} dias sem dado
        novo. O CUR da AWS atrasa cerca de um dia por natureza, então um dia de
        diferença é normal.
      </p>
    </Card>
  );
}
