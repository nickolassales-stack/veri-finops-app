# Collector OVH — credenciais no banco e coleta multi-conta

O collector lia UMA conta, do `.env`. Agora descobre as contas em
`cloud_provider_credentials` — cadastradas pelo portal, cifradas — e sincroniza
cada uma isolada. O `.env` continua funcionando, como fallback.

| Seção |
|---|
| [1. Como as contas são descobertas](#1-como-as-contas-são-descobertas) · [2. Rodar uma conta](#2-rodar-uma-conta-específica) · [3. Rodar todas](#3-rodar-todas) · [4. Isolamento e código de saída](#4-isolamento-por-conta-e-código-de-saída) · [5. Fallback](#5-o-fallback) · [6. Adicionar conta pelo portal](#6-como-adicionar-uma-conta-nova-pelo-portal) · [7. Validar manual](#7-como-validar-uma-execução-manual) · [8. Validar cron](#8-como-validar-o-cron) · [9. Permissões e chave](#9-permissões-e-a-chave-de-cifragem) · [10. Descomissionar](#10-plano-para-descomissionar-o-fallback) · [11. Limitações](#11-limitações-conhecidas) |

---

## 1. Como as contas são descobertas

Três origens, nesta precedência ([contas_ovh.py](../scripts/ovh-collector/contas_ovh.py)):

| Ordem | Origem | Papel |
|---|---|---|
| 1 | `cloud_provider_credentials` (banco) | **principal** |
| 2 | `accounts.d/*.env` — um arquivo por conta | fallback |
| 3 | `.env` — arquivo único, uma conta | fallback |

**A decisão é POR CONTA, não por conjunto:**

- conta **com** credencial no banco → usa o banco, e o arquivo é **ignorado**;
- conta **sem** credencial no banco → usa `accounts.d`, senão o `.env`.

As duas metades dessa regra existem para impedir erros opostos, e vale entender
por que nenhuma delas pode ser afrouxada.

**O arquivo perde para o banco na mesma conta.** Se o arquivo vencesse, uma
rotação feita pela tela seria silenciosamente descartada porque alguém esqueceu de
limpar o `.env`, e a coleta continuaria funcionando com a credencial antiga —
parece certo e está errado.

**O banco não elimina as contas que só existem no arquivo.** Esta metade foi um
defeito corrigido depois. A primeira versão escolhia **uma** origem para todas as
contas, e o efeito era grave: cadastrar a primeira credencial pela tela fazia a
origem virar `banco` e **toda conta que existia só no `.env` saía da coleta** —
sem erro, sem aviso, com o run marcado `success`. Pior que uma falha, porque
falha aparece no diagnóstico e essa não aparecia em lugar nenhum.

### A guarda que o arquivo não tem

`SQL_CONTAS` exige `a.active`, mas **arquivo não sabe de `active`**. Sem uma
guarda, desativar uma conta pela tela e ainda ter a chave no `.env` faria a coleta
continuar — o oposto exato do que desativar significa.

Por isso `ids_ovh_inativos()` lê as contas OVH marcadas `active = false` e o
fallback pula quem estiver nessa lista:

```
aviso: ovh-antiga-ca: ignorada, conta desativada em cloud_accounts
```

Se essa consulta falhar, o conjunto volta vazio com aviso em vez de exceção: não
saber quais contas estão desativadas é motivo para coletar a mais, não para parar
tudo.

A consulta ao banco:

```sql
SELECT c.account_id, c.endpoint, c.status,
       c.application_key_encrypted, c.application_secret_encrypted,
       c.consumer_key_encrypted, a.account_name
  FROM cloud_provider_credentials c
  JOIN cloud_accounts a ON a.account_id = c.account_id
 WHERE c.provider = 'ovh' AND a.provider = 'ovh' AND a.active
 ORDER BY c.account_id
```

O `provider` é verificado **nas duas tabelas**. Redundante de propósito: a
migração 006 já impede provider diferente de `ovh` na credencial, mas uma conta
cujo provider mudou no cadastro deixaria de ser OVH sem que a credencial soubesse.

### Quais status coletam

| Status | Coleta? |
|---|---|
| `conectado` | sim |
| `nao_validado` | **sim** |
| `invalido` | não — pulada, com aviso no log |

`nao_validado` coletar é deliberado: credencial recém-cadastrada e nunca testada
tem de funcionar. Exigir `conectado` faria o cadastro pela tela não surtir efeito
até alguém clicar em *Testar conexão* — uma armadilha silenciosa.

`invalido` significa que a OVH **rejeitou** a credencial num teste — falha de rede
não marca inválido, disso o portal cuida. Tentar de novo a cada execução só
produziria ruído. Para reativar: reteste ou recadastre pela tela.

### A decifragem

AES-256-GCM, subchave derivada por HKDF-SHA256 da `APP_CREDENTIALS_ENCRYPTION_KEY`
— a **mesma** chave do portal. O AAD é `ovh:{account_id}:{campo}`, o que amarra
cada texto cifrado à sua linha: mover o `application_secret` da conta A para a
conta B faz a decifragem **falhar**, em vez de o collector autenticar em A
gravando como se fosse B.

O contrato entre as duas linguagens é verificado a cada execução dos testes:
`test_contas_ovh.py` traz envelopes **gerados pelo módulo TypeScript do portal**,
embutidos como constantes. Cifrar em Python para decifrar em Python provaria
apenas coerência interna; o que precisa ser verdade é que o Python abre o que o
Node fechou.

---

## 2. Rodar uma conta específica

```bash
cd /opt/finops/ovh-collector
./run-ovh-etl.sh manual --account ovh-main-ca
```

O id é o `provider_account_id`. Conta inexistente **falha com exit 2** e lista as
disponíveis — não sai com sucesso tendo coletado nada, que faria alguém concluir
que a conta está sem custo.

---

## 3. Rodar todas

```bash
./run-ovh-etl.sh manual --all      # a mão
./run-ovh-etl.sh cron --all        # o que o crontab chama
./run-ovh-etl.sh                   # equivalente: cron + todas
```

`--all` é o **padrão** quando nenhum escopo é passado. O padrão permissivo é
proposital: o cron em produção hoje chama `./run-ovh-etl.sh cron`, sem flag, e ele
não pode parar de coletar porque o código passou a esperar um argumento novo.

Para inspecionar sem gravar:

```bash
./run-ovh-etl.sh manual --all --dry-run
```

---

## 4. Isolamento por conta, e código de saída

Cada conta roda isolada: cliente OVH próprio, transação própria, **linha própria
em `ovh_sync_runs`** com o seu `provider_account_id` (coluna criada pela
[migração 007](../scripts/migrations/007-sync-runs-por-conta.sql)).

Uma conta que falha **não interrompe as demais**. A falha vira `failed` na linha
daquela conta, com `error_message` sanitizada, e o laço segue.

| Código | Significado |
|---|---|
| 0 | todas as contas com sucesso |
| 1 | a **única** conta processada falhou |
| 2 | configuração: `.env` ausente, PostgreSQL sem variáveis, nenhuma conta utilizável, ou `--account` inexistente |
| 3 | dependência Python ausente |
| 4 | a OVH recusou a autenticação *(caso de conta única)* |
| 5 | falha ao gravar no PostgreSQL *(caso de conta única)* |
| **6** | **falha parcial ou total com mais de uma conta** |

Os códigos 4 e 5 foram **preservados** para o caso de conta única porque o RUNBOOK
e quem opera dependem deles. Trocar tudo por 6 seria mais simples e quebraria a
leitura existente.

O resumo no fim do log é o sinal prático — o cron não lê código de saída:

```
--- resumo ---
contas processadas: 2  sucesso: 1  falhas: 1
totais: projetos=1 faturas=39 linhas_fatura=551 custos=512
contas que falharam: ovh-eu-01
```

Nenhum campo de credencial entra aí. `ContaOvh` sobrescreve `__repr__` e
`__str__` justamente porque a forma mais provável de vazar não é um log
deliberado — é o repr automático num traceback ou num f-string de depuração.

---

## 5. O fallback

### `accounts.d/` nunca existiu

Vale registrar, porque a especificação o mencionava como se existisse: **este
diretório nunca existiu neste repositório.** O fallback real, hoje em produção, é
o `.env` único com uma conta.

`accounts.d` está implementado e funciona se o diretório for criado — cada `*.env`
é uma conta, lidos em ordem alfabética —, mas não há nada para migrar dele. Na
prática ele nasce marcado para remoção.

### Como o fallback se anuncia

O log diz sempre de onde veio a credencial:

```
origem das credenciais: banco
contas a sincronizar (1): ovh-main-ca(ovh-ca,ovh-ca,via banco)
```

E quando cai no fallback, o aviso aparece **por conta**, com o id explícito:

```
aviso: Usando fallback legado para conta ovh-main-ca
aviso: Usando fallback accounts.d; migracao para credenciais no banco recomendada.
aviso: Usando fallback .env; migracao para credenciais no banco recomendada.
```

### Um arquivo não contamina o outro

Cada `.env` é lido por um parser próprio, **não** por `load_dotenv`. O motivo é
concreto: `load_dotenv` escreve em `os.environ`, e o segundo arquivo herdaria do
primeiro qualquer chave que faltasse nele — duas contas com a **mesma
credencial**, sem aviso. Além disso, nada aqui precisa chegar a variável de
ambiente: o valor vai direto para memória e morre com o processo.

---

## 6. Como adicionar uma conta nova pelo portal

1. A conta precisa existir em `cloud_accounts` com `provider = 'ovh'` e `active`
   (isso vem do onboarding, não da tela — a API de contas tem GET e PATCH, não POST)
2. Como **ADMIN**, abra Configurações › Contas Cloud
3. No bloco *Credenciais OVH* da conta: endpoint, Application Key, Secret,
   Consumer Key
4. **Salvar e executar primeira coleta** — salva, testa e enfileira, nessa ordem

O botão faz as três coisas porque a ordem importa. Enfileirar sem testar criaria um
job destinado a falhar, e a tela mostraria "coleta enfileirada" seguida de erro
alguns minutos depois; testar primeiro troca isso por um erro imediato, com a causa
em mãos. Salvar acontece de todo jeito: se a OVH estiver fora do ar, a credencial
fica gravada e só o disparo é recusado — perder o que foi digitado por causa de uma
indisponibilidade do provedor seria o pior desfecho.

Se preferir os passos separados: **Testar conexão** → **Salvar credenciais** →
**Testar conexão** de novo. O segundo teste não é redundante: salvar reseta o
status para `nao_validado` de propósito (credencial nova nunca foi testada), então
sem ele a tela fica dizendo "não validado" depois de um teste que passou.

A coleta é atendida pelo worker no minuto seguinte. Para não esperar:

```bash
./run-cloud-sync-jobs.sh                              # atende a fila agora
./run-ovh-etl.sh manual --account <provider_account_id>   # ignora a fila
```

Detalhe completo do cadastro em [CONTAS-CLOUD.md](CONTAS-CLOUD.md); a mecânica da
fila na seção 10.

---

## 7. Como validar uma execução manual

```bash
cd /opt/finops/ovh-collector
./run-ovh-etl.sh manual --all
echo "exit=$?"
```

No log, confira nesta ordem:

1. `chave de cifragem: presente (N chars)` — sem ela o banco é ignorado
2. `origem das credenciais: banco` — se disser `.env`, o banco não tem credencial
3. `contas a sincronizar (N): ...`
4. uma linha `gravado` por conta
5. `--- resumo ---` com `falhas: 0`

E no banco:

```sql
SELECT provider_account_id, status, source, started_at, finished_at,
       cost_rows, invoice_rows, error_message
  FROM ovh_sync_runs
 ORDER BY started_at DESC LIMIT 10;
```

Uma linha **por conta por execução**. `error_message` já vem sanitizada.

Confira também que o custo não regrediu:

```sql
SELECT provider_account_id, count(*) AS linhas, round(sum(amount),2) AS total
  FROM ovh_monthly_costs GROUP BY 1 ORDER BY 1;
```

## 8. Como validar o cron

O crontab passa a chamar `--all` explícito:

```
0 9 * * * cd /opt/finops/ovh-collector && ./run-ovh-etl.sh cron --all >> /opt/finops/ovh-collector/logs/cron.log 2>&1
```

**A linha antiga continua correta.** `./run-ovh-etl.sh cron`, sem flag, coleta
todas do mesmo jeito — o `--all` é legibilidade para quem lê o crontab. Não há
janela em que o cron pare por causa desta mudança, e por isso atualizá-lo não é
urgente.

Para validar depois do próximo disparo:

```bash
tail -80 /opt/finops/ovh-collector/logs/cron.log
docker exec finops-postgres psql -U finops_user -d finops -At -c \
  "SELECT provider_account_id, status, source, started_at FROM ovh_sync_runs \
    WHERE source='cron' ORDER BY started_at DESC LIMIT 5;"
```

---

## 9. Permissões e a chave de cifragem

O collector precisa de duas coisas novas:

**`APP_CREDENTIALS_ENCRYPTION_KEY`** — a mesma do portal. O wrapper a lê do
ambiente e, se não estiver lá, do `$DIR/.env`, com `sed` em vez de `source` (um
`source` traria todas as variáveis do arquivo para o shell, onde apareceriam no
`ps` de qualquer processo filho). O valor **nunca é ecoado** — só o tamanho.

Sem a chave o collector **não para**: avisa e cai no fallback.

> **Isto coloca a chave em dois lugares na EC2**: `/opt/finops/.env` (portal) e
> `/opt/finops/ovh-collector/.env` (collector). É uma duplicação real e vale
> decidir se compensa unificar num arquivo compartilhado — ambos em modo 600, mas
> duas cópias são duas chances de vazar, e uma rotação exige lembrar dos dois.

**Acesso ao banco** — o collector roda como `finops_user`, que é superusuário
hoje, então o `SELECT` em `cloud_provider_credentials` funciona sem grant. A
migração 006 concede o `SELECT` explicitamente de todo modo, para o dia em que
`finops_user` deixar de ser superusuário (pendência registrada no README §13).

O collector **nunca escreve** em `cloud_provider_credentials`. Quem escreve é o
portal, e só por ação de um ADMIN.

---

## 10. A fila `cloud_sync_jobs` e o worker

### Por que uma fila, e não uma chamada direta

O portal roda no container `finops-portal`. O collector roda no **host**, em
`/opt/finops/ovh-collector`, com venv próprio. O container não tem o filesystem do
host montado, não tem o venv e não tem o interpretador do collector — e dar-lhe
qualquer um dos três significaria montar diretório do host num processo que atende
requisição HTTP pública.

Executar shell a partir de rota HTTP é a alternativa que a fila existe para
evitar. Mesmo parametrizado com cuidado, transforma a tela de configuração em
superfície de execução de comando.

Então a tela **não executa nada**: ela insere uma linha. O worker no host, que já
tem tudo de que precisa, lê a linha e trabalha. A fronteira de confiança fica no
banco, que os dois lados já acessam de qualquer forma.

Isso aparece nos GRANTs da [migração 008](../scripts/migrations/008-cloud-sync-jobs.sql):
`finops_app` tem **SELECT e INSERT**, e não UPDATE. O portal enfileira e lê; quem
processa é o collector.

### Os três cadeados

Confundir os três leva a implementar um e achar que os outros estão resolvidos.

| # | Problema | Mecanismo | Onde |
|---|---|---|---|
| 1 | Duas execuções do **worker** ao mesmo tempo | `flock -n` | [run-cloud-sync-jobs.sh](../scripts/ovh-collector/run-cloud-sync-jobs.sh) |
| 2 | Dois **jobs** para a mesma conta na fila | índice único parcial | migração 008 |
| 3 | Worker e **coleta diária** na mesma conta | `pg_try_advisory_lock` | [jobs_ovh.py](../scripts/ovh-collector/jobs_ovh.py) |

**1 — `flock`.** O cron chama a cada minuto; um worker que demore 90 s encontraria
o próximo já subindo. `-n` desiste em vez de esperar (saída 75): uma fila de
workers esperando só adiaria o problema e consumiria memória de uma instância de
3,8 GiB que já roda Metabase. O `exec 9>` mantém o descritor aberto, então o lock
é liberado pelo kernel mesmo se o worker for morto com `SIGKILL` — um
arquivo-marcador ficaria preso para sempre nesse caso.

**2 — índice único parcial.** `cloud_sync_jobs_conta_ativa_uniq` cobre
`(provider, account_id) WHERE status IN ('queued','running')`. É o que faz o botão
ser seguro de clicar duas vezes. Deixar essa checagem para a aplicação seria
confiar em `SELECT` antes de `INSERT`, que é corrida perdida por definição: duas
requisições simultâneas leem "não existe" e as duas inserem. O banco é o único
lugar onde a verificação é atômica.

**3 — lock consultivo.** O índice **não** cobre a coleta das 09:00, que não passa
por job nenhum. Os dois caminhos tomam `pg_try_advisory_lock(hashtext('ovh-sync:' || conta))`.
Quem chegar depois pula:

```
ovh-main-ca: pulada, ja esta sendo coletada por outro processo
```

**Pular não conta como falha** — a coleta está acontecendo, só não naquele
processo. Contar como falha faria o cron alarmar por causa de uma coleta
bem-sucedida. O resumo separa as duas coisas:

```
contas processadas: 1  sucesso: 1  falhas: 0  puladas (em coleta): 1
```

`try` e não a versão bloqueante: se a conta está sendo coletada agora, a resposta
certa é desistir e tentar no próximo ciclo, não empilhar processos.

### O ciclo de vida de um job

```
        portal (botão)                worker (cron, 1 min)
             │                                │
     INSERT status='queued'                   │
             │                                │
             │        ┌──── reivindicar: UPDATE ... FOR UPDATE SKIP LOCKED
             │        │      status='running', attempts+1
             │        │
             │        ├──── pg_try_advisory_lock  ──não obteve──> volta a 'queued'
             │        │
             │        ├──── descobrir credencial + sincronizar_conta()
             │        │           │
             │        │           └──> grava em ovh_sync_runs (linha própria)
             │        │
             │        └──── concluir: status='success'|'failed', sync_run_id
```

`FOR UPDATE SKIP LOCKED` é o que permite dois workers sem coordenação externa: o
segundo pula a linha que o primeiro travou. Sem `SKIP LOCKED` eles serializariam e
o segundo processaria o **mesmo** job depois do commit do primeiro — coleta
duplicada, não concorrência.

### Jobs órfãos

Se o worker morre no meio, o job fica `running` para sempre — e aí o cadeado nº 2
trabalha contra nós: um job preso impede **qualquer** novo job daquela conta, e o
botão no portal passa a recusar coleta sem explicação.

`reabrir_orfaos()` roda a cada execução do worker e devolve para a fila o que está
`running` há mais de 30 minutos. Job que já gastou `MAX_TENTATIVAS` (3) vira
`failed` em vez de voltar — sem limite, voltaria para sempre.

Os 30 minutos são folgados de propósito: a coleta mais lenta observada é de ~70 s,
e matar um job que apenas está demorando produziria coleta duplicada, que é pior
do que esperar.

### Processar a fila à mão

```bash
cd /opt/finops/ovh-collector

# enfileirar sem passar pelo portal
venv/bin/python processar_jobs.py --enfileirar ovh-main-ca

# processar (o mesmo que o cron faz)
./run-cloud-sync-jobs.sh

# processar mais de um por vez
venv/bin/python processar_jobs.py --max 5
```

Códigos de saída: `0` nada na fila ou tudo bem · `2` configuração ou migração 008
ausente · `3` dependência · `6` algum job falhou · `75` outro worker rodando.

### Validar `cloud_sync_jobs`

```sql
SELECT id, account_id, action, status, attempts,
       requested_at, finished_at, sync_run_id,
       left(coalesce(error_message,''), 60) AS erro
  FROM cloud_sync_jobs
 ORDER BY requested_at DESC
 LIMIT 10;
```

O que olhar:

- job em `queued` por mais de dois minutos → o cron do worker não está instalado;
- `attempts` crescendo sem sair de `queued` → a conta está sempre travada, ou o
  worker morre sempre no mesmo ponto;
- `sync_run_id` nulo num job `success` → não deveria acontecer; indica que
  `sincronizar_conta` não registrou execução (banco fora do ar no `abrir()`);
- `error_message` **sempre** sanitizado. Se aparecer algo que se pareça com
  credencial ali, é bug: reporte, não edite a linha.

### Sem a migração 008

Nada quebra. O worker sai com código 2 e a mensagem `fila ausente` — de propósito,
e não com traceback: a cada minuto, traceback encheria o log e esconderia problema
de verdade. No portal, o botão recusa com mensagem própria e **salvar credencial
continua funcionando** — a fila é conveniência, e a ausência dela não pode impedir
o cadastro.

---

## 11. Plano para descomissionar o fallback

O fallback **não sai nesta release**, por decisão explícita. A ordem sugerida:

| Etapa | O que fazer | Como confirmar |
|---|---|---|
| 1 | Aplicar as migrações 006 e 007 | `\d cloud_provider_credentials` e `\d ovh_sync_runs` |
| 2 | Definir `APP_CREDENTIALS_ENCRYPTION_KEY` no portal e no collector | log do wrapper diz `presente` |
| 3 | Cadastrar a credencial da conta atual pelo portal | *Testar conexão* → **Conectado** |
| 4 | Rodar `--account` da conta e conferir | `origem das credenciais: banco` |
| 5 | Deixar rodando **alguns dias** com o `.env` ainda no lugar | nenhuma execução com `origem: .env` |
| 6 | Só então remover as chaves `OVH_*` do `.env` | a coleta continua; origem segue `banco` |
| 7 | Remover o código de fallback | release posterior |

A etapa 5 é a que costuma ser cortada e a que mais protege: enquanto o `.env`
existe, o banco vence, mas há para onde voltar sem editar arquivo nenhum às
pressas. Só depois de o log provar que ninguém está usando o fallback é que faz
sentido apagá-lo.

**O `.env` continua obrigatório mesmo na etapa 6** — dele saem `PG_USER` e
`PG_PASSWORD`. Sem banco não há como nem *ler* as credenciais cifradas. O que sai
são apenas as chaves `OVH_*`.

---

## 12. Limitações conhecidas

1. **O painel do portal ainda lê a "última execução" sem agregar por conta.** Com
   várias contas, a última pode ser a falha de uma enquanto as outras foram bem, e
   o card *Status do collector* vai dizer que a coleta falhou. Está correto no
   sentido de "algo está errado", mas não diz o quê. Ajustar as telas para
   agregar por conta é trabalho separado.
2. **`MESES_FATURA` é global**, não por conta. Todas as contas coletam a mesma
   janela de faturas.
3. **Contas em sequência, não em paralelo.** Com poucas contas é irrelevante; com
   dezenas, a execução vira soma das latências da API da OVH.
4. **A chave de cifragem vive em dois arquivos** na EC2 — ver §9.
5. **`--dry-run` não abre `Execucao`**, então não registra nada em
   `ovh_sync_runs`. É o comportamento certo, mas significa que um dry-run não
   deixa rastro de ter acontecido.
6. **`--fechar-orfas` não distingue conta.** Ele encerra toda execução `running`
   antiga, de qualquer conta — o que é o desejado hoje, e ficaria errado se duas
   execuções legítimas pudessem se sobrepor no tempo. Note que ele agora *pode*
   se sobrepor: o worker de fila e a coleta diária são processos distintos, e o
   `--fechar-orfas` do wrapper roda antes da coleta diária. A janela de 180 min
   dele é larga o suficiente para não alcançar um job em andamento, mas isso é
   coincidência de folga, não garantia — se a coleta ficar mais lenta, revisitar.
7. **Não há cancelamento de job.** A rota de fila expõe POST e GET, não DELETE:
   marcar `cancelled` daria a impressão de interromper uma coleta que segue
   correndo no host, porque o worker não verifica o status entre etapas. Um
   cancelamento honesto exige essa verificação, que não está implementada.
8. **A tela não atualiza sozinha.** O status do job é lido no clique de
   *Atualizar status*. Polling automático foi deixado de fora de propósito: uma
   tela de configuração aberta e esquecida geraria requisição indefinidamente
   contra um banco compartilhado com o Metabase.
9. **`attempts` não distingue causa.** Um job devolvido à fila por conta travada
   e um devolvido por worker morto contam do mesmo jeito para `MAX_TENTATIVAS`.
   Na prática o primeiro caso resolve no ciclo seguinte, mas três colisões
   seguidas marcariam `failed` um job que nunca chegou a tentar coletar.
