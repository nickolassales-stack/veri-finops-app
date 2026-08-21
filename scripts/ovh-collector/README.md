# POC OVHcloud -- coletor de billing

Prova de conceito para descobrir **o que a API da OVHcloud realmente entrega**
para FinOps, antes de escrever ETL. Somente leitura: nao grava no PostgreSQL,
nao toca no pipeline AWS, nao altera nada na OVH.

Implantado em `/opt/finops/ovh-collector/` na EC2. Versionado em
`scripts/ovh-collector/` -- **sem o `.env`**.

---

## 1. O que a POC responde

Tres perguntas que decidem o desenho do ETL, e que so a conta real responde:

1. **A credencial autentica e alcanca billing?** (`/me`, `/me/bill`)
2. **As faturas trazem linha a linha, ou so o total?** (`/me/bill/{id}/details`)
3. **Ha uso corrente e previsao por projeto Public Cloud?**
   (`/cloud/project/{id}/usage/current` e `/usage/forecast`)

O que ela **nao** faz: gravar em banco, agendar coleta, somar com AWS. Isso vem
depois, com o formato ja conhecido -- ver secao 7.

---

## 2. Gerar as credenciais

A OVH usa tres chaves. As duas primeiras identificam a *aplicacao*; a terceira
identifica a *autorizacao* que um humano concedeu a ela.

**Atencao a regiao.** `eu`, `ca` e `us` sao contas separadas na OVH, com consoles
diferentes. Uma credencial gerada em uma regiao devolve **403 na outra** -- erro
que parece falta de permissao e faz procurar no lugar errado.

| Regiao | Console de criacao |
|---|---|
| Europa | https://eu.api.ovh.com/createToken/ |
| Canada | https://ca.api.ovh.com/createToken/ |
| Estados Unidos | https://api.us.ovhcloud.com/createToken/ |

Passo a passo:

1. Abra o console da **sua** regiao e autentique com a conta OVH.
2. Preencha:
   - **Script name**: `veri-finops-poc`
   - **Validity**: comece com `1 day` para a POC. So estenda depois de saber que
     funciona -- token de validade longa e o que sobra esquecido em producao.
3. Em **Rights**, conceda **apenas leitura**:

   | Metodo | Caminho |
   |---|---|
   | `GET` | `/me` |
   | `GET` | `/me/bill` |
   | `GET` | `/me/bill/*` |
   | `GET` | `/cloud/project` |
   | `GET` | `/cloud/project/*` |

   Nao conceda `POST`, `PUT` nem `DELETE`. A POC so le, e um token que so le nao
   consegue causar dano nem por engano nem por bug.

4. Ao salvar, a OVH devolve **application key**, **application secret** e
   **consumer key**. O secret aparece **uma unica vez**.
5. Dependendo do fluxo, a OVH exige **validar o consumer key** num link. Enquanto
   nao for validado, toda chamada responde `403 This credential is not valid`.

---

## 3. Criar o `.env` na EC2

O `.env` real **nunca** e versionado. O modelo `.env.example` **e** versionado --
por isso ele so tem marcadores, e nao pode receber valor real.

```bash
cd /opt/finops/ovh-collector
cp .env.example .env
chmod 600 .env
nano .env
```

| Variavel | O que e |
|---|---|
| `OVH_ENDPOINT` | `ovh-eu`, `ovh-ca` ou `ovh-us` -- a regiao da conta |
| `OVH_APPLICATION_KEY` | chave da aplicacao |
| `OVH_APPLICATION_SECRET` | segredo da aplicacao (aparece uma vez so) |
| `OVH_CONSUMER_KEY` | autorizacao concedida a aplicacao |
| `OVH_ACCOUNT_ALIAS` | nome legivel, ex. `conta-ovh-ca` |
| `OVH_PROVIDER_ACCOUNT_ID` | id que a conta tera no VERI FinOps, ex. `ovh-main-ca` |

Se uma credencial for exposta -- colada em chamado, prompt, print ou commit --
**revogue no console e gere outra.** Rotacionar leva um minuto; descobrir o que
alguem fez com ela, nao.

---

## 4. Instalar e rodar

```bash
cd /opt/finops/ovh-collector
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python ovh_poc.py
```

O venv e **proprio**, separado de `/opt/finops/venv` (do ETL AWS). Compartilhar
significaria que instalar dependencia da POC pode quebrar a carga de custo AWS
das 08:00 -- risco sem contrapartida, ja que disco sobra.

Codigos de saida:

| Codigo | Significado |
|---|---|
| 0 | coleta concluida (pode haver endpoint com erro -- veja o resumo) |
| 2 | `.env` ausente, incompleto ou ainda com os marcadores |
| 3 | biblioteca `ovh` ou `python-dotenv` nao instalada |
| 4 | **a OVH recusou a autenticacao** -- regiao errada, consumer key nao validado, ou secret incorreto |

