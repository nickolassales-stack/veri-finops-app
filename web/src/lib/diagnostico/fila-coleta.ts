import type { AlertaOvh } from "./ovh";

/**
 * A fila de coleta está andando? — inferido do próprio banco.
 *
 * ---------------------------------------------------------------------------
 * O PORTAL NÃO ENXERGA O CRON, E NÃO PRECISA
 *
 * O worker (`run-cloud-sync-jobs.sh`) roda no host, fora do container. O portal
 * não lê o crontab da EC2 e não deve poder — ler o agendador do host a partir de
 * um processo que atende HTTP público é exatamente o tipo de acesso que a fila
 * existe para evitar.
 *
 * Mas ele não precisa. O sintoma é observável de dentro do banco: job em
 * `queued` que ENVELHECE é job que ninguém pegou. Isso não é um palpite sobre a
 * infraestrutura — é a leitura direta da consequência.
 *
 * Sem este alerta, um worker ausente é invisível da pior forma possível: o botão
 * de coleta responde "enfileirada com sucesso", a tela mostra o job em `queued`,
 * e nada acontece — nem naquele minuto nem nunca. O usuário conclui que a coleta
 * está lenta e espera. É o mesmo tipo de sucesso invisível que a migração 009
 * corrigiu do outro lado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SÓ `queued`, E NÃO `running`
 *
 * `running` velho é outro problema — o collector travou no meio — e ele JÁ TEM
 * dono: `reabrir_orfaos` devolve à fila o que passou de `MINUTOS_ORFAO` (30).
 * Alertar aqui sobre `running` competiria com uma recuperação automática que
 * está em curso, e mandaria investigar o que vai se resolver sozinho.
 *
 * `queued` velho não tem dono nenhum: não há processo para reabrir o que nunca
 * foi reivindicado.
 */

export type JobNaFila = {
  accountId: string;
  status: string;
  /** ISO-8601, como vem de `JobSync.requestedAt`. */
  requestedAt: string;
};

/**
 * A partir de quantos minutos em `queued` a fila é considerada parada.
 *
 * O worker é feito para rodar de poucos em poucos minutos. Quinze é folgado o
 * bastante para não acusar um worker apenas ocupado com outra conta — a trava
 * por conta serializa, e uma coleta OVH inteira leva minutos — e curto o
 * bastante para que quem clicou no botão e voltou à tela ainda esteja lá.
 */
export const MINUTOS_SEM_WORKER = 15;

export function minutosDesde(iso: string, agora: Date): number {
  return (agora.getTime() - new Date(iso).getTime()) / 60_000;
}

/**
 * Devolve o alerta de fila parada, ou `null` quando ela está andando.
 *
 * `atencao` e não `critico`: nada foi PERDIDO. O job continua em `queued` e será
 * processado assim que o worker voltar — a fila é durável, essa é a razão de ela
 * existir. O que está errado é a expectativa de que já tenha rodado.
 */
export function avaliarFilaParada(
  jobs: JobNaFila[],
  agora: Date,
): AlertaOvh | null {
  const parados = jobs.filter(
    (j) => j.status === "queued" && minutosDesde(j.requestedAt, agora) >= MINUTOS_SEM_WORKER,
  );
  if (parados.length === 0) return null;

  const maisVelho = Math.max(...parados.map((j) => minutosDesde(j.requestedAt, agora)));
  const contas = [...new Set(parados.map((j) => j.accountId))];

  return {
    chave: "fila-coleta-parada",
    tom: "atencao",
    titulo:
      parados.length === 1
        ? "1 coleta enfileirada há mais de " + MINUTOS_SEM_WORKER + " minutos sem ser processada"
        : `${parados.length} coletas enfileiradas há mais de ${MINUTOS_SEM_WORKER} minutos sem serem processadas`,
    detalhe:
      `Aguardando desde ${formatarEspera(maisVelho)}: ${contas.join(", ")}. ` +
      "Quem processa a fila é o worker no host, não o portal — um job em `queued` " +
      "que envelhece significa que nenhum worker o reivindicou. Confira se o " +
      "agendamento existe (`crontab -l | grep cloud-sync-jobs`) e o log em " +
      "/opt/finops/ovh-collector/logs/. Nada foi perdido: a fila é durável e os " +
      "jobs rodam assim que o worker voltar.",
  };
}

/** "18 minutos", "3 horas", "2 dias" — a unidade acompanha a ordem de grandeza. */
function formatarEspera(minutos: number): string {
  const m = Math.floor(minutos);
  if (m < 60) return `${m} minutos`;
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? "1 hora" : `${h} horas`;
  const d = Math.floor(h / 24);
  return `${d} dias`;
}
