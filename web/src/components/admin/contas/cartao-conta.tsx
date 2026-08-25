"use client";

import { useState } from "react";

import { BlocoCredenciaisOvh, type CredencialVisivel } from "@/components/admin/bloco-credenciais-ovh";
import { Botao } from "@/components/ui/botao";
import { Campo } from "@/components/ui/campo";
import { Card } from "@/components/ui/card";
import { ErroDoBloco } from "@/components/ui/estado";
import { SeloProvider } from "@/components/ui/selo-provider";
import { escrever, mensagemDoErro } from "@/lib/admin/cliente";
import {
  ROTULO_CREDENCIAL,
  mensagemCredencial,
  statusDaCredencial,
  type Provider,
} from "@/lib/admin/contas-provider";
// De `@/lib/billing/pagamento`, que e puro -- e NAO de `esquemas-admin`, que
// puxa `password.mjs` e com ele o `node:crypto` para dentro do navegador.
import { ROTULO_STATUS } from "@/lib/billing/pagamento";

export type Conta = {
  accountId: string;
  nomeExibicao: string;
  alias: string | null;
  accountName: string;
  businessUnit: string | null;
  costCenter: string | null;
  environment: string | null;
  invoiceCloseDay: number | null;
  paymentStatus: string | null;
  paymentStatusUpdatedAt: string | null;
  ativa: boolean;
  configurada: boolean;
  provider: string;
  credencial: CredencialVisivel | null;
};

function rotuloPagamento(valor: string): string {
  return (ROTULO_STATUS as Record<string, string>)[valor] ?? valor;
}

function dataCurta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

/**
 * Um cartão de conta — com CAMPOS E AÇÕES DIFERENTES por provedor.
 *
 * ---------------------------------------------------------------------------
 * A DIFERENÇA NÃO É COSMÉTICA
 *
 * O cartão AWS não tem bloco de credencial, e não porque ele foi escondido: a
 * AWS autentica por IAM role da instância e não há segredo para guardar. O
 * cartão OVH tem endpoint, status da credencial, última validação e última
 * coleta — quatro campos que não existem do outro lado.
 *
 * Um cartão único com metade dos campos vazios faria os dois parecerem o mesmo
 * objeto mal preenchido, que foi exatamente o efeito da lista misturada.
 */
export function CartaoConta({
  conta,
  provider,
  podeVerCredenciais,
  ultimaSincronizacao,
  aoAtualizar,
}: {
  conta: Conta;
  provider: Provider;
  podeVerCredenciais: boolean;
  ultimaSincronizacao: string | null;
  aoAtualizar: (c: Conta) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [mostrarCredenciais, setMostrarCredenciais] = useState(false);

  const status = statusDaCredencial(conta.credencial);
  const alerta = mensagemCredencial(status);

  return (
    <Card
      titulo={conta.nomeExibicao}
      descricao={`ID ${conta.accountId}${conta.ativa ? "" : " · inativa no cadastro"}`}
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SeloProvider provider={conta.provider} />
          {provider === "ovh" && podeVerCredenciais && (
            <SeloCredencial status={status} />
          )}
          <Botao
            tom="secundario"
            onClick={() => setEditando((v) => !v)}
            aria-expanded={editando}
          >
            {editando ? "Fechar" : "Editar"}
          </Botao>
          {provider === "ovh" && podeVerCredenciais && (
            <Botao
              tom="secundario"
              onClick={() => setMostrarCredenciais((v) => !v)}
              aria-expanded={mostrarCredenciais}
            >
              Credenciais
            </Botao>
          )}
        </div>
      }
    >
      {editando ? (
        <FormularioMetadados
          conta={conta}
          aoSalvar={(c) => {
            aoAtualizar(c);
            setEditando(false);
          }}
        />
      ) : provider === "ovh" ? (
        <ResumoOvh conta={conta} podeVerCredenciais={podeVerCredenciais} alerta={alerta} />
      ) : (
        <ResumoAws conta={conta} />
      )}

      {/*
        So conta OVH, e so para ADMIN. As duas condicoes sao independentes: a
        primeira e sobre o que o bloco significa (a AWS nao tem credencial a
        guardar), a segunda e sobre quem pode ve-lo.

        `podeVerCredenciais` vem do SERVIDOR e nao de uma inferencia local. Sem
        ele, "nao ha credencial cadastrada" e "voce nao pode ver as credenciais"
        seriam indistinguiveis para a tela -- e ela mostraria o formulario vazio
        a um nao-ADMIN, cujo envio voltaria 403.
      */}
      {provider === "ovh" && podeVerCredenciais && mostrarCredenciais && (
        <BlocoCredenciaisOvh
          accountId={conta.accountId}
          credencial={conta.credencial}
          ultimaSincronizacao={ultimaSincronizacao}
          aoMudar={(nova) => aoAtualizar({ ...conta, credencial: nova })}
        />
      )}

      {provider === "ovh" && !podeVerCredenciais && (
        <p className="mt-4 border-t border-veri-offwhite pt-3 text-xs text-texto-suave">
          Esta conta tem credenciais de API. Somente administradores podem consultá-las
          ou alterá-las.
        </p>
      )}
    </Card>
  );
}

