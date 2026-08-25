import "server-only";

import { ErroDeApi, ErroDeValidacao } from "@/lib/api/http";
import {
  cifragemDisponivel,
  cifrar,
  decifrar,
  ErroDeCripto,
  impressaoDigital,
  mascarar,
  type ContextoSegredo,
} from "@/lib/cripto/segredos";
import {
  motivoRecusaDeProvider,
  planejarGravacao,
  type PlanoCredencial,
} from "@/lib/credenciais/plano";
import type {
  EntradaColetaOvh,
  EntradaCredencialOvh,
  EntradaNovaContaOvh,
} from "@/lib/filtros/esquemas-credenciais";
import { ehEndpointOvh, type EndpointOvh } from "@/lib/ovh/endpoints";
import { sanitizar, validarCredencialOvh } from "@/lib/ovh/api";
import {
  enfileirarColeta,
  existeJobParado,
  filaDisponivel,
  jobAtivoDaConta,
  ultimoJobDaConta,
  type AcaoJob,
  type JobSync,
} from "@/lib/queries/admin/jobs-sync";
// A MESMA constante do Diagnostico: se as duas telas usassem limiares
// diferentes, uma diria "worker parado" enquanto a outra diz que esta tudo bem.
import { MINUTOS_SEM_WORKER } from "@/lib/diagnostico/fila-coleta";
import {
  apagarCredencial,
  contasComMesmaChave,
  credenciaisDisponiveis,
  getCredenciaisPorConta,
  getCredencialEnvelope,
  gravarCredencial,
  registrarValidacao,
  type LinhaCredencialEnvelope,
  type StatusCredencial,
} from "@/lib/queries/admin/credenciais";
import {
  criarConta,
  listarContasAdministraveis,
  type ContaAdministravel,
} from "@/lib/queries/admin/contas";
import type { ContaCredencial } from "@/lib/diagnostico/credenciais-ovh";

/**
 * Servicos de credencial OVH -- a camada que cifra, decifra e decide.
 *
 * ---------------------------------------------------------------------------
 * A UNICA CAMADA QUE VE SEGREDO EM CLARO
 *
 * Acima daqui (rotas, tela) circulam mascara e status. Abaixo (queries) circulam
 * envelopes. O texto claro existe apenas dentro das funcoes deste arquivo, e
 * nunca em retorno: nenhuma funcao exportada devolve um segredo.
 *
 * ---------------------------------------------------------------------------
 * NADA AQUI VAI PARA LOG
 *
 * Nao ha um unico `console.log` neste modulo, e a ausencia e a regra: log de
 * credencial e o vazamento mais comum que existe, e ja aconteceu neste projeto
 * -- a senha do `finops_app` foi rotacionada em 20/08/2026 porque apareceu num
 * transcript. Erro que sobe daqui carrega mensagem redigida a mao, nunca o valor.
 */

const PROVIDER = "ovh";

function contexto(
  accountId: string,
  campo: ContextoSegredo["campo"],
): ContextoSegredo {
  return { provider: PROVIDER, accountId, campo };
}

/**
 * Traduz falha de cripto para erro de API com instrucao.
 *
 * `ErroDeCripto` chega em dois momentos muito diferentes -- chave ausente no
 * ambiente e envelope que nao decifra -- e a acao do outro lado nao e a mesma.
 * Deixar os dois virarem "erro interno" mandaria o operador procurar no lugar
 * errado.
 */
function traduzirCripto(err: unknown): never {
  if (err instanceof ErroDeCripto) {
    throw new ErroDeApi("configuracao-invalida", err.message);
  }
  throw err;
}

function exigirCifragem(): void {
  if (!cifragemDisponivel()) {
    throw new ErroDeApi(
      "configuracao-invalida",
      "A cifragem de credenciais nao esta configurada neste ambiente: falta " +
        "APP_CREDENTIALS_ENCRYPTION_KEY (base64 de 32 bytes). Sem ela o portal se " +
        "recusa a gravar credencial -- gravar em claro nao e alternativa.",
    );
  }
}

async function exigirTabela(): Promise<void> {
  if (!(await credenciaisDisponiveis())) {
    throw new ErroDeApi(
      "banco-indisponivel",
      "A tabela de credenciais ainda nao existe. Rode " +
        "scripts/migrations/006-credenciais-provedor.sql.",
    );
  }
}

/**
 * Exige que a conta exista E seja OVH.
 *
 * A checagem de provider e o coracao do requisito "para AWS, nao mostrar bloco de
 * credenciais OVH", e ela precisa estar no SERVIDOR: esconder o bloco na tela
 * nao impede um POST montado a mao. Sem isto, seria possivel cadastrar credencial
 * OVH numa conta AWS -- e o collector, ao ler por conta, tentaria coletar OVH de
 * uma conta que nao existe na OVH.
 */
