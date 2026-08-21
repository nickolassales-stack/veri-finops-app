"use client";

import { useCallback, useEffect, useState } from "react";

import { Aviso } from "@/components/ui/aviso";
import { Botao } from "@/components/ui/botao";
import { Campo } from "@/components/ui/campo";
import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { SeloProvider } from "@/components/ui/selo-provider";
import { escrever, ler, mensagemDoErro } from "@/lib/admin/cliente";
import {
  BlocoCredenciaisOvh,
  type CredencialVisivel,
} from "@/components/admin/bloco-credenciais-ovh";
// De `@/lib/billing/pagamento`, que e puro -- e NAO de `esquemas-admin`, que
// puxa `password.mjs` e com ele o `node:crypto` para dentro do navegador.
import { ROTULO_STATUS } from "@/lib/billing/pagamento";

type Conta = {
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
  /** Somente leitura aqui -- ver o comentario do tipo em queries/admin/contas.ts. */
  provider: string;
  /**
   * `null` em tres situacoes que a tela distingue com ajuda de `provider` e de
   * `podeVerCredenciais`: conta AWS (nao se aplica), conta OVH sem cadastro, e
   * usuario nao-ADMIN (o servidor nao envia o campo).
   */
  credencial: CredencialVisivel | null;
};

type MetaContas = {
  podeVerCredenciais?: boolean;
  ultimaSincronizacaoOvh?: string | null;
  contasOvh?: number;
};

/**
 * O banco garante a lista pelo CHECK, mas a API tipa `paymentStatus` como
 * string: se o CHECK mudar sem a tela saber, exibir o valor cru e melhor do que
 * quebrar a renderizacao inteira por uma chave que faltou no mapa.
 */
function rotuloPagamento(valor: string): string {
  return (ROTULO_STATUS as Record<string, string>)[valor] ?? valor;
}

