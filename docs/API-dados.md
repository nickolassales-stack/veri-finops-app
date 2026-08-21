# API de dados — Portal FinOps VERI

Endpoints de leitura do PostgreSQL FinOps. Consumidos pela própria aplicação;
não são uma API pública.

> **Todos exigem sessão.** Sem cookie válido a resposta é `401` em JSON — nunca
> um redirecionamento para o HTML do login, que um `fetch` interpretaria como
> sucesso. A única rota pública é `/api/health`.

## Contrato

Vale para todos os endpoints de dados. As duas rotas de **exportação** são a
única exceção no sucesso: devolvem arquivo, não JSON (o erro continua igual).

Sucesso — sempre `{ dados, meta }`:

```json
{
  "dados": [ ... ],
  "meta": {
    "periodo": { "preset": "mes-atual", "de": "2026-08-01", "ate": "2026-08-06", "dias": 6,
                 "anterior": { "de": "2026-07-01", "ate": "2026-07-06", "dias": 6 },
                 "limitadoPorDadoDisponivel": false, "existeDadoAlemDaJanela": true },
    "filtros": { "contas": [], "todasAsContas": true, "regiao": null },
    "base":    { "hoje": "2026-08-06", "maiorDataComDado": "2026-09-04" },
    "moeda": "USD",
    "timezone": "America/Sao_Paulo",
    "geradoEm": "2026-08-06T14:32:57.113Z"
  }
}
```

Erro — sempre `{ erro }`, nunca com `dados` junto:

```json
{ "erro": { "codigo": "parametros-invalidos", "mensagem": "Parametros invalidos.",
            "detalhes": [ { "campo": "ate", "mensagem": "\"ate\" (2026-08-01) nao pode ser anterior a \"de\" (2026-08-10)." } ] } }
```

| Código | HTTP | Quando |
|---|---:|---|
| `nao-autenticado` | 401 | Sem sessão, sessão expirada ou cookie forjado |
| `parametros-invalidos` | 400 | Falha de validação — traz `detalhes` por campo |
| `exportacao-muito-grande` | 413 | O filtro é válido, mas seleciona mais linhas que `EXPORT_MAX_ROWS` |
| `consulta-excedeu-tempo` | 504 | `statement_timeout` do Postgres |
| `banco-indisponivel` | 503 | Sem conexão com o banco |
| `erro-interno` | 500 | Qualquer outra falha |

Mensagem de erro de banco **nunca** vai para o cliente: fica no log do
container. Só o detalhe de validação é devolvido, porque ali o dado é do
próprio usuário e serve para ele corrigir.

## Parâmetros comuns

Aceitos por todos os `/api/dashboard/*`.

| Parâmetro | Valores | Padrão |
|---|---|---|
| `periodo` | `7d` · `30d` · `mes-atual` · `mes-anterior` · `personalizado` | `mes-atual` |
| `de`, `ate` | `AAAA-MM-DD`, só com `periodo=personalizado` | — |
| `contas` | ids separados por vírgula, ou `todas` | todas |
| `regiao` | valor como está na base, ou `nao-informado` | sem corte |

**Período padrão:** do primeiro dia do mês corrente até o dia mais recente
exibível. Duas travas se aplicam, ambas vindas do dado real:

- o fim **nunca passa de hoje** — a base tem `usage_date` em setembro (cobrança
  anual lançada adiantado) com hoje em agosto;
- o fim também **não passa da última carga do ETL**, senão o gráfico do mês em
  curso termina em dias zerados que parecem queda de consumo.

Quando isso acontece, `meta.periodo.limitadoPorDadoDisponivel` e
`meta.periodo.existeDadoAlemDaJanela` avisam.

**Janela de comparação** (`meta.periodo.anterior`): para os presets de mês,
desloca um mês de calendário (01–06/08 compara com 01–06/07). Para os demais,
desloca pelo tamanho da janela. Limites: 731 dias e 50 contas por consulta.

**Datas** são de calendário — sem hora e sem fuso. "Hoje" é calculado em
`America/Sao_Paulo`, não em UTC.

**Valores** saem em USD exatamente como no CUR — é o valor oficial. Onde há
conversão para BRL (`summary` e `analytic`), ela é **estimativa** pela cotação do
Banco Central, vem em campo próprio, e é `null` — nunca zero — quando não há
cotação. Nada em BRL é gravado no banco.

