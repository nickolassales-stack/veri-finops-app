"use client";

import { Aviso } from "@/components/ui/aviso";
import { Modal } from "@/components/ui/modal";

/**
 * "Adicionar conta AWS" — um PROCEDIMENTO, não um formulário.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NÃO HÁ CAMPOS AQUI
 *
 * Uma conta AWS não é criada no portal. Ela passa a existir porque entregou
 * custo no Data Export/CUR 2.0, e o identificador dela é o número de 12 dígitos
 * que a própria AWS emitiu. Um formulário nesta tela criaria uma linha em
 * `cloud_accounts` que nunca casaria com dado nenhum — uma conta fantasma no
 * filtro do painel, somando zero para sempre, que alguém teria de descobrir e
 * apagar mais tarde.
 *
 * O trabalho de verdade é no console da AWS e depois na EC2. O que o portal pode
 * fazer de útil é dizer exatamente qual é esse trabalho, na ordem, com os nomes
 * que aparecem na tela da AWS — em vez de mandar procurar um runbook.
 *
 * Os passos vieram de `scripts/onboard-cur-account.sh`, que é quem de fato
 * executa a parte automatizável.
 */

const PASSOS: { titulo: string; detalhe: React.ReactNode }[] = [
  {
    titulo: "Criar o Data Export (CUR 2.0) na conta nova",
    detalhe: (
      <>
        No console de <strong>Billing and Cost Management</strong> da conta, em{" "}
        <strong>Data Exports</strong>, crie um export do tipo{" "}
        <span className="veri-numero">Standard data export</span> com a tabela{" "}
        <span className="veri-numero">CUR 2.0</span>.
      </>
    ),
  },
  {
    titulo: "Formato Parquet",
    detalhe: (
      <>
        Compressão <span className="veri-numero">Parquet / GZIP</span>. CSV também é
        aceito pela AWS, mas o Athena lê Parquet muito mais barato — e o DDL que o
        pipeline usa assume esse formato.
      </>
    ),
  },
  {
    titulo: "Frequência diária",
    detalhe: (
      <>
        <span className="veri-numero">Daily</span>, com{" "}
        <strong>Overwrite existing data export file</strong>. A entrega mensal atrasaria
        o dashboard em até 30 dias.
      </>
    ),
  },
  {
    titulo: "Integração com Athena habilitada",
    detalhe: (
      <>
        Marque <strong>Enable resource IDs</strong> e a integração de consulta com{" "}
        <span className="veri-numero">Athena</span>. Sem ela não há{" "}
        <span className="veri-numero">metadata/</span> no bucket, e sem metadata não
        existe DDL para criar a tabela.
      </>
    ),
  },
  {
    titulo: "Apontar para o bucket central, no prefixo esperado",
    detalhe: (
      <>
        Destino:{" "}
        <span className="veri-numero break-all">
          s3://finops-aws-cost-datalake-800168045394/raw/aws/cur/account_id=&lt;ID&gt;/finops_cur2_&lt;ID&gt;
        </span>
        . O prefixo com <span className="veri-numero">account_id=</span> é o que permite
        particionar por conta — fora dele, o script de onboarding não encontra a entrega.
      </>
    ),
  },
  {
    titulo: "Aguardar a primeira entrega",
    detalhe: (
      <>
        Leva <strong>até 24 horas</strong>. Enquanto não houver{" "}
        <span className="veri-numero">data/</span> e{" "}
        <span className="veri-numero">metadata/</span> no bucket, não há o que registrar
        no Glue — este passo não tem como ser apressado.
      </>
    ),
  },
  {
    titulo: "Rodar o onboarding na EC2 e aplicar a view",
    detalhe: (
      <>
        <span className="veri-numero break-all">
          ./scripts/onboard-cur-account.sh &lt;ID&gt;
        </span>{" "}
        cria database, tabela e partições no Athena. Ao final ele{" "}
        <strong>imprime</strong> o SQL da view <span className="veri-numero">cur_raw</span>{" "}
        para um humano ler e executar — a view é o único ponto que afeta todas as contas
        de uma vez, e por isso ele não a aplica sozinho.
      </>
    ),
  },
  {
    titulo: "Cadastrar a conta e rodar o ETL",
    detalhe: (
      <>
        O próprio script imprime o <span className="veri-numero">INSERT</span> em{" "}
        <span className="veri-numero">cloud_accounts</span>. Depois:{" "}
        <span className="veri-numero">/opt/finops/run-etl-with-status.sh manual</span>.
        Feito isso a conta aparece nesta lista, e você edita alias e metadados aqui.
      </>
    ),
  },
];

export function ModalAdicionarAws({
  aberto,
  aoFechar,
}: {
  aberto: boolean;
  aoFechar: () => void;
}) {
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="larga"
      titulo="Adicionar conta AWS"
      descricao="A conta não é criada aqui — ela aparece sozinha depois que o custo chega. Estes são os passos que fazem isso acontecer."
    >
      <div className="space-y-5">
        <Aviso tom="atencao" titulo="O cadastro no portal ainda é manual">
          <p>
            Hoje o ETL <strong>não</strong> insere a conta em{" "}
            <span className="veri-numero">cloud_accounts</span>: ele carrega o custo, e o
            cadastro é um <span className="veri-numero">INSERT</span> executado por uma
            pessoa (passo 8). Enquanto ele não for feito, o custo entra nos totais mas a
            conta não aparece nesta tela nem nos filtros.
          </p>
          <p>
            Esta tela detecta essa divergência e avisa na visão AWS quando ela acontece.
          </p>
        </Aviso>

        <ol className="space-y-4">
          {PASSOS.map((p, i) => (
            <li key={p.titulo} className="flex gap-3">
              <span className="veri-numero mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-veri-verde-escuro text-xs font-semibold text-veri-branco">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-veri-verde-escuro">{p.titulo}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-texto-suave">
                  {p.detalhe}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="border-t border-veri-offwhite pt-4 text-xs text-texto-suave">
          Procedimento completo em <span className="veri-numero">docs/onboard-nova-conta.md</span>.
        </p>
      </div>
    </Modal>
  );
}
