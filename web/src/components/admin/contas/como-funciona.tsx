/**
 * A explicação longa, recolhida.
 *
 * ---------------------------------------------------------------------------
 * `<details>` NATIVO, E NÃO UM ACORDEÃO EM ESTADO REACT
 *
 * Abre e fecha sem JavaScript, é anunciado corretamente por leitor de tela sem
 * `aria-expanded` escrito à mão, e o Ctrl+F do navegador ENCONTRA texto dentro
 * dele — o browser abre o bloco sozinho ao achar o termo. Um acordeão com
 * `useState` e `display:none` esconde o conteúdo da busca da página, que é
 * justamente o que alguém procurando "por que a AWS não pede chave" faria.
 *
 * Este componente é de SERVIDOR: é texto estático, não precisa de estado nem de
 * interatividade, e mantê-lo fora do bundle do cliente é de graça.
 */
export function ComoFunciona() {
  return (
    <details className="group rounded-2xl border border-veri-offwhite bg-veri-branco">
      <summary className="cursor-pointer list-none px-6 py-4 text-sm font-semibold text-veri-verde-escuro marker:content-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-veri-verde-escuro">
        <span className="inline-flex items-center gap-2">
          <span className="text-texto-suave transition-transform group-open:rotate-90">
            ›
          </span>
          Como funciona
        </span>
      </summary>

      <div className="space-y-4 border-t border-veri-offwhite px-6 py-5 text-sm leading-relaxed text-texto-suave">
        <div>
          <h3 className="font-semibold text-veri-verde-escuro">O alias vale em todo o portal</h3>
          <p className="mt-1">
            O nome definido aqui substitui o do cadastro nos filtros, nos cards, na tabela
            analítica e nos arquivos exportados. O <strong>ID da conta</strong> continua
            sempre visível ao lado — é ele que identifica a conta no provedor.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-veri-verde-escuro">
            Por que AWS e OVH têm telas diferentes
          </h3>
          <p className="mt-1">
            Não é organização: os dois provedores entram no portal por caminhos opostos.
            A conta <strong>AWS</strong> aparece porque entregou custo no Data Export/CUR,
            e o identificador dela é o número de 12 dígitos que a AWS emitiu — não há o
            que cadastrar aqui. A conta <strong>OVH</strong> é cadastrada neste portal,
            com um identificador que nós escolhemos, e é ele que amarra credencial,
            coleta e custo.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-veri-verde-escuro">
            A AWS não pede chave, e isso não é omissão
          </h3>
          <p className="mt-1">
            A AWS autentica por <strong>IAM role da instância</strong> — não há segredo
            para guardar no portal. A OVH autentica por chave de API, que fica{" "}
            <strong>cifrada no banco</strong> e visível apenas para administradores. Se
            você procurou onde colar a chave da AWS: ela não existe.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-veri-verde-escuro">O provedor não é editável</h3>
          <p className="mt-1">
            Trocá-lo desligaria a conta da sua origem de dado: uma conta AWS marcada como
            OVH sumiria do painel e não apareceria em Faturamento, porque não existe linha
            correspondente em <span className="veri-numero">ovh_monthly_costs</span>.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-veri-verde-escuro">Onde cada campo é editado</h3>
          <p className="mt-1">
            Alias, unidade de negócio, centro de custo e ambiente são editados aqui, com{" "}
            <span className="veri-numero">settings:accounts</span>. Fechamento da fatura e
            situação de pagamento são editados em{" "}
            <a href="/dashboard/billing" className="underline">
              Faturamento
            </a>
            , com <span className="veri-numero">billing:manage</span> — deixá-los editáveis
            nas duas telas faria uma permissão alterar dado que pertence à outra.
          </p>
        </div>
      </div>
    </details>
  );
}