async function exigirContaOvh(accountId: string): Promise<ContaAdministravel> {
  const conta = (await listarContasAdministraveis()).find(
    (c) => c.accountId === accountId,
  );

  if (!conta) {
    throw new ErroDeApi(
      "nao-encontrado",
      "Conta nao encontrada no cadastro. Ela precisa existir em cloud_accounts.",
    );
  }

  const recusa = motivoRecusaDeProvider(accountId, conta.provider);
  if (recusa !== null) {
    throw new ErroDeApi("parametros-invalidos", recusa);
  }

  return conta;
}

// ---------------------------------------------------------------- 1. status

/** O que a tela recebe. Nenhum campo aqui e segredo nem deriva de um. */
export type CredencialOvhVisivel = {
  accountId: string;
  endpoint: string;
  status: StatusCredencial;
  /** `****abcd`. `null` quando a decifragem falhou -- ver `montarVisivel`. */
  applicationKeyMascarada: string | null;
  consumerKeyMascarada: string | null;
  /** Do secret a tela sabe apenas isto. */
  temApplicationSecret: boolean;
  ultimaValidacao: string | null;
  ultimoErro: string | null;
  atualizadaEm: string;
};

/**
 * Monta a visao de tela a partir do envelope.
 *
 * Decifra APENAS application key e consumer key, e apenas para tirar os 4
 * ultimos caracteres. O application secret nunca e decifrado aqui: nao ha para
 * que, e cada decifragem desnecessaria e uma passagem do segredo pela memoria do
 * processo web.
 *
 * Falha de decifragem devolve `null` na mascara em vez de estourar. A conta
 * continua aparecendo, com status visivel, e o operador ve que ha credencial
 * gravada que o portal nao consegue ler -- que e exatamente o sintoma de chave de
 * cifragem trocada. Estourar aqui derrubaria a tela inteira de Contas Cloud por
 * causa de uma linha.
 */
function montarVisivel(l: LinhaCredencialEnvelope): CredencialOvhVisivel {
  const mascara = (envelope: string, campo: ContextoSegredo["campo"]) => {
    try {
      return mascarar(decifrar(envelope, contexto(l.accountId, campo)));
    } catch {
      return null;
    }
  };

  return {
    accountId: l.accountId,
    endpoint: l.endpoint,
    status: l.status,
    applicationKeyMascarada: mascara(l.applicationKeyEncrypted, "application_key"),
    consumerKeyMascarada: mascara(l.consumerKeyEncrypted, "consumer_key"),
    temApplicationSecret: l.applicationSecretEncrypted !== "",
    ultimaValidacao: l.ultimaValidacao,
    ultimoErro: l.ultimoErro,
    atualizadaEm: l.atualizadaEm,
  };
}

/** Situacao da credencial de uma conta. `null` quando nunca foi cadastrada. */
export async function getOvhCredentialStatus(
  accountId: string,
): Promise<CredencialOvhVisivel | null> {
  const linha = await getCredencialEnvelope(accountId);
  return linha === null ? null : montarVisivel(linha);
}

// ------------------------------------------------------------- 2. listagem

export type ContaComCredencial = ContaAdministravel & {
  /**
   * `null` para conta AWS (nao se aplica) e para conta OVH sem cadastro.
   * A tela distingue os dois pelo `provider`, que ja vem no mesmo objeto.
   */
  credencial: CredencialOvhVisivel | null;
};

/**
 * Contas + situacao da credencial, para a tela de Contas Cloud.
 *
 * `incluirCredenciais` NAO tem valor padrao de proposito. Quem chama e obrigado a
 * declarar se o consumidor e ADMIN, e um esquecimento vira erro de tipo em vez de
 * um vazamento silencioso -- que e o que aconteceria com `= false` (a rota do
 * admin passaria a nao mostrar nada, bug visivel) ou `= true` (a rota comum
 * passaria a mostrar tudo, bug invisivel).
 *
 * Para nao-ADMIN o campo sai `null` em TODAS as contas. Nao e censura cosmetica:
 * o status "invalido" com data ja informa que existe credencial e que ela parou
 * de funcionar, e essa e informacao operacional que o requisito reserva ao
 * administrador.
 */
