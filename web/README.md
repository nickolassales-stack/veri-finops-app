# Portal FinOps VERI — aplicação web

Next.js 16 (App Router, TypeScript) + Tailwind v4. Consome **exclusivamente** o
PostgreSQL `finops`. Não acessa Athena, S3 ou qualquer API AWS.

Operação, deploy e rollback: **[../docs/RUNBOOK-app.md](../docs/RUNBOOK-app.md)**.

## Rodar local

Requer um túnel SSH até o PostgreSQL da EC2 FinOps (o banco não é público):

```bash
ssh -L 15432:127.0.0.1:5432 ubuntu@<ip-da-ec2>   # em outro terminal

npm install

cat > .env.local <<'EOF'
PG_HOST=127.0.0.1
PG_PORT=15432
PG_DB=finops
PG_USER=finops_app
PG_PASSWORD=...
EOF

npm run dev                        # http://localhost:3000
```

`.env.local` está no `.gitignore`. Nunca comitar credencial.

### Rodar em Docker, com a imagem que vai para a EC2

Para conferir o artefato antes de publicar — o `npm run dev` não prova que a
imagem funciona:

```bash
# na raiz do repositório, com o túnel SSH ativo
docker compose -f infra/docker-compose.dev.yml up -d --build
curl http://127.0.0.1:3001/api/health
docker compose -f infra/docker-compose.dev.yml down
```

Arquitetura, variáveis, deploy e rollback: **[README da raiz](../README.md)**.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (lê `.env.local`) |
| `npm run build` | Build de produção (não acessa o banco) |
| `npm start` | Servidor de produção — o mesmo binário que roda no container |
| `npm run lint` | ESLint |

Duas particularidades de `output: standalone`, ambas já resolvidas nos scripts,
mas que valem saber ao depurar:

- **`npm start` não lê `.env.local`.** O servidor standalone recebe configuração
  só do ambiente — igual ao container, onde as variáveis vêm do compose. Para
  testar o build de produção localmente:
  `set -a; . ./.env.local; set +a; npm start`
- **`prestart` copia `public/` e `.next/static/` para `.next/standalone/`.** Sem
  essa cópia o servidor sobe e responde 200, mas serve a página **sem CSS e sem
  gráficos** — os assets ficam 404. O `Dockerfile` faz a mesma cópia.

## Autenticação

E-mail e senha, sessão em banco, cookie HTTP-only. **Não existe cadastro
público**: usuários são criados por comando administrativo.

### Como configurar

1. **Criar as tabelas** (uma vez, aditivo e idempotente — não toca em nenhuma
   tabela financeira):

   ```bash
   docker exec -i finops-postgres \
     psql -U finops_user -d finops -X --no-psqlrc -v ON_ERROR_STOP=1 \
     < scripts/create-auth-tables.sql
   ```

   Cria `app_users` e `app_sessions` e concede a `finops_app` escrita **apenas**
   nelas. As tabelas de custo seguem somente-leitura para a aplicação.

2. **Variáveis de ambiente** (ver [`../infra/.env.example`](../infra/.env.example)):

   | Variável | Padrão | O que faz |
   |---|---|---|
   | `AUTH_SESSION_TTL_HOURS` | `12` | Validade da sessão. Sem renovação deslizante |
   | `AUTH_COOKIE_SECURE` | `true` | Atributo `Secure` do cookie. **Mantenha `true`** |

   `AUTH_COOKIE_SECURE=true` funciona no acesso por túnel SSH, porque navegadores
   tratam `http://localhost` / `127.0.0.1` como contexto seguro. Só mude para
   `false` para acessar por HTTP em host que não seja localhost — e aí a sessão
   trafega em claro. O certo é Nginx + HTTPS na frente.

### Como criar o primeiro usuário administrador

A senha vem **sempre** do ambiente, nunca de argumento de linha de comando (que
ficaria visível no `ps` e no histórico do shell).

