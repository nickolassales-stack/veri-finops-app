import "server-only";

import writeXlsxFile, { type SheetData } from "write-excel-file/node";

import { ROTULO_FONTE } from "@/lib/dashboard/ovh";
import { ConstrutorParams, query } from "@/lib/database";
import type { FiltroOvh } from "@/lib/queries/dashboard-ovh";

/**
 * Exportação da visão OVH — separada da AWS, e não um parâmetro dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM CAMINHO PRÓPRIO
 *
 * O export AWS lê `aws_daily_costs`; este lê `ovh_monthly_costs`. Não há
 * consulta que produza os dois, e não deveria haver: as colunas não coincidem
 * (a AWS tem data de uso e região; a OVH tem mês de competência e origem) e o
 * grão é diferente — dia contra mês.
 *
 * A separação é estrutural, não uma regra que alguém precise lembrar de aplicar:
 * o export AWS **não consegue** incluir OVH porque não conhece a tabela, e
 * vice-versa.
 *
 * ---------------------------------------------------------------------------
 * SEM STREAMING, E ISSO É UMA ESCOLHA
 *
 * O export AWS transmite em fluxo porque `aws_daily_costs` tem milhões de linhas
 * e o arquivo não cabe na memória. `ovh_monthly_costs` é agregada por mês: são
 * centenas de linhas, não milhões — hoje, 512 no total do banco inteiro.
 *
 * Montar em memória aqui é mais simples e igualmente seguro nessa ordem de
 * grandeza. `LIMITE_LINHAS` existe para o dia em que deixar de ser: o export
 * recusa em vez de derrubar o container, que tem teto de 512 MiB.
 */

/**
 * Teto de linhas. Se for atingido, a resposta é uma recusa explícita — nunca um
 * arquivo truncado em silêncio, que é indistinguível de um recorte legítimo.
 */
export const LIMITE_LINHAS = 50_000;

export type LinhaExportOvh = {
  mes: string;
  conta: string;
  projeto: string;
  categoria: string;
  servico: string;
  origem: string;
  moeda: string;
  valor: number;
};

const COLUNAS: { titulo: string; ler: (l: LinhaExportOvh) => string | number }[] = [
  { titulo: "Mês de competência", ler: (l) => l.mes },
  { titulo: "Conta OVH", ler: (l) => l.conta },
  { titulo: "Projeto", ler: (l) => l.projeto },
  { titulo: "Categoria", ler: (l) => l.categoria },
  { titulo: "Serviço", ler: (l) => l.servico },
  { titulo: "Origem", ler: (l) => l.origem },
  { titulo: "Moeda", ler: (l) => l.moeda },
  { titulo: "Valor", ler: (l) => l.valor },
];

/**
 * As linhas do recorte atual.
 *
 * `raw_json` e `raw_reference` NÃO saem daqui. O primeiro carrega o payload cru
 * da OVH — em `ovh_invoice_headers` ele inclui `password`, a senha do PDF da
 * fatura. Um export é um arquivo que sai do controle do portal no instante em
 * que é salvo; o que não deve circular não entra nele.
 */
