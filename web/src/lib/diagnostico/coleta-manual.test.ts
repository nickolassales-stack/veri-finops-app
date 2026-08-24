import { describe, expect, it } from "vitest";

import {
  ESCOPO_TODAS,
  avaliarEscopo,
  corpoDaColeta,
  type ContaColeta,
} from "./coleta-manual";

function conta(
  accountId: string,
  { credencial = true, job = false }: { credencial?: boolean; job?: boolean } = {},
): ContaColeta {
  return {
    accountId,
    nome: `Conta ${accountId}`,
    temCredencial: credencial,
    jobAtivo: job ? { id: "9", status: "running" } : null,
  };
}

describe("avaliarEscopo", () => {
  it("com escopo Todas, alcanca todas as contas", () => {
    const r = avaliarEscopo([conta("a"), conta("b")], ESCOPO_TODAS);
    expect(r.selecionadas).toHaveLength(2);
    expect(r.bloqueado).toBe(false);
  });

  it("com escopo de conta, alcanca so ela", () => {
    const r = avaliarEscopo([conta("a"), conta("b")], "b");
    expect(r.selecionadas.map((c) => c.accountId)).toEqual(["b"]);
  });

  it("bloqueia quando a unica conta do escopo ja esta coletando", () => {
    const r = avaliarEscopo([conta("a", { job: true })], "a");
    expect(r.tudoEmAndamento).toBe(true);
    expect(r.bloqueado).toBe(true);
  });

  it("NAO bloqueia Todas quando apenas parte esta coletando", () => {
    // O ponto do teste: barrar as tres faria uma coleta em curso impedir as
    // demais, que e o oposto do isolamento por conta que o collector implementa.
    const r = avaliarEscopo(
      [conta("a", { job: true }), conta("b"), conta("c")],
      ESCOPO_TODAS,
    );
    expect(r.emAndamento).toHaveLength(1);
    expect(r.tudoEmAndamento).toBe(false);
    expect(r.bloqueado).toBe(false);
  });

  it("bloqueia Todas quando todas estao coletando", () => {
    const r = avaliarEscopo(
      [conta("a", { job: true }), conta("b", { job: true })],
      ESCOPO_TODAS,
    );
    expect(r.tudoEmAndamento).toBe(true);
    expect(r.bloqueado).toBe(true);
  });

  it("conta sem credencial nao conta como enfileiravel", () => {
    const r = avaliarEscopo([conta("a", { credencial: false })], "a");
    expect(r.semCredencial).toHaveLength(1);
    expect(r.bloqueado).toBe(true);
  });

  it("mistura de sem-credencial e em-andamento ainda libera a terceira", () => {
    const r = avaliarEscopo(
      [conta("a", { credencial: false }), conta("b", { job: true }), conta("c")],
      ESCOPO_TODAS,
    );
    expect(r.bloqueado).toBe(false);
  });

  it("lista vazia bloqueia sem afirmar que ha coleta em andamento", () => {
    // `every` numa lista vazia devolve `true` por vacuidade -- sem a guarda de
    // tamanho, a tela diria "ja existe uma coleta em andamento" para zero contas.
    const r = avaliarEscopo([], ESCOPO_TODAS);
    expect(r.tudoEmAndamento).toBe(false);
    expect(r.bloqueado).toBe(true);
  });

  it("escopo apontando para conta inexistente nao seleciona nada", () => {
    const r = avaliarEscopo([conta("a")], "nao-existe");
    expect(r.selecionadas).toHaveLength(0);
    expect(r.bloqueado).toBe(true);
  });
});

describe("corpoDaColeta", () => {
  it("Todas vira scope all, sem accountId", () => {
    expect(corpoDaColeta(ESCOPO_TODAS)).toEqual({ scope: "all" });
  });

  it("conta especifica vira scope account", () => {
    expect(corpoDaColeta("ovh-main-ca")).toEqual({
      scope: "account",
      accountId: "ovh-main-ca",
    });
  });
});
