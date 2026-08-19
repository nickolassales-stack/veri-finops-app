# DNS de nexxeo.com -- diagnostico de delegacao

Levantado em **19/08/2026**, a partir da EC2 de producao e da estacao
administrativa (duas redes independentes, resultados identicos). Somente
consultas de leitura: nenhum container, certificado, aplicacao, banco ou ETL foi
tocado.

---

## 1. Conclusao, antes dos detalhes

O dominio **esta registrado** e **esta delegado -- para a OVH, nao para a AWS**.
Mas o problema real e maior do que "apontou para o lugar errado":

> **Os nameservers da OVH que constam no registro nao hospedam mais a zona.**
> Eles respondem `REFUSED` para `nexxeo.com`. O dominio nao tem *nenhum* DNS
> funcionando hoje -- A, NS, SOA, MX e TXT todos devolvem `SERVFAIL`.

E a Hosted Zone da AWS que se esperava encontrar **tambem nao responde**: os
quatro nameservers esperados devolvem `REFUSED` para `nexxeo.com`, o que
significa que nenhuma zona com esse conjunto de NS existe hoje.

Ou seja, hoje **os dois lados estao vazios**. Nao e um caso de "trocar o
apontamento": e preciso primeiro ter uma zona que responda, e so depois apontar
para ela.

---

## 2. As seis perguntas

### 1. O dominio publico esta delegado para OVH ou AWS?

**OVH.** O registro no `.com` traz `DNS13.OVH.NET` e `NS13.OVH.NET`. O
registrador e a **OVH sas** (handle 433 no RDAP da Verisign) -- o dominio **nao
esta registrado na Amazon**.

### 2. O TLD .com retorna quais NS?

```
nexxeo.com.  172800  IN  NS  ns13.ovh.net.
nexxeo.com.  172800  IN  NS  dns13.ovh.net.
```

TTL de 172800 s = **48 horas**. E o tempo que uma troca de nameserver pode levar
para desaparecer dos caches, e explica por que a mudanca nao e instantanea.

### 3. A Hosted Zone da AWS responde corretamente quando consultada diretamente?

**Nao. Os quatro nameservers devolvem `REFUSED`.**

| Nameserver | IP | Resposta para nexxeo.com |
|---|---|---|
| ns-1389.awsdns-45.org | 205.251.197.109 | `REFUSED` |
| ns-1873.awsdns-42.co.uk | 205.251.199.81 | `REFUSED` |
| ns-395.awsdns-49.com | 205.251.193.139 | `REFUSED` |
| ns-642.awsdns-16.net | 205.251.194.130 | `REFUSED` |

`REFUSED` e uma resposta, nao um timeout: os servidores estao vivos e se recusam
a falar sobre esta zona. Como cada nameserver do Route 53 atende milhares de
zonas, `REFUSED` para `nexxeo.com` significa que **`nexxeo.com` nao esta entre as
zonas que eles servem**.

Interpretacao: a Hosted Zone foi apagada, nunca existiu, ou existe com **outro**
conjunto de nameservers -- o Route 53 sorteia quatro NS por zona, e recriar uma
zona sorteia um conjunto novo. Nesse ultimo caso, a lista de quatro NS acima
esta simplesmente desatualizada.

Confirmado das duas redes: EC2 de producao e estacao administrativa.

### 4. A AWS CLI mostra quais nameservers no registro do dominio?

**Nao foi possivel responder.** O papel da instancia (`FinOpsEC2Role`, conta
`800168045394`) nao tem as permissoes:

```
route53domains:GetDomainDetail   AccessDeniedException
route53domains:ListOperations    AccessDeniedException
route53:ListHostedZones          AccessDenied
```

Isso, porem, e coerente com o achado principal: como o registrador e a **OVH**,
o dominio nao aparece em `route53domains` desta conta de forma nenhuma -- mesmo
com permissao, `get-domain-detail` retornaria "dominio nao encontrado". A API do
Route 53 Domains lista apenas dominios **registrados pela AWS**.

O dado autoritativo veio do RDAP da Verisign, que nao depende de IAM:

```
dominio     : NEXXEO.COM
registrador : OVH sas (handle 433)
nameservers : DNS13.OVH.NET, NS13.OVH.NET
registrado  : 2015-11-30
expira      : 2026-11-30
ult. alter. : 2025-12-01
status      : clientDeleteProhibited, clientTransferProhibited
```

