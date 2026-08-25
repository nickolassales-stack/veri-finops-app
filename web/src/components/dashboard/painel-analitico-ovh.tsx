"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import {
  DESCRICAO_FONTE,
  ROTULO_FONTE,
  detalheDeAusencia,
  mensagemDeAusencia,
  semDado,
  type EstadoDadoOvh,
} from "@/lib/dashboard/ovh";
import {
  escreverFiltrosOvh,
  lerFiltrosOvh,
  validarIntervaloOvh,
  type FiltrosOvh,
} from "@/lib/dashboard/filtros-ovh";
import type { ContaOvhDisponivel, MetaOvh } from "@/lib/dashboard/tipos-ovh";
import { useRecursoOvh } from "@/lib/dashboard/use-recurso-ovh";
import { formatDataDia, formatInteiro, formatMoeda } from "@/lib/format";

import { FiltrosOvhBarra } from "./filtros-ovh";

/**
 * Analítico da visão OVH — as quatro abas.
 *
 * ---------------------------------------------------------------------------
 * UM COMPONENTE, QUATRO ABAS
 *
 * As quatro compartilham filtro, estado de carregamento, tratamento de ausência
 * e a barra de filtros. Só a tabela muda. Quatro componentes completos
 * duplicariam quatro vezes a decisão de "quando dizer sem dado" — e é exatamente
 * essa decisão que não pode divergir entre abas: a mesma janela mostrando
 * "sem dado" numa aba e "US$ 0,00" na outra faria o operador confiar na errada.
 *
 * ---------------------------------------------------------------------------
 * O QUE NUNCA ACONTECE AQUI
 *
 * Somar origens. `invoice`, `usage_current` e `usage_forecast` respondem
 * perguntas diferentes — realizado, corrente e previsão — e o filtro aceita
 * **uma** por vez. Não há opção "todas as origens", e isso é o desenho: um total
 * que some faturado com previsão não significa nada, e pareceria maior.
 *
 * Somar moedas. `ovh_monthly_costs.currency` é por linha; o servidor escolhe uma
 * e informa qual. As outras aparecem com o próprio valor, nunca somadas.
 */

export type AbaOvh = "servicos" | "projetos" | "faturas" | "mensal";

const CAMINHO: Record<AbaOvh, string> = {
  servicos: "/api/dashboard/ovh/services",
  projetos: "/api/dashboard/ovh/projects",
  faturas: "/api/dashboard/ovh/invoices",
  mensal: "/api/dashboard/ovh/monthly",
};

const TITULO: Record<AbaOvh, { titulo: string; descricao: string }> = {
  servicos: {
    titulo: "Por serviço/categoria",
    descricao: "O que a OVH cobrou, agrupado por linha de serviço no mês.",
  },
  projetos: {
    titulo: "Por projeto",
    descricao:
      "Custo atribuído a projeto do Public Cloud. Servidor dedicado e licença " +
      "não pertencem a projeto — aparecem como “sem projeto”.",
  },
  faturas: {
    titulo: "Por fatura",
    descricao: "Documentos emitidos pela OVH, com imposto e total.",
  },
  mensal: {
    titulo: "Por custo mensal",
    descricao: "Total por mês de competência, conta e origem.",
  },
};

type LinhaServico = {
  servico: string;
  categoria?: string | null;
  total: number;
  linhas: number;
  participacao?: number;
};
type LinhaProjeto = {
  servicoDoProjeto: string;
  nome: string;
  semProjeto: boolean;
  total: number;
  linhas: number;
};
type LinhaFatura = {
  billId: string;
  conta: string;
  categoria: string | null;
  billDate: string | null;
  billingMonth: string | null;
  totalComImposto: number;
  totalSemImposto: number;
  imposto: number;
  moeda: string;
  linhas: number;
};
type LinhaMensal = {
  mes: string;
  total: number;
  linhas: number;
};

