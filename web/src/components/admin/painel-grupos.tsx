"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Botao } from "@/components/ui/botao";
import { Campo, Marcacao } from "@/components/ui/campo";
import { Card } from "@/components/ui/card";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { escrever, ler, mensagemDoErro } from "@/lib/admin/cliente";

export type Grupo = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  membros: number;
  permissoes: string[];
  criadoEm: string;
};

export type ItemPermissao = {
  chave: string;
  area: string;
  titulo: string;
  descricao: string;
  piso: boolean;
};

/**
 * Painel de grupos, em dois modos.
 *
 * `modo="grupos"`   cadastro: criar, renomear, ativar/desativar.
 * `modo="permissoes"` matriz: o que cada grupo pode fazer.
 *
 * Um componente e nao dois porque as duas telas leem exatamente a mesma lista e
 * escrevem no mesmo recurso. Separar duplicaria carregamento, estado e
 * reconciliacao para mudar apenas quais controles aparecem.
 */
export function PainelGrupos({ modo }: { modo: "grupos" | "permissoes" }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [catalogo, setCatalogo] = useState<ItemPermissao[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  // Carga dentro do efeito -- ver o comentario longo em `painel-contas.tsx`.
  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const [lista, permissoes] = await Promise.all([
          ler<Grupo[]>("/api/admin/groups"),
          ler<ItemPermissao[], { areas: string[] }>("/api/admin/permissions"),
        ]);
        if (!vivo) return;
        setErro(null);
        setGrupos(lista.dados);
        setCatalogo(permissoes.dados);
        setAreas(permissoes.meta.areas);
      } catch (e) {
        if (!vivo) return;
        setErro(mensagemDoErro(e));
        setGrupos([]);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [gatilho]);

  const substituir = (g: Grupo) =>
    setGrupos((atual) => (atual ?? []).map((x) => (x.id === g.id ? g : x)));

  if (erro && !grupos?.length) {
    return <ErroDoBloco mensagem={erro} aoTentarNovamente={recarregar} />;
  }
  if (grupos === null) return <CarregandoLinhas linhas={4} />;

  return (
    <div className="space-y-5">
      {modo === "grupos" && (
        <Card
          titulo="Grupos"
          descricao={`${grupos.filter((g) => g.ativo).length} ativo(s) de ${grupos.length}. O grupo carrega as permissões; o usuário herda delas.`}
          acao={
            <Botao onClick={() => setCriando((v) => !v)} aria-expanded={criando}>
              {criando ? "Cancelar" : "Novo grupo"}
            </Botao>
          }
        >
          {criando ? (
            <FormularioNovoGrupo
              aoCriar={(g) => {
                setGrupos((atual) => [...(atual ?? []), g]);
                setCriando(false);
              }}
            />
          ) : grupos.length === 0 ? (
            <Vazio titulo="Nenhum grupo" />
          ) : (
            <ul className="divide-y divide-veri-offwhite">
              {grupos.map((g) => (
                <LinhaGrupo key={g.id} grupo={g} aoAtualizar={substituir} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {modo === "permissoes" &&
        (grupos.length === 0 ? (
          <Vazio titulo="Nenhum grupo para configurar">
            Crie um grupo em Configurações › Grupos antes de distribuir permissões.
          </Vazio>
        ) : (
          grupos.map((g) => (
            <MatrizDoGrupo
              key={g.id}
              grupo={g}
              catalogo={catalogo}
              areas={areas}
              aoAtualizar={substituir}
            />
          ))
        ))}
    </div>
  );
}

function LinhaGrupo({
  grupo,
  aoAtualizar,
}: {
  grupo: Grupo;
  aoAtualizar: (g: Grupo) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(grupo.nome);
  const [descricao, setDescricao] = useState(grupo.descricao ?? "");
  const [ativo, setAtivo] = useState(grupo.ativo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      aoAtualizar(
        await escrever<Grupo>(`/api/admin/groups/${encodeURIComponent(grupo.id)}`, "PATCH", {
          nome,
          descricao: descricao.trim() || null,
          ativo,
        }),
      );
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
          <p className="text-sm font-medium text-veri-verde-escuro">{grupo.nome}</p>
          {grupo.descricao && (
            <p className="text-xs leading-relaxed text-texto-suave">{grupo.descricao}</p>
          )}
          <p className="mt-1 text-xs text-texto-suave">
            {grupo.ativo ? "ativo" : "inativo"} · {grupo.membros} membro(s) ·{" "}
            {grupo.permissoes.length} permissão(ões)
          </p>
        </div>
        <Botao tom="secundario" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          {aberto ? "Fechar" : "Editar"}
        </Botao>
      </div>

      {aberto && (
        <div className="mt-4 space-y-4 rounded-xl bg-veri-offwhite/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo="Nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={80}
            />
            <Campo
              rotulo="Descrição"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={280}
            />
          </div>
          <Marcacao
            rotulo="Grupo ativo"
            descricao="Grupo inativo deixa de conceder as próprias permissões, sem perder os membros."
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
          />
          {erro && <ErroDoBloco titulo="Não foi possível salvar" mensagem={erro} />}
          <Botao onClick={() => void salvar()} carregando={salvando}>
            Salvar
          </Botao>
        </div>
      )}
    </li>
  );
}

function MatrizDoGrupo({
  grupo,
  catalogo,
  areas,
  aoAtualizar,
}: {
  grupo: Grupo;
  catalogo: ItemPermissao[];
  areas: string[];
  aoAtualizar: (g: Grupo) => void;
}) {
  const [marcadas, setMarcadas] = useState<string[]>(grupo.permissoes);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const porArea = useMemo(
    () => areas.map((area) => ({ area, itens: catalogo.filter((c) => c.area === area) })),
    [areas, catalogo],
  );

  // Comparacao por conjunto: marcar e desmarcar a mesma caixa nao deve deixar o
  // botao habilitado sugerindo que ha algo a salvar.
  const alterado =
    marcadas.length !== grupo.permissoes.length ||
    marcadas.some((p) => !grupo.permissoes.includes(p));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setSucesso(false);
    try {
      aoAtualizar(
        await escrever<Grupo>(
          `/api/admin/groups/${encodeURIComponent(grupo.id)}/permissions`,
          "PATCH",
          { permissoes: marcadas },
        ),
      );
      setSucesso(true);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card
      titulo={grupo.nome}
      descricao={`${grupo.membros} membro(s)${grupo.ativo ? "" : " · grupo inativo, não concede nada no momento"}`}
    >
      <div className="space-y-5">
        {porArea.map(({ area, itens }) => (
          <fieldset key={area}>
            <legend className="mb-1 text-xs uppercase tracking-wide text-texto-suave">
              {area}
            </legend>
            <div className="grid gap-0.5 lg:grid-cols-2">
              {itens.map((item) => (
                <Marcacao
                  key={item.chave}
                  rotulo={
                    <>
                      {item.titulo}
                      {item.piso && (
                        <span className="ml-2 text-xs text-texto-suave">
                          (todo usuário já tem)
                        </span>
                      )}
                    </>
                  }
                  descricao={item.descricao}
                  checked={marcadas.includes(item.chave)}
                  onChange={(e) =>
                    setMarcadas((atual) =>
                      e.target.checked
                        ? [...atual, item.chave]
                        : atual.filter((p) => p !== item.chave),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        ))}

        {erro && <ErroDoBloco titulo="Não foi possível salvar" mensagem={erro} />}
        {sucesso && !erro && !alterado && (
          <p role="status" className="text-sm font-medium text-veri-verde-escuro">
            Permissões salvas. Valem no próximo carregamento de página de cada membro.
          </p>
        )}

        <Botao onClick={() => void salvar()} carregando={salvando} disabled={!alterado}>
          {alterado ? "Salvar permissões" : "Sem alterações"}
        </Botao>
      </div>
    </Card>
  );
}

function FormularioNovoGrupo({ aoCriar }: { aoCriar: (g: Grupo) => void }) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      aoCriar(
        await escrever<Grupo>("/api/admin/groups", "POST", {
          nome,
          descricao: descricao.trim() || null,
          ativo: true,
        }),
      );
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          maxLength={80}
          placeholder="Financeiro"
        />
        <Campo
          rotulo="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={280}
          ajuda="Opcional. Ajuda quem for conceder permissões depois."
        />
      </div>
      {erro && <ErroDoBloco titulo="Não foi possível criar o grupo" mensagem={erro} />}
      <Botao type="submit" carregando={salvando} rotuloCarregando="Criando…">
        Criar grupo
      </Botao>
    </form>
  );
}