### 5. Existe operacao pendente ou falha no Route 53 Domains?

**Nao foi possivel consultar** (`route53domains:ListOperations` negado). Mas ha
evidencia indireta de que **nao existe operacao de troca de NS pendente**: o
campo `last changed` do registro esta em **2025-12-01**, quase nove meses atras.
Uma alteracao de nameserver submetida recentemente teria atualizado essa data.

Alem disso, `route53domains` so registra operacoes de dominios registrados na
AWS. Este nao e.

### 6. Proxima acao recomendada

Ver a secao 5. Em uma linha: **criar a zona no Route 53, popular os registros,
verificar que a zona responde, e so depois trocar os nameservers no painel da
OVH** -- usando os NS que a zona realmente tiver, nao a lista deste documento.

---

## 3. Comandos executados e resultados

```bash
# resolvedor local da EC2
dig +short NS nexxeo.com
#   (vazio)

# servidores autoritativos do TLD .com -- a fonte da delegacao
dig @a.gtld-servers.net nexxeo.com NS +short
#   (vazio com +short; a delegacao vem na secao AUTHORITY)
dig @a.gtld-servers.net nexxeo.com NS +noall +authority
#   nexxeo.com.  172800  IN  NS  ns13.ovh.net.
#   nexxeo.com.  172800  IN  NS  dns13.ovh.net.

# resolvedores publicos
dig @8.8.8.8 nexxeo.com NS      # status: SERVFAIL
dig @1.1.1.1 nexxeo.com NS      # status: SERVFAIL

# cadeia completa
dig +trace nexxeo.com NS
#   root -> com. -> nexxeo.com NS ns13.ovh.net / dns13.ovh.net
#   depois falha: "UDP setup ... failed: network unreachable" (IPv6)
#   -- a EC2 nao tem rota IPv6; nao e problema do dominio

# os NS da OVH, direto por IPv4
dig @5.39.112.241  nexxeo.com SOA   # ns13.ovh.net   -> REFUSED
dig @5.135.98.29   nexxeo.com SOA   # dns13.ovh.net  -> REFUSED

# sanidade: o servidor esta vivo?
dig @5.39.112.241 ovh.net SOA +short
#   dns10.ovh.net. tech.ovh.net. 2087141940 ...
#   responde por ovh.net e recusa nexxeo.com => vivo, mas nao hospeda a zona

# a Hosted Zone esperada
dig @ns-1389.awsdns-45.org   nexxeo.com SOA        # REFUSED
dig @ns-1873.awsdns-42.co.uk nexxeo.com SOA        # REFUSED
dig @ns-395.awsdns-49.com    nexxeo.com SOA        # REFUSED
dig @ns-642.awsdns-16.net    nexxeo.com SOA        # REFUSED
dig @ns-1389.awsdns-45.org   nexxeo.com A +short         # (vazio)
dig @ns-1389.awsdns-45.org   www.nexxeo.com CNAME +short # (vazio)
dig @ns-1389.awsdns-45.org   finops.nexxeo.com A +short  # (vazio)

# DNSSEC -- ha DS no TLD?
dig @a.gtld-servers.net nexxeo.com DS +short
#   (vazio) => DNSSEC NAO esta ativo. Simplifica a troca: com DS presente,
#   trocar de provedor de DNS sem remover o DS antes derruba a resolucao
#   inteira, e o erro e dificil de diagnosticar.

# estado atual de qualquer tipo de registro
for t in A NS SOA MX TXT; do dig @8.8.8.8 nexxeo.com $t; done
#   SERVFAIL nos cinco

# registro autoritativo, sem depender de IAM
curl -sS https://rdap.verisign.com/com/v1/domain/nexxeo.com
#   registrador OVH sas; NS DNS13.OVH.NET / NS13.OVH.NET

# AWS CLI (na EC2, papel FinOpsEC2Role)
aws route53domains get-domain-detail --region us-east-1 --domain-name nexxeo.com
aws route53domains list-operations   --region us-east-1
aws route53 list-hosted-zones
#   os tres: AccessDenied
```

### Por que `SERVFAIL` e nao `NXDOMAIN`

Distincao que muda o diagnostico:

- **`NXDOMAIN`** significaria "este nome nao existe" -- dominio nao registrado.
- **`SERVFAIL`** significa "existe delegacao, mas os servidores delegados nao
  entregam a zona".