## Endpoints

### `GET /api/accounts`

Cadastro de contas, direto de `cloud_accounts`. **Nenhum id de conta é fixo no
código** — é daqui que sai a lista de opções dos filtros.

Parâmetros: `busca` (id, nome, unidade ou centro de custo), `apenasAtivas`,
`provider` (`aws` · `ovh` · `all`), `ordenarPor` (`conta` · `nome` · `unidade` ·
`centroCusto` · `ambiente` · `ativa`), `direcao`, `pagina`, `tamanho` (máx. 200).

```json
{ "accountId": "800168045394", "accountName": "conta-piloto", "provider": "aws",
  "businessUnit": "ti", "costCenter": "TI-001", "environment": "prod", "active": true }
```

`provider` ausente devolve **todas** as contas — o campo `provider` vem sempre
preenchido, então quem consome distingue sem uma segunda chamada. O default
permissivo é proposital: um default `aws` esconderia contas OVH de quem não
soubesse pedi-las.

Os filtros do painel executivo e do analítico pedem `provider=aws`, porque essas
telas leem apenas tabelas AWS. Ver seção 5.2 do README.

> **Contas de outro provedor nos endpoints de custo AWS resultam em `400`**, e
> não em total zerado. Vale para os cinco endpoints de `/api/dashboard/*`, os
> três de `/api/analytic/*` e as duas exportações — todos passam pelo mesmo
> `montarFiltro()`. Código `parametros-invalidos`, mensagem:
> *"Esta tela exibe apenas contas AWS. Selecione contas AWS ou acesse
> Faturamento/OVH."*
>
> Diferente de conta **inexistente**, que é apenas aviso no `meta` — ali o total
> está incompleto; aqui estaria errado.

### `GET /api/dashboard/summary`

```json
{ "total": 42.607028, "totalAnterior": 93.192638, "variacao": -0.5428, "comparavel": false,
  "contasComCusto": 1, "contasComCustoAnterior": 1, "contasAtivasCadastradas": 2,
  "servicos": 19, "diasComDado": 5, "primeiroDiaComDado": "2026-08-01",
  "ultimoDiaComDado": "2026-08-05", "mediaDiaria": 8.52 }
```

Acompanha um bloco `estimativaBRL`:

```json
{ "total": 422.78, "totalAnterior": 648.74,
  "cotacao": { "valor": 5.0908, "dataReferencia": "2026-08-07", "fonte": "…",
               "status": "cached", "desatualizada": false, "mensagemErro": null },
  "aviso": "Conversao meramente indicativa. O valor oficial da AWS e em USD; …" }
```

**O número oficial é `total`, em USD.** O BRL é estimativa visual e vem `null`
— nunca zero — quando não há cotação. Nada em BRL é gravado no banco.

> **`comparavel: false` é o campo mais importante da resposta.** Ele fica falso
> quando o *conjunto* de contas com dado muda entre as duas janelas — não a
> quantidade, o conjunto. Hoje agosto tem só a conta nova e julho tinha só a
> piloto: uma conta em cada, contas diferentes. A variação de −54% existe no
> JSON mas mede ausência de carga, não consumo. **Quem consome deve exibir o
> aviso no lugar do percentual.**

### `GET /api/exchange-rate`

