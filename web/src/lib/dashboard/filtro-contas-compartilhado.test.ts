import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resumirSelecao,
  type ContaDoFiltro,
} from "@/components/dashboard/cloud-account-multi-select";

/**
 * O seletor de contas é UM SÓ, e as duas visões o usam.
 *
 * O projeto não tem testing-library — os guardas de composição leem a fonte,
 * como `tela-contas.test.ts` e `rotas-versionadas.test.ts`. O que se protege
 * aqui não é aparência:
 *
 *   1. a OVH não pode voltar às pílulas, que não escalam com o cadastro;
 *   2. nenhum id ou alias de conta pode ser fixo no código;
 *   3. a visão AWS não pode ter perdido a contagem que já mostrava.
 */

const SRC = join(__dirname, "..", "..");

/** Só as linhas de CÓDIGO: os arquivos citam em comentário o que não fazem. */
function codigo(...partes: string[]): string {
  return readFileSync(join(SRC, ...partes), "utf8")
    .split(/\r?\n/)
    .filter((l) => {
      const s = l.trim();
      return (
        s !== "" &&
        !s.startsWith("//") &&
        !s.startsWith("*") &&
        !s.startsWith("/*") &&
        !s.startsWith("{/*")
      );
    })
    .join("\n");
}

const compartilhado = codigo("components", "dashboard", "cloud-account-multi-select.tsx");
const ovh = codigo("components", "dashboard", "filtros-ovh.tsx");
const aws = codigo("components", "dashboard", "filtro-contas.tsx");

describe("as duas visões usam o MESMO componente", () => {
  it("a visão OVH monta CloudAccountMultiSelect", () => {
    expect(ovh).toContain("<CloudAccountMultiSelect");
    expect(ovh).toMatch(/provider="ovh"/);
  });

  it("a visão AWS monta CloudAccountMultiSelect", () => {
    expect(aws).toContain("<CloudAccountMultiSelect");
    expect(aws).toMatch(/provider="aws"/);
  });

  it("a OVH não tem mais o seu próprio seletor de contas", () => {
    // A regressão que este teste guarda: reintroduzir um `FiltroContas` local
    // na visão OVH faria as duas telas divergirem de novo, em silêncio.
    expect(ovh).not.toMatch(/function FiltroContas\b/);
  });

  it("é dropdown, e não pílulas em linha", () => {
    // Pílulas ocupam largura proporcional ao número de contas: com oito, a
    // barra de filtros quebra e empurra Projeto para fora da tela.
    expect(compartilhado).toMatch(/aria-expanded=\{aberto\}/);
    expect(compartilhado).toMatch(/type="checkbox"/);
    expect(compartilhado).not.toMatch(/aria-pressed/);
  });

  it("o painel fecha com Esc e ao clicar fora", () => {
    expect(compartilhado).toContain('evento.key === "Escape"');
    expect(compartilhado).toContain("mousedown");
  });

  it("não usa `<select multiple>`", () => {
    // Nele, quem não segura Ctrl DESMARCA a primeira opção ao clicar na
    // segunda — silenciosamente, achando que somou.
    expect(compartilhado).not.toMatch(/<select\b[^>]*multiple/);
  });
});

describe("nenhuma conta é fixa no código", () => {
  const arquivos: [string, string][] = [
    ["seletor compartilhado", compartilhado],
    ["filtros OVH", ovh],
    ["filtro AWS", aws],
  ];

  for (const [nome, fonte] of arquivos) {
    it(`${nome} não cita conta nenhuma`, () => {
      // Cadastrar a conta seguinte precisa bastar. Qualquer id ou alias aqui
      // seria uma conta privilegiada — presente para uns, ausente para outros.
      for (const proibido of [
        "ovh-main-ca",
        "ovh-prod-us",
        "OVH Canadá",
        "OVH US",
        "OVH Principal",
      ]) {
        expect(fonte, `${nome} / ${proibido}`).not.toContain(proibido);
      }
      // Id de conta AWS: doze dígitos seguidos.
      expect(fonte).not.toMatch(/\b\d{12}\b/);
    });
  }

  it("a lista OVH chega por prop, e não é montada aqui", () => {
    expect(ovh).toMatch(/contas\?: ContaOvhDisponivel\[\]/);
  });
});