E por isso que uma medicao anterior, feita apenas com resolvedores publicos,
sugeriu que o dominio nao estava registrado: o `SERVFAIL` esconde a delegacao.
So consultando **os servidores do TLD diretamente** a delegacao para a OVH
aparece. Consultar `8.8.8.8` nao serve para diagnosticar delegacao quebrada.

---

## 4. Hosted Zone nao e dominio registrado

A confusao que originou este diagnostico, e que vale registrar porque reaparece
sempre:

| | **Dominio registrado** | **Hosted Zone** |
|---|---|---|
| O que e | a propriedade do nome, no registrador | um arquivo de zona hospedado, que responde consultas |
| Onde vive | OVH (neste caso) | Route 53 (ou OVH, ou qualquer provedor) |
| Quem manda | o registrador publica os NS no `.com` | responde apenas se o `.com` apontar para ela |
| Custo | anuidade do dominio | ~US$ 0,50/mes por zona |
| Prova de posse | sim | **nenhuma** |

O ponto decisivo: **criar uma Hosted Zone no Route 53 nao requer posse do
dominio e nao muda nada no mundo.** Qualquer conta AWS pode criar uma zona
chamada `nexxeo.com`, ou `google.com`, agora mesmo. Ela fica ali, respondendo
para quem a consultar diretamente, e **completamente ignorada pela internet** --
porque a internet pergunta ao `.com`, e o `.com` responde o que o *registrador*
publicou.

Ver a zona criada no console do Route 53 da a impressao de que "o dominio esta
na AWS". Nao esta. O unico lugar que decide isso e o painel do registrador --
aqui, a OVH.

A delegacao e o unico elo que liga os dois, e hoje ela aponta para o outro lado.

---

## 5. Como corrigir

### Antes de tudo: nao repita o erro que causou a queda atual

O estado de hoje -- dominio delegado a nameservers que nao hospedam a zona -- e
exatamente o que acontece quando se publica no registrador uma lista de NS que
nao foi verificada. **Nao use a lista de quatro NS deste documento.** Ela ja se
provou nao respondendo. Copie os NS da zona real, depois de ela existir e
responder.

### Passo 1 -- garantir uma zona que responda (no Route 53)

1. Route 53 -> Hosted zones. Se `nexxeo.com` nao existir, criar (publica).
2. Abrir a zona e copiar os **quatro NS do proprio registro NS da zona**.
3. Criar os registros, todos apontando para o Elastic IP `3.23.68.121`:

| Nome | Tipo | Valor |
|---|---|---|
| `nexxeo.com` | A | `3.23.68.121` |
| `www.nexxeo.com` | A | `3.23.68.121` |
| `finops.nexxeo.com` | A | `3.23.68.121` |
| `metabase.nexxeo.com` | A | `3.23.68.121` (opcional) |

`A` em vez de `CNAME` para o apex e obrigatorio -- CNAME no apex e proibido pelo
DNS. Para os subdominios, `A` mantem tudo uniforme e evita um salto de
resolucao.

### Passo 2 -- RECUPERAR O QUE EXISTIA ANTES

**Faca isto antes do passo 3.** A zona antiga na OVH sumiu, e com ela qualquer
registro que nao seja web:

- **MX** -- e-mail do dominio. Se havia e-mail em `@nexxeo.com`, **ja esta
  fora do ar** e continuara fora se a zona nova subir so com registros A.
- **TXT/SPF, DKIM, DMARC** -- sem eles, e-mail enviado pelo dominio passa a cair
  em spam.
- **TXT de verificacao** de Google, Microsoft, etc.
- outros subdominios em uso.

Fonte: painel da OVH (zona antiga, se ainda houver backup), ou os provedores de
e-mail. Publicar so os registros A e o jeito classico de derrubar o e-mail da
empresa junto com a publicacao do site.

### Passo 3 -- verificar ANTES de tocar no registrador

Com os NS obtidos no passo 1:

```bash
NS1=<primeiro NS da zona>
dig @$NS1 nexxeo.com SOA            # precisa vir NOERROR, com flag "aa"
dig @$NS1 nexxeo.com A +short       # precisa vir 3.23.68.121
dig @$NS1 finops.nexxeo.com A +short
dig @$NS1 www.nexxeo.com A +short
```

Se qualquer um vier `REFUSED` ou vazio, **pare**: a zona nao esta pronta, e
apontar o registrador para ela reproduz a falha atual.

