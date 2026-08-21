# Visão OVH no dashboard executivo

`/dashboard?provider=ovh` · implementada em 20/08/2026 na branch
`feat/dashboard-ovh-view`

---

## 1. Duas visões, uma rota

O seletor no topo de `/dashboard` troca entre **Visão AWS** e **Visão OVH**.
`/dashboard` sem parâmetro, ou com qualquer `provider` desconhecido, é a AWS —
ela é o padrão histórico da rota e o que um link antigo espera encontrar.

Uma rota `/dashboard/ovh` separada foi descartada: o provedor é um **recorte** da
mesma pergunta ("quanto custou"), como período e conta são, e não uma tela
diferente.

### Por que os filtros não atravessam a troca

Os dois vocabulários são incompatíveis, e não por descuido:

| | AWS | OVH |
|---|---|---|
| Fonte | `aws_daily_costs` | `ovh_monthly_costs` |
| Granularidade mínima | **dia** (`usage_date`) | **mês** (`billing_month`) |
| Presets de período | `7d`, `30d`, `mes-atual`, `mes-anterior` | `6m`, `12m`, `24m`, `ano-atual` |
| Recorte por entidade | conta AWS (`contas=`) | projeto OVH (`projeto=`) |
| Origem do valor | uma só (o CUR) | **três** (`source=`) |
| Moeda | fixa em USD pelo CUR | por linha, em `currency` |
| Padrão | mês atual, todas as contas | 12 meses, `invoice` |

`?periodo=30d` não existe na OVH — a tabela não tem granularidade de dia para
responder. `?periodo=12m` não existe na AWS. Repassar a query string na troca
faria a tela de destino descartar o parâmetro **em silêncio** e mostrar o padrão,
com o filtro antigo ainda visível na URL dizendo outra coisa.

Os testes em [`filtros-ovh.test.ts`](../web/src/lib/dashboard/filtros-ovh.test.ts)
travam essa fronteira nos dois sentidos: cada lado ignora o vocabulário do outro
e cai no próprio padrão.

---

## 2. `invoice` é o custo realizado

`ovh_monthly_costs.source` tem três valores, e **eles não se somam**:

| `source` | O que é | Papel na tela |
|---|---|---|
| `invoice` | O que a OVH **efetivamente faturou** | **Custo realizado.** Padrão da tela |
| `usage_current` | Consumo do mês em andamento, ainda não faturado | Auxiliar |
| `usage_forecast` | Projeção da OVH para o fechamento | Auxiliar. **Nunca** custo realizado |

O mesmo projeto no mesmo mês tem legitimamente linha nas três — é para isso que
`source` participa da chave `UNIQUE` do upsert. Um `sum(amount)` sem filtro de
origem **triplica o custo**.

Por isso a origem é obrigatória em toda consulta:

- `FiltroOvh.source` é um campo **não-opcional** em
  [`queries/dashboard-ovh.ts`](../web/src/lib/queries/dashboard-ovh.ts) — não há
  assinatura possível que permita esquecê-lo.
- No Zod, `camposFonteOvhComPadrao` tem `.default("invoice")` e **não**
  `.optional()`. Se fosse opcional, ausente teria de significar uma de duas
  coisas: somar as três (errado) ou escolher uma escondido do usuário. O padrão
  explícito é a terceira opção — o custo realizado, dito na tela e visível na URL.

> Note que `camposFonteOvh` (em `esquemas.ts`, usado por Faturamento) **continua**
> `.optional()`, e isso é correto: lá a tela exibe as três agrupadas *por* origem,
> então ausente significa "mostre as três, separadas". São contratos diferentes
> porque as perguntas são diferentes.

### A origem sem dado continua no filtro

Uma origem que a API da OVH nunca devolveu aparece na barra marcada
**"· sem dado"**, em vez de desaparecer. Esconder responderia a pergunta errada:
quem procura "uso corrente" precisa descobrir que a API não devolve isso — não
concluir que a tela está incompleta.

---

## 3. Ausência de dado não é custo zero

A regra mais importante desta tela. `0,00` e "sem dado" são afirmações
diferentes:

| Exibido | Significa |
|---|---|
| `USD 0,00` | a OVH cobrou zero neste período |
| **sem dado** | ninguém sabe quanto a OVH cobrou |

Num painel executivo um zero é lido como *"está sob controle"*. Escrever zero
onde a verdade é "não foi importado" faz o portal mentir exatamente no lugar onde
a decisão é tomada.

