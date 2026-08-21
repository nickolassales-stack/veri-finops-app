import { describe, expect, it } from "vitest";

import {
  FILTROS_OVH_PADRAO,
  descreverFiltrosOvh,
  escreverFiltrosOvh,
  lerFiltrosOvh,
  paramsDaApiOvh,
  temFiltroOvhAplicado,
  validarIntervaloOvh,
  type FiltrosOvh,
} from "./filtros-ovh";
import { lerFiltros, escreverFiltros } from "./filtros";

const ler = (busca: string) => lerFiltrosOvh(new URLSearchParams(busca));
const filtros = (over: Partial<FiltrosOvh> = {}): FiltrosOvh => ({
  ...FILTROS_OVH_PADRAO,
  ...over,
});

describe("lerFiltrosOvh", () => {
  it("URL vazia rende o padrao: 12 meses, faturado, todos os projetos", () => {
    expect(ler("")).toEqual(FILTROS_OVH_PADRAO);
    expect(FILTROS_OVH_PADRAO.periodo).toBe("12m");
    expect(FILTROS_OVH_PADRAO.source).toBe("invoice");
  });

  it("le periodo, origem e projeto", () => {
    expect(ler("periodo=6m&source=usage_current&projeto=abc")).toMatchObject({
      periodo: "6m",
      source: "usage_current",
      projeto: "abc",
    });
  });

  it("preset invalido cai no padrao em vez de quebrar", () => {
    // Inclusive os presets DIARIOS da AWS: um link da outra visao colado aqui
    // nao pode deixar a tela em branco.
    expect(ler("periodo=30d").periodo).toBe("12m");
    expect(ler("periodo=mes-atual").periodo).toBe("12m");
    expect(ler("periodo=qualquer").periodo).toBe("12m");
  });

  it("origem invalida cai em invoice -- nunca em 'todas'", () => {
    expect(ler("source=todas").source).toBe("invoice");
    expect(ler("source=lixo").source).toBe("invoice");
  });

  it("descarta mes malformado", () => {
    expect(ler("periodo=personalizado&deMes=2026-13&ateMes=x").deMes).toBe("");
    expect(ler("periodo=personalizado&deMes=2026-08-17").deMes).toBe("");
  });

  it("normaliza a moeda e descarta codigo invalido", () => {
    expect(ler("moeda=eur").moeda).toBe("EUR");
    expect(ler("moeda=DOLAR").moeda).toBe("");
    expect(ler("moeda=US").moeda).toBe("");
  });
});

describe("escreverFiltrosOvh", () => {
  it("SEMPRE leva provider=ovh, mesmo com todo o resto no padrao", () => {
    // Sem isso, recarregar `/dashboard` volta para a visao AWS e o link
    // compartilhado abre na tela errada.
    expect(escreverFiltrosOvh(FILTROS_OVH_PADRAO).toString()).toBe("provider=ovh");
  });

  it("omite o que e padrao", () => {
    const p = escreverFiltrosOvh(filtros({ periodo: "6m" }));
    expect(p.get("periodo")).toBe("6m");
    expect(p.has("source")).toBe(false);
    expect(p.has("projeto")).toBe(false);
  });

  it("nao escreve meses fora do personalizado", () => {
    // Coerencia com a API, que recusa `deMes` junto de preset nao-personalizado.
    const p = escreverFiltrosOvh(filtros({ periodo: "12m", deMes: "2026-01" }));
    expect(p.has("deMes")).toBe(false);
  });

  it("escreve os meses no personalizado", () => {
    const p = escreverFiltrosOvh(
      filtros({ periodo: "personalizado", deMes: "2025-01", ateMes: "2025-06" }),
    );
    expect(p.get("deMes")).toBe("2025-01");
    expect(p.get("ateMes")).toBe("2025-06");
  });

  it("ida e volta preserva o estado", () => {
    for (const f of [
      FILTROS_OVH_PADRAO,
      filtros({ periodo: "24m", source: "usage_forecast" }),
      filtros({ projeto: "abc123", moeda: "EUR" }),
      filtros({ periodo: "personalizado", deMes: "2024-09", ateMes: "2025-03" }),
    ]) {
      expect(lerFiltrosOvh(escreverFiltrosOvh(f))).toEqual(f);
    }
  });
});

describe("paramsDaApiOvh", () => {
  it("NAO leva provider -- a rota da API ja e especifica de OVH", () => {
    expect(paramsDaApiOvh(FILTROS_OVH_PADRAO).has("provider")).toBe(false);
  });

  it("manda origem SEMPRE explicita, inclusive no padrao", () => {
    // A origem nunca viaja implicita: o servidor tem default, mas deixar o
    // cliente confiar nele criaria dois lugares para mudar o padrao.
    expect(paramsDaApiOvh(FILTROS_OVH_PADRAO).get("source")).toBe("invoice");
  });

  it("manda periodo sempre, e os dois meses no personalizado", () => {
    expect(paramsDaApiOvh(FILTROS_OVH_PADRAO).get("periodo")).toBe("12m");

    const p = paramsDaApiOvh(
      filtros({ periodo: "personalizado", deMes: "2025-01", ateMes: "2025-06" }),
    );
    expect(p.get("periodo")).toBe("personalizado");
    expect(p.get("deMes")).toBe("2025-01");
    expect(p.get("ateMes")).toBe("2025-06");
  });
});

