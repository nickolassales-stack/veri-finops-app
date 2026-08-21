"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErroDeRequisicao } from "./api";
import { paramsDaApiExportacao, type FiltrosAnalitico } from "./analitico";

/**
 * Download do arquivo exportado.
 *
 * POR QUE `fetch` E NAO UM LINK: com `<a download>` o navegador cuida de tudo,
 * mas a tela nao fica sabendo de nada -- nem que comecou, nem que terminou, nem
 * que o servidor recusou. Uma recusa (sessao expirada, filtro largo demais) viria
 * como um arquivo `.csv` contendo JSON de erro, que o usuario abriria no Excel
 * sem entender o que aconteceu. Buscando por `fetch`, o erro chega como erro.
 *
 * O QUE ESTE MODULO NAO FAZ: montar arquivo. O corpo vem pronto do servidor; o
 * navegador so o recebe e salva. Nenhuma linha e formatada, somada ou convertida
 * aqui -- e por isso que a exportacao continua valendo mesmo com filtro que
 * seleciona muito mais linhas do que a tabela mostra.
 */

export type Formato = "csv" | "xlsx";

export type EstadoExportacao =
  | { fase: "ocioso" }
  | { fase: "exportando"; formato: Formato }
  | { fase: "pronto"; formato: Formato; nome: string }
  | { fase: "erro"; formato: Formato; mensagem: string; exigeLogin: boolean };

export type Exportador = {
  estado: EstadoExportacao;
  exportar: (formato: Formato) => void;
  descartarAviso: () => void;
};

/** Quanto tempo o aviso de sucesso fica na tela antes de sumir sozinho. */
const MS_AVISO_SUCESSO = 6_000;

export function useExportacao(filtros: FiltrosAnalitico): Exportador {
  const [estado, setEstado] = useState<EstadoExportacao>({ fase: "ocioso" });

  /**
   * Filtros vigentes, em ref.
   *
   * `exportar` e passado para botoes e nao deve mudar de identidade a cada
   * digito da busca. Lendo da ref, a funcao fica estavel e ainda assim usa
   * SEMPRE o filtro atual -- exportar o recorte anterior seria um erro
   * silencioso, do tipo que so aparece quando alguem confere o arquivo.
   */
  const filtrosRef = useRef(filtros);
  useEffect(() => {
    filtrosRef.current = filtros;
  }, [filtros]);

  /** Evita dois downloads simultaneos e descarta resposta de pedido superado. */
  const emCurso = useRef(false);

  const descartarAviso = useCallback(() => setEstado({ fase: "ocioso" }), []);

  const exportar = useCallback((formato: Formato) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setEstado({ fase: "exportando", formato });

    void (async () => {
      try {
        const params = paramsDaApiExportacao(filtrosRef.current).toString();
        const resposta = await fetch(`/api/export/${formato}?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!resposta.ok) throw await lerErro(resposta);

        const nome = nomeDoAnexo(resposta) ?? `veri-finops.${formato}`;
        salvar(await resposta.blob(), nome);
        setEstado({ fase: "pronto", formato, nome });
      } catch (err) {
        const erro =
          err instanceof ErroDeRequisicao
            ? err
            : new ErroDeRequisicao(0, "falha-de-rede", "Não foi possível falar com o servidor.");
        setEstado({
          fase: "erro",
          formato,
          mensagem: erro.message,
          exigeLogin: erro.exigeLogin,
        });
      } finally {
        emCurso.current = false;
      }
    })();
  }, []);

  // O aviso de sucesso se apaga sozinho; o de erro fica ate ser dispensado,
  // porque erro que some antes de ser lido e erro que nao foi comunicado.
  useEffect(() => {
    if (estado.fase !== "pronto") return;
    const t = setTimeout(() => setEstado({ fase: "ocioso" }), MS_AVISO_SUCESSO);
    return () => clearTimeout(t);
  }, [estado]);

  return { estado, exportar, descartarAviso };
}

/**
 * A recusa vem como JSON, mesmo numa rota que devolve arquivo.
 *
 * Isso e proposital do lado do servidor: assim a tela recebe a mesma estrutura
 * de erro de todos os outros endpoints e sabe distinguir "sessao expirada" de
 * "filtro largo demais".
 */
async function lerErro(resposta: Response): Promise<ErroDeRequisicao> {
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    // Resposta sem JSON (proxy, pagina de erro do runtime): cai no texto abaixo.
  }

  const erro = (corpo as { erro?: { codigo?: string; mensagem?: string } } | null)?.erro;
  return new ErroDeRequisicao(
    resposta.status,
    erro?.codigo ?? "erro-desconhecido",
    erro?.mensagem ?? `Não foi possível gerar o arquivo (HTTP ${resposta.status}).`,
  );
}

/**
 * Nome do arquivo vindo do `Content-Disposition`.
 *
 * Quem decide o nome e o servidor, porque e ele que sabe o periodo REALMENTE
 * aplicado -- inclusive quando a janela foi encurtada pela ultima carga do ETL.
 * Um nome montado no cliente prometeria um periodo que o arquivo nao tem.
 */
function nomeDoAnexo(resposta: Response): string | null {
  const cabecalho = resposta.headers.get("content-disposition");
  if (!cabecalho) return null;

  const codificado = /filename\*=UTF-8''([^;]+)/i.exec(cabecalho);
  if (codificado) {
    try {
      return decodeURIComponent(codificado[1]);
    } catch {
      // Cabecalho malformado: cai para a forma simples abaixo.
    }
  }

  return /filename="([^"]+)"/i.exec(cabecalho)?.[1] ?? null;
}

/** Dispara o "salvar como" do navegador a partir do blob ja recebido. */
function salvar(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Liberar na hora cancelaria o download em alguns navegadores; o quadro
  // seguinte ja e depois do clique ter sido processado.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
