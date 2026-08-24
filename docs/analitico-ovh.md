# Analítico — Visão AWS e Visão OVH

`/dashboard/analitico` serve **duas visões** do mesmo tipo de pergunta ("quanto
custou, e em quê"), separadas por provedor. `?provider=ovh` mostra a OVH; qualquer
outro valor — inclusive nenhum — mostra a AWS.

---

## 1. A diferença entre as duas

Não é a mesma tela com um filtro a mais. **O grão do dado é diferente**, e isso
muda o que se pode perguntar.

| | AWS | OVH |
|---|---|---|
| Fonte | `aws_daily_costs`, `aws_monthly_costs` | `ovh_monthly_costs`, `ovh_invoice_*`, `ovh_projects` |
| Grão | **dia** de uso | **mês** de competência |
| Chega por | Data Export/CUR → S3 → Glue → Athena → ETL | API da OVH → collector |
| Credencial | IAM role da instância, sem segredo guardado | chave de API cifrada no banco |
| Período | dias (`30d`, `90d`…) | meses (`12m`…) |
| Recorte extra | conta, serviço, região | conta, projeto, **origem** |

Por isso o seletor **não carrega os filtros** de uma visão para a outra:
`?periodo=30d` não existe na OVH e `?periodo=12m` não existe na AWS. Repassar a
query string faria a tela de destino descartar o parâmetro em silêncio — com o
filtro antigo ainda visível na URL, dizendo uma coisa enquanto a tela mostra
outra.

**Uma conta nunca aparece na visão errada.** Não é uma regra aplicada consulta a
consulta: as tabelas são diferentes. A visão AWS não conhece `ovh_monthly_costs` e
a OVH não conhece `aws_daily_costs`.

---

## 2. As abas

A AWS tem duas; a OVH tem quatro. A assimetria é proposital — a OVH tem dois
recortes que não existem do outro lado.

| Aba | Visão | O que responde |
|---|---|---|
| Por serviço | AWS | lançamento a lançamento, por data de uso |
| Por custo mensal | AWS | histórico por conta, por período de cobrança |
| Por serviço/categoria | OVH | o que a OVH cobrou, por linha de serviço |
| **Por projeto** | OVH | custo atribuído a projeto do Public Cloud |
| **Por fatura** | OVH | documentos emitidos, com imposto e total |
| Por custo mensal | OVH | total por mês, conta e origem |

Forçar simetria — duas abas dos dois lados — obrigaria a esconder fatura dentro de
"custo mensal", onde ela não cabe: uma fatura tem número, data de emissão e
imposto, e nenhum dos três é um custo por mês.

`projetos` e `faturas` **forçam** `?provider=ovh`: não têm significado AWS, e
chegar lá com `provider=aws` mostraria o cabeçalho "Visão AWS" acima de uma tabela
OVH. O redirecionamento preserva os demais parâmetros — perder o período ao
normalizar a URL faria o usuário refazer o filtro sem entender por quê.

---

## 3. Origem: invoice, current, forecast

`ovh_monthly_costs.source` separa **três coisas que não se somam**:

| Origem | Significa |
|---|---|
| `invoice` | custo **realizado** — o que a OVH efetivamente faturou |
| `usage_current` | uso corrente do mês em andamento, ainda não faturado |
| `usage_forecast` | projeção da OVH para o fechamento do mês |

**Somar as três contaria o mesmo custo até três vezes.** O filtro aceita **uma** por
vez e não existe opção "todas as origens" — um total que some faturado com previsão
não significa nada, e pareceria maior.

O padrão é `invoice`: é o custo realizado. `usage_forecast` como padrão poria uma
projeção onde se espera um fato.

### Origem sem dado ≠ custo zero

Se a origem escolhida não tem linha no recorte, a tela diz **"sem dado"** e explica
qual das quatro situações é:

- integração não instalada (migração 005);
- banco sem nenhum custo OVH;
- a origem não tem linha em mês nenhum;
- a origem tem linha, mas não nesta janela.

Cada uma pede uma ação diferente do outro lado. Exibir `US$ 0,00` faria as quatro
parecerem a mesma coisa — e todas parecerem "a OVH não cobrou nada".

**Hoje, em produção, só `invoice` tem dado.** Ver a §6.

---

## 4. Por que a OVH é mensal e faturada

A API de faturamento da OVH entrega **fatura**, não uso diário. Não há endpoint
equivalente ao CUR da AWS que devolva consumo por dia e por recurso.

O que existe:

- `/me/bill` — cabeçalho: número, data, total, imposto;
- `/me/bill/{id}/details` — as linhas daquela fatura;
- `/cloud/project/{id}/usage/current` e `/forecast` — uso do Public Cloud, **só
  para projetos do Public Cloud**.

Servidor dedicado, licença e domínio — o grosso do custo desta conta — só aparecem
por fatura. Daí o grão mensal, e daí `usage_current`/`usage_forecast` serem vazios
para uma conta sem projeto Public Cloud ativo.

### "Status" de fatura não existe

O requisito original pedia `status` na aba de faturas. **A API da OVH não expõe
situação de pagamento** — não há campo pago/em aberto em `/me/bill`. A coluna mostra
a **categoria** (`autorenew`, `purchase-servers`, `purchase-web`), que diz por que a
fatura foi emitida, não se foi quitada.

Rotular isso de "status" faria alguém concluir que a fatura está paga.

Situação de pagamento existe no portal, em **Faturamento**, mas é por conta e
preenchida à mão — não vem da OVH.

---

## 5. Exportação

Dois caminhos separados, e a separação é **estrutural**:

| | Rota | Arquivo |
|---|---|---|
| AWS | `/api/export/csv`, `/api/export/xlsx` | `veri-finops-aws-<de>_<ate>.csv` |
| AWS (histórico) | `/api/analytic/cost-history/export/*` | `veri-finops-aws-historico-…` |
| OVH | `/api/export/ovh/csv`, `/api/export/ovh/xlsx` | `veri-finops-ovh-<de>_<ate>.csv` |

O export AWS **não consegue** incluir OVH porque não conhece a tabela, e vice-versa.
Não é uma regra a lembrar; é o que os módulos leem. Há teste que guarda isso.

**O `aws` no nome do arquivo é novo.** Antes era `veri-finops-<de>_<ate>.csv`. Dois
arquivos da mesma janela — um de cada provedor — ficariam indistinguíveis na pasta
de downloads, e somá-los numa planilha é um erro fácil de cometer e difícil de
perceber. Automação que dependa do nome antigo precisa ser ajustada.

O export OVH **não é transmitido em fluxo**, ao contrário do AWS. `aws_daily_costs`
tem milhões de linhas; `ovh_monthly_costs` é agregada por mês — 512 no banco inteiro
hoje. Montar em memória é mais simples e igualmente seguro nessa ordem de grandeza;
`LIMITE_LINHAS` (50 000) recusa explicitamente em vez de truncar em silêncio se um
dia deixar de ser.

`raw_json` **não sai** em nenhum export. Em `ovh_invoice_headers` ele inclui
`password` — a senha do PDF da fatura na OVH.

Exportar exige `analytic:export`, não apenas `analytic:view`: ver na tela e levar o
dado embora são permissões diferentes.

---

## 6. Limites atuais

1. **`usage_current` e `usage_forecast` estão vazios em produção.** A conta
   `ovh-main-ca` tem um projeto Public Cloud no plano *discovery*, e a API responde
   `no usages found` para os dois endpoints. As opções aparecem no filtro marcadas
   como sem dado. Não é defeito da tela.
2. **A aba "Por projeto" está vazia pelo mesmo motivo.**
   `ovh_monthly_costs.project_service_name` é `NULL` em todas as 512 linhas: o custo
   desta conta é servidor dedicado e licença, que não pertencem a projeto.
3. **`category` é `NULL` em todas as linhas de custo.** A OVH não a preenche para
   esses produtos. A coluna mostra travessão — repetir o serviço ali inventaria uma
   categoria que não existe.
4. **O seletor de conta só aparece com duas ou mais contas OVH.** Há uma em
   produção; um dropdown de um item sugere uma escolha que não existe. Ele surge
   sozinho quando a segunda for cadastrada.
5. **Sem paginação na interface OVH.** As consultas têm teto (60 faturas, por
   exemplo) e o volume atual está muito abaixo. A paginação server-side existe na
   query de faturas (`limite`/`deslocamento`) mas ainda não é exposta na tela.
6. **Moedas não são somadas.** `ovh_monthly_costs.currency` é por linha; o servidor
   escolhe a de maior volume e informa qual. Converter exigiria uma taxa EUR/USD que
   o portal não tem — a cotação que ele consulta é USD/BRL.
