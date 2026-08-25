"use client";

import { useId } from "react";

import {
  FONTES_VISIVEIS,
  PRESETS_OVH_VISIVEIS,
  ROTULOS_PRESET_OVH,
  temFiltroOvhAplicado,
  type FiltrosOvh,
  type ProblemaFiltroOvh,
} from "@/lib/dashboard/filtros-ovh";
import { DESCRICAO_FONTE, ROTULO_FONTE } from "@/lib/dashboard/ovh";
import type { ProjetoDisponivel } from "@/lib/dashboard/tipos-ovh";
import type { FonteOvh } from "@/lib/filtros/esquemas";
import type { PresetMes } from "@/lib/filtros/periodo-mensal";

/**
 * Barra de filtros da visao OVH.
 *
 * Tres filtros, na ordem em que se pergunta: quando, o que, e de quem. Nenhum
 * filtro de conta AWS aparece aqui -- esta tela nao le `aws_daily_costs`.
 *
 * A ORIGEM E UM FILTRO DE PRIMEIRA CLASSE, e nao um detalhe escondido. As tres
 * origens da OVH nao se somam: `invoice` e o que a empresa pagou,
 * `usage_current` e o consumo do mes em andamento e `usage_forecast` e projecao.
 * O mesmo projeto no mesmo mes tem legitimamente linha nas tres. Deixar isso
 * implicito seria a forma mais facil de alguem ler uma projecao como fatura.
 */
