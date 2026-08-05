# Conhecimento do motor de pintura

Tudo que foi aprendido sobre o processo real de pintura de implementos e sobre
o comportamento do motor, consolidado em 2026-08-05.

**Hierarquia de documentos** — em caso de conflito, o de cima vence:

1. `api/PAINTING_PRODUCTION_DOCTRINE.md` — as regras do processo, ditadas pelo dono
2. `api/PAINTING_CASE_CATALOG.md` — cada caso com ID, condição e comportamento esperado (especificação executável, travada em `painting-vision/tests/test_casos.py`)
3. **este documento** — o porquê de cada regra, o que foi medido e o que ainda é chute
4. `analysis_v2/` — as 66 artes reanalisadas contra a doutrina
5. `analysis_v2/planos/` — planos de produção completos, gerados ponta a ponta
6. `api/PAINTING_COST_ENGINE_PLAN.md` — arquitetura; anterior às correções, ler com cuidado
7. `analysis/analysis_A..F.md` — **obsoleto**, mantido só como registro do que foi corrigido

---

## 1. A premissa que estava errada desde o começo

> "Nunca são usados adesivos já prontos. Os adesivos sempre são apenas para
> molde das pinturas."

**Adesivo nunca é produto final. Adesivo é máscara.** Tudo que aparece pintado
foi pintado. **A única etapa feita por máquina é o corte do vinil** — posicionar,
depilar, cortar in situ, mascarar, bater carvão, pintar e envernizar são todas
manuais.

As análises A–F violavam isso em 8 de 8 fatias. O efeito no orçamento: a lateral
do Astutilog saiu em **1 dia** contra ~4 reais; a do 2 Amigos, 4–5 dias contra ~8.

Curiosamente o `PAINTING_COST_ENGINE_PLAN.md` **já estava certo** neste ponto
(§35 diz textualmente que a empresa nunca usa vinil impresso). Quem violava o
plano eram as análises.

### Vocabulário

A peça chama-se **adesivo** ou **vinil** — nunca "máscara de máquina". A função
dela é ser máscara; o nome é adesivo.

---

## 2. O que decide o dinheiro

### 2.1 Fronteira tinta-tinta (T-T)

Duas cores **ambas não-brancas** se tocando. É o que gera mascaramento. Precisa
ser medida em **comprimento (cm)** e **curvatura**.

As análises A–F **nunca mediram** — presumiam. O custo de presumir corta nos dois
sentidos:

- **BURES 1**: zero T-T. Todas as cores separadas por filete de chapa de 1–10 cm.
  Uma sessão, um dia. A análise antiga declarava contato numa composição idêntica.
- **ACM lateral + traseira**: 32 pares, ~180 m de contato.

Mesma metragem de implemento, cronogramas incomparáveis.

**11 das 66 artes têm zero fronteiras T-T** → uma sessão, um dia: ATACADÃO (as
duas faces), AP RANCHARIA, AVGLOG, BERGAMINI, BAHIA SUL traseira, BALALAC (as
duas), BURES 1, Aquarela (as duas).

### 2.2 O que NÃO é T-T

| caso | porquê |
|---|---|
| tinta encostando em **chapa branca** | branco é chapa preservada, nunca tinta |
| tinta encostando na **pintura geral** | a geral é feita no dia anterior e chega curada; o adesivo assenta direto |
| duas cores separadas por **filete de chapa** | não há contato — e o detector **não pode dilatar por cima do filete** |
| dois **tons da mesma tinta** partidos pelo quantizador | é uma cor só |
| dois tons vizinhos de uma **rampa de degradê** | são tintas distintas (§3.2), mas a separação entre elas é **esfumada no acabamento**, não mascarada |

Contar branco como tinta apareceu em **8 de 8 artes** de uma das fatias e inventa
~45 fronteiras falsas só na "mar e rio" — transformando o elemento mais barato
(texto branco negativo, custo de tinta zero) no mais caro.

