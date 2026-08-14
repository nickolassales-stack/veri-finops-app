import { Aviso } from "@/components/ui/aviso";
import type { Alerta } from "@/lib/diagnostico/etl";

/**
 * Os alertas do pipeline.
 *
 * A AUSENCIA DE ALERTA E UMA AFIRMACAO, e por isso ela e escrita por extenso em
 * vez de deixar um espaco vazio. Espaco vazio numa tela de diagnostico se le de
 * duas formas -- "esta tudo bem" e "isto aqui nao carregou" --, e as duas levam
 * a decisoes opostas.
 */

export function ListaAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) {
    return (
      <Aviso tom="info" titulo="Nenhum alerta">
        <p>
          A carga rodou no horário, todas as contas têm dado no mês corrente e nenhuma
          está parada. As verificações foram feitas agora, nesta requisição.
        </p>
      </Aviso>
    );
  }

  return (
    <div className="space-y-3">
      {alertas.map((a) => (
        <Aviso
          key={a.chave}
          tom={a.tom === "critico" ? "critico" : a.tom === "atencao" ? "atencao" : "info"}
          titulo={a.titulo}
        >
          <p>{a.detalhe}</p>
        </Aviso>
      ))}
    </div>
  );
}
