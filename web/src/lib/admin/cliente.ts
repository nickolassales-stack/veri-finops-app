"use client";

import { ErroDeRequisicao, buscarRecurso } from "@/lib/dashboard/api";

/**
 * Cliente das rotas administrativas.
 *
 * A leitura reaproveita `buscarRecurso` do dashboard -- mesmo envelope, mesma
 * taxonomia de erro, nada a duplicar. O que falta la e a ESCRITA, que este
 * modulo acrescenta.
 */

export { ErroDeRequisicao };

export function ler<T, M = unknown>(caminho: string, sinal?: AbortSignal) {
  return buscarRecurso<T, M>(caminho, new URLSearchParams(), sinal);
}

/**
 * POST/PATCH com corpo JSON.
 *
 * Devolve `dados` ja desembrulhado, porque toda tela de escrita quer o registro
 * atualizado para reconciliar a lista sem uma segunda ida ao servidor.
 */
export type MetodoDeEscrita = "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * A chamada em si. `escrever` e `escreverComMeta` sao dois recortes desta.
 *
 * DELETE nao leva corpo: alguns intermediarios descartam corpo de DELETE, e uma
 * rota que dependesse dele falharia so em producao, atras do proxy.
 */
async function requisitar<T, M>(
  caminho: string,
  metodo: MetodoDeEscrita,
  corpo: unknown,
): Promise<{ dados: T; meta: M | undefined }> {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers:
      metodo === "DELETE"
        ? { accept: "application/json" }
        : { "content-type": "application/json", accept: "application/json" },
    body: metodo === "DELETE" ? undefined : JSON.stringify(corpo),
    cache: "no-store",
    credentials: "same-origin",
  });

  let lido: unknown = null;
  try {
    lido = await resposta.json();
  } catch {
    // Resposta sem JSON (proxy, pagina de erro): tratada abaixo.
  }

  if (!resposta.ok) {
    const erro = (lido as { erro?: { codigo: string; mensagem: string; detalhes?: { campo: string; mensagem: string }[] } } | null)
      ?.erro;
    throw new ErroDeRequisicao(
      resposta.status,
      erro?.codigo ?? "erro-desconhecido",
      erro?.mensagem ?? `Falha em ${caminho} (HTTP ${resposta.status}).`,
      erro?.detalhes ?? [],
    );
  }

  const envelope = lido as { dados: T; meta?: M } | null;
  return { dados: envelope?.dados as T, meta: envelope?.meta };
}

export async function escrever<T>(
  caminho: string,
  metodo: MetodoDeEscrita,
  corpo: unknown,
): Promise<T> {
  return (await requisitar<T, unknown>(caminho, metodo, corpo)).dados;
}

/**
 * Igual a `escrever`, mas devolve `meta` tambem.
 *
 * Existe separada em vez de mudar o retorno de `escrever`: tres paineis ja
 * consomem `escrever` esperando o registro direto, e alargar o tipo obrigaria a
 * mexer nos tres para ganhar um campo que so uma tela usa. O bloco de
 * credenciais precisa de `meta` porque o aviso de chave duplicada sai por la --
 * ele nao e o registro salvo, e um sucesso com ressalva.
 */
export async function escreverComMeta<T, M = unknown>(
  caminho: string,
  metodo: MetodoDeEscrita,
  corpo: unknown,
): Promise<{ dados: T; meta: M | undefined }> {
  return requisitar<T, M>(caminho, metodo, corpo);
}

/** DELETE. Devolve o que a rota respondeu em `dados`. */
export async function remover<T = unknown>(caminho: string): Promise<T> {
  return (await requisitar<T, unknown>(caminho, "DELETE", undefined)).dados;
}

/**
 * Traduz a falha para uma frase de tela.
 *
 * O detalhe por campo vem junto: numa tela de formulario, "E-mail invalido" ao
 * lado do erro geral e a diferenca entre corrigir e adivinhar.
 */
export function mensagemDoErro(err: unknown): string {
  if (err instanceof ErroDeRequisicao) {
    const detalhe = err.detalhes.map((d) => `${d.campo}: ${d.mensagem}`).join("; ");
    return detalhe ? `${err.message} (${detalhe})` : err.message;
  }
  return "Não foi possível falar com o servidor.";
}
