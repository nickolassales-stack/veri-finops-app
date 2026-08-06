import { z } from "zod";

import {
  MAX_DIAS_PERIODO,
  PRESETS_PERIODO,
  contarDias,
  ehDataISOValida,
} from "./periodo";

/**
 * Validacao de tudo que chega pela URL.
 *
 * Nada aqui e opcional do ponto de vista de seguranca: o resultado destes
 * esquemas e a UNICA coisa que a camada de query aceita. Valor que nao passou
 * por aqui nao chega ao banco.
 *
 * Dois tipos de protecao convivem:
 *
 * - Valores (datas, ids de conta, termo de busca) viram PARAMETRO da query
 *   ($1, $2...). A validacao existe para dar erro claro e limitar custo, nao
 *   para evitar injecao -- disso o placeholder ja cuida.
 * - Campo de ordenacao e direcao NAO podem ser parametro no protocolo do
 *   Postgres, entao vao para o texto do SQL. Para esses a lista fechada de
 *   `z.enum` e a propria protecao, reforcada por `identificadorPermitido()`
 *   na hora de montar a query.
 */

/** Valor sentinela para as linhas em que o ETL nao gravou regiao. */
export const REGIAO_NAO_INFORMADA = "nao-informado";

/**
 * O ETL grava a string literal "nan" (um NaN do pandas serializado) em ~80% das
 * linhas. Do ponto de vista do usuario isso e "nao informado", nao uma regiao.
 */
export const REGIAO_CRUA_INVALIDA = "nan";

/** Aceito em `?contas=` para dizer explicitamente "todas as contas". */
export const TODAS_AS_CONTAS = "todas";

/** Teto de contas por consulta -- evita URL gigante e IN() sem limite. */
const MAX_CONTAS = 50;

/**
 * `account_id` e `varchar(20)`. Nao restringimos a 12 digitos da AWS de
 * proposito: o cadastro e livre e a aplicacao nao deve inventar regra que o
 * banco nao tem.
 */
const ID_CONTA = /^[A-Za-z0-9_-]{1,20}$/;

const REGIAO_VALIDA = /^[A-Za-z0-9-]{1,32}$/;

const dataISO = z
  .string()
  .trim()
  .refine(ehDataISOValida, "Use uma data real no formato AAAA-MM-DD.");

// ------------------------------------------------------------------- periodo

export const camposPeriodo = {
  periodo: z
    .enum(PRESETS_PERIODO, {
      error: () => `Periodo deve ser um de: ${PRESETS_PERIODO.join(", ")}.`,
    })
    .optional(),
  de: dataISO.optional(),
  ate: dataISO.optional(),
};

type EntradaPeriodoBruta = {
  periodo?: (typeof PRESETS_PERIODO)[number];
  de?: string;
  ate?: string;
};

/**
 * Regras que dependem de mais de um campo. Aplicada com `.superRefine()` em
 * todo esquema que inclua `camposPeriodo`.
 */
export function regrasPeriodo(
  valor: EntradaPeriodoBruta,
  ctx: z.RefinementCtx,
): void {
  const { periodo, de, ate } = valor;
  const temIntervalo = Boolean(de || ate);

  if (periodo && periodo !== "personalizado" && temIntervalo) {
    ctx.addIssue({
      code: "custom",
      path: ["de"],
      message: `"de" e "ate" so valem com periodo=personalizado (recebido: ${periodo}).`,
    });
    return;
  }

  if ((periodo === "personalizado" || temIntervalo) && !(de && ate)) {
    ctx.addIssue({
      code: "custom",
      path: [de ? "ate" : "de"],
      message: "Periodo personalizado exige as duas datas: de e ate.",
    });
    return;
  }

  if (de && ate) {
    if (de > ate) {
      ctx.addIssue({
        code: "custom",
        path: ["ate"],
        message: `"ate" (${ate}) nao pode ser anterior a "de" (${de}).`,
      });
      return;
    }
    const dias = contarDias(de, ate);
    if (dias > MAX_DIAS_PERIODO) {
      ctx.addIssue({
        code: "custom",
        path: ["ate"],
        message: `Periodo de ${dias} dias excede o maximo de ${MAX_DIAS_PERIODO}.`,
      });
    }
  }
}

// -------------------------------------------------------------------- contas