O contrato que sustenta isso: **todo valor monetário na resposta é anulável**, e
`null` nunca deve virar zero na interface. Um `?? 0` num componente converte a
segunda linha da tabela acima na primeira.

### As quatro ausências são distintas

Cada uma tem uma ação diferente do outro lado, então cada uma tem mensagem
própria — ver `decidirEstadoDado` em
[`dashboard/ovh.ts`](../web/src/lib/dashboard/ovh.ts):

| Estado | Quando | Mensagem | O que fazer |
|---|---|---|---|
| `sem-integracao` | tabelas `ovh_*` não existem | "Integração OVH não instalada…" | rodar a migração 005 |
| `sem-nenhum-dado` | `ovh_monthly_costs` vazia | **"Nenhum dado OVH importado ainda."** | rodar o collector |
| `fonte-sem-dado` | a origem escolhida não tem nenhuma linha | **"Sem dados de uso corrente retornados pela API OVH."** | nada — é normal |
| `periodo-sem-dado` | há dado da origem, nenhum na janela | "Nenhum custo OVH com origem … no período" | mudar o filtro |

A ordem de avaliação importa e é testada: **sem tabela vence tudo**, e **tabela
vazia vence "fonte sem dado"**. Dizer "a API não devolveu previsão" quando *nada*
foi importado culparia a OVH por uma coleta que nunca rodou.

A mensagem de `fonte-sem-dado` diz **"retornados pela API OVH"** de propósito: a
ausência de `usage_current`/`usage_forecast` não é defeito do portal nem falha de
coleta. A API responde `no usages found` para projeto Public Cloud sem consumo
registrado — foi o que aconteceu em produção. Culpar a coleta mandaria o operador
procurar um problema que não existe.

Um teste varre todas as combinações de estado × origem e afirma que **nenhuma
mensagem de ausência contém um valor monetário** — a prova estrutural da regra.

---

## 4. Moeda: escolhida, nunca somada

`ovh_monthly_costs.currency` é **por linha**, e o DDL tem `DEFAULT 'EUR'`. Hoje a
conta fatura em USD e as 512 linhas de produção são todas USD, mas nada no banco
impede a segunda moeda — basta uma conta europeia entrar no collector.

Somar moedas produz um número que não responde pergunta nenhuma. Converter
exigiria uma taxa EUR/USD que **o portal não tem**: a cotação que ele consulta no
Banco Central é USD/BRL.

Então: o servidor **escolhe** a moeda de maior volume (ou a de `?moeda=`), a tela
diz qual escolheu, e as outras aparecem num aviso com o próprio valor e contagem
de linhas. Empate é resolvido pelo código ISO — sem isso a tela trocaria de moeda
entre dois carregamentos idênticos.

Consequências visíveis:

- A **estimativa em BRL só existe quando a moeda é USD**. Em outra moeda o card
  diz por quê, em vez de mostrar um número com cara de real.
- No histórico de faturas cada linha usa a **própria** `currency` do cabeçalho,
  não a do recorte. Contar faturas de moedas diferentes é legítimo; somá-las não
  seria — por isso aquele endpoint devolve linhas e nenhum total agregado.

### ⚠️ `meta.moeda` do envelope não é a moeda da resposta

`rotaProtegida`/`rotaComPermissao` gravam `moeda: "USD"` **fixo** no `meta`,
depois de espalhar o meta da rota. Para a visão OVH esse campo é herança do
envelope compartilhado e **não** é autoritativo.

**A moeda autoritativa é `meta.filtros.moeda`.** Corrigir o envelope exigiria
mexer em `rota.ts`, que serve todas as rotas da AWS — fora do escopo desta
entrega, e registrado como pendência.

---

## 5. O que a tela mostra

Seis cards, cinco blocos.

| Card | Fonte |
|---|---|
| Custo faturado no período | `ovh_monthly_costs`, `source` do filtro |
| Estimativa em BRL | mesma cotação do resto do portal; só com moeda USD |
| Projetos OVH | `ovh_projects` (`count(*)`) |
| Faturas no período | `ovh_invoice_headers` |
| Última sincronização | `ovh_sync_runs` |
| Status do collector | `ovh_sync_runs`, mesma regra do diagnóstico |

| Bloco | Agrupamento |
|---|---|
| Evolução mensal | `billing_month` × `sum(amount)` |
| Maiores serviços (top 10) | `service_label` × `sum(amount)` |
| Custo por projeto | `project_service_name` × `sum(amount)` |
| Distribuição percentual | participação de cada serviço no total |
| Histórico de faturas | `ovh_invoice_headers` + contagem de `ovh_invoice_lines` |

