/**
 * Saude do collector OVH: o que o estado bruto de `ovh_sync_runs` SIGNIFICA.
 *
 * MODULO PURO, pelo mesmo arranjo de `diagnostico/etl.ts`: recebe o que foi
 * lido e o instante atual, devolve situacao e alertas. Nada aqui abre conexao.
 *
 * Existe separado de `services/ovh.ts` -- que e `server-only` e por isso nao
 * pode ser importado em teste -- para que cada regra seja verificavel. "A
 * ultima coleta falhou" e uma afirmacao que precisa estar certa nos dois
 * minutos em que uma coleta esta correndo, e nao da para esperar a proxima
 * falha real para conferir.
 */

/** Idade a partir da qual a ultima coleta bem-sucedida e considerada velha. */
export const HORAS_PARA_DADO_VELHO = 36;

export type ExecucaoOvhResumida = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
};

export type SituacaoOvh =
  /** Migracao 005 nao aplicada: nao ha nem tabela. */
  | "nao_instalado"
  /** Tabelas existem, nenhuma execucao registrada. */
  | "nunca_executado"
  /** Nenhuma execucao jamais terminou em success. */
  | "nunca_teve_sucesso"
  /** A ultima execucao falhou, mas existe sucesso anterior. */
  | "ultima_falhou"
  /** Ultimo sucesso mais antigo que HORAS_PARA_DADO_VELHO. */
  | "dado_velho"
  /** Ha execucao em andamento agora. */
  | "em_execucao"
  /**
   * A leitura do banco falhou. Nao diz nada sobre a coleta -- so que a TELA nao
   * conseguiu perguntar. Estado distinto de proposito: confundir "nao consegui
   * ler" com "nao ha dado" faria a tela afirmar custo zero por causa de um erro
   * de query.
   */
  | "erro_de_leitura"
  | "ok";

export type AlertaOvh = {
  chave: string;
  tom: "info" | "atencao" | "critico";
  titulo: string;
  detalhe: string;
};

