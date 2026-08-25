"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Seletor de contas cloud -- AWS e OVH, o MESMO componente.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 *
 * A visão AWS tinha painel suspenso com caixas de marcação, alias e id; a visão
 * OVH tinha pílulas em linha. As duas telas moram na mesma rota (`/dashboard`),
 * e a diferença não era intencional -- era o resíduo de terem sido escritas em
 * semanas diferentes.
 *
 * Pílulas em linha têm um limite duro: elas ocupam largura proporcional ao
 * NÚMERO DE CONTAS. Com duas contas cabe; com oito, a barra de filtros quebra em
 * três linhas e empurra Projeto para fora da tela. O painel suspenso ocupa
 * largura constante e rola por dentro -- é a forma que aguenta o cadastro
 * crescer, que é exatamente o que a tela de Contas Cloud passou a permitir.
 *
 * ---------------------------------------------------------------------------
 * O QUE É PARÂMETRO E O QUE NÃO É
 *
 * Parâmetro: o rótulo, o texto de "todas", a lista, e se o total aparece junto
 * de "todas". Não é parâmetro: o comportamento. As duas visões fecham com Esc,
 * fecham ao clicar fora, marcam com caixa de verdade e tratam "nenhuma marcada"
 * como "todas". Um provedor que divergisse disso seria um defeito, não uma
 * configuração -- por isso `provider` NÃO altera comportamento aqui: ele entra
 * só como discriminante de teste e de `data-provider`, para que um guarda de
 * fonte consiga afirmar que as duas visões usam este componente.
 *
 * ---------------------------------------------------------------------------
 * "TODAS" É A AUSÊNCIA DE SELEÇÃO, E NÃO UMA CAIXA A MAIS
 *
 * Uma caixa "Todas" que marca as demais cria um terceiro estado ambíguo: "todas
 * marcadas" e "todas" viram coisas diferentes na URL, e cadastrar a conta
 * seguinte faria um recorte "todas" antigo passar a EXCLUIR a conta nova sem que
 * ninguém tenha mexido no filtro. Aqui o item "Todas as contas" apenas LIMPA.
 */

export type ContaDoFiltro = {
  /** `provider_account_id` / `account_id`. É o que vai para a URL e para a query. */
  id: string;
  /** Alias do cadastro. É o que a pessoa reconhece. */
  nome: string;
  /** Segunda linha, depois do id: unidade de negócio, tipicamente. */
  detalhe?: string | null;
  /** Contas inativas continuam listadas, marcadas -- some-las esconderia custo. */
  inativa?: boolean;
};

