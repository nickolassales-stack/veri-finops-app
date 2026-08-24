"use client";

/**
 * Último recurso do dashboard — o que aparece quando nem o tratamento por seção
 * segurou.
 *
 * ---------------------------------------------------------------------------
 * O PROJETO NÃO TINHA NENHUM `error.tsx`
 *
 * Sem ele, qualquer exceção não capturada num componente de servidor virava a
 * página em branco do Next — "This page couldn't load. A server error occurred."
 * — sem cabeçalho, sem navegação e sem nada que dissesse em qual tela o usuário
 * estava. Foi assim que a quebra do Diagnóstico chegou ao usuário: uma tela
 * preta que não nomeia o portal, e da qual só se sai pelo botão "voltar".
 *
 * Este limite não substitui o tratamento por seção — ele é a rede embaixo dela.
 * A seção isolada continua sendo a resposta certa, porque preserva o resto da
 * página; isto aqui só garante que o pior caso ainda seja uma tela do portal,
 * com um caminho de volta.
 *
 * ---------------------------------------------------------------------------
 * O QUE NÃO SE MOSTRA AQUI
 *
 * A mensagem original NÃO é exibida, e nem chega ao cliente: em produção o Next
 * substitui a mensagem de erro de componente de servidor por um `digest` antes
 * de enviá-la ao navegador, justamente para não vazar detalhe de infraestrutura
 * a quem está do outro lado. O `digest` é o que liga esta tela à linha
 * correspondente no `docker logs finops-portal`, e é por isso que ele aparece.
 */

export default function ErroDoDashboard({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /**
   * `retry` e nao `reset`: `reset()` apenas limpa o estado de erro e re-renderiza
   * SEM refazer a busca. Como toda falha desta area vem de consulta ao
   * PostgreSQL, ele reapresentaria o mesmo erro no mesmo instante -- um botao
   * que nao pode funcionar. `retry()` refaz o carregamento, que e a unica coisa
   * capaz de mudar o resultado. Estavel desde o Next 16.3.
   */
  retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <div className="rounded-2xl border border-veri-vinho/40 bg-veri-vinho/8 px-6 py-8 text-veri-vinho">
        <h1 className="veri-display text-2xl">Esta tela não pôde ser carregada</h1>
        <p className="mt-3 text-sm leading-relaxed">
          O erro ficou contido nesta página — o restante do portal continua
          funcionando, e nenhum dado foi alterado. Se ele se repetir depois de
          recarregar, leve o código abaixo a quem administra o ambiente: é por ele
          que a falha é localizada no log do servidor.
        </p>

        {error.digest && (
          <p className="veri-numero mt-4 text-xs">
            código: <span className="font-semibold">{error.digest}</span>
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-xl bg-veri-verde-escuro px-4 py-2 text-sm font-semibold text-veri-branco transition hover:opacity-90"
          >
            Tentar de novo
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-veri-verde-escuro/30 px-4 py-2 text-sm font-semibold text-veri-verde-escuro transition hover:bg-veri-verde/10"
          >
            Voltar ao painel
          </a>
        </div>
      </div>
    </div>
  );
}
