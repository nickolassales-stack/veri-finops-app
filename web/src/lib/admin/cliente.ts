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
export async function escrever<T>(
  caminho: string,
  metodo: "POST" | "PATCH",
  corpo: unknown,
): Promise<T> {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(corpo),
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

  return (lido as { dados: T }).dados;
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