export function CloudAccountMultiSelect({
  provider,
  contas,
  selecionadas,
  aoMudar,
  rotulo,
  rotuloTodas,
  mostrarTotalEmTodas = false,
  carregando = false,
  erro = false,
  vazio = "Nenhuma conta cadastrada.",
}: {
  /** Só discrimina: nenhuma regra de comportamento depende dele. */
  provider: "aws" | "ovh";
  contas: ContaDoFiltro[];
  /** Vazio = todas. */
  selecionadas: string[];
  aoMudar: (contas: string[]) => void;
  /** Legenda do grupo. Ex.: "Contas AWS", "Contas OVH". */
  rotulo: string;
  /** Texto de "nenhuma marcada". Ex.: "Todas as contas OVH". */
  rotuloTodas: string;
  /**
   * Anexa `(N)` a `rotuloTodas` no botão fechado.
   *
   * Ligado só na AWS, onde já era assim: a contagem ali responde "quantas contas
   * eu tenho", pergunta que uma dezena de contas torna real. Desligá-la seria
   * uma regressão silenciosa numa visão que este trabalho não deveria tocar.
   */
  mostrarTotalEmTodas?: boolean;
  carregando?: boolean;
  erro?: boolean;
  vazio?: string;
}) {
  const idBase = useId();
  const idPainel = `${idBase}-painel`;
  const [aberto, setAberto] = useState(false);
  const container = useRef<HTMLFieldSetElement>(null);

  // Fecha ao clicar fora ou ao apertar Esc -- comportamento esperado de qualquer
  // painel suspenso, e o Esc é o único caminho de saída por teclado.
  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (!container.current?.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const total = contas.length;
  const nenhumaSelecionada = selecionadas.length === 0;
  const resumo = resumirSelecao({
    contas,
    selecionadas,
    rotuloTodas,
    mostrarTotalEmTodas,
  });

  function alternar(id: string) {
    aoMudar(
      selecionadas.includes(id)
        ? selecionadas.filter((c) => c !== id)
        : [...selecionadas, id],
    );
  }

  return (
    // `fieldset` + `legend`: é um grupo de controles relacionados, e a legenda é
    // o rótulo do grupo -- é o que o leitor de tela anuncia ao entrar nele.
    <fieldset ref={container} data-provider={provider} className="relative min-w-0">
      <legend
        id={`${idBase}-rotulo`}
        className="text-xs font-medium uppercase tracking-wide text-texto-suave"
      >
        {rotulo}
      </legend>

      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-controls={idPainel}
        aria-describedby={`${idBase}-rotulo`}
        disabled={carregando || erro}
        className="mt-2 flex w-full min-w-56 items-center justify-between gap-3 rounded-full border border-veri-verde-claro/50 bg-veri-branco px-4 py-1.5 text-sm text-veri-verde-escuro transition-colors hover:bg-veri-offwhite disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        <span className="truncate">
          {carregando ? "Carregando contas…" : erro ? "Contas indisponíveis" : resumo}
        </span>
        <span aria-hidden className="text-texto-suave">
          {aberto ? "▲" : "▼"}
        </span>
      </button>

      {aberto && (
        <div
          id={idPainel}
          className="absolute left-0 z-20 mt-2 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-veri-verde-claro/40 bg-veri-branco p-2 shadow-lg"
        >
          <button
            type="button"
            onClick={() => aoMudar([])}
            className={[
              "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-veri-offwhite",
              nenhumaSelecionada
                ? "font-medium text-veri-verde-escuro"
                : "text-texto-suave",
            ].join(" ")}
          >
            Todas as contas
            {nenhumaSelecionada && <span aria-hidden> ✓</span>}
          </button>

          <hr className="my-2 border-veri-offwhite" />

          {contas.map((conta) => {
            const id = `${idBase}-${conta.id}`;
            return (
              <div key={conta.id} className="flex items-start gap-3 px-3 py-1.5">
                <input
                  type="checkbox"
                  id={id}
                  checked={selecionadas.includes(conta.id)}
                  onChange={() => alternar(conta.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#384E46]"
                />
                <label htmlFor={id} className="min-w-0 cursor-pointer text-sm">
                  <span className="block truncate text-veri-verde-escuro">
                    {conta.nome}
                    {conta.inativa && <span className="text-texto-suave"> · inativa</span>}
                  </span>
                  {/* O ID SEMPRE APARECE, e não só o alias: dois clientes podem
                      ter alias parecido, e é o id que vai para a URL, para o
                      export e para o suporte. */}
                  <span className="veri-numero block truncate text-xs text-texto-suave">
                    {conta.id}
                    {conta.detalhe ? ` · ${conta.detalhe}` : ""}
                  </span>
                </label>
              </div>
            );
          })}

          {total === 0 && !carregando && (
            <p className="px-3 py-2 text-sm text-texto-suave">{vazio}</p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Texto do botão fechado -- exportado porque é a regra que o teste verifica.
 *
 * Com UMA conta o nome dela é a informação útil; com várias, os nomes não cabem
 * e a contagem passa a ser a leitura certa. Um id selecionado que não está na
 * lista cai de volta no próprio id, e não em "conta desconhecida": o id é o que
 * a pessoa colou na URL, e é por ele que ela vai procurar.
 */
export function resumirSelecao({
  contas,
  selecionadas,
  rotuloTodas,
  mostrarTotalEmTodas = false,
}: {
  contas: ContaDoFiltro[];
  selecionadas: string[];
  rotuloTodas: string;
  mostrarTotalEmTodas?: boolean;
}): string {
  if (selecionadas.length === 0) {
    return mostrarTotalEmTodas && contas.length > 0
      ? `${rotuloTodas} (${contas.length})`
      : rotuloTodas;
  }
  if (selecionadas.length === 1) {
    return contas.find((c) => c.id === selecionadas[0])?.nome ?? selecionadas[0];
  }
  return `${selecionadas.length} contas selecionadas`;
}
