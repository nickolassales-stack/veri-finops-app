"use client";

import { useEffect, useId, useState } from "react";

import {
  TAMANHOS_PAGINA,
  type FiltrosAnalitico,
} from "@/lib/dashboard/analitico";
import { REGIAO_NAO_INFORMADA } from "@/lib/filtros/esquemas";
import { formatInteiro } from "@/lib/format";

/**
 * Filtros proprios do analitico: busca por servico, regiao e tamanho de pagina.
 *
 * Ficam numa faixa separada da dos filtros globais (periodo e contas) para
 * deixar claro o escopo de cada um: acima, o recorte que vale em todas as telas;
 * aqui, o que refina esta tabela.
 */
export function FiltrosAnalitico({
  filtros,
  regioes,
  aoMudar,
}: {
  filtros: FiltrosAnalitico;
  regioes: { valor: string | null; linhas: number }[];
  aoMudar: (mudanca: Partial<FiltrosAnalitico>) => void;
}) {
  const idBase = useId();
  const idBusca = `${idBase}-busca`;
  const idRegiao = `${idBase}-regiao`;
  const idTamanho = `${idBase}-tamanho`;

  /**
   * Texto digitado, com envio atrasado.
   *
   * Sem o atraso, cada tecla dispararia uma requisicao e reescreveria a URL --
   * o histórico do navegador ficaria cheio e o servidor levaria uma rajada.
   */
  const [texto, setTexto] = useState(filtros.busca);

  /**
   * Ressincroniza quando a URL muda por fora: botao voltar, "limpar filtros",
   * link colado.
   *
   * Ajuste DURANTE o render, comparando com o ultimo valor visto -- e o idioma
   * que o React documenta para "estado derivado de prop". Fazer isso num efeito
   * provocaria um render extra em cascata a cada mudanca.
   */
  const [buscaVista, setBuscaVista] = useState(filtros.busca);
  if (filtros.busca !== buscaVista) {
    setBuscaVista(filtros.busca);
    setTexto(filtros.busca);
  }

  useEffect(() => {
    if (texto === filtros.busca) return;
    const t = setTimeout(() => aoMudar({ busca: texto }), 400);
    return () => clearTimeout(t);
  }, [texto, filtros.busca, aoMudar]);

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">
      {/* ------------------------------------------------------ busca */}
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <label
          htmlFor={idBusca}
          className="block text-xs font-medium uppercase tracking-wide text-texto-suave"
        >
          Buscar serviço
        </label>
        <div className="relative mt-2">
          <input
            id={idBusca}
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={100}
            placeholder="ex.: EC2, S3, waf"
            // `type=search` com `enterkeyhint` melhora o teclado no celular.
            enterKeyHint="search"
            className="w-full rounded-full border border-veri-verde-claro/50 bg-veri-branco px-4 py-1.5 pr-9 text-sm text-veri-verde-escuro placeholder:text-texto-suave"
          />
          {texto && (
            <button
              type="button"
              onClick={() => setTexto("")}
              aria-label="Limpar busca por serviço"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-texto-suave hover:text-veri-verde-escuro"
            >
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------- regiao */}
      <div className="min-w-0">
        <label
          htmlFor={idRegiao}
          className="block text-xs font-medium uppercase tracking-wide text-texto-suave"
        >
          Região
        </label>
        <select
          id={idRegiao}
          value={filtros.regiao}
          onChange={(e) => aoMudar({ regiao: e.target.value })}
          className="mt-2 w-full min-w-52 rounded-full border border-veri-verde-claro/50 bg-veri-branco px-4 py-1.5 text-sm text-veri-verde-escuro sm:w-auto"
        >
          <option value="">Todas as regiões</option>
          {regioes.map((r) => (
            <option
              key={r.valor ?? "(nula)"}
              value={r.valor ?? REGIAO_NAO_INFORMADA}
            >
              {r.valor ?? "Não informada"} · {formatInteiro(r.linhas)}
            </option>
          ))}
        </select>
        {/*
          A coluna `region` do ETL guarda ZONA DE DISPONIBILIDADE (us-east-1b),
          nao região (us-east-1), e grava "nan" quando nao sabe. Dizer isso aqui
          evita que alguem interprete o corte como filtro de região de verdade.
        */}
        <p className="mt-1.5 max-w-52 text-[11px] leading-snug text-texto-suave">
          O ETL grava zona de disponibilidade, não região.
        </p>
      </div>

      {/* ------------------------------------------- linhas por pagina */}
      <div className="min-w-0">
        <label
          htmlFor={idTamanho}
          className="block text-xs font-medium uppercase tracking-wide text-texto-suave"
        >
          Linhas por página
        </label>
        <select
          id={idTamanho}
          value={filtros.tamanho}
          onChange={(e) => aoMudar({ tamanho: Number(e.target.value) })}
          className="mt-2 rounded-full border border-veri-verde-claro/50 bg-veri-branco px-4 py-1.5 text-sm text-veri-verde-escuro"
        >
          {TAMANHOS_PAGINA.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
