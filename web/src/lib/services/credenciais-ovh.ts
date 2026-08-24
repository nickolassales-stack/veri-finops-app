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
import type { EntradaCredencialOvh } from "@/lib/filtros/esquemas-credenciais";
import { ehEndpointOvh, type EndpointOvh } from "@/lib/ovh/endpoints";
import { sanitizar, validarCredencialOvh } from "@/lib/ovh/api";
import {
  enfileirarColeta,
  filaDisponivel,
  jobAtivoDaConta,
  ultimoJobDaConta,
  type AcaoJob,
  type JobSync,
} from "@/lib/queries/admin/jobs-sync";
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
import { listarContasAdministraveis, type ContaAdministravel } from "@/lib/queries/admin/contas";

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
