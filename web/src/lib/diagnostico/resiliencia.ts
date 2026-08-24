import { sanitizar } from "@/lib/ovh/protocolo";

/**
 * Carregamento por seção: uma seção que falha não derruba a página.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISOU EXISTIR
 *
 * O Diagnóstico carregava tudo num `Promise.all`. `Promise.all` REJEITA INTEIRO
 * se qualquer promessa rejeitar — então uma consulta que devolveu zero linhas em
 * `cloud_sync_jobs` (a fila em repouso) apagou da tela o estado do ETL AWS, o
 * frescor por conta, os privilégios do banco e o próprio cabeçalho. O usuário
 * recebeu a página de erro do Next, sem uma palavra sobre o que falhou.
 *
 * A inversão é a tela em que isso menos podia acontecer. O Diagnóstico é para
 * onde se vai QUANDO o ambiente está pela metade; ele precisa mostrar o que
 * ainda funciona e nomear o que não funciona. Uma tela de diagnóstico que morre
 * junto com o que deveria diagnosticar não diagnostica nada.
 *
 * ---------------------------------------------------------------------------
 * O CONTRATO
 *
 * `tentarSecao` NUNCA rejeita. Devolve `{ ok: true, valor }` ou
 * `{ ok: false, erro }`, e o chamador decide o que desenhar. Como o tipo é uma
 * união discriminada, o TypeScript OBRIGA a tratar o ramo de falha antes de
 * chegar ao valor — a resiliência não fica na disciplina de quem escreve a
 * próxima seção.
 *
 * Isto é `Promise.allSettled` com três coisas a mais: rótulo para o log,
 * mensagem já sanitizada e um tipo que a tela consegue consumir direto.
 */

export type Secao<T> = { ok: true; valor: T } | { ok: false; erro: string };

/**
 * Mensagem exibível a partir de qualquer coisa lançada.
 *
 * Passa por `sanitizar` porque mensagem de erro de banco e de HTTP tem o hábito
 * de ecoar o que recebeu — inclusive parâmetros. A regra do projeto é que nada
 * com forma de credencial chegue à tela ou ao log, e o caminho de erro é
 * justamente o que ninguém revisa.
 *
 * A mensagem é a técnica, e não uma frase amigável genérica: quem abre o
 * Diagnóstico está investigando. "Ocorreu um erro" o obrigaria a ir ao log do
 * container para saber o que já está aqui.
 */
export function mensagemDeFalha(erro: unknown): string {
  const bruta =
    erro instanceof Error
      ? erro.message
      : typeof erro === "string"
        ? erro
        : "falha sem mensagem";
  const limpa = sanitizar(bruta);
  return limpa === "" ? "falha sem mensagem" : limpa;
}

/**
 * Executa o carregador de uma seção e captura qualquer falha.
 *
 * O `rotulo` vai para o log do servidor junto da mensagem — sem ele, um
 * "Esperava 1 linha, recebi 0." no log não diz QUAL das oito consultas da página
 * falhou, que foi exatamente a dificuldade ao investigar esta quebra.
 */
export async function tentarSecao<T>(
  rotulo: string,
  carregar: () => Promise<T>,
): Promise<Secao<T>> {
  try {
    return { ok: true, valor: await carregar() };
  } catch (erro) {
    const mensagem = mensagemDeFalha(erro);
    // `console.error` e não um logger estruturado: é o que o resto do projeto
    // usa nas rotas, e `docker logs finops-portal` é onde se procura.
    console.error(`[diagnostico] seção "${rotulo}" falhou: ${mensagem}`);
    return { ok: false, erro: mensagem };
  }
}

/**
 * Valor da seção, ou um padrão quando ela falhou.
 *
 * Para seção acessória, em que a falha não precisa de espaço próprio na tela —
 * o alerta do bloco já basta.
 */
export function valorOu<T>(secao: Secao<T>, padrao: T): T {
  return secao.ok ? secao.valor : padrao;
}
