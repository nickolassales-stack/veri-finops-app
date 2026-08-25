import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  descreverContasOvh,
  descreverPeriodoOvh,
  escreverFiltrosOvh,
  FILTROS_OVH_PADRAO,
  lerFiltrosOvh,
  paramsDaApiOvh,
} from "./filtros-ovh";
import { resumirCollector, type ContaColetada } from "./collector-contas";
import { mensagemDeAusencia } from "./ovh";
import { resolverPeriodoMensal } from "@/lib/filtros/periodo-mensal";

/**
 * Mês atual, mês anterior e recorte por várias contas OVH.
 *
 * Os três blocos guardam coisas que quebram em silêncio: uma janela de mês
 * calculada errado devolve números plausíveis do mês errado; um filtro de conta
 * que não chega à consulta devolve o total de todas as contas com o nome de uma;
 * e um card de collector verde esconde a conta que falhou.
 */

const AGORA = new Date("2026-08-25T12:00:00Z");

describe("Mês atual e Mês anterior", () => {
  it("Mês atual em 2026-08-25 é 2026-08 a 2026-08", () => {
    const p = resolverPeriodoMensal("mes-atual", "2026-08-25");
    expect(p.deMes).toBe("2026-08");
    expect(p.ateMes).toBe("2026-08");
    expect(p.meses).toBe(1);
  });

  it("Mês anterior em 2026-08-25 é 2026-07 a 2026-07", () => {
    const p = resolverPeriodoMensal("mes-anterior", "2026-08-25");
    expect(p.deMes).toBe("2026-07");
    expect(p.ateMes).toBe("2026-07");
    expect(p.meses).toBe(1);
  });

  it("Últimos 12 meses em 2026-08-25 continua 2025-09 a 2026-08", () => {
    // A regressão que importa: acrescentar presets não pode mexer nos que já
    // existiam.
    const p = resolverPeriodoMensal("12m", "2026-08-25");
    expect(p.deMes).toBe("2025-09");
    expect(p.ateMes).toBe("2026-08");
    expect(p.meses).toBe(12);
  });

  it("Mês anterior em JANEIRO vira dezembro do ano passado", () => {
    // O caso que a aritmética ingênua erra: `mes - 1` em janeiro daria
    // "2026-00". O índice absoluto não tem virada de ano.
    const p = resolverPeriodoMensal("mes-anterior", "2026-01-15");
    expect(p.deMes).toBe("2025-12");
    expect(p.ateMes).toBe("2025-12");
  });

  it("Mês atual em dezembro não vaza para o ano seguinte", () => {
    const p = resolverPeriodoMensal("mes-atual", "2026-12-31");
    expect(p.deMes).toBe("2026-12");
    expect(p.ateMes).toBe("2026-12");
  });

  it("a janela anterior de Mês atual é o mês anterior", () => {
    // É o que alimenta a variação percentual do card. Se a janela anterior de
    // "mês atual" fosse de 12 meses, a variação compararia 1 mês com 12.
    const p = resolverPeriodoMensal("mes-atual", "2026-08-25");
    expect(p.anterior).toEqual({ deMes: "2026-07", ateMes: "2026-07", meses: 1 });
  });

  it("nenhum preset diário foi introduzido na OVH", () => {
    // O dado OVH é mensal. "Últimos 7 dias" ou devolveria o mês inteiro ou
    // devolveria nada — as duas leituras erradas.
    const f = lerFiltrosOvh(new URLSearchParams("periodo=7d"));
    expect(f.periodo).toBe("12m");
    expect(lerFiltrosOvh(new URLSearchParams("periodo=30d")).periodo).toBe("12m");
  });
});

describe("resumo do período", () => {
  it("um mês fala no singular", () => {
    const p = resolverPeriodoMensal("mes-atual", "2026-08-25");
    expect(descreverPeriodoOvh(p)).toBe("2026-08 a 2026-08 · 1 mês · Mês atual");
  });

  it("doze meses falam no plural", () => {
    const p = resolverPeriodoMensal("12m", "2026-08-25");
    expect(descreverPeriodoOvh(p)).toBe(
      "2025-09 a 2026-08 · 12 meses · Últimos 12 meses",
    );
  });
});