function dividirLista(valor: string): string[] {
  return valor
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * `?contas=a,b,c`, `?contas=todas` ou ausente.
 *
 * Resultado sempre normalizado para array: vazio significa "todas as contas".
 * Nenhum id de conta e fixo no codigo -- a lista de contas vem de
 * `cloud_accounts` em `/api/accounts`.
 */
const listaContas = z
  .string()
  .trim()
  .superRefine((valor, ctx) => {
    if (valor === "" || valor.toLowerCase() === TODAS_AS_CONTAS) return;

    const partes = dividirLista(valor);
    if (partes.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Lista de contas vazia. Omita o parametro ou use "${TODAS_AS_CONTAS}".`,
      });
      return;
    }
    if (partes.length > MAX_CONTAS) {
      ctx.addIssue({
        code: "custom",
        message: `Maximo de ${MAX_CONTAS} contas por consulta (recebidas ${partes.length}).`,
      });
      return;
    }
    for (const parte of partes) {
      if (!ID_CONTA.test(parte)) {
        ctx.addIssue({
          code: "custom",
          message: `Identificador de conta invalido: "${parte}".`,
        });
      }
    }
  })
  .transform((valor) => {
    if (valor === "" || valor.toLowerCase() === TODAS_AS_CONTAS) return [] as string[];
    return [...new Set(dividirLista(valor))];
  });

export const camposContas = {
  contas: listaContas.optional().transform((v) => v ?? []),
};

// -------------------------------------------------------------------- regiao

/**
 * `?regiao=us-east-1b` ou `?regiao=nao-informado`.
 *
 * A coluna `region` guarda zona de disponibilidade (`us-east-1b`), nao regiao
 * -- o ETL alimenta errado. O filtro repassa o valor como esta na base; a
 * correcao pertence ao ETL. Ver docs/schema-snapshot.md, achado 1.
 */
export const camposRegiao = {
  regiao: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || v === REGIAO_NAO_INFORMADA || REGIAO_VALIDA.test(v),
      "Regiao invalida.",
    )
    .transform((v) =>
      v === "" ? undefined : v.toLowerCase() === REGIAO_CRUA_INVALIDA ? REGIAO_NAO_INFORMADA : v,
    )
    .optional(),
};

// ---------------------------------------------------------------- paginacao

export const MAX_TAMANHO_PAGINA = 200;

export const camposPaginacao = {
  pagina: z.coerce
    .number({ error: "Pagina deve ser um numero inteiro." })
    .int("Pagina deve ser um numero inteiro.")
    .min(1, "Pagina comeca em 1.")
    .max(10_000, "Pagina fora do intervalo permitido.")
    .default(1),
  tamanho: z.coerce
    .number({ error: "Tamanho de pagina deve ser um numero inteiro." })
    .int("Tamanho de pagina deve ser um numero inteiro.")
    .min(1, "Tamanho de pagina minimo e 1.")
    .max(MAX_TAMANHO_PAGINA, `Tamanho de pagina maximo e ${MAX_TAMANHO_PAGINA}.`)
    .default(50),
};

// -------------------------------------------------------------------- busca

export const camposBusca = {
  busca: z
    .string()
    .trim()
    .max(100, "Termo de busca muito longo (maximo 100 caracteres).")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
};

// ---------------------------------------------------------------- ordenacao

export type Direcao = "asc" | "desc";

/**
 * Monta os campos de ordenacao a partir de uma lista FECHADA de nomes logicos.
 *
 * O nome logico ("custo", "nome") nao e o nome da coluna: a traducao para SQL
 * acontece na camada de query, por mapa. Assim o contrato da API nao vaza o
 * schema do banco e nao existe caminho de um texto do usuario para o SQL.
 */
export function camposOrdenacao<const T extends readonly [string, ...string[]]>(
  campos: T,
  padrao: T[number],
  direcaoPadrao: Direcao = "desc",
) {
  return {
    ordenarPor: z
      .enum(campos, { error: () => `Ordenacao deve ser uma de: ${campos.join(", ")}.` })
      .default(padrao),
    direcao: z
      .enum(["asc", "desc"], { error: () => 'Direcao deve ser "asc" ou "desc".' })
      .default(direcaoPadrao),
  };
}

// ------------------------------------------------------- leitura da query string

/**
 * URLSearchParams -> objeto simples, com ausente virando `undefined`.
 *
 * `undefined` (e nao `null` nem `""`) e o que dispara `.default()` e
 * `.optional()` no Zod. Passar o objeto cru do `searchParams` faria todo
 * default silenciosamente virar erro de tipo.
 *
 * Le apenas a PRIMEIRA ocorrencia de cada chave: `?pagina=1&pagina=99` nao deve
 * virar array e confundir a validacao.
 */
export function lerParametros(url: URL): Record<string, string | undefined> {
  const saida: Record<string, string | undefined> = {};
  for (const [chave, valor] of url.searchParams) {
    if (!(chave in saida)) saida[chave] = valor;
  }
  return saida;
}