---

## 3. A árvore de decisão

```
duas cores DO DESENHO se tocam neste elemento?
├── NÃO → adesivo aplicado INTEIRO, depilado por cor.
│         Sem corte manual, sem verniz, sem espera.
└── SIM → cortável à mão?
          ├── SIM → menor cobertura primeiro: pinta → cura → mascara → pinta a maior
          └── NÃO → duas saídas:
                    a) pinta o fundo → seca → REAPLICA o adesivo → pinta
                    b) campo → enverniza → cura → adesivo → pinta  (a mais cara)
```

**Corte manual é raro.** Ele só existe para separar duas tintas. Sobre chapa o
adesivo vai inteiro e nada é cortado à mão.

### 3.1 Cortabilidade = espessura × retilineidade

Nenhuma das duas decide sozinha. Os triângulos do ACM são cor sobre cor, finos, e
**são cortados** porque são retos — o estilete corre. Um script da mesma espessura
é incortável porque muda de direção o tempo todo.

O critério que o dono verbaliza ao marcar é **simplicidade da forma**: *"corto pois
é simples"*, *"esse é muito difícil, não cortaria"*.

Medida do eixo de retilineidade: **vértices por metro** de contorno depois de
simplificar a 0,5 cm. Triângulo fica perto de 1/m; filigrana passa de dezenas.

---

## 3.2 Degradê: os tons SÃO tintas

Um degradê não é uma tinta com variação. **Pinta-se os 3 ou 4 tons em demãos
separadas e só depois se corta a separação entre eles para esfumar.** Cada tom
tem demão própria; o que muda é o acabamento, não a contagem.

Consequência: fundir tons de rampa **apaga demãos reais do orçamento**. O motor
os **marca** (`gradient: true` na paleta) em vez de absorvê-los.

Rampa não precisa da mesma resolução que tinta chapada — o pintor bate ~3 tons,
não 6. Por isso os tons marcados como rampa são consolidados entre si com passo
mais largo (`gradient_step_delta_e = 12.0`), mantendo-se como tintas próprias.

| arte | tintas chapadas | tons de rampa |
|---|---|---|
| BURES 2 | laranja, azul, cinza | 2 (com o azul base = os 3 do degradê) |
| 137 PESCADOS | 7 | nenhum — separação sólida |

**A diferença entre as duas artes** é essa: a BURES tem rampa contínua; o 137 tem
separação sólida entre dezenas de triângulos. O motor tem de distinguir as duas
coisas, e é a **pureza modal** que faz isso.

---

## 4. Técnicas de pintura — só existem duas

**Chapada** ou **aerográfica**. Ponto.

"Pintura artística à mão" e "aerografia" são **a mesma coisa**. As 9 "pendências
de aerografia × pintura à mão" que as reanálises levantaram nunca foram decisões.

Degradê é pintura aerográfica — rampa suave não sai de pistola chapada. *(derivado,
não confirmado)*

### 4.1 Aerografia leva adesivo

E leva **só do contorno externo**. Nada interno, nenhuma depilação de miolo: tudo
dentro da silhueta é à mão livre.

Consequência de custo nos dois sentidos: custa **mais** que "sem adesivo" (há
recorte, aplicação e remoção), e custa **menos** que um elemento normal da mesma
área (o corte é só o perímetro externo, ignorando `holes[]`).

Medido no polvo da "mar e rio": o cálculo somando anéis internos cobrava
**3421 cm contra 2657 corretos — 22% a mais**.

---

## 5. Fita — duas condições, e a segunda é do traçado

| substrato | traçado | fita | corte? |
|---|---|---|---|
| isoplastic ou lona | qualquer curva | **amarela** | não |
| chapa e demais | curva tranquila / horizontal | **amarela** | não |
| chapa e demais | muito vertical | **branca** | **sim** |

A amarela é flexível e acompanha a curva. A branca é mais larga mas rígida, e por
isso exige corte manual.