describe("filtro de contas — leitura e escrita", () => {
  it("uma conta", () => {
    expect(lerFiltrosOvh(new URLSearchParams("conta=ovh-a-ca")).contas).toEqual([
      "ovh-a-ca",
    ]);
  });

  it("várias contas", () => {
    expect(
      lerFiltrosOvh(new URLSearchParams("conta=ovh-a-ca,ovh-b-ca")).contas,
    ).toEqual(["ovh-a-ca", "ovh-b-ca"]);
  });

  it("sem parâmetro significa TODAS", () => {
    expect(lerFiltrosOvh(new URLSearchParams("")).contas).toEqual([]);
  });

  it("duplicata é removida — senão a contagem mentiria", () => {
    // "2 contas selecionadas" com a mesma conta duas vezes seria falso.
    expect(lerFiltrosOvh(new URLSearchParams("conta=a,a,b")).contas).toEqual(["a", "b"]);
  });

  it("id inválido é descartado, e não derruba a leitura", () => {
    // A URL alimenta a tela: colada pela metade, ela deve mostrar o que dá,
    // não uma página de erro. O servidor valida de novo e recusa.
    expect(lerFiltrosOvh(new URLSearchParams("conta=ovh-a-ca,não!vale")).contas).toEqual(
      ["ovh-a-ca"],
    );
  });

  it("a ida e volta pela URL preserva a seleção", () => {
    const f = { ...FILTROS_OVH_PADRAO, contas: ["ovh-a-ca", "ovh-b-ca"] };
    const url = escreverFiltrosOvh(f);
    expect(lerFiltrosOvh(url).contas).toEqual(["ovh-a-ca", "ovh-b-ca"]);
  });

  it("a API recebe a mesma lista", () => {
    const f = { ...FILTROS_OVH_PADRAO, contas: ["ovh-a-ca", "ovh-b-ca"] };
    expect(paramsDaApiOvh(f).get("conta")).toBe("ovh-a-ca,ovh-b-ca");
  });

  it("uma conta AWS na URL NÃO entra no recorte OVH", () => {
    // `contas` é o filtro da visão AWS e as duas moram em `/dashboard`. Um id
    // de 12 dígitos casa com o formato do id OVH, então só a separação de NOME
    // impede o vazamento.
    expect(lerFiltrosOvh(new URLSearchParams("contas=800168045394")).contas).toEqual([]);
  });
});

describe("descrição do recorte de contas", () => {
  const disponiveis = [
    { id: "ovh-a-ca", nome: "OVH Canadá" },
    { id: "ovh-b-eu", nome: "OVH Europa" },
  ];

  it("nenhuma selecionada diz 'todas as contas'", () => {
    expect(descreverContasOvh([], disponiveis)).toBe("todas as contas");
  });

  it("uma selecionada diz o NOME, e não a contagem", () => {
    // "1 conta selecionada" esconde justamente a informação útil: qual.
    expect(descreverContasOvh(["ovh-a-ca"], disponiveis)).toBe("OVH Canadá");
  });

  it("duas ou mais dizem a contagem", () => {
    expect(descreverContasOvh(["ovh-a-ca", "ovh-b-eu"], disponiveis)).toBe(
      "2 contas selecionadas",
    );
  });

  it("cai no id quando o nome não é conhecido", () => {
    expect(descreverContasOvh(["ovh-z-ca"], disponiveis)).toBe("ovh-z-ca");
  });
});

describe("estado vazio menciona as contas selecionadas", () => {
  it("sem filtro de conta, fala só do período", () => {
    const m = mensagemDeAusencia("periodo-sem-dado", "invoice", 0);
    expect(m).toContain("no período selecionado");
    expect(m).not.toContain("contas selecionadas");
  });

  it("com filtro de conta, diz que a conta também restringe", () => {
    // Sem isto, alguém alarga a janela várias vezes antes de reparar que o
    // filtro de conta estava ligado.
    expect(mensagemDeAusencia("periodo-sem-dado", "invoice", 1)).toContain(
      "a conta selecionada",
    );
    expect(mensagemDeAusencia("periodo-sem-dado", "invoice", 2)).toContain(
      "as contas selecionadas",
    );
  });

  it("nunca diz zero — a ausência não é custo", () => {
    for (const n of [0, 1, 3]) {
      expect(mensagemDeAusencia("periodo-sem-dado", "invoice", n)).not.toMatch(/0[,.]00/);
    }
  });
});