export async function listCloudAccountsWithCredentialStatus(
  incluirCredenciais: boolean,
): Promise<ContaComCredencial[]> {
  const contas = await listarContasAdministraveis();

  if (!incluirCredenciais) {
    return contas.map((c) => ({ ...c, credencial: null }));
  }

  const porConta = await getCredenciaisPorConta();

  return contas.map((c) => {
    const linha = c.provider === PROVIDER ? porConta.get(c.accountId) : undefined;
    return { ...c, credencial: linha ? montarVisivel(linha) : null };
  });
}

// ---------------------------------------------------------------- 3. gravar

export type ResultadoGravacao = {
  credencial: CredencialOvhVisivel;
  /** Contas que ja usam a MESMA application key. Vazio no caso normal. */
  avisoContasDuplicadas: string[];
};

/**
 * Grava a credencial de uma conta OVH.
 *
 * Campo de segredo vazio significa MANTER o que esta gravado -- a regra que faz
 * "trocar so o endpoint" ser possivel. Sem ela, reabrir o formulario (que nunca
 * recebe o segredo de volta) e salvar destruiria a credencial.
 *
 * A gravacao NAO valida contra a OVH. Sao operacoes separadas de proposito:
 * salvar tem de funcionar com a internet fora do ar, e a tela mostra
 * `nao_validado` ate alguem testar. Amarrar as duas faria uma indisponibilidade
 * da OVH impedir o cadastro.
 */
export async function saveOvhCredentials(
  accountId: string,
  entrada: EntradaCredencialOvh,
  usuarioId: string,
): Promise<ResultadoGravacao> {
  await exigirTabela();
  exigirCifragem();
  await exigirContaOvh(accountId);

  const atual = await getCredencialEnvelope(accountId);

  // A DECISAO -- o que manter, o que substituir, o que falta -- vem do modulo
  // puro. Aqui so se executa. `ErroDeValidacao` e nao `ErroDeApi` porque ela
  // carrega detalhe POR CAMPO, e a tela usa isso para apontar o campo em branco
  // em vez de dizer "preencha tudo".
  const resultado = planejarGravacao(entrada, atual !== null);
  if (!resultado.ok) throw new ErroDeValidacao(resultado.faltantes);
  const plano = resultado.plano;

  try {
    // "manter" reaproveita o envelope ANTIGO em vez de decifrar e recifrar: uma
    // passagem menos do segredo pela memoria, e o envelope antigo continua valido
    // porque o AAD (conta + campo) nao mudou.
    //
    // O `as string` e seguro: `planejarGravacao` garantiu que "manter" so aparece
    // quando ha cadastro anterior, e cadastro anterior tem os tres envelopes.
    const envelope = (
      acao: PlanoCredencial["applicationKey"],
      anterior: string | undefined,
      campo: ContextoSegredo["campo"],
    ): string =>
      acao.acao === "manter"
        ? (anterior as string)
        : cifrar(acao.valor, contexto(accountId, campo));

    // O fingerprint precisa do valor em CLARO. Em "manter", o fingerprint
    // anterior continua correto -- e literalmente a mesma credencial.
    const digital = (
      acao: PlanoCredencial["applicationKey"],
      anterior: string | undefined,
    ): string =>
      acao.acao === "manter" ? (anterior as string) : impressaoDigital(acao.valor);

    const applicationKeyEncrypted = envelope(
      plano.applicationKey,
      atual?.applicationKeyEncrypted,
      "application_key",
    );
    const applicationSecretEncrypted = envelope(
      plano.applicationSecret,
      atual?.applicationSecretEncrypted,
      "application_secret",
    );
    const consumerKeyEncrypted = envelope(
      plano.consumerKey,
      atual?.consumerKeyEncrypted,
      "consumer_key",
    );

    const applicationKeyFingerprint = digital(
      plano.applicationKey,
      atual?.applicationKeyFingerprint,
    );
    const consumerKeyFingerprint = digital(
      plano.consumerKey,
      atual?.consumerKeyFingerprint,
    );

    const gravada = await gravarCredencial({
      accountId,
      endpoint: plano.endpoint,
      applicationKeyEncrypted,
      applicationSecretEncrypted,
      consumerKeyEncrypted,
      applicationKeyFingerprint,
      consumerKeyFingerprint,
      usuarioId,
    });

    return {
      credencial: montarVisivel(gravada),
      // Aviso, e nao recusa: pode haver motivo legitimo (duas contas do portal
      // apontando para o mesmo nichandle durante uma migracao). Mas o silencio
      // seria pior -- o sintoma de duplicata e duas contas exibindo o custo da
      // mesma conta da OVH, e nenhum dos dois numeros parece errado.
      avisoContasDuplicadas: await contasComMesmaChave(
        applicationKeyFingerprint,
        accountId,
      ),
    };
  } catch (err) {
    traduzirCripto(err);
  }
}

