import { SeloProvider } from "@/components/ui/selo-provider";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { formatDataDia, formatDataHora, formatInteiro, formatMoeda } from "@/lib/format";
import {
  DESCRICAO_FONTE_OVH,
  ROTULO_FONTE_OVH,
  type VisaoOvh,
} from "@/lib/services/ovh";
import { FONTES_OVH } from "@/lib/filtros/esquemas";

/**
 * Bloco OVHcloud da tela de Faturamento.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE BLOCO SE RECUSA A FAZER
 *
 * Nao soma as tres origens. `invoice`, `usage_current` e `usage_forecast` sao
 * tres respostas para tres perguntas diferentes, e o mesmo projeto no mesmo mes
 * tem linha nas tres. Um total unico aqui triplicaria o custo com aparencia de
 * numero consolidado -- por isso sao tres cards e nunca um.
 *
 * Nao soma com AWS. O total executivo continua sendo AWS. A OVH e mensal e
 * faturada; a AWS e diaria e por uso. O aviso no rodape diz isso ao usuario, em
 * vez de deixar que ele conclua sozinho que o painel ja inclui a OVH.
 *
 * Nao converte moeda. Cada card e cada linha exibem o codigo da moeda como esta
 * no banco.
 * ---------------------------------------------------------------------------
 */
