import { ehProvider } from "@/lib/filtros/esquemas";

/**
 * Selo de provedor: AWS ou OVH.
 *
 * O rotulo E a informacao -- "AWS" escrito por extenso. A cor apenas acompanha,
 * e por isso este selo nao precisa do simbolo que o `SeloPagamento` carrega: ali
 * a cor competia com o significado ("Pago" verde x "Vencido" vinho), aqui o
 * texto ja diz tudo e nao existe leitura possivel da cor sozinha.
 *
 * Provedor desconhecido aparece como esta gravado no banco, em tom neutro, em
 * vez de virar "AWS" por omissao. A coluna e `text` livre: se alguem inserir
 * 'azure' na mao, a tela precisa mostrar 'azure' -- silenciar isso faria uma
 * conta sem tabela de custo se passar por conta AWS.
 */

const ESTILO: Record<string, string> = {
  aws: "border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro",
  ovh: "border-veri-verde-claro/60 bg-veri-rosa/20 text-veri-verde-escuro",
};

const NEUTRO = "border-veri-offwhite bg-veri-offwhite text-texto-suave";

export function SeloProvider({ provider }: { provider: string }) {
  const chave = provider.toLowerCase();
  const conhecido = ehProvider(chave);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
        conhecido ? ESTILO[chave] : NEUTRO
      }`}
      title={conhecido ? undefined : `Provedor nao reconhecido pela aplicacao: ${provider}`}
    >
      {conhecido ? chave.toUpperCase() : provider}
    </span>
  );
}
