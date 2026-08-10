# veri-finops-app

Portal FinOps da VERI: custos AWS consolidados, governança de contas e
orçamentos, sobre o PostgreSQL do pipeline FinOps existente.

## Onde está o quê

| Caminho | Conteúdo |
|---|---|
| [web/](web/) | Aplicação Next.js 16 + TypeScript. **[README da aplicação](web/README.md)** — inclui autenticação, comandos e convenções |
| [scripts/](scripts/) | Inspeção somente-leitura do schema, criação do role da aplicação e das tabelas de auth |
| [infra/](infra/) | `docker-compose.app.yml` (complementar) e `.env.example` |
| [docs/](docs/) | Runbook, schema real do banco, decisões de visualização, brandbook VERI |
| [assets/logos/](assets/logos/) | Identidade visual VERI |

## Documentos principais

- **[docs/RUNBOOK-app.md](docs/RUNBOOK-app.md)** — deploy, validação, rollback, autenticação, riscos
- **[docs/schema-snapshot.md](docs/schema-snapshot.md)** — schema real do PostgreSQL e achados de qualidade do dado
- **[docs/API-dados.md](docs/API-dados.md)** — endpoints de dados, filtros e contrato de resposta
- **[docs/DECISOES-dataviz.md](docs/DECISOES-dataviz.md)** — paleta validada e regras de gráfico
- **[docs/skill-veri.md](docs/skill-veri.md)** — Brandbook VERI v2.0

## Autenticação

E-mail e senha, sessão em banco, cookie HTTP-only, perfis `ADMIN` e `VIEWER`.
**Não há cadastro público.** Configuração, criação do primeiro administrador e
roteiro de teste: [web/README.md · Autenticação](web/README.md#autenticação).

## Regras do projeto

- Dado de custo vem **apenas** do PostgreSQL. Nunca Athena, S3 ou API AWS.
- A única chamada externa é a cotação USD/BRL no Banco Central, e ela é
  dispensável: se falhar, o portal segue exibindo USD.
- Valor oficial é **USD**. O BRL é estimativa visual e nunca é gravado.
- O PostgreSQL não tem exposição pública; o Metabase e o ETL seguem intocados.
- Nenhum dado mockado: sem banco, a tela mostra erro em vez de número inventado.
- Segredos nunca são versionados. Ver [infra/.env.example](infra/.env.example).
- Cores apenas da paleta oficial VERI.
