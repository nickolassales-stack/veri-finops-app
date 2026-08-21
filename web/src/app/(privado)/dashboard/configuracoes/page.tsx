import Link from "next/link";

import { Card } from "@/components/ui/card";
import { podeAtual } from "@/lib/auth/autorizacao";
import type { Permissao } from "@/lib/auth/permissoes";

export const metadata = { title: "Configuracoes" };

/**
 * Ponto de entrada da area administrativa.
 *
 * Cada cartao anuncia a permissao que exige e diz quando o usuario nao a tem,
 * em vez de sumir da tela. Esconder criaria a duvida pior de suporte -- "o
 * botao nao aparece para mim" -- quando a resposta e simplesmente que falta uma
 * permissao nomeavel, que alguem pode conceder.
 */

const SECOES: {
  href: string;
  titulo: string;
  descricao: string;
  permissao: Permissao;
}[] = [
  {
    href: "/dashboard/configuracoes/contas",
    titulo: "Contas Cloud",
    descricao:
      "Dê um nome amigável a cada conta de qualquer provedor e registre unidade, centro de custo e ambiente. Contas OVH têm também as credenciais de API, restritas a administradores.",
    permissao: "settings:accounts",
  },
  {
    href: "/dashboard/configuracoes/usuarios",
    titulo: "Usuários",
    descricao:
      "Crie acessos, ative e desative pessoas e defina de quais grupos cada uma participa. Não há cadastro público.",
    permissao: "settings:users",
  },
  {
    href: "/dashboard/configuracoes/grupos",
    titulo: "Grupos",
    descricao:
      "Organize as pessoas por função. O grupo é o que carrega as permissões — o usuário herda delas.",
    permissao: "settings:groups",
  },
  {
    href: "/dashboard/configuracoes/permissoes",
    titulo: "Permissões",
    descricao:
      "Veja o modelo completo e decida o que cada grupo pode fazer, tela por tela.",
    permissao: "settings:groups",
  },
];

export default async function ConfiguracoesPage() {
  const liberadas = await Promise.all(SECOES.map((s) => podeAtual(s.permissao)));

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {SECOES.map((secao, i) => {
        const liberada = liberadas[i];

        return (
          <Card key={secao.href} titulo={secao.titulo}>
            <p className="text-sm leading-relaxed text-texto-suave">{secao.descricao}</p>

            <p className="mt-4">
              {liberada ? (
                <Link
                  href={secao.href}
                  className="inline-flex items-center rounded-full border border-veri-verde-claro/60 px-4 py-2 text-sm font-medium text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
                >
                  Abrir {secao.titulo.toLowerCase()}
                </Link>
              ) : (
                <span className="inline-block rounded-lg bg-veri-offwhite/70 px-3 py-2 text-xs text-texto-suave">
                  Requer a permissão{" "}
                  <span className="veri-numero font-medium">{secao.permissao}</span>. Peça
                  a um administrador.
                </span>
              )}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
