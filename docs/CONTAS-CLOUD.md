# Contas Cloud — cadastro e credenciais de provedor

A tela **Configurações › Contas Cloud** (`/dashboard/configuracoes/contas`) é
**segmentada por provedor**: uma visão AWS e uma visão OVH, escolhidas por
`?provider=`, com listas, ações e textos próprios. Contas OVH são cadastradas
aqui, com **credenciais de API cifradas no banco**; contas AWS chegam pelo
pipeline de custo e só têm metadados a editar.

| Seção | |
|---|---|
| [1. O que a tela faz](#1-o-que-a-tela-faz) · [2. AWS não tem credencial](#2-por-que-contas-aws-não-têm-bloco-de-credenciais) · [3. Cadastrar uma conta OVH](#3-como-cadastrar-uma-conta-ovh) · [3.5. A primeira coleta](#35-a-primeira-coleta-pela-tela) · [4. Cifrado, não hash](#4-por-que-cifrado-e-não-hash) · [5. Como a cifragem funciona](#5-como-a-cifragem-funciona) · [6. RBAC](#6-quem-pode-o-quê) · [7. Testar conexão](#7-como-testar-a-conexão) · [8. Rotacionar](#8-como-rotacionar-uma-credencial) · [9. Rotacionar a chave de cifragem](#9-como-rotacionar-a-chave-de-cifragem) · [10. O collector](#10-como-o-collector-passa-a-consumir-credenciais-do-banco) · [11. Endpoints da API](#11-endpoints-da-api) · [12. Limitações](#12-limitações-conhecidas) | |

---

## 1. O que a tela faz

A tela é **segmentada por provedor**. `?provider=ovh` mostra a OVH; qualquer
outro valor — inclusive nenhum — mostra a AWS.

| | `/contas` ou `?provider=aws` | `?provider=ovh` |
|---|---|---|
| Lista | só `provider != 'ovh'` | só `provider = 'ovh'` |
| Como a conta chega | Data Export/CUR → S3 → Glue → Athena → ETL | cadastrada nesta tela |
| Identificador | 12 dígitos emitidos pela AWS | etiqueta escolhida por nós (`ovh-cliente-ca`) |
| Credencial | nenhuma — IAM role da instância | chave de API cifrada no banco |
| Botão de adicionar | abre o **procedimento** (§1.2) | abre o **formulário** (§3) |
| Colunas extras | fechamento, pagamento | endpoint, status da credencial, última validação |

**Antes era uma lista só, com os dois provedores juntos.** Ela funcionava e era
ilegível: metade dos cartões trazia bloco de credencial e metade não, sem que a
diferença aparecesse em lugar nenhum, e não havia caminho para adicionar conta.
Quem procurava onde colar a chave da AWS concluía que faltava um campo — quando a
resposta é que ele não existe.

Para qualquer provedor a tela edita **alias**, **unidade de negócio**, **centro de
custo** e **ambiente**. Fechamento de fatura e situação de pagamento **continuam em
Faturamento**, atrás de `billing:manage`: deixar o campo editável nas duas telas
significaria que `settings:accounts` altera dado de faturamento sem ter a
permissão que o protege.

### 1.1. O filtro é do servidor

`?provider=` viaja na requisição e a rota filtra antes de responder. Filtrar só na
tela mandaria a lista OVH inteira — com a situação de cada credencial — para quem
abriu a visão AWS: a separação seria cosmética, e o dado do outro provedor estaria
no payload, visível em qualquer aba de rede.

Os **totais dos cartões** do topo, ao contrário, são calculados sobre todas as
contas. Trocar de visão não pode zerar o cartão do outro provedor — o número
pareceria ter caído a zero.

### 1.2. Pendência técnica: o ETL não cadastra contas AWS

**Verificado no código, e é uma lacuna real.** `scripts/etl/athena_to_postgres.py`
não menciona `cloud_accounts` — ele escreve em `aws_monthly_costs` e
`aws_daily_costs` e mais nada. O próprio `scripts/onboard-cur-account.sh` diz isso
na saída:

> cadastrar a conta no PostgreSQL, senão ela aparece sem alias no dashboard
> (o ETL não cadastra contas; a aplicação faz LEFT JOIN em cloud_accounts)

…e imprime um `INSERT INTO cloud_accounts` para um humano executar (passo 8 do
procedimento). **Não há auto-discovery.**

A consequência é silenciosa e cara: se ninguém rodar o `INSERT`, o custo da conta
nova entra nos totais do painel, mas a conta **não aparece** em Contas Cloud, em
Faturamento nem nos filtros. O número sobe e não há conta a que atribuí-lo.

**O que foi feito, e o que não foi.** A tela agora **detecta** a divergência —
contas com linha em `aws_daily_costs` e sem linha em `cloud_accounts` — e mostra
um aviso na visão AWS nomeando os ids. Ela **não** insere sozinha: adivinhar o
alias e o provedor de uma conta que ninguém cadastrou é justamente o tipo de
palpite que produz registro errado difícil de rastrear depois.

Fechar a lacuna de verdade exige uma decisão que não é da tela: se o ETL deve
criar a conta com `account_name = account_id` e deixar o alias em branco, ou se o
cadastro deve continuar sendo um ato deliberado. Enquanto isso não for decidido, o
passo manual continua — mas deixou de ser invisível.

## 2. Por que contas AWS não têm bloco de credenciais

Não é omissão nem "fica para depois". A AWS autentica pelo **IAM role da
instância** — o ETL roda na EC2 e assume o papel sem nenhum segredo armazenado.
Não existe credencial AWS para guardar.

Colocar `'aws'` na lista de providers aceitos pela tabela seria pior que inútil:
convidaria alguém a colar uma access key de usuário IAM no formulário, trocando
um mecanismo sem segredo por um com segredo. O CHECK da migração recusa:

```sql
CONSTRAINT cloud_provider_credentials_provider_check CHECK (provider IN ('ovh'))
```

E o servidor recusa antes disso, com mensagem que diz **qual** provider
encontrou — ver `motivoRecusaDeProvider` em
[web/src/lib/credenciais/plano.ts](../web/src/lib/credenciais/plano.ts).

---

## 3. Como cadastrar uma conta OVH

**Pré-requisitos:** ser **ADMIN**; a migração 006 aplicada;
`APP_CREDENTIALS_ENCRYPTION_KEY` definida no ambiente do portal.

A conta **não precisa existir antes** — o formulário cria conta e credencial no
mesmo envio. Cadastrar a credencial de uma conta que já existe continua sendo o
caminho do botão **Credenciais** no cartão dela (§3.3).

### 3.1 Criar a credencial no console da OVH

O link certo depende da região, e **as três regiões são contas separadas**:

| Endpoint | Onde criar |
|---|---|
| `ovh-eu` | https://eu.api.ovh.com/createToken/ |
| `ovh-ca` | https://ca.api.ovh.com/createToken/ |
| `ovh-us` | https://api.us.ovhcloud.com/createToken/ |

Direitos mínimos para o que o portal e o collector fazem:

```
GET /me
GET /me/bill
GET /me/bill/*
GET /cloud/project
GET /cloud/project/*
```

`GET /me` é o que o botão **Testar conexão** usa. Sem ele o teste retorna 403
mesmo com a credencial correta — e a mensagem na tela diz exatamente isso, em vez
de acusar a credencial.

A OVH devolve os três valores **uma única vez**. O Application Secret não é
recuperável depois.

### 3.2 Conta nova: o formulário

1. Abra **Configurações › Contas Cloud** e vá para **Visão OVH**
2. **Adicionar conta OVH**
3. **Provider Account ID** — a etiqueta que amarra credencial, coleta e custo
   (`ovh-cliente-ca`). Ela **não muda depois**: é a chave de `cloud_accounts`.
4. **Alias** e, opcionalmente, unidade de negócio, centro de custo e ambiente
5. **Endpoint** da região onde a credencial foi criada
6. As três chaves — ou **nenhuma**, para cadastrar a conta agora e colar as
   chaves depois. Ela aparece na lista como *Credenciais não configuradas*.
7. **Testar conexão** — funciona antes de salvar, e não grava nada
8. **Salvar**, ou **Salvar e executar primeira coleta**

Os três botões fazem coisas diferentes. Testar bate um `GET /me` na OVH e volta;
descobrir que a chave está errada *depois* de gravar deixaria uma credencial
inválida no banco e um cadastro que ninguém quis.

### 3.3 Conta que já existe: o botão Credenciais

No cartão da conta, **Credenciais** abre o bloco de rotação — endpoint, os três
campos e o status. Campo de segredo em branco significa **manter o que está
gravado**; é o que permite trocar só o endpoint sem redigitar as chaves.

Salvar e testar são independentes de propósito. Salvar funciona com a API da OVH
fora do ar; testar funciona sem ter salvo. Amarrar os dois faria uma
indisponibilidade do provedor impedir o cadastro.

Depois de salvar, o status volta para **Não configurado** — credencial nova nunca
foi testada, e manter "Conectado" da anterior faria a tela afirmar algo que
ninguém verificou.

---

## 3.5. A primeira coleta, pela tela

**Salvar e executar primeira coleta** faz três coisas, nesta ordem: grava a
credencial, testa contra a OVH e enfileira a coleta.

A ordem é o desenho. Enfileirar sem testar criaria um job destinado a falhar, e a
tela mostraria "coleta enfileirada" seguida de erro alguns minutos depois — testar
primeiro troca isso por um erro imediato, com a causa em mãos. E salvar acontece de
todo jeito: se a OVH estiver fora do ar, a credencial fica gravada e só o disparo é
recusado. Perder o que foi digitado por causa de uma indisponibilidade do provedor
seria o pior desfecho.

### O botão não executa nada

Ele **insere uma linha** em `cloud_sync_jobs`. Um worker no servidor
(`run-cloud-sync-jobs.sh`, por cron a cada minuto) atende a fila.

O portal roda num container que não alcança o venv do collector nem o filesystem
do host, e dar-lhe qualquer um dos dois significaria montar diretório do host num
processo que atende requisição HTTP pública. Executar shell a partir de rota HTTP é
exatamente o que a fila existe para evitar.

Consequência prática para quem opera: **a coleta não é instantânea.** A tela mostra
`coleta enfileirada` e o status muda quando o worker pega o job. *Atualizar status*
relê — não há polling automático, de propósito: uma tela de configuração aberta e
esquecida geraria requisição indefinidamente contra um banco que o Metabase também
usa.

### O que a tela mostra

| Estado | Significado |
|---|---|
| `coleta enfileirada` | job em `queued` — o worker ainda não pegou |
| `coleta em execução` | job em `running` |
| `coleta concluída` | `success`, com o `ovh_sync_runs.id` ao lado |
| `coleta falhou` | `failed`, com o erro **sanitizado** |

Clicar duas vezes é seguro: o índice único parcial da migração 008 garante no
máximo um job vivo por conta, e a segunda chamada devolve o job existente com
`criado: false` em vez de erro — o pedido *foi* atendido.

### Se a migração 008 não foi aplicada

O botão recusa com mensagem própria e **salvar credencial continua funcionando**. A
fila é conveniência; a ausência dela não pode impedir o cadastro. Nesse caso, colete
à mão:

```bash
cd /opt/finops/ovh-collector && ./run-ovh-etl.sh manual --account <id>
```

Mecânica completa da fila, dos três cadeados e do worker em
[ovh-collector-multiconta.md](ovh-collector-multiconta.md), seção 10.

---

## 4. Por que cifrado, e não hash

A pergunta volta sempre, então vale a resposta curta: **hash serve para
verificar, cifragem serve para usar.**

Senha de usuário vira hash porque o sistema nunca precisa da senha — só precisa
decidir se a apresentada é a mesma. Por isso `app_users.password_hash` é scrypt e
está certo assim.

Credencial de API é o oposto: o collector precisa **enviá-la à OVH** em cada
coleta. Hash é via de mão única; hash aqui tornaria a credencial inútil no dia
seguinte ao cadastro.

O custo da cifragem é explícito e vale registrar: **quem tiver a chave e o banco
tem a credencial.** A mitigação é que a chave nunca está no banco — vive só em
`APP_CREDENTIALS_ENCRYPTION_KEY`, no ambiente do processo. Um `pg_dump`, sozinho,
não entrega nada. E dumps circulam: cópia local, snapshot de volume, backup antes
de migração. A chave não circula com eles.

O **fingerprint HMAC** ao lado dá o que o hash daria: comparar sem decifrar.
Responde "a credencial mudou entre ontem e hoje?" e "a mesma chave está cadastrada
em duas contas?" — a segunda é um erro sem sintoma nenhum, porque as duas contas
coletariam a **mesma** conta da OVH e os dois totais pareceriam plausíveis.

---

## 5. Como a cifragem funciona

Implementação em
[web/src/lib/cripto/segredos.ts](../web/src/lib/cripto/segredos.ts), 35 testes em
`segredos.test.ts`.

**AES-256-GCM**, IV de 96 bits **novo a cada cifragem**. Reusar IV em GCM com a
mesma chave não vaza só o texto: vaza a chave de autenticação e permite forjar
tags. O módulo nunca aceita IV de fora.

**Envelope** gravado na coluna:

```
v1:<iv base64>:<cifrado base64>:<tag base64>
```

Autodescritivo de propósito — quem abrir a coluna no `psql` identifica o formato
sem consultar o código, e o prefixo de versão permite reconhecer envelope antigo
numa troca de algoritmo. O CHECK do banco exige `LIKE 'v1:%'`, o que barra um
`INSERT` feito à mão com valor em claro.

**Duas subchaves por HKDF**, uma para cifrar e outra para o fingerprint. A mesma
chave nunca faz dois trabalhos: se a de fingerprint vazasse — e ela sai do
processo, gravada em coluna consultável —, ela não decifra nada.

**AAD amarra o texto cifrado à sua linha.** Este é o detalhe menos óbvio e o mais
importante:

```
AAD = "provider:account_id:campo"
```

GCM garante que o texto cifrado não foi **alterado**. Não garante que não foi
**movido**. Sem AAD, quem tivesse escrita no banco poderia copiar o
`application_secret_encrypted` da conta A para a conta B, e o portal decifraria
com sucesso — passando a autenticar na OVH de A enquanto a tela afirma que é B.
Com AAD, a decifragem falha.

**Fingerprint é HMAC-SHA256**, não SHA-256 cru. SHA-256 puro permitiria a quem tem
o banco testar candidatos por dicionário. Chave da OVH tem entropia alta e o
ataque seria pouco prático, mas HMAC com subchave secreta custa o mesmo.

**Máscara** — a tela recebe `****abcd`, os quatro últimos caracteres. Aplicada a
Application Key e Consumer Key, que são identificadores do lado da OVH. **O
Application Secret nunca é mascarado nem exibido**: dele a tela sabe apenas se
existe. Segredo com menos de 8 caracteres vira `****` inteira — mostrar 4 de 6
entregaria dois terços do valor.

### Gerar a chave

```bash
openssl rand -base64 32
```

Exatamente 32 bytes após decodificar. Chave curta é **recusada**, não esticada
com padding: aceitar daria a aparência de AES-256 com a força de uma senha
digitada. Coloque em `/opt/finops/.env` (modo 600) como
`APP_CREDENTIALS_ENCRYPTION_KEY` e repasse ao container pelo compose.

A variável é **opcional** em `env.ts`, e isso é deliberado: dashboard, analítico,
faturamento e diagnóstico não tocam credencial. Sem a chave, só o bloco de
credenciais se recusa a operar, com mensagem própria — torná-la obrigatória
derrubaria o portal inteiro por causa de uma tela.

---

## 6. Quem pode o quê

| Ação | Exigência |
|---|---|
| Abrir Contas Cloud, editar alias/unidade/centro/ambiente | `settings:accounts` |
| **Ver, salvar, testar ou remover credencial** | **papel ADMIN** |

A segunda linha é papel, **não permissão**, e a diferença não é estilo.

`can()` tem duas saídas antes de olhar o conjunto do usuário: ADMIN recebe `true`
para tudo, e **qualquer permissão pode ser concedida a um grupo**. Criar
`settings:credentials` daria a *ilusão* de exclusividade — a tela de grupos
entregaria a chave da OVH a qualquer VIEWER em dois cliques, sem aviso.

Por isso as rotas de credencial usam `rotaSomenteAdmin`, que testa
`sessao.papel !== "ADMIN"` diretamente. É o único ponto do sistema que decide por
papel em vez de permissão, e a exceção está registrada no código porque um leitor
futuro tenderia a "corrigi-la" para o padrão.

`rbac-credenciais.test.ts` trava a premissa: ele varre o catálogo inteiro e
verifica que **toda** permissão é concedível a um VIEWER. Se isso deixar de valer,
o teste quebra e a decisão pode ser reavaliada.

O que um não-ADMIN vê numa conta OVH: uma linha de texto dizendo que a conta tem
credenciais e que só administradores as consultam. **O dado não sai do servidor** —
`GET /api/admin/accounts` devolve `credencial: null` para ele. Um `curl` com
sessão de VIEWER recebe o mesmo JSON que o navegador dele receberia.

---

## 7. Como testar a conexão

O botão faz **uma** chamada: `GET /me` na região escolhida, somente leitura.

> **Isto mudou um invariante do projeto.** A migração 005 afirma, em comentário,
> que "o portal nunca fala com a API da OVH". Era verdade e era bom. O botão
> exigiu a quebra — não há como dizer a quem acabou de digitar uma credencial que
> ela funciona sem tentar usá-la, e a alternativa (gravar um pedido e esperar o
> collector validar) transformaria um clique numa espera de 24h.
>
> A quebra é mantida no menor tamanho possível: um endpoint, somente leitura, sem
> biblioteca nova, timeout de 8s. **A coleta continua sendo do collector** — o
> portal nunca busca custo.
>
> Consequência operacional: o container do portal passa a precisar de **saída
> HTTPS** para o domínio da API da OVH.

O timestamp vem de `GET /auth/time` da própria OVH, não do relógio local.
Container acumula deriva, e um timestamp fora da janela produz falha que se
parece com credencial inválida — o pior tipo de erro, o que manda gerar
credencial nova sem necessidade.

As mensagens distinguem as causas, porque a ação é diferente em cada uma:

| Resposta | Leitura |
|---|---|
| **401** | credencial errada, ou consumer key não validada no link de autorização |
| **403** | identidade aceita, acesso a `/me` negado — refaça a autorização incluindo `GET /me` |
| **404** | quase sempre **endpoint errado** — a chave vale só na região onde foi criada |
| **429** | limite de taxa; tente em alguns minutos |
| timeout | falta de saída HTTPS do container — **não** credencial errada |

Falha de **rede não marca a credencial como inválida**. Gravar `invalido` porque o
container não tem saída HTTPS diria que a chave está errada, e mandaria alguém
gerar credencial nova para resolver um problema de firewall.

Toda mensagem passa por `sanitizar` antes de virar `last_validation_error`, que é
**exibida na tela**. O corte é por forma — qualquer sequência de 16+ caracteres
base64/hex vira `<omitido>` —, não por lista de valores conhecidos: não há como
enumerar o que a API pode ecoar.

---

## 8. Como rotacionar uma credencial

1. Crie a credencial nova no console da OVH (a antiga continua valendo)
2. Em Contas Cloud, preencha os três campos com os valores novos
3. **Testar conexão** — confirme antes de gravar
4. **Salvar credenciais**
5. **Testar conexão** de novo, agora sobre o que foi gravado
6. Revogue a credencial antiga no console da OVH

Para trocar **só o endpoint** ou **só o secret**, deixe os outros campos **em
branco**: campo vazio significa **manter o que está gravado**.

Essa regra existe porque o servidor nunca devolve o segredo à tela. Ao reabrir o
formulário os três campos aparecem vazios; se vazio significasse "apague", uma
edição de endpoint destruiria a credencial e a coleta pararia no dia seguinte sem
ninguém ter pedido isso. Apagar tem porta própria — o botão **Remover
credenciais** — e nunca acontece por omissão.

`plano.test.ts` cobre isso em 27 testes, incluindo o caso central: editar o
endpoint com os três campos vazios mantém os três segredos.

Remover a credencial **não apaga custo nem fatura já coletados**. O dado
histórico continua valendo — a OVH cobrou o que cobrou. O efeito é que a próxima
coleta daquela conta fica sem como autenticar.

---

## 9. Como rotacionar a chave de cifragem

Operação diferente e mais delicada que a anterior: a chave decifra **todas** as
credenciais.

Não há rotação automática, e a ausência é deliberada — um script que reciframe
tudo precisaria das duas chaves em memória simultaneamente e de uma transação
sobre a tabela inteira. Com poucas contas, o caminho manual é mais seguro:

1. Anote quais contas têm credencial:
   `SELECT account_id, status FROM cloud_provider_credentials;`
2. Tenha em mãos as credenciais originais (do console da OVH, ou gere novas)
3. Troque `APP_CREDENTIALS_ENCRYPTION_KEY` no `.env` e recrie o container
4. Cadastre cada credencial de novo pela tela

**Como o sintoma aparece se você trocar a chave sem recadastrar:** a tela mostra
"não foi possível ler" no lugar da máscara, e um aviso explícito dizendo que o
sintoma é de chave trocada. A decifragem **falha**, nunca devolve lixo — e a
página não quebra por causa de uma linha ilegível.

O envelope tem prefixo `v1:` justamente para tornar uma rotação real
implementável depois: um `v2:` conviveria com `v1:` durante a transição.

---

## 10. Como o collector passa a consumir credenciais do banco

> **Ainda não implementado.** Esta seção descreve o contrato; o collector
> continua lendo `/opt/finops/ovh-collector/.env`. A troca é a próxima entrega, e
> foi deixada fora desta por tamanho: exige dependência nova em Python
> (`cryptography`), leitura no banco, precedência entre banco e `.env`, e teste
> de decifragem cruzada entre as duas linguagens.

O que já existe: a tabela, a cifragem, a tela e os GRANTs. O que falta é o lado
Python.

### O contrato

O collector deve ler, para cada conta OVH ativa:

```sql
SELECT c.account_id, c.endpoint,
       c.application_key_encrypted,
       c.application_secret_encrypted,
       c.consumer_key_encrypted
  FROM cloud_provider_credentials c
  JOIN cloud_accounts a ON a.account_id = c.account_id
 WHERE c.provider = 'ovh' AND a.active
 ORDER BY c.account_id;
```

E decifrar cada envelope com o **mesmo algoritmo e o mesmo AAD**:

| Parâmetro | Valor |
|---|---|
| Algoritmo | AES-256-GCM |
| Chave | `HKDF-SHA256(APP_CREDENTIALS_ENCRYPTION_KEY, salt=b"veri-finops/credenciais", info=b"cifra-credencial-v1", 32)` |
| Envelope | `v1:<iv b64>:<cifrado b64>:<tag b64>` |
| AAD | `f"ovh:{account_id}:{campo}"`, campo ∈ `application_key` / `application_secret` / `consumer_key` |
| Tag | 16 bytes |

Em Python, com `cryptography`:

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
import base64, os

def _subchave() -> bytes:
    mestra = base64.b64decode(os.environ["APP_CREDENTIALS_ENCRYPTION_KEY"])
    if len(mestra) != 32:
        raise SystemExit("APP_CREDENTIALS_ENCRYPTION_KEY precisa de 32 bytes")
    return HKDF(
        algorithm=hashes.SHA256(), length=32,
        salt=b"veri-finops/credenciais", info=b"cifra-credencial-v1",
    ).derive(mestra)

def decifrar(envelope: str, account_id: str, campo: str) -> str:
    versao, iv_b64, corpo_b64, tag_b64 = envelope.split(":")
    if versao != "v1":
        raise ValueError(f"envelope em versao desconhecida: {versao}")
    aad = f"ovh:{account_id}:{campo}".encode()
    # O AESGCM do `cryptography` espera cifrado+tag concatenados.
    dados = base64.b64decode(corpo_b64) + base64.b64decode(tag_b64)
    return AESGCM(_subchave()).decrypt(base64.b64decode(iv_b64), dados, aad).decode()
```

### Decisões que a implementação precisa tomar

**Precedência.** Se houver credencial no banco **e** no `.env`, qual vale? A
resposta certa é o **banco**, com aviso em log quando as duas existirem — senão
uma rotação feita pela tela seria silenciosamente ignorada porque alguém esqueceu
de limpar o `.env`.

**Fallback.** Sem credencial no banco, o collector deve cair no `.env` e dizer
isso no log. Falhar direto quebraria a coleta na hora da migração.

**Multi-conta.** O collector hoje coleta **uma** conta, do `.env`. Ler do banco o
torna naturalmente multi-conta, e isso muda o laço principal, `ovh_sync_runs` e a
atribuição de `provider_account_id`. É a parte maior do trabalho — bem maior que
a decifragem.

**Chave no ambiente do collector.** Ele passa a precisar da mesma
`APP_CREDENTIALS_ENCRYPTION_KEY`, o que significa a chave em dois lugares na EC2
(`/opt/finops/.env` e `/opt/finops/ovh-collector/.env`), ou um `.env` compartilhado.
Vale decidir isso antes de escrever código.

---

## 11. Endpoints da API

Todos exigem sessão. Os três de credencial exigem **papel ADMIN**.

| Método | Rota | Exigência |
|---|---|---|
| GET | `/api/admin/accounts?provider=` | `settings:accounts` — `credencial` só para ADMIN |
| POST | `/api/admin/accounts` | **ADMIN** — cria conta OVH |
| PATCH | `/api/admin/accounts/:id` | `settings:accounts` |
| POST | `/api/admin/ovh/test-credentials` | **ADMIN** — testa sem conta cadastrada |
| GET | `/api/admin/accounts/:id/credentials` | ADMIN |
| PUT | `/api/admin/accounts/:id/credentials` | ADMIN |
| DELETE | `/api/admin/accounts/:id/credentials` | ADMIN |
| POST | `/api/admin/accounts/:id/credentials/test` | ADMIN |
| POST | `/api/admin/accounts/:id/credentials/sync` | ADMIN — enfileira coleta |
| GET | `/api/admin/accounts/:id/credentials/sync` | ADMIN — job vivo + último |
| POST | `/api/diagnostico/ovh/collect` | ADMIN — coleta manual pelo Diagnóstico |

O `POST` de criação é **ADMIN**, e não `settings:accounts`, porque o corpo carrega
os três segredos: `settings:accounts` é delegável a qualquer grupo, e um grupo pode
conter um VIEWER — nenhuma permissão consegue expressar "só ADMIN". Ele **só cria
conta OVH**; não existe POST para conta AWS, e a ausência é o desenho (§1.2).

`/api/admin/ovh/test-credentials` vive **fora** de `/accounts/:id/` porque não tem
conta: ele serve ao formulário de criação, em que testar antes de salvar é o ponto.
Pendurá-lo num `accountId` inexistente exigiria inventar um id de fantasia na URL.
Ele não persiste nada — o único efeito é um `GET /me` na OVH.

`PUT` e não `PATCH` porque as três partes e o endpoint formam uma **unidade**:
trocar a application key mantendo o secret antigo não produz credencial
"parcialmente atualizada", produz credencial inválida. O comportamento que
*parece* PATCH — campo vazio preservando o gravado — é regra de preenchimento, não
semântica HTTP.

O teste responde **200 mesmo quando falha**. A requisição foi bem atendida: o
portal perguntou à OVH e obteve resposta. Devolver 4xx faria o cliente tratar
como falha de chamada e perder a mensagem, que aqui é o produto.

A rota de fila **não tem DELETE**. Marcar um job `cancelled` daria a impressão de
interromper uma coleta que segue correndo no host, porque o worker não verifica o
status entre etapas. Um cancelamento honesto exige essa verificação, e ela não
está implementada.

### O que nunca sai destas rotas

`application_secret` em qualquer forma — nem mascarado. `application_key` e
`consumer_key` apenas como `****abcd`. Fingerprints: ficam no banco para
auditoria por consulta; expô-los daria a quem tem a tela um oráculo para testar
se uma credencial que ele já possui é a cadastrada.

---

## 12. Limitações conhecidas

1. **O collector não lê do banco ainda.** Seção 10. Até lá, cadastrar credencial
   pela tela não muda o que a coleta usa — os dois lugares coexistem, e o `.env`
   é o que vale.
2. **Sem rotação automática da chave de cifragem.** Seção 9.
3. **Sem histórico de credencial.** Substituir sobrescreve. Guardar versões
   antigas de um segredo multiplica a superfície sem responder pergunta que
   `updated_by` e `updated_at` não respondam.
4. **Chave duplicada avisa, não recusa.** Cadastrar a mesma application key em
   duas contas é permitido, com aviso na tela — pode ser legítimo durante
   migração de conta. O silêncio seria pior.
5. **Uma credencial por conta e provedor.** Não há como cadastrar duas chaves
   para a mesma conta (por exemplo, uma para faturas e outra para projetos).
6. **`GET /me` não prova todos os direitos.** Uma credencial que passa no teste
   ainda pode não ter acesso a `/me/bill`. O teste confirma identidade, não o
   conjunto de direitos que a coleta exige.
7. **A tela cria conta OVH, e só ela.** Conta AWS continua vindo do onboarding —
   ver §1.2, que é a pendência técnica aberta. O `provider` não é editável em
   nenhum dos dois casos: trocá-lo desligaria a conta da sua origem de dado.
8. **Criar conta e gravar credencial não são atômicos.** A conta é criada
   primeiro porque o AAD da cifragem inclui o `account_id` — não há como cifrar
   antes de saber para quem. Se a gravação da credencial falhar, a conta
   permanece, marcada "Credenciais não configuradas". Desfazer a conta destruiria
   os metadados recém-digitados por causa de uma chave colada errado; o estado
   resultante é visível, nomeado e recuperável com dois cliques no cartão.
