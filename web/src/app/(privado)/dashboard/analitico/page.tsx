import { Aviso } from "@/components/ui/aviso";
import { requireSessao } from "@/lib/auth/dal";

export const metadata = { title: "Analitico" };

/**
 * Rota protegida, ainda sem conteudo analitico.
 *
 * A etapa atual do projeto e autenticacao; o conteudo desta tela vem na etapa
 * seguinte. Nao ha numero simulado aqui de proposito -- o projeto nao usa dado
 * mockado. O que esta valendo agora e a protecao: sem sessao, nao se chega.
 */
export default async function AnaliticoPage() {
  const sessao = await requireSessao("/dashboard/analitico");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="veri-display text-3xl text-veri-verde-escuro">Analitico</h1>
        <p className="mt-2 text-sm text-veri-verde-escuro/70">
          Rota protegida. Acesso autenticado como{" "}
          <span className="veri-numero">{sessao.email}</span>.
        </p>
      </div>

      <Aviso tom="info" titulo="Tela em construcao">
        <p>
          A visao analitica sera construida na proxima etapa. Nenhum dado
          simulado e exibido aqui.
        </p>
      </Aviso>
    </div>
  );
}
