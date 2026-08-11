# API de dados — Portal FinOps VERI

Endpoints de leitura do PostgreSQL FinOps. Consumidos pela própria aplicação;
não são uma API pública.

> **Todos exigem sessão.** Sem cookie válido a resposta é `401` em JSON — nunca
> um redirecionamento para o HTML do login, que um `fetch` interpretaria como
> sucesso. A única rota pública é `/api/health`.

## Contrato

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
`ordenarPor` (`conta` · `nome` · `unidade` · `centroCusto` · `ambiente` ·
`ativa`), `direcao`, `pagina`, `tamanho` (máx. 200).

```json
{ "accountId": "800168045394", "accountName": "conta-piloto",
  "businessUnit": "ti", "costCenter": "TI-001", "environment": "prod", "active": true }
```

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
