# DNS de nexeeo.com -- estado e validacao

Dominio oficial de producao: **`nexeeo.com`**.

Levantado em **19/08/2026**, da EC2 de producao e da estacao administrativa.
Somente consultas de leitura: nenhum container, certificado, aplicacao, banco ou
ETL foi tocado.

> **Correcao de rumo.** Este documento substitui `docs/dns-nexxeo.md`, que
> diagnosticava **`nexxeo.com`** -- dominio errado, com dois `x`, usado por
> engano em prompts anteriores. Aquele diagnostico estava tecnicamente correto e
> era sobre o dominio de outra pessoa: `nexxeo.com` pertence a um terceiro, esta
> registrado na OVH desde 2015 e nao tem DNS funcionando. Nada dele se aplica
> aqui. O historico fica na secao 6, porque um pedaco daquele erro **vazou para a
> zona de producao** e precisa ser corrigido.

---

## 1. Estado atual

O dominio esta **registrado, delegado corretamente e resolvendo**. Nao ha
problema de delegacao.

| | |
|---|---|
| Registrador | **Amazon Registrar, Inc.** |
| Registrado em | 07/03/2025 |
| Expira em | 07/03/2027 |
| Status | `active` |
| Ultima alteracao | 31/01/2026 |
| DNSSEC | nao ativo (sem DS no TLD) |

Delegacao publicada no TLD `.com`, conferida direto em `a.gtld-servers.net`:

```
nexeeo.com.  172800  IN  NS  ns-1389.awsdns-45.org.
nexeeo.com.  172800  IN  NS  ns-1873.awsdns-42.co.uk.
nexeeo.com.  172800  IN  NS  ns-395.awsdns-49.com.
nexeeo.com.  172800  IN  NS  ns-642.awsdns-16.net.
```

Registrador e Hosted Zone estao alinhados: os quatro NS do registro sao os
mesmos da zona, e a zona responde com a flag `aa` (autoritativa).

### Resolucao dos nomes

| Nome | Status | Resposta | Situacao |
|---|---|---|---|
| `nexeeo.com` | `NOERROR` | `3.23.68.121` | **OK** |
| `finops.nexeeo.com` | `NOERROR` | `3.23.68.121` | **OK** |
| `www.nexeeo.com` | **`SERVFAIL`** | -- | **QUEBRADO -- ver secao 2** |
| `metabase.nexeeo.com` | `NXDOMAIN` | -- | nao existe (opcional) |

---

## 2. O unico problema: `www.nexeeo.com` aponta para o dominio errado

Consultando a zona autoritativa diretamente:

```bash
dig @ns-1389.awsdns-45.org www.nexeeo.com A
```

```
;; ANSWER SECTION:
www.nexeeo.com.   300   IN   CNAME   nexxeo.com.
                                     ^^^^^^^^^^ dois "x" -- dominio de terceiro
```

O CNAME de `www` aponta para **`nexxeo.com`**, que:

- pertence a um terceiro (registrado na OVH desde 2015);
- esta delegado a `ns13.ovh.net` e `dns13.ovh.net`;
- **e esses servidores respondem `REFUSED`** -- estao vivos, mas nao hospedam a
  zona.

Resultado em cadeia: o resolvedor segue o CNAME, tenta resolver `nexxeo.com`,
recebe `REFUSED` dos servidores delegados e devolve `SERVFAIL`. Por isso
`www.nexeeo.com` falha enquanto o apex e o `finops` funcionam -- **o erro nao esta
na zona `nexeeo.com` em si, esta no destino do CNAME.**

O typo, portanto, nao ficou so na documentacao: **esta vivo em producao.**

### Correcao

No Route 53, Hosted Zone `nexeeo.com`, registro `www`:

| | Antes | Depois |
|---|---|---|
| Tipo | `CNAME` | `A` (recomendado) ou `CNAME` |
| Valor | `nexxeo.com` | `3.23.68.121` (ou `nexeeo.com` se mantiver CNAME) |

Prefira **`A` apontando para `3.23.68.121`**, igual ao apex e ao `finops`: evita
um salto de resolucao, deixa os tres nomes uniformes e remove a chance de um
CNAME voltar a apontar para o lugar errado. Se mantiver `CNAME`, o destino
precisa ser `nexeeo.com` -- com dois `e`.

Enquanto isso nao for feito, `https://www.nexeeo.com` **nao funciona**, e o
pedido de certificado no NPM **falha inteiro** -- inclusive para `nexeeo.com` e
`finops.nexeeo.com`, porque um unico certificado cobre os tres nomes e o Let's
Encrypt valida cada um separadamente. Ver secao 5.