export function PainelAnaliticoOvh({ aba }: { aba: AbaOvh }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtros = useMemo(
    () => lerFiltrosOvh(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const problema = validarIntervaloOvh(filtros);

  const aplicar = useCallback(
    (mudanca: Partial<FiltrosOvh>) => {
      const params = escreverFiltrosOvh({ ...filtros, ...mudanca });
      // `scroll: false` — trocar um filtro não é navegar para outro conteúdo, e
      // pular para o topo faria perder a linha que estava sendo lida.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [filtros, pathname, router],
  );

  const limpar = useCallback(() => {
    router.replace(`${pathname}?provider=ovh`, { scroll: false });
  }, [pathname, router]);

  const r = useRecursoOvh<unknown>(CAMINHO[aba], filtros);
  const meta = r.meta as (MetaOvh & Record<string, unknown>) | null;
  const estado = (meta?.estado ?? "ok") as EstadoDadoOvh;

  const contas = (meta?.contasDisponiveis ?? []) as ContaOvhDisponivel[];
  const projetos = (meta?.projetosDisponiveis ?? []) as {
    servicoDoProjeto: string;
    nome: string;
  }[];
  const fontesComDado = (meta?.fontesComDado ?? []) as FiltrosOvh["source"][];
  const moeda = (meta?.moeda ?? "USD") as string;

  const t = TITULO[aba];

  return (
    <div className="space-y-5">
      <FiltrosOvhBarra
        filtros={filtros}
        problema={problema}
        contas={contas}
        projetos={projetos}
        fontesComDado={fontesComDado}
        carregando={r.carregando}
        aoMudar={aplicar}
        aoLimpar={limpar}
      />

      <Card
        titulo={t.titulo}
        descricao={t.descricao}
        acao={
          <span className="text-xs text-texto-suave">
            Origem: <strong>{ROTULO_FONTE[filtros.source]}</strong> —{" "}
            {DESCRICAO_FONTE[filtros.source]}
          </span>
        }
      >
        <Conteudo
          aba={aba}
          carregando={r.carregando}
          erro={r.erro}
          estado={estado}
          fonte={filtros.source}
          moeda={moeda}
          dados={r.dados}
          recarregar={r.recarregar}
        />
      </Card>
    </div>
  );
}

function Conteudo({
  aba,
  carregando,
  erro,
  estado,
  fonte,
  moeda,
  dados,
  recarregar,
}: {
  aba: AbaOvh;
  carregando: boolean;
  erro: unknown;
  estado: EstadoDadoOvh;
  fonte: FiltrosOvh["source"];
  moeda: string;
  dados: unknown;
  recarregar: () => void;
}) {
  if (carregando) return <CarregandoLinhas linhas={8} />;

  if (erro) {
    return (
      <ErroDoBloco
        titulo="Não foi possível carregar os custos OVH"
        mensagem={
          erro instanceof Error ? erro.message : "Erro desconhecido ao consultar o servidor."
        }
        aoTentarNovamente={recarregar}
      />
    );
  }

  // AUSÊNCIA ANTES DE TABELA VAZIA. `semDado` distingue quatro situações —
  // sem integração, banco vazio, origem sem linha, janela sem linha — e cada uma
  // pede uma ação diferente do outro lado. Uma tabela vazia com "US$ 0,00" no
  // rodapé diria que a OVH não cobrou nada, que é uma afirmação diferente.
  if (semDado(estado)) {
    return (
      <Vazio titulo={mensagemDeAusencia(estado, fonte) ?? undefined}>
        {detalheDeAusencia(estado)}
      </Vazio>
    );
  }

  const linhas = Array.isArray(dados) ? dados : [];
  if (linhas.length === 0) {
    return (
      <Vazio titulo={`Sem dado para ${ROTULO_FONTE[fonte]} neste recorte`}>
        Ajuste o período, a origem ou o projeto. Isto NÃO significa custo zero — a
        janela simplesmente não tem lançamento desta origem.
      </Vazio>
    );
  }

  if (aba === "servicos") return <TabelaServicos linhas={linhas as LinhaServico[]} moeda={moeda} />;
  if (aba === "projetos") return <TabelaProjetos linhas={linhas as LinhaProjeto[]} moeda={moeda} />;
  if (aba === "faturas") return <TabelaFaturas linhas={linhas as LinhaFatura[]} />;
  return <TabelaMensal linhas={linhas as LinhaMensal[]} moeda={moeda} />;
}

// ------------------------------------------------------------------ tabelas

function Moldura({
  colunas,
  children,
}: {
  colunas: { titulo: string; direita?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    // `overflow-x-auto` no contêiner e `min-w` na tabela: sem os dois, uma tabela
    // larga empurra a página inteira e o corpo passa a rolar de lado no celular.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-veri-offwhite text-left text-xs uppercase tracking-wide text-texto-suave">
            {colunas.map((c) => (
              <th
                key={c.titulo}
                scope="col"
                className={`py-2 pr-4 font-medium ${c.direita ? "text-right" : ""}`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TabelaServicos({ linhas, moeda }: { linhas: LinhaServico[]; moeda: string }) {
  return (
    <Moldura
      colunas={[
        { titulo: "Serviço" },
        { titulo: "Categoria" },
        { titulo: "Lançamentos", direita: true },
        { titulo: "Total", direita: true },
      ]}
    >
      {linhas.map((l) => (
        <tr key={l.servico} className="border-b border-veri-offwhite/60 last:border-0">
          <td className="py-2 pr-4 font-medium">{l.servico}</td>
          {/* `category` é NULL em todas as linhas do banco hoje: a OVH não a
              preenche para servidor dedicado e licença. O travessão é honesto —
              repetir o serviço aqui inventaria uma categoria. */}
          <td className="py-2 pr-4 text-texto-suave">{l.categoria || "—"}</td>
          <td className="veri-numero py-2 pr-4 text-right">{formatInteiro(l.linhas)}</td>
          <td className="veri-numero py-2 text-right">{formatMoeda(l.total, moeda)}</td>
        </tr>
      ))}
    </Moldura>
  );
}

function TabelaProjetos({ linhas, moeda }: { linhas: LinhaProjeto[]; moeda: string }) {
  return (
    <Moldura
      colunas={[
        { titulo: "Projeto" },
        { titulo: "Identificador" },
        { titulo: "Lançamentos", direita: true },
        { titulo: "Total", direita: true },
      ]}
    >
      {linhas.map((l) => (
        <tr
          key={l.servicoDoProjeto || "(sem-projeto)"}
          className="border-b border-veri-offwhite/60 last:border-0"
        >
          <td className="py-2 pr-4 font-medium">
            {l.semProjeto ? "Sem projeto atribuído" : l.nome}
          </td>
          <td className="veri-numero py-2 pr-4 text-xs text-texto-suave">
            {l.servicoDoProjeto || "—"}
          </td>
          <td className="veri-numero py-2 pr-4 text-right">{formatInteiro(l.linhas)}</td>
          <td className="veri-numero py-2 text-right">{formatMoeda(l.total, moeda)}</td>
        </tr>
      ))}
    </Moldura>
  );
}

function TabelaFaturas({ linhas }: { linhas: LinhaFatura[] }) {
  return (
    <Moldura
      colunas={[
        { titulo: "Emissão" },
        { titulo: "Fatura" },
        { titulo: "Conta" },
        { titulo: "Categoria" },
        { titulo: "Imposto", direita: true },
        { titulo: "Total", direita: true },
      ]}
    >
      {linhas.map((l) => (
        <tr key={l.billId} className="border-b border-veri-offwhite/60 last:border-0">
          <td className="veri-numero py-2 pr-4">
            {l.billDate ? formatDataDia(l.billDate) : "—"}
          </td>
          <td className="veri-numero py-2 pr-4 font-medium">{l.billId}</td>
          <td className="py-2 pr-4 text-texto-suave">{l.conta}</td>
          {/*
            "Categoria" e não "Status": a API de faturamento da OVH não expõe
            situação de pagamento — não há campo pago/em aberto em /me/bill. O que
            existe é por que a fatura foi emitida (autorenew, purchase-servers).
            Chamar isso de status faria alguém concluir que a fatura está quitada.
          */}
          <td className="py-2 pr-4 text-texto-suave">{l.categoria || "—"}</td>
          <td className="veri-numero py-2 pr-4 text-right">
            {formatMoeda(l.imposto, l.moeda)}
          </td>
          <td className="veri-numero py-2 text-right">
            {formatMoeda(l.totalComImposto, l.moeda)}
          </td>
        </tr>
      ))}
    </Moldura>
  );
}

function TabelaMensal({ linhas, moeda }: { linhas: LinhaMensal[]; moeda: string }) {
  return (
    <Moldura
      colunas={[
        { titulo: "Mês de competência" },
        { titulo: "Lançamentos", direita: true },
        { titulo: "Total", direita: true },
      ]}
    >
      {linhas.map((l) => (
        <tr key={l.mes} className="border-b border-veri-offwhite/60 last:border-0">
          <td className="veri-numero py-2 pr-4 font-medium">{l.mes}</td>
          <td className="veri-numero py-2 pr-4 text-right">{formatInteiro(l.linhas)}</td>
          <td className="veri-numero py-2 text-right">{formatMoeda(l.total, moeda)}</td>
        </tr>
      ))}
    </Moldura>
  );
}
