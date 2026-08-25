"use client";

import { useState } from "react";

import {
  PARA_QUE_SERVE,
  PERMISSOES_OVH,
  REGIAO_DO_ENDPOINT,
  textoPermissoesOvh,
} from "@/lib/ovh/permissoes";
import { URL_CRIAR_TOKEN, type EndpointOvh } from "@/lib/ovh/endpoints";

/**
 * "Permissões necessárias na OVH" — o bloco que evita a segunda ida ao console.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ELE FICA AQUI, E NÃO NA DOCUMENTAÇÃO
 *
 * Criar a credencial na OVH é irreversível na parte que importa: o Application
 * Secret é mostrado UMA vez. Quem gera o token sem os direitos certos descobre o
 * problema minutos depois, na primeira coleta, com um 403 que se parece com
 * chave inválida — e o conserto é gerar tudo de novo.
 *
 * O bloco fica aberto por padrão e antes dos campos de chave, porque a ordem de
 * quem cadastra é: ler os direitos → abrir o console da OVH → criar o token →
 * voltar e colar. Documentação num arquivo `.md` não participa dessa ordem.
 *
 * ---------------------------------------------------------------------------
 * COPIAR PODE FALHAR, E A FALHA PRECISA TER SAÍDA
 *
 * `navigator.clipboard` exige contexto seguro e pode ser negado pelo navegador.
 * Quando falha, o `<pre>` continua ali, selecionável, e a mensagem diz para
 * copiar à mão — em vez de um botão que não faz nada e não explica.
 */
export function BlocoPermissoesOvh({ endpoint }: { endpoint: EndpointOvh }) {
  const [copia, setCopia] = useState<"ocioso" | "ok" | "falhou">("ocioso");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoPermissoesOvh());
      setCopia("ok");
    } catch {
      setCopia("falhou");
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-veri-verde-claro/40 bg-veri-offwhite/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-veri-verde-escuro">
          Permissões necessárias na OVH
        </h3>
        <button
          type="button"
          onClick={() => void copiar()}
          className="rounded-full border border-veri-verde-claro/60 bg-veri-branco px-3.5 py-1.5 text-xs font-medium text-veri-verde-escuro transition-colors hover:bg-veri-offwhite"
        >
          Copiar permissões
        </button>
      </div>

      <p className="text-xs leading-relaxed text-texto-suave">
        Adicione estas permissões na criação do token/API credential da OVH. Elas
        permitem validar a conta, consultar faturas e consultar projetos Public Cloud.
        Não use <code className="veri-numero">GET /*</code>, porque libera leitura ampla
        demais.
      </p>

      {/* O bloco copiável E a tabela: o `<pre>` é o que se cola no formulário da
          OVH, a tabela é o que responde "por que preciso disto?". Um só dos dois
          deixaria uma das duas perguntas sem resposta. */}
      <pre className="veri-numero overflow-x-auto rounded-lg border border-veri-verde-claro/40 bg-veri-branco p-3 text-xs leading-relaxed text-veri-verde-escuro">
        {textoPermissoesOvh()}
      </pre>

      <div
        aria-live="polite"
        className={copia === "ocioso" ? "sr-only" : "text-xs font-medium"}
      >
        {copia === "ok" && (
          <span className="text-veri-verde-escuro">
            Permissões copiadas. Cole no campo de direitos do token na OVH.
          </span>
        )}
        {copia === "falhou" && (
          <span className="text-veri-vinho">
            O navegador não permitiu copiar. Selecione o bloco acima e copie à mão.
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-veri-verde-claro/40 text-texto-suave">
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Permissão
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Para que serve
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMISSOES_OVH.map((p) => (
              <tr key={p} className="border-b border-veri-offwhite last:border-0">
                <th
                  scope="row"
                  className="veri-numero whitespace-nowrap py-1.5 pr-4 font-normal text-veri-verde-escuro"
                >
                  {p}
                </th>
                <td className="py-1.5 text-texto-suave">{PARA_QUE_SERVE[p]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A recomendação de região acompanha o endpoint ESCOLHIDO no seletor, e
          muda com ele: as três regiões são contas separadas na OVH, e o token
          criado na errada devolve 404 em `/me` — sintoma que se confunde com
          credencial inválida. O link é o do console daquela região. */}
      <p className="border-t border-veri-verde-claro/30 pt-3 text-xs leading-relaxed text-texto-suave">
        <strong className="font-medium text-veri-verde-escuro">
          Endpoint recomendado para esta conta:
        </strong>{" "}
        <span className="veri-numero">{endpoint}</span> — para contas em{" "}
        {REGIAO_DO_ENDPOINT[endpoint]}. Crie o token em{" "}
        <a
          href={URL_CRIAR_TOKEN[endpoint]}
          target="_blank"
          rel="noopener noreferrer"
          className="veri-numero underline underline-offset-2 hover:text-veri-verde-escuro"
        >
          {URL_CRIAR_TOKEN[endpoint]}
        </a>
        . As três regiões são contas separadas: uma credencial de uma não vale na outra.
      </p>
    </section>
  );
}
