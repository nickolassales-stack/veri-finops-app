"use client";

import { useActionState } from "react";

import { entrar, type EstadoLogin } from "@/lib/auth/actions";

const estadoInicial: EstadoLogin = {};

export function LoginForm({ next }: { next?: string }) {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial);

  return (
    <form action={acao} className="space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wide text-veri-verde-escuro/70"
        >
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          disabled={pendente}
          className="mt-1.5 w-full rounded-xl border border-veri-verde-claro/60 bg-veri-branco px-4 py-2.5 text-veri-verde-escuro placeholder:text-veri-verde-escuro/35 focus:border-veri-verde-escuro disabled:opacity-60"
          placeholder="nome@porveri.com.br"
        />
      </div>

      <div>
        <label
          htmlFor="senha"
          className="block text-xs font-medium uppercase tracking-wide text-veri-verde-escuro/70"
        >
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          disabled={pendente}
          className="mt-1.5 w-full rounded-xl border border-veri-verde-claro/60 bg-veri-branco px-4 py-2.5 text-veri-verde-escuro focus:border-veri-verde-escuro disabled:opacity-60"
        />
      </div>

      {/* aria-live: leitor de tela anuncia o erro sem o usuario precisar navegar ate ele */}
      <div aria-live="polite" aria-atomic="true">
        {estado.erro && (
          <p className="rounded-xl border border-veri-vinho/30 bg-veri-vinho/8 px-4 py-3 text-sm text-veri-vinho">
            {estado.erro}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={pendente}
        className="w-full rounded-full bg-veri-verde-escuro px-5 py-3 text-sm font-medium text-veri-branco transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pendente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