export function SecaoOvh({ ovh, tz }: { ovh: VisaoOvh; tz: string }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="veri-display text-2xl text-veri-verde-escuro">OVHcloud</h2>
        <SeloProvider provider="ovh" />
      </div>

      {ovh.alertas.map((a) => (
        <Aviso key={a.chave} tom={a.tom} titulo={a.titulo}>
          <p>{a.detalhe}</p>
        </Aviso>
      ))}

      {!ovh.instalado ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FONTES_OVH.map((fonte) => (
              <CardOrigem key={fonte} ovh={ovh} fonte={fonte} />
            ))}
            <CardSincronizacao ovh={ovh} tz={tz} />
          </div>

          <TabelaMensal ovh={ovh} />

          {ovh.faturas.length > 0 && (
            <Card
              titulo="Faturas coletadas"
              descricao="Cabeçalhos de fatura da API da OVH, agrupados por moeda."
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                      <th className="py-2 pr-4 font-medium">Moeda</th>
                      <th className="py-2 pr-4 font-medium">Faturas</th>
                      <th className="py-2 pr-4 font-medium">Linhas</th>
                      <th className="py-2 pr-4 font-medium">Período</th>
                      <th className="py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ovh.faturas.map((f) => (
                      <tr key={f.currency} className="border-b border-veri-offwhite/60 last:border-0">
                        <td className="veri-numero py-3 pr-4">{f.currency}</td>
                        <td className="veri-numero py-3 pr-4">{formatInteiro(f.faturas)}</td>
                        <td className="veri-numero py-3 pr-4">{formatInteiro(f.linhas)}</td>
                        <td className="veri-numero py-3 pr-4 text-texto-suave">
                          {f.primeiroMes ? formatDataDia(f.primeiroMes) : "—"} —{" "}
                          {f.ultimoMes ? formatDataDia(f.ultimoMes) : "—"}
                        </td>
                        <td className="veri-numero py-3 font-medium">
                          {formatMoeda(f.total, f.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Aparece SEMPRE, inclusive quando ha dado -- especialmente quando ha.
          Quem ve numero de OVH numa tela do portal precisa saber que ele nao
          entrou no total executivo. */}
      <Aviso tom="info" titulo="OVH não é somada ao custo diário AWS">
        <p>
          OVH possui dados mensais/faturados nesta fase. Não está sendo somado ao custo
          diário AWS. As duas nuvens têm granularidade diferente — a AWS é diária e por
          uso, a OVH é mensal e faturada — e a moeda de referência para um total
          multi-cloud ainda é uma decisão de negócio em aberto.
        </p>
      </Aviso>
    </section>
  );
}

/**
 * Um card por origem. Origem sem dado mostra "sem dado", nao zero: "0,00" seria
 * uma afirmacao sobre o custo, e a afirmacao correta e "nao foi coletado".
 */
function CardOrigem({
  ovh,
  fonte,
}: {
  ovh: VisaoOvh;
  fonte: (typeof FONTES_OVH)[number];
}) {
  const entradas = ovh.totaisPorOrigem.filter((t) => t.source === fonte);

  return (
    <div className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5">
      <p className="text-xs uppercase tracking-wide text-texto-suave">
        {ROTULO_FONTE_OVH[fonte]}
      </p>

      {entradas.length === 0 ? (
        <p className="veri-numero mt-1 text-2xl text-texto-suave">sem dado</p>
      ) : (
        // Uma linha por moeda. Duas moedas na mesma origem nao viram um numero.
        entradas.map((e) => (
          <p key={e.currency} className="veri-numero mt-1 text-2xl text-veri-verde-escuro">
            {formatMoeda(e.total, e.currency)}
          </p>
        ))
      )}

      <p className="mt-1 text-xs leading-relaxed text-texto-suave">
        {DESCRICAO_FONTE_OVH[fonte]}
        {entradas.length > 0 && entradas[0].mesMaisRecente && (
          <>
            {" · até "}
            {formatDataDia(entradas[0].mesMaisRecente)}
          </>
        )}
      </p>
    </div>
  );
}

function CardSincronizacao({ ovh, tz }: { ovh: VisaoOvh; tz: string }) {
  const referencia = ovh.ultimoSucesso ?? ovh.ultima;

  return (
    <div className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5">
      <p className="text-xs uppercase tracking-wide text-texto-suave">
        Última sincronização
      </p>
      <p className="veri-numero mt-1 text-lg text-veri-verde-escuro">
        {referencia
          ? formatDataHora(referencia.finishedAt ?? referencia.startedAt, tz)
          : "nunca"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-texto-suave">
        {referencia
          ? `${referencia.status} · origem ${referencia.source} · ` +
            `${formatInteiro(referencia.costRows)} linha(s) de custo`
          : "Nenhuma execução registrada em ovh_sync_runs."}
      </p>
    </div>
  );
}

function TabelaMensal({ ovh }: { ovh: VisaoOvh }) {
  if (ovh.mensal.length === 0) {
    return (
      <Card
        titulo="Custo mensal por projeto"
        descricao="Uma linha por mês, projeto e origem. As origens não são somadas."
      >
        <p className="py-6 text-center text-sm text-texto-suave">
          Nenhuma linha em <span className="veri-numero">ovh_monthly_costs</span>. Quando
          o collector importar dados, eles aparecem aqui — inclusive o histórico.
        </p>
      </Card>
    );
  }

  return (
    <Card
      titulo="Custo mensal por projeto"
      descricao={`Uma linha por mês, projeto e origem. ${formatInteiro(
        ovh.mensal.length,
      )} linha(s). As origens não são somadas entre si.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
              <th className="py-2 pr-4 font-medium">Mês</th>
              <th className="py-2 pr-4 font-medium">Conta</th>
              <th className="py-2 pr-4 font-medium">Projeto</th>
              <th className="py-2 pr-4 font-medium">Origem</th>
              <th className="py-2 pr-4 font-medium">Moeda</th>
              <th className="py-2 font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {ovh.mensal.map((l) => (
              <tr
                key={`${l.billingMonth}-${l.providerAccountId}-${l.projectServiceName}-${l.source}-${l.currency}`}
                className="border-b border-veri-offwhite/60 last:border-0"
              >
                <td className="veri-numero py-3 pr-4">{formatDataDia(l.billingMonth)}</td>
                <td className="py-3 pr-4">
                  {l.alias ?? (
                    <span className="text-texto-suave">sem cadastro</span>
                  )}
                  <span className="veri-numero block text-xs text-texto-suave">
                    {l.providerAccountId}
                  </span>
                </td>
                <td className="veri-numero py-3 pr-4 text-texto-suave">
                  {l.projectServiceName || "—"}
                </td>
                <td className="py-3 pr-4">{ROTULO_FONTE_OVH[l.source]}</td>
                <td className="veri-numero py-3 pr-4">{l.currency}</td>
                <td className="veri-numero py-3">{formatMoeda(l.amount, l.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
