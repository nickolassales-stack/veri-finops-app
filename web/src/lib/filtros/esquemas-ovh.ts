import { z } from "zod";

import { FONTES_OVH } from "./esquemas";
import {
  MAX_MESES_PERIODO,
  PRESETS_MES,
  PRESET_MES_PADRAO,
  contarMeses,
  ehMesISOValido,
} from "./periodo-mensal";

/**
 * Validacao dos parametros da visao OVH do dashboard.
 *
 * Separado de `esquemas.ts` porque o vocabulario e outro: periodo em MESES em
 * vez de dias, origem obrigatoria, projeto em vez de conta. Misturar os dois
 * faria os endpoints da AWS aceitarem `?periodo=12m` -- que eles nao sabem
 * resolver -- e a tela OVH aceitar `?periodo=7d`, que na granularidade mensal
 * ou devolve o mes inteiro ou devolve nada.
 *
 * Mesma regra de sempre: o resultado destes esquemas e a UNICA coisa que a
 * camada de query aceita.
 */

const mesISO = z
  .string()
  .trim()
  .refine(ehMesISOValido, "Use um mês real no formato AAAA-MM.");

// ------------------------------------------------------------ periodo mensal

export const camposPeriodoMensal = {
  periodo: z
    .enum(PRESETS_MES, {
      error: () => `Periodo deve ser um de: ${PRESETS_MES.join(", ")}.`,
    })
    .default(PRESET_MES_PADRAO),
  deMes: mesISO.optional(),
  ateMes: mesISO.optional(),
};

type EntradaPeriodoMensalBruta = {
  periodo?: (typeof PRESETS_MES)[number];
  deMes?: string;
  ateMes?: string;
};

/**
 * Regras entre campos. Espelha `regrasPeriodo()` de propósito: quem ja conhece
 * o erro do periodo diario encontra a mesma mensagem aqui, com "mes" no lugar
 * de "data".
 */
export function regrasPeriodoMensal(
  valor: EntradaPeriodoMensalBruta,
  ctx: z.RefinementCtx,
): void {
  const { periodo, deMes, ateMes } = valor;
  const temIntervalo = Boolean(deMes || ateMes);

  if (periodo && periodo !== "personalizado" && temIntervalo) {
    ctx.addIssue({
      code: "custom",
      path: ["deMes"],
      message: `"deMes" e "ateMes" so valem com periodo=personalizado (recebido: ${periodo}).`,
    });
    return;
  }

  if ((periodo === "personalizado" || temIntervalo) && !(deMes && ateMes)) {
    ctx.addIssue({
      code: "custom",
      path: [deMes ? "ateMes" : "deMes"],
      message: "Periodo personalizado exige os dois meses: deMes e ateMes.",
    });
    return;
  }

  if (deMes && ateMes) {
    if (deMes > ateMes) {
      // Comparacao de string funciona porque "AAAA-MM" e ordenavel
      // lexicograficamente -- a mesma propriedade que faz o ISO ser usado no
      // resto do projeto.
      ctx.addIssue({
        code: "custom",
        path: ["ateMes"],
        message: `"ateMes" (${ateMes}) nao pode ser anterior a "deMes" (${deMes}).`,
      });
      return;
    }

    const meses = contarMeses(deMes, ateMes);
    if (meses > MAX_MESES_PERIODO) {
      ctx.addIssue({
        code: "custom",
        path: ["ateMes"],
        message: `Periodo de ${meses} meses excede o maximo de ${MAX_MESES_PERIODO}.`,
      });
    }
  }
}

// ----------------------------------------------------------------- origem

/**
 * `?source=` COM PADRAO `invoice`, e nao opcional.
 *
 * A diferenca em relacao a `camposFonteOvh` de `esquemas.ts` e deliberada. La a
 * origem e um filtro opcional de uma tabela que a tela de Faturamento exibe
 * agrupada POR origem -- ausente significa "mostre as tres, separadas".
 *
 * Aqui a origem alimenta um TOTAL. Ausente teria de significar uma das duas
 * coisas: somar as tres (que triplica o custo, porque o mesmo projeto no mesmo
 * mes tem legitimamente linha nas tres) ou escolher uma escondido do usuario.
 * O padrao explicito `invoice` e a terceira opcao: o custo realizado, dito na
 * tela e visivel na URL.
 */
export const camposFonteOvhComPadrao = {
  source: z
    .enum(FONTES_OVH, {
      error: () => `Origem OVH deve ser uma de: ${FONTES_OVH.join(", ")}.`,
    })
    .default("invoice"),
};

// ---------------------------------------------------------------- projeto

