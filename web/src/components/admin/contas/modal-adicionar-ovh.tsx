"use client";

import { useState } from "react";

import { Botao } from "@/components/ui/botao";
import { Campo, Selecao } from "@/components/ui/campo";
import { ErroDoBloco } from "@/components/ui/estado";
import { Modal } from "@/components/ui/modal";
import { escrever, mensagemDoErro } from "@/lib/admin/cliente";
import { ENDPOINTS_OVH, ROTULO_ENDPOINT, type EndpointOvh } from "@/lib/ovh/endpoints";

import { BlocoPermissoesOvh } from "./permissoes-ovh";

/**
 * "Adicionar conta OVH" — aqui SIM é um formulário.
 *
 * ---------------------------------------------------------------------------
 * O OPOSTO DO CASO AWS
 *
 * A conta OVH não é descoberta: ela existe porque alguém a cadastrou. O
 * `account_id` é uma etiqueta que nós escolhemos (`ovh-cliente-ca`) e que amarra
 * credencial, fila de coleta e custo — ela precisa existir ANTES da primeira
 * coleta, porque é ela que o collector procura.
 *
 * ---------------------------------------------------------------------------
 * TRÊS BOTÕES, TRÊS INTENÇÕES DIFERENTES
 *
 * "Testar conexão" não grava nada — bate um GET /me na OVH e volta. Ele existe
 * ANTES de salvar de propósito: descobrir que a chave está errada depois de
 * gravar deixaria uma credencial inválida no banco e um cadastro que ninguém
 * quis. Ele usa uma rota sem `accountId`, porque a conta ainda não existe.
 *
 * "Salvar" grava conta e credencial. "Salvar e executar primeira coleta" faz o
 * mesmo e ainda enfileira o job — o caso comum de quem acabou de receber as
 * chaves e quer ver o custo hoje.
 *
 * ---------------------------------------------------------------------------
 * NENHUM SEGREDO VOLTA
 *
 * A resposta traz a credencial em forma visível: status, endpoint e as chaves
 * MASCARADAS. O Application Secret não volta nem mascarado — não há máscara útil
 * de um segredo que ninguém precisa reler.
 */

const VAZIO = {
  accountId: "",
  alias: "",
  businessUnit: "",
  costCenter: "",
  environment: "",
  endpoint: "ovh-ca" as string,
  applicationKey: "",
  applicationSecret: "",
  consumerKey: "",
};

type Resposta = {
  conta: { accountId: string };
  coleta: { jobId: string; criado: boolean } | null;
  coletaIndisponivel: string | null;
  workerParado: boolean;
  avisoContasDuplicadas: string[];
};