export function horasDesde(iso: string, agora: Date): number {
  return (agora.getTime() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * A ordem dos testes importa.
 *
 * `running` vem antes de qualquer avaliacao de sucesso ou falha: uma coleta em
 * andamento nao e nenhum dos dois, e classifica-la como falha faria a tela
 * alarmar durante os dois minutos normais de uma execucao.
 */
export function decidirSituacaoOvh(
  ultima: ExecucaoOvhResumida | null,
  ultimoSucesso: ExecucaoOvhResumida | null,
  agora: Date,
): SituacaoOvh {
  if (!ultima) return "nunca_executado";
  if (ultima.status === "running") return "em_execucao";
  if (!ultimoSucesso) return "nunca_teve_sucesso";
  if (ultima.status !== "success") return "ultima_falhou";

  const referencia = ultimoSucesso.finishedAt ?? ultimoSucesso.startedAt;
  if (horasDesde(referencia, agora) > HORAS_PARA_DADO_VELHO) return "dado_velho";
  return "ok";
}

export type EntradaAlertasOvh = {
  situacao: SituacaoOvh;
  ultima: ExecucaoOvhResumida | null;
  ultimoSucesso: ExecucaoOvhResumida | null;
  /** `true` quando existe pelo menos uma linha em `ovh_monthly_costs`. */
  temDado: boolean;
  /** `true` quando ja houve execucao com `source='cron'`. */
  teveExecucaoAutomatica: boolean;
  /** `OVH_CRON_INSTALADO`. */
  cronInstalado: boolean;
  agora: Date;
};

export function montarAlertasOvh(e: EntradaAlertasOvh): AlertaOvh[] {
  const alertas: AlertaOvh[] = [];

  switch (e.situacao) {
    case "erro_de_leitura":
      alertas.push({
        chave: "ovh-erro-de-leitura",
        tom: "critico",
        titulo: "Não foi possível ler os dados do collector OVH",
        detalhe:
          "A consulta às tabelas ovh_* falhou. O detalhe está no log do container " +
          "(docker logs finops-portal). Isto não diz nada sobre a coleta em si: o " +
          "collector pode estar funcionando — o que falhou foi esta tela ao " +
          "perguntar. O restante da página não depende disto.",
      });
      break;

    case "nao_instalado":
      alertas.push({
        chave: "ovh-nao-instalado",
        tom: "info",
        titulo: "Integração OVH não instalada",
        detalhe:
          "As tabelas ovh_* não existem neste banco. Rode a migração 005 " +
          "(scripts/migrations/005-ovh-collector.sql) para habilitar a coleta.",
      });
      break;

    case "nunca_executado":
      alertas.push({
        chave: "ovh-nunca-executado",
        tom: "atencao",
        titulo: "Collector OVH nunca executou",
        detalhe:
          "As tabelas existem e estão vazias. Nenhum registro em ovh_sync_runs: o " +
          "collector ainda não rodou nem uma vez.",
      });
      break;

    case "nunca_teve_sucesso":
      alertas.push({
        chave: "ovh-nunca-sucesso",
        tom: "critico",
        titulo: "Collector OVH nunca concluiu com sucesso",
        detalhe:
          "Já houve execução, mas nenhuma terminou em success. Nenhum dado OVH " +
          "nesta tela veio de uma execução completa — trate o que aparece como " +
          "parcial.",
      });
      break;

    case "ultima_falhou":
      alertas.push({
        chave: "ovh-ultima-falhou",
        tom: "critico",
        titulo: "A última coleta OVH falhou",
        detalhe:
          "O dado exibido é do último sucesso, não do agora." +
          (e.ultimoSucesso
            ? ` Última coleta bem-sucedida: execução #${e.ultimoSucesso.id}.`
            : ""),
      });
      break;

    case "dado_velho":
      alertas.push({
        chave: "ovh-dado-velho",
        tom: "atencao",
        titulo: "Dado OVH desatualizado",
        detalhe: e.ultimoSucesso
          ? `A última coleta bem-sucedida foi há ${Math.floor(
              horasDesde(e.ultimoSucesso.finishedAt ?? e.ultimoSucesso.startedAt, e.agora),
            )} horas, acima do limite de ${HORAS_PARA_DADO_VELHO}h.`
          : "Sem coleta recente.",
      });
      break;

    case "em_execucao":
      alertas.push({
        chave: "ovh-em-execucao",
        tom: "info",
        titulo: "Coleta OVH em andamento",
        detalhe:
          "Há uma execução aberta em ovh_sync_runs. Os números podem mudar até ela " +
          "terminar.",
      });
      break;

    case "ok":
      break;
  }

  // Estes dois independem da situacao, mas NAO valem quando a leitura falhou:
  // sem ler, nao se sabe se ha dado nem se houve execucao automatica, e afirmar
  // qualquer um dos dois seria transformar erro de query em fato sobre a coleta.
  if (e.situacao === "erro_de_leitura") return alertas;

  // Coleta que termina em `success` sem trazer linha e caso real -- foi o que
  // aconteceu enquanto a credencial OVH estava invalida. "success" sem dado nao
  // pode ser lido como "custo zero".
  if (e.situacao !== "nao_instalado" && e.situacao !== "nunca_executado" && !e.temDado) {
    alertas.push({
      chave: "ovh-sem-linha",
      tom: "atencao",
      titulo: "Nenhuma linha de custo OVH",
      detalhe:
        "O collector já executou, mas ovh_monthly_costs está vazia. Isto não " +
        "significa custo zero: significa que nada foi importado.",
    });
  }

  // Cron declarado como instalado mas sem nenhuma execucao `source='cron'`:
  // ou ele nunca disparou, ou a variavel esta mentindo. Os dois merecem aviso,
  // porque quem le a tela conclui que a coleta e automatica.
  if (
    e.cronInstalado &&
    !e.teveExecucaoAutomatica &&
    e.situacao !== "nao_instalado"
  ) {
    alertas.push({
      chave: "ovh-sem-execucao-automatica",
      tom: "atencao",
      titulo: "Cron instalado, mas nenhuma execução automática registrada",
      detalhe:
        "OVH_CRON_INSTALADO=true e não há linha com source='cron' em " +
        "ovh_sync_runs. Ou o cron ainda não chegou no horário desde a " +
        "instalação, ou ele não está disparando. O log em " +
        "/opt/finops/ovh-collector/logs/cron.log é o primeiro lugar a olhar.",
    });
  }

  return alertas;
}
