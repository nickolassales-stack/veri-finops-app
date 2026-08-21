"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Botao } from "@/components/ui/botao";
import { Campo, Selecao } from "@/components/ui/campo";
import { ErroDoBloco } from "@/components/ui/estado";
import { escrever, mensagemDoErro } from "@/lib/admin/cliente";
import {
  DESCRICAO_STATUS,
  ROTULO_STATUS,
  STATUS_SELECIONAVEIS,
  type StatusPagamento,
} from "@/lib/billing/pagamento";

/**
 * Edicao de UMA conta: o ciclo da fatura e a situacao de pagamento.
 *
 * SAO DOIS FORMULARIOS SEPARADOS, com dois endpoints e dois botoes. Poderiam
 * ser um so, e nao sao de proposito: um unico "salvar" que dispara dois PATCH
 * pode gravar o primeiro e falhar no segundo, deixando a tela dizendo "salvo"
 * sobre metade da verdade. Separados, cada botao responde por exatamente o que
 * acabou de escrever.
 *
 * A parte de cliente do faturamento e SO isto. O resto da tela e renderizado no
 * servidor, e `router.refresh()` traz os dados novos ja recalculados -- inclusive
 * os cards e os avisos, que dependem dos campos que acabaram de mudar.
 */

export type ContaEditavel = {
  accountId: string;
  nomeExibicao: string;
  invoiceCloseDay: number | null;
  invoiceDueDay: number | null;
  invoiceNotificationDaysBefore: number;
  billingContactEmail: string | null;
  paymentStatus: StatusPagamento | null;
  paymentReference: string | null;
  paymentDueDate: string | null;
  paymentPaidDate: string | null;
  paymentNotes: string | null;
};

export function EditorConta({ conta }: { conta: ContaEditavel }) {
  return (
    <div className="grid gap-6 border-t border-veri-offwhite pt-5 lg:grid-cols-2">
      <FormularioCiclo conta={conta} />
      <FormularioPagamento conta={conta} />
    </div>
  );
}

// ------------------------------------------------------------------- ciclo

function FormularioCiclo({ conta }: { conta: ContaEditavel }) {
  const router = useRouter();
  const [fechamento, setFechamento] = useState(txt(conta.invoiceCloseDay));
  const [vencimento, setVencimento] = useState(txt(conta.invoiceDueDay));
  const [aviso, setAviso] = useState(String(conta.invoiceNotificationDaysBefore));
  const [contato, setContato] = useState(conta.billingContactEmail ?? "");

  const { salvando, erro, sucesso, enviar } = useEnvio();

  return (
    <form
      className="space-y-4"
      onSubmit={enviar(
        `/api/billing/settings?conta=${encodeURIComponent(conta.accountId)}`,
        () => ({
          // Campo numerico vazio vira null, e nao 0: "nao informado" e diferente
          // de "dia zero", que nem existe no calendario.
          invoiceCloseDay: fechamento.trim() === "" ? null : Number(fechamento),
          invoiceDueDay: vencimento.trim() === "" ? null : Number(vencimento),
          invoiceNotificationDaysBefore: aviso.trim() === "" ? 5 : Number(aviso),
          billingContactEmail: contato.trim() || null,
        }),
        router,
      )}
    >
      <h3 className="text-sm font-semibold text-veri-verde-escuro">Ciclo da fatura</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Dia de fechamento"
          type="number"
          min={1}
          max={31}
          value={fechamento}
          onChange={(e) => setFechamento(e.target.value)}
          ajuda="Entre 1 e 31. Em meses curtos, o dia 31 vale como o último dia do mês."
        />
        <Campo
          rotulo="Dia de vencimento"
          type="number"
          min={1}
          max={31}
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
          ajuda="Se for menor que o de fechamento, entende-se como o mês seguinte."
        />
        <Campo
          rotulo="Avisar com antecedência de"
          type="number"
          min={0}
          max={30}
          value={aviso}
          onChange={(e) => setAviso(e.target.value)}
          ajuda="Dias. 0 avisa apenas no dia do fechamento."
        />
        <Campo
          rotulo="Contato de cobrança"
          type="email"
          value={contato}
          onChange={(e) => setContato(e.target.value)}
          maxLength={320}
          ajuda="Guardado e exibido. O portal não envia e-mail — não há provedor configurado."
        />
      </div>

      <Resultado erro={erro} sucesso={sucesso} mensagem="Ciclo da fatura salvo." />
      <Botao type="submit" carregando={salvando}>
        Salvar ciclo
      </Botao>
    </form>
  );
}

// --------------------------------------------------------------- pagamento

