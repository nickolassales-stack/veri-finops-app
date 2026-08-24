import { Aviso } from "@/components/ui/aviso";
import { Card } from "@/components/ui/card";

/**
 * O lugar de uma seção que não carregou.
 *
 * Ela OCUPA O ESPAÇO em vez de sumir. Uma seção que desaparece em silêncio é
 * pior do que uma seção com erro: quem conhece a tela procura o quadro que
 * sumiu, e quem não conhece nem sabe que faltou algo. Aqui o quadro continua,
 * com o título de sempre, dizendo o que não deu.
 *
 * A mensagem técnica aparece na tela porque esta é a tela de diagnóstico —
 * quem a abriu está investigando, e mandá-lo ao `docker logs` para ler o que já
 * está aqui só acrescenta um passo. Ela chega sanitizada de `tentarSecao`.
 */
export function SecaoIndisponivel({
  titulo,
  erro,
  consequencia,
}: {
  titulo: string;
  /** Mensagem já sanitizada. */
  erro: string;
  /** O que o usuário perde por esta seção estar fora. */
  consequencia: string;
}) {
  return (
    <Card titulo={titulo}>
      <Aviso tom="critico" titulo="Esta seção não pôde ser carregada">
        <p>{consequencia}</p>
        <p className="veri-numero break-words text-xs">{erro}</p>
        <p className="text-xs">
          As demais seções desta página seguem válidas — a falha está isolada aqui.
        </p>
      </Aviso>
    </Card>
  );
}