Faixa quase nunca leva adesivo. O `astutilog-sider` prova a regra sozinho: **mesmo
veículo, lona na lateral e chapa na traseira**, decisões opostas.

---

## 6. Sessões — agrupar cores que não se tocam

Pinta-se de uma vez **todas as cores que não se tocam entre si**, mascara-se todas,
corta-se, e só então entra o próximo grupo.

O número de sessões é o **número cromático** do grafo "cores que se tocam", não o
número de cores. Um mosaico low-poly de 6 azuis fecha em 3 ou 4 grupos, não em 6.

Isso vale para qualquer arte, não só mosaico.

---

## 7. Ordem, cobertura e acabamento

1. **Menor área primeiro** — é mais fácil de cobrir depois.
2. **Cobrir cada cor antes da próxima.** A cobertura é a **caixa** da peça, não as
   letras: não dá para recortar papel rente ao texto.
3. Se ainda falta cor **dentro do mesmo bounding**, cobre só a forma daquela cor.
4. Caixas de peças vizinhas se sobrepõem → **repartir por território** (a peça cuja
   forma está mais perto). Sem território, uma caixa apaga a outra.
5. **O papel fica até o fim.** Sai só no verniz final.
6. **Verniz sobre os boundings** do que foi pintado, não só o desenho — e seguindo
   o adesivo, sem envernizar chapa vazia entre elementos.
7. **Adesivo aplicado inteiro**; o que muda entre sessões é a depilação.

### 7.1 O adesivo também preserva o branco

Elemento com parte branca sobre chapa branca: **não se pinta o branco**. Depila só
a parte colorida; o adesivo fica sobre a parte branca e a chapa se preserva.

É a reserva aplicada na camada do adesivo — em vez de mascarar para preservar,
**não depilar** já preserva. Sai de graça.

---

## 7.2 Sessões: agrupar cores que não se tocam

Já descrito em §6. Implementado como **coloração gulosa do grafo** "cores que se
tocam", por grau decrescente.

Resultado medido no 137 PESCADOS: **5 sessões**, quatro delas de cor única. Num
mosaico low-poly cada azul encosta em quase todos os outros, então o grafo fica
denso e quase não há o que agrupar. Pode estar correto — mosaico é caro mesmo —
mas se na prática vários desses azuis vão juntos, a leitura de "se tocam" está
grosseira: contato de poucos centímetros talvez não deva contar. **Em aberto.**

---

## 8. Preparação — condicional

| fundo | lavagem | empapelamento |
|---|---|---|
| **pintura geral** | sim, face inteira | completo: perfis, borrachas, ferragens, refletiva |
| **chapa branca** | **não** | só uma cinta em volta de cada adesivo, contra overspray |

**A pintura geral ocupa o primeiro dia inteiro**, nesta ordem:

```
lavagem → empapelamento do implemento → pintura geral → CURA até o dia seguinte
                                                              ↓
                                              só então entram os adesivos
```

É por isso que encostar nela depois não custa verniz nem espera (§2.2). Colocar
a geral depois do empapelamento localizado contradiz a própria regra.

Aplicar o ciclo completo numa arte de chapa infla o orçamento com horas que não
acontecem.

---

## 9. Geometria e materiais

| medida | valor | fonte |
|---|---|---|
| folga entre o corte do plotter e a borda do adesivo | **8 cm** | dono |
| largura da folha de kraft | **100 cm** | dono |
| altura padrão do implemento | **2,45 m** | dono |
| **consumo de tinta** | pela área do **bounding** | dono |
| **comprimento de corte** | pelo perímetro da **forma** | derivado |

Não se pinta um texto de 5 cm de altura exatamente: pinta-se a **janela inteira**
e a máscara bloqueia o resto. Área de tinta e área de corte são grandezas
diferentes e não se substituem.
| janela de adesivo | **retangular** (o vinil é folha quadrada) | dono |
| janela de fita | segue a **forma** (a fita acompanha a curva) | dono |