```bash
# em produção, de dentro do container (que já tem PG_* no ambiente):
read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
docker exec -i -e ADMIN_EMAIL="nome@porveri.com.br" -e ADMIN_PASSWORD \
  finops-portal node scripts/create-admin.mjs
unset ADMIN_PASSWORD

# localmente (com túnel SSH ativo e .env.local configurado):
set -a; . ./.env.local; set +a
ADMIN_EMAIL="nome@porveri.com.br" ADMIN_PASSWORD="..." npm run create-admin
```

| Variável | Obrigatória | Observação |
|---|---|---|
| `ADMIN_EMAIL` | sim | único, comparado sem diferenciar caixa |
| `ADMIN_PASSWORD` | sim | mínimo 12 caracteres |
| `ADMIN_NAME` | não | exibido no cabeçalho |
| `ADMIN_ROLE` | não | `ADMIN` (padrão) ou `VIEWER` |

O comando é **idempotente**: rodar de novo para o mesmo e-mail redefine a senha e
o papel, e encerra as sessões abertas daquele usuário. Serve tanto para criar o
primeiro acesso quanto para destravar quem esqueceu a senha.

O próprio usuário troca a senha em **`/conta`** (link no cabeçalho, sobre o nome).
A senha atual é exigida mesmo com a sessão aberta — sem isso, um cookie roubado
permitiria tomar a conta em definitivo. Ao trocar, as sessões abertas em outros
navegadores são encerradas e a atual é preservada.

### Como testar login e logout

```bash
set -a; . ./.env.local; set +a
npm run dev        # ou: npm start, para exercitar o build de produção
```

| Cenário | Resultado esperado |
|---|---|
| Abrir `/login` | Formulário com identidade VERI |
| Senha errada | Permanece em `/login` com "E-mail ou senha incorretos." e **sem** cookie |
| Senha correta | Redireciona para `/dashboard`; cookie `veri_finops_session` HttpOnly + Secure + Lax |
| `/dashboard` sem sessão | Redireciona para `/login?next=%2Fdashboard` |
| `/dashboard` com sessão | Renderiza a visão executiva |
| Botão **Sair** | Volta para `/login`, apaga a linha em `app_sessions` e o cookie |
| `/conta` → trocar senha | Senha atual errada é recusada; troca válida confirma sucesso e mantém a sessão |
| 5 senhas erradas seguidas | Bloqueio de 5 minutos para aquele e-mail + IP |
| `/diagnostico` com perfil `VIEWER` | Redireciona para `/sem-permissao` |

Conferir no banco:

```sql
SELECT email, role, active, last_login_at FROM app_users;
SELECT user_id, expires_at, last_seen_at FROM app_sessions;   -- vazia após logout
```

### Perfis

| Perfil | Acesso |
|---|---|
| `ADMIN` | Tudo, incluindo `/diagnostico` (estrutura do banco e privilégios) |
| `VIEWER` | Visão executiva e analítico |

Esconder o link de navegação **não** é a proteção: a autorização é aplicada por
`requirePapel()` dentro da rota.

## Dashboard executivo (`/dashboard`)

Consome **os endpoints**, nunca o banco: o navegador não tem credencial de
PostgreSQL e não teria como obtê-la. A página é um Server Component fino que só
resolve o fuso; o carregamento acontece no cliente, o que permite trocar filtro
sem recarregar e dar a cada bloco seu próprio estado.

### Filtros globais

Valem para todos os cards e gráficos, e **a URL é a única fonte de verdade** —
link compartilhável, botão voltar funciona, recarregar não perde nada. Só o que
foge do padrão aparece na query string (`/dashboard` limpo = mês atual, todas as
contas).

- **Período**: 7 dias, 30 dias, mês atual, mês anterior, intervalo personalizado
- **Contas**: todas, uma ou várias — lista vinda de `cloud_accounts`, sem nenhum
  id fixo no código

Intervalo inválido é barrado **antes** de chamar a API, com mensagem sob o campo
e `aria-invalid`. A API valida de novo — a checagem no cliente é a primeira
barreira, não a única.

### Como o painel evita mentir com número

