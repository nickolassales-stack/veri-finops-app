# Schema real do PostgreSQL FinOps

> Coletado em **05/08/2026 15:40 UTC** por [`scripts/inspect-schema.sql`](../scripts/inspect-schema.sql)
> (somente leitura) contra `finops-postgres` na EC2 FinOps.
> Servidor: **PostgreSQL 16.14** (Debian) · banco `finops` · timezone `Etc/UTC`.
>
> Este documento é a **fonte de verdade** para as queries da aplicação. Antes de
> escrever query nova, reexecute o script e confirme que nada mudou.

## Visão geral

Um único schema (`public`), 5 tabelas, **nenhuma view**, **nenhum trigger**,
extensão apenas `plpgsql`.

| Tabela | Linhas | Tamanho | Papel |
|---|---:|---:|---|
| `aws_daily_costs` | 515 | 240 kB | Custo diário por conta / serviço / região |
| `aws_monthly_costs` | 35 | 80 kB | Custo mensal por conta / serviço |
| `cloud_accounts` | 2 | 32 kB | Cadastro e classificação das contas |
| `cloud_budgets` | **0** | 16 kB | Orçamentos — nunca populada |
| `cost_alerts` | **0** | 16 kB | Alertas — nunca populada |

## Colunas

### `aws_daily_costs` — alimentada pelo ETL
| # | Coluna | Tipo | Nulo | Default |
|---|---|---|---|---|
| 1 | `id` | `bigint` | NO | `nextval('aws_daily_costs_id_seq')` |
| 2 | `usage_date` | `date` | NO | |
| 3 | `account_id` | `varchar(20)` | NO | |
| 4 | `service` | `text` | NO | |
| 5 | `region` | `text` | YES | |
| 6 | `cost_amount` | `numeric(18,6)` | NO | |
| 7 | `currency` | `varchar(10)` | YES | `'USD'` |
| 8 | `created_at` | `timestamp` | YES | `now()` |

`PRIMARY KEY (id)` · `UNIQUE (usage_date, account_id, service, region)`

### `aws_monthly_costs` — alimentada pelo ETL
| # | Coluna | Tipo | Nulo | Default |
|---|---|---|---|---|
| 1 | `id` | `bigint` | NO | `nextval('aws_monthly_costs_id_seq')` |
| 2 | `month` | `date` | NO | primeiro dia do mês |
| 3 | `account_id` | `varchar(20)` | NO | |
| 4 | `service` | `text` | NO | |
| 5 | `cost_amount` | `numeric(18,6)` | NO | |
| 6 | `currency` | `varchar(10)` | YES | `'USD'` |
| 7 | `created_at` | `timestamp` | YES | `now()` |

`PRIMARY KEY (id)` · `UNIQUE (month, account_id, service)`

### `cloud_accounts` — governança
| # | Coluna | Tipo | Nulo | Default |
|---|---|---|---|---|
| 1 | `account_id` | `varchar(20)` | NO | **PK** |
| 2 | `account_name` | `text` | NO | |
| 3 | `provider` | `text` | YES | `'aws'` |
| 4 | `owner` | `text` | YES | |
| 5 | `business_unit` | `text` | YES | |
| 6 | `cost_center` | `text` | YES | |
| 7 | `environment` | `text` | YES | |
| 8 | `client` | `text` | YES | **não consta na documentação** |
| 9 | `active` | `boolean` | YES | `true` |
| 10 | `created_at` | `timestamp` | YES | `now()` |
| 11 | `updated_at` | `timestamp` | YES | `now()` |

### `cloud_budgets` — vazia
`id` (PK, serial) · `month` `date` NOT NULL · `account_id` `varchar(20)` ·
`business_unit` · `cost_center` · `project` `text` ·
`budget_amount` `numeric(18,2)` NOT NULL · `currency` `varchar(10)` = `'USD'` ·
`owner` `text` · `created_at` `timestamp` = `now()`

### `cost_alerts` — vazia
`id` (PK, serial) · `alert_date` `date` NOT NULL · `account_id` `varchar(20)` ·
`service` `text` · `alert_type` `text` NOT NULL · `severity` `text` NOT NULL ·
`message` `text` NOT NULL · `current_cost` `numeric(18,6)` ·
`reference_cost` `numeric(18,6)` · `variation_percent` `numeric(10,2)` ·
`status` `text` = `'open'` · `created_at` `timestamp` = `now()`

## Roles

| Role | Superuser | Observação |
|---|---|---|
| `finops_user` | **sim** | Dono do schema; usado pelo ETL e pelo Metabase-alvo |
| `metabase_user` | não | Banco interno do Metabase |

Não existe role de aplicação. Todos os privilégios nas 5 tabelas pertencem
exclusivamente a `finops_user`.

## Dados presentes hoje

> Reinspecionado em **06/08/2026 11:20 UTC**. O ETL rodou às 08:00 UTC e
> `aws_daily_costs` foi de 515 para 534 linhas. Os números abaixo são os atuais.

