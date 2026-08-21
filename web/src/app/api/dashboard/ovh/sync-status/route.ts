import { rotaComPermissao } from "@/lib/api/rota";
import { ROTULO_SITUACAO_COLLECTOR, tomDaSituacao } from "@/lib/dashboard/ovh";
import { decidirSituacaoOvh } from "@/lib/diagnostico/ovh";
import { getContasOvh, ovhInstaladoNoBanco } from "@/lib/queries/dashboard-ovh";
import {
  getExecucoesOvh,
  getUltimoSucessoOvh,
  type ExecucaoOvh,
} from "@/lib/queries/ovh";

/**
 * GET /api/dashboard/ovh/sync-status -- ultima sincronizacao e saude do collector.
 *
 * Reaproveita `decidirSituacaoOvh` do diagnostico DE PROPOSITO, em vez de
 * reimplementar a regra. Se o painel executivo dissesse "coleta em dia" enquanto
 * /dashboard/diagnostico diz "a ultima coleta falhou", a tela cuja funcao e
 * atestar a qualidade do dado seria a primeira a discordar da que o exibe.
 *
 * Alem da saude do collector, devolve as contas OVH integradas -- a procedencia
 * dos numeros. `nichandle` fica de fora: ver `getContasOvh`.
 *
 * O `error_message` NAO sai neste endpoint. Ele ja vem sanitizado do collector,
 * mas o painel executivo nao e o lugar de exibir stack -- quem precisa do detalhe
 * abre o diagnostico, que tem largura e contexto para isso.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = rotaComPermissao(
  "GET /api/dashboard/ovh/sync-status",
  "dashboard:view",
  async () => {
    if (!(await ovhInstaladoNoBanco())) {
      return {
        dados: {
          situacao: "nao_instalado",
          rotulo: ROTULO_SITUACAO_COLLECTOR.nao_instalado,
          tom: tomDaSituacao("nao_instalado"),
          ultima: null,
          ultimoSucesso: null,
          contas: [],
        },
        meta: {},
      };
    }

    // UM instante para as duas decisoes: duas leituras de relogio poderiam
    // classificar a mesma execucao de dois jeitos dentro da mesma tela.
    const agora = new Date();

    // `getExecucoesOvh(1)` e nao o historico inteiro: o painel executivo mostra
    // um card, nao a tabela de execucoes.
    // `getContasOvh()` entra no MESMO Promise.all: as tres leituras sao
    // independentes e somar latencia entre elas atrasaria o card sem motivo.
    const [ultimas, ultimoSucesso, contas] = await Promise.all([
      getExecucoesOvh(1),
      getUltimoSucessoOvh(),
      getContasOvh(),
    ]);

    // Anotacao explicita, e nao `ultimas[0] ?? null`: `noUncheckedIndexedAccess`
    // esta desligado neste tsconfig, entao `ultimas[0]` e tipado como
    // nao-nulo e o `?? null` seria descartado pelo compilador -- o tipo viraria
    // `ExecucaoOvh` e o `null` de verdade (lista vazia) passaria sem checagem.
    const ultima: ExecucaoOvh | null = ultimas.length > 0 ? ultimas[0] : null;
    const situacao = decidirSituacaoOvh(ultima, ultimoSucesso, agora);

    const resumir = (e: ExecucaoOvh | null) =>
      e === null
        ? null
        : {
            id: e.id,
            status: e.status,
            source: e.source,
            startedAt: e.startedAt,
            finishedAt: e.finishedAt,
            costRows: e.costRows,
            invoiceRows: e.invoiceRows,
          };

    return {
      dados: {
        situacao,
        rotulo: ROTULO_SITUACAO_COLLECTOR[situacao],
        tom: tomDaSituacao(situacao),
        ultima: resumir(ultima),
        ultimoSucesso: resumir(ultimoSucesso),
        // Procedencia: DE QUAL conta OVH vieram os numeros da visao. Com uma
        // conta unica parece redundante; e o que impede a tela de afirmar
        // "custos OVH" sem dizer de quem no dia em que houver a segunda.
        contas,
      },
      meta: { agora: agora.toISOString() },
    };
  },
);