export function PainelContas() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [meta, setMeta] = useState<MetaContas>({});
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  /**
   * Carga dentro do proprio efeito, como em `use-analitico.ts`.
   *
   * A funcao assincrona e definida AQUI e nao extraida para um `useCallback`:
   * chamar de fora uma funcao que faz setState conta como setState sincrono no
   * corpo do efeito, o que provoca render em cascata. Recarregar e um contador.
   *
   * `vivo` descarta a resposta de um efeito ja desmontado -- sem isso, sair da
   * tela durante a carga tentaria atualizar componente que nao existe mais.
   */
  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const { dados, meta: recebido } = await ler<Conta[], MetaContas>(
          "/api/admin/accounts",
        );
        if (!vivo) return;
        setErro(null);
        setContas(dados);
        setMeta(recebido ?? {});
      } catch (e) {
        if (!vivo) return;
        setErro(mensagemDoErro(e));
        setContas([]);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [gatilho]);

  /** Troca a conta no lugar, sem recarregar a lista inteira. */
  const substituir = (atualizada: Conta) => {
    setContas((atual) =>
      (atual ?? []).map((c) => (c.accountId === atualizada.accountId ? atualizada : c)),
    );
    setEditando(null);
  };

  /**
   * Atualiza SO a credencial de uma conta.
   *
   * Separado de `substituir` porque o bloco de credenciais nao fecha o modo de
   * edicao: depois de salvar a credencial o operador quase sempre clica em
   * "Testar conexao" em seguida, e fechar o painel o obrigaria a reabrir.
   */
  const substituirCredencial = (accountId: string, nova: CredencialVisivel | null) => {
    setContas((atual) =>
      (atual ?? []).map((c) => (c.accountId === accountId ? { ...c, credencial: nova } : c)),
    );
  };

  if (erro && !contas?.length) {
    return <ErroDoBloco mensagem={erro} aoTentarNovamente={recarregar} />;
  }
  if (contas === null) return <CarregandoLinhas linhas={3} />;
  if (contas.length === 0) {
    return (
      <Vazio titulo="Nenhuma conta cloud no cadastro">
        As contas vêm de <span className="veri-numero">cloud_accounts</span>. Enquanto não
        houver nenhuma lá, não há o que configurar aqui.
      </Vazio>
    );
  }

  return (
    <div className="space-y-5">
      <Aviso tom="info" titulo="O alias vale em todo o portal">
        <p>
          O nome definido aqui substitui o do cadastro nos filtros, nos cards, na tabela
          analítica e nos arquivos exportados. O <strong>ID da conta</strong> continua
          sempre visível ao lado — é ele que identifica a conta no provedor.
        </p>
        <p>
          Esta lista traz <strong>todos os provedores</strong>. O selo ao lado de cada
          conta diz qual é. Contas OVH aparecem aqui e em Faturamento, mas não nos
          filtros do painel executivo nem do analítico, que hoje leem apenas dados AWS.
          O provedor em si não é editável: trocá-lo desligaria a conta da sua origem de
          dado.
        </p>
        <p>
          Contas <strong>OVH</strong> têm, além disso, um bloco de{" "}
          <strong>credenciais de API</strong>, restrito a administradores. Contas{" "}
          <strong>AWS</strong> não têm esse bloco e não é omissão: a AWS autentica por
          IAM role da instância, sem segredo para guardar no portal.
        </p>
      </Aviso>

      {contas.map((conta) => (
        <Card
          key={conta.accountId}
          titulo={conta.nomeExibicao}
          descricao={`ID ${conta.accountId}${conta.ativa ? "" : " · inativa no cadastro"}`}
          acao={
            <div className="flex items-center gap-2">
              <SeloProvider provider={conta.provider} />
              <Botao
                tom="secundario"
                onClick={() =>
                  setEditando((atual) => (atual === conta.accountId ? null : conta.accountId))
                }
                aria-expanded={editando === conta.accountId}
              >
                {editando === conta.accountId ? "Fechar" : "Editar"}
              </Botao>
            </div>
          }
        >
          {editando === conta.accountId ? (
            <FormularioConta conta={conta} aoSalvar={substituir} />
          ) : (
            <ResumoConta conta={conta} />
          )}

          {/*
            So conta OVH, e so para ADMIN. As duas condicoes sao independentes: a
            primeira e sobre o que o bloco significa (a AWS nao tem credencial a
            guardar), a segunda e sobre quem pode ve-lo.

            `podeVerCredenciais` vem do SERVIDOR e nao de uma inferencia local.
            Sem ele, "nao ha credencial cadastrada" e "voce nao pode ver as
            credenciais" seriam indistinguiveis para a tela -- e ela mostraria o
            formulario vazio a um nao-ADMIN, cujo envio voltaria 403.
          */}
          {conta.provider === "ovh" && meta.podeVerCredenciais && (
            <BlocoCredenciaisOvh
              accountId={conta.accountId}
              credencial={conta.credencial}
              ultimaSincronizacao={meta.ultimaSincronizacaoOvh ?? null}
              aoMudar={(nova) => substituirCredencial(conta.accountId, nova)}
            />
          )}

          {conta.provider === "ovh" && !meta.podeVerCredenciais && (
            <p className="mt-4 border-t border-veri-offwhite pt-3 text-xs text-texto-suave">
              Esta conta tem credenciais de API. Somente administradores podem
              consultá-las ou alterá-las.
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}

function ResumoConta({ conta }: { conta: Conta }) {
  const itens: { rotulo: string; valor: string }[] = [
    { rotulo: "Provedor", valor: conta.provider.toUpperCase() },
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
      valor: conta.paymentStatus
        ? `${rotuloPagamento(conta.paymentStatus)}${
            conta.paymentStatusUpdatedAt
              ? ` · desde ${new Date(conta.paymentStatusUpdatedAt).toLocaleDateString("pt-BR")}`
              : ""
          }`
        : "—",
    },
  ];

  return (
    <>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {itens.map((i) => (
          <div key={i.rotulo}>
            <dt className="text-xs uppercase tracking-wide text-texto-suave">{i.rotulo}</dt>
            <dd className="mt-0.5 text-sm text-veri-verde-escuro">{i.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Os dois ultimos aparecem aqui e sao editados em Faturamento. Deixar o
          campo editavel nas duas telas significaria que `settings:accounts`
          altera dado de faturamento sem ter `billing:manage`. */}
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

function FormularioConta({
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
  const [sucesso, setSucesso] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    setSucesso(false);

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
      setSucesso(true);
      aoSalvar(atualizada);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
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
      {sucesso && !erro && (
        <p role="status" className="text-sm font-medium text-veri-verde-escuro">
          Alterações salvas. O novo nome já vale nos filtros e nas exportações.
        </p>
      )}

      <Botao type="submit" carregando={salvando}>
        Salvar alterações
      </Botao>
    </form>
  );
}
