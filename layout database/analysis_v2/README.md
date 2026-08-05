# Reanálise v2 das 66 artes

Refeita em 2026-08-05 contra `api/PAINTING_PRODUCTION_DOCTRINE.md`, depois que o
dono corrigiu a premissa central: **adesivo nunca é produto final — é sempre e
apenas máscara para pintura.** Tudo que aparece pintado no implemento foi
pintado. A única etapa feita por máquina é o corte da máscara.

As análises originais (`../analysis/analysis_A..F.md`) violam isso de ponta a
ponta e **não devem ser usadas**. Ficam no repositório só como referência do que
foi corrigido.

Oito agentes trabalharam em paralelo, um por fatia, agrupando lateral e traseira
do mesmo cliente para que fossem julgadas juntas.

| fatia | artes | fronteiras T-T |
|---|---|---|
| [1](slice_1.md) | AGI SOLAR, AURIZ FOODS, AKTL, Agrícola Premium, BANANA OURO VERDE, COMFRO, mar e rio | 50 (~117 m) |
| [2](slice_2.md) | AGROMINA, ATACADÃO FOLLY, AP RANCHARIA, AVGLOG, BELLAVER, CJ PILGER | 20 + 3 a confirmar |
| [3](slice_3.md) | ACM, BAHIA SUL, astutilog-sider, BERGAMINI, CIPRIANO | ~50 tipos (~270 m) |
| [4](slice_4.md) | AAN, BALALAC, argus, BIAVA, Cavalcante | 18 |
| [5](slice_5.md) | A&P FOODS, BOI MIX, CLEBIN, BOIPORÉ, CASA DO QUEIJO | 24 loci (~104 m) |
| [6](slice_6.md) | 100FRONTEIRAS, BRAVO, BURES 1 e 2, BOM PEIXE, CASA DO PÃO DE QUEIJO | 27 |
| [7](slice_7.md) | 137 PESCADOS, 2 amigos, 3 IRMÃOS, BOX DA TERRA, CARLOTTI | 47 |
| [8](slice_8.md) | ADRI FRUTAS, Aquarela, AFO, Atacado Frios, Azzioly, SGT, Bismark | 32 macro |

**Mais de 260 fronteiras tinta-tinta medidas** em cm e curvatura. As análises
antigas mediram zero — presumiam. As unidades diferem entre fatias (pares, tipos
de par, loci), então o total não deve ser somado sem cuidado.

---

## Os erros que se repetiram

Ordenados por quantas fatias os encontraram **de forma independente**. Nenhum
agente via o trabalho dos outros, o que torna a convergência o sinal mais forte
de que a doutrina está certa.

### 1. Impressão digital como produto final — 8/8 fatias

Não é um deslize pontual: a `analysis_F` institucionaliza como **regra de
motor** ("asset com texto abaixo da altura mínima → impressão digital"), e a
`analysis_D` faz o mesmo com fotográfico/metálico. Aplicadas, mandariam imprimir
exatamente os elementos que definem o preço — o brasão da Bismark, os 4 selos da
Atacado Frios, 8,5 m² da CASA DO PÃO DE QUEIJO (>40% do painel), a lona inteira
do Astutilog.

Efeito no orçamento: a lateral do Astutilog saiu em **1 dia** contra ~4 dias
reais. A do 2 Amigos, 4–5 dias contra ~8.

### 2. Falta `MASCARA_MAQUINA_SOBRE_CHAPA` — 6/8 fatias

Levantado sozinho por seis agentes. Quando a máscara de máquina pousa sobre
**chapa nua**, não há tinta embaixo, logo não há verniz nem espera. Tratar esses
casos como `MASCARA_MAQUINA_SOBRE_VERNIZ` superestima ~3 h por peça, e isso
atinge metade das artes de algumas fatias.

Incorporado à doutrina como §3.2-a.

### 3. Fita escolhida pela curvatura, não pelo substrato — 4/8 fatias

A doutrina §4 escolhe pelo substrato: fita amarela (flexível, sem corte) só em
isoplastic ou lona; em chapa é fita branca, que não curva e exige corte.

Dois pares de artes fecham o argumento sozinhos:

- **astutilog-sider**: mesmo veículo, **lona na lateral e chapa na traseira** —
  regras opostas na mesma peça.
- **SGT**: a `analysis_F` chama a linha da pista de "literalmente o caso da fita
  amarela flexível", mas SGT é carga geral em chapa, onde a fita amarela é
  proibida. Orçou o caminho mais barato que existe para um substrato onde ele
  não está disponível.