export function FiltrosOvhBarra({
  filtros,
  problema,
  contas,
  projetos,
  fontesComDado,
  carregando,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosOvh;
  problema: ProblemaFiltroOvh;
  /**
   * Contas OVH ATIVAS do cadastro do portal (`cloud_accounts` + alias). Vazio
   * ou com UMA conta esconde o seletor: um filtro de um item so ocupa espaco e
   * sugere uma escolha que nao existe. Nenhuma conta AWS chega aqui -- a
   * consulta ja filtra `provider = 'ovh'`.
   */
  contas?: { id: string; nome: string }[];
  projetos: ProjetoDisponivel[];
  /** Origens que existem no banco. As outras aparecem marcadas como sem dado. */
  fontesComDado: FonteOvh[];
  carregando: boolean;
  aoMudar: (mudanca: Partial<FiltrosOvh>) => void;
  aoLimpar: () => void;
}) {
  return (
    <section
      aria-label="Filtros da visão OVH"
      className="rounded-2xl border border-veri-offwhite bg-veri-branco p-5"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:gap-8">
          <FiltroPeriodoMensal filtros={filtros} problema={problema} aoMudar={aoMudar} />
          <FiltroOrigem
            selecionada={filtros.source}
            fontesComDado={fontesComDado}
            aoMudar={(source) => aoMudar({ source })}
          />
          {/* Contas ANTES de Projeto: um projeto pertence a uma conta, e a
              pergunta natural vai do maior para o menor recorte. */}
          {(contas?.length ?? 0) > 1 && (
            <FiltroContas
              selecionadas={filtros.contas}
              contas={contas ?? []}
              aoMudar={(lista) => aoMudar({ contas: lista })}
            />
          )}
          <FiltroProjeto
            selecionado={filtros.projeto}
            projetos={projetos}
            aoMudar={(projeto) => aoMudar({ projeto })}
          />
        </div>

        <div className="flex items-center gap-3 lg:pt-6">
          <span
            aria-live="polite"
            className={[
              "text-xs text-texto-suave transition-opacity",
              carregando ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            {carregando ? "Atualizando…" : ""}
          </span>

          {temFiltroOvhAplicado(filtros) && (
            <button
              type="button"
              onClick={aoLimpar}
              className="rounded-full border border-veri-verde-claro/50 px-4 py-1.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Periodo em meses.
 *
 * Radios de verdade dentro de um `fieldset`, igual ao filtro da AWS: o navegador
 * ja da navegacao por setas, o anuncio de "opcao 2 de 5" e o agrupamento
 * semantico. O visual de pilha e so CSS sobre o radio nativo.
 */
function FiltroPeriodoMensal({
  filtros,
  problema,
  aoMudar,
}: {
  filtros: FiltrosOvh;
  problema: ProblemaFiltroOvh;
  aoMudar: (mudanca: Partial<FiltrosOvh>) => void;
}) {
  const idBase = useId();
  const idDe = `${idBase}-de`;
  const idAte = `${idBase}-ate`;
  const idErro = `${idBase}-erro`;

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium uppercase tracking-wide text-texto-suave">
        Período
      </legend>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS_OVH_VISIVEIS.map((preset: PresetMes) => {
          const id = `${idBase}-${preset}`;
          const ativo = filtros.periodo === preset;

          return (
            <div key={preset} className="relative">
              <input
                type="radio"
                id={id}
                name={`${idBase}-periodo`}
                value={preset}
                checked={ativo}
                onChange={() => aoMudar({ periodo: preset })}
                className="peer sr-only"
              />
              <label htmlFor={id} className={pilula(ativo)}>
                {ROTULOS_PRESET_OVH[preset]}
              </label>
            </div>
          );
        })}
      </div>

      {filtros.periodo === "personalizado" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={idDe} className="block text-xs text-texto-suave">
              De
            </label>
            {/*
              `type="month"` e nao `type="date"`: o valor nativo do controle ja e
              "AAAA-MM", exatamente o formato que a API espera. Com um campo de
              data, o usuario escolheria um DIA que a OVH nao sabe responder --
              a granularidade minima do dado e o mes.
            */}
            <input
              type="month"
              id={idDe}
              value={filtros.deMes}
              max={filtros.ateMes || undefined}
              onChange={(e) => aoMudar({ deMes: e.target.value })}
              aria-invalid={problema?.campo === "deMes" || undefined}
              aria-describedby={problema ? idErro : undefined}
              className={campoMes(problema?.campo === "deMes")}
            />
          </div>

          <div>
            <label htmlFor={idAte} className="block text-xs text-texto-suave">
              Até
            </label>
            <input
              type="month"
              id={idAte}
              value={filtros.ateMes}
              min={filtros.deMes || undefined}
              onChange={(e) => aoMudar({ ateMes: e.target.value })}
              aria-invalid={problema?.campo === "ateMes" || undefined}
              aria-describedby={problema ? idErro : undefined}
              className={campoMes(problema?.campo === "ateMes")}
            />
          </div>

          {problema && (
            <p id={idErro} role="alert" className="w-full text-sm text-veri-vinho sm:w-auto">
              {problema.mensagem}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Origem do custo.
 *
 * A origem SEM DADO continua na lista, marcada, em vez de desaparecer. Esconder
 * responderia a pergunta errada: quem procura "uso corrente" precisa descobrir
 * que a API da OVH nao devolve isso -- nao concluir que a tela esta incompleta.
 */
function FiltroOrigem({
  selecionada,
  fontesComDado,
  aoMudar,
}: {
  selecionada: FonteOvh;
  fontesComDado: FonteOvh[];
  aoMudar: (fonte: FonteOvh) => void;
}) {
  const idBase = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium uppercase tracking-wide text-texto-suave">
        Origem do custo
      </legend>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {FONTES_VISIVEIS.map((fonte) => {
          const id = `${idBase}-${fonte}`;
          const ativo = selecionada === fonte;
          // `length > 0` e a guarda: antes da primeira resposta a lista chega
          // vazia, e marcar tudo como "sem dado" ali seria mentira transitoria.
          const semDado = fontesComDado.length > 0 && !fontesComDado.includes(fonte);

          return (
            <div key={fonte} className="relative">
              <input
                type="radio"
                id={id}
                name={`${idBase}-source`}
                value={fonte}
                checked={ativo}
                onChange={() => aoMudar(fonte)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                title={DESCRICAO_FONTE[fonte]}
                className={pilula(ativo)}
              >
                {ROTULO_FONTE[fonte]}
                {semDado && (
                  <span
                    className={ativo ? "opacity-80" : "text-texto-suave"}
                  >
                    {" "}
                    · sem dado
                  </span>
                )}
              </label>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 max-w-xs text-xs text-texto-suave">
        {DESCRICAO_FONTE[selecionada]}. As três origens{" "}
        <strong className="font-medium">não se somam</strong>.
      </p>
    </fieldset>
  );
}

/**
 * Contas OVH -- MULTIPLA ESCOLHA.
 *
 * ---------------------------------------------------------------------------
 * CAIXAS DE MARCACAO, E NAO `<select multiple>`
 *
 * O `<select multiple>` nativo e uma armadilha conhecida: para escolher a
 * segunda opcao e preciso segurar Ctrl, e quem nao sabe disso DESMARCA a
 * primeira ao clicar na segunda -- silenciosamente, achando que somou. Num
 * filtro que muda todos os numeros da tela, esse gesto errado nao tem sintoma.
 *
 * Caixas de marcacao nao tem esse modo escondido, e cada uma e um alvo de toque
 * legitimo no celular.
 *
 * ---------------------------------------------------------------------------
 * "TODAS" E A AUSENCIA DE SELECAO, E NAO UMA CAIXA A MAIS
 *
 * Uma caixa "Todas" que marca as demais parece util e cria um terceiro estado
 * ambiguo -- "todas marcadas" e "todas" viram coisas diferentes na URL, e
 * cadastrar a terceira conta faria um recorte "todas" antigo passar a excluir
 * a conta nova sem que ninguem tenha mudado o filtro.
 *
 * Aqui, nenhuma marcada = todas. O botao "Todas as contas" apenas LIMPA.
 *
 * Aparece so com DUAS ou mais contas: um filtro de um item so ocupa espaco e
 * sugere uma escolha que nao existe.
 */
function FiltroContas({
  selecionadas,
  contas,
  aoMudar,
}: {
  selecionadas: string[];
  contas: { id: string; nome: string }[];
  aoMudar: (contas: string[]) => void;
}) {
  const idBase = useId();
  const todas = selecionadas.length === 0;

  function alternar(id: string) {
    aoMudar(
      selecionadas.includes(id)
        ? selecionadas.filter((x) => x !== id)
        : [...selecionadas, id],
    );
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium uppercase tracking-wide text-texto-suave">
        Contas
      </legend>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => aoMudar([])}
          aria-pressed={todas}
          className={pilula(todas)}
        >
          Todas as contas
        </button>

        {contas.map((c) => {
          const id = `${idBase}-${c.id}`;
          const marcada = selecionadas.includes(c.id);

          return (
            <div key={c.id} className="relative">
              <input
                type="checkbox"
                id={id}
                checked={marcada}
                onChange={() => alternar(c.id)}
                className="peer sr-only"
              />
              <label htmlFor={id} className={pilula(marcada)} title={c.id}>
                {c.nome}
              </label>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 max-w-xs text-xs text-texto-suave">
        {todas
          ? "Todas as contas OVH ativas do cadastro."
          : `${selecionadas.length} de ${contas.length} contas no recorte.`}
      </p>
    </fieldset>
  );
}

/** Projeto OVH. `<select>` nativo: a lista e curta e o controle e conhecido. */

function FiltroProjeto({
  selecionado,
  projetos,
  aoMudar,
}: {
  selecionado: string;
  projetos: ProjetoDisponivel[];
  aoMudar: (projeto: string) => void;
}) {
  const id = useId();

  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wide text-texto-suave"
      >
        Projeto
      </label>

      <select
        id={id}
        value={selecionado}
        onChange={(e) => aoMudar(e.target.value)}
        disabled={projetos.length === 0}
        className="mt-2 max-w-[16rem] rounded-lg border border-veri-verde-claro/50 bg-veri-branco px-3 py-1.5 text-sm text-veri-verde-escuro disabled:opacity-60"
      >
        <option value="">
          {projetos.length === 0 ? "Nenhum projeto no recorte" : "Todos os projetos"}
        </option>
        {projetos.map((p) => (
          <option key={p.servicoDoProjeto} value={p.servicoDoProjeto}>
            {p.nome}
          </option>
        ))}
      </select>

      {/*
        A advertencia importa: parte do custo da fatura nao pertence a projeto
        nenhum (taxa de dominio, assinatura), e filtrar por projeto exclui essa
        parte. Sem o aviso, a soma por projeto parece nao fechar com o total.
      */}
      {selecionado !== "" && (
        <p className="mt-1.5 max-w-xs text-xs text-texto-suave">
          Filtrando por projeto, o custo de fatura sem projeto atribuído fica de fora.
        </p>
      )}
    </div>
  );
}

function pilula(ativo: boolean): string {
  return [
    "block cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors",
    "peer-focus-visible:outline peer-focus-visible:outline-2",
    "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-veri-verde-escuro",
    ativo
      ? "border-veri-verde-escuro bg-veri-verde-escuro text-veri-branco"
      : "border-veri-verde-claro/50 bg-veri-branco text-veri-verde-escuro hover:bg-veri-offwhite",
  ].join(" ");
}

function campoMes(comErro: boolean): string {
  return [
    "mt-1 rounded-lg border bg-veri-branco px-3 py-1.5 text-sm text-veri-verde-escuro",
    comErro ? "border-veri-vinho" : "border-veri-verde-claro/50",
  ].join(" ");
}
