"use client";

import { useActionState } from "react";

import { alterarSenha, type EstadoTrocaSenha } from "@/lib/auth/actions";

const estadoInicial: EstadoTrocaSenha = {};

const CAMPOS = [
  { nome: "senhaAtual", rotulo: "Senha atual", autoComplete: "current-password" },
  { nome: "novaSenha", rotulo: "Nova senha", autoComplete: "new-password" },
  { nome: "confirmacao", rotulo: "Confirmar nova senha", autoComplete: "new-password" },
] as const;

export function TrocaSenhaForm({ minimo }: { minimo: number }) {
  const [estado, acao, pendente] = useActionState(alterarSenha, estadoInicial);

  return (
    <form action={acao} className="max-w-sm space-y-5">
      {CAMPOS.map((campo) => (
        <div key={campo.nome}>
          <label
            htmlFor={campo.nome}
            className="block text-xs font-medium uppercase tracking-wide text-veri-verde-escuro/70"
          >
            {campo.rotulo}
          </label>
          <input
            id={campo.nome}
            name={campo.nome}
            type="password"
            autoComplete={campo.autoComplete}
            required
            disabled={pendente}
            minLength={campo.nome === "senhaAtual" ? undefined : minimo}
            className="mt-1.5 w-full rounded-xl border border-veri-verde-claro/60 bg-veri-branco px-4 py-2.5 text-veri-verde-escuro focus:border-veri-verde-escuro disabled:opacity-60"
          />
        </div>
      ))}

      <p className="text-xs text-veri-verde-escuro/60">
        Mínimo de {minimo} caracteres. Ao trocar a senha, as sessões abertas em
        outros navegadores são encerradas.
      </p>

      <div aria-live="polite" aria-atomic="true">
        {estado.erro && (
          <p className="rounded-xl border border-veri-vinho/30 bg-veri-vinho/8 px-4 py-3 text-sm text-veri-vinho">
            {estado.erro}
          </p>
        )}
        {estado.sucesso && (
          <p className="rounded-xl border border-veri-verde/40 bg-veri-verde/10 px-4 py-3 text-sm text-veri-verde-escuro">
            {estado.sucesso}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pendente}
        className="rounded-full bg-veri-verde-escuro px-6 py-3 text-sm font-medium text-veri-branco transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pendente ? "Alterando…" : "Alterar senha"}
      </button>
    </form>
  );
}
