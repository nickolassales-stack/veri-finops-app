# Homologação — deploy multi-provider OVH

**Commit em produção:** `f08a383` · **anterior:** `ae42e22`
**Data:** 20/08/2026 · **URL:** <https://finops.nexeeo.com>

---

## Por que este documento separa quem observou o quê

Um registro de homologação que não diz **quem verificou** cada item não serve
para auditoria: seis meses depois ninguém sabe se "Login OK" foi alguém abrindo
o navegador ou um script conferindo um código HTTP. São coisas diferentes, e
falham de formas diferentes.

Por isso as duas tabelas abaixo. É a mesma regra que a tela de Faturamento aplica
à situação de pagamento — mostrar **quem afirmou** ao lado do que foi afirmado.

---

## 1. Verificado no navegador, com sessão autenticada

Observado pelo operador (Nickolas Sales) em 20/08/2026, em
<https://finops.nexeeo.com>. **Não reproduzível por automação nesta entrega:**
as rotas exigem sessão válida contra `app_sessions`, e não há credencial de
aplicação disponível fora do navegador do operador.

| # | Item | Resultado |
|---|---|---|
| 1 | Login | OK |
| 2 | Dashboard AWS carrega | OK |
| 3 | **Conta OVH fora do filtro do dashboard AWS** | OK |
| 4 | Admin › Contas mostra provider AWS/OVH | OK |
| 5 | Alias da conta OVH editável | OK |
| 6 | Faturamento mostra seção OVHcloud | OK |
| 7 | Diagnóstico mostra bloco OVH Collector | OK |
| 8 | Analítico AWS não aceita conta OVH | OK |
| 9 | Exportação AWS não inclui conta OVH | OK |
| 10 | Logout | OK |

O item 3 é o objetivo declarado do deploy. Antes de `f08a383` a conta
`ovh-main-ca` aparecia no filtro e, ao ser selecionada, devolvia `US$ 0,00` — um
zero com aparência de resposta legítima, porque a conta **existe** em
`cloud_accounts` e não tem uma única linha em `aws_daily_costs`.

---

## 2. Verificado por automação na EC2

Executado durante o deploy. Reproduzível a qualquer momento pelos comandos da
coluna direita.

| Item | Resultado | Como conferir de novo |
|---|---|---|
| `OVH_CRON_INSTALADO=true` **dentro do container** | OK | `docker exec finops-portal printenv \| grep ^OVH_` |
| Portal `running` + `healthy`, 0 reinícios | OK | `scripts/finops-app.sh health` |
| `/api/health` responde `db.ok = true` | OK | idem |
| HTTPS público responde | 307 → `/login` | `curl -I https://finops.nexeeo.com` |
| `/login` serve | 200 | idem |
| Rotas de dados sem sessão | **401**, nunca 500 | `curl -s -o /dev/null -w '%{http_code}' https://finops.nexeeo.com/api/dashboard/summary` |
| AWS byte a byte idêntica | 1539 linhas · 1559,361036 · 4 contas | consulta abaixo |
| Metabase e Postgres não recriados | `Up 3 weeks` | `docker ps` |
| Crontab intacto: AWS 08:00 + OVH 09:00 | OK | `crontab -l` |

```sql
-- integridade AWS: os três números não podem mudar num deploy do portal
SELECT count(*) AS linhas, round(sum(cost_amount), 6) AS total,
       count(DISTINCT account_id) AS contas
  FROM aws_daily_costs;
```

### O código novo está de fato servindo

Conferido dentro do container **em execução**, não no repositório — a diferença
importa: um `git log` correto no disco não prova que a imagem foi reconstruída.

```bash
docker exec finops-portal sh -c 'grep -rl "OVH Collector" /app/.next | wc -l'
docker exec finops-portal sh -c 'grep -rho "Esta tela exibe apenas contas[^\"]\{0,40\}" /app/.next | head -1'
docker exec finops-portal sh -c "grep -rho \"coalesce(provider, .aws.) <> \" /app/.next | head -1"
```

A mensagem de recusa aparece como `Esta tela exibe apenas contas ${o}` — o
`${o}` é a variável minificada do provedor. Procurar a string literal
`"apenas contas AWS"` devolve zero e **não** indica problema: ela é montada por
interpolação em tempo de execução.

---

## 3. Estado dos dados na homologação

| | |
|---|---|
| Contas AWS | 4 — `800168045394`, `147997123577`, `891377338363`, `683745271637` |
| Conta OVH | 1 — `ovh-main-ca` (`provider='ovh'`, alias "OVH Principal") |
| Custo AWS | 1539 linhas diárias · US$ 1.559,361036 |
| Custo OVH | 512 linhas mensais · US$ 30.917,39 · 2024-09 a 2026-08 |
| Origens OVH presentes | **só `invoice`** |
| Último sync OVH | id 7, `success`, `manual` |

`usage_current` e `usage_forecast` não têm linha: a API da OVH responde
`no usages found` para o único projeto Public Cloud, que não tem consumo
registrado. Os dois cards correspondentes em Faturamento exibem **"sem dado"**, e
isso é o comportamento correto — `0,00` seria uma afirmação sobre o custo, quando
a afirmação verdadeira é "não foi coletado".

Consequência para leitura dos números: **o custo OVH está no mês em que foi
faturado, não no mês em que foi consumido.** Comparar diretamente com o custo
diário da AWS desalinha em pelo menos um mês.

---

## 4. O que a homologação NÃO cobre

- **Nenhum total soma AWS + OVH.** As telas executivas seguem AWS-only, por
  decisão, não por pendência de implementação.