Cotação USD/BRL usada nas estimativas. **Fonte: Banco Central do Brasil**
(PTAX por padrão; ver [web/README.md § Cotação](../web/README.md#cotação-usdbrl)).

```json
{ "valor": 5.0908, "dataReferencia": "2026-08-07",
  "dataHoraReferencia": "2026-08-07T16:04:19.455Z",
  "fonte": "Banco Central do Brasil — PTAX (venda)", "provedor": "ptax",
  "status": "current", "desatualizada": false, "mensagemErro": null,
  "obtidaEm": "2026-08-07T18:22:10.004Z", "idadeSegundos": 0 }
```

Responde **200 mesmo quando a cotação está indisponível** — o endpoint
funcionou; quem falhou foi a fonte externa. O que houve está em `status`
(`current` · `cached` · `unavailable`) e `mensagemErro`. Devolver 503 faria o
cliente tratar como falha de infraestrutura da aplicação, que não é o caso.

> `desatualizada: true` significa que o cache passou do TTL e a renovação
> falhou. O número ainda serve para ordem de grandeza, mas **a interface precisa
> marcá-lo visualmente como velho**.

### `GET /api/dashboard/analytic`

Lançamentos linha a linha de `aws_daily_costs`, **paginados no banco**. É a fonte
da tela `/dashboard/analitico`.

> **Nomes de parâmetro próprios.** Esta rota usa `startDate`, `accountIds`,
> `page`… enquanto as demais usam `de`, `contas`, `pagina`. A diferença é o
> contrato definido para ela. A resolução de período, porém, é **a mesma**
> (`montarFiltro`) — analítico e painel nunca mostram janelas diferentes para o
> mesmo filtro.

| Parâmetro | Valores | Padrão |
|---|---|---|
| `startDate`, `endDate` | `AAAA-MM-DD`, os dois juntos ou nenhum | período padrão |
| `accountIds` | ids por vírgula, ou `todas` | todas |
| `serviceSearch` | texto, até 100 caracteres (`ILIKE`, sem diferenciar caixa) | — |
| `region` | valor como está na base, ou `nao-informado` | todas |
| `page` | ≥ 1 | 1 |
| `pageSize` | 1–200 | 50 |
| `sortBy` | `usageDate` · `accountId` · `accountName` · `service` · `region` · `cost` | `usageDate` |
| `sortDirection` | `asc` · `desc` | `desc` |

```json
{ "id": "6347", "usageDate": "2026-08-11", "accountId": "147997123577",
  "accountName": "conta-147997123577", "service": "AmazonEC2",
  "region": null, "costUSD": 3.4176, "currency": "USD", "estimatedBRL": 17.42 }
```

`region: null` é a tradução de `"nan"` — o cliente não precisa conhecer essa
peculiaridade do ETL. `estimatedBRL` é convertido **no servidor** e vem `null`
quando não há cotação; a cotação usada em toda a página está em `meta.cotacao`.

`meta` traz ainda `paginacao` (`page`, `pageSize`, `total`, `pages`), `somaUSD`
e `somaBRL` **de todo o filtro** (não da página) e `regioesDisponiveis` para
montar o seletor.

**Ordenação com desempate estável:** toda ordenação termina em `d.id ASC`. Sem
isso, duas páginas poderiam repetir ou omitir uma linha — `OFFSET` não garante
ordem entre linhas de mesmo valor.

**Índices:** medido em 11/08/2026 com 642 linhas, a consulta roda em **1,2 ms**
usando o índice UNIQUE que já existe (cuja primeira coluna é `usage_date`, o que
serve tanto ao corte por período quanto à ordenação padrão). Nenhum índice novo
foi criado. A proposta reversível e os gatilhos objetivos para revisitar estão em
[`scripts/proposta-indices-analitico.sql`](../scripts/proposta-indices-analitico.sql).

### `GET /api/export/csv` e `GET /api/export/xlsx`

Os lançamentos do filtro atual, como arquivo. **Não devolvem o envelope
`{ dados, meta }`** — devolvem o arquivo. A falha, essa sim, continua saindo em
JSON no formato de sempre, para a tela saber distinguir "sessão expirada" de
"filtro largo demais".

Aceitam **exatamente os mesmos parâmetros** de `/api/dashboard/analytic`, **menos
`page` e `pageSize`**: exportar é "tudo o que este filtro seleciona", não "a
página que estava aberta". O contrato é literalmente compartilhado
(`lib/services/parametros-analiticos`) e a leitura usa a mesma função de query da
tela — não existe um "SELECT da exportação" paralelo que possa divergir.

| | |
|---|---|
| Nome do arquivo | `veri-finops-AAAA-MM-DD_AAAA-MM-DD.{csv,xlsx}`, com o período **efetivamente aplicado** |
| Cabeçalhos | `content-disposition: attachment` (+ forma RFC 5987), `cache-control: no-store, private`, `x-content-type-options: nosniff` |
| Colunas | data de uso · conta AWS · nome da conta · serviço · região · **USD (oficial)** · **BRL (estimado)** · cotação utilizada · data/hora da cotação |
| Metadados | período, contas, data/hora da exportação, fonte/valor/status da cotação e os dois avisos (USD oficial, BRL estimativa) |

No CSV os metadados vão no topo, em linhas `# rótulo;valor` (o `#` permite
`pandas.read_csv(..., comment='#')`); no XLSX vão na aba **Contexto**, separados
da aba **Lançamentos** para não atrapalhar autofiltro e tabela dinâmica.

**CSV para Excel pt-BR:** BOM UTF-8 (sem ele o Excel do Windows abre em ANSI e
"Serviço" vira "Serviço"), separador `;`, decimal com vírgula e CRLF. Campos de
texto recebem proteção contra **injeção de fórmula** — `service` e `account_name`
vêm do ETL, e um valor iniciado por `=`, `+`, `-` ou `@` seria executado ao abrir
a planilha. Números não passam por essa proteção, senão um crédito negativo
deixaria de somar.

**Escala:** USD e BRL saem com 6 casas, a escala real de `numeric(18,6)`. Há
lançamentos de US$ 0,000001 na base — exportar com 2 casas, como a tela mostra,
zeraria linhas reais.

**Memória.** O CSV é transmitido em fluxo, com o banco lido em lotes de 2.000
linhas: o pico não depende do tamanho do arquivo. O XLSX precisa montar a
planilha inteira antes de compactar (é um zip de XML), e é esse caminho que
`EXPORT_MAX_ROWS` (padrão 50.000) protege. Acima do teto a resposta é **413
`exportacao-muito-grande`**, com o total e o limite na mensagem — **nunca um
arquivo truncado**, que teria cara de completo.

Durante a exportação nenhum lote enxerga linha inserida depois do início: a
consulta fixa um teto de `id` na largada. Sem isso, uma carga do ETL no meio do
processo deslocaria o `OFFSET` dos lotes seguintes e o arquivo sairia com linha
repetida ou faltando.

### `GET /api/dashboard/accounts`

Custo por conta na janela. Além dos comuns: `ordenarPor` (`custo` · `anterior` ·
`conta` · `nome`), `direcao`, `pagina`, `tamanho`.

`temDadoNaJanela: false` distingue **"a conta não gastou"** de **"o ETL não
carregou o período"**. São coisas diferentes e a segunda não pode virar zero.
`meta.totalDaJanela` traz o total de todas as contas, não o da página.

### `GET /api/dashboard/services`

Top serviços. `limite` padrão 10, máx. 50. `meta.outros` traz a soma do que
ficou fora, para o gráfico não sugerir que o top N é o total —
`Σ dados + meta.outros === meta.totalDaJanela`.

### `GET /api/dashboard/daily`

Evolução diária, **com todos os dias do período**, inclusive os sem linha na
base — esses vêm com `semDado: true` e total zero. Dia sem carga precisa
aparecer como lacuna, nunca como queda a zero.

### `GET /api/dashboard/daily-by-service`

Matriz: `dias` é o eixo e cada série traz `valores` alinhados índice a índice.

```json
{ "dias": ["2026-08-01", "..."],
  "series": [ { "nome": "AmazonEC2", "total": 32.69, "valores": [7.23, 7.23, "..."] } ] }
```

Serviços além de `limite` (padrão 8, máx. 20) são somados em **"Outros"**,
agregado no banco. Isso limita o payload e respeita a regra de cores do
projeto: a paleta categórica é fixa e não é reciclada para uma série N+1.

## Endpoints da Visão OVH

Seis rotas sob `/api/dashboard/ovh/`. Todas `GET`, todas exigindo sessão **e** a
permissão `dashboard:view`. Documentação da tela e das regras:
[dashboard-ovh.md](dashboard-ovh.md).

**Vocabulário próprio.** Estas rotas não aceitam os parâmetros da AWS, e as da
AWS não aceitam os destas — `ovh_monthly_costs` tem granularidade de **mês**, não
de dia.

| Parâmetro | Valores | Padrão |
|---|---|---|
| `periodo` | `6m`, `12m`, `24m`, `ano-atual`, `personalizado` | `12m` |
| `deMes` / `ateMes` | `AAAA-MM`, só com `periodo=personalizado` | — |
| `source` | `invoice`, `usage_current`, `usage_forecast` | **`invoice`** |
| `projeto` | `ovh_projects.service_name` | todos |
| `moeda` | ISO de 3 letras | a de maior volume no recorte |

`periodo=30d` devolve **400**, não o padrão em silêncio. Teto de 60 meses por
consulta.

### `source` tem padrão, e não é opcional

As três origens **não se somam**: o mesmo projeto no mesmo mês tem legitimamente
linha nas três, e um `sum(amount)` sem a origem triplica o custo. Um `source`
opcional obrigaria "ausente" a significar uma de duas coisas — somar as três
(errado) ou escolher uma escondido de quem chamou. O padrão explícito `invoice` é
a terceira opção: o custo realizado, visível na URL.

### Valor monetário é anulável, e `null` não é zero

Todo total nestas respostas pode vir `null`. **Não trate como zero.** `0` significa
"a OVH cobrou zero"; `null` significa "não existe afirmação sobre esse custo". O
`meta.ausencia.mensagem` diz qual das quatro ausências ocorreu.

### ⚠️ `meta.moeda` não é a moeda da resposta

O envelope compartilhado grava `moeda: "USD"` fixo em toda rota do portal. Para as
rotas OVH esse campo é herança e **não** é autoritativo — a moeda real do recorte
está em **`meta.filtros.moeda`**.

### `meta` comum a todas

```json
{ "periodo": { "preset": "12m", "rotulo": "Últimos 12 meses",
               "deMes": "2025-09", "ateMes": "2026-08", "meses": 12,
               "anterior": { "deMes": "2024-09", "ateMes": "2025-08", "meses": 12 } },
  "filtros": { "source": "invoice", "projeto": null, "todosOsProjetos": true,
               "moeda": "USD", "moedasIgnoradas": [] },
  "disponibilidade": { "instalado": true, "temAlgumDado": true,
                       "fontesComDado": ["invoice"],
                       "moedasNoPeriodo": [ { "moeda": "USD", "total": 30917.39, "linhas": 512 } ] },
  "estado": "ok",
  "ausencia": { "mensagem": null, "detalhe": null },
  "base": { "hoje": "2026-08-20", "mesCorrente": "2026-08" } }
```

`estado` é um de `ok`, `sem-integracao`, `sem-nenhum-dado`, `fonte-sem-dado`,
`periodo-sem-dado`. `moedasIgnoradas` não-vazio significa que o recorte tem mais
de uma moeda e o total **exclui** as listadas — nunca soma.

### `GET /api/dashboard/ovh/summary`

```json
{ "estado": "ok", "total": 30917.39, "totalAnterior": 12044.10,
  "variacao": 1.5670, "linhas": 512,
  "projetosComCusto": 1, "projetosCadastrados": 1, "servicos": 37,
  "mesesComDado": 24, "primeiroMes": "2024-09", "ultimoMes": "2026-08",
  "custoSemProjeto": 118.40, "faturas": 11,
  "estimativaBRL": { "total": 168000.0, "cotacao": { "...": "..." } } }
```

`estimativaBRL` é `null` — e não um objeto com `total: null` — quando a moeda do
recorte **não** é USD: a cotação do portal é USD/BRL, e aplicá-la a euro daria um
número com cara de real sem relação com a fatura.

`custoSemProjeto` é a parte do total que a fatura não atribui a projeto nenhum
(taxa de domínio, assinatura). Não é erro: `project_service_name = ''` significa
"não se aplica" no DDL.

### `GET /api/dashboard/ovh/monthly`

```json
[ { "mes": "2025-09", "total": 1204.41, "linhas": 21 },
  { "mes": "2026-08", "total": null, "linhas": 0 } ]
```

Devolve **todos** os meses da janela, inclusive os sem fatura, e o mês sem fatura
vem com `total: null`. Nem zero (a linha mergulharia até a base e o mês pareceria
de custo nulo) nem omitido (a linha ligaria dois meses distantes como vizinhos).
Na OVH a fatura chega dias depois do fechamento, então o mês corrente
legitimamente ainda não tem `invoice`.

### `GET /api/dashboard/ovh/services`

Top 10 por `service_label`. Alimenta o ranking **e** a distribuição percentual —
um endpoint só, para a mesma agregação não rodar duas vezes e não divergir.

```json
[ { "servico": "Public Cloud", "categoria": "instance",
    "total": 20100.55, "linhas": 240, "participacao": 0.65 } ]
```

`categoria` é `null` quando o rótulo aparece em mais de uma categoria — exibir uma
das várias afirmaria uma classificação que o dado não sustenta.

`meta` extra: `totalDaJanela`, `outros`, `servicosNaJanela`, `agrupouEmOutros`.
`outros` é a diferença entre o total e a soma do topo, e vive no `meta` porque
"Outros" não é um serviço.

### `GET /api/dashboard/ovh/projects`

```json
[ { "servicoDoProjeto": "abc123", "nome": "Produção", "semProjeto": false,
    "total": 30799.0, "linhas": 500, "participacao": 0.996 },
  { "servicoDoProjeto": "", "nome": null, "semProjeto": true,
    "total": 118.40, "linhas": 12, "participacao": 0.004 } ]
```

A linha com `semProjeto: true` é legítima, não lixo. `meta.projetosDisponiveis`
traz as opções do seletor — derivadas do **mesmo** recorte, para o filtro não
oferecer um projeto que a janela não contém.

### `GET /api/dashboard/ovh/invoices`

```json
[ { "billId": "FR12345", "billDate": "2026-08-05", "billingMonth": "2026-07",
    "totalSemImposto": 1000.0, "imposto": 0.0, "totalComImposto": 1000.0,
    "moeda": "USD", "linhas": 21 } ]
```

Não filtra por origem (cabeçalho de fatura não tem `source` — ele **é** o
faturado), nem por projeto, nem por moeda: cada linha traz a própria `currency`.
Contar faturas de moedas diferentes é legítimo; somá-las não seria, e por isso
esta rota não devolve total agregado.

`meta.semMesAtribuido` conta cabeçalhos com `billing_month` **nulo**. A coluna é
NULLABLE no DDL, e uma fatura sem ela não casa com nenhum filtro de período —
desapareceria de todas as janelas em silêncio. Sem esse número, a tela diria
"3 faturas no período" com 4 no banco.

Limite de 60 por resposta; `meta.truncado` avisa.

### `GET /api/dashboard/ovh/sync-status`

Ignora todos os filtros: a saúde do collector não tem recorte.

```json
{ "situacao": "ok", "rotulo": "Coleta em dia", "tom": "ok",
  "ultima": { "id": 7, "status": "success", "source": "manual",
              "startedAt": "2026-08-20T15:53:00.000Z",
              "finishedAt": "2026-08-20T15:54:01.000Z",
              "costRows": 512, "invoiceRows": 11 },
  "ultimoSucesso": { "...": "..." } }
```

`situacao` usa a **mesma** regra de `/dashboard/diagnostico` (`decidirSituacaoOvh`),
não uma cópia: se o painel executivo dissesse "coleta em dia" enquanto o
diagnóstico diz "a última falhou", a tela que atesta a qualidade do dado seria a
primeira a discordar da que o exibe.

`error_message` **não** sai daqui. Já vem sanitizado do collector, mas o painel
executivo não é lugar de stack — quem precisa do detalhe abre o diagnóstico.

## Segurança

- **Sessão verificada contra o banco em toda rota**, dentro do handler. O
  `proxy.ts` só faz triagem otimista de presença de cookie — cookie forjado
  passa por ele e é recusado no handler (coberto por teste).
- A checagem de sessão vem **antes** da validação de parâmetros: quem não está
  autenticado não consegue nem sondar o comportamento da API.
- **Todo valor vai como parâmetro** (`$1`, `$2`). Filtros opcionais são montados
  por `ConstrutorParams`, que numera os placeholders — nada é concatenado.
- **Campo de ordenação e direção não podem ser parâmetro** no protocolo do
  Postgres, então vão para o texto do SQL. Por isso passam por lista fechada
  (`z.enum`) e por `identificadorPermitido()` na montagem, que usa
  `Object.hasOwn` para não cair em propriedade herdada (`toString`).
- Curingas de `ILIKE` são escapados: busca por `%` não devolve a base inteira.
- `DATABASE_URL` e as variáveis `PG_*` nunca cruzam para o cliente — a camada de
  banco é `server-only`.
- **Agregação sempre no Postgres.** O que trafega para o Node já é o resultado
  somado; histórico bruto nunca sai do banco.

## Fonte dos dados

Todos os endpoints de dashboard leem **`aws_daily_costs`**. O período pode
começar e terminar em qualquer dia, e a tabela mensal só tem granularidade de
mês. Os dois totais conferem (agosto: 42,61 nos dois), então não há perda de
fidelidade. A aplicação **não acessa Athena, S3 ou API da AWS** — apenas o
PostgreSQL, com role de privilégio mínimo (`SELECT` nas tabelas do ETL).