function SeloCredencial({ status }: { status: ReturnType<typeof statusDaCredencial> }) {
  const cor =
    status === "conectado"
      ? "border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro"
      : status === "invalido"
        ? "border-veri-vinho/40 bg-veri-vinho/10 text-veri-vinho"
        : "border-veri-offwhite bg-veri-offwhite text-texto-suave";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cor}`}
    >
      {ROTULO_CREDENCIAL[status]}
    </span>
  );
}

function Grade({ itens }: { itens: { rotulo: string; valor: string }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {itens.map((i) => (
        <div key={i.rotulo} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-texto-suave">{i.rotulo}</dt>
          <dd className="mt-0.5 break-words text-sm text-veri-verde-escuro">{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResumoAws({ conta }: { conta: Conta }) {
  return (
    <>
      <Grade
        itens={[
          { rotulo: "ID da conta", valor: conta.accountId },
          {
            rotulo: "Alias",
            valor: conta.alias ?? `— (usando "${conta.accountName}" do cadastro)`,
          },
          { rotulo: "Unidade de negócio", valor: conta.businessUnit ?? "—" },
          { rotulo: "Centro de custo", valor: conta.costCenter ?? "—" },
          { rotulo: "Ambiente", valor: conta.environment ?? "—" },
          {
            rotulo: "Fechamento da fatura",
            valor: conta.invoiceCloseDay ? `dia ${conta.invoiceCloseDay}` : "—",
          },
          {
            rotulo: "Pagamento",
            valor: conta.paymentStatus ? rotuloPagamento(conta.paymentStatus) : "—",
          },
        ]}
      />
      <p className="mt-4 text-xs text-texto-suave">
        Fechamento e situação de pagamento são editados em{" "}
        <a href="/dashboard/billing" className="underline">
          Faturamento
        </a>
        , com a permissão <span className="veri-numero">billing:manage</span>.
      </p>
    </>
  );
}

function ResumoOvh({
  conta,
  podeVerCredenciais,
  alerta,
}: {
  conta: Conta;
  podeVerCredenciais: boolean;
  alerta: string | null;
}) {
  const itens = [
    { rotulo: "Provider Account ID", valor: conta.accountId },
    {
      rotulo: "Alias",
      valor: conta.alias ?? `— (usando "${conta.accountName}" do cadastro)`,
    },
    { rotulo: "Unidade de negócio", valor: conta.businessUnit ?? "—" },
    { rotulo: "Centro de custo", valor: conta.costCenter ?? "—" },
    { rotulo: "Ambiente", valor: conta.environment ?? "—" },
  ];

  // Endpoint e datas de credencial só existem para quem recebe o bloco
  // `credencial` do servidor — para um VIEWER o campo chega `null`, e inventar
  // um travessão sugeriria que não há credencial quando pode haver.
  if (podeVerCredenciais) {
    itens.push(
      { rotulo: "Endpoint", valor: conta.credencial?.endpoint ?? "—" },
      {
        rotulo: "Última validação",
        valor: dataCurta(conta.credencial?.ultimaValidacao ?? null),
      },
    );
  }

  return (
    <>
      <Grade itens={itens} />
      {alerta && podeVerCredenciais && (
        <p className="mt-4 rounded-lg border border-veri-mostarda/50 bg-veri-amarelo/15 px-3 py-2 text-xs text-veri-verde-escuro">
          {alerta}
        </p>
      )}
    </>
  );
}

function FormularioMetadados({
  conta,
  aoSalvar,
}: {
  conta: Conta;
  aoSalvar: (c: Conta) => void;
}) {
  const [alias, setAlias] = useState(conta.alias ?? "");
  const [unidade, setUnidade] = useState(conta.businessUnit ?? "");
  const [centro, setCentro] = useState(conta.costCenter ?? "");
  const [ambiente, setAmbiente] = useState(conta.environment ?? "");

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);

    try {
      const atualizada = await escrever<Conta>(
        `/api/admin/accounts/${encodeURIComponent(conta.accountId)}`,
        "PATCH",
        {
          alias: alias.trim() || null,
          businessUnit: unidade.trim() || null,
          costCenter: centro.trim() || null,
          environment: ambiente.trim() || null,
        },
      );
      // A resposta do PATCH não traz `credencial` — ela é de outra rota. Sem
      // preservar a atual, salvar o alias de uma conta OVH apagaria o status da
      // credencial da tela até o próximo F5.
      aoSalvar({ ...atualizada, credencial: conta.credencial });
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      {/* NENHUM campo de credencial aqui, nem para OVH: editar metadados e
          trocar chave de API são operações com exigências diferentes
          (`settings:accounts` contra papel ADMIN). Juntá-las num formulário só
          faria o botão "Salvar" significar duas coisas. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          maxLength={120}
          placeholder={conta.accountName}
          ajuda={
            <>
              Deixe em branco para voltar a usar{" "}
              <span className="veri-numero">{conta.accountName}</span>, o nome do cadastro.
            </>
          }
        />
        <Campo
          rotulo="Unidade de negócio"
          value={unidade}
          onChange={(e) => setUnidade(e.target.value)}
          maxLength={120}
        />
        <Campo
          rotulo="Centro de custo"
          value={centro}
          onChange={(e) => setCentro(e.target.value)}
          maxLength={120}
        />
        <Campo
          rotulo="Ambiente"
          value={ambiente}
          onChange={(e) => setAmbiente(e.target.value)}
          maxLength={60}
          placeholder="prod, homologacao, dev…"
        />
      </div>

      {erro && <ErroDoBloco titulo="Não foi possível salvar" mensagem={erro} />}

      <Botao type="submit" carregando={salvando}>
        Salvar alterações
      </Botao>
    </form>
  );
}
