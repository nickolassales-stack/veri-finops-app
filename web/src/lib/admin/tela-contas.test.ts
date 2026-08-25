import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Garantias da tela de Contas Cloud que só a COMPOSIÇÃO expressa.
 *
 * O projeto não tem testing-library — estes guardas leem a fonte, como
 * `rotas-versionadas.test.ts` e o guarda de separação dos exports em
 * `analitico-ovh.test.ts`.
 *
 * O que se guarda aqui não é aparência. São quatro propriedades que, se
 * quebrarem, quebram em silêncio:
 *
 *   1. a lista não volta a misturar provedores;
 *   2. o filtro acontece no SERVIDOR, e não só na tela;
 *   3. criar conta OVH continua sendo ADMIN-only, porque o corpo tem segredo;
 *   4. "Adicionar conta AWS" continua sendo procedimento, e não formulário.
 */

const SRC = join(__dirname, "..", "..");

/**
 * Só as linhas de CÓDIGO.
 *
 * Os arquivos CITAM em comentário o que não fazem — "não há campos aqui", "a
 * AWS não tem credencial a guardar". Uma busca por substring reprovaria a
 * documentação correta, erro já cometido duas vezes neste repositório.
 */
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

describe("a listagem é filtrada no servidor", () => {
  const rota = codigo("app", "api", "admin", "accounts", "route.ts");
  const painel = codigo("components", "admin", "painel-contas.tsx");

  it("a rota lê ?provider= e filtra antes de responder", () => {
    expect(rota).toContain("esquemaProviderConsulta");
    expect(rota).toMatch(/searchParams\.get\("provider"\)/);
    expect(rota).toMatch(/\.filter\(/);
  });

  it("a tela manda o provider na requisição", () => {
    // Sem isto o filtro seria só visual: a lista OVH inteira — com a situação
    // de cada credencial — chegaria a quem abriu a visão AWS, visível em
    // qualquer aba de rede.
    expect(painel).toMatch(/\/api\/admin\/accounts\?provider=/);
  });

  it("o provider está nas dependências do efeito de carga", () => {
    // Sem ele, trocar de visão reaproveitaria a lista do provedor anterior.
    expect(painel).toMatch(/\[gatilho, provider\]/);
  });
});

describe("criar conta é ADMIN, e só cria OVH", () => {
  const rota = codigo("app", "api", "admin", "accounts", "route.ts");

  it("o POST usa rotaSomenteAdmin, não rotaComPermissao", () => {
    // O corpo carrega os três segredos da OVH. `settings:accounts` é delegável
    // a qualquer grupo, e um grupo pode conter um VIEWER — nenhuma permissão
    // consegue expressar "só ADMIN". Ver rbac-credenciais.test.ts.
    const post = /export const POST = (\w+)\(/.exec(rota);
    expect(post, "não achei o export do POST").not.toBeNull();
    expect(post![1]).toBe("rotaSomenteAdmin");
  });

  it("o GET continua por permissão delegável", () => {
    // Ler a lista e os metadados não exige ADMIN — e restringir isso tiraria a
    // tela de quem tem `settings:accounts` legitimamente.
    const get = /export const GET = (\w+)\(/.exec(rota);
    expect(get![1]).toBe("rotaComPermissao");
  });

  it("não existe rota de criação de conta AWS", () => {
    // Conta AWS não se cadastra: ela existe porque entregou custo no CUR. Um
    // formulário criaria uma linha que nunca casa com dado nenhum.
    expect(rota).not.toMatch(/provider:\s*["']aws["']/);
  });

  it("o teste avulso de credencial também é ADMIN", () => {
    const teste = codigo("app", "api", "admin", "ovh", "test-credentials", "route.ts");
    expect(/export const POST = (\w+)\(/.exec(teste)![1]).toBe("rotaSomenteAdmin");
  });
});

describe("nenhum segredo volta para a tela", () => {
  it("a rota de teste avulso devolve só veredito", () => {
    const servico = codigo("lib", "services", "credenciais-ovh.ts");
    const trecho = servico.slice(servico.indexOf("export async function testarCredencialAvulsa"));
    const corpo = trecho.slice(0, trecho.indexOf("\nexport ") + 1 || undefined);
    // O retorno é `{ ok, mensagem, nichandle }`. Se um dia devolver a chave, o
    // segredo passa a trafegar de volta ao navegador.
    expect(corpo).not.toMatch(/return[\s\S]{0,200}applicationSecret/);
  });

  it("o formulário de criação nunca preenche campo de segredo com dado recebido", () => {
    const modal = codigo("components", "admin", "contas", "modal-adicionar-ovh.tsx");
    // Os três campos são controlados pelo estado LOCAL do formulário (`f.`), e
    // nunca por algo vindo da resposta da API.
    expect(modal).toMatch(/value=\{f\.applicationSecret\}/);
    expect(modal).not.toMatch(/value=\{[^}]*credencial[^}]*Secret/i);
  });

  it("o Application Secret é campo de senha", () => {
    const modal = codigo("components", "admin", "contas", "modal-adicionar-ovh.tsx");
    const campo = modal.slice(modal.indexOf('rotulo="Application Secret"'));
    expect(campo.slice(0, 300)).toContain('type="password"');
  });
});

describe("Adicionar conta AWS é procedimento, não formulário", () => {
  const modal = codigo("components", "admin", "contas", "modal-adicionar-aws.tsx");

  it("não tem campo de entrada nenhum", () => {
    expect(modal).not.toMatch(/<Campo\b/);
    expect(modal).not.toMatch(/<input\b/);
    expect(modal).not.toMatch(/<form\b/);
  });

  it("não pede chave da AWS", () => {
    // A AWS autentica por IAM role da instância. Um campo de chave aqui
    // sugeriria um segredo que o portal não guarda e não precisa.
    expect(modal).not.toMatch(/accessKey|secretKey|AWS_ACCESS/i);
  });

  it("traz os oito passos, na ordem", () => {
    // `titulo: "` com a aspa: `titulo:` sozinho casaria tambem a anotacao de
    // tipo do array, e o teste contaria nove passos onde ha oito.
    const passos = modal.match(/titulo: "/g) ?? [];
    expect(passos.length).toBe(8);
  });

  it("cita os pontos que a AWS exige literalmente", () => {
    for (const termo of ["Parquet", "Athena", "CUR 2.0", "account_id="]) {
      expect(modal, termo).toContain(termo);
    }
  });
});

describe("Adicionar conta OVH é formulário", () => {
  const modal = codigo("components", "admin", "contas", "modal-adicionar-ovh.tsx");

  it("tem os campos pedidos", () => {
    for (const rotulo of [
      "Provider Account ID",
      "Alias",
      "Unidade de negócio",
      "Centro de custo",
      "Ambiente",
      "Endpoint",
      "Application Key",
      "Application Secret",
      "Consumer Key",
    ]) {
      expect(modal, rotulo).toContain(`rotulo="${rotulo}"`);
    }
  });

  it("tem os três botões", () => {
    expect(modal).toContain("Testar conexão");
    expect(modal).toContain("Salvar e executar primeira coleta");
    expect(modal).toMatch(/>\s*Salvar\s*</);
  });

  it("testar conexão usa a rota sem accountId", () => {
    // A conta ainda não existe: a rota com `:accountId` devolveria 404.
    expect(modal).toContain("/api/admin/ovh/test-credentials");
  });
});

describe("o cartão de conta separa os dois provedores", () => {
  const cartao = codigo("components", "admin", "contas", "cartao-conta.tsx");

  it("o bloco de credenciais exige provider ovh E papel admin", () => {
    // As duas condições são independentes: a primeira é sobre o que o bloco
    // significa, a segunda sobre quem pode vê-lo.
    expect(cartao).toMatch(
      /provider === "ovh" && podeVerCredenciais && mostrarCredenciais/,
    );
  });

  it("o formulário de edição não tem campo de credencial", () => {
    const form = cartao.slice(cartao.indexOf("function FormularioMetadados"));
    for (const proibido of ["applicationKey", "applicationSecret", "consumerKey", "endpoint"]) {
      expect(form, proibido).not.toContain(proibido);
    }
  });

  it("o formulário de edição não permite trocar o provider", () => {
    const form = cartao.slice(cartao.indexOf("function FormularioMetadados"));
    expect(form).not.toMatch(/rotulo="Provedor"|name="provider"/);
    // O PATCH manda exatamente os quatro metadados, e nada mais.
    expect(form).toMatch(/alias:[\s\S]{0,200}environment:/);
    expect(form).not.toMatch(/provider:/);
  });

  it("a visão AWS não desenha selo nem bloco de credencial", () => {
    const resumoAws = cartao.slice(
      cartao.indexOf("function ResumoAws"),
      cartao.indexOf("function ResumoOvh"),
    );
    expect(resumoAws).not.toContain("credencial");
    expect(resumoAws).not.toContain("Endpoint");
  });
});
