"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { CabecalhoContas } from "@/components/admin/contas/cabecalho-contas";
import { CartaoConta, type Conta } from "@/components/admin/contas/cartao-conta";
import { ComoFunciona } from "@/components/admin/contas/como-funciona";
import { ModalAdicionarAws } from "@/components/admin/contas/modal-adicionar-aws";
import { ModalAdicionarOvh } from "@/components/admin/contas/modal-adicionar-ovh";
import { ResumoContas } from "@/components/admin/contas/resumo-contas";
import { Aviso } from "@/components/ui/aviso";
import { Botao } from "@/components/ui/botao";
import { CarregandoLinhas, ErroDoBloco, Vazio } from "@/components/ui/estado";
import { ler, mensagemDoErro } from "@/lib/admin/cliente";
import {
  lerProvider,
  resumoContas,
  textoListaVazia,
  type Provider,
} from "@/lib/admin/contas-provider";

/**
 * Contas Cloud — segmentada por provedor.
 *
 * ---------------------------------------------------------------------------
 * O QUE MUDOU, E POR QUE
 *
 * Havia UMA lista com AWS e OVH juntas. Ela funcionava e era ilegível: metade
 * dos cartões trazia bloco de credencial e metade não, sem que a diferença
 * aparecesse em lugar nenhum, e não havia caminho para adicionar conta. Quem
 * procurava onde colar a chave da AWS concluía que faltava um campo — quando a
 * resposta é que ele não existe.
 *
 * Agora são duas visões, escolhidas pela URL, com listas, ações e textos
 * próprios. O provedor sai de `?provider=`, como no painel executivo e no
 * Analítico, e pelo mesmo motivo: a visão fica no endereço, então ela sobrevive
 * a recarregar, a voltar e a mandar o link para alguém.
 *
 * ---------------------------------------------------------------------------
 * A LISTA É FILTRADA NO SERVIDOR
 *
 * `?provider=` vai junto na requisição. Filtrar só aqui mandaria a lista OVH
 * inteira — com a situação de cada credencial — para quem abriu a visão AWS, e a
 * separação seria cosmética: o dado do outro provedor estaria no payload,
 * visível em qualquer aba de rede.
 *
 * Os totais dos cartões vêm da meta, calculados sobre TODAS as contas: trocar de
 * visão não pode zerar o cartão do outro provedor.
 */

type MetaContas = {
  podeVerCredenciais?: boolean;
  ultimaSincronizacaoOvh?: string | null;
  contasAws?: number;
  contasOvh?: number;
  coletasComFalha?: number | null;
  filaDisponivel?: boolean;
  contasComCustoSemCadastro?: string[];
};