| Situação | O que a tela faz |
|---|---|
| Conjunto de contas muda entre os períodos | Substitui o percentual por "variação não comparável" e explica o motivo |
| Dia sem carga do ETL | **Interrompe a linha** (lacuna), em vez de desenhar zero |
| Conta sem carga no período | Fica **fora** do gráfico de barras e é nomeada em texto |
| Serviço que soma menos de um centavo | Sai do ranking e da distribuição |
| Custo lançado em data futura | Aviso no topo; o valor não entra em nenhum número |
| Cotação indisponível | BRL vem `—`; o USD segue exato |

### Hierarquia USD × BRL

USD é o valor oficial: card em destaque, corpo maior, tinta forte. BRL é
estimativa: card comum, corpo menor, tinta secundária, prefixo `~` e a palavra
"estimativa" no rótulo. A diferença tem de ser óbvia sem ler.

### Acessibilidade

HTML semântico (`main`, `header`, `section`, hierarquia de títulos); filtros em
`fieldset`/`legend` com radios e checkboxes nativos, navegáveis por setas e
`Esc`; foco visível dentro da paleta; nenhuma informação transmitida só por cor.
Todo gráfico de barras tem **visão de tabela** — exigência de contraste, não
conveniência (ver [../docs/DECISOES-dataviz.md](../docs/DECISOES-dataviz.md)).

### Responsividade

Desktop é prioritário; notebook, tablet e mobile verificados em 1440/1280/820/390 px
sem rolagem horizontal. Gráficos ficam em contêiner com `overflow-hidden`, para
que a largura obsoleta do recharts durante um redimensionamento não empurre o
layout.

## Organização

```
src/
  proxy.ts                   checagem otimista de cookie (Next 16 renomeou middleware)
  app/
    layout.tsx               raiz: sem cabeçalho (a tela de login não tem nav)
    page.tsx                 redireciona para /dashboard
    login/                   tela de entrada + formulário
    (privado)/
      layout.tsx             FRONTEIRA DE AUTENTICAÇÃO: requireSessao()
      dashboard/             visão executiva
      dashboard/analitico/   analítico: tabela paginada no servidor
      conta/                 dados da sessão e troca de senha
      diagnostico/           somente ADMIN
      sem-permissao/         403 de perfil insuficiente
    api/
      health/route.ts        usado pelo HEALTHCHECK do container (público)
      accounts/              cadastro de contas AWS
      dashboard/             summary, accounts, services, daily,
                             daily-by-service, analytic
      exchange-rate/         cotação USD/BRL
      export/                csv e xlsx do recorte atual (devolvem ARQUIVO)
  components/
    layout/                  header (logo, usuário, sair), nav, footer
    dashboard/               painel executivo, barra de filtros, cards de KPI
    charts/                  gráficos (tema e paleta validados)
    ui/                      card, aviso, kpi, estados, visão de tabela
  lib/
    auth/
      password.mjs           scrypt -- implementação única, usada pela app e pelo seed
      session.ts             criar/ler/destruir sessão em app_sessions
      dal.ts                 getSessao, requireSessao, requirePapel
      actions.ts             server actions de entrar/sair + throttle
      destino.ts             validação anti-open-redirect do parâmetro `next`
      troca-senha.ts         regras de troca de senha (puro, testável)
    api/
      http.ts                contrato { dados, meta } / { erro }; tradução de falhas
      rota.ts                envelope das rotas: exige sessão, padroniza resposta
    database/
      client.ts              pool pg, timeouts, checagem de saúde
      sql.ts                 ConstrutorParams, escape de LIKE, lista fechada
      tipos-pg.ts            date → string; timestamp → UTC (ver achado 7 do schema)
    filtros/
      periodo.ts             resolução de período (PURO, testável)
      esquemas.ts            validação Zod de tudo que chega pela URL
    export/
      colunas.ts             as 9 colunas -- fonte única de CSV e XLSX
      csv.ts                 BOM, separador, decimal, anti-injeção (PURO)
      metadados.ts           cabeçalho de contexto do arquivo (PURO)
      dados.ts               teto de linhas + leitura em lotes
      gerar-csv.ts           corpo em streaming
      gerar-xlsx.ts          planilha de duas abas
    queries/                 SQL por domínio
    services/                orquestra filtro + queries para os endpoints
      parametros-analiticos  contrato compartilhado por analytic e export/*
    dashboard/               filtros na URL (puro), cliente HTTP e hooks de dados
    exchange-rate/           cotação USD/BRL: provedores, cache, orquestrador
    env.ts                   validação de env (lazy: o build não precisa do banco)
    format.ts                formatação pt-BR; valores em USD, sem conversão
    nav.ts                   navegação (só rotas já implementadas)
scripts/
  create-admin.mjs           criação/atualização de usuário
```

