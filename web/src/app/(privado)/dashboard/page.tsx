import { SerieDiariaChart } from "@/components/charts/serie-diaria-chart";
import { SerieMensalChart } from "@/components/charts/serie-mensal-chart";
import { TopServicosChart } from "@/components/charts/top-servicos-chart";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { Kpi, Variacao } from "@/components/ui/kpi";
import { getEnv } from "@/lib/env";
import { formatDataHora, formatInteiro, formatUSD } from "@/lib/format";
import {
  getCustoPorConta,
  getFrescor,
  getKpis,
  getRollup,
  getSerieDiaria,
  getSerieMensal,
  getTopServicos,
  getTopServicosHistorico,
} from "@/lib/queries/custos";

export const metadata = { title: "Visao executiva" };

const MESES_LONGOS = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function mesPorExtenso(iso: string): string {
  const [ano, mes] = iso.split("-");
  return `${MESES_LONGOS[Number(mes) - 1]} de ${ano}`;
}

export default async function VisaoExecutiva() {
  // Fuso de exibicao. Fica dentro do try porque getEnv() lanca quando a
  // configuracao esta incompleta -- nesse caso queremos o aviso na tela, nao
  // uma pagina de erro 500.
  let tz = "America/Sao_Paulo";

  let dados;
  try {
    tz = getEnv().APP_TZ;
    const [kpis, contas, serieMensal, serieDiaria, frescor, rollup] = await Promise.all([
      getKpis(tz),
      getCustoPorConta(tz),
      getSerieMensal(tz),
      getSerieDiaria(tz, 30),
      getFrescor(),
      getRollup(tz, "business_unit"),
    ]);
    // Se o mes de referencia nao tem carga, o ranking do mes viria vazio --
    // nesse caso mostramos o historico, deixando claro na descricao do card.
    const servicosMes = await getTopServicos(tz, 10);
    const servicos =
      servicosMes.length > 0 ? servicosMes : await getTopServicosHistorico(10);
    dados = {
      kpis,
      contas,
      serieMensal,
      serieDiaria,
      frescor,
      rollup,
      servicos,
      servicosDoMes: servicosMes.length > 0,
    };
  } catch (err) {
    return (
      <div className="space-y-6">
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Visao executiva</h1>
        <Aviso tom="critico" titulo="Nao foi possivel ler o PostgreSQL FinOps">
          <p className="veri-numero break-words">
            {err instanceof Error ? err.message : String(err)}
          </p>
          <p>
            Nenhum numero e exibido sem dado real. Verifique <code>/api/health</code> e
            o <code>/diagnostico</code>.
          </p>
        </Aviso>
      </div>
    );
  }

  const { kpis, contas, serieMensal, serieDiaria, frescor, rollup, servicos } = dados;
  const contasSemDadoNoMes = contas.filter((c) => !c.temDadoNoMes);
  const contasNaoCadastradas = contas.filter((c) => !c.cadastrada);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Visao executiva</h1>
        <p className="mt-2 text-sm text-veri-verde-escuro/70">
          Mes de referencia: <strong>{mesPorExtenso(kpis.mesReferencia)}</strong> · valores
          em USD, conforme origem do CUR · ultima carga do ETL em{" "}
          <span className="veri-numero">
            {formatDataHora(frescor.ultimaCargaMensal, tz)}
          </span>
        </p>
      </div>

      {/* ---------------- avisos de integridade, antes dos numeros ---------------- */}
      {contasSemDadoNoMes.length > 0 && (
        <Aviso
          tom="atencao"
          titulo={`${contasSemDadoNoMes.length} de ${contas.length} conta(s) sem nenhum dado em ${mesPorExtenso(kpis.mesReferencia)}`}
        >
          <p>
            {contasSemDadoNoMes.map((c) => `${c.nome} (${c.accountId})`).join(", ")} — nao
            e custo zero, e ausencia de carga. A causa tipica e a particao
            <code> billing_period</code> do mes nao ter sido criada no Athena, o que
            impede o ETL de ler o periodo.
          </p>
          <p>
            Enquanto isso, os totais do mes e a comparacao mensal ficam incompletos.
          </p>
        </Aviso>
      )}

      {kpis.lancadoNoFuturo > 0 && (
        <Aviso tom="info" titulo="Ha custo lancado em periodo futuro">
          <p>
            <span className="veri-numero">{formatUSD(kpis.lancadoNoFuturo)}</span> em meses
            posteriores ao mes de referencia — tipico de cobranca anual lancada
            adiantado. Esse valor entra no total historico, mas nunca no custo do mes.
          </p>
        </Aviso>
      )}

      {contasNaoCadastradas.length > 0 && (
        <Aviso tom="atencao" titulo="Conta com custo fora do cadastro">
          <p>
            {contasNaoCadastradas.map((c) => c.accountId).join(", ")} tem custo mas nao
            esta em <code>cloud_accounts</code>, logo nao aparece nos cortes por unidade
            e centro de custo.
          </p>
        </Aviso>
      )}

      {/* ------------------------------- KPIs ------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          destaque
          rotulo={`Custo em ${mesPorExtenso(kpis.mesReferencia)}`}
          valor={formatUSD(kpis.mesAtual)}
          apoio={
            <>
              {formatInteiro(kpis.contasComDadoMesAtual)} de{" "}
              {formatInteiro(kpis.contasAtivas)} conta(s) ativa(s) com dado
            </>
          }
        />
        <Kpi
          rotulo="Mes anterior"
          valor={formatUSD(kpis.mesAnterior)}
          apoio={
            <Variacao fracao={kpis.variacao} comparavel={kpis.variacaoComparavel} />
          }
        />
        <Kpi
          rotulo="Total historico"
          valor={formatUSD(kpis.totalHistorico)}
          apoio={<>{formatInteiro(kpis.mesesComDado)} mes(es) com dado carregado</>}
        />
        <Kpi
          rotulo="Contas ativas"
          valor={formatInteiro(kpis.contasAtivas)}
          apoio={<>cadastradas em cloud_accounts</>}
        />
      </div>

      {/* --------------------------- serie mensal --------------------------- */}
      <Card
        titulo="Custo por mes"
        descricao="Soma de aws_monthly_costs por mes de competencia."
      >
        {serieMensal.length === 0 ? (
          <p className="text-sm text-veri-verde-escuro/70">Nenhum mes carregado.</p>
        ) : (
          <>
            <SerieMensalChart dados={serieMensal} />
            {/* Visao de tabela: exigida porque o verde de preenchimento fica
                abaixo de 3:1 de contraste contra a superficie. */}
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-veri-verde-escuro/70 underline underline-offset-2">
                Ver como tabela
              </summary>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                    <th className="py-2 pr-4 font-medium">Mes</th>
                    <th className="py-2 pr-4 text-right font-medium">Custo</th>
                    <th className="py-2 font-medium">Observacao</th>
                  </tr>
                </thead>
                <tbody>
                  {serieMensal.map((p) => (
                    <tr key={p.mes} className="border-b border-veri-offwhite/60 last:border-0">
                      <td className="py-2 pr-4">{mesPorExtenso(p.mes)}</td>
                      <td className="veri-numero py-2 pr-4 text-right">
                        {formatUSD(p.total)}
                      </td>
                      <td className="py-2 text-veri-verde-escuro/70">
                        {p.futuro ? "lancado adiantado" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Card>

      {/* --------------------------- serie diaria --------------------------- */}
      <Card
        titulo="Evolucao diaria"
        descricao="Ultimos 30 dias ate hoje. A janela e ancorada na data corrente, nao no maior usage_date -- ha registros com data futura."
      >
        {serieDiaria.length === 0 ? (
          <p className="text-sm text-veri-verde-escuro/70">
            Nenhum dia com dado nos ultimos 30 dias.
          </p>
        ) : (
          <SerieDiariaChart dados={serieDiaria} />
        )}
      </Card>

      {/* -------------------------- top servicos --------------------------- */}
      <Card
        titulo="Maiores servicos"
        descricao={
          dados.servicosDoMes
            ? `Top 10 em ${mesPorExtenso(kpis.mesReferencia)}.`
            : "O mes de referencia nao tem carga; exibindo o historico completo."
        }
      >
        {servicos.length === 0 ? (
          <p className="text-sm text-veri-verde-escuro/70">Nenhum servico com custo.</p>
        ) : (
          <TopServicosChart dados={servicos} />
        )}
      </Card>

      {/* -------------------------- custo por conta ------------------------- */}
      <Card
        titulo="Custo por conta"
        descricao="Comparacao entre o mes de referencia, o mes anterior e o acumulado."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">Unidade</th>
                <th className="py-2 pr-4 font-medium">Centro de custo</th>
                <th className="py-2 pr-4 text-right font-medium">Mes atual</th>
                <th className="py-2 pr-4 text-right font-medium">Mes anterior</th>
                <th className="py-2 text-right font-medium">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => (
                <tr
                  key={c.accountId}
                  className="border-b border-veri-offwhite/60 last:border-0"
                >
                  <td className="py-2 pr-4">
                    <span className="font-medium">{c.nome}</span>
                    <span className="veri-numero block text-xs text-veri-verde-escuro/60">
                      {c.accountId}
                      {!c.cadastrada && " · fora do cadastro"}
                      {c.cadastrada && !c.ativa && " · inativa"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-veri-verde-escuro/70">
                    {c.unidade ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-veri-verde-escuro/70">
                    {c.centroCusto ?? "—"}
                  </td>
                  <td className="veri-numero py-2 pr-4 text-right">
                    {c.temDadoNoMes ? (
                      formatUSD(c.mesAtual)
                    ) : (
                      <span className="text-veri-verde-escuro/50">sem dado</span>
                    )}
                  </td>
                  <td className="veri-numero py-2 pr-4 text-right">
                    {formatUSD(c.mesAnterior)}
                  </td>
                  <td className="veri-numero py-2 text-right font-medium">
                    {formatUSD(c.totalHistorico)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ------------------------------ rollup ----------------------------- */}
      <Card
        titulo="Por unidade de negocio"
        descricao="Classificacao vem de cloud_accounts. Contas sem classificacao aparecem agrupadas."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-veri-verde-escuro/60">
                <th className="py-2 pr-4 font-medium">Unidade</th>
                <th className="py-2 pr-4 text-right font-medium">Contas</th>
                <th className="py-2 pr-4 text-right font-medium">Mes atual</th>
                <th className="py-2 text-right font-medium">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {rollup.map((l) => (
                <tr key={l.valor} className="border-b border-veri-offwhite/60 last:border-0">
                  <td className="py-2 pr-4">{l.valor}</td>
                  <td className="veri-numero py-2 pr-4 text-right">
                    {formatInteiro(l.contas)}
                  </td>
                  <td className="veri-numero py-2 pr-4 text-right">
                    {formatUSD(l.mesAtual)}
                  </td>
                  <td className="veri-numero py-2 text-right font-medium">
                    {formatUSD(l.totalHistorico)}
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
