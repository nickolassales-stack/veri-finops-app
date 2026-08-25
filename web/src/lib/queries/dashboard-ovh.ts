import "server-only";

import { ConstrutorParams, query, queryOne } from "@/lib/database";

import { aliasDisponivel } from "./alias-conta";
import type { FonteOvh } from "@/lib/filtros/esquemas";
import { toNumber } from "@/lib/format";

/**
 * Leitura das tabelas `ovh_*` para a VISAO EXECUTIVA.
 *
 * Separado de `queries/ovh.ts` -- que alimenta Faturamento e Diagnostico -- por
 * uma diferenca de pergunta: la o recorte e "tudo o que existe, agrupado por
 * origem"; aqui e "uma origem, uma moeda, uma janela de meses, um projeto".
 * Reaproveitar as funcoes de la exigiria acrescentar cinco parametros opcionais
 * a cada uma, e o caminho sem filtro (usado por Faturamento) passaria a
 * depender de um `if` a mais em cada consulta.
 *
 * ---------------------------------------------------------------------------
 * AS TRES REGRAS, VALIDAS AQUI TAMBEM
 *
 * 1. `source` NUNCA e omitido. As tres origens nao se somam: o mesmo projeto no
 *    mesmo mes tem legitimamente linha em `invoice`, `usage_current` e
 *    `usage_forecast`, e um `sum(amount)` sem a origem triplica o custo. Por
 *    isso `FiltroOvh.source` e obrigatorio -- nao ha assinatura possivel que
 *    permita esquecer.
 *
 * 2. Moeda nao se converte e nao se soma. `currency` e por linha; toda funcao
 *    que devolve total ou serie exige `moeda` no filtro. A unica excecao e
 *    `getTotaisPorMoedaOvh`, cujo proposito e justamente listar as moedas
 *    presentes para que o servico escolha uma.
 *
 * 3. OVH nao entra em conta com AWS. Nenhuma consulta aqui toca
 *    `aws_daily_costs` ou `aws_monthly_costs`.
 * ---------------------------------------------------------------------------
 *
 * TODA COLUNA `date` SAI COMO to_char(...). `lib/database/tipos-pg.ts` registra
 * `setTypeParser(1082, valor => valor)`: `date` chega como STRING neste driver,
 * de proposito. Tipar como `Date` compila -- o parametro de `query<T>()` e uma
 * AFIRMACAO, nao uma verificacao -- e explode com "toISOString is not a
 * function". Foi o que derrubou /dashboard/diagnostico em 20/08/2026.
 *
 * `raw_json` nunca sai daqui: e a resposta crua da API da OVH, nao tem funcao
 * na interface, e expo-la vazaria detalhe de integracao para o navegador.
 */

export type FiltroOvh = {
  /** Primeiro mes da janela, "AAAA-MM". Inclusivo. */
  deMes: string;
  /** Ultimo mes da janela, "AAAA-MM". Inclusivo. */
  ateMes: string;
  /** Origem do custo. Obrigatoria -- ver regra 1 no cabecalho. */
  source: FonteOvh;
  /**
   * `provider_account_id` a filtrar, sempre por `= ANY(...)`.
   *
   * A resolucao de "todas" NAO acontece aqui: quem monta o filtro ja decidiu.
   * Ver `resolverRecorteContasOvh` -- "todas" vira a lista de contas OVH ativas
   * do cadastro, e `undefined` sobra apenas para o caso em que nao ha nenhuma
   * conta ativa cadastrada, onde filtrar por lista vazia zeraria o painel.
   */
  contas?: string[];
  /** `ovh_projects.service_name`. `undefined` = todos os projetos. */
  projeto?: string;
  /** Codigo ISO. Obrigatorio em tudo que soma -- ver regra 2. */
  moeda: string;
};

/** Janela e origem, sem moeda: para descobrir QUAIS moedas existem no recorte. */
export type FiltroOvhSemMoeda = Omit<FiltroOvh, "moeda">;

/**
 * `billing_month` e `date` com CHECK de que e sempre o dia 1 do mes, entao
 * comparar com `to_date('AAAA-MM', 'YYYY-MM')` -- que rende o dia 1 -- e exato
 * nas duas pontas. Nao ha necessidade de calcular o ultimo dia do mes.
 */
