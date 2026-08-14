"use client";

import { useCallback, useEffect, useState } from "react";

import { Aviso } from "@/components/ui/aviso";
import { Botao } from "@/components/ui/botao";
import { Campo, Marcacao, Selecao } from "@/components/ui/campo";
import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { escrever, ler, mensagemDoErro } from "@/lib/admin/cliente";

type Grupo = { id: string; nome: string; ativo: boolean };

type Usuario = {
  id: string;
  nome: string | null;
  email: string;
  papel: "ADMIN" | "VIEWER";
  ativo: boolean;
  ultimoLoginEm: string | null;
  criadoEm: string;
  grupos: { id: string; nome: string }[];
};

/** Espelha `MIN_TAMANHO_SENHA` do servidor. O servidor e quem manda; isto so evita ida inutil. */
const MIN_SENHA = 12;

export function PainelUsuarios({ idUsuarioAtual }: { idUsuarioAtual: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  // Carga dentro do efeito -- ver o comentario longo em `painel-contas.tsx`.
  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        // Os grupos alimentam o formulario; sem eles nao da para vincular.
        // Falha AQUI nao impede listar usuarios -- dai o catch separado: a tela
        // de usuarios continua util mesmo que a de grupos esteja indisponivel.
        const [lista, listaGrupos] = await Promise.all([
          ler<Usuario[]>("/api/admin/users"),
          ler<Grupo[]>("/api/admin/groups").catch(() => ({ dados: [] as Grupo[] })),
        ]);
        if (!vivo) return;
        setErro(null);
        setUsuarios(lista.dados);
        setGrupos(listaGrupos.dados.filter((g) => g.ativo));
      } catch (e) {
        if (!vivo) return;
        setErro(mensagemDoErro(e));
        setUsuarios([]);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [gatilho]);

  const substituir = (u: Usuario) =>
    setUsuarios((atual) => (atual ?? []).map((x) => (x.id === u.id ? u : x)));

  if (erro && !usuarios?.length) {
    return <ErroDoBloco mensagem={erro} aoTentarNovamente={recarregar} />;
  }
  if (usuarios === null) return <CarregandoLinhas linhas={4} />;

  return (
    <div className="space-y-5">
      <Card
        titulo="Usuários"
        descricao={`${usuarios.filter((u) => u.ativo).length} ativo(s) de ${usuarios.length}. Não existe cadastro público: todo acesso nasce aqui.`}
        acao={
          <Botao onClick={() => setCriando((v) => !v)} aria-expanded={criando}>
            {criando ? "Cancelar" : "Novo usuário"}
          </Botao>
        }
      >
        {criando ? (
          <FormularioNovoUsuario
            grupos={grupos}
            aoCriar={(u) => {
              setUsuarios((atual) => [u, ...(atual ?? [])]);
              setCriando(false);
            }}
          />
        ) : usuarios.length === 0 ? (
          <Vazio titulo="Nenhum usuário cadastrado" />
        ) : (
          <ul className="divide-y divide-veri-offwhite">
            {usuarios.map((u) => (
              <LinhaUsuario
                key={u.id}
                usuario={u}
                grupos={grupos}
                ehVoce={u.id === idUsuarioAtual}
                aoAtualizar={substituir}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LinhaUsuario({
  usuario,
  grupos,
  ehVoce,
  aoAtualizar,
}: {
  usuario: Usuario;
  grupos: Grupo[];
  ehVoce: boolean;
  aoAtualizar: (u: Usuario) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [papel, setPapel] = useState(usuario.papel);
  const [ativo, setAtivo] = useState(usuario.ativo);
  const [selecionados, setSelecionados] = useState<string[]>(
    usuario.grupos.map((g) => g.id),
  );

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const atualizado = await escrever<Usuario>(
        `/api/admin/users/${encodeURIComponent(usuario.id)}`,
        "PATCH",
        { papel, ativo, grupos: selecionados },
      );
      aoAtualizar(atualizado);
      setAberto(false);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-veri-verde-escuro">
            {usuario.nome ?? usuario.email}
            {ehVoce && <span className="ml-2 text-xs text-texto-suave">(você)</span>}
          </p>
          <p className="veri-numero text-xs text-texto-suave">{usuario.email}</p>
          <p className="mt-1 text-xs text-texto-suave">
            {usuario.papel}
            {" · "}
            {usuario.ativo ? "ativo" : "inativo"}
            {" · "}
            {usuario.grupos.length > 0
              ? usuario.grupos.map((g) => g.nome).join(", ")
              : "sem grupo"}
          </p>
        </div>

        <Botao tom="secundario" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          {aberto ? "Fechar" : "Editar"}
        </Botao>
      </div>

      {aberto && (
        <div className="mt-4 space-y-4 rounded-xl bg-veri-offwhite/40 p-4">
          {ehVoce && (
            <Aviso tom="atencao" titulo="Esta é a sua própria conta">
              <p>
                O portal recusa desativar ou rebaixar quem está usando a tela — e também
                o último administrador ativo. Sem essas duas travas, um clique deixaria o
                sistema sem nenhum administrador, e a volta só existiria por acesso
                direto ao banco.
              </p>
            </Aviso>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao
              rotulo="Perfil"
              value={papel}
              onChange={(e) => setPapel(e.target.value as "ADMIN" | "VIEWER")}
              ajuda="ADMIN tem todas as permissões, independentemente de grupo."
            >
              <option value="VIEWER">VIEWER</option>
              <option value="ADMIN">ADMIN</option>
            </Selecao>

            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-veri-verde-escuro">
                Situação
              </span>
              <Marcacao
                rotulo="Usuário ativo"
                descricao="Desativar encerra as sessões abertas imediatamente."
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-veri-verde-escuro">
              Grupos
            </legend>
            {grupos.length === 0 ? (
              <p className="text-xs text-texto-suave">
                Nenhum grupo ativo. Crie um em Configurações › Grupos.
              </p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {grupos.map((g) => (
                  <Marcacao
                    key={g.id}
                    rotulo={g.nome}
                    checked={selecionados.includes(g.id)}
                    onChange={(e) =>
                      setSelecionados((atual) =>
                        e.target.checked
                          ? [...atual, g.id]
                          : atual.filter((id) => id !== g.id),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </fieldset>

          {erro && <ErroDoBloco titulo="Não foi possível salvar" mensagem={erro} />}

          <Botao onClick={() => void salvar()} carregando={salvando}>
            Salvar
          </Botao>
        </div>
      )}
    </li>
  );
}

function FormularioNovoUsuario({
  grupos,
  aoCriar,
}: {
  grupos: Grupo[];
  aoCriar: (u: Usuario) => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [papel, setPapel] = useState<"ADMIN" | "VIEWER">("VIEWER");
  const [ativo, setAtivo] = useState(true);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const criado = await escrever<Usuario>("/api/admin/users", "POST", {
        nome,
        email,
        senhaInicial: senha,
        papel,
        ativo,
        grupos: selecionados,
      });
      aoCriar(criado);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          maxLength={160}
          autoComplete="off"
        />
        <Campo
          rotulo="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={320}
          autoComplete="off"
        />
        <Campo
          rotulo="Senha inicial"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          minLength={MIN_SENHA}
          // `new-password` e nao `off`: impede o navegador de oferecer a senha
          // de QUEM ESTA LOGADO num campo que cria a senha de outra pessoa.
          autoComplete="new-password"
          ajuda={`Ao menos ${MIN_SENHA} caracteres. Guardada com scrypt — nunca em texto puro, e nunca exibida depois. Combine a troca no primeiro acesso, em /conta.`}
        />
        <Selecao
          rotulo="Perfil"
          value={papel}
          onChange={(e) => setPapel(e.target.value as "ADMIN" | "VIEWER")}
          ajuda="ADMIN tem todas as permissões. VIEWER começa apenas com leitura."
        >
          <option value="VIEWER">VIEWER</option>
          <option value="ADMIN">ADMIN</option>
        </Selecao>
      </div>

      <Marcacao
        rotulo="Já ativo"
        descricao="Desmarque para criar o acesso sem liberar a entrada ainda."
        checked={ativo}
        onChange={(e) => setAtivo(e.target.checked)}
      />

      {grupos.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-veri-verde-escuro">
            Grupos
          </legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {grupos.map((g) => (
              <Marcacao
                key={g.id}
                rotulo={g.nome}
                checked={selecionados.includes(g.id)}
                onChange={(e) =>
                  setSelecionados((atual) =>
                    e.target.checked ? [...atual, g.id] : atual.filter((id) => id !== g.id),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      )}

      {erro && <ErroDoBloco titulo="Não foi possível criar o usuário" mensagem={erro} />}

      <Botao type="submit" carregando={salvando} rotuloCarregando="Criando…">
        Criar usuário
      </Botao>
    </form>
  );
}