export function PainelContas() {
  const provider: Provider = lerProvider(useSearchParams());

  const [contas, setContas] = useState<Conta[] | null>(null);
  const [meta, setMeta] = useState<MetaContas>({});
  const [erro, setErro] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);

  const [gatilho, setGatilho] = useState(0);
  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  /**
   * Carga dentro do próprio efeito, como em `use-analitico.ts`.
   *
   * A função assíncrona é definida AQUI e não extraída para um `useCallback`:
   * chamar de fora uma função que faz setState conta como setState síncrono no
   * corpo do efeito, o que provoca render em cascata. Recarregar é um contador.
   *
   * `vivo` descarta a resposta de um efeito já desmontado — sem isso, sair da
   * tela durante a carga tentaria atualizar componente que não existe mais.
   *
   * `provider` está nas dependências: trocar de visão refaz a busca com o filtro
   * novo, em vez de reaproveitar a lista do outro provedor.
   */
  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const { dados, meta: recebido } = await ler<Conta[], MetaContas>(
          `/api/admin/accounts?provider=${provider}`,
        );
        if (!vivo) return;
        setErro(null);
        setContas(dados);
        setMeta(recebido ?? {});
      } catch (e) {
        if (!vivo) return;
        setErro(mensagemDoErro(e));
        setContas([]);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [gatilho, provider]);

  /** Troca a conta no lugar, sem recarregar a lista inteira. */
  const substituir = (atualizada: Conta) =>
    setContas((atual) =>
      (atual ?? []).map((c) => (c.accountId === atualizada.accountId ? atualizada : c)),
    );

  const resumo = resumoContas(
    // Os totais vêm da meta; a lista local está filtrada e serviria apenas ao
    // provedor visível. Este arranjo alimenta `resumoContas` com o que ela sabe
    // contar e deixa os totais globais chegarem prontos.
    contas ?? [],
    {
      podeVerCredenciais: meta.podeVerCredenciais ?? false,
      coletasComFalha: meta.coletasComFalha ?? null,
    },
  );
  const resumoGlobal = {
    ...resumo,
    contasAws: meta.contasAws ?? resumo.contasAws,
    contasOvh: meta.contasOvh ?? resumo.contasOvh,
  };

  const vazio = textoListaVazia(provider);
  const semCadastro = meta.contasComCustoSemCadastro ?? [];

  return (
    <div className="space-y-6">
      <CabecalhoContas provider={provider} />

      <ResumoContas resumo={resumoGlobal} />

      <ComoFunciona />

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="veri-display text-xl text-veri-verde-escuro">
              {provider === "ovh" ? "Contas OVH" : "Contas AWS"}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-texto-suave">
              {provider === "ovh"
                ? "Contas OVH são cadastradas no portal com credenciais API criptografadas e podem disparar coleta manual."
                : "Contas AWS são descobertas pelo pipeline a partir do CUR/Data Export — o cadastro final ainda é um passo manual."}
            </p>
          </div>

          <Botao onClick={() => setAdicionando(true)}>
            {provider === "ovh" ? "Adicionar conta OVH" : "Adicionar conta AWS"}
          </Botao>
        </div>

        {/* A lacuna real do pipeline, exposta só quando existe. Ver
            `contasComCustoSemCadastro` em queries/admin/contas.ts. */}
        {provider === "aws" && semCadastro.length > 0 && (
          <Aviso
            tom="atencao"
            titulo={`${semCadastro.length} conta(s) com custo importado, mas fora do cadastro`}
          >
            <p>
              <span className="veri-numero">{semCadastro.join(", ")}</span> tem custo em{" "}
              <span className="veri-numero">aws_daily_costs</span> e não está em{" "}
              <span className="veri-numero">cloud_accounts</span>. O custo entra nos
              totais, mas a conta não aparece nesta lista nem nos filtros — e ninguém
              consegue dar alias a ela.
            </p>
            <p>
              O ETL não cadastra contas; o <span className="veri-numero">INSERT</span> é o
              passo 8 do procedimento em <strong>Adicionar conta AWS</strong>.
            </p>
          </Aviso>
        )}

        {erro && !contas?.length ? (
          <ErroDoBloco mensagem={erro} aoTentarNovamente={recarregar} />
        ) : contas === null ? (
          <CarregandoLinhas linhas={3} />
        ) : contas.length === 0 ? (
          <Vazio titulo={vazio.titulo}>{vazio.detalhe}</Vazio>
        ) : (
          <div className="space-y-4">
            {contas.map((conta) => (
              <CartaoConta
                key={conta.accountId}
                conta={conta}
                provider={provider}
                podeVerCredenciais={meta.podeVerCredenciais ?? false}
                ultimaSincronizacao={meta.ultimaSincronizacaoOvh ?? null}
                aoAtualizar={substituir}
              />
            ))}
          </div>
        )}
      </section>

      {provider === "aws" ? (
        <ModalAdicionarAws aberto={adicionando} aoFechar={() => setAdicionando(false)} />
      ) : (
        <ModalAdicionarOvh
          aberto={adicionando}
          aoFechar={() => setAdicionando(false)}
          aoCriar={recarregar}
        />
      )}
    </div>
  );
}