A altura padrão resolve a escala das **56 artes cujo nome não traz o comprimento**:
o motor aceita `--reference-kind HEIGHT --reference-cm 245`.

**Escala jamais se presume.** Erro de escala já inverteu decisões nas análises
antigas: o contorno do "3" do 3 IRMÃOS foi chamado de "<6 mm" quando tem **5 cm**;
o script "Frutícula 2 Amigos" foi julgado "corte inviável" tendo **103 cm** de
altura de letra.

---

## 10. O caso extremo de referência — 2 Amigos

| elemento | técnica |
|---|---|
| morangos (fotográfico, 4,9 × 2,7 m por lado) | **aerografia** |
| banner dourado | **pintura com degradê**, cor sobre cor |
| texto "Frutícula 2 Amigos" | impossível cortar → adesivo **sobre o banner já pintado e envernizado** |
| texto cinza com marcação no meio | pinta o cinza base → fita e papel cobrindo o topo → degradê só embaixo |

A última linha é uma **segunda sessão de mascaramento dentro de um único elemento** —
invisível para qualquer análise que trate o elemento como uma cor só.

O texto tem letra de ~1 m de altura: **tamanho nunca foi o problema**. Ele é
incortável porque pousa sobre tinta curada, onde o estilete rasgaria a camada de
baixo.

---

## 11. O que o motor faz e o que erra

### 11.1 Achados sobre o `painting-engine`

| achado | onde | efeito |
|---|---|---|
| `background_index` é **um índice único** | `regions.py:247` | um segundo tom de branco vira tinta e todo elemento que o encosta "toca tinta" |
| `bbox` é (linha, coluna) mas `centroid` é (x, y) — **no mesmo struct** | `regions.py:30` | quem consumir o JSON troca os eixos e colapsa elementos |
| `merge_delta_e = 6.0` **nunca dispara** | `params.py:23` | parâmetro fantasma: em 24 artes, o ΔE mínimo entre sementes é exatamente 10,00 |
| piso algébrico de **ΔE 10,0 entre sementes** | `quantize.py` | **CORRIGIDO.** Bins LAB de 5,0 + supressão 3×3×3. O k-means nunca cria cluster que a semeadura não propôs |
| `#multi` marca região fotográfica | saída JSON | quem tratar todo `hex` como cor quebra |
| `dominant_curve` só nas T-T | saída JSON | **não é bug** — curvatura só importa onde há mascaramento |

### 11.2 A contradição central da quantização

O mesmo motor, com os mesmos parâmetros, erra nos **dois sentidos opostos**:

- **BURES**: separou 3 azuis que eram **um degradê**. Os ΔE de 9,7 e 13,0 entre
  eles são **artefato do passo do grid**, não propriedade da arte — o seeder
  fabrica uma cor a cada ~10 ΔE ao varrer uma rampa contínua.
- **137 PESCADOS**: fundiu **dezenas de triângulos** em 2 azuis. Os 6 azuis reais
  têm ΔE mediano de 5,5 entre vizinhos — matematicamente insemeáveis com piso 10.

**Discriminante correto: pureza modal** — a fração do RGB exato dominante dentro
do cluster. Tinta chapada fica entre 0,95 e 1,00; rampa de degradê entre 0,10 e
0,12. Banda vazia entre 0,12 e 0,65.

Exige amostrar na **resolução original**: o downscale LANCZOS destrói os valores
exatos de que a pureza depende.

Um discriminante por nitidez de interface foi testado e **falhou** (a BURES é
rampa ruidosa, 5–50 ΔE/px). Registrado para não ser retentado.

### 11.2-b O patch aplicado (2026-08-05)

Semeadura por **seleção gulosa com raio de exclusão** sobre bins de 2,0 LAB,
alimentada só por interiores chapados (`|∇LAB| < 1,0 ΔE/px`), mais o **portão de
pureza modal** que marca as rampas. `merge_delta_e` de 6,0 → 3,0 (agora dispara).