### Se `metabase.nexeeo.com` for publicado

Nao existe hoje (`NXDOMAIN`). Criar como `A` -> `3.23.68.121`. Ver a Access List
por IP em `/opt/nginx-proxy-manager/README-operacao.md`, secao 5: o Metabase da
acesso direto ao banco financeiro e hoje conecta como superusuario.

---

## 3. Registros esperados na Hosted Zone

| Nome | Tipo | Valor | Estado |
|---|---|---|---|
| `nexeeo.com` | A | `3.23.68.121` | existe, correto |
| `www.nexeeo.com` | A | `3.23.68.121` | **corrigir** -- hoje e CNAME para `nexxeo.com` |
| `finops.nexeeo.com` | A | `3.23.68.121` | existe, correto |
| `metabase.nexeeo.com` | A | `3.23.68.121` | opcional, nao existe |

`A` no apex e obrigatorio: CNAME na raiz de um dominio e proibido pelo DNS.

### E-mail

**Verifique antes de considerar a zona pronta.** Se houver e-mail em
`@nexeeo.com`, a zona precisa de `MX`, e de `TXT` com SPF, DKIM e DMARC. Uma
zona so com registros A publica o site e deixa o e-mail no chao -- e o sintoma
aparece dias depois, como mensagens caindo em spam.

---

## 4. Comandos de validacao

```bash
# delegacao -- a fonte da verdade e o TLD, nao o resolvedor local
dig +short NS nexeeo.com
dig @a.gtld-servers.net nexeeo.com NS +short

# resolucao dos tres nomes de producao
dig +short nexeeo.com              # 3.23.68.121
dig +short www.nexeeo.com          # hoje: vazio (SERVFAIL) -- ver secao 2
dig +short finops.nexeeo.com       # 3.23.68.121

# a zona autoritativa, sem passar por cache
dig @ns-1389.awsdns-45.org nexeeo.com        SOA    # NOERROR, flag "aa"
dig @ns-1389.awsdns-45.org www.nexeeo.com    A      # o CNAME errado aparece aqui
dig @ns-1389.awsdns-45.org finops.nexeeo.com A

# HTTP e HTTPS
curl -I http://nexeeo.com
curl -I https://nexeeo.com
curl -I https://www.nexeeo.com
curl -I https://finops.nexeeo.com

# o desafio do Let's Encrypt chega no proxy? 404 do openresty e o resultado BOM
curl -I http://nexeeo.com/.well-known/acme-challenge/teste
```

### Como ler os status

| Status | Significado | Onde investigar |
|---|---|---|
| `NOERROR` | resolveu | -- |
| `NXDOMAIN` | o nome nao existe na zona | criar o registro |
| **`SERVFAIL`** | **existe delegacao, mas os servidores nao entregam a zona** | o destino do CNAME, ou os NS delegados |

`SERVFAIL` nao e "nao existe" -- e por isso que consultar `8.8.8.8` nao serve
para diagnosticar delegacao. Para isso, pergunte ao TLD
(`dig @a.gtld-servers.net`) e a zona (`dig @<NS da zona>`).

---

## 5. Checklist antes de emitir SSL no NPM

Cada item nao marcado e uma falha do Let's Encrypt, e falhas consomem o limite de
**5 por conta/dominio/hora** -- estourar bloqueia a tentativa legitima seguinte.

- [ ] **`www.nexeeo.com` corrigido** (secao 2) e resolvendo `3.23.68.121`
- [ ] `dig +short nexeeo.com` devolve `3.23.68.121`
- [ ] `dig +short finops.nexeeo.com` devolve `3.23.68.121`
- [ ] os **tres** nomes resolvem: um certificado cobre os tres, e **se um so
      falhar o pedido inteiro falha**
- [ ] `curl -I http://nexeeo.com` responde do **openresty** (o NPM)
- [ ] `curl -I http://nexeeo.com/.well-known/acme-challenge/teste` devolve **404
      do openresty** -- prova que o HTTP-01 chega no proxy
- [ ] 80/tcp e 443/tcp abertas no Security Group (verificado em 18/08/2026)
- [ ] Elastic IP associado (feito: `3.23.68.121`)
- [ ] proxy host criado com os tres nomes -> `finops-portal:3000` (secao 7)
- [ ] `MX`/`SPF`/`DKIM` conferidos, se houver e-mail no dominio (secao 3)
- [ ] backup de `/opt/nginx-proxy-manager/data` e `letsencrypt` depois de emitir

