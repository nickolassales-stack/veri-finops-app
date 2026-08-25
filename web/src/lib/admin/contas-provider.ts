/**
 * Segmentação de Contas Cloud por provedor — a regra, sem React e sem banco.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SEPARAR AS DUAS LISTAS
 *
 * Uma conta AWS e uma conta OVH não são o mesmo objeto com um selo diferente.
 * Elas se cadastram por caminhos opostos, e é isso que a tela precisa refletir:
 *
 *   AWS  — o custo chega por Data Export/CUR → S3 → Glue → Athena → ETL. Não há
 *          segredo para guardar (a instância autentica por IAM role), e não há
 *          nada a preencher além de alias e metadados.
 *   OVH  — a conta é cadastrada aqui, com chave de API cifrada no banco, e a
 *          coleta pode ser disparada pelo portal.
 *
 * Numa lista só, os dois conjuntos de ações apareciam misturados: metade dos
 * cartões com bloco de credencial e metade sem, sem que a diferença fosse
 * explicada em lugar nenhum. Quem procurava "onde cadastro a chave da AWS"
 * concluía que faltava um campo — quando a resposta é que ele não existe.
 *
 * ---------------------------------------------------------------------------
 * O PADRÃO É AWS
 *
 * Mesma regra de `ehVisaoOvh` no Analítico, e pelo mesmo motivo: um valor
 * digitado errado na URL não pode trocar o provedor em silêncio. `?provider=OVH`
 * (maiúsculo), `?provider=gcp` e `?provider=` caem todos em AWS.
 */

export const PROVIDERS = ["aws", "ovh"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Status possíveis da credencial, incluindo o caso "não há linha no banco". */
export type StatusCredencial = "conectado" | "invalido" | "nao_configurado";

export function lerProvider(params: { get(k: string): string | null }): Provider {
  return params.get("provider") === "ovh" ? "ovh" : "aws";
}

/** URL da visão. Sem `?provider=aws` porque AWS é o padrão e o parâmetro é ruído. */
export function urlDaVisao(base: string, provider: Provider): string {
  return provider === "ovh" ? `${base}?provider=ovh` : base;
}

// --------------------------------------------------------------- segmentação

export type ContaSegmentavel = {
  accountId: string;
  provider: string;
  credencial?: { status: string } | null;
};

/**
 * Divide a lista pelo provedor.
 *
 * Provider desconhecido cai em AWS junto com o padrão do banco
 * (`cloud_accounts.provider` tem `DEFAULT 'aws'` e aceita `NULL`). Some-lo a
 * nada faria a conta DESAPARECER das duas visões — pior do que aparecer na
 * lista errada, porque ninguém procura o que não sabe que existe.
 */
export function segmentar<T extends ContaSegmentavel>(
  contas: T[],
): Record<Provider, T[]> {
  return {
    ovh: contas.filter((c) => c.provider === "ovh"),
    aws: contas.filter((c) => c.provider !== "ovh"),
  };
}

/**
 * Status da credencial de uma conta OVH.
 *
 * `nao_configurado` é derivado da AUSÊNCIA de linha, e não de um valor gravado:
 * o CHECK do banco só conhece `nao_validado`, `conectado` e `invalido`.
 *
 * `nao_validado` (credencial nova que ninguém testou) NÃO é `invalido`. Ela
 * coleta normalmente; tratá-la como falha transformaria todo cadastro novo num
 * alarme. Ela cai em `conectado`? Não — mentiria sobre uma validação que não
 * houve. Fica como o próprio `nao_validado`, e a tela dá a ele o rótulo neutro.
 */
export function statusDaCredencial(
  credencial: { status: string } | null | undefined,
): StatusCredencial | "nao_validado" {
  if (!credencial) return "nao_configurado";
  const s = credencial.status;
  return s === "conectado" || s === "invalido" || s === "nao_validado"
    ? s
    : "nao_configurado";
}

export const ROTULO_CREDENCIAL: Record<
  StatusCredencial | "nao_validado",
  string
> = {
  conectado: "Conectado",
  invalido: "Inválido",
  nao_validado: "Não validado",
  nao_configurado: "Não configurada",
};

/** Frase de estado vazio que a visão de credencial mostra. */
export function mensagemCredencial(
  status: StatusCredencial | "nao_validado",
): string | null {
  if (status === "nao_configurado") return "Credenciais não configuradas.";
  if (status === "invalido") {
    return "Credencial inválida. Atualize as credenciais e teste novamente.";
  }
  return null;
}

// ------------------------------------------------------------------- resumo

export type Resumo = {
  contasAws: number;
  contasOvh: number;
  /** `null` quando quem olha não é ADMIN: o servidor não envia o dado. */
  credenciaisConectadas: number | null;
  /** `null` quando a fila não existe neste ambiente; 0 é ausência de falha. */
  coletasComFalha: number | null;
};

/**
 * Os números dos cartões do topo.
 *
 * `credenciaisConectadas` é `null` e não `0` para não-ADMIN. São coisas
 * diferentes: zero afirma que nenhuma conta está conectada — e mandaria um
 * VIEWER avisar que a integração caiu quando ela está de pé. `null` diz "não
 * sei", e a tela omite o cartão.
 */
export function resumoContas<T extends ContaSegmentavel>(
  contas: T[],
  opcoes: { podeVerCredenciais: boolean; coletasComFalha: number | null },
): Resumo {
  const { aws, ovh } = segmentar(contas);

  return {
    contasAws: aws.length,
    contasOvh: ovh.length,
    credenciaisConectadas: opcoes.podeVerCredenciais
      ? ovh.filter((c) => statusDaCredencial(c.credencial) === "conectado").length
      : null,
    coletasComFalha: opcoes.coletasComFalha,
  };
}

// ------------------------------------------------------------ estados vazios

/**
 * O texto de lista vazia por visão.
 *
 * São mensagens DIFERENTES porque a ação seguinte é diferente, e essa é a única
 * razão de um estado vazio existir. Na AWS não há o que clicar no portal — o
 * trabalho é na AWS e depois se espera. Na OVH há um botão bem ali.
 */
export function textoListaVazia(provider: Provider): {
  titulo: string;
  detalhe: string;
} {
  return provider === "ovh"
    ? {
        titulo: "Nenhuma conta OVH cadastrada",
        detalhe:
          "Clique em Adicionar conta OVH para configurar a primeira.",
      }
    : {
        titulo: "Nenhuma conta AWS importada ainda",
        detalhe:
          "Adicione o Data Export/CUR 2.0 na AWS e aguarde o ETL.",
      };
}