function condicoesBase(f: FiltroOvhSemMoeda, p: ConstrutorParams): string[] {
  const condicoes = [
    `c.billing_month >= to_date(${p.add(f.deMes)}, 'YYYY-MM')`,
    `c.billing_month <= to_date(${p.add(f.ateMes)}, 'YYYY-MM')`,
    `c.source = ${p.add(f.source)}`,
  ];

  // `= ANY($n)` com um array parametrizado, e nao `IN (...)` montado por
  // interpolacao: o driver manda o array como UM parametro, entao o numero de
  // contas selecionadas nao muda a forma da consulta nem abre espaco para
  // concatenacao de string.
  if (f.contas !== undefined && f.contas.length > 0) {
    condicoes.push(`c.provider_account_id = ANY(${p.add(f.contas)}::text[])`);
  }

  if (f.projeto !== undefined) {
    condicoes.push(`c.project_service_name = ${p.add(f.projeto)}`);
  }

  return condicoes;
}

function onde(f: FiltroOvh, p: ConstrutorParams): string {
  const condicoes = condicoesBase(f, p);
  condicoes.push(`c.currency = ${p.add(f.moeda)}`);
  return condicoes.join(" AND ");
}

// ------------------------------------------------------------- disponibilidade

/** `false` quando a migracao 005 ainda nao rodou neste banco. */
export async function ovhInstaladoNoBanco(): Promise<boolean> {
  const linha = await queryOne<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ovh_monthly_costs'
     ) AS existe`,
  );
  return linha?.existe ?? false;
}

export type TotalMoedaOvh = { moeda: string; total: number; linhas: number };

export type DisponibilidadeOvh = {
  /** `true` quando existe QUALQUER linha de custo, em qualquer mes e origem. */
  temAlgumDado: boolean;
  /**
   * Origens com ao menos uma linha, SEM recorte de janela.
   *
   * Sem janela de proposito: e o que permite dizer "a API da OVH nunca devolveu
   * uso corrente" em vez de "nao ha uso corrente neste periodo". A primeira e um
   * fato sobre a integracao; a segunda, sobre o filtro escolhido -- e a acao do
   * outro lado e diferente em cada caso.
   */
  fontes: FonteOvh[];
  /**
   * Total por moeda DENTRO da janela. O unico resultado deste modulo que nao
   * exige `moeda` no filtro -- e que nunca deve ser somado.
   */
  moedas: TotalMoedaOvh[];
};

/**
 * As tres perguntas de disponibilidade numa viagem so.
 *
 * Consolidado porque cada um dos seis endpoints da visao OVH precisa das tres
 * antes de decidir o que consultar. Em funcoes separadas seriam 18 idas ao banco
 * por carregamento de tela, contra um pool de 5 conexoes (`PG_POOL_MAX`) --
 * as ultimas ficariam na fila esperando as primeiras devolverem a conexao.
 *
 * Exige que a tabela EXISTA: `ovhInstaladoNoBanco()` primeiro. Sem tabela, esta
 * consulta falha na analise sintatica, nao em execucao, e nenhum `coalesce`
 * salvaria -- e por isso a verificacao de instalacao e uma viagem separada.
 */
export async function getDisponibilidadeOvh(
  f: FiltroOvhSemMoeda,
): Promise<DisponibilidadeOvh> {
  const p = new ConstrutorParams();
  const where = condicoesBase(f, p).join(" AND ");

  const linha = await queryOne<{
    tem_algum: boolean;
    fontes: string[] | null;
    moedas: TotalMoedaOvh[] | null;
  }>(
    `WITH origens AS (
       SELECT DISTINCT source FROM ovh_monthly_costs
     ),
     janela AS (
       SELECT c.currency, sum(c.amount) AS total, count(*) AS linhas
         FROM ovh_monthly_costs c
        WHERE ${where}
        GROUP BY c.currency
     )
     SELECT
       (SELECT EXISTS (SELECT 1 FROM ovh_monthly_costs))                AS tem_algum,
       (SELECT coalesce(array_agg(source ORDER BY source), '{}')
          FROM origens)                                                 AS fontes,
       -- json_agg e nao array_agg: o driver entrega json ja desserializado,
       -- enquanto um array de composite viria como string para parsear a mao.
       (SELECT coalesce(
                 json_agg(json_build_object(
                   'moeda', currency, 'total', total, 'linhas', linhas
                 ) ORDER BY total DESC, currency),
                 '[]'::json)
          FROM janela)                                                  AS moedas`,
    p.lista,
  );

  return {
    temAlgumDado: linha?.tem_algum ?? false,
    fontes: (linha?.fontes ?? []) as FonteOvh[],
    // `total` e `linhas` vem de json_build_object sobre numeric/bigint: o
    // Postgres serializa numeric como NUMERO em json, mas `toNumber` cobre o
    // caso de ele sair como string em versao futura.
    moedas: (linha?.moedas ?? []).map((m) => ({
      moeda: m.moeda,
      total: toNumber(m.total),
      linhas: Number(m.linhas),
    })),
  };
}

/**
 * Linhas do periodo que ficaram FORA do recorte "todas as contas ativas".
 *
 * Existe por causa da resolucao de "todas" em lista explicita: custo de conta
 * OVH que nao esta ativa em `cloud_accounts` deixa de entrar nos numeros, e essa
 * queda precisa ser DITA. Sem esta contagem, o total cairia e nada na tela
 * explicaria por que -- que e a forma mais cara de errar num painel de custo.
 *
 * A janela e a origem sao as mesmas do recorte; o que muda e a negacao do
 * conjunto de contas. `<> ALL` e nao `NOT IN`: com um elemento NULL no array,
 * `NOT IN` devolveria zero linhas em silencio.
 */
export async function contarLinhasForaDoCadastroOvh(
  f: Omit<FiltroOvhSemMoeda, "contas">,
  idsAtivos: string[],
): Promise<number> {
  if (idsAtivos.length === 0) return 0;

  const p = new ConstrutorParams();
  const condicoes = condicoesBase({ ...f, contas: undefined }, p);
  condicoes.push(`c.provider_account_id <> ALL(${p.add(idsAtivos)}::text[])`);

  const linha = await queryOne<{ linhas: string }>(
    `SELECT count(*) AS linhas
       FROM ovh_monthly_costs c
      WHERE ${condicoes.join(" AND ")}`,
    p.lista,
  );
  return Number(linha?.linhas ?? 0);
}

// -------------------------------------------------------------------- resumo

export type ResumoOvh = {
  total: number;
  linhas: number;
  /** Projetos DISTINTOS com custo. Exclui a linha de fatura sem projeto. */
  projetosComCusto: number;
  servicos: number;
  mesesComDado: number;
  /** "AAAA-MM" ou `null` quando nao ha linha. */
  primeiroMes: string | null;
  ultimoMes: string | null;
  /**
   * Custo que a fatura nao atribui a projeto nenhum
   * (`project_service_name = ''`).
   *
   * NAO e erro de coleta: o DDL usa '' com o significado "nao se aplica",
   * porque em indice UNIQUE do Postgres NULL nunca e igual a NULL e a coluna
   * participa da chave do upsert. Taxa de dominio e assinatura entram aqui.
   * A tela precisa dizer isso, senao a soma por projeto parece nao fechar.
   */
  custoSemProjeto: number;
};

export async function getResumoOvh(f: FiltroOvh): Promise<ResumoOvh> {
  const p = new ConstrutorParams();
  const where = onde(f, p);

  const linha = await queryOne<{
    total: string | null;
    linhas: string;
    projetos: string;
    servicos: string;
    meses: string;
    primeiro_mes: string | null;
    ultimo_mes: string | null;
    sem_projeto: string | null;
  }>(
    `SELECT sum(c.amount)                                    AS total,
            count(*)                                         AS linhas,
            count(DISTINCT nullif(c.project_service_name, '')) AS projetos,
            count(DISTINCT c.service_label)                  AS servicos,
            count(DISTINCT c.billing_month)                  AS meses,
            to_char(min(c.billing_month), 'YYYY-MM')         AS primeiro_mes,
            to_char(max(c.billing_month), 'YYYY-MM')         AS ultimo_mes,
            sum(c.amount) FILTER (WHERE c.project_service_name = '') AS sem_projeto
       FROM ovh_monthly_costs c
      WHERE ${where}`,
    p.lista,
  );

  return {
    // `sum` de conjunto vazio devolve NULL, nao 0. `toNumber` resolve, mas quem
    // le o numero precisa do `linhas` ao lado para saber se o zero e real.
    total: toNumber(linha?.total),
    linhas: Number(linha?.linhas ?? 0),
    projetosComCusto: Number(linha?.projetos ?? 0),
    servicos: Number(linha?.servicos ?? 0),
    mesesComDado: Number(linha?.meses ?? 0),
    primeiroMes: linha?.primeiro_mes ?? null,
    ultimoMes: linha?.ultimo_mes ?? null,
    custoSemProjeto: toNumber(linha?.sem_projeto),
  };
}

/** Só o total -- usado para a janela anterior, na comparacao. */
export async function getTotalOvh(f: FiltroOvh): Promise<number> {
  const p = new ConstrutorParams();
  const where = onde(f, p);

  const linha = await queryOne<{ total: string | null }>(
    `SELECT sum(c.amount) AS total FROM ovh_monthly_costs c WHERE ${where}`,
    p.lista,
  );
  return toNumber(linha?.total);
}

// ------------------------------------------------------------ serie mensal

export type PontoMensalOvh = {
  /** "AAAA-MM". */
  mes: string;
  total: number;
  linhas: number;
};

/**
 * Evolucao mensal do custo faturado.
 *
 * Devolve SOMENTE os meses com linha. Os meses vazios da janela sao
 * preenchidos pelo servico com `total: null` -- e nao com zero -- porque mes
 * sem fatura nao e mes de custo zero, e a linha do grafico deve ter buraco ali
 * em vez de mergulhar ate a base.
 */
export async function getMensalOvh(f: FiltroOvh): Promise<PontoMensalOvh[]> {
  const p = new ConstrutorParams();
  const where = onde(f, p);

  const linhas = await query<{ mes: string; total: string; linhas: string }>(
    `SELECT to_char(c.billing_month, 'YYYY-MM') AS mes,
            sum(c.amount)                       AS total,
            count(*)                            AS linhas
       FROM ovh_monthly_costs c
      WHERE ${where}
      GROUP BY c.billing_month
      ORDER BY c.billing_month`,
    p.lista,
  );

  return linhas.map((l) => ({
    mes: l.mes,
    total: toNumber(l.total),
    linhas: Number(l.linhas),
  }));
}

// ---------------------------------------------------------------- servicos

export type ServicoOvh = {
  servico: string;
  /** `null` quando o servico aparece em mais de uma categoria, ou em nenhuma. */
  categoria: string | null;
  total: number;
  linhas: number;
};

/**
 * Top N servicos por custo, agrupados por `service_label`.
 *
 * A categoria vem junto so quando e UNICA para aquele rotulo. `min(category)`
 * sozinho escolheria uma das varias e a tela exibiria uma classificacao que o
 * dado nao sustenta -- por isso o `count(DISTINCT ...)` ao lado decide se o
 * valor pode ser mostrado.
 */
export async function getServicosOvh(
  f: FiltroOvh,
  limite = 10,
): Promise<ServicoOvh[]> {
  const p = new ConstrutorParams();
  const where = onde(f, p);
  const lim = p.add(limite);

  const linhas = await query<{
    servico: string;
    categoria: string | null;
    categorias: string;
    total: string;
    linhas: string;
  }>(
    `SELECT c.service_label                              AS servico,
            min(nullif(c.category, ''))                  AS categoria,
            count(DISTINCT nullif(c.category, ''))       AS categorias,
            sum(c.amount)                                AS total,
            count(*)                                     AS linhas
       FROM ovh_monthly_costs c
      WHERE ${where}
      GROUP BY c.service_label
      ORDER BY sum(c.amount) DESC, c.service_label
      LIMIT ${lim}`,
    p.lista,
  );

  return linhas.map((l) => ({
    servico: l.servico,
    categoria: Number(l.categorias) === 1 ? l.categoria : null,
    total: toNumber(l.total),
    linhas: Number(l.linhas),
  }));
}

// ---------------------------------------------------------------- projetos

export type ProjetoOvh = {
  /** `ovh_projects.service_name`. String vazia = custo nao atribuido. */
  servicoDoProjeto: string;
  /** Descricao do console, ou o proprio id, ou `null` quando nao atribuido. */
  nome: string | null;
  total: number;
  linhas: number;
};

/**
 * Custo por projeto.
 *
 * LEFT JOIN em `ovh_projects` de proposito: um projeto excluido na OVH deixa de
 * existir na tabela de projetos mas o custo dele continua na fatura. Com INNER
 * JOIN essa linha desapareceria da tela -- custo que existe no banco e nao
 * aparece em lugar nenhum e pior do que custo sem nome.
 */
export async function getProjetosOvh(f: FiltroOvh): Promise<ProjetoOvh[]> {
  const p = new ConstrutorParams();
  const where = onde(f, p);

  const linhas = await query<{
    servico_do_projeto: string;
    nome: string | null;
    total: string;
    linhas: string;
  }>(
    `SELECT c.project_service_name AS servico_do_projeto,
            CASE WHEN c.project_service_name = '' THEN NULL
                 ELSE coalesce(nullif(p.description, ''), c.project_service_name)
             END                   AS nome,
            sum(c.amount)          AS total,
            count(*)               AS linhas
       FROM ovh_monthly_costs c
       LEFT JOIN ovh_projects p
              ON p.provider_account_id = c.provider_account_id
             AND p.service_name        = c.project_service_name
      WHERE ${where}
      GROUP BY c.project_service_name, p.description
      ORDER BY sum(c.amount) DESC, c.project_service_name`,
    p.lista,
  );

  return linhas.map((l) => ({
    servicoDoProjeto: l.servico_do_projeto,
    nome: l.nome,
    total: toNumber(l.total),
    linhas: Number(l.linhas),
  }));
}

/** Projetos oferecidos no filtro: apenas os que TEM custo na origem escolhida. */
export async function getProjetosDisponiveisOvh(
  f: FiltroOvhSemMoeda,
): Promise<{ servicoDoProjeto: string; nome: string }[]> {
  const p = new ConstrutorParams();
  // Sem o filtro de projeto: a lista precisa conter todas as opcoes, inclusive
  // quando uma delas ja esta selecionada.
  const where = condicoesBase({ ...f, projeto: undefined }, p).join(" AND ");

  const linhas = await query<{ servico_do_projeto: string; nome: string }>(
    `SELECT DISTINCT
            c.project_service_name AS servico_do_projeto,
            coalesce(nullif(p.description, ''), c.project_service_name) AS nome
       FROM ovh_monthly_costs c
       LEFT JOIN ovh_projects p
              ON p.provider_account_id = c.provider_account_id
             AND p.service_name        = c.project_service_name
      WHERE ${where}
        AND c.project_service_name <> ''
      ORDER BY nome`,
    p.lista,
  );

  return linhas.map((l) => ({
    servicoDoProjeto: l.servico_do_projeto,
    nome: l.nome,
  }));
}

// ------------------------------------------------------------------ contas

export type ContaOvh = {
  providerAccountId: string;
  /** Alias do cadastro OVH; `null` quando a conta nunca recebeu um. */
  alias: string | null;
  /** Moeda de faturamento DA CONTA, conforme a OVH -- nao a moeda das linhas. */
  moeda: string | null;
  /** Estado do cadastro na OVH (ex.: "complete"). */
  estado: string | null;
};

/**
 * Contas OVH integradas -- procedencia dos numeros desta visao.
 *
 * `nichandle` NAO sai daqui, e a omissao e o ponto principal desta funcao. Ele e
 * o LOGIN da conta OVH (um e-mail), nao um rotulo: mandar para o navegador
 * publicaria o identificador de acesso do provedor numa tela que qualquer
 * usuario com `dashboard:view` abre. `raw_json` fica fora pelo mesmo motivo de
 * sempre -- e a resposta crua da API, com campos que ninguem auditou.
 *
 * Tabela vazia distingue duas falhas que o resto da visao confunde: "o collector
 * nunca sincronizou conta alguma" (integracao nao comecou) e "sincronizou a
 * conta mas nao trouxe custo" (integracao viva, periodo sem dado).
 */
export async function getContasOvh(): Promise<ContaOvh[]> {
  const linhas = await query<{
    provider_account_id: string;
    account_alias: string | null;
    currency: string | null;
    state: string | null;
  }>(
    `SELECT provider_account_id, account_alias, currency, state
       FROM ovh_provider_accounts
      ORDER BY coalesce(account_alias, provider_account_id) ASC`,
  );

  return linhas.map((l) => ({
    providerAccountId: l.provider_account_id,
    alias: l.account_alias,
    moeda: l.currency,
    estado: l.state,
  }));
}

/** Total de projetos cadastrados -- card "Projetos OVH", fonte `ovh_projects`. */
export async function contarProjetosOvh(): Promise<number> {
  const linha = await queryOne<{ total: string }>(
    `SELECT count(*) AS total FROM ovh_projects`,
  );
  return Number(linha?.total ?? 0);
}

// ----------------------------------------------------------------- faturas

export type FaturaOvh = {
  billId: string;
  /** `provider_account_id` -- a fatura e da conta, nao do projeto. */
  conta: string;
  /**
   * `autorenew` | `purchase-servers` | `purchase-web` | `null`.
   *
   * A API de faturamento da OVH NAO expoe situacao de pagamento -- nao ha campo
   * "pago/em aberto" em `/me/bill`. `category` e o que existe: diz por que a
   * fatura foi emitida, nao se foi quitada. Rotular isso de "status" na tela
   * faria alguem concluir que a fatura esta paga.
   */
  categoria: string | null;
  /** "AAAA-MM-DD" ou `null`. */
  billDate: string | null;
  /** "AAAA-MM" ou `null`. */
  billingMonth: string | null;
  totalComImposto: number;
  totalSemImposto: number;
  imposto: number;
  moeda: string;
  /** Linhas de detalhe importadas para esta fatura. */
  linhas: number;
};

export type FaturasOvh = {
  itens: FaturaOvh[];
  /**
   * Cabecalhos de fatura com `billing_month` NULO.
   *
   * `ovh_invoice_headers.billing_month` e NULLABLE no DDL. Uma fatura sem esse
   * campo nao casa com NENHUM filtro de periodo -- ela desaparece de todas as
   * janelas em silencio. Contar essas linhas e a unica forma de a tela nao
   * afirmar "3 faturas no periodo" quando existem 4 no banco.
   */
  semMesAtribuido: number;
};

/**
 * Só a contagem de faturas na janela -- card "Faturas no período".
 *
 * Existe separada de `getFaturasOvh` para o resumo nao precisar trazer 60 linhas
 * de cabecalho para exibir um numero.
 */
export async function contarFaturasOvh(
  f: Pick<FiltroOvh, "deMes" | "ateMes" | "contas">,
): Promise<number> {
  const p = new ConstrutorParams();
  const de = p.add(f.deMes);
  const ate = p.add(f.ateMes);
  const filtroConta =
    f.contas !== undefined && f.contas.length > 0
      ? ` AND provider_account_id = ANY(${p.add(f.contas)}::text[])`
      : "";

  const linha = await queryOne<{ total: string }>(
    `SELECT count(*) AS total
       FROM ovh_invoice_headers
      WHERE billing_month >= to_date(${de}, 'YYYY-MM')
        AND billing_month <= to_date(${ate}, 'YYYY-MM')${filtroConta}`,
    p.lista,
  );
  return Number(linha?.total ?? 0);
}

/**
 * Faturas cujo mes de competencia cai na janela.
 *
 * NAO filtra por `source` (cabecalho de fatura nao tem origem), nem por projeto
 * (a fatura e da conta, nao do projeto), nem por moeda -- cada linha exibe a
 * propria. Contar faturas de moedas diferentes e legitimo; soma-las nao seria,
 * e por isso esta funcao devolve linhas e nao total.
 */
export async function getFaturasOvh(
  f: Pick<FiltroOvh, "deMes" | "ateMes" | "contas">,
  limite = 60,
  deslocamento = 0,
): Promise<FaturasOvh> {
  const p = new ConstrutorParams();
  const de = p.add(f.deMes);
  const ate = p.add(f.ateMes);
  const lim = p.add(limite);
  const off = p.add(deslocamento);
  const filtroConta =
    f.contas !== undefined && f.contas.length > 0
      ? ` AND h.provider_account_id = ANY(${p.add(f.contas)}::text[])`
      : "";

  const itens = await query<{
    bill_id: string;
    bill_date: string | null;
    billing_month: string | null;
    total_com_imposto: string | null;
    total_sem_imposto: string | null;
    imposto: string | null;
    currency: string | null;
    conta: string;
    categoria: string | null;
    linhas: string;
  }>(
    `SELECT h.bill_id,
            to_char(h.bill_date, 'YYYY-MM-DD')      AS bill_date,
            to_char(h.billing_month, 'YYYY-MM')     AS billing_month,
            h.total_with_tax                        AS total_com_imposto,
            h.total_without_tax                     AS total_sem_imposto,
            h.tax                                   AS imposto,
            h.currency,
            h.provider_account_id                   AS conta,
            -- So a chave category, e nao o raw_json inteiro: aquele objeto
            -- carrega password (a senha do PDF da fatura na OVH) e url. Uma
            -- coluna extraida no servidor da o rotulo sem levar o resto junto.
            h.raw_json->>'category'                 AS categoria,
            coalesce(l.linhas, 0)                   AS linhas
       FROM ovh_invoice_headers h
       LEFT JOIN (SELECT provider_account_id, bill_id, count(*) AS linhas
                    FROM ovh_invoice_lines
                   GROUP BY provider_account_id, bill_id) l
              ON l.provider_account_id = h.provider_account_id
             AND l.bill_id             = h.bill_id
      WHERE h.billing_month >= to_date(${de}, 'YYYY-MM')
        AND h.billing_month <= to_date(${ate}, 'YYYY-MM')${filtroConta}
      ORDER BY h.billing_month DESC, h.bill_date DESC NULLS LAST, h.bill_id DESC
      LIMIT ${lim} OFFSET ${off}`,
    p.lista,
  );

  // Tambem recortado pelas contas selecionadas. Um numero global aqui diria
  // "3 faturas sem mes atribuido" ao lado de uma lista de UMA conta que nao tem
  // nenhuma -- e o aviso mandaria procurar o que nao existe naquele recorte.
  const q = new ConstrutorParams();
  const filtroContaSemMes =
    f.contas !== undefined && f.contas.length > 0
      ? ` AND provider_account_id = ANY(${q.add(f.contas)}::text[])`
      : "";
  const semMes = await queryOne<{ total: string }>(
    `SELECT count(*) AS total
       FROM ovh_invoice_headers
      WHERE billing_month IS NULL${filtroContaSemMes}`,
    q.lista,
  );

  return {
    itens: itens.map((l) => ({
      billId: l.bill_id,
      conta: l.conta,
      categoria: l.categoria,
      billDate: l.bill_date,
      billingMonth: l.billing_month,
      totalComImposto: toNumber(l.total_com_imposto),
      totalSemImposto: toNumber(l.total_sem_imposto),
      imposto: toNumber(l.imposto),
      // `currency` e NULLABLE no cabecalho. Sem fallback, `formatMoeda` receberia
      // null e cairia em USD por omissao -- inventando a moeda de uma fatura.
      moeda: l.currency ?? "—",
      linhas: Number(l.linhas),
    })),
    semMesAtribuido: Number(semMes?.total ?? 0),
  };
}


/**
 * Contas OVH do CADASTRO DO PORTAL -- a lista do seletor de contas.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `cloud_accounts` E NAO `ovh_provider_accounts`
 *
 * As duas tabelas tem alias, e ELAS DISCORDAM. `ovh_provider_accounts` guarda o
 * que o collector leu da OVH; `app_account_settings` guarda o que um ADMIN
 * digitou em Configuracoes > Contas Cloud. Em producao a mesma conta aparece
 * como "OVH Principal" na primeira e "OVH Canada" na segunda.
 *
 * A regra do portal e explicita e vale aqui: o alias definido em Contas Cloud
 * substitui o nome do cadastro nos FILTROS, nos cards, na tabela analitica e nas
 * exportacoes. Ler a outra tabela faria este seletor ser o unico lugar do portal
 * a chamar a conta por outro nome -- e quem renomeasse a conta veria a mudanca
 * em toda parte menos aqui.
 *
 * `active` tambem so existe em `cloud_accounts`: conta desativada nao deve
 * aparecer como opcao de filtro.
 *
 * NAO ha contas AWS nesta lista: `provider = 'ovh'` esta na consulta, e nao numa
 * verificacao posterior que alguem possa esquecer de repetir.
 */
export type ContaOvhDoCadastro = {
  id: string;
  nome: string;
  /** Unidade de negocio. Segunda linha do seletor, junto do id. `null` = sem. */
  unidade: string | null;
};

export async function getContasOvhDoCadastro(): Promise<ContaOvhDoCadastro[]> {
  // `app_account_settings` e da migracao 002. Sem ela, um LEFT JOIN lancaria e
  // derrubaria a tela inteira -- degradar para `account_name` mostra um rotulo
  // ANTERIOR, nunca um nome errado. Mesma disciplina de `alias-conta.ts`.
  const comAlias = await aliasDisponivel();

  const nome = comAlias
    ? `coalesce(nullif(btrim(s.alias), ''), nullif(btrim(a.account_name), ''), a.account_id)`
    : `coalesce(nullif(btrim(a.account_name), ''), a.account_id)`;
  // A unidade da tela de Contas Cloud (`app_account_settings`) tem precedencia
  // sobre a de `cloud_accounts` pelo mesmo motivo do alias: e a que a pessoa
  // editou no portal, e mostrar a outra faria o filtro contradizer o cadastro.
  const unidade = comAlias
    ? `coalesce(nullif(btrim(s.business_unit), ''), nullif(btrim(a.business_unit), ''))`
    : `nullif(btrim(a.business_unit), '')`;
  const juncao = comAlias
    ? "LEFT JOIN app_account_settings s ON s.account_id = a.account_id"
    : "";

  const linhas = await query<{
    account_id: string;
    nome: string;
    unidade: string | null;
  }>(
    `SELECT a.account_id, ${nome} AS nome, ${unidade} AS unidade
       FROM cloud_accounts a
       ${juncao}
      WHERE a.provider = 'ovh'
        AND a.active
      ORDER BY nome ASC, a.account_id ASC`,
  );
  return linhas.map((l) => ({
    id: l.account_id,
    nome: l.nome,
    unidade: l.unidade,
  }));
}


export type SituacaoContaOvh = {
  id: string;
  nome: string;
  /** `status` da ULTIMA execucao daquela conta. `null` = nunca coletada. */
  ultimoStatus: string | null;
  /** ISO-8601 do fim da ultima execucao. `null` quando nunca terminou. */
  ultimoFim: string | null;
  /** Ha linha em `cloud_provider_credentials`? `null` = migracao 006 ausente. */
  temCredencial: boolean | null;
};

/**
 * Uma linha por conta OVH ATIVA, com o resultado da ultima coleta dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE POR CONTA, E NAO UM STATUS SO
 *
 * O card do collector dizia "coleta em dia" a partir da ULTIMA execucao
 * registrada, qualquer que fosse a conta. Com uma conta so isso e correto. Com
 * duas, uma coleta bem-sucedida da conta A produziria "coleta em dia" enquanto a
 * conta B falha ha uma semana -- e o painel afirmaria saude que nao existe.
 *
 * `DISTINCT ON` pega a ultima execucao POR CONTA numa passagem. A alternativa
 * (subconsulta com max(started_at) por conta) le a tabela duas vezes para
 * responder a mesma pergunta.
 *
 * `LEFT JOIN`: conta cadastrada que nunca foi coletada aparece com
 * `ultimoStatus: null`. Some-la da lista esconderia justamente a conta que
 * ninguem coletou.
 */
export async function getSituacaoPorContaOvh(): Promise<SituacaoContaOvh[]> {
  const contas = await getContasOvhDoCadastro();
  if (contas.length === 0) return [];

  const ids = contas.map((c) => c.id);

  const execucoes = await query<{
    provider_account_id: string;
    status: string;
    finished_at: Date | null;
  }>(
    `SELECT DISTINCT ON (r.provider_account_id)
            r.provider_account_id, r.status, r.finished_at
       FROM ovh_sync_runs r
      WHERE r.provider_account_id = ANY($1::text[])
      ORDER BY r.provider_account_id, r.started_at DESC`,
    [ids],
  );

  const porConta = new Map(execucoes.map((e) => [e.provider_account_id, e]));

  // A tabela de credenciais e da migracao 006. Sem ela, `temCredencial` fica
  // `null` -- "nao sei" e nao "nao tem": afirmar ausencia mandaria alguem
  // cadastrar credencial que ja pode existir.
  const temTabela = await queryOne<{ existe: boolean }>(
    `SELECT to_regclass('public.cloud_provider_credentials') IS NOT NULL AS existe`,
  );

  const comCredencial = new Set<string>();
  if (temTabela.existe) {
    const linhas = await query<{ account_id: string }>(
      `SELECT account_id FROM cloud_provider_credentials
        WHERE provider = 'ovh' AND account_id = ANY($1::text[])`,
      [ids],
    );
    for (const l of linhas) comCredencial.add(l.account_id);
  }

  return contas.map((c) => {
    const e = porConta.get(c.id);
    return {
      id: c.id,
      nome: c.nome,
      ultimoStatus: e?.status ?? null,
      ultimoFim: e?.finished_at ? e.finished_at.toISOString() : null,
      temCredencial: temTabela.existe ? comCredencial.has(c.id) : null,
    };
  });
}
