"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireSessao } from "./dal";
import { destinoInternoValido } from "./destino";
import { hashPassword, verifyPassword } from "./password.mjs";
import {
  atualizarSenha,
  buscarHashDeSenha,
  buscarUsuarioPorEmail,
  criarSessao,
  destruirOutrasSessoes,
  destruirSessaoAtual,
  limparSessoesExpiradas,
  marcarLogin,
} from "./session";
import { validarTrocaSenha } from "./troca-senha";

export type EstadoLogin = { erro?: string };

const esquemaLogin = z.object({
  email: z.string().trim().min(1, "Informe o e-mail").max(320),
  senha: z.string().min(1, "Informe a senha").max(1024),
  next: z.string().optional(),
});

/**
 * Hash de descarte, gerado sobre uma senha aleatoria que foi jogada fora.
 *
 * Serve para gastar o mesmo tempo de derivacao quando o e-mail nao existe. Sem
 * isso, "e-mail inexistente" responderia em ~1ms e "senha errada" em ~130ms, e
 * essa diferenca permitiria enumerar quais e-mails tem conta.
 */
const HASH_DE_DESCARTE =
  "scrypt$65536$8$1$P6fEnWFYbynffjndcK6aAQ==$AiauZPoIojrsOGP4zQDDVnpeljxMorZKVxCJY9qIcqEzpXUaR6Tu/8K1firlC/f0RnbBXINOVRLF8YsX1IwtSg==";

/** Mensagem unica: nunca revela se o que falhou foi o e-mail ou a senha. */
const CREDENCIAL_INVALIDA = "E-mail ou senha incorretos.";

// ---------------------------------------------------------------- throttling

/**
 * Limitador de tentativas em memoria do processo.
 *
 * LIMITACAO CONHECIDA: e por processo. Com uma unica replica (o caso hoje) ele
 * funciona; ao escalar para mais de um container, cada um teria a propria
 * contagem. A evolucao natural e mover para uma tabela ou Redis.
 */
const MAX_TENTATIVAS = 5;
const JANELA_MS = 15 * 60_000;
const BLOQUEIO_MS = 5 * 60_000;

type Tentativa = { falhas: number; primeiraEm: number; bloqueadoAte: number };
const tentativas = new Map<string, Tentativa>();

function chaveThrottle(email: string, ip: string | null): string {
  return `${email.toLowerCase()}|${ip ?? "sem-ip"}`;
}

function bloqueadoPor(chave: string): number {
  const t = tentativas.get(chave);
  if (!t) return 0;
  const restante = t.bloqueadoAte - Date.now();
  return restante > 0 ? restante : 0;
}

function registrarFalha(chave: string): void {
  const agora = Date.now();
  const atual = tentativas.get(chave);

  if (!atual || agora - atual.primeiraEm > JANELA_MS) {
    tentativas.set(chave, { falhas: 1, primeiraEm: agora, bloqueadoAte: 0 });
    return;
  }

  atual.falhas += 1;
  if (atual.falhas >= MAX_TENTATIVAS) {
    atual.bloqueadoAte = agora + BLOQUEIO_MS;
    atual.falhas = 0;
    atual.primeiraEm = agora;
  }
  tentativas.set(chave, atual);
}

function limparFalhas(chave: string): void {
  tentativas.delete(chave);
}

// -------------------------------------------------------------------- acoes

export async function entrar(
  _estadoAnterior: EstadoLogin,
  dados: FormData,
): Promise<EstadoLogin> {
  const analisado = esquemaLogin.safeParse({
    email: dados.get("email"),
    senha: dados.get("senha"),
    next: dados.get("next") ?? undefined,
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? "Dados invalidos." };
  }

  const { email, senha, next } = analisado.data;
  const cabecalhos = await headers();
  const ip =
    cabecalhos.get("x-forwarded-for") ?? cabecalhos.get("x-real-ip") ?? null;
  const chave = chaveThrottle(email, ip);

  const bloqueio = bloqueadoPor(chave);
  if (bloqueio > 0) {
    const minutos = Math.ceil(bloqueio / 60_000);
    return {
      erro: `Muitas tentativas. Tente novamente em ${minutos} minuto(s).`,
    };
  }

  const usuario = await buscarUsuarioPorEmail(email);

  // Deriva sempre, mesmo sem usuario, para o tempo de resposta nao vazar
  // a existencia da conta.
  const senhaCorreta = await verifyPassword(
    senha,
    usuario?.password_hash ?? HASH_DE_DESCARTE,
  );

  if (!usuario || !senhaCorreta) {
    registrarFalha(chave);
    return { erro: CREDENCIAL_INVALIDA };
  }

  limparFalhas(chave);

  await criarSessao(usuario.id, {
    ip,
    userAgent: cabecalhos.get("user-agent"),
  });
  await marcarLogin(usuario.id);

  // Faxina oportunista: evita depender de cron para uma tabela que cresce devagar.
  await limparSessoesExpiradas();

  // redirect() lanca por design -- precisa ficar fora de qualquer try/catch.
  redirect(next && destinoInternoValido(next) ? next : "/dashboard");
}

export async function sair(): Promise<void> {
  await destruirSessaoAtual();
  redirect("/login");
}

// -------------------------------------------------------------- troca de senha

export type EstadoTrocaSenha = {
  erro?: string;
  sucesso?: string;
};

/**
 * Troca a senha do usuario autenticado.
 *
 * Exige a senha atual mesmo havendo sessao valida: sem isso, um cookie roubado
 * permitiria trocar a senha e tomar a conta em definitivo.
 */
export async function alterarSenha(
  _estadoAnterior: EstadoTrocaSenha,
  dados: FormData,
): Promise<EstadoTrocaSenha> {
  const sessao = await requireSessao("/conta");

  const entrada = {
    senhaAtual: String(dados.get("senhaAtual") ?? ""),
    novaSenha: String(dados.get("novaSenha") ?? ""),
    confirmacao: String(dados.get("confirmacao") ?? ""),
  };

  const problema = validarTrocaSenha(entrada);
  if (problema) return { erro: problema };

  const hashAtual = await buscarHashDeSenha(sessao.userId);
  if (!hashAtual) {
    return { erro: "Nao foi possivel ler o cadastro do usuario." };
  }

  const senhaAtualCorreta = await verifyPassword(entrada.senhaAtual, hashAtual);
  if (!senhaAtualCorreta) {
    return { erro: "A senha atual esta incorreta." };
  }

  await atualizarSenha(sessao.userId, await hashPassword(entrada.novaSenha));

  // Derruba sessoes em outros navegadores/dispositivos, mantendo esta.
  const encerradas = await destruirOutrasSessoes(sessao.userId);

  return {
    sucesso:
      encerradas > 0
        ? `Senha alterada. ${encerradas} outra(s) sessao(oes) foram encerradas.`
        : "Senha alterada com sucesso.",
  };
}