- **Nenhuma conversão de moeda.** A conta OVH fatura em USD hoje; a moeda de
  referência para um total multi-cloud continua sendo decisão de negócio.
- **A primeira execução automática do cron OVH ainda não ocorreu** na data desta
  homologação. O cron foi instalado às 15:30 UTC de 20/08/2026, depois das 09:00
  UTC. A execução id 5 é uma simulação do ambiente do cron (`env -i`, `PATH`
  mínimo, `/bin/sh`), não uma disparada real do daemon. **Confirme em 21/08/2026:**

```sql
SELECT id, status, source, cost_rows, started_at
  FROM ovh_sync_runs WHERE source = 'cron' ORDER BY id DESC LIMIT 3;
```

  Uma linha com `started_at` próximo de 09:00 UTC e `source='cron'` fecha esse
  ponto. A ausência dela indica que o cron não disparou — e aí o log em
  `/opt/finops/ovh-collector/logs/cron.log` é o primeiro lugar a olhar.

---

## 5. Conferência de segredos — e como conferir sem vazar

Estado em 20/08/2026: **nenhum `.env` real, chave, dump ou segredo versionado.**
Rastreados apenas `infra/.env.example` e `scripts/ovh-collector/.env.example`,
os dois com placeholders. Os `.sql` rastreados são migrações e scripts de
inspeção — nenhum dump de dados.

### A varredura ingênua vaza o que procura

`grep -RIn "PG_PASSWORD" .` imprime a **linha inteira**, valor incluído. Rodar
isso num terminal que fica gravado — log de CI, transcript, captura de tela —
transforma a auditoria no próprio incidente. Aconteceu duas vezes nesta série de
entregas.

Duas regras, as duas fáceis de esquecer no calor da conferência:

1. **Procure nomes com contexto, valores só com contagem.** Ver o nome
   `PG_PASSWORD=` num arquivo é útil e inofensivo; ver o valor não acrescenta
   nada à conclusão.
2. **Restrinja ao que o git rastreia.** `grep -R` varre `.env.local`,
   `node_modules` e artefatos de build — arquivos que, por definição, não estão
   no repositório. `git grep` só olha o que é versionado, que é exatamente a
   pergunta.

```bash
# quantos ARQUIVOS RASTREADOS têm valor com cara de segredo -- sem imprimir nenhum
for P in 'PG_PASSWORD=[A-Za-z0-9+/]{16,}' '[0-9a-f]{32}' 'AKIA[0-9A-Z]{16}' '-----BEGIN'; do
  echo "$P -> $(git grep -cIE "$P" -- . 2>/dev/null | wc -l) arquivo(s)"
done

# e o que está para ser comitado
git diff --cached -U0 | grep -cE '^\+.*([0-9a-f]{32}|AKIA[0-9A-Z]{16})'

# quais .env o git conhece (só os .example devem aparecer)
git ls-files | grep -E '\.env'
```

Resultado esperado hoje — e o penúltimo item **não** é zero:

| Padrão | Esperado | Por quê |
|---|---|---|
| `PG_PASSWORD=<16+ chars>` | 0 | |
| `[0-9a-f]{32}` | 0 | pegaria chave OVH e hash de sessão |
| `AKIA[0-9A-Z]{16}` | **1** | `web/src/lib/diagnostico/etl.test.ts` |
| `-----BEGIN` | 0 | chave privada |

Aquele 1 é **fixture de teste**, não credencial: uma chave falsa em formato AKIA
alimentando `redigirErro()`, com o teste afirmando que a saída redigida **não** a
contém. É a prova de que a redação funciona.

Vale registrar porque é o tipo de achado que faz uma auditoria futura parar por
susto — e porque a alternativa (remover o fixture) enfraqueceria justamente o
teste que protege contra vazamento de credencial em mensagem de erro. A conclusão
correta ao encontrar um match não é "zero matches ou pânico": é abrir o arquivo e
decidir.

Os `.env` conhecidos pelo git devem ser exatamente dois, os dois `.example`.

### Se um valor escapar

Trate como vazado, mesmo que o arquivo não esteja versionado: rotacione. Um
segredo que apareceu em log não volta a ser segredo por ter sido apagado do log.
Para o `finops_user` a rotação tem **quatro consumidores** — ver a seção de
limitações do [README](../README.md).

---

## 6. Rollback, se algo aparecer depois

```bash
APP_IMAGE_TAG=pre-multicloud /opt/veri-finops/scripts/finops-app.sh rollback
/opt/veri-finops/scripts/finops-app.sh health
```

Volta ao binário de `ae42e22` **sem rebuild**. `finops-portal:pre-multicloud` é
uma tag durável criada à mão antes do deploy, e não a `:anterior` — ver a seção 7
do [RUNBOOK-app.md](RUNBOOK-app.md) para o motivo.

Backups em `/opt/backups/veri-finops/`, todos de 20/08/2026:

| Arquivo | Conteúdo |
|---|---|
| `env.before-multicloud.*.bak` | `/opt/finops/.env` (modo 600) |
| `docker-compose.producao.before-multicloud.*.bak` | `/opt/finops/docker-compose.yml` |
| `docker-compose.app.before-multicloud.*.bak` | compose do portal, versão anterior |
| `veri-finops-src.before-multicloud.*.tgz` | `/opt/veri-finops` antes da troca |
| `finops-app-ovh.before-multicloud.*.sql` | `pg_dump` de 8 tabelas de app/OVH — **nenhuma AWS** |

O dump **não** deve ser restaurado por reflexo: os dados OVH em produção são
reais e válidos. Ele existe para o caso de perda, não como parte do rollback do
portal — trocar a imagem do container não toca em nenhuma linha do banco.