describe("a visão AWS não foi afetada", () => {
  it("continua rotulada Contas AWS", () => {
    expect(aws).toContain('rotulo="Contas AWS"');
  });

  it("continua mostrando a contagem junto de 'todas'", () => {
    expect(aws).toContain("mostrarTotalEmTodas");
  });

  it("continua marcando conta inativa", () => {
    expect(aws).toMatch(/inativa: !c\.active/);
  });
});

describe("a visão OVH pede o rótulo e o texto certos", () => {
  it("rotula CONTAS OVH", () => {
    expect(ovh).toContain('rotulo="Contas OVH"');
    // O caixa-alta é do CSS (`uppercase`), e não do texto — assim o leitor de
    // tela anuncia "Contas OVH", e não "C-O-N-T-A-S".
    expect(compartilhado).toMatch(/uppercase/);
  });

  it("o fechado padrão é 'Todas as contas OVH'", () => {
    expect(ovh).toContain('rotuloTodas="Todas as contas OVH"');
  });

  it("não anexa contagem ao 'todas' da OVH", () => {
    const trecho = ovh.slice(ovh.indexOf('provider="ovh"'));
    expect(trecho.slice(0, 600)).not.toContain("mostrarTotalEmTodas");
  });

  it("mostra a unidade junto do id", () => {
    expect(ovh).toMatch(/detalhe: c\.unidade/);
  });
});

describe("resumirSelecao — o texto do botão fechado", () => {
  const CONTAS: ContaDoFiltro[] = [
    { id: "conta-a", nome: "Alfa" },
    { id: "conta-b", nome: "Beta" },
    { id: "conta-c", nome: "Gama" },
  ];

  it("nenhuma marcada mostra o rótulo de 'todas'", () => {
    expect(
      resumirSelecao({ contas: CONTAS, selecionadas: [], rotuloTodas: "Todas as contas OVH" }),
    ).toBe("Todas as contas OVH");
  });

  it("uma marcada mostra o NOME dela", () => {
    expect(
      resumirSelecao({
        contas: CONTAS,
        selecionadas: ["conta-a"],
        rotuloTodas: "Todas as contas OVH",
      }),
    ).toBe("Alfa");
  });

  it("duas e três marcadas mostram a contagem", () => {
    expect(
      resumirSelecao({
        contas: CONTAS,
        selecionadas: ["conta-a", "conta-b"],
        rotuloTodas: "Todas as contas OVH",
      }),
    ).toBe("2 contas selecionadas");
    expect(
      resumirSelecao({
        contas: CONTAS,
        selecionadas: ["conta-a", "conta-b", "conta-c"],
        rotuloTodas: "Todas as contas OVH",
      }),
    ).toBe("3 contas selecionadas");
  });

  it("id desconhecido cai no próprio id, e não em 'conta desconhecida'", () => {
    // É o id que a pessoa colou na URL, e é por ele que ela vai procurar.
    expect(
      resumirSelecao({
        contas: CONTAS,
        selecionadas: ["ovh-sumida"],
        rotuloTodas: "Todas as contas OVH",
      }),
    ).toBe("ovh-sumida");
  });

  it("a contagem da AWS é opcional, e não vaza para a OVH", () => {
    expect(
      resumirSelecao({
        contas: CONTAS,
        selecionadas: [],
        rotuloTodas: "Todas as contas",
        mostrarTotalEmTodas: true,
      }),
    ).toBe("Todas as contas (3)");
  });

  it("sem contas carregadas, 'todas' não ganha um '(0)'", () => {
    // "(0)" sugeriria que o cadastro está vazio, quando a lista pode só não
    // ter chegado ainda.
    expect(
      resumirSelecao({
        contas: [],
        selecionadas: [],
        rotuloTodas: "Todas as contas",
        mostrarTotalEmTodas: true,
      }),
    ).toBe("Todas as contas");
  });
});