---

## 6. Hosted Zone nao e dominio registrado

Vale registrar porque foi a origem da confusao anterior, e reaparece sempre.

| | **Dominio registrado** | **Hosted Zone** |
|---|---|---|
| O que e | a propriedade do nome, no registrador | um arquivo de zona hospedado, que responde consultas |
| Quem manda | publica os NS no `.com` | responde apenas se o `.com` apontar para ela |
| Prova de posse | sim | **nenhuma** |

Criar uma Hosted Zone no Route 53 **nao requer posse do dominio**. Qualquer conta
AWS pode criar uma zona chamada `nexxeo.com` -- ou `google.com` -- agora mesmo.
Ela responde a quem a consultar diretamente e e ignorada pela internet, porque a
internet pergunta ao `.com`, e o `.com` responde o que o **registrador**
publicou.

No caso de `nexeeo.com` os dois lados coincidem (registrador Amazon, zona no
Route 53 da mesma conta), o que e o cenario simples. No caso de `nexxeo.com`,
diagnosticado por engano, eles nao coincidiam -- e nunca iriam coincidir, porque
o dominio e de outra pessoa.

### O que sobrou do diagnostico errado

Um unico item, e e o da secao 2: o CNAME de `www.nexeeo.com` aponta para
`nexxeo.com`. Alguem escreveu o dominio errado dentro da zona certa. E o mesmo
typo, no unico lugar onde ele causa indisponibilidade real em vez de so
documentacao confusa.

---

## 7. Proxy host no Nginx Proxy Manager

| Campo | Valor |
|---|---|
| Domain Names | `nexeeo.com`, `www.nexeeo.com`, `finops.nexeeo.com` |
| Scheme | `http` |
| Forward Hostname / IP | `finops-portal` |
| Forward Port | `3000` |
| Block Common Exploits | ON |
| Websockets Support | ON |
| Cache Assets | OFF |
| SSL | `Request a new SSL Certificate` |
| Force SSL | ON |
| HTTP/2 Support | ON |
| HSTS | **OFF inicialmente** |

Os tres nomes vao no **mesmo** proxy host, um por linha.

`Forward Hostname` e o **nome do container**, nao `localhost`: dentro do
container do NPM, `localhost` e o proprio NPM. `Forward Port` e a porta
**interna** (`3000`), nao a publicada no host (`8080`). O container
`finops-portal` ja esta na rede `npm-public` e o NPM ja o alcanca pelo nome --
verificado, HTTP 200 em `/api/health`.

HSTS fica OFF no inicio de proposito: ele instrui o navegador a recusar HTTP
para o dominio por um periodo longo, e um erro de configuracao com HSTS ligado
nao se corrige do lado do servidor -- fica preso no cache do navegador de cada
usuario. Ligue depois que o HTTPS estiver estavel.

Operacao, rollback, renovacao e Access List do Metabase:
`/opt/nginx-proxy-manager/README-operacao.md` na EC2.

---

## 8. A aplicacao nao precisa saber o dominio

Verificado no codigo em 19/08/2026: **nenhuma URL absoluta e construida pela
aplicacao.**

- redirecionamentos sao caminhos relativos, com bloqueio de redirect aberto em
  `web/src/lib/auth/destino.ts`;
- exportacoes usam caminho relativo;
- o cookie de sessao e `httpOnly`, `sameSite=lax` e `secure` por padrao;
- nao ha NextAuth/Auth.js no projeto -- a autenticacao e propria, com sessao
  opaca em `app_sessions`.

Consequencias praticas:

1. **Trocar de dominio nao exige mudanca de codigo nem novo build.** Foi por isso
   que a busca por `nexxeo` no repositorio encontrou apenas documentacao.
2. Login, logout e exportacoes funcionam atras do proxy HTTPS sem configuracao
   extra: o `secure` do cookie e satisfeito porque o **navegador** fala HTTPS com
   o proxy, ainda que o trecho proxy -> container seja HTTP interno.
3. Nao existe variavel de ambiente de dominio a ajustar. `APP_URL`,
   `PUBLIC_APP_URL` e `ALLOWED_ORIGINS` aparecem em `infra/.env.example` apenas
   como **documentacao do dominio oficial** -- estao marcadas como nao lidas pelo
   codigo justamente para ninguem supor que ajustar ali muda comportamento.