function FormularioPagamento({ conta }: { conta: ContaEditavel }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(conta.paymentStatus ?? "");
  const [referencia, setReferencia] = useState(conta.paymentReference ?? "");
  const [vencimento, setVencimento] = useState(conta.paymentDueDate ?? "");
  const [pagoEm, setPagoEm] = useState(conta.paymentPaidDate ?? "");
  const [observacoes, setObservacoes] = useState(conta.paymentNotes ?? "");

  const { salvando, erro, sucesso, enviar } = useEnvio();

  // A mesma regra do esquema Zod e do CHECK do banco, adiantada para a tela:
  // marcar "Pago" sem data e afirmar pagamento sem saber quando. Aqui ela serve
  // para o botao explicar antes, em vez de o servidor recusar depois.
  const faltaData = status === "paid" && pagoEm.trim() === "";

  return (
    <form
      className="space-y-4"
      onSubmit={enviar(
        `/api/billing/status?conta=${encodeURIComponent(conta.accountId)}`,
        () => ({
          paymentStatus: status === "" ? null : status,
          paymentReference: referencia.trim() || null,
          paymentDueDate: vencimento.trim() || null,
          paymentPaidAt: pagoEm.trim() || null,
          paymentNotes: observacoes.trim() || null,
        }),
        router,
      )}
    >
      <h3 className="text-sm font-semibold text-veri-verde-escuro">
        Situação de pagamento
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <Selecao
          rotulo="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          ajuda={
            status && status !== ""
              ? DESCRICAO_STATUS[status as StatusPagamento]
              : "Sem registro. É o estado inicial de toda conta."
          }
        >
          <option value="">— limpar registro —</option>
          {STATUS_SELECIONAVEIS.map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS[s]}
            </option>
          ))}
        </Selecao>

        <Campo
          rotulo="Data do pagamento"
          type="date"
          value={pagoEm}
          onChange={(e) => setPagoEm(e.target.value)}
          erro={faltaData ? 'Obrigatória para marcar como "Pago".' : undefined}
          ajuda="Quando o pagamento ocorreu — não é a data em que você está registrando."
        />

        <Campo
          rotulo="Referência"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          maxLength={120}
          ajuda="Número da fatura, protocolo ou id da transação."
        />

        <Campo
          rotulo="Vencimento desta fatura"
          type="date"
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
          ajuda="Só quando fugir da regra mensal (prorrogação, feriado, acordo)."
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`obs-${conta.accountId}`}
          className="block text-sm font-medium text-veri-verde-escuro"
        >
          Observações
        </label>
        <textarea
          id={`obs-${conta.accountId}`}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          maxLength={2000}
          rows={2}
          className="w-full rounded-lg border border-veri-offwhite bg-veri-branco px-3 py-2 text-sm text-veri-verde-escuro outline-none focus-visible:ring-2 focus-visible:ring-veri-verde/50"
        />
        <p className="text-xs text-texto-suave">
          Seu e-mail é anexado à observação ao salvar — o registro é manual e precisa
          de autor.
        </p>
      </div>

      <Resultado
        erro={erro}
        sucesso={sucesso}
        mensagem="Situação registrada como manual, com seu e-mail."
      />
      <Botao type="submit" carregando={salvando} disabled={faltaData}>
        Registrar situação
      </Botao>
    </form>
  );
}

// ------------------------------------------------------------------ apoio

function txt(valor: number | null): string {
  return valor === null ? "" : String(valor);
}

function useEnvio() {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const enviar =
    (url: string, corpo: () => unknown, router: ReturnType<typeof useRouter>) =>
    async (evento: React.FormEvent) => {
      evento.preventDefault();
      setSalvando(true);
      setErro(null);
      setSucesso(false);
      try {
        await escrever(url, "PATCH", corpo());
        setSucesso(true);
        // Recarrega o que o SERVIDOR calcula: cards, avisos e as frases de
        // "fecha em X dias" dependem do que acabou de mudar, e atualizar so a
        // linha editada deixaria o resto da tela discordando dela.
        router.refresh();
      } catch (e) {
        setErro(mensagemDoErro(e));
      } finally {
        setSalvando(false);
      }
    };

  return { salvando, erro, sucesso, enviar };
}

function Resultado({
  erro,
  sucesso,
  mensagem,
}: {
  erro: string | null;
  sucesso: boolean;
  mensagem: string;
}) {
  if (erro) return <ErroDoBloco titulo="Não foi possível salvar" mensagem={erro} />;
  if (sucesso) {
    return (
      <p role="status" className="text-sm font-medium text-veri-verde-escuro">
        {mensagem}
      </p>
    );
  }
  return null;
}
