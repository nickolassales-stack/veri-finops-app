import Link from "next/link";

import { Aviso } from "@/components/ui/aviso";
import { requireSessao } from "@/lib/auth/dal";
import { ROTULOS, ehPermissaoConhecida } from "@/lib/auth/permissoes";

export const metadata = { title: "Sem permissao" };

/**
 * Tela de acesso negado.
 *
 * Diz QUAL permissao falta e o que ela significa, em vez de um "sem permissao"
 * seco. A diferenca e pratica: com o nome da permissao, a pessoa abre um chamado
 * que o administrador resolve em um clique; sem ele, o chamado vira "o sistema
 * nao me deixa entrar" e alguem precisa investigar.
 *
 * O nome da permissao nao e informacao sensivel: o catalogo inteiro esta na tela
 * de configuracoes e no README. O que ele revela e apenas o vocabulario do
 * controle de acesso, nao dado de ninguem.
 */
export default async function SemPermissaoPage({
  searchParams,
}: PageProps<"/sem-permissao">) {
  const sessao = await requireSessao();
  const { requer } = await searchParams;

  // Vem da URL, entao pode ser qualquer coisa: so exibimos o que existe no
  // catalogo. Assim ninguem usa esta tela para renderizar texto arbitrario.
  const chave = typeof requer === "string" && ehPermissaoConhecida(requer) ? requer : null;
  const detalhe = chave ? ROTULOS[chave] : null;

  return (
    <div className="space-y-6">
      <h1 className="veri-display text-3xl text-veri-verde-escuro">Sem permissão</h1>

      <Aviso tom="atencao" titulo="Você não tem acesso a esta tela">
        <p>
          Você está autenticado como <span className="veri-numero">{sessao.email}</span>{" "}
          com perfil <strong>{sessao.papel}</strong>.
        </p>

        {detalhe && chave ? (
          <p>
            Esta tela exige a permissão <span className="veri-numero">{chave}</span> —{" "}
            {detalhe.titulo.toLowerCase()}. Peça a um administrador que a conceda a um
            grupo do qual você participe, em <strong>Configurações › Permissões</strong>.
          </p>
        ) : (
          <p>
            Peça a um administrador que revise seus grupos em{" "}
            <strong>Configurações › Permissões</strong>.
          </p>
        )}

        <p>
          <Link href="/dashboard" className="underline underline-offset-2">
            Voltar à visão executiva
          </Link>
        </p>
      </Aviso>
    </div>
  );
}