### Status do collector reusa a regra do diagnóstico

`decidirSituacaoOvh` vem de [`diagnostico/ovh.ts`](../web/src/lib/diagnostico/ovh.ts),
não reimplementada. Se o painel executivo dissesse "coleta em dia" enquanto
`/dashboard/diagnostico` diz "a última coleta falhou", a tela cuja função é
atestar a qualidade do dado seria a primeira a discordar da que o exibe.

A especificação pediu quatro estados (success / failed / atrasado / sem execução)
e a função devolve sete. O mapa **traduz** os sete em vez de colapsá-los: os três
que sobram não são redundantes — `em_execucao` não é sucesso nem falha (é "espere
dois minutos"), `nunca_teve_sucesso` é pior que "falhou" (nenhum dado jamais foi
completo) e `erro_de_leitura` não diz nada sobre a coleta (a *tela* não conseguiu
perguntar). Chamar qualquer um dos três de "falhou" mandaria o operador
investigar a coisa errada.

### Mês sem fatura interrompe a linha

A série mensal vem com **todos** os meses da janela, e o mês sem fatura vem como
`total: null` — não zero, e não omitido:

- `total: 0` faria a linha mergulhar até a base, e o mês pareceria de custo zero.
  Na OVH isso é comum e falso: a fatura chega dias depois do fim do mês, então o
  mês corrente legitimamente ainda não tem `invoice`.
- Omitir o mês ligaria dois meses distantes como se fossem vizinhos, e a
  inclinação do trecho passaria a mentir sobre a velocidade da variação.

Com `null` + `connectNulls={false}` fica um buraco, que é a verdade. Uma linha
abaixo do gráfico diz quantos meses e por quê — o buraco é visível, a causa não.

---

## 6. Adaptações ao schema real

A especificação pediu colunas que existem, e um comportamento que o schema não
sustenta. O que foi adaptado:

### `service_label` e `category` existem — as duas

Ambas estão em `ovh_monthly_costs`, `NOT NULL`, com `category` em
`DEFAULT ''`. O agrupamento é por `service_label`; a categoria vem ao lado
**somente quando é única** para aquele rótulo:

```sql
min(nullif(c.category, ''))            AS categoria,
count(DISTINCT nullif(c.category, '')) AS categorias
```

`min()` sozinho escolheria uma das várias e a tela exibiria uma classificação que
o dado não sustenta. Quando `categorias > 1`, a coluna mostra `—`.

### `project_service_name = ''` é uma linha legítima

Não é lixo: o DDL usa string vazia com o significado **"não se aplica"** — custo
de fatura que não pertence a projeto nenhum (taxa de domínio, assinatura). A
coluna participa da chave `UNIQUE` do upsert e, em índice do Postgres, `NULL`
nunca é igual a `NULL` — com nulos, cada execução do collector inseriria linha
nova em vez de atualizar, e o custo dobraria a cada dia.

Consequências na tela:

- A linha aparece como **"Sem projeto atribuído"**, com hachura no gráfico (não é
  um projeto, é o resto da fatura — mesmo tratamento que "Outros" recebe).
- O card "Projetos OVH" diz quanto do total não pertence a projeto. Sem isso, a
  soma por projeto pareceria não fechar com o total.
- **Filtrar por projeto exclui essa parte**, e a barra de filtros avisa. O
  seletor lista apenas projetos reais: `?projeto=` vazio significa "todos", então
  não há como pedir explicitamente a linha não atribuída. Limitação conhecida.

### ⚠️ `ovh_invoice_headers.billing_month` é NULLABLE

Um furo real do schema. Uma fatura sem esse campo **não casa com nenhum filtro de
período** — ela desaparece de todas as janelas em silêncio.

A tela conta essas linhas separadamente (`meta.semMesAtribuido`) e exibe um aviso
dizendo que o número de faturas é o da janela, não o total do banco. Sem isso, a
tela diria "3 faturas no período" com 4 no banco.

Conferir:

```sql
SELECT count(*) FROM ovh_invoice_headers WHERE billing_month IS NULL;
```

### Sem filtro de conta

A especificação não pediu, e o cadastro tem **uma** conta OVH (`ovh-main-ca`).
Quando houver a segunda, o filtro entra em `FiltroOvh` como
`provider_account_id` — a coluna já está em todas as tabelas `ovh_*`.