describe("status do collector com várias contas", () => {
  const emDia = (id: string, nome: string): ContaColetada => ({
    id,
    nome,
    ultimoStatus: "success",
    ultimoFim: new Date(AGORA.getTime() - 3_600_000).toISOString(),
    temCredencial: true,
  });

  it("todas em dia: Coleta em dia", () => {
    const r = resumirCollector([emDia("a", "A"), emDia("b", "B")], [], AGORA);
    expect(r.rotulo).toBe("Coleta em dia");
    expect(r.tom).toBe("ok");
    expect(r.alertas).toEqual([]);
  });

  it("uma falhou: alerta nomeando a quantidade", () => {
    const contas = [emDia("a", "A"), { ...emDia("b", "B"), ultimoStatus: "failed" }];
    const r = resumirCollector(contas, [], AGORA);
    expect(r.tom).toBe("critico");
    expect(r.alertas).toContain("1 conta com falha na última coleta");
  });

  it("uma sem credencial: alerta próprio, separado de falha", () => {
    // São ações diferentes: falha manda olhar o log, ausência manda cadastrar.
    const contas = [emDia("a", "A"), { ...emDia("b", "B"), temCredencial: false }];
    const r = resumirCollector(contas, [], AGORA);
    expect(r.alertas).toContain("1 conta sem credencial");
  });

  it("o pior estado ganha — verde não pode esconder vermelho", () => {
    const contas = [
      emDia("a", "A"),
      { ...emDia("b", "B"), ultimoStatus: "failed" },
      { ...emDia("c", "C"), temCredencial: false },
    ];
    const r = resumirCollector(contas, [], AGORA);
    expect(r.rotulo).toBe("Coleta com falha");
    expect(r.alertas).toHaveLength(2);
  });

  it("o recorte limita a agregação: a conta ruim está FORA da seleção", () => {
    const contas = [emDia("a", "A"), { ...emDia("b", "B"), ultimoStatus: "failed" }];
    const r = resumirCollector(contas, ["a"], AGORA);
    expect(r.rotulo).toBe("Coleta em dia");
    expect(r.descricaoContas).toBe("Contas: A");
  });

  it("com várias selecionadas NÃO diz o nome de uma só", () => {
    // O requisito explícito: nada de "Conta: OVH Principal" com duas no recorte.
    const contas = [emDia("a", "A"), emDia("b", "B")];
    expect(resumirCollector(contas, ["a", "b"], AGORA).descricaoContas).toBe(
      "Contas: 2 selecionadas",
    );
  });

  it("sem seleção diz 'Todas as contas OVH'", () => {
    const contas = [emDia("a", "A"), emDia("b", "B")];
    expect(resumirCollector(contas, [], AGORA).descricaoContas).toBe(
      "Contas: Todas as contas OVH",
    );
  });

  it("credencial desconhecida (migração 006 ausente) não vira 'sem credencial'", () => {
    // `null` é "não sei". Afirmar ausência mandaria cadastrar o que já existe.
    const contas = [{ ...emDia("a", "A"), temCredencial: null }];
    const r = resumirCollector(contas, [], AGORA);
    expect(r.alertas).toEqual([]);
    expect(r.tom).toBe("ok");
  });

  it("conta nunca coletada aparece, em vez de sumir", () => {
    const contas = [{ ...emDia("a", "A"), ultimoStatus: null, ultimoFim: null }];
    const r = resumirCollector(contas, [], AGORA);
    expect(r.alertas).toContain("1 conta nunca coletada");
  });

  it("recorte vazio não estoura", () => {
    expect(resumirCollector([], [], AGORA).total).toBe(0);
  });
});

/**
 * As consultas de verdade — lidas da fonte.
 *
 * O projeto não mocka banco; estes guardas leem o SQL, como o de separação dos
 * exports em `analitico-ovh.test.ts`. O que se guarda aqui é que o recorte por
 * conta CHEGA à consulta — o defeito encontrado nesta entrega foi exatamente o
 * contrário: o campo existia no tipo, existia na URL, e o resolvedor não o
 * copiava para o filtro. Todos os números continuavam sendo de todas as contas.
 */
describe("as queries recortam por provider_account_id", () => {
  const RAIZ = join(__dirname, "..");

  function codigo(...partes: string[]): string {
    return readFileSync(join(RAIZ, ...partes), "utf8")
      .split(/\r?\n/)
      .filter((l) => {
        const s = l.trim();
        return s !== "" && !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*");
      })
      .join("\n");
  }

  const queries = codigo("queries", "dashboard-ovh.ts");
  const servico = codigo("services", "dashboard-ovh.ts");

  it("o filtro de custo usa = ANY com array parametrizado", () => {
    // `= ANY($n)` e não `IN (...)` montado por interpolação: o número de contas
    // não muda a forma da consulta nem abre espaço para concatenação.
    expect(queries).toMatch(/provider_account_id = ANY\(\$\{p\.add\(f\.contas\)\}::text\[\]\)/);
  });

  it("o resolvedor COPIA as contas para o filtro de custo", () => {
    // A regressão desta entrega. Sem esta linha, `?conta=x` mudava a moeda
    // escolhida e mais nada.
    const filtro = servico.slice(servico.indexOf("const filtro: FiltroOvh | null"));
    expect(filtro.slice(0, 400)).toContain("contas: entrada.conta");
  });

  it("as faturas também recortam por conta", () => {
    // Sem isso, o card "Faturas no período" contaria as faturas de todas as
    // contas ao lado de um custo recortado por uma — dois números da mesma
    // linha respondendo perguntas diferentes.
    const contar = queries.slice(queries.indexOf("export async function contarFaturasOvh"));
    expect(contar.slice(0, 800)).toContain("f.contas");
  });

  it("a lista de contas vem do cadastro do portal, filtrada por provider ovh", () => {
    const lista = queries.slice(queries.indexOf("export async function getContasOvhDoCadastro"));
    expect(lista).toContain("a.provider = 'ovh'");
    expect(lista).toContain("a.active");
  });

  it("nenhuma consulta OVH toca tabela AWS", () => {
    // A garantia de que conta AWS não aparece no filtro OVH não é uma regra a
    // lembrar: as tabelas são outras.
    expect(queries).not.toMatch(/aws_daily_costs|aws_monthly_costs/);
  });

  it("o export OVH recorta pelas mesmas contas da tela", () => {
    // Um arquivo com mais contas do que o usuário via é a pior divergência:
    // só aparece depois, na planilha.
    const exportacao = codigo("export", "ovh.ts");
    expect(exportacao).toMatch(/provider_account_id = ANY\(/);
  });
});
