import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FILTROS_OVH_PADRAO,
  escreverFiltrosOvh,
  lerFiltrosOvh,
  paramsDaApiOvh,
  temFiltroOvhAplicado,
} from "./filtros-ovh";
import { ehVisaoOvh } from "./ovh";

describe("ehVisaoOvh — o provedor exibido", () => {
  it("sem provider, é AWS", () => {
    expect(ehVisaoOvh(new URLSearchParams(""))).toBe(false);
  });

  it("provider=aws é AWS", () => {
    expect(ehVisaoOvh(new URLSearchParams("provider=aws"))).toBe(false);
  });

  it("provider=ovh é OVH", () => {
    expect(ehVisaoOvh(new URLSearchParams("provider=ovh"))).toBe(true);
  });

  it("valor desconhecido cai na AWS, não em OVH", () => {
    // Um valor digitado errado na URL não pode trocar o provedor em silêncio: a
    // tela mostraria custo de outro provedor sem que ninguém tenha pedido.
    for (const ruim of ["OVH", "ovh ", "gcp", "1", "true"]) {
      expect(ehVisaoOvh(new URLSearchParams(`provider=${ruim}`)), ruim).toBe(false);
    }
  });
});

describe("filtro de conta OVH", () => {
  it("é lido da URL", () => {
    const f = lerFiltrosOvh(new URLSearchParams("provider=ovh&conta=ovh-main-ca"));
    expect(f.contas).toEqual(["ovh-main-ca"]);
  });

  it("aceita várias contas separadas por vírgula", () => {
    const f = lerFiltrosOvh(new URLSearchParams("provider=ovh&conta=ovh-a-ca,ovh-b-ca"));
    expect(f.contas).toEqual(["ovh-a-ca", "ovh-b-ca"]);
  });

  it("o parâmetro segue no SINGULAR — `contas` é da visão AWS", () => {
    // As duas visões moram em `/dashboard`. Reusar `contas` faria uma URL da
    // outra visão aplicar um recorte silencioso aqui, e um id AWS de 12 dígitos
    // casa com o formato do id OVH — a validação não pegaria.
    const f = lerFiltrosOvh(new URLSearchParams("provider=ovh&contas=800168045394"));
    expect(f.contas).toEqual([]);
  });

  it("ausente significa todas as contas", () => {
    expect(lerFiltrosOvh(new URLSearchParams("provider=ovh")).contas).toEqual([]);
  });

  it("volta para a URL e chega à API", () => {
    const f = { ...FILTROS_OVH_PADRAO, contas: ["ovh-main-ca"] };
    expect(escreverFiltrosOvh(f).get("conta")).toBe("ovh-main-ca");
    expect(paramsDaApiOvh(f).get("conta")).toBe("ovh-main-ca");
  });

  it("vazio não vira parâmetro na URL", () => {
    // Um `conta=` vazio na URL sugeriria um filtro aplicado que não existe, e o
    // botão "Limpar filtros" apareceria sem ter o que limpar.
    expect(escreverFiltrosOvh(FILTROS_OVH_PADRAO).has("conta")).toBe(false);
    expect(paramsDaApiOvh(FILTROS_OVH_PADRAO).has("conta")).toBe(false);
  });

  it("conta selecionada conta como filtro aplicado", () => {
    expect(temFiltroOvhAplicado(FILTROS_OVH_PADRAO)).toBe(false);
    expect(
      temFiltroOvhAplicado({ ...FILTROS_OVH_PADRAO, contas: ["ovh-main-ca"] }),
    ).toBe(true);
  });

  it("escreverFiltrosOvh sempre marca provider=ovh", () => {
    // Sem isso, aplicar um filtro na visão OVH devolveria uma URL sem provedor e
    // a tela cairia para AWS no próximo render — perdendo a visão que o usuário
    // acabou de escolher.
    expect(escreverFiltrosOvh(FILTROS_OVH_PADRAO).get("provider")).toBe("ovh");
  });
});

describe("origem: nunca somada, e uma por vez", () => {
  it("a API recebe sempre exatamente uma origem", () => {
    const p = paramsDaApiOvh(FILTROS_OVH_PADRAO);
    expect(p.getAll("source")).toHaveLength(1);
  });

  it("o padrão é invoice — custo realizado, não previsão", () => {
    expect(FILTROS_OVH_PADRAO.source).toBe("invoice");
  });
});

/**
 * Separação estrutural entre os exports.
 *
 * O requisito é "export AWS não pode incluir OVH e vice-versa". A garantia não é
 * uma regra a lembrar: cada módulo só conhece as tabelas do seu provedor. Este
 * teste guarda essa propriedade — se alguém acrescentar uma consulta cruzada, ele
 * falha antes de o arquivo chegar a um cliente.
 */
describe("exports não se misturam", () => {
  const RAIZ = join(__dirname, "..", "export");

  /**
   * Só as linhas de CÓDIGO.
   *
   * Os módulos citam a tabela do outro provedor em comentário — justamente para
   * explicar por que são separados. Uma busca por substring reprovaria a
   * documentação correta, que foi o que aconteceu na primeira versão deste teste.
   */
  function codigo(arquivo: string): string {
    return readFileSync(join(RAIZ, arquivo), "utf8")
      .split(/\r?\n/)
      .filter((l) => {
        const s = l.trim();
        return s !== "" && !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*");
      })
      .join("\n");
  }

  it("o export OVH não consulta tabela AWS", () => {
    const fonte = codigo("ovh.ts");
    expect(fonte).not.toMatch(/aws_daily_costs|aws_monthly_costs/);
    expect(fonte).toContain("ovh_monthly_costs");
  });

  it("o export AWS não consulta tabela OVH", () => {
    for (const arquivo of ["dados.ts", "historico.ts", "colunas.ts"]) {
      expect(codigo(arquivo), arquivo).not.toMatch(/ovh_monthly_costs|ovh_invoice/);
    }
  });

  it("o export OVH não carrega raw_json", () => {
    // `ovh_invoice_headers.raw_json` inclui `password` — a senha do PDF da
    // fatura na OVH. Um export é um arquivo que sai do controle do portal.
    // `[\s\S]` e não a flag `s`: o `target` do tsconfig é anterior a es2018, e a
    // flag falharia no typecheck mesmo funcionando em tempo de execução.
    expect(codigo("ovh.ts")).not.toMatch(/SELECT[^;]*raw_json/);
    expect(codigo("ovh.ts")).not.toMatch(/raw_json[\s\S]{0,40}AS /);
  });

  it("os dois nomes de arquivo indicam o provedor", () => {
    // Lido da fonte, e não importado: os dois módulos são `server-only`, que não
    // resolve fora do runtime do Next.
    expect(codigo("ovh.ts")).toContain("veri-finops-ovh-");
    expect(codigo("metadados.ts")).toContain("veri-finops-aws-");
  });
});