export async function getLinhasExportOvh(f: FiltroOvh): Promise<LinhaExportOvh[]> {
  const p = new ConstrutorParams();
  const condicoes = [
    `c.billing_month >= to_date(${p.add(f.deMes)}, 'YYYY-MM')`,
    `c.billing_month <= to_date(${p.add(f.ateMes)}, 'YYYY-MM')`,
    `c.source = ${p.add(f.source)}`,
    `c.currency = ${p.add(f.moeda)}`,
  ];
  if (f.conta !== undefined) condicoes.push(`c.provider_account_id = ${p.add(f.conta)}`);
  if (f.projeto !== undefined) condicoes.push(`c.project_service_name = ${p.add(f.projeto)}`);

  const lim = p.add(LIMITE_LINHAS + 1);

  const linhas = await query<{
    mes: string;
    conta: string;
    projeto: string | null;
    categoria: string | null;
    servico: string | null;
    origem: string;
    moeda: string;
    valor: string | null;
  }>(
    `SELECT to_char(c.billing_month, 'YYYY-MM') AS mes,
            c.provider_account_id               AS conta,
            c.project_service_name              AS projeto,
            c.category                          AS categoria,
            c.service_label                     AS servico,
            c.source                            AS origem,
            c.currency                          AS moeda,
            c.amount                            AS valor
       FROM ovh_monthly_costs c
      WHERE ${condicoes.join(" AND ")}
      ORDER BY c.billing_month DESC, c.service_label ASC NULLS LAST
      LIMIT ${lim}`,
    p.lista,
  );

  return linhas.map((l) => ({
    mes: l.mes,
    conta: l.conta,
    // String vazia significa "não se aplica" no DDL (a coluna participa da chave
    // UNIQUE, e em índice do Postgres NULL nunca é igual a NULL). No arquivo, um
    // rótulo explícito evita que a célula vazia pareça dado faltando.
    projeto: l.projeto ? l.projeto : "(sem projeto)",
    categoria: l.categoria ?? "",
    servico: l.servico ?? "",
    origem: ROTULO_FONTE[l.origem as keyof typeof ROTULO_FONTE] ?? l.origem,
    moeda: l.moeda,
    valor: Number(l.valor ?? 0),
  }));
}

/**
 * Nome do arquivo. **Indica o provedor**, e isso não é cosmético: sem `ovh` no
 * nome, dois arquivos da mesma janela — um de cada provedor — ficam
 * indistinguíveis na pasta de downloads, e somá-los numa planilha é um erro
 * fácil de cometer e difícil de perceber.
 */
export function nomeDoArquivoOvh(de: string, ate: string, ext: "csv" | "xlsx"): string {
  return `veri-finops-ovh-${de}_${ate}.${ext}`;
}

function escaparCSV(valor: string | number): string {
  const texto = String(valor);
  return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function gerarCSVOvh(linhas: LinhaExportOvh[], contexto: string[]): string {
  // `﻿` (BOM): sem ele o Excel no Windows abre UTF-8 como Latin-1 e "Serviço"
  // vira "ServiÃ§o". O mesmo tratamento do export AWS.
  const cabecalho = contexto.map((l) => `# ${l}`).join("\r\n");
  const titulos = COLUNAS.map((c) => escaparCSV(c.titulo)).join(";");
  const corpo = linhas
    .map((l) => COLUNAS.map((c) => escaparCSV(c.ler(l))).join(";"))
    .join("\r\n");
  return `﻿${cabecalho}\r\n\r\n${titulos}\r\n${corpo}\r\n`;
}

export async function gerarXLSXOvh(
  linhas: LinhaExportOvh[],
  contexto: string[],
): Promise<Buffer> {
  const TINTA = "#384E46";
  const FUNDO = "#E7EBE6";

  const dados: SheetData = [
    COLUNAS.map((c) => ({
      value: c.titulo,
      fontWeight: "bold" as const,
      backgroundColor: FUNDO,
      textColor: TINTA,
      align: "left" as const,
    })),
    ...linhas.map((l) =>
      COLUNAS.map((c) => {
        const v = c.ler(l);
        return typeof v === "number"
          ? { value: v, type: Number, format: "#,##0.00" as const }
          : { value: v, type: String };
      }),
    ),
  ];

  // Duas abas, como no export AWS: dados puros na primeira (autofiltro e tabela
  // dinâmica funcionam direto) e o contexto do recorte na segunda.
  const contextoSheet: SheetData = contexto.map((linha) => [{ value: linha, type: String }]);

  return writeXlsxFile(
    [
      {
        data: dados,
        sheet: "Custos OVH",
        columns: [
          { width: 20 },
          { width: 18 },
          { width: 22 },
          { width: 18 },
          { width: 60 },
          { width: 16 },
          { width: 10 },
          { width: 14 },
        ],
        // Cabeçalho congelado: rolar centenas de linhas sem saber que coluna se
        // está lendo é como não ter cabeçalho.
        stickyRowsCount: 1,
      },
      { data: contextoSheet, sheet: "Contexto", columns: [{ width: 110 }] },
    ],
    { fontFamily: "Calibri", fontSize: 11 },
  ).toBuffer();
}
