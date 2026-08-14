import { EditorConta } from "@/components/billing/editor-conta";
import { SeloPagamento } from "@/components/billing/selo-pagamento";
import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";
import { podeAtual, requirePermissao } from "@/lib/auth/autorizacao";
import { getEnv } from "@/lib/env";
import { formatDataDia, formatDataHora, formatInteiro } from "@/lib/format";
import { montarFaturamento } from "@/lib/services/billing";

/**
 * Faturamento: quando cada fatura fecha, quando vence, e o que se sabe sobre o
 * pagamento.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTA TELA NAO FAZ, E POR QUE ISSO E A PARTE IMPORTANTE
 *
 * Ela nao descobre se a fatura foi paga. Nao existe, em nenhuma tabela deste
 * banco, informacao que autorize essa afirmacao: o CUR/Data Export responde o
 * que foi CONSUMIDO, jamais o que foi QUITADO. Toda situacao aqui foi digitada
 * por uma pessoa, e a tela mostra QUEM afirmou ao lado do QUE foi afirmado.
 *
 * As datas de fechamento e vencimento, essas sim, sao calculadas -- mas de uma
 * regra que alguem configurou, nao de dado da AWS.
 * ---------------------------------------------------------------------------
 *
 * A pagina consulta o banco DIRETO, sem passar pelas proprias rotas: o servidor
 * ja tem a conexao em maos. As rotas e a tela chamam `montarFaturamento()`, que
 * e uma so -- sem isso a tela poderia dizer "fecha em 3 dias" enquanto a API
 * dissesse "fecha hoje".
 */

export const metadata = { title: "Faturamento" };