// --------------------------------------------------------------- 4. validar

export type ResultadoTeste = {
  ok: boolean;
  status: StatusCredencial;
  mensagem: string;
  /** Preenchidos so no sucesso -- o que a OVH respondeu sobre a conta. */
  nichandle: string | null;
  estado: string | null;
  moeda: string | null;
  credencial: CredencialOvhVisivel | null;
};

/**
 * Testa a credencial contra a API da OVH.
 *
 * Aceita segredos no corpo para permitir testar ANTES de salvar. Campo vazio cai
 * para o que esta gravado, o que permite retestar uma credencial existente sem
 * redigita-la.
 *
 * O resultado so e PERSISTIDO quando ja existe cadastro para a conta: testar uma
 * credencial que ainda nao foi salva nao pode criar linha no banco. Um teste que
 * gravasse faria o botao "Testar conexao" ter efeito colateral que ninguem pediu.
 */
export async function validateOvhCredentials(
  accountId: string,
  entrada: EntradaCredencialOvh,
  usuarioId: string,
): Promise<ResultadoTeste> {
  await exigirTabela();
  exigirCifragem();
  await exigirContaOvh(accountId);

  const atual = await getCredencialEnvelope(accountId);

  // Sem cadastro anterior nao ha o que reaproveitar: testar exige os tres.
  const planejado = planejarGravacao(entrada, atual !== null);
  if (!planejado.ok) throw new ErroDeValidacao(planejado.faltantes);

  if (!ehEndpointOvh(entrada.endpoint)) {
    throw new ErroDeApi("parametros-invalidos", "Endpoint OVH invalido.");
  }

  let resultado;
  try {
    const claro = (
      novo: string | undefined,
      envelope: string | undefined,
      campo: ContextoSegredo["campo"],
    ): string =>
      novo !== undefined
        ? novo
        : decifrar(envelope as string, contexto(accountId, campo));

    resultado = await validarCredencialOvh({
      endpoint: entrada.endpoint as EndpointOvh,
      applicationKey: claro(
        entrada.applicationKey,
        atual?.applicationKeyEncrypted,
        "application_key",
      ),
      applicationSecret: claro(
        entrada.applicationSecret,
        atual?.applicationSecretEncrypted,
        "application_secret",
      ),
      consumerKey: claro(
        entrada.consumerKey,
        atual?.consumerKeyEncrypted,
        "consumer_key",
      ),
    });
  } catch (err) {
    traduzirCripto(err);
  }

  const status: StatusCredencial = resultado.ok ? "conectado" : "invalido";

  // Falha de REDE nao condena a credencial. Marcar `invalido` porque o container
  // nao tem saida HTTPS diria que a chave esta errada, e mandaria alguem gerar
  // credencial nova para resolver um problema de firewall.
  const persistir =
    atual !== null && !(resultado.ok === false && resultado.causa === "rede");

  const mensagem = resultado.ok
    ? `Conectado${resultado.nichandle ? ` como ${resultado.nichandle}` : ""}.`
    : resultado.mensagem;

  let credencial: CredencialOvhVisivel | null =
    atual === null ? null : montarVisivel(atual);

  if (persistir) {
    const atualizada = await registrarValidacao(
      accountId,
      status,
      // Sanitiza de novo, por garantia: a mensagem ja vem tratada de `api.ts`,
      // mas esta e a linha que grava no banco e ela nao deve depender de o
      // chamador ter feito a coisa certa.
      resultado.ok ? null : sanitizar(mensagem),
      usuarioId,
    );
    if (atualizada) credencial = montarVisivel(atualizada);
  }

  return {
    ok: resultado.ok,
    status,
    mensagem,
    nichandle: resultado.ok ? resultado.nichandle : null,
    estado: resultado.ok ? resultado.estado : null,
    moeda: resultado.ok ? resultado.moeda : null,
    credencial,
  };
}

// ---------------------------------------------------------------- 5. apagar

/**
 * Remove a credencial de uma conta.
 *
 * NAO apaga custo nem fatura ja coletados: o dado historico continua valendo, e
 * apagar a credencial nao torna falso o que a OVH cobrou. O efeito e que a
 * proxima coleta daquela conta fica sem como autenticar.
 */
export async function deleteOvhCredentials(
  accountId: string,
): Promise<{ removida: boolean }> {
  await exigirTabela();
  await exigirContaOvh(accountId);
  return { removida: await apagarCredencial(accountId) };
}


// ============================================================ primeira coleta