export function ModalAdicionarOvh({
  aberto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** Recarrega a lista. A conta nova precisa aparecer sem F5. */
  aoCriar: () => void;
}) {
  const [f, setF] = useState(VAZIO);
  const [enviando, setEnviando] = useState<null | "salvar" | "coletar" | "testar">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [testeOk, setTesteOk] = useState<string | null>(null);

  const campo = (k: keyof typeof VAZIO) => (v: string) =>
    setF((atual) => ({ ...atual, [k]: v }));

  function limpar() {
    setF(VAZIO);
    setErro(null);
    setAviso(null);
    setTesteOk(null);
  }

  function fechar() {
    limpar();
    aoFechar();
  }

  /** Só o que foi preenchido vai no corpo — `.strict()` recusa string vazia onde espera ausência. */
  function corpo(coletarAgora: boolean) {
    const opcional = (v: string) => (v.trim() === "" ? undefined : v.trim());
    return {
      accountId: f.accountId.trim(),
      alias: f.alias.trim(),
      businessUnit: opcional(f.businessUnit),
      costCenter: opcional(f.costCenter),
      environment: opcional(f.environment),
      endpoint: f.endpoint,
      applicationKey: opcional(f.applicationKey),
      applicationSecret: opcional(f.applicationSecret),
      consumerKey: opcional(f.consumerKey),
      coletarAgora,
    };
  }

  async function testar() {
    setEnviando("testar");
    setErro(null);
    setTesteOk(null);
    try {
      const r = await escrever<{ ok: boolean; mensagem: string }>(
        "/api/admin/ovh/test-credentials",
        "POST",
        {
          endpoint: f.endpoint,
          applicationKey: f.applicationKey.trim() || undefined,
          applicationSecret: f.applicationSecret.trim() || undefined,
          consumerKey: f.consumerKey.trim() || undefined,
        },
      );
      // `ok: false` é resposta 200 com veredito negativo — a chamada à OVH
      // funcionou, a credencial é que não serve. Tratar como erro de rede
      // mandaria investigar a conexão em vez de conferir a chave.
      if (r.ok) setTesteOk(r.mensagem);
      else setErro(r.mensagem);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setEnviando(null);
    }
  }

  async function salvar(coletarAgora: boolean) {
    setEnviando(coletarAgora ? "coletar" : "salvar");
    setErro(null);
    setAviso(null);
    try {
      const r = await escrever<Resposta>(
        "/api/admin/accounts",
        "POST",
        corpo(coletarAgora),
      );

      // A conta FOI criada mesmo quando a coleta não pôde ser enfileirada.
      // Fechar sem dizer isso deixaria alguém esperando um dado que não vem.
      if (r.coletaIndisponivel) {
        setAviso(
          `Conta criada, mas a coleta não foi enfileirada: ${r.coletaIndisponivel}`,
        );
        aoCriar();
        return;
      }
      // Enfileirou E há job parado na fila: o worker não está consumindo. É o
      // pior caso de todos para fechar em silêncio, porque tudo respondeu com
      // sucesso — a coleta simplesmente nunca vai acontecer.
      if (r.workerParado) {
        setAviso(
          "Coleta enfileirada, mas o worker não está ativo. " +
            "Instale o worker para processar automaticamente.",
        );
        aoCriar();
        return;
      }
      if (r.avisoContasDuplicadas.length > 0) {
        setAviso(
          `Conta criada. Atenção: a mesma Application Key já é usada por ${r.avisoContasDuplicadas.join(", ")}.`,
        );
        aoCriar();
        return;
      }

      aoCriar();
      fechar();
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setEnviando(null);
    }
  }

  const ocupado = enviando !== null;
  const temTresChaves =
    f.applicationKey.trim() !== "" &&
    f.applicationSecret.trim() !== "" &&
    f.consumerKey.trim() !== "";
  const podeSalvar = f.accountId.trim() !== "" && f.alias.trim() !== "";

  return (
    <Modal
      aberto={aberto}
      aoFechar={fechar}
      largura="larga"
      titulo="Adicionar conta OVH"
      descricao="A conta é cadastrada aqui. As chaves de API ficam cifradas no banco e nunca voltam para a tela."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void salvar(false);
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Provider Account ID"
            value={f.accountId}
            onChange={(e) => campo("accountId")(e.target.value)}
            maxLength={20}
            required
            placeholder="ovh-cliente-ca"
            ajuda="Etiqueta escolhida por você. É ela que amarra credencial, coleta e custo — e não muda depois."
          />
          <Campo
            rotulo="Alias"
            value={f.alias}
            onChange={(e) => campo("alias")(e.target.value)}
            maxLength={120}
            required
            ajuda="Nome exibido em todo o portal."
          />
          <Campo
            rotulo="Unidade de negócio"
            value={f.businessUnit}
            onChange={(e) => campo("businessUnit")(e.target.value)}
            maxLength={120}
          />
          <Campo
            rotulo="Centro de custo"
            value={f.costCenter}
            onChange={(e) => campo("costCenter")(e.target.value)}
            maxLength={120}
          />
          <Campo
            rotulo="Ambiente"
            value={f.environment}
            onChange={(e) => campo("environment")(e.target.value)}
            maxLength={60}
            placeholder="prod, homologacao, dev…"
          />
          <Selecao
            rotulo="Endpoint"
            value={f.endpoint}
            onChange={(e) => campo("endpoint")(e.target.value)}
            ajuda="A região da API OVH em que as chaves foram geradas."
          >
            {/* O rótulo traz a região JUNTO do código: `ovh-ca` sozinho não diz
                a quem cadastra que aquilo é Canadá, e escolher a região errada
                devolve 404 em /me — sintoma que se confunde com chave inválida. */}
            {ENDPOINTS_OVH.map((e) => (
              <option key={e} value={e}>
                {ROTULO_ENDPOINT[e]}
              </option>
            ))}
          </Selecao>
        </div>

        {/* ANTES dos campos de chave, e não depois: a ordem de quem cadastra é
            ler os direitos, abrir o console da OVH, criar o token e só então
            voltar para colar. Embaixo do formulário, o bloco seria lido por
            quem já gerou o token errado. */}
        <BlocoPermissoesOvh endpoint={f.endpoint as EndpointOvh} />

        <fieldset className="space-y-4 rounded-xl border border-veri-offwhite p-4">
          <legend className="px-1 text-sm font-semibold text-veri-verde-escuro">
            Credenciais de API
          </legend>
          <p className="text-xs leading-relaxed text-texto-suave">
            Opcionais no cadastro. Deixe em branco para criar a conta agora e colar as
            chaves depois — ela aparece na lista como{" "}
            <strong>Credenciais não configuradas</strong>. Se preencher, informe as três.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo="Application Key"
              value={f.applicationKey}
              onChange={(e) => campo("applicationKey")(e.target.value)}
              maxLength={512}
              autoComplete="off"
            />
            <Campo
              rotulo="Consumer Key"
              value={f.consumerKey}
              onChange={(e) => campo("consumerKey")(e.target.value)}
              maxLength={512}
              autoComplete="off"
            />
          </div>

          <Campo
            rotulo="Application Secret"
            // `password` e não `text`: é o único dos três que nunca é exibido de
            // volta, nem mascarado. Deixá-lo em claro na tela contradiria isso
            // no único momento em que ele passa por aqui.
            type="password"
            value={f.applicationSecret}
            onChange={(e) => campo("applicationSecret")(e.target.value)}
            maxLength={512}
            autoComplete="new-password"
            ajuda="Nunca é exibido depois de salvo — nem mascarado."
          />
        </fieldset>

        {erro && <ErroDoBloco titulo="Não foi possível concluir" mensagem={erro} />}

        {testeOk && (
          <p role="status" className="text-sm font-medium text-veri-verde-escuro">
            {testeOk} A credencial ainda <strong>não</strong> foi salva — clique em Salvar.
          </p>
        )}

        {aviso && (
          <p role="status" className="text-sm font-medium text-veri-vinho">
            {aviso}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-veri-offwhite pt-4">
          <Botao type="submit" carregando={enviando === "salvar"} disabled={ocupado || !podeSalvar}>
            Salvar
          </Botao>
          <Botao
            type="button"
            tom="secundario"
            carregando={enviando === "coletar"}
            disabled={ocupado || !podeSalvar || !temTresChaves}
            onClick={() => void salvar(true)}
          >
            Salvar e executar primeira coleta
          </Botao>
          <Botao
            type="button"
            tom="secundario"
            carregando={enviando === "testar"}
            disabled={ocupado || !temTresChaves}
            onClick={() => void testar()}
          >
            Testar conexão
          </Botao>
        </div>

        {!temTresChaves && (
          <p className="text-xs text-texto-suave">
            Testar conexão e a primeira coleta exigem as três chaves preenchidas.
          </p>
        )}
      </form>
    </Modal>
  );
}
