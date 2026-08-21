# Decisões de visualização de dados

> Contexto: o Brandbook VERI proíbe explicitamente "usar cores fora da paleta
> oficial". A paleta oficial é intencionalmente dessaturada (verde-sálvia). Isso
> cria uma tensão real com as boas práticas gerais de dataviz, que pedem marcas
> de croma médio e contraste ≥ 3:1. Este documento registra como a tensão foi
> resolvida, para que ninguém "corrija" depois criando cor nova.

## O limite duro: a paleta só distingue DUAS séries

Reexecutado em 11/08/2026, incluindo um terceiro verde da paleta oficial:

```
$ node validate_palette.js "#384E46,#7F9C90,#92ACA0" --mode light
[FAIL] CVD separation       pior par #92ACA0↔#7F9C90 ΔE 5,3 (protan) · 5,4 (tritan)
[FAIL] Normal-vision floor  pior par #92ACA0↔#7F9C90 ΔE 5,4 — abaixo de 15
```

`#92ACA0` e `#7F9C90` são **indistinguíveis até para quem tem visão de cores
normal**. Mostarda e vinho estão reservados para status. Cor nova é proibida
pelo brandbook.

**Consequência direta:** nenhum gráfico deste projeto pode usar cor para
identificar mais de duas séries. Isso não é preferência estética — é o teto da
identidade visual. Os dois gráficos multi-série do dashboard resolvem sem cor:

| Gráfico | Forma escolhida | Por quê |
|---|---|---|
| Evolução diária **por serviço** | **Small multiples** — um quadro por serviço, escala vertical compartilhada | 9 linhas numa cor só viram emaranhado. Cada quadro tem sua própria moldura e título; a comparação entre quadros continua válida porque a escala é a mesma |
| **Distribuição percentual** por serviço | **Barra de composição** (100% numa linha), fatias separadas por 2px da superfície, identidade no rótulo | Pizza de 9 fatias exigiria 9 cores. Comprimento se compara melhor que ângulo, e a soma-um fica explícita |

Pizza e rosca ficam **descartadas por impossibilidade**, não por gosto.

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
  com rótulo "US$ 0,00" é ruído. Aplicado no SQL (`round(total,2) > 0`), não no
  componente — assim vale para qualquer consumidor da API. O mesmo corte remove
  a fatia "Outros" quando ela não soma um centavo.
- **Conta sem carga não entra no gráfico de barras.** Uma barra de comprimento
  zero é invisível e indistinguível de "gastou zero". A ausência é dita em texto,
  abaixo do gráfico, nomeando a conta. Mostrar o que não existe exige palavra,
  não geometria.
- **Conversão para BRL é estimativa subordinada, nunca o número principal.**
  Revisão de 11/08/2026: a decisão anterior era não converter, por falta de taxa
  oficial. Com a integração PTAX do Banco Central passou a haver fonte
  rastreável — mas a PTAX de um dia **não é** a taxa que a fatura aplicou (falta
  spread e IOF). Então o BRL entra com hierarquia visual explicitamente menor:
  tinta secundária, corpo menor, prefixo `~`, e a palavra "estimativa" no
  rótulo. USD fica no card em destaque, com o corpo maior da tela. Ver
  [API-dados.md](API-dados.md).
