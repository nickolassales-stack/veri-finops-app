import { Suspense } from "react";

import { PainelExecutivo } from "@/components/dashboard/painel-executivo";
import { Carregando } from "@/components/ui/estado";
import { getEnv } from "@/lib/env";

/**
 * /dashboard -- visao executiva.
 *
 * A rota vive sob `(privado)`, cujo layout valida a sessao CONTRA O BANCO antes
 * de renderizar qualquer coisa. Sem sessao, o usuario e redirecionado para
 * /login?next=%2Fdashboard e nao chega aqui.
 *
 * Esta pagina e um Server Component fino de proposito: ela resolve apenas o
 * fuso de exibicao (que vem do ambiente) e entrega o painel. Todo o dado e
 * carregado pelo cliente a partir dos endpoints protegidos -- o navegador nunca
 * fala com o PostgreSQL, e a credencial do banco nao sai do servidor.
 *
 * O motivo de o carregamento ser no cliente, e nao no servidor: os filtros sao
 * globais e interativos. Resolvendo no cliente, trocar de periodo atualiza os
 * numeros sem recarregar a pagina inteira, e cada bloco exibe o proprio estado
 * de carregando/erro/vazio.
 */

export const metadata = { title: "Visão executiva" };

export default function DashboardPage() {
  // APP_TZ e configuracao de servidor. Passar como prop evita que o cliente
  // precise adivinhar o fuso pelo relogio do navegador.
  let tz = "America/Sao_Paulo";
  try {
    tz = getEnv().APP_TZ;
  } catch {
    // Ambiente incompleto: o fuso padrao serve, e o erro real de configuracao
    // aparece nas chamadas de API, com mensagem propria.
  }

  return (
    // `useSearchParams` no cliente exige fronteira de Suspense.
    <Suspense fallback={<Carregando altura="h-96" rotulo="Carregando painel" />}>
      <PainelExecutivo tz={tz} />
    </Suspense>
  );
}
