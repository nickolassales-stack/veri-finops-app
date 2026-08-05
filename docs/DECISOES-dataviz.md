# Decisões de visualização de dados

> Contexto: o Brandbook VERI proíbe explicitamente "usar cores fora da paleta
> oficial". A paleta oficial é intencionalmente dessaturada (verde-sálvia). Isso
> cria uma tensão real com as boas práticas gerais de dataviz, que pedem marcas
> de croma médio e contraste ≥ 3:1. Este documento registra como a tensão foi
> resolvida, para que ninguém "corrija" depois criando cor nova.

## Resultado da validação da paleta

Validador de paleta executado sobre as cores candidatas, superfície clara:

| Paleta testada | Resultado |
|---|---|
| `#7F9C90, #D6A461, #862041` | **FAIL** — piso de visão normal 14,1 (mínimo 15) entre mostarda e verde; contraste 2,9 e 2,19 |
| `#384E46, #7F9C90` | CVD **PASS** (ΔE 26,4) · visão normal **PASS** (26,4) · contraste: verde em 2,9 (WARN) |
| `#384E46` isolado | contraste **PASS** (≥ 3:1) |

Duas checagens falham em **todas** as combinações possíveis:

- **Piso de croma** — `#7F9C90` (0,037) e `#384E46` (0,030) "leem como cinza".
- **Banda de luminosidade** — `#384E46` (0,403) e `#862041` (0,42) são escuros demais.

Ambas são propriedades intrínsecas da identidade VERI. Corrigi-las exigiria cor
fora da paleta, o que o brandbook proíbe. Como os gráficos são de **série única**,
"ler como cinza" não gera confusão entre séries — o risco que a checagem existe
para prevenir não se materializa aqui. Decisão: manter a paleta da marca e
compensar com as medidas abaixo.

## Regras aplicadas

| Situação | Decisão | Motivo |
|---|---|---|
| Marca de **linha** | `#384E46` (verde escuro) | única cor da paleta que passa contraste; numa linha de 2px o verde claro desapareceria |
| Preenchimento de **barra** | `#7F9C90` (verde) | permitido **somente com** rótulo de valor direto em cada barra **e** visão de tabela ao lado — o WARN de contraste exige esse alívio e não é dispensável |
| **Duas séries** | `#384E46` + `#7F9C90` | único par autorizado: passa CVD e visão normal com ΔE 26,4 |
| **Período futuro** | textura (hachura 45°) na mesma cor + rótulo textual | mostarda contra verde dá ΔE 14,1, abaixo do piso. Textura resolve sem introduzir cor |
| **Status** (mostarda, vinho) | reservados para estado, sempre com texto ao lado | nunca reaproveitados como "série 3" |
| **Legenda** | ausente nos gráficos de série única | o título do card nomeia a série; legenda de um item é ruído |
| **Tema escuro** | não implementado | o brandbook não define paleta escura; inventá-la seria criar identidade sem aprovação |

## Escala do eixo Y

- **Barra**: base sempre em zero. O comprimento da barra codifica magnitude;
  truncar a base mente sobre a proporção.
- **Linha**: escala focada na faixa do dado (`domain={["auto","auto"]}`). Com base
  em zero, a variação real de US$ 8,53 a US$ 10,21 virava uma reta e escondia o
  movimento que o gráfico existe para mostrar.

## Honestidade dos números

Decisões que vieram do dado real, não de estética:

- **Variação mês-a-mês só aparece como percentual quando é comparável.** Se o
  conjunto de contas com dado muda entre os meses, a interface diz
  "variação não comparável" em vez do número. Sem isso, o painel mostraria −88%
  entre julho e agosto de 2026 — que é partição faltando no Athena, não queda de
  custo. Ver `docs/schema-snapshot.md`.
- **"Sem dado" nunca é exibido como US$ 0,00.** São coisas diferentes: custo zero
  é informação, ausência de carga é falha de pipeline.
- **Serviço cujo total arredonda para US$ 0,00 sai do ranking.** Barra invisível
  com rótulo "US$ 0,00" é ruído.
- **Sem conversão para BRL.** Não há regra cambial oficial definida; exibir valor
  financeiro com taxa inventada é pior que exibir em USD.
