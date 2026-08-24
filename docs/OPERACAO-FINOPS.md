# Operação VERI FinOps — o fluxo completo

Um mapa de ponta a ponta depois das automações OVH. Cada seção diz **o que fazer**,
**onde**, e **o que dá errado se pular**.

> Estado em **24/08/2026**, commit `a607661`. Dois provedores no ar: AWS por
> pipeline Athena, OVH por collector com credenciais cifradas no banco.

| | |
|---|---|
| [1. Contas Cloud](#1-contas-cloud) · [2. Adicionar AWS](#2-adicionar-uma-conta-aws) · [3. Adicionar OVH](#3-adicionar-uma-conta-ovh) · [4. Credenciais](#4-credenciais-cifradas) · [5. Coleta manual](#5-coleta-manual) · [6. Coleta por cron](#6-coleta-por-cron) · [7. Diagnóstico](#7-diagnóstico) · [8. Analítico](#8-analítico-aws-e-ovh) · [9. Fallback legado](#9-fallback-legado-accountsd) · [10. Segurança](#10-checklist-de-segurança) · [11. Backups e rollback](#11-backups-e-rollback) · [12. Hardening pendente](#12-hardening-externo-pendente) | |

---

## 1. Contas Cloud

`/dashboard/configuracoes/contas` — **ADMIN**.

Lista todas as contas de `cloud_accounts`, de qualquer provedor, com selo. Para
qualquer uma: alias, unidade de negócio, centro de custo, ambiente. Contas com
`provider = 'ovh'` ganham também o bloco **Credenciais OVH**.

**A tela não cria conta.** A API tem `GET` e `PATCH`, sem `POST`, e `provider` e
`account_id` não são editáveis — trocar o `account_id` de uma conta com custo
histórico reassociaria dados de outra conta.

Como cada provedor entra no cadastro: §2 e §3.

---

## 2. Adicionar uma conta AWS

**Não há chave AWS para cadastrar.** O ETL roda na EC2 e autentica pelo IAM role
da instância — não existe segredo AWS armazenado no portal, e não deve passar a
existir.

O fluxo é de infraestrutura, não de tela:

1. Na conta AWS nova, criar um **Data Export (CUR 2.0)** apontando para o bucket
   central, com o prefixo esperado
2. Rodar [`scripts/onboard-cur-account.sh`](../scripts/onboard-cur-account.sh) —
   ele registra a conta e prepara a partição
3. Aguardar Glue/Athena/ETL importarem (próxima janela das 08:00 UTC)
4. A conta **aparece sozinha** no portal quando houver linha no banco
5. Só então ajustar alias e metadados na tela

Detalhe completo em [onboard-nova-conta.md](onboard-nova-conta.md).

---

## 3. Adicionar uma conta OVH

Quatro passos, e o passo 0 é o que costuma faltar.

**0. A linha em `cloud_accounts`** — hoje só por SQL:

```sql
INSERT INTO cloud_accounts
  (account_id, account_name, provider, business_unit, cost_center, environment, active)
VALUES ('ovh-<nome>-ca', '<nome amigável>', 'ovh', '<BU>', '<CC>', '<ambiente>', true);
```

`provider = 'ovh'` **não é detalhe**: as consultas AWS usam
`coalesce(provider,'aws') = 'aws'`, então uma conta OVH com `provider` nulo é
tratada como AWS e aparece nos filtros errados.

**1. Criar o token** no console da OVH da região certa — `eu`, `ca` e `us` são
**contas separadas**, e uma credencial de uma região devolve 403 na outra.

**2. Cadastrar** em Configurações › Contas Cloud, bloco Credenciais OVH.

**3. Salvar e executar primeira coleta** — salva, testa e enfileira, nessa ordem.

Detalhe em [CONTAS-CLOUD.md](CONTAS-CLOUD.md) §3 e §3.5.

---

## 4. Credenciais cifradas

**AES-256-GCM**, chave derivada por HKDF-SHA256 de `APP_CREDENTIALS_ENCRYPTION_KEY`.
O AAD amarra cada valor à conta **e** ao campo: sem ele, mover o
`application_secret` da conta A para a B no banco funcionaria, e o collector
autenticaria na A gravando como se fosse da B.

Cifrado, e não hash, porque o collector precisa **usar** o segredo. Hash serve
para verificar; cifra serve para usar.

**A chave não está no banco.** Um `pg_dump` sozinho não entrega credencial
nenhuma — e, pelo mesmo motivo, perder a chave torna ilegível tudo o que já foi
gravado, sem recuperação.

Ela vive em **dois** arquivos, que precisam ser idênticos:

```
/opt/finops/.env                  → portal, via compose
/opt/finops/ovh-collector/.env    → collector, via run-ovh-etl.sh
```

O que **nunca** volta ao frontend: `application_secret` em qualquer forma, nem
mascarado; `application_key` e `consumer_key` só como `****abcd`; fingerprints
nunca (dariam um oráculo para testar se uma credencial que alguém já tem é a
cadastrada).

Rotação em [CONTAS-CLOUD.md](CONTAS-CLOUD.md) §8 e §9.

---

## 5. Coleta manual

Três caminhos, com propósitos diferentes:

| Onde | Como | Quando |
|---|---|---|
| Contas Cloud | **Salvar e executar primeira coleta** | acabou de cadastrar a credencial |
| Diagnóstico | **Executar coleta OVH agora** | investigando: número não bateu, coleta de ontem falhou |
| EC2 | `./run-ovh-etl.sh manual --all` | worker parado, ou quer o log na hora |

Os dois botões **não executam nada**: gravam uma linha em `cloud_sync_jobs`. O
worker no host processa. O container do portal não alcança o venv do collector, e
executar shell a partir de rota HTTP transformaria a tela em superfície de
execução de comando.

**Consequência: a coleta não é instantânea.** A tela diz *enfileirada*, nunca
*executada*.

```bash
cd /opt/finops/ovh-collector
./run-cloud-sync-jobs.sh                       # atende a fila agora
./run-ovh-etl.sh manual --account ovh-main-ca  # ignora a fila, log na hora
```

---

## 6. Coleta por cron

```cron
0 8 * * *  /opt/finops/run-etl-with-status.sh                        # ETL AWS
0 9 * * *  cd /opt/finops/ovh-collector && ./run-ovh-etl.sh cron     # collector OVH
* * * * *  cd /opt/finops/ovh-collector && ./run-cloud-sync-jobs.sh  # worker da fila
```

> **A terceira linha não está instalada.** Sem ela os botões enfileiram e nada
> processa. Procedimento com backup em
> [`cron-ovh.exemplo`](../scripts/ovh-collector/cron-ovh.exemplo).

O OVH roda **uma hora depois** do AWS de propósito: os dois usam o mesmo
PostgreSQL numa instância de 3,8 GiB que também roda Metabase.

**Os três não colidem.** O worker e a coleta diária tomam
`pg_try_advisory_lock` na mesma chave por conta; quem chegar depois pula e
registra. Pular não é falha — a coleta está acontecendo, só não naquele processo.

Códigos de saída: `0` ok · `1` conta única falhou · `2` config · `3` dependência ·
`4` OVH recusou · `5` banco recusou · `6` falha parcial · `75` outro worker rodando.

---

## 7. Diagnóstico

`/dashboard/diagnostico` — `diagnostics:view`.

Mostra ETL AWS e collector OVH em blocos separados: são pipelines independentes, e
um quadro único obrigaria a inventar uma situação combinada.

No bloco OVH, desde `24/08/2026`:

- **Origem das credenciais** — uma linha por conta ativa dizendo se a credencial
  vem do banco (cifrada) ou do fallback legado;
- **alerta de atenção** se alguma conta ainda depende do fallback;
- **alerta crítico** se alguma credencial está marcada `invalido` — essas contas
  são **puladas** pelo collector, então não aparecem como falha no histórico e uma
  conta parada fica indistinguível de uma conta sem custo;
- **Executar coleta OVH agora** — só ADMIN.

O portal **não lê o `.env`** do servidor. "Fallback legado" significa: a conta está
ativa e não tem credencial cadastrada — o collector usa o arquivo, ou não coleta.

---

## 8. Analítico AWS e OVH

`/dashboard/analitico` — `analytic:view`. `?provider=ovh` troca a visão.

O grão é diferente: AWS por **dia** de uso, OVH por **mês** de competência. Por
isso o seletor não carrega os filtros de uma visão para a outra.

AWS tem 2 abas; OVH tem 4 (serviço/categoria, projeto, fatura, custo mensal).

**Origens nunca são somadas**: `invoice`, `usage_current` e `usage_forecast`
respondem perguntas diferentes, e somá-las contaria o mesmo custo até três vezes.

Exportar exige `analytic:export`. Arquivos indicam o provedor:
`veri-finops-aws-…` e `veri-finops-ovh-…`.

Detalhe em [analitico-ovh.md](analitico-ovh.md).

---

## 9. Fallback legado (`accounts.d`)

**Status em 24/08/2026: INATIVO.** Nenhuma conta depende dele.

| | |
|---|---|
| Introduzido | migração 006 + `c608b92` (21/08/2026), como transição |
| Semântica atual | por conta, desde `b5f5859` (24/08/2026) |
| Contas usando hoje | **nenhuma** — `ovh-main-ca` usa o banco, status `conectado` |
| `accounts.d/` | **nunca existiu** neste repositório nem em produção |
| Pendente | `OVH_*` ainda presentes em `/opt/finops/ovh-collector/.env` |

O fallback é **por conta**: conta com credencial no banco usa o banco e ignora o
arquivo; conta sem credencial cai no legado. As duas metades importam — se o
arquivo vencesse, uma rotação pela tela seria descartada; se o banco eliminasse as
demais, cadastrar a primeira credencial tiraria as outras da coleta em silêncio.

### Checklist para descomissionar

Só execute com o Diagnóstico dizendo **"Fallback legado inativo"**.

- [ ] **1.** Diagnóstico › OVH Collector → confirmar que nenhuma conta aparece
      como `fallback legado`
- [ ] **2.** Confirmar no banco:
      ```sql
      SELECT a.account_id, (c.account_id IS NOT NULL) AS tem_credencial
        FROM cloud_accounts a
        LEFT JOIN cloud_provider_credentials c
               ON c.account_id = a.account_id AND c.provider = 'ovh'
       WHERE a.provider = 'ovh' AND a.active;
      ```
      Todas precisam ter `tem_credencial = t`
- [ ] **3.** Deixar rodar **pelo menos 3 dias** com o log provando origem `banco`
      em toda execução — `grep "origem das credenciais" logs/cron.log`
- [ ] **4.** Backup do `.env` antes de mexer:
      `cp -p .env /opt/backups/veri-finops/collector-env.pre-descomissionamento.$(date +%F).bak`
- [ ] **5.** Remover **apenas** `OVH_ENDPOINT`, `OVH_APPLICATION_KEY`,
      `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`, `OVH_ACCOUNT_ALIAS`,
      `OVH_PROVIDER_ACCOUNT_ID` de `/opt/finops/ovh-collector/.env`.
      **Não remover** `PG_*` nem `APP_CREDENTIALS_ENCRYPTION_KEY` — é delas que
      sai a conexão e a decifragem
- [ ] **6.** `./run-ovh-etl.sh manual --all` → log deve dizer `origem: banco` e
      **não** deve haver aviso de fallback
- [ ] **7.** Aguardar uma execução do cron das 09:00 com sucesso
- [ ] **8.** Só então remover o código do fallback (`carregar_de_accounts_d`,
      `carregar_de_env_unico` e os testes correspondentes)

O passo 3 é o que costuma ser cortado, e é o que impede de descobrir a dependência
com a coleta já quebrada.

---

## 10. Checklist de segurança

Verificado em **24/08/2026** contra produção. Evidência ao lado.

| # | Item | Estado |
|---|---|---|
| 1 | Credenciais cifradas no banco, nunca em claro | ✅ AES-256-GCM + AAD |
| 2 | Chave de cifragem fora do banco | ✅ só no `.env`, modo 600 |
| 3 | `application_secret` nunca volta ao frontend | ✅ nem mascarado |
| 4 | Fingerprints não expostos na API | ✅ ficam no banco |
| 5 | `raw_json` não vai ao frontend nem ao export | ✅ contém `password` do PDF da fatura |
| 6 | Nome de campo de credencial em log | ✅ **0** ocorrências |
| 7 | **Valor real** das chaves em log | ✅ **0** ocorrências (busca literal) |
| 8 | `OVH-Query-ID` mascarado | ✅ sai como `<hex32>` |
| 9 | `error_message` sanitizado no banco | ✅ verificado em `ovh_sync_runs` |
| 10 | Rotas de credencial só ADMIN | ✅ `rotaSomenteAdmin`, com teste |
| 11 | Rota de coleta só ADMIN | ✅ não é `diagnostics:view` |
| 12 | VIEWER não executa coleta | ✅ 403 na rota; botão nem renderiza |
| 13 | Coleta recusa conta AWS | ✅ `motivoRecusaDeProvider` |
| 14 | Export exige `analytic:export` | ✅ separado de `analytic:view` |
| 15 | Export AWS não inclui OVH e vice-versa | ✅ separação estrutural, com teste |
| 16 | Queries parametrizadas | ✅ `ConstrutorParams` |
| 17 | Zod em toda entrada | ✅ inclusive união discriminada no escopo |
| 18 | PostgreSQL sem exposição pública | ✅ `127.0.0.1:5432` |
| 19 | Metabase na porta 3000 pública | ❌ **aberto** — §12 |

O item 7 é o teste forte: procurei os **valores literais** das três chaves da OVH
em todos os logs do collector e do ETL. Zero ocorrências. Procurar só o nome do
campo não provaria nada — um log poderia imprimir o valor sem o rótulo.

---

## 11. Backups e rollback

**Antes de todo deploy**, em `/opt/backups/veri-finops/`:

- `.env` do portal e do collector (modo 600)
- compose de produção e o complementar do app
- commit e id da imagem em execução
- `pg_dump` das tabelas afetadas
- tag Docker durável: `finops-portal:pre-<recurso>`

**Rollback do portal:**
```bash
APP_IMAGE_TAG=pre-analitico-ovh /opt/veri-finops/scripts/finops-app.sh rollback
```

`:anterior` aponta para a imagem imediatamente anterior — **dois deploys seguidos
apagam o alvo do primeiro**. Daí as tags duráveis por recurso.

**Rollback de schema**: `009` → `008` → `007` → `006`, nessa ordem, com os
arquivos `*-rollback.sql` em `/opt/finops/`.

> **Risco aberto:** os backups ficam **no mesmo disco** que o banco que eles
> protegem. Perder a instância perde os dois — inclusive a chave de cifragem, sem
> a qual as credenciais viram lixo. Uma cópia fora da EC2 resolve.

---

## 12. Hardening externo pendente

### A porta 3000 do Metabase está pública

```
finops-metabase   0.0.0.0:3000->3000/tcp
```

O Metabase responde na internet, direto, sem passar pelo proxy. Ele tem
autenticação própria, então não é acesso anônimo aos dados — mas é uma superfície
exposta a mais, com sessão e formulário de login alcançáveis por qualquer origem.

Agrava: `MB_ENCRYPTION_SECRET_KEY` **não está definida**, então as credenciais de
conexão que o Metabase guarda ficam em claro na base interna dele.

Compare com o Postgres, publicado apenas em `127.0.0.1:5432`. O Metabase é a
exceção, não a regra.

### Opções, da menos para a mais invasiva

| # | Opção | Efeito | Custo |
|---|---|---|---|
| 1 | **Access List no NPM** | Metabase atrás do proxy, com IP allow-list e TLS | precisa de subdomínio + certificado |
| 2 | **Publicar só em `127.0.0.1`** | fecha a porta; acesso por túnel SSH | quem usa Metabase passa a precisar de túnel |
| 3 | **Security Group** | fecha na borda da AWS | fora do compose; afeta a instância inteira |

Recomendação: **1 seguido de 2** — expor pelo NPM com Access List, confirmar que
os usuários alcançam, e só então trocar o bind para `127.0.0.1`. Fazer 2 primeiro
derruba o acesso de quem usa hoje.

Túnel, se optar por 2:
```bash
ssh -L 3000:127.0.0.1:3000 ubuntu@<ec2>
```

> **Nenhuma mudança de Security Group foi aplicada**, e nenhuma deve ser sem
> autorização explícita: um SG errado derruba o acesso à instância inteira,
> inclusive o SSH que seria usado para desfazer.

### Também pendente

- `MB_ENCRYPTION_SECRET_KEY` não definida
- backup dos dados do NPM (certificados e regras de proxy) não existe
- porta 81 (admin do NPM) publicada em `127.0.0.1` — correto, mas sem 2FA
- rotação de `finops_user` (superusuário, quatro consumidores)
- `pg_hba` concede superusuário sem senha dentro do container, o que torna
  qualquer teste de senha feito lá dentro um falso positivo
