import { describe, expect, it } from "vitest";

import {
  avisoCadastroVazio,
  avisoContasDesconhecidas,
  avisoCustoForaDoCadastro,
  resolverRecorteContasOvh,
} from "./recorte-contas-ovh";

/**
 * A resolução de "todas as contas" para a lista de contas OVH ativas.
 *
 * O que estes testes protegem não é a resolução em si — é o que ela pode
 * quebrar. Trocar "sem filtro" por "lista explícita" faz o painel deixar de
 * contar o custo de qualquer conta que não esteja ativa no cadastro, e há dois
 * jeitos de isso dar muito errado em silêncio:
 *
 *   1. cadastro vazio → `= ANY('{}')` → painel inteiro em zero;
 *   2. conta com custo desativada → total cai e nada explica.
 *
 * Os dois têm teste aqui, e os dois têm aviso.
 */

const ATIVAS = ["ovh-main-ca", "ovh-prod-us"];

describe("todas as contas", () => {
  it("vira a lista explícita de contas ativas", () => {
    const r = resolverRecorteContasOvh(undefined, ATIVAS);
    expect(r.ids).toEqual(ATIVAS);
    expect(r.resolvidoParaAtivas).toBe(true);
    expect(r.selecaoExplicita).toBe(false);
  });

  it("lista vazia na URL conta como 'todas', não como 'nenhuma'", () => {
    // A tela remove o parâmetro ao limpar o filtro, mas um `?conta=` vazio
    // chegando de um link antigo não pode zerar o painel.
    const r = resolverRecorteContasOvh([], ATIVAS);
    expect(r.ids).toEqual(ATIVAS);
    expect(r.resolvidoParaAtivas).toBe(true);
  });

  it("cadastro vazio NÃO vira filtro por lista vazia", () => {
    // `provider_account_id = ANY('{}')` não devolve linha nenhuma. O painel
    // mostraria zero onde antes mostrava tudo, e zero passa por custo real.
    const r = resolverRecorteContasOvh(undefined, []);
    expect(r.ids).toBeUndefined();
    expect(r.cadastroVazio).toBe(true);
    expect(r.resolvidoParaAtivas).toBe(false);
  });

  it("cadastro vazio se explica na tela", () => {
    const r = resolverRecorteContasOvh(undefined, []);
    expect(avisoCadastroVazio(r)?.codigo).toBe("ovh-cadastro-vazio");
  });

  it("uma conta nova ativa entra sozinha, sem mudança de código", () => {
    const r = resolverRecorteContasOvh(undefined, [...ATIVAS, "ovh-cliente-eu"]);
    expect(r.ids).toContain("ovh-cliente-eu");
  });
});

describe("seleção explícita", () => {
  it("uma conta filtra só ela", () => {
    const r = resolverRecorteContasOvh(["ovh-main-ca"], ATIVAS);
    expect(r.ids).toEqual(["ovh-main-ca"]);
    expect(r.selecaoExplicita).toBe(true);
    expect(r.resolvidoParaAtivas).toBe(false);
  });

  it("várias contas filtram as várias", () => {
    const r = resolverRecorteContasOvh(ATIVAS, ATIVAS);
    expect(r.ids).toEqual(ATIVAS);
    expect(r.selecaoExplicita).toBe(true);
  });

  it("id fora do cadastro é MANTIDO no filtro, e não descartado", () => {
    // Conta desativada — ou cujo custo foi importado antes do cadastro — tem
    // linha legítima em `ovh_monthly_costs`. Removê-la do filtro faria o
    // recorte pedido devolver dado de outra conta.
    const r = resolverRecorteContasOvh(["ovh-desativada"], ATIVAS);
    expect(r.ids).toEqual(["ovh-desativada"]);
    expect(r.idsDesconhecidos).toEqual(["ovh-desativada"]);
  });

  it("id desconhecido se explica, para que 0,00 não passe por resposta", () => {
    const r = resolverRecorteContasOvh(["123456789012"], ATIVAS);
    const aviso = avisoContasDesconhecidas(r);
    expect(aviso?.codigo).toBe("ovh-conta-desconhecida");
    expect(aviso?.mensagem).toContain("123456789012");
  });

  it("uma conta AWS no filtro OVH não é conta OVH ativa", () => {
    // A tabela consultada só tem linha OVH, então o id AWS devolve zero linhas.
    // O que este teste garante é que o zero venha ACOMPANHADO de explicação.
    const r = resolverRecorteContasOvh(["123456789012"], ATIVAS);
    expect(r.idsDesconhecidos).toEqual(["123456789012"]);
  });

  it("com seleção explícita não há aviso de cadastro vazio", () => {
    const r = resolverRecorteContasOvh(["ovh-main-ca"], []);
    expect(avisoCadastroVazio(r)).toBeNull();
  });
});

describe("custo que ficou de fora do recorte 'todas'", () => {
  it("avisa quando há linha fora do cadastro ativo", () => {
    const r = resolverRecorteContasOvh(undefined, ATIVAS);
    const aviso = avisoCustoForaDoCadastro(r, 12);
    expect(aviso?.codigo).toBe("ovh-custo-fora-do-cadastro");
    expect(aviso?.mensagem).toContain("12");
  });

  it("não avisa quando não sobrou nada de fora", () => {
    const r = resolverRecorteContasOvh(undefined, ATIVAS);
    expect(avisoCustoForaDoCadastro(r, 0)).toBeNull();
  });

  it("não avisa quando a exclusão foi PEDIDA", () => {
    // Com seleção explícita, deixar contas de fora é o que a pessoa quis. O
    // aviso viraria ruído em todo recorte de uma conta.
    const r = resolverRecorteContasOvh(["ovh-main-ca"], ATIVAS);
    expect(avisoCustoForaDoCadastro(r, 99)).toBeNull();
  });
});