## API de dados

Dez endpoints protegidos: `/api/accounts`,
`/api/dashboard/{summary,accounts,services,daily,daily-by-service,analytic}`,
`/api/exchange-rate` e `/api/export/{csv,xlsx}`.

Contrato, parâmetros de filtro, códigos de erro e as decisões por trás do
período padrão estão em **[../docs/API-dados.md](../docs/API-dados.md)**.

## Exportação (CSV e XLSX)

Botões em `/dashboard/analitico`. O arquivo é montado **no servidor** e contém
tudo o que o filtro seleciona — não a página visível. O navegador só recebe o
arquivo pronto: não formata, não soma e não converte nada.

**Biblioteca do XLSX: [`write-excel-file`](https://www.npmjs.com/package/write-excel-file)**
(MIT). Escolhida sobre `exceljs` por três motivos objetivos: uma dependência
(`fflate`) contra nove; publicação recente (4.1.1, jun/2026) contra 4.4.0 de
dez/2024; e escopo de **escrita apenas** — não carregamos um parser de xlsx/zip
que só serviria para ler arquivo de terceiro, superfície que um servidor de dado
financeiro não precisa ter. O CSV é escrito à mão: são ~90 linhas, e as decisões
que importam (BOM, separador, decimal, anti-injeção) são justamente as que uma
biblioteca genérica erraria para o Excel pt-BR.

| | CSV | XLSX |
|---|---|---|
| Codificação | UTF-8 **com BOM**, separador `;`, decimal com vírgula, CRLF | — |
| Metadados | linhas `# rótulo;valor` no topo | aba **Contexto** |
| Dados | após uma linha em branco | aba **Lançamentos**, cabeçalho congelado |
| Memória | **streaming**, lotes de 2.000 linhas | planilha inteira (é um zip de XML) |

**Por que o BOM:** sem ele o Excel do Windows abre o arquivo em ANSI e "Serviço"
vira "Serviço". **Por que `;`:** o Excel pt-BR usa o separador de lista do
sistema; com vírgula, a planilha inteira cai numa coluna só.

**Injeção de fórmula.** `service` e `account_name` vêm do ETL. Um valor iniciado
por `=`, `+`, `-` ou `@` seria **executado** ao abrir a planilha na máquina de
quem recebeu o arquivo (CWE-1236) — o `$1` do Postgres protege o banco, não o
Excel de quem abre. Campos de texto recebem prefixo `'`; números não, senão um
crédito negativo da AWS deixaria de somar.

**Teto de volume — `EXPORT_MAX_ROWS` (padrão 50.000).** Conferido *antes* de
gerar. Acima dele a exportação é **recusada** (HTTP 413) com a contagem e o
limite na mensagem. Nunca truncada: relatório financeiro cortado pela metade tem
cara de completo, e é o pior desfecho possível. O CSV em streaming não depende do
teto; quem ele protege é o XLSX, que precisa existir inteiro na memória antes de
ser compactado — num container de 512 MiB ao lado de um Metabase que já sofreu
OOM nesta instância.

Validado abrindo o arquivo gerado **no Excel** (16.0): duas abas, 231 linhas × 9
colunas, datas reconhecidas como data, valores como número, e a soma da coluna
USD calculada pelo próprio Excel batendo com o total da tela.

## Cotação USD/BRL

**Fonte: Banco Central do Brasil.** Dois provedores, ambos oficiais e sem
autenticação:

| `EXCHANGE_RATE_PROVIDER` | Fonte | Observação |
|---|---|---|
| `ptax` (padrão) | PTAX venda, via OData do Olinda | traz a **hora** do boletim |
| `sgs` | Série 1 do SGS | mesmo valor, só a **data** |
| `nenhum` | — | desliga a estimativa; nenhuma chamada externa |

### A conversão é estimativa, não valor contábil

O valor oficial da AWS é **em USD** — é assim que ele é armazenado, somado e
exibido. O BRL aparece apenas como ordem de grandeza ao lado, e **nada em BRL é
gravado no banco**: a estimativa é calculada na leitura e morre com a resposta.

A PTAX de um dia não é a taxa que a fatura aplicou. A taxa real depende da data
de fechamento do câmbio, do spread do emissor e do IOF. Por isso toda resposta
que traz BRL carrega junto o campo `aviso`.

### Comportamento quando a fonte falha

A ordem é sempre esta, e `obterCotacao()` **nunca lança** — é o que garante que
o custo em USD continue aparecendo:

| Situação | `status` | O que a tela mostra |
|---|---|---|
| Buscou agora | `current` | cotação normal |
| Cache dentro do TTL | `cached`, `desatualizada: false` | cotação normal |
| Falhou, mas há valor guardado | `cached`, **`desatualizada: true`** | valor + marca de desatualizado |
| Falhou e não há nada | `unavailable` | **só USD**; `estimativaBRL.total` vem `null` |

`null` e não zero: zero seria lido como "custo zero" — número inventado, que
este projeto não exibe.

O cache é em memória do processo, com duas camadas: dentro do TTL evita ida à
rede; passado o TTL o valor **não é descartado**, vira reserva para o caso de a
próxima busca falhar (até 7 dias). **Limitação:** o cache some no restart do
container. Nada quebra — a primeira requisição busca de novo, e se o BCB estiver
fora naquele instante, o portal segue em USD.

### Configuração

| Variável | Padrão | O que faz |
|---|---|---|
| `EXCHANGE_RATE_PROVIDER` | `ptax` | fonte, ou `nenhum` para desligar |
| `EXCHANGE_RATE_CACHE_TTL_SECONDS` | `3600` | validade do cache |
| `EXCHANGE_RATE_TIMEOUT_MS` | `4000` | teto de espera pela API externa |

Exige **saída HTTPS do container** para `olinda.bcb.gov.br` e `api.bcb.gov.br`.
Verificado na EC2 FinOps em 06/08/2026 (host e container respondem 200). Se a
saída for bloqueada, use `nenhum`.

> **Por que consultar um período e não "a cotação de hoje":** o boletim de
> fechamento sai por volta das 13h. Consultar a data de hoje devolve vazio a
> manhã inteira — e o fim de semana e feriado inteiros. O provedor PTAX consulta
> os últimos 10 dias e pega o boletim mais recente.

## Convenções

- **Sem dado mockado.** Sem banco, a tela mostra erro — nunca número inventado.
- **Autenticação nunca depende só do proxy.** `proxy.ts` faz checagem otimista de
  cookie; a validação real (token no banco, expiração, usuário ativo, perfil)
  acontece em `requireSessao()` dentro da rota. Cookie inventado passa pelo proxy
  e é recusado lá — comportamento coberto por teste E2E.
- Toda query usa placeholders (`$1`, `$2`). Nunca interpolar valor em SQL.
- Acesso a dados só em Server Components / Server Actions. A credencial nunca
  chega ao browser.
- Funções que tocam o banco chamam `connection()` (via `lib/db.ts`), o que as
  exclui do prerender — sem isso o `next build` tentaria consultar o banco.
- Cores apenas da paleta VERI (`src/app/globals.css`), conforme
  [`../docs/skill-veri.md`](../docs/skill-veri.md).
