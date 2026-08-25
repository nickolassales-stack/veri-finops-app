import { describe, expect, it } from "vitest";

import {
  lerProvider,
  mensagemCredencial,
  resumoContas,
  segmentar,
  statusDaCredencial,
  textoListaVazia,
  urlDaVisao,
  type ContaSegmentavel,
} from "./contas-provider";

function params(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

function conta(
  accountId: string,
  provider: string,
  status?: string | null,
): ContaSegmentavel {
  return {
    accountId,
    provider,
    credencial: status === undefined ? undefined : status === null ? null : { status },
  };
}

describe("lerProvider — o provedor exibido", () => {
  it("sem parâmetro, é AWS", () => {
    expect(lerProvider(params(""))).toBe("aws");
  });

  it("provider=aws é AWS", () => {
    expect(lerProvider(params("provider=aws"))).toBe("aws");
  });

  it("provider=ovh é OVH", () => {
    expect(lerProvider(params("provider=ovh"))).toBe("ovh");
  });

  it("valor desconhecido cai em AWS, não em OVH", () => {
    // Um valor digitado errado na URL não pode trocar o provedor em silêncio:
    // a tela mostraria a lista do outro provedor sem ninguém ter pedido.
    for (const ruim of ["OVH", "ovh ", "gcp", "1", "true", ""]) {
      expect(lerProvider(params(`provider=${ruim}`)), ruim).toBe("aws");
    }
  });
});

describe("urlDaVisao", () => {
  const base = "/dashboard/configuracoes/contas";

  it("AWS não carrega parâmetro — é o padrão", () => {
    expect(urlDaVisao(base, "aws")).toBe(base);
  });

  it("OVH carrega provider=ovh", () => {
    expect(urlDaVisao(base, "ovh")).toBe(`${base}?provider=ovh`);
  });

  it("ida e volta: a URL gerada é lida de volta como o mesmo provedor", () => {
    for (const p of ["aws", "ovh"] as const) {
      const url = new URL(urlDaVisao(base, p), "https://x");
      expect(lerProvider(url.searchParams), p).toBe(p);
    }
  });
});

describe("segmentar — as duas listas nunca se misturam", () => {
  const lista = [
    conta("683745271637", "aws"),
    conta("ovh-main-ca", "ovh"),
    conta("891377338363", "aws"),
  ];

  it("a visão AWS não contém nenhuma conta OVH", () => {
    expect(segmentar(lista).aws.map((c) => c.accountId)).toEqual([
      "683745271637",
      "891377338363",
    ]);
  });

  it("a visão OVH não contém nenhuma conta AWS", () => {
    expect(segmentar(lista).ovh.map((c) => c.accountId)).toEqual(["ovh-main-ca"]);
  });

  it("as duas listas somadas devolvem a lista inteira", () => {
    // A propriedade que importa: nenhuma conta some. Um filtro por lista de
    // providers conhecidos faria conta com provider inesperado desaparecer das
    // duas visões — pior que aparecer na errada, porque ninguém procura o que
    // não sabe que existe.
    const { aws, ovh } = segmentar(lista);
    expect(aws.length + ovh.length).toBe(lista.length);
  });

  it("provider desconhecido ou nulo cai em AWS, e não some", () => {
    const estranhas = [conta("x", ""), conta("y", "gcp"), conta("z", "AWS")];
    const { aws, ovh } = segmentar(estranhas);
    expect(aws).toHaveLength(3);
    expect(ovh).toHaveLength(0);
  });
});

describe("statusDaCredencial", () => {
  it("sem linha no banco é nao_configurado", () => {
    expect(statusDaCredencial(null)).toBe("nao_configurado");
    expect(statusDaCredencial(undefined)).toBe("nao_configurado");
  });

  it("os três status do CHECK passam intactos", () => {
    for (const s of ["conectado", "invalido", "nao_validado"]) {
      expect(statusDaCredencial({ status: s }), s).toBe(s);
    }
  });

  it("nao_validado NÃO é inválido", () => {
    // Credencial nova que ninguém testou COLETA normalmente. Tratá-la como
    // falha transformaria todo cadastro novo num alarme.
    expect(statusDaCredencial({ status: "nao_validado" })).not.toBe("invalido");
    expect(mensagemCredencial("nao_validado")).toBeNull();
  });

  it("status desconhecido não vira 'conectado'", () => {
    // Cair para o estado otimista afirmaria uma conexão que ninguém verificou.
    expect(statusDaCredencial({ status: "coisa-nova" })).toBe("nao_configurado");
  });
});

describe("mensagens de credencial", () => {
  it("sem credencial", () => {
    expect(mensagemCredencial("nao_configurado")).toBe("Credenciais não configuradas.");
  });

  it("credencial inválida diz o que fazer", () => {
    expect(mensagemCredencial("invalido")).toBe(
      "Credencial inválida. Atualize as credenciais e teste novamente.",
    );
  });

  it("conectado não gera mensagem", () => {
    expect(mensagemCredencial("conectado")).toBeNull();
  });
});

describe("resumoContas", () => {
  const lista = [
    conta("a", "aws"),
    conta("b", "aws"),
    conta("ovh-1", "ovh", "conectado"),
    conta("ovh-2", "ovh", "invalido"),
    conta("ovh-3", "ovh", null),
  ];

  it("conta por provedor", () => {
    const r = resumoContas(lista, { podeVerCredenciais: true, coletasComFalha: 0 });
    expect(r.contasAws).toBe(2);
    expect(r.contasOvh).toBe(3);
  });

  it("só conectadas contam como conectadas", () => {
    const r = resumoContas(lista, { podeVerCredenciais: true, coletasComFalha: 0 });
    expect(r.credenciaisConectadas).toBe(1);
  });

  it("para quem não é ADMIN o número é null, e não zero", () => {
    // Zero AFIRMA que nenhuma conta está conectada — e mandaria um VIEWER
    // avisar que a integração caiu quando ela está de pé. `null` diz "não sei".
    const r = resumoContas(lista, { podeVerCredenciais: false, coletasComFalha: 0 });
    expect(r.credenciaisConectadas).toBeNull();
  });

  it("fila ausente deixa coletasComFalha em null, não em zero", () => {
    const r = resumoContas(lista, { podeVerCredenciais: true, coletasComFalha: null });
    expect(r.coletasComFalha).toBeNull();
  });

  it("lista vazia não estoura", () => {
    const r = resumoContas([], { podeVerCredenciais: true, coletasComFalha: null });
    expect(r).toEqual({
      contasAws: 0,
      contasOvh: 0,
      credenciaisConectadas: 0,
      coletasComFalha: null,
    });
  });
});

describe("estados vazios", () => {
  it("AWS manda esperar o ETL, porque não há o que clicar aqui", () => {
    const t = textoListaVazia("aws");
    expect(t.titulo).toContain("Nenhuma conta AWS importada ainda");
    expect(t.detalhe).toContain("Data Export/CUR 2.0");
    expect(t.detalhe).toContain("aguarde o ETL");
  });

  it("OVH manda clicar no botão, porque ele existe", () => {
    const t = textoListaVazia("ovh");
    expect(t.titulo).toContain("Nenhuma conta OVH cadastrada");
    expect(t.detalhe).toContain("Adicionar conta OVH");
  });

  it("as duas mensagens são diferentes", () => {
    // Um texto genérico ("nenhuma conta") serviria aos dois e não ajudaria
    // nenhum: a ação seguinte é a única razão de um estado vazio existir.
    expect(textoListaVazia("aws")).not.toEqual(textoListaVazia("ovh"));
  });
});