export type ResultadoEnfileiramento = {
  job: JobSync;
  /** `false` quando ja havia job vivo para a conta -- o pedido foi atendido. */
  criado: boolean;
};

/**
 * Enfileira uma coleta para a conta. NAO executa nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO NAO RODA O COLLECTOR
 *
 * O portal roda no container `finops-portal`; o collector roda no HOST, com venv
 * proprio. O container nao tem o filesystem do host montado nem o interpretador
 * do collector -- e dar-lhe qualquer um dos dois significaria expor diretorio do
 * host a um processo que atende requisicao HTTP publica.
 *
 * Entao esta funcao INSERE UMA LINHA. Um worker no host
 * (`scripts/ovh-collector/processar_jobs.py`, chamado por cron a cada minuto) le
 * a linha e trabalha. A fronteira de confianca fica no banco, que os dois lados
 * ja acessam.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECE SEM A MIGRACAO 008
 *
 * Recusa com `banco-indisponivel` e mensagem propria -- e nada mais para. Salvar
 * e testar credencial NAO dependem desta tabela, de proposito: a fila e uma
 * conveniencia, e a ausencia dela nao pode impedir o cadastro.
 */
export async function triggerOvhFirstSync(
  accountId: string,
  usuarioId: string,
  action: AcaoJob = "first_sync",
): Promise<ResultadoEnfileiramento> {
  await exigirContaOvh(accountId);

  if (!(await filaDisponivel())) {
    throw new ErroDeApi(
      "banco-indisponivel",
      "A fila de coleta ainda nao existe neste ambiente. Rode " +
        "scripts/migrations/008-cloud-sync-jobs.sql. A credencial continua salva; " +
        "so o disparo automatico esta indisponivel -- rode a coleta a mao com " +
        "./run-ovh-etl.sh manual --account " +
        accountId +
        " .",
    );
  }

  // Enfileirar SEM credencial cadastrada criaria um job destinado a falhar, e a
  // tela mostraria "coleta enfileirada" seguida de erro alguns minutos depois --
  // pior do que recusar agora, com a causa em maos.
  const credencial = await getCredencialEnvelope(accountId);
  if (credencial === null) {
    throw new ErroDeApi(
      "parametros-invalidos",
      "Esta conta nao tem credencial cadastrada. Salve as credenciais antes de " +
        "pedir a primeira coleta.",
    );
  }

  return enfileirarColeta(accountId, action, usuarioId);
}

/**
 * O que a tela mostra sobre coleta: o job vivo, se houver, e o ultimo resultado.
 *
 * Os dois, e nao apenas o ultimo: enquanto um job esta `queued`, o ultimo
 * resultado ainda e o da execucao ANTERIOR, e mostrar so um dos dois faria a tela
 * dizer "falhou" durante uma coleta que esta correndo bem, ou esconder que existe
 * coleta em andamento.
 */
export async function getOvhSyncJobStatus(
  accountId: string,
): Promise<{ ativo: JobSync | null; ultimo: JobSync | null; disponivel: boolean }> {
  if (!(await filaDisponivel())) {
    return { ativo: null, ultimo: null, disponivel: false };
  }
  const [ativo, ultimo] = await Promise.all([
    jobAtivoDaConta(accountId),
    ultimoJobDaConta(accountId),
  ]);
  return { ativo, ultimo, disponivel: true };
}


// ================================================ coleta pedida pelo Diagnostico

export type ResultadoColetaOvh = {
  /** Um por conta atendida. Vazio nunca -- sem contas, a funcao lanca. */
  jobs: { accountId: string; jobId: string; criado: boolean }[];
  /** Contas puladas e o porque, sem segredo. Ex.: sem credencial cadastrada. */
  ignoradas: { accountId: string; motivo: string }[];
};

/**
 * Enfileira coleta para uma conta OVH ou para todas.
 *
 * ---------------------------------------------------------------------------
 * FALHA PARCIAL NAO E FALHA
 *
 * Com `scope: "all"` e tres contas em que uma nao tem credencial, a resposta certa
 * e enfileirar as duas e RELATAR a terceira -- nao recusar as tres. Recusar tudo
 * faria uma conta mal configurada bloquear a coleta das que estao corretas, que e
 * exatamente o oposto do isolamento por conta que o collector implementa.
 *
 * Por isso `ignoradas` vem junto de `jobs`: a tela precisa dizer "2 enfileiradas,
 * 1 ignorada" em vez de "sucesso" ou "erro".
 *
 * A funcao so LANCA quando nao ha nada a fazer -- nenhuma conta OVH ativa, ou
 * nenhuma delas enfileiravel. Um "sucesso" que nao enfileirou nada faria alguem
 * esperar por uma coleta que nunca vai acontecer.
 */
