"use client";

import {
  useExportacao,
  type EstadoExportacao,
  type Formato,
} from "@/lib/dashboard/use-exportacao";
import type { FiltrosAnalitico } from "@/lib/dashboard/analitico";
import { formatInteiro } from "@/lib/format";

/**
 * Exportacao do recorte atual.
 *
 * O arquivo e montado NO SERVIDOR e contem tudo o que o filtro seleciona -- nao
 * apenas a pagina visivel. Por isso o texto de apoio fala em lancamentos do
 * filtro, e nao em linhas da tabela: sao numeros diferentes, e confundi-los
 * levaria alguem a achar que exportou 50 linhas quando exportou 230.
 *
 * Quatro estados visiveis, todos anunciados por `aria-live`: exportando, erro,
 * indisponivel (botao desabilitado com motivo) e sucesso.
 */
export function BotoesExportacao({
  filtros,
  total,
  ocupado,
  motivoIndisponivel,
}: {
  filtros: FiltrosAnalitico;
  /** Linhas que o filtro seleciona no banco. `null` enquanto carrega. */
  total: number | null;
  ocupado: boolean;
  /** Quando presente, os botoes ficam desabilitados com esta explicacao. */
  motivoIndisponivel?: string;
}) {
  const { estado, exportar, descartarAviso } = useExportacao(filtros);

  const exportando = estado.fase === "exportando";
  const desabilitado = Boolean(motivoIndisponivel) || ocupado || exportando;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Botao
          formato="csv"
          rotulo="Baixar CSV"
          total={total}
          desabilitado={desabilitado}
          carregando={exportando && estado.formato === "csv"}
          aoClicar={() => exportar("csv")}
        />
        <Botao
          formato="xlsx"
          rotulo="Baixar Excel"
          total={total}
          desabilitado={desabilitado}
          carregando={exportando && estado.formato === "xlsx"}
          aoClicar={() => exportar("xlsx")}
        />

        <p className="text-xs leading-snug text-texto-suave">
          {motivoIndisponivel ? (
            motivoIndisponivel
          ) : total === null ? (
            "Preparando o recorte…"
          ) : (
            <>
              {formatInteiro(total)} lançamento(s) do filtro — não só esta página.
              <span className="hidden sm:inline">
                {" "}
                O arquivo traz período, contas e cotação no cabeçalho.
              </span>
            </>
          )}
        </p>
      </div>

      {/*
        `aria-live` numa regiao que existe SEMPRE (mesmo vazia): inserir o
        elemento junto com a mensagem faz leitores de tela perderem o anuncio.
      */}
      <div aria-live="polite" className="empty:hidden">
        <Anuncio estado={estado} aoDispensar={descartarAviso} />
      </div>
    </div>
  );
}

/** O que a regiao `aria-live` diz em cada fase. `null` quando nao ha o que dizer. */
function Anuncio({
  estado,
  aoDispensar,
}: {
  estado: EstadoExportacao;
  aoDispensar: () => void;
}) {
  if (estado.fase === "exportando") {
    return (
      <p className="text-xs text-texto-suave">
        Gerando o arquivo no servidor… pode levar alguns segundos em períodos
        longos.
      </p>
    );
  }

  if (estado.fase === "pronto") {
    return (
      <p className="text-xs text-veri-verde-escuro">
        <span aria-hidden>✓ </span>
        Download iniciado: <strong className="font-medium">{estado.nome}</strong>
      </p>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="rounded-xl border border-veri-vinho/40 bg-veri-vinho/8 px-4 py-3 text-xs text-veri-vinho">
        <p className="font-semibold">Não foi possível exportar</p>
        <p className="mt-1 leading-relaxed">{estado.mensagem}</p>
        <div className="mt-2 flex gap-4">
          {estado.exigeLogin && (
            <a href="/login?next=%2Fdashboard%2Fanalitico" className="underline">
              Entrar novamente
            </a>
          )}
          <button type="button" onClick={aoDispensar} className="underline">
            Dispensar
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function Botao({
  formato,
  rotulo,
  total,
  desabilitado,
  carregando,
  aoClicar,
}: {
  formato: Formato;
  rotulo: string;
  total: number | null;
  desabilitado: boolean;
  carregando: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={desabilitado}
      // O rotulo visivel diz "Baixar CSV"; o acessivel diz o que sera baixado.
      aria-label={
        total === null
          ? `${rotulo} dos lançamentos do filtro`
          : `${rotulo} com ${formatInteiro(total)} lançamento(s) do filtro atual`
      }
      // `verde-escuro` e nao `verde`: branco sobre #7f9c90 da 2,97:1, abaixo do
      // minimo de 4,5:1 da WCAG AA para texto normal. Sobre #384e46 sao 8,95:1.
      // E o mesmo tratamento dos demais botoes primarios (login, troca de senha,
      // filtro de periodo) -- este era o unico fora do padrao.
      className="inline-flex items-center gap-2 rounded-full bg-veri-verde-escuro px-5 py-2 text-sm font-medium text-veri-branco transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {carregando && (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-2 border-veri-branco/40 border-t-veri-branco"
        />
      )}
      {carregando ? "Gerando…" : rotulo}
      <span className="sr-only"> (formato {formato.toUpperCase()})</span>
    </button>
  );
}