### Nenhuma migração foi criada

Todas as seis tabelas da migração 005 atendem. Nenhum `CREATE`, `ALTER` ou índice
novo.

---

## 7. Segurança

| | |
|---|---|
| Autenticação | `rotaComPermissao`, que valida a sessão **contra o banco** (`app_sessions`) antes de ler qualquer parâmetro |
| Permissão | `dashboard:view` |
| Validação | Zod em todos os parâmetros; nada chega à query sem passar |
| Queries | `ConstrutorParams` → `$1, $2…` em 100% dos valores |
| `raw_json` | **nunca** sai das queries — é a resposta crua da API da OVH e exporia detalhe de integração ao navegador |
| Credenciais OVH | não existem no bundle; ficam no `.env` (modo 600) da EC2 e só o collector as lê |
| `error_message` | não sai neste endpoint. Já vem sanitizado do collector, mas o painel executivo não é lugar de stack — quem precisa abre o diagnóstico |

### `dashboard:view` é exigido aqui e não nas rotas AWS

Divergência deliberada, e vale registrar: `dashboard:view` está em
`PERMISSOES_DO_VIEWER`, então **hoje todo usuário autenticado a tem** e a
checagem não recusa ninguém. Ela existe para o dia em que a permissão sair do
piso.

Os endpoints AWS equivalentes usam `rotaProtegida` (só sessão). A inconsistência
aponta para o lado seguro — a tela nova exige, a antiga não — e uniformizar
exigiria mexer nas cinco rotas que sustentam o dashboard em produção.

---

## 8. Arquivos

### Servidor

| Arquivo | Papel |
|---|---|
| `web/src/lib/filtros/periodo-mensal.ts` | período em meses, **puro** |
| `web/src/lib/filtros/esquemas-ovh.ts` | validação Zod |
| `web/src/lib/dashboard/ovh.ts` | estados de ausência, escolha de moeda, **puro** |
| `web/src/lib/queries/dashboard-ovh.ts` | leitura das tabelas `ovh_*` |
| `web/src/lib/services/dashboard-ovh.ts` | URL → filtro; escolhe moeda e estado |

### Endpoints

Todos `GET`, todos sob `dashboard:view`:

```
/api/dashboard/ovh/summary       resumo + BRL + janela anterior
/api/dashboard/ovh/monthly       série mensal, com buracos preservados
/api/dashboard/ovh/services      top 10 + distribuição (mesma consulta)
/api/dashboard/ovh/projects      custo por projeto + lista do seletor
/api/dashboard/ovh/invoices      cabeçalhos de fatura da janela
/api/dashboard/ovh/sync-status   saúde do collector (não depende de filtro)
```

`services` alimenta dois blocos da tela com um endpoint só — separá-los faria a
mesma agregação rodar duas vezes e abriria a chance de divergirem.

### Cliente

| Arquivo | Papel |
|---|---|
| `web/src/lib/dashboard/filtros-ovh.ts` | estado na URL, **puro** |
| `web/src/lib/dashboard/tipos-ovh.ts` | contrato do JSON |
| `web/src/lib/dashboard/use-dashboard-ovh.ts` | carregamento paralelo |
| `web/src/components/dashboard/painel-dashboard.tsx` | comutador AWS/OVH |
| `web/src/components/dashboard/painel-executivo-ovh.tsx` | a visão |
| `web/src/components/dashboard/seletor-visao.tsx` | o seletor |
| `web/src/components/dashboard/filtros-ovh.tsx` | barra de filtros |
| `web/src/components/dashboard/cards-kpi-ovh.tsx` | os seis cards |
| `web/src/components/charts/mensal-ovh-chart.tsx` | evolução mensal |

### Alterados

| Arquivo | Mudança |
|---|---|
| `web/src/app/(privado)/dashboard/page.tsx` | renderiza o comutador |
| `web/src/components/dashboard/painel-executivo.tsx` | o selo "Visão AWS" virou seletor |
| `web/src/components/charts/barras-horizontais.tsx` | prop `formatar`, padrão `formatUSD` |
| `web/src/components/charts/chart-tooltip.tsx` | idem |
| `web/src/components/charts/distribuicao-servicos-chart.tsx` | prop `formatar` + entrada no mínimo estrutural |
| `web/src/lib/format.ts` | `formatMoedaCompacta` para o eixo Y |

