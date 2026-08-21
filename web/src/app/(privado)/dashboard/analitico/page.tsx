import { Suspense } from "react";

import { PainelAnalitico } from "@/components/dashboard/painel-analitico";
import { CarregandoLinhas } from "@/components/ui/estado";
import { getEnv } from "@/lib/env";

/**
 * /dashboard/analitico -- lancamentos de custo, linha a linha.
 *
 * Vive sob `(privado)`, cujo layout valida a sessao CONTRA O BANCO antes de
 * renderizar. Sem sessao, o usuario vai para
 * /login?next=%2Fdashboard%2Fanalitico e nao chega aqui.
 *
 * Server Component fino: resolve o fuso e entrega o painel. Os dados vem do
 * endpoint protegido `/api/dashboard/analytic`, que pagina no banco -- nem esta
 * pagina nem o navegador tocam no PostgreSQL.
 */

export const metadata = { title: "Analítico de custos" };

export default function AnaliticoPage() {
  let tz = "America/Sao_Paulo";
  try {
    tz = getEnv().APP_TZ;
  } catch {
    // Ambiente incompleto: o padrao serve, e o erro real de configuracao aparece
    // na chamada da API, com mensagem propria.
  }

  return (
    // `useSearchParams` no cliente exige fronteira de Suspense.
    <Suspense fallback={<CarregandoLinhas linhas={10} />}>
      <PainelAnalitico tz={tz} />
    </Suspense>
  );
}
