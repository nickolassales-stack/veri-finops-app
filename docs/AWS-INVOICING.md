# Situação de pagamento pela AWS — investigação técnica

> **Conclusão, antes de tudo:** nenhuma API da AWS responde, de forma confiável e
> programática, se uma fatura **foi paga**. Elas respondem quanto foi cobrado e
> quando a fatura foi emitida. A quitação acontece no meio de pagamento — banco,
> cartão, reseller —, fora do alcance de qualquer chamada listada aqui.
>
> Por isso o status de pagamento do Portal FinOps é **manual**, e a tela mostra
> sempre a **fonte** ao lado do status. `AWS_INVOICING_ENABLED=false` é o valor
> correto hoje, e ligá-lo sozinho não ativa integração nenhuma.

Este documento existe para que a próxima pessoa que perguntar *"não dá para a AWS
nos dizer isso?"* tenha a resposta pesquisada, e não precise refazer o caminho.

---

## 1. O que cada fonte responde de verdade

| Fonte | Responde | **Não** responde |
|---|---|---|
| **CUR / Data Export** (o que já usamos) | consumo e custo por linha, por dia, por serviço | se a fatura foi emitida, se foi paga |
| **Cost Explorer API** (`ce:GetCostAndUsage`) | custo agregado, previsão | qualquer coisa sobre pagamento |
| **Invoicing API** (`invoicing:ListInvoiceSummaries`, `GetInvoiceSummary`) | faturas **emitidas**: número, data, valor, moeda, conta pagadora | **quitação** |
| **Billing Conductor** | rateio e faturamento customizado para revenda | quitação real |
| **AWS Billing Console** (tela) | mostra "Payment status" ao humano logado | não tem API pública equivalente e estável para esse campo |
| **`billingconductor` / `payments` no SDK** | — | não há API pública de status de pagamento por fatura |

**O ponto que costuma ser confundido:** a Invoicing API tem um campo de *status
da fatura* (emitida, corrigida). Isso **não** é status de pagamento. Uma fatura
emitida há 40 dias e nunca paga continua "issued".

---

## 2. Se ainda assim quisermos integrar

O melhor que a integração conseguiria entregar é: **"a AWS emitiu a fatura X, no
valor Y, com vencimento Z"**. Isso é útil — elimina digitação e confere o valor
—, mas não substitui a confirmação de pagamento.

### 2.1 APIs que seriam usadas

```
invoicing:ListInvoiceSummaries   lista as faturas de um período
invoicing:GetInvoiceSummary      detalhe de uma fatura (valor, moeda, datas)
ce:GetCostAndUsage               conferência do valor contra o que já temos
organizations:DescribeOrganization  descobrir a conta PAGADORA
organizations:ListAccounts       mapear conta filha → conta pagadora
```

### 2.2 Permissões IAM necessárias

Política mínima, **somente leitura**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LeituraDeFaturas",
      "Effect": "Allow",
      "Action": [
        "invoicing:ListInvoiceSummaries",
        "invoicing:GetInvoiceSummary"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ConferenciaDeValor",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage"],
      "Resource": "*"
    },
    {
      "Sid": "MapeamentoDeContas",
      "Effect": "Allow",
      "Action": [
        "organizations:DescribeOrganization",
        "organizations:ListAccounts"
      ],
      "Resource": "*"
    }
  ]
}
```

Observações que mudam o desenho:

- **As chamadas precisam sair da conta pagadora** (ou de um papel assumido nela).
  Rodar na conta filha não enxerga a fatura.
- `Resource: "*"` não é preguiça: essas ações não suportam restrição por recurso.
  O controle possível é *qual identidade* recebe a política.
- Faturamento costuma ser um endpoint global (`us-east-1`), mesmo com o resto do
  pipeline em `us-east-2`.

### 2.3 O que muda na arquitetura do portal

Hoje o portal **não tem credencial AWS**, e isso está registrado como decisão no
RUNBOOK: ele consome o PostgreSQL e mais nada. A integração exigiria:

1. papel IAM e credencial disponíveis para o container (perfil da instância ou
   role assumido);
2. saída de rede para os endpoints da AWS — hoje o único egress é HTTPS para o
   Banco Central;
3. `@aws-sdk/client-invoicing` nas dependências (não instalado de propósito);
4. **revalidação do isolamento**: o portal deixaria de ser um serviço que só lê
   banco e passaria a ter credencial de nuvem. Isso muda o raio de impacto de um
   comprometimento e precisa de decisão consciente, não de um `npm install`.

---

## 3. Limitações que sobrevivem à integração

1. **Quitação continua fora.** Mesmo integrado, "pago" continua vindo do
   financeiro. Nenhuma das APIs acima sabe se o boleto foi liquidado.
2. **Conta filha não tem fatura.** Numa organização, a fatura é da conta
   pagadora. Status por conta filha é rateio — legítimo para gestão, inútil como
   prova de pagamento.
3. **Reseller/parceiro rompe a cadeia.** Se a AWS é contratada por um parceiro, a
   fatura que importa é a do parceiro, e a AWS não a conhece.
4. **Câmbio.** A fatura pode ser emitida em USD e paga em BRL, com taxa e data
   próprias. O valor pago não bate com o valor da API — a conversão do portal já
   é declaradamente estimativa, e aqui isso viraria divergência contábil.
5. **Defasagem.** A fatura só existe depois do fechamento do ciclo; nos primeiros
   dias do mês não há o que consultar.

---

## 4. O que validar em ambiente real, antes de considerar oficial

Nenhum status vindo da AWS deve ser tratado como oficial antes destes cinco
passos, **nesta ordem**:

1. **Uma fatura conhecida.** Pegue uma fatura já paga, com número e valor
   conferidos por quem pagou. É o gabarito.
2. **Chamada crua, fora do portal.** `aws invoicing list-invoice-summaries` a
   partir da conta pagadora. Confirme que o número e o valor batem com o gabarito.
3. **Confira o vocabulário.** Veja com os próprios olhos o que o campo de status
   traz para uma fatura **paga** e para uma **não paga**. Se os dois trouxerem o
   mesmo valor, está confirmado que a API não responde a pergunta — e a
   investigação termina aqui.
4. **Conta filha.** Repita numa conta membro da organização e confirme o que
   acontece (esperado: nenhuma fatura própria).
5. **Só então** implemente, mantendo `AWS_INVOICING_ENABLED=false` em produção e
   ligando primeiro em ambiente de teste — e mesmo assim como **sugestão**, com a
   gravação continuando a ser ato de uma pessoa
   (`podeGravarAutomaticamente()` devolve `false` por escrito).

---

## 5. Onde isso vive no código

| Arquivo | Papel |
|---|---|
| [`web/src/lib/billing/aws-invoicing.ts`](../web/src/lib/billing/aws-invoicing.ts) | Módulo isolado. Assinatura final, sempre respondendo indisponível. Não lança exceção — a tela de faturamento não pode cair por causa da AWS |
| `AWS_INVOICING_ENABLED` | Flag em `web/src/lib/env.ts`, padrão `false` |
| `LIMITACOES` | A lista da seção 3, exportada para a tela exibir |
| `podeGravarAutomaticamente()` | Devolve `false`. Um lugar único e testável para essa decisão, em vez de um `if` esquecido numa rota |

Se a investigação da seção 4 for feita e mudar alguma conclusão daqui,
**atualize este arquivo junto com o código** — a razão de ele existir é não
refazer a pesquisa.