export async function enfileirarColetaOvh(
  entrada: EntradaColetaOvh,
  usuarioId: string,
): Promise<ResultadoColetaOvh> {
  if (!(await filaDisponivel())) {
    throw new ErroDeApi(
      "banco-indisponivel",
      "A fila de coleta ainda nao existe neste ambiente. Rode " +
        "scripts/migrations/008-cloud-sync-jobs.sql.",
    );
  }

  const contas = await listarContasAdministraveis();

  const alvos =
    entrada.scope === "account"
      ? contas.filter((c) => c.accountId === entrada.accountId)
      : contas.filter((c) => c.provider === PROVIDER && c.ativa);

  if (entrada.scope === "account") {
    // Conta inexistente e conta de outro provider sao erros DIFERENTES, e a
    // mensagem precisa distinguir: "nao encontrei" manda procurar o id certo,
    // "e AWS" manda parar de procurar.
    if (alvos.length === 0) {
      throw new ErroDeApi("nao-encontrado", "Conta nao encontrada no cadastro.");
    }
    const recusa = motivoRecusaDeProvider(entrada.accountId, alvos[0].provider);
    if (recusa !== null) throw new ErroDeApi("parametros-invalidos", recusa);
    if (!alvos[0].ativa) {
      throw new ErroDeApi(
        "parametros-invalidos",
        "Conta desativada em cloud_accounts. Reative antes de pedir coleta -- o " +
          "collector tambem a ignoraria.",
      );
    }
  }

  if (alvos.length === 0) {
    throw new ErroDeApi(
      "nao-encontrado",
      "Nenhuma conta OVH ativa encontrada em cloud_accounts.",
    );
  }

  const jobs: ResultadoColetaOvh["jobs"] = [];
  const ignoradas: ResultadoColetaOvh["ignoradas"] = [];

  for (const conta of alvos) {
    // Enfileirar sem credencial criaria um job destinado a falhar, e a tela
    // mostraria "coleta enfileirada" seguida de erro minutos depois.
    const credencial = await getCredencialEnvelope(conta.accountId);
    if (credencial === null) {
      ignoradas.push({
        accountId: conta.accountId,
        motivo: "sem credencial cadastrada em Contas Cloud",
      });
      continue;
    }

    try {
      const { job, criado } = await enfileirarColeta(
        conta.accountId,
        "manual_sync",
        usuarioId,
      );
      jobs.push({ accountId: conta.accountId, jobId: job.id, criado });
    } catch (e) {
      // Uma conta que falhou ao enfileirar nao pode derrubar as outras.
      ignoradas.push({
        accountId: conta.accountId,
        motivo: sanitizar(e instanceof Error ? e.message : String(e)),
      });
    }
  }

  if (jobs.length === 0) {
    throw new ErroDeApi(
      "parametros-invalidos",
      "Nenhuma conta pode ser enfileirada. " +
        ignoradas.map((i) => `${i.accountId}: ${i.motivo}`).join("; "),
    );
  }

  return { jobs, ignoradas };
}

/** Estado da fila para a tela de Diagnostico: um resumo por conta OVH ativa. */
export async function getEstadoColetaOvh(): Promise<{
  disponivel: boolean;
  contas: { accountId: string; nome: string; temCredencial: boolean; jobAtivo: JobSync | null }[];
}> {
  if (!(await filaDisponivel())) return { disponivel: false, contas: [] };

  const contas = (await listarContasAdministraveis()).filter(
    (c) => c.provider === PROVIDER && c.ativa,
  );

  const linhas = await Promise.all(
    contas.map(async (c) => ({
      accountId: c.accountId,
      nome: c.nomeExibicao,
      temCredencial: (await getCredencialEnvelope(c.accountId)) !== null,
      jobAtivo: await jobAtivoDaConta(c.accountId),
    })),
  );

  return { disponivel: true, contas: linhas };
}


/**
 * De onde cada conta OVH ativa tira a credencial — para o Diagnóstico.
 *
 * NÃO depende da fila (`cloud_sync_jobs`), ao contrário de `getEstadoColetaOvh`:
 * origem de credencial e fila de coleta são perguntas independentes, e amarrá-las
 * faria o indicador de fallback sumir num ambiente onde a migração 008 não rodou
 * — justamente um ambiente atrasado, onde o fallback é mais provável.
 *
 * Devolve lista vazia, e não exceção, quando a tabela de credenciais não existe:
 * a tela de diagnóstico é a que não pode quebrar com o ambiente pela metade.
 */