As três mudanças em gráficos são **retrocompatíveis por construção**: `formatar`
tem `formatUSD` como padrão, então nenhum chamador da AWS muda de comportamento.
`DistribuicaoServicosChart` passou a aceitar `{ servico, total }` em vez de
`CustoDoServico` — o tipo da AWS continua satisfazendo, e a OVH deixa de precisar
inventar `totalAnterior`/`variacao` que não tem.

---

## 9. Testes

**494 no total** (eram 382). Os 112 novos:

| Arquivo | Cobre |
|---|---|
| `filtros/periodo-mensal.test.ts` | aritmética de mês, presets, janela anterior |
| `filtros/esquemas-ovh.test.ts` | validação de entrada, padrão de origem |
| `dashboard/ovh.test.ts` | as quatro ausências, escolha de moeda, status |
| `dashboard/filtros-ovh.test.ts` | URL ↔ estado, **e a visão AWS intacta** |

### Por que a aritmética de mês tem teste próprio

O bug que motivou o índice absoluto foi real e custou **16 meses de dado**. O
collector OVH calculava a janela mexendo em ano e mês separadamente:

```python
inicio = date(hoje.year - (1 if hoje.month <= MESES % 12 else 0), 1, 1)
```

A expressão devolvia sempre **janeiro do ano corrente**. A coleta importou 11
faturas em vez de 27 — sem erro nenhum, porque a data era válida.

`indiceDoMes` (`ano * 12 + mês - 1`) elimina a classe: em índice absoluto não
existe virada de ano, subtrair 12 é subtrair 12. Os testes travam justamente as
viradas.

### O que não tem teste unitário, e por quê

`services/dashboard-ovh.ts` e `queries/dashboard-ovh.ts` são `server-only` — o
vitest não consegue importá-los. É a mesma restrição que fez `diagnostico/ovh.ts`
existir separado de `services/ovh.ts`, e a razão de a lógica decidível estar nos
módulos **puros**: `decidirEstadoDado`, `escolherMoeda`, `resolverPeriodoMensal`,
`mesesDaJanela` e a validação Zod são todos testáveis, e é onde as regras vivem.

O que fica sem cobertura automatizada é o **SQL** — se um `GROUP BY` estiver
errado, nenhum destes testes acusa. Verificar isso exige banco, e está listado
como pendência.

---

## 10. Multi-cloud consolidado: fase futura

**Nenhum número desta tela soma AWS + OVH**, e isso é decisão, não pendência de
implementação.

Os dois provedores têm naturezas diferentes: a AWS é **diária e por uso**, a OVH
é **mensal e faturada**. Um total combinado não responderia nem "quanto consumi"
nem "quanto vou pagar" — o custo OVH está no mês em que foi *faturado*, não no
mês em que foi *consumido*, então comparar diretamente com o custo diário da AWS
desalinha em pelo menos um mês.

A consolidação depende de duas decisões de **negócio** que ainda não foram
tomadas:

1. **A moeda de referência** de um total multi-cloud. Hoje AWS e OVH faturam as
   duas em USD, o que faz a pergunta parecer fácil — mas a resposta precisa valer
   para o dia em que não for.
2. **Qual origem OVH representa custo realizado** quando comparada ao dia da AWS.
   `invoice` é o realizado, mas chega com atraso de um mês; `usage_current` é
   contemporâneo e não concilia com fatura.

Quando as duas estiverem respondidas, o caminho técnico já está registrado no
cabeçalho da migração 005: **uma VIEW de unificação**, porque é reversível — um
`DROP VIEW` desfaz, enquanto uma tabela migrada exige restore.

---

## 11. Pendências

| | |
|---|---|
| **Validar contra o banco real** | nenhuma consulta rodou contra Postgres nesta entrega (ambiente local, sem acesso a produção por instrução). As queries são a única parte sem cobertura automatizada |
| `meta.moeda` do envelope | fixo em `"USD"` para toda rota; a moeda real da visão OVH está em `meta.filtros.moeda`. Corrigir exige mexer em `rota.ts`, que serve as rotas da AWS |
| `dashboard:view` nas rotas AWS | hoje só a OVH exige. Uniformizar toca as cinco rotas que sustentam o dashboard em produção |
| Filtro de conta OVH | não existe; há uma conta só no cadastro |
| Pedir a linha "sem projeto" no filtro | o seletor só lista projetos reais; `?projeto=` vazio é "todos" |
| Faturas truncadas em 60 | a tela avisa quando trunca; sem paginação |
| Exportação CSV/XLSX | a visão AWS tem, a OVH não. Não foi pedido |