### Passo 4 -- trocar os nameservers no painel da OVH

Painel OVH -> dominio `nexxeo.com` -> servidores DNS -> substituir
`ns13.ovh.net` e `dns13.ovh.net` pelos quatro do Route 53.

Sobre o status `clientTransferProhibited`: ele bloqueia **transferencia de
registrador**, nao troca de nameserver. Nao precisa ser removido para este
procedimento. Transferir o dominio para o Route 53 Domains e possivel, mas
desnecessario: levaria 5 a 7 dias, exigiria destravar e obter codigo de
autorizacao, e **nao resolveria o DNS por si so** -- transferencia de registro e
hospedagem de zona sao coisas distintas.

### Passo 5 -- aguardar a propagacao

```bash
# a fonte da verdade e o TLD, nao o resolvedor local:
dig @a.gtld-servers.net nexxeo.com NS +noall +authority

# quando o TLD ja mostrar os NS da AWS, confirmar ponta a ponta:
dig @8.8.8.8 nexxeo.com A +short     # 3.23.68.121, sem SERVFAIL
dig @1.1.1.1 nexxeo.com A +short
```

O TTL da delegacao atual e 48 h. Na pratica costuma ser bem mais rapido, mas
**nao emita certificado enquanto o TLD nao tiver mudado**.

---

## 6. Checklist antes de emitir SSL no NPM

Marque todos. Cada item nao marcado e uma falha do Let's Encrypt, e falhas
consomem o limite de **5 por conta/dominio/hora** -- estourar bloqueia a
tentativa legitima seguinte.

- [ ] `dig @a.gtld-servers.net nexxeo.com NS +noall +authority` mostra os NS da
      **AWS** (nao mais a OVH)
- [ ] `dig @8.8.8.8 nexxeo.com A +short` devolve `3.23.68.121` sem `SERVFAIL`
- [ ] `dig @1.1.1.1 nexxeo.com A +short` devolve o mesmo
- [ ] **os tres nomes do portal resolvem**: `nexxeo.com`, `www.nexxeo.com`,
      `finops.nexxeo.com`. Um certificado cobre os tres, e o Let's Encrypt valida
      cada um: **se um so nao resolver, o pedido falha inteiro**, inclusive para
      os que resolvem
- [ ] `metabase.nexxeo.com` resolve, se for publicar o Metabase
- [ ] `curl -I http://nexxeo.com` responde do **openresty** (o NPM), nao de outro
      servidor
- [ ] `curl http://nexxeo.com/.well-known/acme-challenge/teste` devolve **404 do
      openresty** -- o 404 e o resultado bom: prova que o desafio HTTP-01 chega
      no NPM. (Verificado por IP em 18/08/2026; refazer pelo nome.)
- [ ] 80/tcp e 443/tcp abertas no Security Group (verificado em 18/08/2026)
- [ ] Elastic IP associado (feito: `3.23.68.121`)
- [ ] proxy host criado no NPM com os tres nomes e destino `finops-portal:3000`
- [ ] registros de e-mail (MX/SPF/DKIM) recuperados -- passo 2 da secao 5
- [ ] backup de `/opt/nginx-proxy-manager/data` e `letsencrypt` depois de emitir

Detalhes de operacao do proxy, Access List do Metabase e rollback:
`/opt/nginx-proxy-manager/README-operacao.md` na EC2.

---

## 7. Resumo em uma tabela

| Pergunta | Resposta |
|---|---|
| Dominio registrado? | Sim, desde 30/11/2015, expira 30/11/2026 |
| Registrador | **OVH sas** -- nao a Amazon |
| Delegado para | **OVH** (`ns13.ovh.net`, `dns13.ovh.net`) |
| Esses NS servem a zona? | **Nao** -- `REFUSED`. Estao vivos, mas nao a hospedam |
| Hosted Zone AWS responde? | **Nao** -- os quatro NS esperados dao `REFUSED` |
| DNS funcionando hoje? | **Nenhum.** A, NS, SOA, MX, TXT -> `SERVFAIL` |
| DNSSEC | Nao ativo (sem DS) -- simplifica a troca |
| Operacao pendente na AWS | Nao verificavel (IAM); registro sem alteracao desde 01/12/2025 |
| Bloqueio para o SSL | O DNS. Security Group e Elastic IP ja resolvidos |
| Onde se corrige | **Painel da OVH**, apos a zona do Route 53 responder |