export async function getOrigemCredenciaisOvh(): Promise<ContaCredencial[]> {
  const contas = (await listarContasAdministraveis()).filter(
    (c) => c.provider === PROVIDER && c.ativa,
  );
  if (contas.length === 0) return [];

  if (!(await credenciaisDisponiveis())) {
    // Sem a migração 006 nenhuma conta tem credencial no banco — todas dependem
    // do fallback, e é isso que o Diagnóstico precisa dizer.
    return contas.map((c) => ({
      accountId: c.accountId,
      nome: c.nomeExibicao,
      temCredencial: false,
      status: null,
    }));
  }

  return Promise.all(
    contas.map(async (c) => {
      const envelope = await getCredencialEnvelope(c.accountId);
      return {
        accountId: c.accountId,
        nome: c.nomeExibicao,
        temCredencial: envelope !== null,
        // Só o STATUS sai daqui. Nenhum campo `*_encrypted`, nenhum fingerprint:
        // esta função alimenta uma tela de diagnóstico, não o formulário.
        status: envelope?.status ?? null,
      };
    }),
  );
}


// ============================================ criacao de conta OVH pelo portal

export type ResultadoCriacaoConta = {
  conta: ContaComCredencial;
  /** `null` quando a conta foi criada sem credencial. */
  credencial: CredencialOvhVisivel | null;
  /** Contas que ja usam a MESMA application key. Vazio no caso normal. */
  avisoContasDuplicadas: string[];
  /** `null` quando nao se pediu coleta, ou quando a fila nao existe. */
  coleta: { jobId: string; criado: boolean } | null;
  /** Por que a coleta pedida nao aconteceu. `null` quando aconteceu ou nao foi pedida. */
  coletaIndisponivel: string | null;
  /**
   * A coleta ENTROU na fila, mas ha job parado: o worker nao esta processando.
   *
   * E diferente de `coletaIndisponivel`, e a diferenca importa. Ali a coleta NAO
   * foi enfileirada -- nao ha nada esperando. Aqui ela foi, e vai ficar esperando
   * para sempre se ninguem instalar o worker. Sem este aviso, a tela responde
   * "coleta enfileirada" com sucesso e nada acontece: nem naquele minuto, nem
   * nunca. Quem clicou conclui que a coleta e lenta e espera.
   */
  workerParado: boolean;
};

/**
 * Cria a conta OVH e, se vieram chaves, grava a credencial cifrada.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM IMPORTA, E ELA NAO E REVERSIVEL
 *
 * A conta e criada PRIMEIRO porque a credencial referencia `account_id` e o AAD
 * da cifragem inclui a conta -- nao ha como cifrar antes de saber para quem.
 *
 * Isso cria uma janela: a conta existe e a credencial falhou. NAO desfazemos a
 * conta nesse caso, e a escolha e deliberada. Apagar a conta destruiria tambem
 * os metadados que o operador acabou de digitar, e o obrigaria a redigitar tudo
 * por causa de uma chave colada errado. O estado resultante -- conta na lista,
 * marcada "Credenciais nao configuradas" -- e visivel, nomeado e recuperavel com
 * dois cliques no proprio cartao.
 *
 * Uma transacao unica resolveria a janela, mas o pool aqui nao expoe transacao e
 * introduzi-la para este caso mudaria a camada de banco inteira. A troca esta
 * certa enquanto o pior caso for "conta sem credencial", que a tela ja sabe
 * mostrar.
 *
 * ---------------------------------------------------------------------------
 * A COLETA E O ULTIMO PASSO, E FALHA SOZINHA
 *
 * Se a fila nao existir neste ambiente, a conta e a credencial JA FORAM salvas.
 * Recusar tudo por causa da fila desfaria trabalho bom por causa de um recurso
 * acessorio -- por isso o motivo volta em `coletaIndisponivel` em vez de virar
 * excecao.
 */