Uma mudança, os dois sentidos corrigidos:

| arte | antes | depois |
|---|---|---|
| 137 PESCADOS | 3 cores, 4 T-T | **7 cores, 142 T-T** |
| BURES 2 | 6 cores, 4 T-T | **4 cores, 2 T-T** |

Os 24 testes do motor passam. A fusão de tons do `painting-vision` foi
**desativada**: existia para compensar o artefato do seeder e, com a origem
corrigida, só reintroduzia encadeamento transitivo.

Parâmetros novos em `params.py`: `seed_bin_lab`, `seed_min_delta_e`,
`seed_flat_grad_max`, `seed_min_peak_pct`, `flat_modal_min`,
`flat_modal_sample_px`, `gradient_step_delta_e`.
Campo novo na paleta do JSON: `gradient: bool`.

### 11.3 Camada semântica

O motor decompõe por **cor**; a produção decompõe por **elemento**. A ponte é o
Qwen3-VL: uma faixa é **um** item resolvido por **uma** técnica, mesmo tendo
degradê e atravessando quatro regiões de cor.

Sem essa camada, a faixa da BURES virava quatro etapas de mascaramento por tom.
Nenhuma medida geométrica diz "isto é uma faixa".

---

## 12. Números — o que é medido e o que é chute

### Calibrado com o dono

| valor | significado |
|---|---|
| **8 cm** | folga entre o corte do plotter e a borda do adesivo |
| **100 cm** | largura da folha de kraft |
| **2,45 m** | altura padrão do implemento |
| **≥ 9,2 mm** | corte manual confirmado (ACM lateral, forma reta) |

O **piso** do corte segue desconhecido: o único "não corto" marcado tinha branco
entre as cores, ou seja, nem era cor sobre cor.

### Escolhidos por mim, sem observação

| valor | onde | decide |
|---|---|---|
| 55° | `VERTICAL_DEG` | fita amarela × branca |
| 16 ΔE | `GRADIENT_DELTA_E` | dois tons são a mesma tinta |
| 1,6× | filtro de região espalhada | descarte de região mal atribuída |
| 0,10 m² | `AVULSO_MIN_M2` | piso de ruído de quantização |
| 1,5 cm | folga de cobertura | papel × forma pendente |
| 5 cm | fusão de boundings | passadas de verniz |

Primeiros suspeitos quando um plano sair estranho.

---

## 13. Escala do acervo

| medida | valor |
|---|---|
| artes | 66 |
| resolução mediana | 9924 × 2838 px (28 MP) |
| maior | 18085 × 3246 px (58 MP) |
| artes com comprimento no nome | 10 de 66 |
| artes com zero T-T | 11 |
| fronteiras T-T medidas na reanálise | mais de 260 |

Downscale e tiling não são otimização, são requisito: 58 MP dariam ~74 mil tokens
de visão.

---

## 14. Bloqueios de arquivo encontrados

Travam produção, não só orçamento:

| arte | problema |
|---|---|
| **Agrícola Premium** | foto de 5,7 m²/lado com marca d'água de banco de imagens em mosaico — arquivo **não licenciado** |
| **137 PESCADOS traseira** | script cortado na borda ("us seja...") — arte incompleta |
| **2 Amigos** | espelhamento **seletivo**: o rodapé está invertido por erro, mas o "Я" do CARLOTTI é intencional de marca |
| **A&P FOODS** | erro tipográfico `PRODUTROS` nas duas peças |

---

## 15. Perguntas ainda abertas

| # | pergunta |
|---|---|
| `P2` | piso de cortabilidade em cor sobre cor — a rodada 3 da calibração foi invalidada por falsos positivos |
| `P3` | limiar de "muito vertical" para fita branca |
| — | degradê é sempre aerográfica? (derivado, não confirmado) |
