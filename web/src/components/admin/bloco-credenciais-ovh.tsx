"use client";

import { useState } from "react";

import { Botao } from "@/components/ui/botao";
import { Campo, Selecao } from "@/components/ui/campo";
import { ErroDoBloco } from "@/components/ui/estado";
import { escrever, escreverComMeta, ler, mensagemDoErro, remover } from "@/lib/admin/cliente";
import {
  ENDPOINTS_OVH,
  ROTULO_ENDPOINT,
  URL_CRIAR_TOKEN,
  type EndpointOvh,
} from "@/lib/ovh/endpoints";

/**
 * Bloco "Credenciais OVH" -- so aparece em conta com provider ovh, e so para
 * ADMIN.
 *
 * ---------------------------------------------------------------------------
 * ESCONDER ESTE BLOCO NAO E A PROTECAO
 *
 * A protecao esta em `rotaSomenteAdmin`, no servidor: um VIEWER que monte a
 * requisicao a mao recebe 403, e a listagem nao devolve o campo `credencial`
 * para quem nao e ADMIN. O bloco nao ser renderizado serve a outra coisa --
 * evitar oferecer um formulario cujo envio vai ser recusado.
 *
 * ---------------------------------------------------------------------------
 * OS CAMPOS DE SEGREDO NASCEM VAZIOS, SEMPRE
 *
 * Nao ha valor para pre-preencher: o servidor nunca devolve o segredo, so a
 * mascara. Vazio significa "mantenha o que esta gravado" -- e a mascara ao lado
 * do rotulo e o que informa QUAL credencial esta valendo.
 *
 * Sem essa regra, abrir o formulario para trocar o endpoint e salvar apagaria a
 * credencial: os tres campos chegariam em branco ao servidor.
 */

/** Espelha `JobSync` de lib/queries/admin/jobs-sync.ts. Sem segredo algum. */
export type JobColeta = {
  id: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  requestedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  syncRunId: string | null;
};

const ROTULO_JOB: Record<JobColeta["status"], string> = {
  queued: "coleta enfileirada",
  running: "coleta em execução",
  success: "coleta concluída",
  failed: "coleta falhou",
  cancelled: "coleta cancelada",
};

export type CredencialVisivel = {
  accountId: string;
  endpoint: string;
  status: "nao_validado" | "conectado" | "invalido";
  applicationKeyMascarada: string | null;
  consumerKeyMascarada: string | null;
  temApplicationSecret: boolean;
  ultimaValidacao: string | null;
  ultimoErro: string | null;
  atualizadaEm: string;
};

type ResultadoTeste = {
  ok: boolean;
  status: CredencialVisivel["status"];
  mensagem: string;
  nichandle: string | null;
  credencial: CredencialVisivel | null;
};

const ROTULO_STATUS: Record<CredencialVisivel["status"], string> = {
  nao_validado: "Não configurado",
  conectado: "Conectado",
  invalido: "Inválido",
};

/**
 * O selo carrega TEXTO, nao apenas cor. Mostarda e vinho ficam reservados a
 * status no brandbook, mas cor sozinha nao e leitura -- quem tem deficiencia de
 * visao de cores precisa do rotulo, e ele esta ali.
 */
const ESTILO_STATUS: Record<CredencialVisivel["status"], string> = {
  conectado: "border-veri-verde/50 bg-veri-verde/12 text-veri-verde-escuro",
  invalido: "border-veri-vinho/40 bg-veri-vinho/10 text-veri-vinho",
  nao_validado: "border-veri-offwhite bg-veri-offwhite text-texto-suave",
};