---

## 5. Ler o resultado

O terminal traz o resumo. O JSON sanitizado fica em
`out/ovh_poc_result.json`, com modo `600`.

```
  conta conectada        : xx12345-ovh  (conta-ovh-ca)
  faturas encontradas    : 14
  faturas detalhadas     : 3 de 3
  projetos Public Cloud  : 2
  usage/current OK       : 2 de 2
  usage/forecast OK      : 1 de 2
  chamadas totais        : 19  (3 com erro)
```

Os erros vem agrupados por **padrao de caminho**: quarenta faturas com o mesmo
`403` sao um problema, nao quarenta. A mensagem que a OVH devolve costuma dizer
exatamente qual permissao falta -- e o dado mais util da POC.

### O que e mascarado, e por que

O `/me` traz nome, e-mail, endereco, telefone e documento fiscal do titular. E
cada fatura traz **`pdfUrl`, que embute um token de acesso**: quem tiver a URL
baixa o PDF sem autenticar.

A sanitizacao acontece **antes de gravar**, nao na hora de exibir -- o arquivo em
disco ja nasce limpo. Campos de segredo viram `<omitido>`; dado pessoal e
mascarado preservando o formato (`a****@empresa.com`), porque saber que o campo
existe importa para desenhar o schema, e o valor nao.

Ainda assim: **o arquivo revela quanto a empresa gasta e em que.** Confira antes
de anexar em chamado.

---

## 6. Limitacoes -- leia antes de comparar com a AWS

**OVH nao tem equivalente ao CUR.** O CUR da AWS entrega arquivo particionado,
linha a linha, com custo amortizado e centenas de colunas. A OVH entrega API:
faturas fechadas e uso corrente. Sao granularidades diferentes, e forcar as duas
no mesmo schema achata a AWS ou infla a OVH.

**Uso corrente e visao operacional, do mes em andamento.** Muda ao longo do dia,
nao esta fechado e nao bate com fatura nenhuma. Serve para acompanhar consumo,
nao para conciliar contabilidade.

**Faturas sao a visao financeira.** So elas fecham com o que a empresa paga. Sao
o equivalente funcional da conciliacao que hoje se faz com o Cost Explorer.

**Forecast e estimativa.** A propria OVH projeta a partir do consumo corrente.
Nunca deve entrar como custo realizado numa tabela junto com valor de fatura --
misturar previsto e realizado na mesma coluna e como se produz relatorio que
ninguem confia.

**Moeda pode divergir.** A conta OVH tem moeda propria (`me.currency`), que pode
nao ser a mesma da AWS. Somar provedores exige decidir a moeda de referencia e a
data da cotacao -- decisao de negocio, nao de codigo.

**Rate limit existe.** Detalhar todas as faturas de uma conta antiga sao centenas
de chamadas. A POC detalha so as 3 mais recentes de proposito.

---

## 7. Proximos passos, se a POC funcionar

Nesta ordem, e cada um e uma decisao antes de ser codigo:

1. **Ler o JSON e decidir o schema.** As tabelas AWS (`aws_daily_costs`,
   `aws_monthly_costs`) tem colunas do CUR. Ha tres caminhos, e a escolha e
   arquitetural:
   - tabelas proprias `ovh_*` -- mais simples, mas duplica toda consulta;
   - tabelas genericas `cloud_costs` com coluna `provider` -- exige migrar a AWS,
     mexendo no que ja funciona;
   - tabelas `ovh_*` com uma **view** unificando as duas -- mantem o pipeline AWS
     intocado e da um ponto unico de leitura. **Provavelmente a melhor troca.**

2. **Cadastrar a conta em `cloud_accounts`.** A tabela ja tem coluna `provider`
   com default `'aws'` -- foi feita para isso. `OVH_PROVIDER_ACCOUNT_ID` vira o
   `account_id`. Sem cadastro, a aplicacao faz `LEFT JOIN` e a conta aparece sem
   alias.

3. **Escrever a migracao** seguindo o padrao de `scripts/migrations/`: aditiva,
   idempotente, com arquivo de rollback ao lado.

4. **Transformar a POC em collector.** O `ovh_poc.py` ja separa coleta de exibicao;
   o passo e trocar a saida JSON por `INSERT ... ON CONFLICT DO UPDATE`, como faz
   `scripts/etl/athena_to_postgres.py`.

5. **Registrar em `app_etl_runs`.** A tela de Diagnostico ja monitora execucoes por
   `source`. Um collector OVH que nao se registra la e um pipeline que ninguem ve
   falhar.

6. **Decidir a moeda** antes de somar provedores na mesma tela.

O que **nao** fazer: chamar a API da OVH pelo frontend. O portal nao tem, e nao
deve ter, credencial de provedor -- a mesma decisao ja registrada para a AWS em
`docs/AWS-INVOICING.md`.
