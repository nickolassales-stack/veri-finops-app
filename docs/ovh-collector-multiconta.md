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

**A primeira que devolver alguma conta ganha.** Não há mistura: se o banco tem
uma conta e o `.env` tem outra, só a do banco coleta.

Essa precedência é o ponto mais importante do desenho. Se o `.env` vencesse — ou
se as duas somassem — uma rotação feita pela tela seria **silenciosamente
ignorada** porque alguém esqueceu de limpar o arquivo. O sintoma seria a coleta
continuando a funcionar com a credencial antiga: parece certo e está errado, que
é o pior desfecho possível.

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

E quando cai no fallback, o aviso exigido aparece:

```
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
   (isso vem do onboarding, não da tela)
2. Como **ADMIN**, abra Configurações › Contas Cloud
3. No bloco *Credenciais OVH* da conta: endpoint, Application Key, Secret,
   Consumer Key
4. **Testar conexão** → **Salvar credenciais**
5. Colete só ela, para conferir sem esperar o cron:
   ```bash
   ./run-ovh-etl.sh manual --account <provider_account_id>
   ```

Detalhe completo do cadastro em [CONTAS-CLOUD.md](CONTAS-CLOUD.md).

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

## 10. Plano para descomissionar o fallback

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

## 11. Limitações conhecidas

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
   execuções legítimas pudessem se sobrepor no tempo.