function SeloStatus({ status }: { status: CredencialVisivel["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ESTILO_STATUS[status]}`}
    >
      {ROTULO_STATUS[status]}
    </span>
  );
}

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function BlocoCredenciaisOvh({
  accountId,
  credencial,
  ultimaSincronizacao,
  aoMudar,
}: {
  accountId: string;
  credencial: CredencialVisivel | null;
  /** Vem de `ovh_sync_runs`, nao da credencial -- ver o comentario no rodape. */
  ultimaSincronizacao: string | null;
  aoMudar: (nova: CredencialVisivel | null) => void;
}) {
  const configurada = credencial !== null;

  const [endpoint, setEndpoint] = useState<EndpointOvh>(
    (credencial?.endpoint as EndpointOvh) ?? "ovh-ca",
  );
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [consumerKey, setConsumerKey] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [teste, setTeste] = useState<ResultadoTeste | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [enfileirando, setEnfileirando] = useState(false);
  const [job, setJob] = useState<JobColeta | null>(null);
  const [jobAviso, setJobAviso] = useState<string | null>(null);

  const base = `/api/admin/accounts/${encodeURIComponent(accountId)}/credentials`;

  /** Corpo comum de salvar e testar. Campo vazio sai como `null` = mantenha. */
  const corpo = () => ({
    endpoint,
    applicationKey: appKey.trim() || null,
    applicationSecret: appSecret.trim() || null,
    consumerKey: consumerKey.trim() || null,
  });

  function limparCampos() {
    setAppKey("");
    setAppSecret("");
    setConsumerKey("");
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    setAviso(null);
    setSalvo(false);
    setTeste(null);

    try {
      const resposta = await escreverComMeta<
        CredencialVisivel,
        { avisoContasDuplicadas?: string[] }
      >(base, "PUT", corpo());
      // Os campos sao esvaziados apos salvar. Deixar o segredo digitado na tela
      // o mantem em memoria do navegador e no DOM sem necessidade -- e um
      // segundo "Salvar" acidental reenviaria o mesmo valor.
      limparCampos();
      setSalvo(true);
      aoMudar(resposta.dados);

      const duplicadas = resposta.meta?.avisoContasDuplicadas ?? [];
      if (duplicadas.length > 0) {
        setAviso(
          `Esta mesma Application Key já está cadastrada em: ${duplicadas.join(", ")}. ` +
            "Duas contas com a mesma chave coletam a MESMA conta da OVH — confira se é intencional.",
        );
      }
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setErro(null);
    setTeste(null);

    try {
      const resultado = await escrever<ResultadoTeste>(`${base}/test`, "POST", corpo());
      setTeste(resultado);
      // O teste atualiza status e data no banco quando ja havia cadastro.
      if (resultado.credencial) aoMudar(resultado.credencial);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setTestando(false);
    }
  }

  /**
   * Salva, testa e enfileira -- nessa ordem, e a ordem importa.
   *
   * Enfileirar sem testar criaria um job destinado a falhar, e a tela mostraria
   * "coleta enfileirada" seguida de erro alguns minutos depois. Testar primeiro
   * troca isso por um erro imediato, com a causa em maos.
   *
   * Salvar acontece de todo jeito. Se a OVH estiver fora do ar, a credencial fica
   * gravada e so o disparo e recusado: perder o que foi digitado por causa de uma
   * indisponibilidade do provedor seria o pior desfecho.
   */
  async function salvarEColetar() {
    setEnfileirando(true);
    setErro(null);
    setAviso(null);
    setSalvo(false);
    setTeste(null);
    setJobAviso(null);

    try {
      const corpoAtual = corpo();

      const gravada = await escreverComMeta<
        CredencialVisivel,
        { avisoContasDuplicadas?: string[] }
      >(base, "PUT", corpoAtual);
      limparCampos();
      setSalvo(true);
      aoMudar(gravada.dados);

      // Testa com os valores DIGITADOS, nao com os campos ja limpos: `corpoAtual`
      // foi capturado antes de `limparCampos`.
      const resultado = await escrever<ResultadoTeste>(
        `${base}/test`,
        "POST",
        corpoAtual,
      );
      setTeste(resultado);
      if (resultado.credencial) aoMudar(resultado.credencial);

      if (!resultado.ok) {
        setJobAviso(
          "Credenciais salvas, mas a OVH recusou a conexão — a coleta não foi " +
            "enfileirada. Corrija a credencial e tente de novo.",
        );
        return;
      }

      const { job: criadoJob, criado } = await escrever<{
        job: JobColeta;
        criado: boolean;
      }>(`${base}/sync`, "POST", { action: "first_sync" });
      setJob(criadoJob);
      setJobAviso(
        criado
          ? null
          : "Já havia uma coleta na fila para esta conta; o pedido foi atendido pela existente.",
      );
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setEnfileirando(false);
    }
  }

  /** Le o estado atual da fila. Chamado a mao pelo botao "Atualizar". */
  async function atualizarJob() {
    try {
      // `ler` devolve o envelope `{ dados, meta }` -- ao contrario de `escrever`,
      // que ja desembrulha.
      const { dados: estado } = await ler<{
        ativo: JobColeta | null;
        ultimo: JobColeta | null;
        disponivel: boolean;
      }>(`${base}/sync`);
      if (!estado.disponivel) {
        setJobAviso(
          "A fila de coleta não existe neste ambiente (migração 008 não aplicada).",
        );
        return;
      }
      // Ativo primeiro: enquanto um job esta na fila, o ultimo resultado ainda e
      // o da execucao ANTERIOR, e mostrar o ultimo faria a tela dizer "falhou"
      // durante uma coleta que esta correndo bem.
      setJob(estado.ativo ?? estado.ultimo);
      setJobAviso(null);
    } catch (e) {
      setJobAviso(mensagemDoErro(e));
    }
  }

  async function apagar() {
    setRemovendo(true);
    setErro(null);
    setTeste(null);
    setSalvo(false);

    try {
      await remover(base);
      limparCampos();
      aoMudar(null);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-veri-offwhite bg-veri-offwhite/30 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="veri-display text-base text-veri-verde-escuro">Credenciais OVH</h3>
        <SeloStatus status={credencial?.status ?? "nao_validado"} />
      </header>

      {/* ------------------------------------------------- o que esta gravado */}
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">Endpoint</dt>
          <dd className="veri-numero mt-0.5 text-veri-verde-escuro">
            {credencial?.endpoint ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">
            Application Key
          </dt>
          <dd className="veri-numero mt-0.5 text-veri-verde-escuro">
            {credencial === null
              ? "—"
              : (credencial.applicationKeyMascarada ?? (
                  <span className="text-veri-vinho">não foi possível ler</span>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">Consumer Key</dt>
          <dd className="veri-numero mt-0.5 text-veri-verde-escuro">
            {credencial === null
              ? "—"
              : (credencial.consumerKeyMascarada ?? (
                  <span className="text-veri-vinho">não foi possível ler</span>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">
            Application Secret
          </dt>
          {/* Nunca mascarado. Dele a tela sabe somente se existe: os outros dois
              sao identificadores do lado da OVH, este e a senha. */}
          <dd className="mt-0.5 text-veri-verde-escuro">
            {credencial?.temApplicationSecret ? "gravado (nunca exibido)" : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">
            Última validação
          </dt>
          <dd className="veri-numero mt-0.5 text-veri-verde-escuro">
            {dataHora(credencial?.ultimaValidacao ?? null)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-texto-suave">
            Última sincronização
          </dt>
          <dd className="veri-numero mt-0.5 text-veri-verde-escuro">
            {dataHora(ultimaSincronizacao)}
          </dd>
        </div>
      </dl>

      {credencial?.ultimoErro && credencial.status === "invalido" && (
        <p className="mt-3 rounded-lg border border-veri-vinho/30 bg-veri-vinho/5 px-4 py-2 text-xs leading-relaxed text-veri-vinho">
          {credencial.ultimoErro}
        </p>
      )}

      {credencial !== null &&
        credencial.applicationKeyMascarada === null &&
        credencial.consumerKeyMascarada === null && (
          <p className="mt-3 rounded-lg border border-veri-vinho/30 bg-veri-vinho/5 px-4 py-2 text-xs leading-relaxed text-veri-vinho">
            Existe credencial gravada, mas o portal não consegue decifrá-la. O sintoma é
            de <strong>APP_CREDENTIALS_ENCRYPTION_KEY trocada</strong> — a credencial foi
            cifrada com outra chave. Restaure a chave anterior ou cadastre a credencial de
            novo.
          </p>
        )}

      {/* ---------------------------------------------------------- formulario */}
      <form onSubmit={salvar} className="mt-5 space-y-4">
        <Selecao
          rotulo="Endpoint"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value as EndpointOvh)}
          ajuda={
            <>
              As três regiões são <strong>contas separadas</strong> na OVH. A credencial
              vale só onde foi criada — criar em{" "}
              <a
                href={URL_CRIAR_TOKEN[endpoint]}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {URL_CRIAR_TOKEN[endpoint]}
              </a>
            </>
          }
        >
          {ENDPOINTS_OVH.map((e) => (
            <option key={e} value={e}>
              {ROTULO_ENDPOINT[e]}
            </option>
          ))}
        </Selecao>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Application Key"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            maxLength={512}
            autoComplete="off"
            spellCheck={false}
            placeholder={configurada ? "manter a atual" : ""}
          />
          <Campo
            rotulo="Consumer Key"
            value={consumerKey}
            onChange={(e) => setConsumerKey(e.target.value)}
            maxLength={512}
            autoComplete="off"
            spellCheck={false}
            placeholder={configurada ? "manter a atual" : ""}
          />
        </div>

        <Campo
          rotulo="Application Secret"
          // `password` e nao `text`: e o unico dos tres que e senha, e o campo
          // fica aberto em tela compartilhada durante um cadastro.
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          maxLength={512}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={configurada ? "manter o atual" : ""}
          ajuda={
            configurada
              ? "Deixe em branco para manter o secret gravado. Preencha só para substituí-lo."
              : "Aparece uma única vez no console da OVH, no momento da criação."
          }
        />

        {erro && <ErroDoBloco titulo="Não foi possível concluir" mensagem={erro} />}

        {aviso && (
          <p
            role="status"
            className="rounded-lg border border-veri-mostarda/40 bg-veri-mostarda/10 px-4 py-2 text-xs leading-relaxed text-veri-verde-escuro"
          >
            {aviso}
          </p>
        )}

        {salvo && !erro && (
          <p role="status" className="text-sm font-medium text-veri-verde-escuro">
            Credenciais salvas e cifradas. O status voltou para{" "}
            <strong>não validado</strong> — credencial nova nunca foi testada. Use{" "}
            <strong>Testar conexão</strong> para confirmar.
          </p>
        )}

        {teste && (
          <p
            role="status"
            className={`rounded-lg border px-4 py-2 text-sm leading-relaxed ${
              teste.ok
                ? "border-veri-verde/40 bg-veri-verde/10 text-veri-verde-escuro"
                : "border-veri-vinho/30 bg-veri-vinho/5 text-veri-vinho"
            }`}
          >
            {teste.mensagem}
          </p>
        )}

        {jobAviso && (
          <p
            role="status"
            className="rounded-lg border border-veri-mostarda/40 bg-veri-mostarda/10 px-4 py-2 text-xs leading-relaxed text-veri-verde-escuro"
          >
            {jobAviso}
          </p>
        )}

        {job && (
          <div
            role="status"
            className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
              job.status === "success"
                ? "border-veri-verde/40 bg-veri-verde/10 text-veri-verde-escuro"
                : job.status === "failed" || job.status === "cancelled"
                  ? "border-veri-vinho/30 bg-veri-vinho/5 text-veri-vinho"
                  : "border-veri-mostarda/40 bg-veri-mostarda/10 text-veri-verde-escuro"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{ROTULO_JOB[job.status]}</strong>
              <span className="veri-numero text-xs text-texto-suave">
                job {job.id}
                {job.syncRunId && ` · ovh_sync_runs ${job.syncRunId}`}
              </span>
            </div>
            {(job.status === "queued" || job.status === "running") && (
              <p className="mt-1 text-xs leading-relaxed">
                O worker no servidor processa a fila a cada minuto. Esta tela não
                atualiza sozinha — use <strong>Atualizar status</strong>.
              </p>
            )}
            {job.errorMessage && (
              <p className="mt-1 text-xs leading-relaxed">{job.errorMessage}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Botao type="submit" carregando={salvando}>
            Salvar credenciais
          </Botao>
          <Botao
            type="button"
            carregando={enfileirando}
            onClick={() => void salvarEColetar()}
            // Mesma regra do teste: sem cadastro e sem os tres campos nao ha o que
            // salvar nem o que coletar.
            disabled={
              !configurada &&
              !(appKey.trim() && appSecret.trim() && consumerKey.trim())
            }
          >
            Salvar e executar primeira coleta
          </Botao>
          <Botao
            type="button"
            tom="secundario"
            carregando={testando}
            onClick={() => void testar()}
            // Sem cadastro E sem os tres campos preenchidos nao ha o que testar.
            // Desabilitar aqui evita uma ida ao servidor que voltaria 400.
            disabled={
              !configurada &&
              !(appKey.trim() && appSecret.trim() && consumerKey.trim())
            }
          >
            Testar conexão
          </Botao>
          {configurada && (
            <Botao
              type="button"
              tom="secundario"
              onClick={() => void atualizarJob()}
            >
              Atualizar status
            </Botao>
          )}
          {configurada && (
            <Botao
              type="button"
              tom="perigo"
              carregando={removendo}
              onClick={() => void apagar()}
            >
              Remover credenciais
            </Botao>
          )}
        </div>
      </form>

      <p className="mt-4 border-t border-veri-offwhite pt-3 text-xs leading-relaxed text-texto-suave">
        As credenciais são gravadas <strong>cifradas</strong> (AES-256-GCM) e nunca voltam
        para esta tela — só a máscara dos quatro últimos caracteres. A chave de cifragem
        vive no ambiente do servidor, não no banco.{" "}
        <strong>Última sincronização</strong> vem de{" "}
        <span className="veri-numero">ovh_sync_runs</span> e é do collector.{" "}
        <strong>Salvar credenciais</strong> não dispara coleta;{" "}
        <strong>Salvar e executar primeira coleta</strong> enfileira um pedido em{" "}
        <span className="veri-numero">cloud_sync_jobs</span> que o worker do servidor
        atende — esta tela nunca executa comando.
      </p>
    </section>
  );
}