export async function criarContaOvh(
  entrada: EntradaNovaContaOvh,
  usuarioId: string,
): Promise<ResultadoCriacaoConta> {
  const temCredencial = entrada.applicationKey !== undefined;

  // Falhar ANTES de criar a conta quando a cifragem nao esta configurada: criar
  // a conta e so entao descobrir que a chave nao pode ser gravada deixaria lixo
  // para o operador limpar por um problema que e do servidor, nao dele.
  if (temCredencial) exigirCifragem();

  await criarConta({
    accountId: entrada.accountId,
    provider: PROVIDER,
    accountName: entrada.alias,
    businessUnit: entrada.businessUnit,
    costCenter: entrada.costCenter,
    environment: entrada.environment,
  });

  let credencial: CredencialOvhVisivel | null = null;
  let avisoContasDuplicadas: string[] = [];

  if (temCredencial) {
    const gravacao = await saveOvhCredentials(
      entrada.accountId,
      {
        endpoint: entrada.endpoint,
        applicationKey: entrada.applicationKey,
        applicationSecret: entrada.applicationSecret,
        consumerKey: entrada.consumerKey,
      },
      usuarioId,
    );
    credencial = gravacao.credencial;
    avisoContasDuplicadas = gravacao.avisoContasDuplicadas;
  }

  let coleta: ResultadoCriacaoConta["coleta"] = null;
  let coletaIndisponivel: string | null = null;
  let workerParado = false;

  if (entrada.coletarAgora) {
    try {
      // A checagem vem ANTES de enfileirar: depois, o proprio job recem-criado
      // estaria na fila com zero minuto de idade, e a pergunta "ha job parado?"
      // passaria a incluir aquele que acabamos de criar. Antes, ela olha so o
      // que ja estava la -- que e o unico conjunto capaz de responder se o
      // worker vem consumindo a fila.
      const filaParada = await existeJobParado(MINUTOS_SEM_WORKER);

      const { job, criado } = await triggerOvhFirstSync(
        entrada.accountId,
        usuarioId,
        "first_sync",
      );
      coleta = { jobId: job.id, criado };
      workerParado = filaParada;
    } catch (e) {
      coletaIndisponivel =
        e instanceof ErroDeApi
          ? e.message
          : sanitizar(e instanceof Error ? e.message : String(e));
    }
  }

  const contas = await listCloudAccountsWithCredentialStatus(true);
  const conta = contas.find((c) => c.accountId === entrada.accountId);
  if (!conta) {
    // Nao deveria acontecer: acabamos de cria-la. Se acontecer, e melhor dizer
    // do que devolver um objeto inventado.
    throw new ErroDeApi(
      "erro-interno",
      "A conta foi criada, mas nao foi possivel recarrega-la. Atualize a tela.",
    );
  }

  return {
    conta,
    credencial,
    avisoContasDuplicadas,
    coleta,
    coletaIndisponivel,
    workerParado,
  };
}


/**
 * Testa credencial AVULSA -- sem conta cadastrada, sem gravar nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NAO DA PARA REUSAR `validateOvhCredentials`
 *
 * Aquela funcao chama `exigirContaOvh`, e com razao: ela existe para retestar a
 * credencial de uma conta que ja existe, e para isso precisa poder reaproveitar
 * o que esta gravado quando um campo vem em branco.
 *
 * No formulario de CRIACAO nao ha conta ainda. Testar antes de salvar e o
 * comportamento certo -- descobrir que a chave esta errada depois de gravar
 * deixaria uma credencial invalida no banco e um cadastro que ninguem pediu --,
 * mas exige um caminho que nao consulte cadastro nenhum.
 *
 * Daqui NAO SAI e aqui NAO ENTRA persistencia: nenhuma linha e criada, nenhum
 * status e atualizado. O unico efeito e uma chamada GET /me na OVH.
 *
 * Os tres segredos sao OBRIGATORIOS, e nao ha o que herdar. `planejarGravacao`
 * com `temCadastro: false` produz exatamente essa exigencia, com detalhe por
 * campo -- reusa-la evita que as duas telas discordem sobre o que e obrigatorio.
 */
export async function testarCredencialAvulsa(
  entrada: EntradaCredencialOvh,
): Promise<{ ok: boolean; mensagem: string; nichandle: string | null }> {
  exigirCifragem();

  const planejado = planejarGravacao(entrada, false);
  if (!planejado.ok) throw new ErroDeValidacao(planejado.faltantes);

  if (!ehEndpointOvh(entrada.endpoint)) {
    throw new ErroDeApi("parametros-invalidos", "Endpoint OVH invalido.");
  }

  // Os tres estao presentes: `planejarGravacao` sem cadastro anterior nao aceita
  // "manter", entao todo campo virou "substituir" com valor.
  const resultado = await validarCredencialOvh({
    endpoint: entrada.endpoint as EndpointOvh,
    applicationKey: entrada.applicationKey as string,
    applicationSecret: entrada.applicationSecret as string,
    consumerKey: entrada.consumerKey as string,
  });

  return resultado.ok
    ? {
        ok: true,
        mensagem: `Conexao bem-sucedida${resultado.nichandle ? ` com a conta ${resultado.nichandle}` : ""}.`,
        nichandle: resultado.nichandle,
      }
    : { ok: false, mensagem: resultado.mensagem, nichandle: null };
}