### 4. Branco contado como tinta — 3/8 fatias, e 8/8 artes dentro delas

Branco é chapa preservada por máscara, nunca tinta. Contá-lo como cor inventa
fronteiras T-T que não existem: ~45 na "mar e rio", ~14 m na A&P. Transforma o
elemento **mais barato** de cada arte (texto branco negativo, custo de tinta
zero) no mais caro.

O `PAINTING_COST_ENGINE_PLAN.md` se contradizia neste ponto — já corrigido lá.

### 5. Ordem de pintura invertida — 4/8 fatias

As antigas ordenam por luminosidade ("claro → escuro") ou põem a maior cobertura
primeiro. A doutrina §2 ordena pela **cortabilidade da cor menor**. Custo medido:

| arte | mascararia | deveria mascarar |
|---|---|---|
| BRAVO traseira | 2,6 m² de cinza | 0,52 m² de verde |
| BOI MIX | 8,7 m² | 0,8 m² |
| BOIPORÉ | 5,6 m² | 0,6 m² |
| ADRI | 2,3 m² | 0,45 m² |

Quando as duas regras coincidem (Kidelli, Bismark), coincidem **por acaso** — o
que escondia o defeito.

### 6. T-T presumida sem medir — 3/8 fatias

O erro corta nos dois sentidos, e é o que mais justifica a medição:

- **BURES 1**: zero T-T — todas as cores separadas por filete de chapa de 1–10 cm,
  verificado em ampliação. Sessão única, 1 dia. A antiga declarava contato numa
  composição idêntica: 1 dia inteiro de diferença.
- **astutilog**: a antiga afirma que "ASTUTI" e "LOG" são adjacentes. Medido,
  a adjacência é **nula** — e mesmo se tocassem não seria T-T, porque branco não
  é tinta. Enquanto isso, o único T-T real da face (grafite×vermelho, ~10,6 m)
  nunca foi medido.
- **CLEBIN**: os arcos bordô e grafite **não se tocam** (13–29 cm de chapa).

**11 das 66 artes têm zero fronteiras T-T** → uma sessão, um dia: ATACADÃO
(lateral e traseira), AP RANCHARIA, AVGLOG, BERGAMINI, BAHIA SUL traseira,
BALALAC (lateral e traseira), BURES 1, Aquarela (lateral e traseira).

---

## Pendências para o dono

**Aerografia × pintura artística à mão** — nunca impressão. Cada uma muda o
cronograma em dias:

| arte | elemento |
|---|---|
| AURIZ FOODS | prato |
| Agrícola Premium | hortifruti |
| COMFRO | 2 blocos |
| mar e rio | polvo |
| astutilog | globo (×2 faces) |
| CIPRIANO | bandeira ondulante |
| CASA DO PÃO DE QUEIJO | bloco de 8,5 m² |
| Atacado Frios | selo facetado BRF |
| Bismark | brasão metálico |

**Resolvido**: 2 Amigos — morangos são aerografia, banner é pintura com degradê,
e o texto "Frutícula 2 Amigos" vai de máscara de máquina sobre o banner já
pintado e envernizado. É o caso extremo de referência da doutrina.

## Bloqueios de arquivo (impedem produção, não só orçamento)

- **Agrícola Premium** — foto de 5,7 m²/lado com marca d'água de banco de imagens
  em mosaico. Arquivo não licenciado.
- **137 PESCADOS traseira** — script cortado na borda ("us seja..."), arte incompleta.
- **2 amigos** — espelhamento **seletivo**: o rodapé está invertido, mas o "Я" do
  CARLOTTI é espelhamento intencional de marca. Não tratar os dois igual.
- **A&P FOODS** — erro tipográfico `PRODUTROS` nas duas peças.

## Erros de escala que inverteram decisões

Só visíveis medindo em cm reais. A antiga chamou de "<6 mm, integrar ao impresso"
o contorno do "3" do 3 IRMÃOS, que tem **5 cm**. Julgou "corte inviável" o script
"Frutícula 2 Amigos", cujas letras têm **103 cm** de altura. Mandou "CARLOTTI"
(87 cm) para o plotter.

Por isso `probe/difficulty.py` lê o comprimento do nome do arquivo
(`3 IRMÃOS 8,40`, `argus 14,70`, `ACM 8,30m`) em vez de presumir escala, e marca
`(comprimento PRESUMIDO)` quando não encontra.
