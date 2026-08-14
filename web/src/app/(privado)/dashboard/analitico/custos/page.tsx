import { Suspense } from "react";

import { PainelHistorico } from "@/components/dashboard/painel-historico";
import { CarregandoLinhas } from "@/components/ui/estado";
import { podeAtual } from "@/lib/auth/autorizacao";
import { getEnv } from "@/lib/env";

/**
 * /dashboard/analitico/custos -- historico mensal de custo por conta.
 *
 * `analytic:view` ja foi exigida no layout da area analitica. Aqui so
 * resolvemos duas coisas que o cliente nao pode decidir sozinho: o fuso e se
 * este usuario pode exportar.
 *
 * `podeExportar` controla apenas a EXIBICAO dos botoes. A recusa de verdade
 * esta em `rotaComPermissaoArquivo("analytic:export")`, nas rotas de arquivo --
 * quem montar a URL na mao esbarra nela igual.
 */

export const metadata = { title: "Histórico de custos" };

export default async function HistoricoDeCustosPage() {
  const podeExportar = await podeAtual("analytic:export");

  let tz = "America/Sao_Paulo";
  try {
    tz = getEnv().APP_TZ;
  } catch {
    // Ambiente incompleto: o padrao serve, e o erro real de configuracao
    // aparece na chamada da API, com mensagem propria.
  }

  return (
    // `useSearchParams` no cliente exige fronteira de Suspense.
    <Suspense fallback={<CarregandoLinhas linhas={10} />}>
      <PainelHistorico tz={tz} podeExportar={podeExportar} />
    </Suspense>
  );
}