describe("validarIntervaloOvh", () => {
  it("preset nao-personalizado nao tem o que validar", () => {
    expect(validarIntervaloOvh(FILTROS_OVH_PADRAO)).toBeNull();
  });

  it("cobra os dois meses", () => {
    expect(validarIntervaloOvh(filtros({ periodo: "personalizado" }))?.campo).toBe("deMes");
    expect(
      validarIntervaloOvh(filtros({ periodo: "personalizado", deMes: "2026-01" }))?.campo,
    ).toBe("ateMes");
  });

  it("recusa fim antes do inicio", () => {
    const p = validarIntervaloOvh(
      filtros({ periodo: "personalizado", deMes: "2026-06", ateMes: "2026-01" }),
    );
    expect(p?.campo).toBe("ateMes");
    expect(p?.mensagem).toContain("não pode ser anterior");
  });

  it("aceita janela valida e janela de um mes", () => {
    expect(
      validarIntervaloOvh(
        filtros({ periodo: "personalizado", deMes: "2025-01", ateMes: "2025-12" }),
      ),
    ).toBeNull();
    expect(
      validarIntervaloOvh(
        filtros({ periodo: "personalizado", deMes: "2026-08", ateMes: "2026-08" }),
      ),
    ).toBeNull();
  });

  it("recusa acima do teto", () => {
    expect(
      validarIntervaloOvh(
        filtros({ periodo: "personalizado", deMes: "2000-01", ateMes: "2026-08" }),
      )?.mensagem,
    ).toContain("excede o máximo");
  });
});

describe("descreverFiltrosOvh", () => {
  it("nomeia periodo, origem e projeto", () => {
    expect(descreverFiltrosOvh(FILTROS_OVH_PADRAO)).toBe(
      "Últimos 12 meses · Faturado · todos os projetos",
    );
  });

  it("usa o nome legivel do projeto quando ha, e o id quando nao ha", () => {
    const f = filtros({ projeto: "abc123" });
    expect(descreverFiltrosOvh(f, "Produção")).toContain("projeto Produção");
    expect(descreverFiltrosOvh(f, null)).toContain("projeto abc123");
  });

  it("nomeia a origem escolhida, e nao 'faturado' fixo", () => {
    expect(descreverFiltrosOvh(filtros({ source: "usage_forecast" }))).toContain(
      "Previsão",
    );
  });
});

describe("temFiltroOvhAplicado", () => {
  it("padrao nao conta como filtro", () => {
    expect(temFiltroOvhAplicado(FILTROS_OVH_PADRAO)).toBe(false);
  });

  it("qualquer desvio conta", () => {
    expect(temFiltroOvhAplicado(filtros({ periodo: "6m" }))).toBe(true);
    expect(temFiltroOvhAplicado(filtros({ source: "usage_current" }))).toBe(true);
    expect(temFiltroOvhAplicado(filtros({ projeto: "abc" }))).toBe(true);
    expect(temFiltroOvhAplicado(filtros({ moeda: "EUR" }))).toBe(true);
  });
});

/**
 * A visao AWS nao pode ter mudado.
 *
 * Os dois modulos de filtro compartilham a mesma query string, e a adicao da OVH
 * introduziu quatro parametros novos (`provider`, `source`, `projeto`, `moeda`) e
 * presets de mes que a AWS nao conhece. Estes testes travam a fronteira: cada
 * lado ignora o vocabulario do outro em vez de se confundir com ele.
 */
describe("a visao AWS continua funcionando", () => {
  it("os parametros da OVH nao afetam os filtros da AWS", () => {
    const aws = lerFiltros(
      new URLSearchParams("provider=ovh&source=invoice&projeto=abc&moeda=EUR"),
    );
    expect(aws).toEqual({ periodo: "mes-atual", de: "", ate: "", contas: [] });
  });

  it("um preset de mes na URL nao vira periodo valido na AWS", () => {
    // Cair no padrao e o comportamento certo: a AWS nao sabe resolver "12m".
    expect(lerFiltros(new URLSearchParams("periodo=12m")).periodo).toBe("mes-atual");
  });

  it("a AWS nunca escreve provider na URL -- /dashboard limpo e a visao AWS", () => {
    const p = escreverFiltros({
      periodo: "30d",
      de: "",
      ate: "",
      contas: ["800168045394"],
    });
    expect(p.has("provider")).toBe(false);
    expect(p.get("periodo")).toBe("30d");
    expect(p.get("contas")).toBe("800168045394");
  });

  it("os parametros da AWS nao afetam os filtros da OVH", () => {
    // Simetrico do primeiro: contas e regiao nao existem no vocabulario OVH.
    const ovh = ler("contas=800168045394&regiao=us-east-1&periodo=7d");
    expect(ovh).toEqual(FILTROS_OVH_PADRAO);
  });

  it("os dois padroes sao diferentes e nenhum dos dois e 'todas as origens'", () => {
    expect(lerFiltros(new URLSearchParams("")).periodo).toBe("mes-atual");
    expect(ler("").periodo).toBe("12m");
    expect(ler("").source).toBe("invoice");
  });
});