```
cloud_accounts
  800168045394  conta-piloto        infra / ti / TI-001 / prod   ativa
  147997123577  conta-147997123577  infra / ti / TI-002 / prod   ativa

aws_monthly_costs                                              (35 linhas)
  2026-07  800168045394  15 serviços  US$ 311,41   carregado 04/08 17:23 UTC
  2026-08  147997123577  19 serviços  US$  42,61   carregado 05/08 16:25 UTC
  2026-09  800168045394   1 serviço   US$  37,32   carregado 04/08 17:23 UTC

aws_daily_costs                                               (534 linhas)
  800168045394  01/07 a 04/09  32 dias  16 serviços  US$ 348,73   carga 04/08 17:23 UTC
  147997123577  01/08 a 05/08   5 dias  19 serviços  US$  42,61   carga 06/08 08:00 UTC
```

Totais mensal e diário conferem por conta (348,73 e 42,61) — por isso as queries
do dashboard podem usar `aws_daily_costs` como fonte única sem perder fidelidade.
Moeda única: `USD`. Maior serviço: `AmazonEC2`, ~70% do total.

**A conta piloto continua sem nenhum dia de agosto** (seus 32 dias são julho
inteiro + 04/09). É a partição `billing_period=2026-08` que não foi criada no
Athena. Consequência direta: qualquer comparação agosto × julho compara contas
diferentes, e é por isso que a API devolve `comparavel: false`.

---

## Achados que a aplicação precisa tratar

### 1. `region` contém a string literal `"nan"` em 410 de 515 linhas (80%)

```
nan         410      us-east-1f   31
us-east-1b   35      us-east-2a    4
us-east-2c   31      us-east-2b    4
```

É um `NaN` do pandas serializado como texto pelo ETL, não um valor de região.
Além disso, os valores preenchidos são **zonas de disponibilidade**
(`us-east-1b`), não regiões (`us-east-1`) — a coluna está mal alimentada.

Efeito colateral relevante: a constraint `UNIQUE (usage_date, account_id,
service, region)` **só funciona porque `"nan"` é texto**. Se o ETL passasse a
gravar `NULL`, o upsert deixaria de deduplicar (em SQL, `NULL` nunca é igual a
`NULL`) e a tabela acumularia linhas duplicadas a cada execução.

→ Correção pertence ao ETL. Até então, a aplicação trata `"nan"` como
"não informado" e não oferece corte por região.

### 2. Existem períodos no futuro

`month = 2026-09-01` e `usage_date` até `2026-09-04`, com data de referência
05/08/2026. São provavelmente cobranças lançadas adiantado (`AmazonRegistrar`,
US$ 37,32 — típico de registro anual de domínio).

→ A aplicação **não pode** definir "mês atual" como `max(month)`. Usa a data
corrente e sinaliza explicitamente valores lançados em período futuro.

### 3. `cloud_budgets` não tem constraint de unicidade

Nada impede duas linhas para o mesmo `month` + `account_id`. Uma tela de
orçamento vs realizado somaria os dois silenciosamente.

→ A aplicação valida no `INSERT`; a constraint no banco fica como recomendação.

### 4. Nenhuma FK entre `cloud_budgets`/`cost_alerts` e `cloud_accounts`

`account_id` é apenas texto solto. Nada garante que aponte para conta existente.

→ A aplicação valida a existência da conta antes de gravar.

### 5. `updated_at` não é mantido por trigger

`cloud_accounts.updated_at` tem default `now()` mas nada o atualiza — o POP
atribui `updated_at = now()` manualmente no upsert.

→ Toda escrita da aplicação em `cloud_accounts` seta `updated_at` explicitamente.

### 6. `account_name` da segunda conta é placeholder

`conta-147997123577` — o nome amigável previsto no POP não foi preenchido, e
`client` está vazio nas duas contas.

### 7. `created_at` é `timestamp` sem fuso, e o driver lia como hora local

As tabelas do ETL usam `timestamp without time zone`. O servidor roda em
`Etc/UTC`, então `now()` grava UTC — mas o `node-postgres` interpreta esse texto
como hora **local do processo**. Em `America/Sao_Paulo` a carga das 08:00 UTC
aparecia na tela como 08:00 BRT: três horas adiantada.

→ Corrigido em [`src/lib/database/tipos-pg.ts`](../web/src/lib/database/tipos-pg.ts),
que registra dois parsers: `timestamp` passa a ser lido como UTC e `date` passa a
ser devolvido como string `AAAA-MM-DD`, sem virar `Date` (em fuso negativo,
`2026-08-01` virava `2026-08-01T03:00:00Z` e qualquer formatação em UTC devolvia
o dia anterior). As tabelas de autenticação usam `timestamptz` e não são
afetadas.

### 8. `finops_user` é superusuário

O ETL e o Metabase acessam o banco com superusuário. Fora do escopo desta
aplicação (que terá role próprio de privilégio mínimo), mas fica registrado
como recomendação de segurança.