/**
 * `ovh_projects.service_name` -- o id opaco da OVH, nao a descricao.
 *
 * Filtrar pela descricao seria mais bonito e estaria errado: `description` e o
 * nome que a pessoa deu no console e muda sem aviso, entao um link salvo
 * pararia de funcionar. A tela mostra a descricao e envia o `service_name`.
 */
export const camposProjetoOvh = {
  projeto: z
    .string()
    .trim()
    .max(120, "Identificador de projeto muito longo (maximo 120 caracteres).")
    .regex(/^[A-Za-z0-9_.:-]*$/, "Identificador de projeto invalido.")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
};

/**
 * Moeda do recorte.
 *
 * Existe porque `ovh_monthly_costs.currency` e por LINHA, e somar moedas
 * diferentes produz um numero que nao significa nada. Quando ausente, o serviço
 * escolhe a moeda com maior volume e diz qual escolheu -- nunca soma.
 */
export const camposMoedaOvh = {
  moeda: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Moeda deve ser um codigo ISO de 3 letras (ex.: USD).")
    .optional(),
};

/**
 * `ovh_provider_accounts.provider_account_id` -- o id interno do VERI FinOps,
 * nao o `nichandle` da OVH.
 *
 * O `nichandle` e um e-mail e identifica a PESSOA da conta; usa-lo como filtro
 * poria endereco de terceiro na URL e no histórico do navegador. O
 * `provider_account_id` e opaco e do nosso cadastro.
 *
 * Vazio vira `undefined` = todas as contas. O mesmo tratamento de `projeto`.
 */
const ID_CONTA = /^[A-Za-z0-9_-]{1,20}$/;

/** Teto de contas por consulta -- um `IN` com centenas de ids e URL montada a mao. */
export const MAX_CONTAS_FILTRO = 50;

/**
 * `?conta=` -- UMA OU MAIS contas, separadas por virgula.
 *
 * ---------------------------------------------------------------------------
 * POR QUE `conta` E NAO `contas`
 *
 * `contas` JA EXISTE, e e o filtro de contas da visao AWS (`filtros.ts`). As
 * duas visoes moram no mesmo caminho `/dashboard`, entao o mesmo nome com
 * significados diferentes -- id de 12 digitos da AWS de um lado, etiqueta
 * `ovh-cliente-ca` do outro -- faria uma URL colada de uma visao aplicar um
 * recorte silencioso na outra. O id AWS casa com o formato do id OVH, entao a
 * validacao nao pegaria: a tela mostraria custo zero como se fosse resposta.
 *
 * Ha um teste que guarda exatamente essa separacao, e foi ele que apontou a
 * colisao quando este filtro nasceu como `contas`.
 *
 * Manter o nome no singular tem um segundo beneficio: `?conta=ovh-main-ca`, a
 * forma antiga de valor unico, continua valendo SEM CAMADA DE COMPATIBILIDADE --
 * um id sozinho ja e uma lista de um item.
 *
 * ---------------------------------------------------------------------------
 * VIRGULA, E NAO REPETICAO DO PARAMETRO
 *
 * `lerParametros` -- que o resto do projeto usa -- devolve apenas a PRIMEIRA
 * ocorrencia de um parametro repetido. Um `?conta=a&conta=b` chegaria aqui como
 * `"a"`, e a segunda conta sumiria do recorte sem erro nenhum.
 *
 * VAZIO SIGNIFICA TODAS. Distinguir "nenhuma conta" de "todas" nao tem uso: uma
 * tela que nao mostra conta alguma nao e um recorte.
 */
export const camposContasOvh = {
  conta: z
    .string()
    .trim()
    .max(20 * MAX_CONTAS_FILTRO + MAX_CONTAS_FILTRO, "Lista de contas muito longa.")
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const ids = [
        ...new Set(
          v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        ),
      ];
      return ids.length === 0 ? undefined : ids;
    })
    .superRefine((ids, ctx) => {
      if (ids === undefined) return;
      if (ids.length > MAX_CONTAS_FILTRO) {
        ctx.addIssue({
          code: "custom",
          message: `Selecione no maximo ${MAX_CONTAS_FILTRO} contas.`,
        });
        return;
      }
      for (const id of ids) {
        if (!ID_CONTA.test(id)) {
          ctx.addIssue({
            code: "custom",
            message: `Identificador de conta invalido: "${id}".`,
          });
          return;
        }
      }
    }),
};

// ----------------------------------------------------------------- esquemas

export const esquemaDashboardOvh = z
  .object({
    ...camposPeriodoMensal,
    ...camposFonteOvhComPadrao,
    ...camposContasOvh,
    ...camposProjetoOvh,
    ...camposMoedaOvh,
  })
  .superRefine(regrasPeriodoMensal);

export type EntradaDashboardOvh = z.output<typeof esquemaDashboardOvh>;