/** Fatura tem prazo; cache faria a tela contar dias a partir de ontem. */
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  await requirePermissao("billing:view", "/dashboard/billing");

  const podeGerenciar = await podeAtual("billing:manage");
  const tz = getEnv().APP_TZ;
  const f = await montarFaturamento();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Faturamento</h1>
        <p className="mt-2 max-w-3xl text-sm text-texto-suave">
          Fechamento e vencimento por conta AWS, e a situação de pagamento registrada.
          Datas calculadas em {tz} · hoje é {formatDataDia(f.hoje)}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardResumo
          rotulo="Próximas do fechamento"
          valor={f.resumo.proximasDoFechamento}
          detalhe="Dentro da antecedência configurada, ou fechando hoje"
        />
        <CardResumo
          rotulo="Pagamentos pendentes"
          valor={f.resumo.pagamentosPendentes}
          detalhe="Fatura fechada, sem confirmação de pagamento"
          tom={f.resumo.pagamentosPendentes > 0 ? "atencao" : undefined}
        />
        <CardResumo
          rotulo="Pagamentos vencidos"
          valor={f.resumo.pagamentosVencidos}
          detalhe="Passou do vencimento sem confirmação"
          tom={f.resumo.pagamentosVencidos > 0 ? "critico" : undefined}
        />
        <CardResumo
          rotulo="Sem configuração"
          valor={f.resumo.semConfiguracao}
          detalhe="Contas sem dia de fechamento — nenhum aviso é possível"
        />
      </div>

      <section className="space-y-3">
        <h2 className="veri-display text-lg text-veri-verde-escuro">Avisos</h2>
        {f.avisos.length === 0 ? (
          <Aviso tom="info" titulo="Nenhum aviso">
            <p>
              Nenhuma fatura próxima do fechamento e nenhum pagamento pendente entre as
              contas configuradas. As verificações foram feitas agora, nesta requisição.
            </p>
          </Aviso>
        ) : (
          f.avisos.map((a) => (
            <Aviso
              key={a.chave}
              tom={a.tom === "critico" ? "critico" : a.tom === "atencao" ? "atencao" : "info"}
              titulo={a.titulo}
            >
              <p>{a.detalhe}</p>
            </Aviso>
          ))
        )}

        {/* Os canais aparecem SEMPRE, inclusive os indisponiveis. Uma area
            chamada "Avisos" que nao diz que nao envia e-mail deixa quem a lê
            supondo que alguém foi notificado. */}
        <p className="text-xs text-texto-suave">
          Entrega dos avisos:{" "}
          {f.canais.map((c, i) => (
            <span key={c.chave}>
              {i > 0 && " · "}
              <span className={c.disponivel ? "font-medium" : ""}>{c.rotulo}</span>{" "}
              {c.disponivel ? "(ativo)" : `(indisponível — ${c.motivo})`}
            </span>
          ))}
        </p>
      </section>

      <Card
        titulo="Contas"
        descricao={
          podeGerenciar
            ? "Editar exige billing:manage. A situação registrada é sempre manual."
            : "Somente leitura. Alterar fechamento ou situação de pagamento exige billing:manage."
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-sm">
            <thead>
              <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
                <th className="py-2 pr-4 font-medium">Conta</th>
                <th className="py-2 pr-4 font-medium">account_id</th>
                <th className="py-2 pr-4 font-medium">Período</th>
                <th className="py-2 pr-4 font-medium">Fechamento</th>
                <th className="py-2 pr-4 font-medium">Vencimento</th>
                <th className="py-2 pr-4 font-medium">Situação</th>
                <th className="py-2 font-medium">Observações</th>
              </tr>
            </thead>
            <tbody>
              {f.linhas.map((l) => (
                <tr
                  key={l.accountId}
                  className="border-b border-veri-offwhite/60 align-top last:border-0"
                >
                  <td className="py-3 pr-4 font-medium">
                    {l.nomeExibicao}
                    {!l.ativa && (
                      <span className="block text-xs font-normal text-texto-suave">
                        inativa no cadastro
                      </span>
                    )}
                  </td>
                  <td className="veri-numero py-3 pr-4 text-texto-suave">{l.accountId}</td>
                  <td className="veri-numero py-3 pr-4">{l.competencia ?? "—"}</td>
                  <td className="py-3 pr-4">
                    {l.ciclo.situacao === "sem_configuracao" ? (
                      <span className="text-texto-suave">Sem dia configurado</span>
                    ) : (
                      <>
                        <span className="veri-numero block">
                          dia {l.invoiceCloseDay}
                        </span>
                        <span className="block text-xs text-texto-suave">
                          {l.ciclo.descricao}
                        </span>
                        {l.descricaoDaFechada && (
                          <span className="block text-xs text-texto-suave">
                            {l.descricaoDaFechada}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {l.vencimentoEfetivo ? (
                      <>
                        <span className="veri-numero block">
                          {formatDataDia(l.vencimentoEfetivo)}
                        </span>
                        {l.diasDeAtraso !== null && (
                          <span className="block text-xs font-medium text-veri-vinho">
                            {l.diasDeAtraso} dia(s) de atraso
                          </span>
                        )}
                        {l.paymentDueDate && (
                          <span className="block text-xs text-texto-suave">
                            data registrada à mão
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-texto-suave">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <SeloPagamento status={l.paymentStatus} fonte={l.paymentStatusSource} />
                    {l.paymentPaidDate && (
                      <span className="block text-xs text-texto-suave">
                        pago em {formatDataDia(l.paymentPaidDate)}
                      </span>
                    )}
                    {l.paymentStatusUpdatedAt && (
                      <span className="block text-xs text-texto-suave">
                        registrado em {formatDataHora(l.paymentStatusUpdatedAt, tz)}
                      </span>
                    )}
                    {l.paymentReference && (
                      <span className="veri-numero block text-xs text-texto-suave">
                        ref. {l.paymentReference}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-xs text-texto-suave">
                    {l.paymentNotes ? (
                      <span className="whitespace-pre-line">{l.paymentNotes}</span>
                    ) : (
                      "—"
                    )}
                    {l.billingContactEmail && (
                      <span className="veri-numero mt-1 block">{l.billingContactEmail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {podeGerenciar &&
        f.linhas.map((l) => (
          <Card
            key={l.accountId}
            titulo={l.nomeExibicao}
            descricao={`ID ${l.accountId}`}
          >
            <EditorConta
              conta={{
                accountId: l.accountId,
                nomeExibicao: l.nomeExibicao,
                invoiceCloseDay: l.invoiceCloseDay,
                invoiceDueDay: l.invoiceDueDay,
                invoiceNotificationDaysBefore: l.invoiceNotificationDaysBefore,
                billingContactEmail: l.billingContactEmail,
                paymentStatus: l.paymentStatus,
                paymentReference: l.paymentReference,
                paymentDueDate: l.paymentDueDate,
                paymentPaidDate: l.paymentPaidDate,
                paymentNotes: l.paymentNotes,
              }}
            />
          </Card>
        ))}

      <Card
        titulo="Por que o pagamento é registrado à mão"
        descricao="Integração com a AWS: investigada, documentada e desligada."
      >
        <ul className="space-y-2 text-sm">
          {f.integracaoAws.limitacoes.map((l) => (
            <li key={l} className="flex gap-2">
              <span aria-hidden className="text-texto-suave">
                —
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-texto-suave">
          <span className="veri-numero">
            AWS_INVOICING_ENABLED={String(f.integracaoAws.habilitada)}
          </span>
          . Investigação completa, com as permissões IAM e o roteiro de validação, em{" "}
          <span className="veri-numero">docs/AWS-INVOICING.md</span>.
        </p>
      </Card>
    </div>
  );
}

function CardResumo({
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  rotulo: string;
  valor: number;
  detalhe: string;
  tom?: "atencao" | "critico";
}) {
  const borda =
    tom === "critico"
      ? "border-veri-vinho/40"
      : tom === "atencao"
        ? "border-veri-mostarda/50"
        : "border-veri-offwhite";

  const cor =
    tom === "critico"
      ? "text-veri-vinho"
      : "text-veri-verde-escuro";

  return (
    <div className={`rounded-2xl border bg-veri-branco p-5 ${borda}`}>
      <p className="text-xs uppercase tracking-wide text-texto-suave">{rotulo}</p>
      <p className={`veri-numero mt-1 text-3xl ${cor}`}>{formatInteiro(valor)}</p>
      <p className="mt-1 text-xs leading-relaxed text-texto-suave">{detalhe}</p>
    </div>
  );
}
