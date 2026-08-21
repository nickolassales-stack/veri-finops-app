import { redirect } from "next/navigation";

/**
 * `/diagnostico` foi para `/dashboard/diagnostico`.
 *
 * O arquivo continua existindo em vez de simplesmente sumir: quem tinha a tela
 * nos favoritos, ou um link colado num chamado antigo, chega no lugar certo em
 * vez de tomar 404. O conteudo que estava aqui -- estrutura do banco e
 * privilegios efetivos -- virou a ultima secao da tela nova.
 *
 * REDIRECIONAMENTO TEMPORARIO (307) e nao permanente (308) de proposito: 308
 * fica no cache do navegador por tempo indeterminado, e desfaze-lo depois
 * exigiria pedir a cada pessoa que limpasse o cache. O custo do 307 e um salto
 * a mais por acesso numa rota que praticamente ninguem digita.
 *
 * Nao ha checagem de permissao aqui: o destino exige `diagnostics:view`, e
 * verificar antes do salto so anteciparia a mesma recusa.
 */
export default function DiagnosticoLegadoPage() {
  redirect("/dashboard/diagnostico");
}
