# Análise de Produção v2 — Fatia 6

Refeita contra `api/PAINTING_PRODUCTION_DOCTRINE.md` (ago/2026), que tem
precedência sobre `layout database/analysis/analysis_*.md`.

**Premissas desta revisão (não negociáveis):**

- **Adesivo nunca é produto final.** Todo vinil recortado citado aqui é
  **máscara de pintura**. Não existe "painel impresso", "vinil final",
  "impressão digital" como entrega.
- **A única etapa de máquina é o corte do formato da máscara.** Posicionar,
  depilar, cortar in situ, bater carvão, mascarar, pintar e envernizar são
  manuais.
- **Branco nunca é tinta.** Todo branco é chapa original preservada por máscara.
  Onde um branco aparece *sobre* uma cor (ex.: letras brancas dentro do selo
  vermelho da BRAVO), a leitura correta é: aquela ilha de chapa foi **reservada
  desde o início** — nunca "branco pintado por cima".
- **Fronteira T-T** = duas cores *ambas não-brancas* em contato. Só T-T gera
  mascaramento. Contato com a chapa branca (T-F) não gera.
- **Ordem**: a cor de **menor cobertura** vem primeiro, é mascarada, e a de
  maior cobertura vem por cima (§2).
- **Blocos fotográficos** = **PENDÊNCIA do dono** (aerografia × pintura
  artística à mão). Nunca impressão.

Escalas usadas: altura de baú assumida em 2,60 m (2,42 m no BOM PEIXE, cuja
largura de 9,50 m está no nome do arquivo). Todas as medidas em cm são
derivadas do pixel-para-cm de cada arte e estão marcadas como estimativas.

---

## Tabela-resumo

| # | Arte | Substrato provável | Fundo | Nº fronteiras T-T (pares de cor / segmentos) | Estratégia dominante | Complexidade |
|---|---|---|---|---|---|---|
| 1 | 100FRONTEIRAS 15 lateral | CHAPA_BRANCA | chapa original preservada ~93% (sem pintura geral) | **2 pares / 2 segmentos** (≈3,8 m) | CORTE_MANUAL + 1 máscara-máquina só para as estrelas/faixa da bandeira | **baixa** |
| 2 | 100FRONTEIRAS traseira | CHAPA_BRANCA | chapa original preservada ~96% (fundo cinza-gelo AMBÍGUO) | **2 pares / 2 segmentos** (≈1,3 m) | CORTE_MANUAL + PENDÊNCIA na bandeira (detalhe sub-centimétrico) | **média** (só por causa da bandeira) |
| 3 | BRAVO traseira | CHAPA_BRANCA | chapa preservada ~48%; ~52% pintado (bloco chevron) | **5 pares / ~10 segmentos** (≈11,4 m) | CORTE_MANUAL nas retas longas + MASCARA_MAQUINA nos 2 selos e no "K" Kovell | **alta** |
| 4 | BRAVO lateral | CHAPA_BRANCA | chapa preservada ~85%; bloco chevron ~13% | **5 pares / ~8 segmentos** (≈7,6 m) | CORTE_MANUAL + MASCARA_MAQUINA (selos, Kovell) | **média-alta** |
| 5 | BURES 1 | CHAPA_BRANCA | chapa original preservada ~78% | **0 pares** — todas as cores separadas por filete de chapa | CORTE_MANUAL, **sessão única** (+ aerografia do degradê dourado) | **baixa** |
| 6 | BURES 2 | CHAPA_BRANCA | chapa original preservada ~74% | **1 par / 2 segmentos** (≈6,8 m) | CORTE_MANUAL (curva suave longa) | **média** |
| 7 | BOM PEIXE 9,50 | ISOPLASTIC (pescado/isotérmico) | chapa original preservada ~88% | **1 par / 2 segmentos** (≈7,9 m) | CORTE_MANUAL (crescente afilado) | **média** |
| 8 | CASA DO PÃO DE QUEIJO | ISOPLASTIC (refrigerado) | **PINTURA GERAL** ~98% (vinho ~68% + amarelo ~30%); chapa preservada ≈2% | **11 pares / dezenas de segmentos** | PINTURA GERAL + **PENDÊNCIA fotográfica maciça** (aerografia × pintura à mão) | **extrema** |

**Total da fatia: 27 pares de cor T-T distintos.**

---

# 1. 100FRONTEIRAS 15 lateral.jpg

### 1. Implemento e substrato provável
Lateral de baú/carreta longa. Proporção medida **6,02:1** (1600×266 px). Com
altura de painel de 2,60 m isso dá **15,65 m de comprimento** — bate com o "15"
do nome do arquivo (baú de 15 m, carreta ou bitrem). Painel liso, sem frisos
representados no mockup.

**Substrato: CHAPA_BRANCA.** Justificativa doutrinária (§4): é uma
transportadora de carga geral, não frigorífico — não há indício de isotérmico
(sem perfis de canto grossos, sem tom marfim de isoplastic). O fundo renderiza
como branco-de-chapa (~#F2F2F2) e não como o off-white amarelado típico do
isoplastic. **Consequência prática: fita amarela está proibida aqui.** Só sobra
fita branca (larga, não faz curva, exige corte) ou corte manual de máscara. Como
esta arte não tem nenhuma faixa contínua, a questão da fita é irrelevante e tudo
cai em corte manual — mas se o cliente pedir faixa refletiva ou friso, será
**FITA_BRANCA + corte**, não amarela.

Se na inspeção física o baú for isoplastic, muda uma coisa só: lixamento após
retirada da máscara, e libera fita amarela para qualquer friso adicionado.

### 2. Fundo
**Chapa branca original, SEM pintura geral.** ~93% do painel é fundo. Só a
logomarca é pintada (~7%, concentrada em ~8,0 m × 1,3 m no centro do painel).
Não há nenhum campo de cor grande. Não existe branco pintado nesta arte: o
branco/vazio é chapa preservada por empapelamento simples (papel + fita), sem
nem precisar de máscara vinílica.

### 3. Inventário de elementos
Escala derivada: 1565 cm / 1600 px ≈ **0,98 cm/px** (praticamente 1 cm = 1 px).

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Numeral "1" verde | "1" | 41 cm larg × 124 cm alt |
| E2 — Numerais "00" verdes (dois lobos arredondados sobrepostos, formando um trevo) | "00" | 135 cm larg × 124 cm alt |
| E3 — Losango amarelo (bandeira do Brasil), inscrito no interior de E2 | — | 103 cm × 61 cm (diagonais) |
| E4 — Círculo azul-marinho, inscrito em E3 | — | Ø 45 cm |
| E5 — Faixa branca curva atravessando E4 | — | ~7 cm de altura |
| E6 — Micro-texto verde sobre E5 | "ORDEM E PROGRESSO" | letras ~3 cm de altura, traço ~0,5 cm |
| E7 — Estrelas brancas dentro de E4 | (27 estrelas) | 1 a 3 cm cada |
| E8 — Palavra laranja | "FRONTEIRAS" | 605 cm larg × 124 cm alt (altura de caixa) |
| E9 — Palavra cinza-chumbo | "TRANSPORTADORA" | 431 cm larg × 29 cm alt, traço ~6 cm |

Observação de leitura: a marca lê "100FRONTEIRAS" porque o segundo "0" e o "F"
são justapostos, mas **há respiro de chapa de ~6 cm entre eles** — não encostam.

### 4. Paleta
Cinco cores, **todas chapadas, zero degradê**:

- Verde-bandeira (~#1B7A4B) — chapada — E1, E2, E6
- Amarelo-ouro (~#F5D000) — chapada — E3
- Azul-marinho (~#0B2A6B) — chapada — E4
- Laranja (~#F1913C) — chapada — E8
- Cinza-chumbo (~#3A3A3C) — chapada — E9
- (Branco = chapa preservada — E5, E7 e todo o fundo)

Nenhum metálico, nenhum efeito 3D, nenhuma transição. É uma arte quase ideal
para laca chapada.

### 5. Fronteiras T-T (crítico)

**Só existem 2 fronteiras T-T em 15,65 m de implemento, e as duas estão
confinadas dentro de um retângulo de 103 × 61 cm (a bandeirinha).**

| # | Par (ambas não-brancas) | Extensão do contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Verde (E2) × Amarelo (E3)** | ≈ **240 cm** (4 lados do losango, ~60 cm cada) | **reta** — 4 segmentos retilíneos com 4 vértices agudos (raio de curvatura → 0 nos cantos) | **Verde** (≈1,9 m² contra ≈0,10 m² do amarelo) — 19× maior |
| T-T 2 | **Amarelo (E3) × Azul (E4)** | ≈ **141 cm** (circunferência de Ø 45 cm) | **fechada** e constante — raio 22,5 cm, sem inflexão | **Azul** (≈0,16 m² contra ≈0,10 m² do amarelo restante em coroa) |

**Pares que NÃO se tocam — declarados explicitamente (isto é o que libera
sessões conjuntas):**

- **Verde × Laranja**: NÃO se tocam. Respiro de chapa de ~6 cm entre o "0" e o
  "F", ao longo de ~124 cm de altura.
- **Laranja × Cinza-chumbo**: NÃO se tocam. Respiro de ~12 cm entre a linha de
  base de "FRONTEIRAS" e o topo de "TRANSPORTADORA".
- **Verde × Azul**: NÃO se tocam. O círculo azul está inteiramente contido no
  losango amarelo, com coroa amarela de 8–14 cm em toda a volta.
- **Verde × Cinza**: NÃO se tocam (separados por ~4,3 m de chapa).
- **Verde (micro-texto E6) × Azul (E4)**: NÃO se tocam. O texto está sobre a
  faixa branca E5, que o separa do azul por ~2 cm em toda a volta. Portanto E6 é
  **T-F**, não T-T.
- **Branco (E5, E7) × Azul**: T-F por definição (branco = chapa).

Soma de fronteira T-T da arte: **≈ 3,8 m**, em 15,65 m de implemento. É um dos
casos mais baratos possíveis.

### 6. Ordem de pintura (§2 — menor cobertura primeiro)

Áreas estimadas: amarelo (coroa do losango, já descontado o círculo) ≈ **0,10
m²** < azul ≈ **0,16 m²** < laranja ≈ **1,1 m²** < verde ≈ **1,9 m²** < cinza ≈
**0,35 m²**.

1. **Amarelo antes do azul** (T-T 2): amarelo em coroa tem 0,10 m² contra 0,16
   m² do azul. Mascarar a coroa amarela custa menos máscara e menos corte que
   mascarar o disco azul. → pinta amarelo, cura, mascara amarelo, pinta azul.
2. **Azul (e amarelo) antes do verde** (T-T 1): o conjunto bandeira (0,26 m²) é
   7× menor que o verde (1,9 m²). Mascarar a bandeira inteira é um retângulo de
   103×61 cm; mascarar o verde seriam 1,9 m² de recorte de dois numerais. →
   pinta a bandeira toda, cura, mascara a bandeira, pinta o verde.
3. **Laranja e cinza**: não tocam nada. Não entram em nenhuma cadeia de ordem —
   podem ser pintados a qualquer momento. Vão junto com o verde para economizar
   ciclo.

Ordem final: **amarelo → azul → (verde + laranja + cinza) → verniz.**

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa (§3: "um humano corta isso com estilete, no implemento?") |
|---|---|---|
| E8 "FRONTEIRAS" (10 letras, 6,05 m, caixa 124 cm) | **CORTE_MANUAL** | Sans-serif geométrica, hastes retas, contra-formas grandes (o "O" tem 60 cm de vão). Corte com régua sobre a laca curada. Sim, humanamente cortável — e evita máquina + ciclo de verniz. |
| E1+E2 "100" verde (2 lobos + haste) | **CORTE_MANUAL** | Duas circunferências de ~68 cm de raio externo e uma haste reta. Curva ampla, sem ilha. Trivial à mão. |
| E9 "TRANSPORTADORA" (14 letras, caixa 29 cm, traço 6 cm) | **CORTE_MANUAL** | 29 cm de altura e 6 cm de traço estão bem acima do limiar humano. Não é "texto pequeno". Cortável. |
| E3 losango amarelo (103×61 cm) | **CORTE_MANUAL** | 4 retas. O caso mais fácil que existe. |
| E4 círculo azul (Ø 45 cm) | **CORTE_MANUAL** | Círculo único de raio 22,5 cm — compasso de corte ou gabarito. |
| E5 faixa branca (chapa) + E7 27 estrelas (1–3 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ** — mas na variante **direto sobre a chapa** | 27 ilhas de 1–3 cm mais uma faixa curva de 7 cm: impossível de depilar e posicionar à mão com registro. **Porém**: como estrelas e faixa são *chapa preservada*, a máscara recortada a máquina é aplicada **sobre a chapa nua**, antes do azul — não exige ciclo de verniz. Custo = 1 corte de máquina, zero espera de cura extra. |
| E6 micro-texto "ORDEM E PROGRESSO" (3 cm, traço 0,5 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (variante sobre chapa) | Traço de 0,5 cm em texto curvo — fora do alcance do estilete. Vai na mesma máscara-máquina de E5/E7, como contra-máscara: a máquina corta as letras vazadas na ilha da faixa; o verde entra por elas na sessão do verde. |
| Empapelamento do fundo | **—** (papel + fita, sem vinil) | 93% do painel é chapa preservada em áreas amplas e retas: papel kraft e fita bastam, não se gasta máscara vinílica. |

Nada nesta arte pede espovo: §3.3 exige "muito grande **e** muito fácil" e
"raramente escolhido". O maior elemento (FRONTEIRAS, 6 m) é fácil, mas o corte
manual da máscara já é mais rápido que furar 6 m de kraft.

### 8. Sequência de sessões e dias (§6)

- **Preparação (D1 manhã)**: lavar 15,65 m, empapelar perfis, borrachas,
  ferragens; marcar a linha de base da logo com laser (em 15 m, 2 mm de erro
  aparece); aplicar a máscara-máquina das estrelas + faixa + micro-texto sobre a
  chapa, dentro da área do futuro círculo azul.
- **Fundo/pintura geral**: **não há**. Pula-se a etapa mais cara.
- **Sessão 1 (D1 tarde) — AMARELO** (0,10 m²): pinta a coroa do losango. Cura.
- **Sessão 2 (D1 fim de tarde) — AZUL** (0,16 m²): mascara o amarelo, pinta o
  disco azul por cima das ilhas de estrela já posicionadas. Cura.
- **Sessão 3 (D2 manhã) — VERDE + LARANJA + CINZA-CHUMBO juntos**: as três não
  se tocam entre si (§6.4) — mesma sessão, três pistolas/três recargas, um único
  ciclo de mascaramento. Mascara a bandeira inteira; pinta verde (E1, E2 e o
  micro-texto E6 pela contra-máscara), laranja (E8) e cinza (E9).
- **Verniz (D2 tarde)**: verniz geral.

**Total: 2 dias.** O gargalo é o comprimento (15,65 m de preparação e
alinhamento), não a complexidade gráfica. Com equipe dupla, cabe em 1,5 dia.

### 9. Armadilhas para o motor de visão

1. **Falsa T-T verde×laranja**: o respiro entre "0" e "F" tem ~6 cm reais mas
   ~6 px no raster. Antialiasing fecha esse vão e o motor reporta uma T-T
   vertical de 124 cm que não existe — o que mudaria a arte de "3 sessões" para
   "4 sessões". Quantizar **antes** de segmentar.
2. **Falsa T-T laranja×cinza** pelo mesmo motivo (12 cm de respiro).
3. **Explosão de clusters na bandeira**: 27 estrelas + faixa + micro-texto em
   0,6 m² geram mais componentes conexos que o resto dos 15 m inteiros. Um motor
   que conta componentes por área classificaria a arte como "alta complexidade"
   quando ela é de baixa complexidade com **um** bolsão localizado.
4. **Branco lido como cor**: as estrelas e a faixa são chapa. Um motor que
   quantiza e trata branco como paleta vai gerar "azul × branco = T-T" e propor
   mascaramento onde não há nada a proteger.
5. **Micro-texto verde sobre faixa branca** pode ser lido como verde adjacente
   ao azul (a faixa some no raster) → falsa T-T verde×azul, quando na verdade
   verde e azul **nunca se tocam** nesta arte.
6. **Escala**: a proporção 6:1 esconde que a logo ocupa 8 m. Um motor que
   normaliza a imagem perde a informação de que "TRANSPORTADORA" tem 29 cm de
   caixa (pintável) e não 3 cm (não pintável). Sem âncora métrica do implemento,
   a árvore do §3 decide errado.
7. **Cantos do losango**: raio de curvatura → 0 em 4 vértices. Um histograma de
   curvatura reportaria "curvatura extrema", disparando MASCARA_MAQUINA, quando
   o vértice agudo é justamente o mais fácil de cortar à mão (duas retas se
   encontrando).

### 10. Correções à análise antiga

A `analysis_D.md` não cobre esta arte (ela cobre Azzioly…BOI MIX), mas suas
**regras transversais** seriam aplicadas aqui e estão erradas:

- **`analysis_D` §PADRÕES-4 — "Texto pequeno nunca se pinta: altura < ~5–8 cm →
  vinil final/impressão (fones, endereços, selos SIF, slogans, sementes)"**:
  **ERRADO**. Não existe "vinil final". O micro-texto "ORDEM E PROGRESSO" (3 cm)
  é **pintado** através de máscara recortada a máquina (§3.2). O corte de máquina
  é permitido; a *entrega em adesivo* não é.
- **`analysis_D` §PADRÕES-5 — "fotográfico/metálico → impressão do bloco
  inteiro"**: **ERRADO** como categoria. Aqui não se aplica (não há fotográfico),
  mas a regra precisa sair do motor: o destino de um bloco irredutível é
  **PENDÊNCIA (aerografia × pintura à mão)**, nunca impressão.
- **`analysis_D` §1 Azzioly item 5 — "slogan script fino → vinil recortado final
  ou impressão"**: **ERRADO** pelo mesmo motivo; o análogo direto aqui seria
  "TRANSPORTADORA em vinil". É pintado, com corte manual.
- **`analysis_D` não mede fronteira T-T**: ela reporta "TODAS T-F / zero fita"
  (Azzioly §6) sem comprimento nem curvatura nem qual cor cobre mais. Sem isso
  não dá para aplicar §2. Nesta arte, a diferença entre "amarelo primeiro" e
  "azul primeiro" é 60% de área de máscara.
- **`analysis_D` não amarra substrato a fita**: ela cita "fita flex"
  (BAHIA SUL §5) sem a regra do §4. Aqui, em chapa branca, **fita amarela é
  proibida** — informação que muda o orçamento de qualquer friso adicionado.
- **O que a `analysis_D` acertou e deve ser mantido**: §PADRÕES-3, "keyline de
  fundo entre cores converte T-T em 2×T-F". É exatamente o que acontece aqui
  entre o "0" e o "F" e entre o micro-texto e o azul.

---

# 2. 100FRONTEIRAS traseira.jpg

### 1. Implemento e substrato provável
Traseira de baú: proporção **0,99:1** (1578×1600 px) → ≈ **2,50 m de largura ×
2,53 m de altura**. É o par da arte 1. Duas portas com **junta vertical central
em x ≈ 125 cm**, dobradiças, fechos e travessas — nada disso representado no
mockup, e tudo isso é geometria física que o planejamento tem de injetar.

**Substrato: CHAPA_BRANCA**, mesmo raciocínio da arte 1 (mesmo cliente, mesmo
conjunto). **Fita amarela proibida**; qualquer friso/refletiva vira FITA_BRANCA
com corte, ou corte manual.

### 2. Fundo
**Chapa original preservada, ~96%** — a arte ocupa só a faixa superior
(0–~40 cm do topo). Sem pintura geral.

**Ressalva importante e explícita**: o fundo renderiza mais cinza aqui
(~#E5E5E5) do que na lateral (~#F2F2F2). São dois mockups do mesmo cliente com
fundos diferentes — quase certamente artefato de renderização. Se o cliente
exigir esse cinza como cor real, a arte deixa de ter 0% de pintura geral e passa
a ter **~96% de pintura geral**, e *todas* as fronteiras hoje T-F viram T-T. Isso
muda o cronograma de 1 dia para 3–4 dias. **Decisão humana obrigatória antes de
orçar** — e é a mesma armadilha que a `analysis_D` já tinha visto no BALALAC.
Recomendação: tratar como chapa preservada (branco nunca é tinta) até prova em
contrário.

### 3. Inventário de elementos
Escala derivada: 250 cm / 1578 px ≈ **0,158 cm/px** (6,3 px/cm).

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — "1" verde | "1" | ~7 cm larg × 36 cm alt |
| E2 — "00" verde (trevo) | "00" | ~39 cm larg × 36 cm alt |
| E3 — Losango amarelo | — | **33 cm × 21 cm** |
| E4 — Círculo azul-marinho | — | **Ø 15 cm** |
| E5 — Faixa branca curva | — | **~2,1 cm de altura** |
| E6 — Micro-texto verde | "ORDEM E PROGRESSO" | **letras ~1,2 cm; traço ~0,2 cm** |
| E7 — 27 estrelas brancas | — | **0,3 a 0,8 cm cada** |
| E8 — Palavra laranja | "FRONTEIRAS" | ~180 cm larg × 36 cm alt |
| E9 — Palavra cinza-chumbo | "TRANSPORTADORA" | ~128 cm larg × 8,5 cm alt, traço ~1,8 cm |

A logo inteira mede ~232 cm de largura e começa a ~10 cm da borda esquerda:
**a junta central das portas (x≈125 cm) atravessa a palavra "FRONTEIRAS" na
região das letras "T/E"**.

### 4. Paleta
Idêntica à arte 1: verde-bandeira, amarelo-ouro, azul-marinho, laranja,
cinza-chumbo. **Todas chapadas, zero degradê.** Branco = chapa.

### 5. Fronteiras T-T

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Verde × Amarelo** (perímetro do losango) | ≈ **80 cm** (4 lados de ~20 cm) | **reta**, 4 vértices agudos | **Verde** (≈0,16 m² × ≈0,012 m² do amarelo) |
| T-T 2 | **Amarelo × Azul** (circunferência) | ≈ **47 cm** (Ø 15 cm) | **fechada**, raio 7,5 cm constante | **Azul** (≈0,018 m² × ≈0,012 m²) |

**Não se tocam (explicitamente):**

- **Verde × Laranja**: respiro de **~1,9 cm** ao longo de 36 cm. Existe, mas é
  fino: no limite da tolerância de máscara. Tratar como fronteira de risco —
  se a equipe não garantir 1,9 cm de registro, converter em T-T e separar as
  sessões.
- **Laranja × Cinza-chumbo**: respiro de **~3 cm**. Não se tocam.
- **Verde × Azul**: não se tocam (coroa amarela de 2,5–4 cm em volta).
- **Verde (E6) × Azul (E4)**: não se tocam (faixa branca E5 entre eles, ~0,4 cm
  de folga — no limite da resolução real).
- Todo o resto contra a chapa: T-F.

Soma T-T: **≈ 1,3 m**.

### 6. Ordem de pintura
Mesma cadeia da arte 1, com áreas 8× menores:
**amarelo (0,012 m²) → azul (0,018 m²) → verde (0,16 m²)**; laranja (0,10 m²) e
cinza (0,03 m²) não entram em cadeia nenhuma.

Justificativa por par:
- amarelo antes de azul: a coroa amarela é ~⅔ da área do disco azul; mascarar a
  coroa é mais barato.
- bandeira antes do verde: a bandeira toda (0,03 m²) é 5× menor que o verde.
  Mascarar um retângulo de 33×21 cm contra recortar 0,16 m² de numerais — não há
  discussão.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E8 "FRONTEIRAS" (caixa 36 cm) | **CORTE_MANUAL** | Caixa de 36 cm, hastes de ~5 cm. Cortável com folga. **Máscara dividida em duas peças na junta central** — nunca uma máscara única atravessando a fresta das portas. |
| E1+E2 "100" (36 cm) | **CORTE_MANUAL** | Curvas amplas, raio ~9 cm. Cortável. |
| E9 "TRANSPORTADORA" (caixa 8,5 cm, traço 1,8 cm) | **CORTE_MANUAL**, no limite | 1,8 cm de traço é fino mas cortável por mão treinada; 14 letras. Se a equipe não tiver faca fina, cai para MASCARA_MAQUINA_SOBRE_VERNIZ. Elemento de calibração do limiar `cortavel_a_mao`. |
| E3 losango (33×21 cm) | **CORTE_MANUAL** | 4 retas. |
| E4 círculo (Ø 15 cm) | **CORTE_MANUAL** | Círculo único de 7,5 cm de raio. Cortável com gabarito. |
| E5 + E7 + E6 (faixa 2,1 cm, 27 estrelas de 0,3–0,8 cm, letras de 1,2 cm com traço de 0,2 cm) | **PENDÊNCIA** → e, se for adiante, **MASCARA_MAQUINA_SOBRE_VERNIZ** | **Este é o único ponto duro da arte.** Estrelas de 0,3–0,8 cm e traço de 0,2 cm estão abaixo do que uma máscara vinílica consegue depilar e abaixo do que uma pistola consegue resolver sem sangramento por baixo do filme. Não é questão de corte manual × máquina: mesmo a máquina corta, mas o **depilar** e o **posicionar** 27 ilhas de 3–8 mm são inviáveis. **Duas saídas reais, decisão do dono:** (a) aerografia fina / pintura artística à mão do brasão (o brasão inteiro tem só Ø 15 cm — é um trabalho de pincel de 1–2 h para um artista); (b) negociar com o cliente a **simplificação do brasão** nesta peça (círculo azul liso com a faixa, sem as 27 estrelas), já que a 2,5 m de distância elas não se leem. **Em nenhuma hipótese adesivo impresso.** |
| Empapelamento do vazio inferior (~2,5 × 2,1 m) | **—** (papel + fita) | Área lisa e enorme; não gastar máscara vinílica. |

### 8. Sequência de sessões e dias

- **Preparação (D1 manhã)**: lavar; empapelar dobradiças, fechos, borrachas,
  travessas e o para-choque; **duplicar a máscara na junta** (uma peça por
  porta, com 2–3 mm de sobra de cada lado da fresta).
- **Sessão 1 — AMARELO**: coroa do losango. Cura.
- **Sessão 2 — AZUL**: mascara o amarelo, pinta o disco. Cura.
- **Sessão 3 — VERDE + LARANJA + CINZA juntos** (§6.4: não se tocam entre si).
  Atenção ao respiro de 1,9 cm verde/laranja: se a equipe não confiar, quebrar
  em duas sessões e o custo sobe meio dia.
- **Sessão 4 (condicional) — brasão fino**: aerografia/pincel do micro-detalhe,
  se a saída (a) for escolhida. Vem **depois** de tudo, sobre azul curado.
- **Verniz**.

**Total: 1,5 dia** se o brasão for simplificado; **2,5 dias** se for pintado à
mão em detalhe. A arte inteira é trivial — o custo mora em 15 cm de bandeira.

Paralelizável com a lateral (arte 1): mesmas cores, mesmas sessões, mesma cura.
Fazer as duas peças na mesma cabine economiza 1 dia inteiro.

### 9. Armadilhas para o motor de visão

1. **Fundo cinza-gelo (#E5E5E5) × branco de chapa**: ΔE pequeno decidindo 1 dia
   contra 4 dias. Precisa disparar flag de decisão humana, nunca autoclassificar.
2. **O motor não vê a junta central.** O mockup é um retângulo contínuo; o
   implemento real tem uma fresta em x≈125 cm cortando a palavra "FRONTEIRAS".
   Toda máscara que a atravessa tem de ser dividida. Isso precisa ser injetado
   por regra ("peça = traseira → junta vertical no meio"), não detectado.
3. **Respiro de 1,9 cm entre verde e laranja** = ~12 px. Sobrevive ao raster mas
   morre em qualquer downscale. Falsa T-T de 36 cm.
4. **Estrelas de 0,3–0,8 cm = 2–5 px**: serão descartadas como ruído por
   qualquer filtro de área mínima. O motor vai reportar "círculo azul chapado,
   fácil" — exatamente o oposto do único ponto difícil da arte.
5. **Mesma logo em duas escalas**: a bandeira da lateral (Ø 45 cm) é
   CORTE_MANUAL+máquina; a da traseira (Ø 15 cm) é PENDÊNCIA. Um motor que
   classifica por *forma* e não por *tamanho absoluto* dará a mesma resposta para
   as duas. O limiar `cortavel_a_mao` tem de ser métrico, não normalizado.
6. **Área vazia de 96%**: um heurístico de "≥80% de uma cor → pintura geral"
   dispara aqui e propõe empapelar/pintar 5 m² que não existem.

### 10. Correções à análise antiga

- **`analysis_D` §3 (BAHIA SUL traseira) — "imprimir o bloco inteiro (papaia +
  lettering) em painel adesivo — mais barato e consistente"**: **ERRADO**, e é
  exatamente o caso análogo a esta traseira. Adesivo não é produto final. O
  caminho para um bloco irredutível é PENDÊNCIA aerografia × pintura à mão, ou
  simplificação negociada com o cliente.
- **`analysis_D` §3 item 7 — "impresso = meio dia; pintado = 2 dias"**: a
  alternativa "impresso" não existe. O orçamento tem de comparar
  aerografia × pincel × simplificação, não pintura × impressão.
- **`analysis_D` §PADRÕES-4 — "selos SIF, sementes → vinil"**: **ERRADO**. É o
  mesmo raciocínio que mataria as 27 estrelas aqui. Micro-detalhe vira máscara de
  máquina (se depilável) ou PENDÊNCIA (se não), nunca entrega em adesivo.
- **`analysis_D` §PADRÕES-9 — "micro-componentes → vinil"** como regra de motor:
  **remover**. Substituir por: micro-componentes → testar depilabilidade e
  registro; se reprovar, PENDÊNCIA.
- **Acerto a manter**: `analysis_D` §4 (BALALAC) levanta corretamente a
  ambiguidade cinza-gelo × branco e o impacto de 1→3 dias. Aplica-se aqui
  integralmente.

---

# 3. BRAVO traseira.jpg

### 1. Implemento e substrato provável
Traseira de baú. Proporção **1,06:1** (1521×1439 px) → ≈ **2,60 m × 2,46 m**.
Portas com **junta vertical central em x ≈ 129 cm** — e desta vez a junta é
**visível no próprio mockup**: há uma linha vertical clara separando as duas
facetas cinzas do bloco chevron. Isso é uma informação valiosa: o designer já
alinhou o vinco do desenho 3D com a fresta das portas.

**Substrato: CHAPA_BRANCA.** Justificativa (§4): transportadora de carga geral
("BRAVO logística", Grupo Kovell), sem indício de isotérmico. O fundo é
cinza-claríssimo uniforme típico de chapa. **Fita amarela proibida.** Porém o
desenho não tem nenhuma faixa curva contínua — o chevron é composto de **retas**
—, então a alternativa não é fita: é corte manual com régua, mais rápido e mais
preciso que fita branca (que é larga e ainda exigiria corte).

### 2. Fundo
**Chapa original preservada em ~48%** (todo o terço inferior e os dois cantos
inferiores laterais). Os outros **~52% são pintados**: o bloco chevron cinza +
verde ocupa a metade superior inteira (2,60 × ~1,20 m).

**Não é pintura geral** no sentido do §6.2 (nenhuma cor sozinha passa de 80%),
mas está no limite: cinza sozinho é ~44% do painel. O empapelamento tem de ser
tratado com o rigor de uma pintura geral — 52% de cobertura em cinza escuro
mancha borracha, ferragem e friso com facilidade.

### 3. Inventário de elementos
Escala derivada: 260 cm / 1521 px ≈ **0,171 cm/px** (5,85 px/cm).

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Bloco chevron superior, faceta cinza ESQUERDA (degradê ~#4A4A4A→#6E6E6E) | — | ~129 × 120 cm |
| E2 — Bloco chevron superior, faceta cinza DIREITA (degradê ~#8C8C8C→#5A5A5A) | — | ~131 × 120 cm |
| E3 — Faixa verde do chevron (degradê verde-limão→verde-folha, em "V" invertido) | — | espessura **23 cm**, dois braços de **113 cm** cada |
| E4 — Selo octogonal vermelho ESQUERDO | "VEÍCULO / RASTREADO / VÍA SATELITE" + "A ABERTURA DA PORTA / NÃO DEPENDE DO / MOTORISTA" + antena parabólica | **32 cm** de diagonal |
| E5 — Selo octogonal vermelho DIREITO | (idêntico a E4) | **32 cm** |
| E6 — Texto cinza-chumbo esquerdo | "VELOCIDADE / MÁXIMA / CONTROLADA" | caixa **6 cm**, traço ~1,2 cm |
| E7 — Círculo vermelho de velocidade | "80" (cinza) + "km/h" (cinza) | **Ø 15 cm**, anel vermelho de **1,4 cm** |
| E8 — Texto cinza-chumbo direito | "COMO ESTOU / DIRIGINDO?" + "67 3045-2767" | caixa **7 cm** |
| E9 — Marca chevron do logo (verde degradê + cinza escuro, 3 setas encaixadas) | — | ~34 × 60 cm |
| E10 — Palavra cinza degradê | "BRAVO" | ~190 cm larg × **26 cm** de caixa |
| E11 — Palavra cinza-claro espacejada | "l o g í s t i c a" | ~180 cm larg × 7 cm de caixa |
| E12 — Logo Grupo Kovell: "K" em azul + verde (degradês) | "grupo" + "kovell" | **~24 cm** de largura total; "kovell" com caixa de ~4 cm; "grupo" ~1,5 cm |

### 4. Paleta
Sete cores, e — diferente das artes 1 e 2 — **quase nada é chapado**:

- Cinza-escuro/médio (E1, E2, E9, E10) — **DEGRADÊ** em todas as ocorrências:
  faceta esquerda escurece para a direita, faceta direita clareia no vinco,
  "BRAVO" tem degradê vertical. Não são duas cores: é **uma família cinza
  modulada**.
- Verde (E3, E9) — **DEGRADÊ** verde-limão → verde-folha ao longo de cada braço.
- Vermelho vivo (E4, E5, E7) — **chapado**.
- Cinza-chumbo de texto (E6, E8) — **chapado**.
- Cinza-claro (E11) — **chapado**.
- Azul (E12, no "K") — **degradê** azul→ciano.
- Verde Kovell (E12) — **degradê**.
- Branco: chapa preservada (interior dos selos, do círculo "80", fundo).

O fato de cinza e verde serem degradês muda a rota de execução: **dentro da
máscara, a cor é modulada a pistola (aerografia de campo aberto)** — não é
"duas cores com fronteira", é uma cor com transição. Isso reduz o número de
máscaras e aumenta o tempo de pistola.

### 5. Fronteiras T-T

| # | Par (ambas não-brancas) | Extensão do contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Verde (E3) × Cinza (E1+E2)** — bloco superior | ≈ **500 cm** (4 arestas de 113 cm + 2 topos de 23 cm) | **reta** — segmentos retilíneos, 1 vértice em "V" por aresta (raio → 0 no ápice) | **Cinza** (≈2,6 m² × ≈0,52 m² do verde) — 5× maior |
| T-T 2 | **Cinza-esquerdo (E1) × Cinza-direito (E2)** — vinco central | ≈ **120 cm** | **reta vertical perfeita** | empate (~1,3 m² cada) |
| T-T 3 | **Vermelho (E4) × Cinza (E1)** | ≈ **80 cm** (≈¾ do perímetro octogonal) | **reta** com 6–8 vértices | **Cinza** (2,6 m² × 0,08 m²) |
| T-T 4 | **Vermelho (E4) × Verde (E3)** | ≈ **25 cm** (o selo invade ~10 cm da faixa verde) | **reta** com 2 vértices | **Verde** (0,52 m² × 0,08 m²) |
| T-T 5 | **Vermelho (E5) × Cinza (E2)** | ≈ **80 cm** | **reta**, 6–8 vértices | **Cinza** |
| T-T 6 | **Vermelho (E5) × Verde (E3)** | ≈ **25 cm** (invade ~9 cm) | **reta** | **Verde** |
| T-T 7 | **Verde (E9) × Cinza (E9)** — marca chevron do logo | ≈ **250 cm** (≈6 arestas diagonais de 35–60 cm) | **reta**, paralelas | **Cinza** dentro do logo (mas verde é maior *dentro da marca*; no total da peça, cinza domina) |
| T-T 8 | **Verde (E9) × Cinza (E10 "BRAVO")** — a ponta da seta verde encosta na haste do "B" | ≈ **26 cm** | **reta** vertical | **Cinza** |
| T-T 9 | **Vermelho (E7 anel) × Cinza (E7 "km/h")** | ≈ **6 cm** | **suave** (segue o arco do anel) | **Vermelho** localmente (anel 0,006 m² × texto 0,001 m²) |
| T-T 10 | **Azul (E12) × Verde (E12)** — dentro do "K" da Kovell | ≈ **15 cm** | **média** (raio ~3 cm) | **Verde** (marginalmente) |

**Nota importante sobre T-T 2 (o vinco cinza-cinza)**: ela **não é uma fronteira
de produção**. As duas facetas estão em **portas diferentes**, separadas
fisicamente pela fresta. Não há tinta encostando em tinta — há tinta, ar, tinta.
Além disso são a mesma família cinza modulada, pintada na mesma sessão. Um motor
de visão vai contá-la como T-T de 120 cm e propor uma cura + máscara
desnecessárias. **Descontando T-T 2, a peça tem 9 fronteiras T-T reais,
≈ 11,4 m de contato.**

**Pares que NÃO se tocam:**
- **Vermelho × Vermelho** (E4, E5, E7 entre si): isolados, ~2 m de distância.
- **Vermelho × Azul (Kovell)**: não se tocam — permite sessão conjunta.
- **Cinza-chumbo de texto (E6, E8) × qualquer cor**: os dois blocos de texto
  estão sobre chapa nua, a ≥15 cm de qualquer outro elemento. Só T-F. (Exceção:
  "km/h" toca o anel vermelho — T-T 9.)
- **Cinza-claro (E11 "logística") × Cinza (E10 "BRAVO")**: respiro de ~4 cm.
  Não se tocam — mas o respiro é fino e os dois cinzas são próximos; risco de
  falsa fusão.
- **Verde (E3, bloco) × Verde (E9, logo)**: mesma cor, elementos separados —
  irrelevante para T-T.

### 6. Ordem de pintura (§2)

Áreas estimadas: azul Kovell ≈ **0,004 m²** < vermelho total ≈ **0,17 m²** <
cinza-claro E11 ≈ **0,05 m²** < verde total ≈ **0,62 m²** < cinza-chumbo texto ≈
**0,08 m²** < cinza família E1+E2+E9+E10 ≈ **3,0 m²**.

Justificativa par a par:

- **T-T 1 (verde × cinza)**: verde 0,62 m², cinza 2,6 m². → **verde primeiro**,
  mascara a faixa de 23 cm × 226 cm, pinta o cinza por cima. Mascarar 0,52 m² de
  faixa reta contra mascarar 2,6 m² de bloco: a economia é de ~5:1 em material e
  de mais de 2 h em corte.
- **T-T 3/5 (vermelho × cinza)**: vermelho 0,08 m² por selo contra 2,6 m² de
  cinza. → **vermelho primeiro**. Mascarar dois octógonos de 32 cm é trivial.
- **T-T 4/6 (vermelho × verde)**: vermelho 0,08 m² contra verde 0,52 m². →
  **vermelho antes do verde**. Isso encaixa perfeitamente: vermelho → verde →
  cinza é uma cadeia monotônica de cobertura crescente.
- **T-T 7/8 (verde × cinza no logo)**: mesma ordem da T-T 1 → verde antes.
  Reforça a cadeia.
- **T-T 9 (anel vermelho × "km/h" cinza)**: o texto é menor, mas ele pertence à
  família cinza que vem por último de qualquer forma. Como o vermelho já está
  pintado e mascarado, o "km/h" entra na sessão do cinza sem custo extra. ✔
- **T-T 10 (azul × verde da Kovell)**: azul 0,004 m² contra verde. → **azul
  primeiro**. E como azul não toca vermelho, os dois vão na **mesma sessão**.

**Cadeia final: (vermelho + azul) → verde → (cinza-escuro + cinza-médio +
cinza-chumbo + cinza-claro) → verniz.**

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| E3 faixa verde do chevron (23 cm × 2×113 cm, retas) | **CORTE_MANUAL** | Duas retas longas com um ápice. Régua de 1,5 m e estilete. É o caso mais fácil possível — e evita o ciclo de verniz do §3.2. **Fita branca seria pior**: é larga demais para 23 cm de faixa e ainda exigiria corte nos ápices. |
| E1+E2 facetas cinza (bloco de 2,6 × 1,2 m, retas + degradê) | **CORTE_MANUAL** | Perímetro em "V" com 4 vértices, tudo reta. O degradê é resolvido na pistola dentro da máscara, não com máscara adicional. |
| E4, E5 selos octogonais (32 cm, com micro-texto de 1,4 cm e traço de 0,25 cm, antena parabólica com hastes finas) | **MASCARA_MAQUINA_SOBRE_VERNIZ** — variante **direto sobre a chapa** | O octógono externo de 32 cm é cortável à mão; o **interior não é**: "A ABERTURA DA PORTA NÃO DEPENDE DO MOTORISTA" tem letras de 1,4 cm e traço de 0,25 cm, e a antena tem hastes de ~0,3 cm. **Chave doutrinária**: esse interior é *branco*, ou seja, **chapa preservada**. Então a máscara recortada a máquina — que carrega as letras, a antena e o filete octogonal como ilhas — é aplicada **sobre a chapa nua na sessão 1**, e o vermelho é pintado por cima. **Não precisa de ciclo de verniz nem de espera.** Essa é a leitura correta e é ~1 dia mais barata que o §3.2 literal. Se a equipe julgar que ilhas de 0,25 cm não depilam, vira **PENDÊNCIA** (pincel fino / aerografia), nunca adesivo. |
| E7 círculo "80 km/h" (Ø 15 cm, anel de 1,4 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (variante sobre chapa) | Anel de 1,4 cm de espessura em Ø 15 cm: cortável à mão só por mão muito treinada. Vai junto na mesma folha de máscara-máquina dos selos — custo marginal zero. |
| E6 "VELOCIDADE MÁXIMA CONTROLADA" (caixa 6 cm, traço 1,2 cm) | **CORTE_MANUAL** | 6 cm de caixa e 1,2 cm de traço, sans-serif bold, sobre chapa lisa. Cortável. 26 caracteres. |
| E8 "COMO ESTOU DIRIGINDO? / 67 3045-2767" (caixa 7 cm) | **CORTE_MANUAL** | Idem, ligeiramente maior. |
| E10 "BRAVO" (caixa 26 cm, degradê) | **CORTE_MANUAL** | Letras de 26 cm com hastes de ~6 cm. Fácil. O degradê é modulação de pistola dentro da máscara. |
| E11 "logística" (caixa 7 cm, espacejada, peso leve) | **CORTE_MANUAL** | Traço de ~1 cm, letras isoladas (o espacejamento ajuda: sem ligaduras finas). No limiar, mas cortável. |
| E9 marca chevron do logo (34 × 60 cm, 3 setas encaixadas, arestas retas) | **CORTE_MANUAL** | Retas paralelas com vértices. Elemento pequeno mas geometricamente simples. |
| E12 Grupo Kovell ("K" de 24 cm com degradês azul e verde, "kovell" caixa 4 cm, "grupo" 1,5 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (variante sobre chapa) + **PENDÊNCIA no degradê** | "grupo" tem 1,5 cm de caixa e "kovell" 4 cm com traço de ~0,6 cm: abaixo do estilete. O "K" tem dois degradês que se encontram em 15 cm — para essa escala, ou se achata em duas chapadas (recomendado) ou vira aerografia de detalhe. **Decisão do dono.** |
| Empapelamento do terço inferior + ferragens | **—** (papel + fita) | ~48% de chapa preservada em áreas grandes. |

Espovo (§3.3) não se aplica: o maior elemento (bloco chevron, 2,6 × 1,2 m) é
grande **mas** o corte manual da máscara em retas é mais rápido que furar kraft
de 3 m². §3.3 exige "muito grande **e** muito fácil" *e* diz explicitamente
"raramente escolhido".

### 8. Sequência de sessões e dias

- **D1 manhã — Preparação**: lavar; empapelar dobradiças, fechos, borrachas,
  travessas, para-choque; marcar a geometria do chevron com laser a partir da
  junta central (o vinco do desenho **tem** de coincidir com a fresta — erro de
  5 mm aqui é visível a 20 m); aplicar as máscaras-máquina dos dois selos, do
  círculo "80" e do "K" da Kovell sobre a chapa nua.
- **D1 tarde — Sessão 1: VERMELHO + AZUL** (§6.4 — não se tocam). Vermelho nos
  dois selos e no anel do "80"; azul no "K". Cura.
- **D2 manhã — Sessão 2: VERDE**. Mascara os selos e o "K"; corta à mão a faixa
  do chevron e a marca do logo; pinta com modulação limão→folha ao longo dos
  braços. Cura.
- **D2 tarde / D3 manhã — Sessão 3: FAMÍLIA CINZA**. Mascara verde, vermelho e
  azul; corta as facetas do bloco, "BRAVO", "logística", E6, E8, o "km/h" e o
  "grupo". Pinta todos os cinzas em uma passagem, modulando as facetas. É a maior
  sessão (3,0 m²) e a que exige mais pistola.
- **D3 tarde — Verniz** geral.

**Total: 3 dias.** Se os selos forem para PENDÊNCIA de pincel, +0,5 dia. Se o
"K" da Kovell exigir aerografia, +0,5 dia.

### 9. Armadilhas para o motor de visão

1. **O vinco cinza-cinza é a junta das portas.** Um motor conta uma T-T reta de
   120 cm e insere uma cura + uma máscara. É falso: não há tinta encostando em
   tinta, há uma fresta. Regra necessária: em peça traseira, fronteira **vertical
   na linha média** = junta, não T-T.
2. **Degradê lido como duas cores.** As facetas cinza e a faixa verde são
   modulações contínuas. Um quantizador vai produzir 4–6 "cores" e inventar
   fronteiras T-T internas que não existem — cada uma custando uma cura falsa.
   Regra: gradiente monotônico dentro de um componente conexo = **uma cor
   modulada**, não fronteira.
3. **Os selos se sobrepõem a duas cores.** Cada octógono cruza a fronteira
   verde/cinza. Um motor que segmenta por região vai fragmentar o octógono em
   dois "vermelhos" diferentes e perder o fato de que o selo é uma peça só.
4. **Branco dentro do vermelho.** O interior dos selos e do "80" é branco *sobre*
   uma região que, na leitura ingênua, está "dentro de uma área pintada". Um
   motor que aplica "branco = chapa" mecanicamente conclui que é impossível.
   A resolução correta (reservar a chapa desde o início com máscara-máquina) só
   aparece se o motor modelar **ordem temporal**, não só topologia.
5. **Micro-texto de 0,25 cm de traço**: será descartado como ruído, e o selo
   será classificado como "octógono vermelho chapado, CORTE_MANUAL, fácil" —
   quando é o item mais caro por cm² da peça.
6. **"logística" × "BRAVO"**: dois cinzas próximos separados por 4 cm. Podem
   fundir no raster e virar um só componente com uma "fronteira interna".
7. **Percentual de cobertura de 52%**: fica logo abaixo do gatilho de "pintura
   geral" (§6.2, ≥80%) mas exige o mesmo empapelamento. Regra por % de cor
   isolada erra aqui; o gatilho de empapelamento deveria ser **% total pintado**,
   não % da maior cor.

### 10. Correções à análise antiga

- **`analysis_D` §10 (bismark) — "emblema → impressão digital (única opção sã
  para metálicos/cromo/radial)" e §PADRÕES-5 "metálico multidirecional →
  impressão do bloco inteiro (não decompor)"**: **ERRADO**, e é a regra que seria
  aplicada aos degradês desta peça (facetas cinza, faixa verde, "K" Kovell).
  Degradê **não** é motivo para impressão. Degradê monotônico dentro de máscara é
  **modulação de pistola**; degradê irredutível é **PENDÊNCIA aerografia ×
  pintura à mão**. Nunca impressão.
- **`analysis_D` §PADRÕES-4 — "texto pequeno nunca se pinta → vinil final"**:
  **ERRADO**. O micro-texto dos selos ("A ABERTURA DA PORTA NÃO DEPENDE DO
  MOTORISTA") é **pintado** através de máscara recortada a máquina, com o branco
  como chapa reservada. E o "grupo kovell" também.
- **`analysis_D` §12 (BOI MIX traseira) — "selo SIF → vinil preto final
  obrigatório"**: **ERRADO** pelo mesmo motivo, e é o análogo exato dos selos
  "VEÍCULO RASTREADO" desta peça.
- **`analysis_D` §9 (BIAVA) item 5 — ordem "preto geral (92%) → cura → adesivo →
  cinza-prata → vermelho"**: **viola o §2**. Ali se pinta a cor de **maior**
  cobertura primeiro. Se essa lógica fosse aplicada aqui, o cinza (2,6 m²) viria
  antes do verde (0,52 m²) e se mascararia 5× mais área. A ordem correta é
  sempre da menor para a maior cobertura, e é o que esta análise faz.
- **`analysis_D` não classifica fronteira por T-T × T-F nem mede comprimento e
  curvatura**: sem isso ela não consegue ver que 9 das 10 fronteiras desta peça
  são **retas** — o que é o que torna o corte manual viável e evita a rota cara
  do §3.2 no bloco principal.
- **`analysis_D` §PADRÕES-2 — "traseira = subconjunto empilhado da lateral"**:
  parcialmente **errado** aqui. A traseira da BRAVO tem elementos que a lateral
  **não** tem (E6, E7, E8 — velocidade e "como estou dirigindo") e um bloco
  chevron de geometria diferente (V invertido vertical × seta horizontal). Não é
  subconjunto; é uma peça independente com custo próprio.

---

# 4. BRAVO.jpg (lateral)

### 1. Implemento e substrato provável
Lateral de baú. Proporção **3,26:1** (1600×491 px) → com 2,60 m de altura,
≈ **8,50 m de comprimento** (baú/truck médio ou semirreboque curto).

**Substrato: CHAPA_BRANCA**, mesmo cliente e mesma família da arte 3. **Fita
amarela proibida (§4).** Novamente o desenho é todo em retas — corte manual com
régua supera fita branca.

### 2. Fundo
**Chapa original preservada em ~85%.** O bloco chevron ocupa só os primeiros
~133 cm da extremidade esquerda (~13% do painel); a logo e os selos são
elementos isolados sobre chapa. **Sem pintura geral.**

Diferença estrutural relevante em relação à traseira: aqui o bloco chevron
**encosta na borda esquerda do painel e nas bordas superior e inferior**, ou
seja, é cortado pela quina do baú. Isso significa que o desenho continua na
frente/quina e o registro entre lateral e frente tem de ser conferido no
implemento.

### 3. Inventário de elementos
Escala derivada: 850 cm / 1600 px ≈ **0,53 cm/px**.

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Bloco chevron esquerdo, facetas cinza (degradê), seta apontando para a direita, com vinco horizontal a meia altura | — | ~133 cm larg × 260 cm alt (altura total do painel) |
| E2 — Faixa verde do chevron (degradê limão→folha), em seta | — | espessura **29 cm**, dois braços de ~105 cm |
| E3 — Selo octogonal vermelho ESQUERDO (sobre o bloco) | "VEÍCULO / RASTREADO / VÍA SATELITE" + micro-texto + antena | **Ø ~34 cm** |
| E4 — Selo octogonal vermelho DIREITO (sobre chapa nua) | (idêntico) | **Ø ~34 cm** |
| E5 — Marca chevron do logo (verde + cinza escuro) | — | ~85 × 110 cm |
| E6 — Palavra cinza degradê | "BRAVO" | ~370 cm larg × **53 cm** de caixa |
| E7 — Palavra cinza-claro espacejada | "l o g í s t i c a" | ~360 cm larg × 14 cm de caixa |
| E8 — Logo Grupo Kovell | "grupo" + "kovell" | **~42 cm** de largura; "kovell" caixa ~7 cm; "grupo" ~2,5 cm; "K" ~11 cm |

### 4. Paleta
Idêntica à arte 3: família cinza **em degradê**, verde **em degradê**, vermelho
**chapado**, cinza-claro chapado, azul+verde em degradê no "K" Kovell. Branco =
chapa.

### 5. Fronteiras T-T

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Verde (E2) × Cinza (E1)** — bloco esquerdo | ≈ **420 cm** (4 arestas de ~105 cm) | **reta**, 1 vértice por aresta | **Cinza** (≈2,1 m² × ≈0,62 m²) |
| T-T 2 | **Cinza-superior × Cinza-inferior (E1)** — vinco horizontal do 3D | ≈ **130 cm** | **reta horizontal** | empate |
| T-T 3 | **Vermelho (E3) × Cinza (E1)** | ≈ **70 cm** | **reta**, 6 vértices | **Cinza** |
| T-T 4 | **Vermelho (E3) × Verde (E2)** | ≈ **30 cm** | **reta**, 2 vértices | **Verde** (0,62 m² × 0,09 m²) |
| T-T 5 | **Verde (E5) × Cinza (E5)** — marca do logo | ≈ **200 cm** (arestas diagonais paralelas) | **reta** | **Cinza** no total da peça |
| T-T 6 | **Verde (E5) × Cinza (E6 "B")** | ≈ **50 cm** | **reta** vertical | **Cinza** |
| T-T 7 | **Azul × Verde (E8, "K" Kovell)** | ≈ **6 cm** | **média** (raio ~1,5 cm) | **Verde** |

**Nota sobre T-T 2**: aqui, ao contrário da traseira, **é uma T-T real** — não
há junta física numa lateral. Mas as duas faces são a mesma família cinza
modulada, pintadas na mesma sessão com transição a pistola. **Não gera máscara,
não gera cura.** Classificação correta: `T_T_mesma_familia` → aerografia interna.
Descontando-a, restam **6 fronteiras T-T de máscara, ≈ 7,6 m** (contando 7 pares
com T-T 2 incluída, como na tabela-resumo).

**Pares que NÃO se tocam:**
- **Vermelho (E4, selo direito) × qualquer cor**: está sozinho sobre chapa nua,
  a >2 m de tudo. **100% T-F.** É o selo barato.
- **Vermelho × Azul**: não se tocam → mesma sessão.
- **Cinza-claro (E7 "logística") × Cinza (E6 "BRAVO")**: respiro de ~8 cm. Não
  se tocam.
- **Verde do bloco (E2) × Verde do logo (E5)**: mesma cor, separados por ~5 m.

### 6. Ordem de pintura
Áreas: azul ≈ **0,002 m²** < vermelho ≈ **0,18 m²** (dois selos) < cinza-claro ≈
**0,05 m²** < verde ≈ **0,72 m²** < cinza família ≈ **2,7 m²**.

- **T-T 4 (vermelho × verde)**: vermelho 0,09 m² por selo × verde 0,72 m² →
  **vermelho primeiro**.
- **T-T 3 (vermelho × cinza)**: 0,09 × 2,7 → **vermelho primeiro**. Consistente.
- **T-T 1/5/6 (verde × cinza)**: 0,72 × 2,7 → **verde antes do cinza**.
  Mascarar 0,62 m² de faixa reta contra 2,1 m² de bloco: economia de ~3,4:1.
- **T-T 7 (azul × verde)**: azul 0,002 m² → **azul primeiro**, junto com o
  vermelho (não se tocam).
- **T-T 2 (cinza × cinza)**: mesma família → mesma sessão, sem ordem.

**Cadeia: (vermelho + azul) → verde → cinza → verniz.** Idêntica à traseira —
o que permite rodar as duas peças na mesma cabine e nas mesmas sessões.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E2 faixa verde (29 cm × 2×105 cm, retas) | **CORTE_MANUAL** | Retas com régua. Fita branca seria pior (larga, exige corte igual). Fita amarela proibida em chapa. |
| E1 facetas cinza (1,33 × 2,60 m, retas + degradê) | **CORTE_MANUAL** | Perímetro em seta, tudo reta. Degradê a pistola dentro da máscara. |
| E3, E4 selos (Ø 34 cm, micro-texto de ~1,5 cm, antena de ~0,3 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ**, variante **sobre a chapa** | Mesmo raciocínio da arte 3: o interior branco é chapa reservada, então a máscara-máquina vai sobre a chapa **antes** de qualquer tinta e dispensa o ciclo de verniz. Se as ilhas de 0,3 cm não depilarem → **PENDÊNCIA** (pincel), nunca adesivo. |
| E6 "BRAVO" (caixa 53 cm) | **CORTE_MANUAL** | Letras de meio metro. Trivial. |
| E7 "logística" (caixa 14 cm, traço ~2 cm) | **CORTE_MANUAL** | Confortavelmente acima do limiar. |
| E5 marca chevron do logo (85 × 110 cm) | **CORTE_MANUAL** | Retas paralelas, elemento grande. |
| E8 Grupo Kovell ("K" de 11 cm, "kovell" caixa 7 cm, "grupo" 2,5 cm, 2 degradês) | **MASCARA_MAQUINA_SOBRE_VERNIZ** + **PENDÊNCIA** no degradê do "K" | "grupo" com 2,5 cm de caixa e traço de ~0,4 cm está abaixo do estilete. Os degradês azul→ciano e verde num "K" de 11 cm: achatar em duas chapadas (recomendado) ou aerografia de detalhe. Decisão do dono. |
| Empapelamento (85% do painel) | **—** (papel + fita) | Áreas amplas e retas. |

### 8. Sequência de sessões e dias

- **D1 manhã — Preparação**: lavar 8,5 m; empapelar frisos, borrachas,
  ferragens; **conferir a continuidade do bloco chevron na quina dianteira** (ele
  é cortado pela borda esquerda do painel); marcar com laser; aplicar as
  máscaras-máquina dos dois selos e do "K" sobre a chapa.
- **D1 tarde — Sessão 1: VERMELHO + AZUL** (não se tocam). Cura.
- **D2 manhã — Sessão 2: VERDE** (faixa do bloco + marca do logo). Cura.
- **D2 tarde — Sessão 3: FAMÍLIA CINZA** (facetas, "BRAVO", "logística",
  "grupo"), com modulação de degradê a pistola.
- **D3 manhã — Verniz.**

**Total: 2,5 dias** — e **quase zero custo marginal se rodada junto com a
traseira** (arte 3): mesmas cores, mesmas curas, mesmas máscaras-máquina numa
folha só. Rodar lateral + lateral espelhada + traseira em batelada é a maior
economia disponível neste cliente.

**Espelhamento**: o bloco chevron é **direcional** (seta apontando para a
direita). No lado oposto do baú ele tem de apontar para a frente do veículo
também — ou seja, a máscara do lado direito é o **espelho** da do lado esquerdo,
não a mesma peça. Idem para a marca do logo. Confirmar com o cliente se ele quer
espelhamento (seta sempre para a frente) ou repetição (seta sempre para a
direita do observador).

### 9. Armadilhas para o motor de visão

1. **O bloco chevron está cortado pela borda da imagem.** O mockup não mostra
   onde ele termina. Um motor mede área "dentro do quadro" e subestima o verde e
   o cinza — e não sabe que o desenho continua na quina.
2. **T-T 2 (cinza × cinza) é falsa fronteira de máscara** — mesma família,
   resolvida a pistola. Contá-la como T-T real insere uma cura de 3 h inexistente.
3. **Dois selos idênticos com custos totalmente diferentes**: o esquerdo cruza
   duas cores (T-T 3 e T-T 4, sequenciamento obrigatório); o direito está sobre
   chapa nua (T-F puro, pode ir em qualquer sessão). Um motor que agrupa por
   "elemento repetido" atribui o mesmo custo aos dois.
4. **Degradês monotônicos quantizados em bandas** → fronteiras internas
   fantasmas no cinza e no verde.
5. **Selo de 34 cm com micro-texto de 0,3 cm**: razão perímetro/área e
   detalhe-mínimo divergem brutalmente. Se o limiar `cortavel_a_mao` usar só área
   ou só perímetro, ele aprova corte manual num elemento que não é cortável.
6. **Kovell com 42 cm de largura total** numa peça de 8,5 m: ~0,5% da largura.
   Qualquer downscale o apaga, e ele carrega dois degradês e a única fronteira
   curva da peça inteira.
7. **Proporção 3,26:1 sem âncora métrica**: se o motor assumir 2,60 m de altura
   está certo; se assumir outra coisa, todos os limiares de "cortável à mão"
   deslizam junto.

### 10. Correções à análise antiga

- **`analysis_D` §PADRÕES-1 — "faixa branca + logo central + canto decorado
  (8/12): sempre curva suave, T-F ou fita flexível quando toca outra cor"**:
  **ERRADO para esta arte e perigoso como padrão**. O canto decorado da BRAVO é
  **todo em retas**, não curva suave, e as fronteiras são **T-T**, não T-F. E
  "fita flexível" (amarela) é **proibida em chapa branca** pelo §4 — só valeria
  em isoplastic ou lona. A regra transversal induz exatamente a escolha de
  material errada.
- **`analysis_D` §11 (BOI MIX) item 5 — "swoosh → aerografia em máscara; bloco
  direito → aerografia (transições pintadas)"**: a parte de aerografia está
  certa, mas §10 (bismark) e §PADRÕES-5 mandam **imprimir** quando o degradê é
  "metálico/multidirecional". **ERRADO**: impressão não é uma rota. Aqui, os
  degradês do chevron e do "K" resolvem-se com pistola ou viram PENDÊNCIA.
- **`analysis_D` §PADRÕES-4 — "vinil final" para texto pequeno**: **ERRADO**;
  "grupo kovell" (2,5 cm) e o micro-texto dos selos são **pintados** via
  máscara-máquina.
- **`analysis_D` §PADRÕES-7 — "2 cores que não se tocam = 1 dia"**: a intuição
  está certa e é a mesma do §6.4, mas a `analysis_D` **nunca mede** o que se toca
  — ela declara "todas T-F" de olho. Aqui isso levaria a um erro de 3 sessões:
  verde **toca** cinza em 4,2 m e vermelho **toca** ambos.
- **`analysis_D` §PADRÕES-9 — "estimar dias por nº de janelas sequenciais (+2
  pintura geral, +1 aerografia, +0,5 vinis)"**: o termo "+0,5 vinis" tem de
  **sair**. Não existe etapa de vinil final. O que existe é "+1 folha de
  máscara-máquina" (custo de material e de posicionamento) e, no pior caso,
  "+1 dia de pendência artística".

---

# 5. BURES 1.jpg

### 1. Implemento e substrato provável
Lateral de baú. Proporção **3,41:1** (1600×469 px) → com 2,60 m de altura,
≈ **8,87 m de comprimento**.

**Substrato: CHAPA_BRANCA.** Justificativa (§4): "Bures Transporte & Logística"
— carga geral, sem indício de isotérmico; o branco do mockup é branco puro
(#FFFFFF), não o marfim do isoplastic. **Fita amarela proibida.** Isso é
relevante porque a arte tem uma **faixa curva** (o swoosh azul-marinho de 22 cm
correndo os 260 cm de altura): em isoplastic ela seria FITA_AMARELA (curva
livre, zero corte, caso barato); em chapa branca ela **não pode** ser fita
amarela, e a fita branca não faz curva → sobra **CORTE_MANUAL**. Confirmar o
substrato no implemento muda o custo desta faixa.

### 2. Fundo
**Chapa original preservada, ~78%.** Sem pintura geral. O painel dourado
esquerdo (~161 cm × 260 cm ≈ 3,5 m²) e a faixa azul (~0,6 m²) somam ~18% do
painel; a logomarca soma mais ~4%.

Atenção: o painel dourado é grande (~16% do painel sozinho) mas não chega perto
do gatilho de pintura geral. O branco à direita é chapa, não tinta.

### 3. Inventário de elementos
Escala derivada: 887 cm / 1600 px ≈ **0,554 cm/px**.

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Painel dourado à extremidade esquerda, borda direita em "S" suave, **degradê vertical** creme (topo) → ouro-queimado (base) | — | **161 cm** de largura × 260 cm de altura |
| E2 — Faixa/swoosh azul-marinho, em "S", correndo toda a altura | — | espessura **22 cm**, comprimento ~270 cm |
| E3 — Filete de chapa branca entre E1 e E2 | — | **~10 cm** de largura, ~270 cm de comprimento |
| E4 — Emblema circular: coroa azul-marinho recortada em 4 quadrantes | — | **Ø 111 cm** |
| E5 — Estrela/rosa-dos-ventos laranja de 4 pontas, dentro e além de E4, com pontas em agulha | — | **~140 cm** de envergadura |
| E6 — Canais de chapa branca separando E4 de E5 | — | **2 a 4,5 cm** de largura |
| E7 — Lettering azul-marinho | "Bu" | ~122 cm larg × **72 cm** de caixa |
| E8 — Lettering laranja | "RES" | ~277 cm larg × **72 cm** de caixa |
| E9 — Filete de chapa entre "u" e "R" | — | **~1 a 2 cm** |
| E10 — Lettering cinza espacejado | "TRANSPORTE & LOGÍSTICA" | ~402 cm larg × **17 cm** de caixa, traço ~2,5 cm |

### 4. Paleta
- Azul-marinho (~#1B4E8C) — **chapado** — E2, E4, E7
- Laranja/ocre (~#D2860F) — **chapado** — E5, E8
- Dourado — **DEGRADÊ vertical** creme → ouro-queimado — E1 (é a mesma família
  do laranja, mas modulada)
- Cinza médio (~#6B6B6B) — **chapado** — E10
- Branco = chapa preservada — E3, E6, E9, fundo

### 5. Fronteiras T-T

**ZERO fronteiras T-T. Nenhum par de cores não-brancas se toca nesta arte.**

Este é o achado mais importante da fatia, e foi verificado em ampliação de
250–500% em cada junção:

- **Dourado (E1) × Azul-marinho (E2)**: **NÃO se tocam.** Há um filete de chapa
  branca (E3) de **~10 cm** de largura correndo os 270 cm inteiros entre os dois.
  A 10 cm de folga não há dúvida nem risco de registro. → duas fronteiras T-F
  independentes.
- **Azul-marinho (E4, coroa) × Laranja (E5, rosa-dos-ventos)**: **NÃO se tocam.**
  A coroa azul é recortada em 4 quadrantes por canais de chapa de **2 a 4,5 cm**,
  e a estrela laranja corre dentro desses canais, com branco de cada lado em
  **toda** a sua extensão. Verificado ponto a ponto: em nenhum lugar do emblema o
  laranja encosta no azul.
- **Azul-marinho (E7 "Bu") × Laranja (E8 "RES")**: **NÃO se tocam**, mas por
  apenas **1 a 2 cm** ao longo de ~72 cm de altura. **Esta é uma quase-fronteira
  e o único risco real da peça.** Se a tolerância de posicionamento da máscara da
  equipe for pior que ±1 cm, ela vira T-T na prática (sobreposição ou falha de
  chapa). Recomendação: cortar as duas máscaras da **mesma folha**, em registro,
  garantindo o filete por construção — ou aceitar o custo de sequenciar as cores.
- **Cinza (E10) × qualquer cor**: não toca nada (≥10 cm de todos os lados).
- **Dourado (E1) × Laranja (E8)**: separados por ~3 m de chapa.

Extensão total de fronteira T-T: **0 cm.**

### 6. Ordem de pintura

**Não há nenhum par que se toque, portanto não há nenhuma ordem obrigatória.**
Este é o caso ideal do §6.4: **todas as cores entram na mesma sessão.**

Ordem apenas por conveniência de pistola (do claro para o escuro, para reduzir
limpeza de bico): dourado/laranja → azul-marinho → cinza. Nenhuma cura
intermediária, nenhuma máscara sobre tinta.

**Regra de contingência**: se a equipe decidir que o filete de 1–2 cm entre "u" e
"R" (E9) é apertado demais, aplica-se o §2 àquele par: azul-marinho total ≈
**1,7 m²** (E2 0,6 + E4 0,6 + E7 0,5) contra laranja/dourado total ≈ **5,2 m²**
(E1 3,5 + E8 1,5 + E5 0,2). → **azul primeiro, mascara, laranja depois.** Custo:
+1 cura e +1 dia.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 painel dourado (161 × 260 cm, borda direita em "S" suave) | **CORTE_MANUAL** | Uma única curva em "S" de raio grande (raio mínimo estimado ~120 cm) ao longo de 270 cm, sem nenhuma ilha. É o tipo de traçado que a mão corta melhor do que a máquina posiciona. O **degradê vertical** é resolvido a pistola dentro da máscara (creme em cima, ouro-queimado embaixo, transição de ~180 cm — transição longuíssima, fácil). |
| E2 faixa azul em "S" (22 cm × 270 cm) | **CORTE_MANUAL** | Duas curvas paralelas de raio ~110 cm. **Não pode ser FITA_AMARELA** (§4: chapa branca). **FITA_BRANCA não serve**: não faz curva. Logo, corte manual — e é perfeitamente cortável: duas linhas suaves, sem detalhe. **Se o substrato for isoplastic, esta faixa vira FITA_AMARELA e economiza ~1,5 h de corte.** |
| E4 coroa azul do emblema (Ø 111 cm, 4 quadrantes, cantos arredondados) | **CORTE_MANUAL** | Arcos de raio 55 cm e canais retos de 2–4,5 cm. Os canais de 2 cm são a parte mais fina, mas são retos e curtos (~40 cm cada) — cortáveis com régua. |
| E5 rosa-dos-ventos laranja (envergadura 140 cm, pontas em agulha) | **CORTE_MANUAL**, com ressalva | O corpo da estrela é grande e simples. As **4 pontas em agulha** afinam para <0,5 cm nos últimos ~30 cm. Contra a chapa branca (T-F), uma ponta que se perde é um defeito discreto; contra outra cor seria inaceitável. Aceitar corte manual e instruir o cortador a **não** perseguir o último centímetro da agulha. Alternativa se o cliente for exigente: incluir só a estrela numa folha de máscara-máquina (custo marginal baixo). |
| E7 "Bu" (caixa 72 cm) | **CORTE_MANUAL** | Letras de 72 cm com hastes de ~14 cm. Trivial. |
| E8 "RES" (caixa 72 cm) | **CORTE_MANUAL** | Idem. |
| E10 "TRANSPORTE & LOGÍSTICA" (caixa 17 cm, traço 2,5 cm, 21 caracteres espacejados) | **CORTE_MANUAL** | 17 cm de caixa e 2,5 cm de traço: acima do limiar. O espacejamento largo elimina ligaduras finas. Cortável. |
| Empapelamento (78% do painel) | **—** (papel + fita) | Áreas amplas. |

Nenhum elemento desta arte justifica MASCARA_MAQUINA_SOBRE_VERNIZ. Nenhum
justifica espovo (§3.3): o maior elemento (painel dourado, 4,2 m²) é grande, mas
sua borda é uma curva única — furar 2,7 m de kraft para marcar uma linha que se
corta em 20 minutos é perda de tempo.

### 8. Sequência de sessões e dias

- **D1 manhã — Preparação**: lavar 8,87 m; empapelar frisos, borrachas,
  ferragens; marcar as duas curvas em "S" (gabarito flexível ou traçado a laser);
  aplicar e cortar todas as máscaras — as de dourado, azul, laranja e cinza podem
  ser aplicadas **de uma vez**, porque nenhuma cor toca a outra.
- **D1 tarde — Sessão única**: pintar as **quatro** cores em sequência de bico
  sem cura intermediária (dourado com modulação, laranja, azul-marinho, cinza).
- **D2 manhã — Verniz.**

**Total: 1 dia de pintura + verniz.** É a arte mais barata da fatia, e a razão é
exatamente a métrica que faltava: **zero fronteira T-T**. Toda a economia vem dos
filetes de chapa que o designer deixou entre as cores (o filete de 10 cm entre
dourado e azul, os canais de 2–4,5 cm no emblema, o respiro de 1–2 cm no
lettering).

**Espelhamento**: o painel dourado e a faixa azul estão na extremidade
**esquerda**. No lado oposto do baú, espelhar (ficam na extremidade dianteira nos
dois lados) ou repetir (ficam sempre à esquerda do observador)? Decisão do
cliente — e a curva em "S" espelhada é uma máscara diferente, não a mesma.

### 9. Armadilhas para o motor de visão

1. **A armadilha central: o motor vai reportar fronteiras T-T que não existem.**
   O emblema BURES *parece* ter laranja sobre azul. Só a ampliação mostra que há
   chapa branca de 2–4,5 cm entre eles em 100% do contorno. Um antialiasing
   agressivo ou um downscale fecha esses canais e transforma uma arte de **1 dia**
   numa arte de **3 dias**. Este é o exemplo canônico de por que o §1 precisa
   medir e não adivinhar.
2. **O filete de 1–2 cm entre "u" e "R"** (≈2–4 px no raster) morre em qualquer
   redução. Falsa T-T de 72 cm entre azul e laranja.
3. **Degradê dourado lido como duas cores**: creme e ouro-queimado ficam a ΔE
   grande. O quantizador cria "creme" e "ouro" como cores separadas e inventa uma
   T-T horizontal de 161 cm no meio do painel — que é só uma transição a pistola.
4. **Creme do topo do painel confundido com chapa branca**: no topo, o degradê
   chega perto do branco. O motor pode recortar o painel dourado ao meio ou
   estender o "fundo" para dentro dele.
5. **Pontas em agulha da rosa-dos-ventos**: 4 componentes de <0,5 cm de largura
   que ou somem (perde-se o formato) ou disparam "detalhe mínimo sub-milimétrico
   → não cortável à mão" e mandam a arte inteira para a rota cara do §3.2 por
   causa de 4 pontas contra fundo branco.
6. **Dourado com 16% do painel** pode disparar heurísticos de "campo de cor
   grande → considerar pintura geral". Não é: 78% continua sendo chapa.
7. **Curva em "S" com inflexão**: o histograma de curvatura muda de sinal. Um
   classificador que só olha |curvatura| não distingue "S suave" (fácil) de
   "zigue-zague" (difícil).

### 10. Correções à análise antiga

- **`analysis_D` §PADRÕES-3 — "keyline de fundo entre cores converte T-T em
  2×T-F; otimização nº 1 de custo; detectar filete de 1–4 px com morfologia
  sobre máscaras quantizadas"**: **está CORRETO e é a regra mais valiosa do
  documento antigo.** Esta arte é a sua demonstração mais forte de toda a base:
  três keylines (10 cm, 2–4,5 cm e 1–2 cm) reduzem a arte a zero T-T e a uma
  única sessão. **Manter e priorizar.**
- **`analysis_D` §10 (bismark) — "faixas de canto → aerografia em máscara (azul →
  3h → dourado); azul×dourado do canto = T-T suave longa → fita flexível+corte
  OU cura+adesivo"**: **ERRADO se transposto para cá.** A BURES tem exatamente a
  mesma composição (canto com faixa azul + faixa dourada) e **elas não se
  tocam** — não há 3 h de cura, não há segunda sessão. A `analysis_D` presumiu a
  T-T sem medir. Custo do erro: +1 dia inteiro.
- **`analysis_D` §10 item 5 — "emblema → impressão digital (única opção sã para
  metálicos/cromo/radial)"**: **ERRADO**, e a BURES mostra por quê: o emblema
  aqui é **duas chapadas separadas por chapa branca** — o mais fácil que existe.
  A regra "emblema circular com estrela = imprimir" teria destruído o orçamento
  desta peça.
- **`analysis_D` §PADRÕES-5 — "degradê → aerografia (linear) ou impressão
  (metálico)"**: o degradê dourado desta arte é **linear vertical de 180 cm** —
  o caso mais fácil de pistola que existe. A dicotomia "aerografia × impressão"
  precisa ser substituída por "modulação de pistola dentro da máscara ×
  PENDÊNCIA".
- **`analysis_D` §PADRÕES-4 — "texto pequeno → vinil"**: "TRANSPORTE &
  LOGÍSTICA" tem 17 cm de caixa. É pintado, com corte manual. E mesmo que fosse
  pequeno, seria máscara-máquina, não vinil de entrega.
- **`analysis_D` não amarra substrato → fita**: a faixa azul em "S" desta peça é
  o caso didático do §4. Em isoplastic: FITA_AMARELA, zero corte. Em chapa
  branca: corte manual. A `analysis_D` diria "fita flexível" nos dois casos e
  erraria o material em metade das obras.

---

# 6. BURES 2.jpg

### 1. Implemento e substrato provável
Lateral de baú (segunda versão / segundo veículo do mesmo cliente). Proporção
**3,49:1** (1600×458 px) → com 2,60 m de altura, ≈ **9,07 m de comprimento**.

**Substrato: CHAPA_BRANCA**, mesma justificativa da arte 5. **Fita amarela
proibida (§4)** — e aqui isso pesa muito mais, porque a arte é dominada por
**duas fitas/ondas curvas de 9 m**. Em isoplastic ou lona, as duas ondas seriam
**FITA_AMARELA**: curva livre, zero corte, o caso mais barato do §4. Em chapa
branca, **fita branca não faz curva** → obrigatoriamente **CORTE_MANUAL** de
duas curvas de 9 m. **Confirmar o substrato antes de orçar: é a diferença entre
~1 h e ~4 h de corte.**

### 2. Fundo
**Chapa original preservada, ~74%.** Sem pintura geral. As duas ondas ocupam a
faixa inferior (~90 cm de altura na extremidade direita, afinando para ~25 cm à
esquerda) e a logomarca ocupa o terço central-esquerdo superior.

### 3. Inventário de elementos
Escala derivada: 907 cm / 1600 px ≈ **0,567 cm/px**.

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Emblema circular (coroa azul-marinho em 4 quadrantes + rosa-dos-ventos laranja, separados por canais de chapa) | — | **Ø 125 cm** |
| E2 — Lettering azul-marinho | "Bu" | **85 cm** de caixa |
| E3 — Lettering laranja | "RES" | **85 cm** de caixa |
| E4 — Lettering cinza espacejado | "TRANSPORTE & LOGÍSTICA" | ~410 cm larg × 19 cm de caixa |
| E5 — Telefone azul-marinho, bold itálico | "(65) 99281-0087" | ~193 cm larg × **23 cm** de caixa |
| E6 — Onda dourada/laranja, atravessa os 9 m, espessura variável | — | **3 a 34 cm** de espessura, ~950 cm de percurso |
| E7 — Onda azul-marinho **com degradê** (marinho escuro → azul médio à direita), atravessa os 9 m e termina num campo cheio no canto inferior direito | — | espessura **3 a 80 cm**; campo direito ~310 × 78 cm |
| E8 — Filetes de chapa entre E6 e E7 nos trechos onde se separam | — | 2 a 12 cm |

### 4. Paleta
- Azul-marinho (~#123A6B) — **chapado** no emblema/lettering; **degradê**
  marinho→azul-médio na onda E7
- Laranja/ocre (~#D2860F) — **chapado** (emblema, "RES", onda E6)
- Cinza médio — **chapado** (E4)
- Branco = chapa preservada

### 5. Fronteiras T-T

| # | Par | Extensão do contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1a | **Dourado (E6) × Azul-marinho (E7)** — trecho central-direito, onde a onda azul corre colada por baixo/atrás da dourada | ≈ **570 cm** | **suave** — raio de curvatura estimado entre **200 e 400 cm**; uma única inflexão em "S" no terço central | **Azul** (≈3,6 m² total × ≈3,0 m² do laranja/dourado) |
| T-T 1b | **Dourado (E6) × Azul-marinho (E7)** — segundo trecho, onde a cauda inferior da onda azul reencontra a dourada à esquerda | ≈ **110 cm** | **suave**, raio ~250 cm | **Azul** |

Um único par de cores, **dois segmentos, ≈ 6,8 m de contato total**.

**Pares que NÃO se tocam:**
- **Azul (E1, coroa) × Laranja (E1, rosa-dos-ventos)**: **NÃO se tocam** — mesmos
  canais de chapa da arte 5, aqui com 2–5 cm (emblema é maior). Confirmado em
  ampliação.
- **Azul (E2 "Bu") × Laranja (E3 "RES")**: **NÃO se tocam** — filete de chapa de
  **~1,5 cm** ao longo de ~85 cm. Mesma quase-fronteira crítica da arte 5.
- **Cinza (E4) × qualquer cor**: não toca nada.
- **Azul (E5 telefone) × Dourado (E6)**: o telefone está ~20 cm acima da crista
  da onda dourada. Não se tocam — mas é o par mais próximo fora do lettering.
- **Emblema/lettering × ondas**: separados por ≥20 cm de chapa.

### 6. Ordem de pintura

Áreas estimadas: azul-marinho ≈ **3,6 m²** (onda 0,8 + campo direito 1,5 +
emblema 0,7 + "Bu" 0,5 + telefone 0,15) contra laranja/dourado ≈ **3,0 m²**
(onda 1,0 + "RES" 1,8 + estrela 0,25). Cinza ≈ 0,08 m².

- **T-T 1a/1b (dourado × azul)**: o azul cobre mais (3,6 × 3,0 m²) — a diferença
  é pequena (20%) mas real, e é decidida pelo campo azul cheio do canto inferior
  direito. → **pinta o dourado primeiro**, cura, mascara a onda dourada, pinta o
  azul por cima. Mascarar a onda dourada (≈1,0 m², faixa fina) é claramente mais
  barato que mascarar 3,6 m² incluindo um campo de 2,4 m².
  *Verificação de sensibilidade*: se a inspeção física mostrar que o campo azul
  do canto é menor do que parece no mockup, as áreas se invertem e a ordem
  também. Vale medir no implemento antes de cortar.
- Todos os outros elementos (emblema, "Bu", "RES", cinza, telefone) **não tocam
  nada** → entram na sessão que for mais conveniente. O ideal: "RES" + estrela
  laranja junto com a onda dourada (sessão 1); "Bu" + coroa + telefone junto com
  a onda azul (sessão 2); cinza em qualquer uma.

**Cadeia: (dourado + "RES" + estrela) → (azul + "Bu" + coroa + telefone + cinza)
→ verniz.** Duas sessões, uma cura.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E6 onda dourada (9 m, espessura 3→34 cm) | **CORTE_MANUAL** | Duas curvas suaves de raio 200–400 cm ao longo de 9,5 m, sem ilhas e sem micro-detalhe — o cenário exato do §3.1. **FITA_AMARELA seria a escolha se o substrato fosse isoplastic/lona** (§4: flexível, faz qualquer curva, sem corte) — em chapa branca está proibida. **FITA_BRANCA não serve**: não faz curva. As **pontas afiladas de 3 cm** nas extremidades exigem atenção; instruir o cortador a não perseguir o último centímetro. |
| E7 onda azul + campo do canto (9 m + 2,4 m²) | **CORTE_MANUAL** | Mesma geometria. O **degradê marinho→azul-médio** é modulação de pistola dentro da máscara (transição de ~400 cm — longuíssima, fácil), não uma segunda cor. |
| E1 emblema (Ø 125 cm) | **CORTE_MANUAL** | Arcos de raio 62 cm, canais retos de 2–5 cm. Mais fácil que na arte 5 (13% maior). |
| E2 "Bu" / E3 "RES" (caixa 85 cm) | **CORTE_MANUAL** | Letras de 85 cm. Trivial. Cortar as duas máscaras da mesma folha em registro, para garantir o filete de 1,5 cm por construção. |
| E5 "(65) 99281-0087" (caixa 23 cm, bold itálico) | **CORTE_MANUAL** | 23 cm de caixa, traço ~4 cm. Bem acima do limiar. Contraforma do "9" e do "8" com ~4 cm de vão — cortável. Note que **isto contraria diretamente a regra "telefones = vinil" da análise antiga**. |
| E4 "TRANSPORTE & LOGÍSTICA" (caixa 19 cm) | **CORTE_MANUAL** | Idem arte 5. |
| Empapelamento (74%) | **—** (papel + fita) | — |

Espovo (§3.3): esta é a arte da fatia que mais chega perto de justificá-lo — as
ondas são **muito grandes** (9,5 m) e **muito fáceis** (curva única, sem
detalhe). Um espovo batido **direto na chapa** marcaria as duas curvas de uma vez
e é a variante "faixa" citada na doutrina. **Ainda assim não recomendo**: seria
preciso furar ~19 m lineares de kraft à mão, contra ~4 h de corte de máscara —
e o §3.3 diz que é "raramente escolhido". Fica registrado como a única
alternativa legítima a considerar caso a oficina esteja sem filme de máscara.

### 8. Sequência de sessões e dias

- **D1 manhã — Preparação**: lavar 9,07 m; empapelar frisos, borrachas,
  ferragens; **traçar as duas ondas** (gabarito flexível de 9 m ou espovo direto
  na chapa, se optar por §3.3); aplicar máscara e cortar a onda dourada, o "RES"
  e a rosa-dos-ventos.
- **D1 tarde — Sessão 1: DOURADO/LARANJA** (onda + "RES" + estrela). Cura.
- **D2 manhã — Sessão 2: AZUL-MARINHO + CINZA**. Mascarar a onda dourada em toda
  a extensão dos 6,8 m de fronteira; cortar e pintar a onda azul (com modulação
  do degradê), a coroa do emblema, "Bu", o telefone e o cinza (o cinza vai junto
  porque não toca ninguém).
- **D2 tarde — Verniz.**

**Total: 2 dias.** O custo dobra em relação à BURES 1 por causa de **uma única
fronteira T-T de 6,8 m** — a métrica do §1 explica sozinha a diferença entre as
duas peças do mesmo cliente.

**Se o substrato for isoplastic**: as duas ondas viram FITA_AMARELA, o corte
some, e a peça volta para ~1,5 dia.

### 9. Armadilhas para o motor de visão

1. **As duas ondas ora se tocam, ora não.** Ao longo dos 9 m há trechos com
   filete de chapa de 2–12 cm e trechos de contato direto. Um motor que responde
   "dourado toca azul: sim/não" perde a informação útil. O que importa é o
   **comprimento do trecho em contato** (6,8 m de ~9,5 m) — é isso que
   dimensiona a máscara.
2. **Falsa T-T no emblema** (mesma armadilha da arte 5): canais de chapa de
   2–5 cm fechados por antialiasing.
3. **Falsa T-T entre "u" e "R"**: filete de ~1,5 cm.
4. **Degradê da onda azul quantizado em bandas** → fronteiras internas fantasmas
   ao longo de 9 m.
5. **Pontas afiladas de 3 cm** nas duas ondas: `detalhe_minimo_mm` vai reportar
   sub-centimétrico e mandar a peça para a rota do §3.2, por causa de ~30 cm de
   ponta contra chapa branca.
6. **Cálculo de área quase empatado** (3,6 × 3,0 m²): a decisão de ordem do §2
   depende de 20% de diferença, e essa diferença mora inteira no campo azul do
   canto inferior direito. Um erro de segmentação nesse canto **inverte a ordem
   de pintura** de toda a peça. O motor deve reportar a margem, não só a decisão.
7. **BURES 1 × BURES 2 são o mesmo cliente com custos diferentes**: 1 dia contra
   2 dias. Um motor que agrupa por "marca" ou por "logomarca detectada" daria o
   mesmo orçamento.

### 10. Correções à análise antiga

- **`analysis_D` §2 (BAHIA SUL) item 5 — "swooshes → fita amarela flexível nas
  bordas onde tocam o verde"**: **ERRADO por omissão do substrato**. Fita amarela
  só é permitida em isoplastic ou lona (§4). Aqui, em chapa branca, prescrever
  fita amarela para as ondas seria prescrever um material que não faz o serviço.
  A escolha certa é corte manual — ou fita amarela **depois** de confirmar
  isoplastic.
- **`analysis_D` §2 item 6 — "swoosh×faixa e swoosh×swoosh = T-T suaves → fita
  flexível+corte compensa (curvas longas abertas) OU cura 3h+adesivo"**: a
  dicotomia está incompleta e sem números. Sem comprimento (6,8 m) e sem raio
  (200–400 cm) não dá para escolher, e sem substrato a opção "fita" pode nem
  existir.
- **`analysis_D` §PADRÕES-4 — "fones e endereços → vinil final"**: **ERRADO**. O
  telefone "(65) 99281-0087" tem **23 cm de caixa** — é grande, é pintado, é
  corte manual. A regra antiga transformaria um elemento trivial numa etapa de
  adesivo que não existe.
- **`analysis_D` §PADRÕES-8 — "listras retas → FITA-RETA por metro linear"**:
  correto em espírito, mas o complemento que falta é o §4: **retas → fita
  branca (que exige corte); curvas → fita amarela só em isoplastic/lona; curvas
  em chapa → corte manual.** As ondas desta arte são curvas em chapa, o pior dos
  três casos.
- **`analysis_D` §PADRÕES-9 — "classificar fronteira T-T por curvatura
  (reta/suave → fita+corte; média/fechada/curta → cura+adesivo)"**: a segunda
  metade da regra é **ERRADA na formulação**. "Adesivo" aí não é uma alternativa
  à pintura — é a máscara. A regra corrigida é: reta → fita branca ou corte
  manual; suave/média em chapa → corte manual; suave/média em isoplastic/lona →
  fita amarela; fechada/extrema com micro-detalhe → máscara de máquina.
- **`analysis_D` §PADRÕES-3 (keyline)**: **acerto**, e aplica-se aqui aos canais
  do emblema e ao filete "u"/"R".

---

# 7. BOM PEIXE 9,50.jpg

### 1. Implemento e substrato provável
Lateral de baú de **9,50 m** (a medida está no nome do arquivo). Proporção
**3,92:1** (1600×408 px) → altura de painel ≈ **2,42 m**, o que é coerente com um
baú isotérmico (o isolamento come altura útil).

**Substrato: ISOPLASTIC** (alta confiança). Justificativa (§4): "BOM PEIXE —
Qualidade e confiança sempre à mesa" é distribuição de **pescado**, ou seja
**carga refrigerada/congelada** → baú isotérmico revestido em isoplastic
(poliéster reforçado com fibra de vidro), não chapa metálica. A proporção
altura/comprimento (2,42 m para 9,50 m) reforça: painéis isotérmicos são mais
baixos.

**Consequências do isoplastic:**
1. **FITA_AMARELA está liberada** para qualquer traçado curvo — mas esta arte não
   tem faixa nenhuma, então a liberação não é aproveitada. Se o cliente pedir
   faixa refletiva ou friso, aí sim: fita amarela, zero corte.
2. **Lixamento obrigatório** do isoplastic antes da pintura e após a retirada da
   máscara — etapa que não existe em chapa e que precisa entrar no cronograma.
3. O "branco" do isoplastic é levemente marfim, não branco puro — confirmar com
   o cliente se o contraste do azul-marinho sobre marfim atende.

### 2. Fundo
**Chapa/painel original preservado, ~88%.** Sem pintura geral. A logomarca do
peixe ocupa ~5,4 × 1,5 m no terço central-esquerdo e o slogan ocupa uma linha de
~5 m abaixo dela. Nenhum campo de cor.

O branco do "ventre" do peixe (o interior do contorno onde ficam as letras "BOM
PEIXE") é **painel preservado**, não tinta branca. Isso é essencial: o desenho é
um **contorno**, não uma silhueta cheia.

### 3. Inventário de elementos
Escala derivada: 950 cm / 1600 px ≈ **0,594 cm/px**.

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Contorno do peixe em azul-marinho: corpo lenticular + focinho pontiagudo + nadadeira dorsal + nadadeira ventral + cauda bifurcada | — | **540 cm** de comprimento × **148 cm** de altura; espessura do traço **6 a 18 cm** |
| E2 — Crescente vermelho interno superior, acompanhando a face interna do contorno | — | espessura **3 a 12 cm**, percurso ~285 cm |
| E3 — Crescente vermelho interno inferior (mais espesso na região do focinho) | — | espessura **3 a 15 cm**, percurso ~327 cm |
| E4 — Crescente vermelho da cauda, atrás da nadadeira caudal | — | espessura **5 a 20 cm**, percurso ~178 cm |
| E5 — Lettering azul-marinho, condensado, ligeiramente arqueado, dentro do ventre branco | "BOM PEIXE" | ~380 cm larg × **56 cm** de caixa |
| E6 — Três bolhas circulares azul-marinho, à esquerda do focinho | — | Ø **18 cm**, **13 cm** e **9 cm** |
| E7 — Símbolo de marca registrada azul-marinho | "®" | Ø **15 cm**, anel de ~1 cm |
| E8 — Slogan azul-marinho | "Qualidade e confiança sempre à mesa" | ~508 cm larg × **23 cm** de caixa, traço ~4 cm |

### 4. Paleta
Duas cores, **ambas chapadas, zero degradê**:

- Azul-marinho (~#28477E) — chapado — E1, E5, E6, E7, E8
- Vermelho-carmim (~#CE2B3C) — chapado — E2, E3, E4
- Branco/marfim = painel preservado — ventre, olho implícito, fundo

Esta é a arte cromaticamente mais simples da fatia depois da 100FRONTEIRAS.

### 5. Fronteiras T-T

Um único par de cores, em **dois segmentos** (contando o corpo como um segmento
contínuo e a cauda como outro):

| # | Par | Extensão do contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Vermelho (E2+E3) × Azul-marinho (E1)** — corpo | ≈ **612 cm** (≈285 cm na face interna superior + ≈327 cm na inferior) | **suave a média** — raio de curvatura entre **100 e 300 cm** ao longo do corpo, **fechando para ~25 cm** na ponta do focinho, onde os dois crescentes convergem | **Azul-marinho** (≈2,5 m² total × ≈0,35 m² do vermelho) — 7× maior |
| T-T 2 | **Vermelho (E4) × Azul-marinho (E1)** — cauda | ≈ **178 cm** | **média** — raio ~50 cm, com uma inflexão na bifurcação da cauda | **Azul-marinho** |

**Total: ≈ 7,9 m de fronteira T-T** — quase toda ela em curva suave/média, e
toda ela entre as **mesmas duas cores**.

Característica importante: o vermelho é sempre um **crescente afilado**, com o
lado externo colado no azul (T-T) e o lado interno contra o painel branco (T-F).
Ou seja, a máscara do vermelho é uma **fita curva de espessura variável**, com um
lado que precisa de precisão absoluta (contra o azul) e outro que tolera folga
(contra o branco).

**Pares que NÃO se tocam:**
- **Vermelho × Vermelho**: E2, E3 e E4 são três peças distintas; E2 e E3
  convergem no focinho mas são a mesma cor — irrelevante.
- **Azul (E5 "BOM PEIXE") × Vermelho**: as letras estão dentro do ventre branco,
  com ≥8 cm de folga do crescente vermelho. **NÃO se tocam.**
- **Azul (E5) × Azul (E1)**: na região da cauda, as letras "XE" encostam na
  nadadeira caudal — mas é **a mesma cor**, portanto **não é fronteira**: é um
  único componente, uma única máscara. (Armadilha clássica: parecem elementos
  distintos.)
- **Azul (E6 bolhas) × qualquer cor**: isoladas no painel branco, ≥10 cm do
  focinho. **T-F puro.**
- **Azul (E8 slogan) × qualquer cor**: ~30 cm abaixo do peixe. **T-F puro.**
- **Azul (E7 ®) × qualquer cor**: canto superior direito, isolado. **T-F puro.**

### 6. Ordem de pintura

Áreas: vermelho ≈ **0,35 m²** contra azul-marinho ≈ **2,5 m²** (contorno 1,2 +
lettering 0,8 + slogan 0,45 + bolhas 0,03 + ® 0,01).

- **T-T 1 e T-T 2 (vermelho × azul)**: o azul cobre **7× mais**. → **pinta o
  vermelho primeiro**, cura, mascara os três crescentes, pinta o azul por cima.
  Mascarar 0,35 m² de crescente (fita curva de 3–20 cm) contra mascarar 2,5 m² de
  contorno + lettering + slogan: a economia é de ~7:1 em filme e mais de 3 h de
  corte. É o exemplo perfeito do §2.
- Todos os demais elementos azuis (E5, E6, E7, E8) não tocam nada → entram na
  **mesma sessão** do azul, sem custo adicional de cura.

**Cadeia: vermelho → azul (tudo) → verniz.** Uma cura, duas sessões.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E2+E3+E4 crescentes vermelhos (7,9 m de percurso, espessura 3–20 cm, pontas afiladas) | **CORTE_MANUAL** | Curvas suaves/médias sem ilhas e sem micro-detalhe. Um cortador cobre 7,9 m de curva contínua em ~1,5–2 h. **FITA_AMARELA é tecnicamente permitida aqui (isoplastic!)** e faria a curva sem corte — **mas não serve**: a fita tem largura constante e o crescente varia de 3 a 20 cm, com bordas não paralelas. Fita amarela resolve *faixas*, não *crescentes de espessura variável*. Portanto: corte manual. |
| E1 contorno do peixe (540 × 148 cm, traço 6–18 cm) | **CORTE_MANUAL** | Curva fechada grande, sem detalhe fino. A nadadeira dorsal e a ventral têm pontas de ~2 cm — aceitáveis contra branco. |
| E5 "BOM PEIXE" (caixa 56 cm, condensada) | **CORTE_MANUAL** | Letras de 56 cm com hastes de ~10 cm; contraformas do "O" e do "P" com ~12 cm de vão. Trivial. Cortar **junto com E1 na mesma máscara** — é a mesma cor e as letras encostam na cauda. |
| E6 três bolhas (Ø 18, 13, 9 cm) | **CORTE_MANUAL** | Três círculos. A menor tem 9 cm de diâmetro — bem acima do limiar. |
| E7 "®" (Ø 15 cm, anel de ~1 cm, letra R de ~7 cm dentro) | **MASCARA_MAQUINA_SOBRE_VERNIZ**, variante **sobre o painel** | Anel de **1 cm** de espessura em Ø 15 cm, com um "R" de ~7 cm no interior e a contraforma do R com ~1,5 cm: está no limite inferior do estilete. Como o interior é painel preservado, a máscara-máquina vai **sobre o painel nu**, na mesma folha de qualquer outro micro-elemento. Custo marginal baixíssimo. Se a equipe tiver faca fina e paciência, CORTE_MANUAL também passa. |
| E8 slogan (caixa 23 cm, traço 4 cm, 34 caracteres) | **CORTE_MANUAL** | 23 cm de caixa. Muito acima do limiar. A cedilha do "ç" e o til do "ã" são ilhas de ~3 cm — cortáveis. |
| Empapelamento (88% do painel) | **—** (papel + fita) | — |
| **Lixamento do isoplastic** | etapa obrigatória | Antes de pintar e após retirar a máscara. Entra no cronograma como ~2 h. |

Espovo (§3.3): não. O peixe é grande (5,4 m) mas **não é fácil** — o contorno
tem espessura variável e pontas. §3.3 exige as duas condições.

### 8. Sequência de sessões e dias

- **D1 manhã — Preparação**: lavar 9,50 m; **lixar o isoplastic**; empapelar
  frisos, borrachas, ferragens; marcar a logomarca (o peixe tem 5,4 m — usar
  gabarito ou traçado a laser); aplicar a máscara-máquina do "®".
- **D1 tarde — Sessão 1: VERMELHO** (três crescentes, 0,35 m²). Corte manual dos
  7,9 m de curva; pintura; cura.
- **D2 manhã — Sessão 2: AZUL-MARINHO** (contorno + "BOM PEIXE" + bolhas + ® +
  slogan, tudo junto — nenhum deles toca outro, §6.4). Mascarar os crescentes;
  cortar; pintar.
- **D2 tarde — Lixamento leve + Verniz.**

**Total: 2 dias.**

**Espelhamento**: o peixe é **direcional** (nada da esquerda para a direita). No
lado oposto do baú a máscara tem de ser espelhada para que o peixe continue
"nadando para a frente" — a menos que o cliente prefira a mesma orientação nos
dois lados. Perguntar; o custo é o mesmo, mas o retrabalho não.

### 9. Armadilhas para o motor de visão

1. **"BOM PEIXE" e a cauda são a mesma cor e se tocam.** Um motor de segmentação
   por região vai criar dois componentes ("lettering" e "nadadeira") e reportar
   uma fronteira entre eles. Não é fronteira: é uma cor só, uma máscara só.
   Regra: **fronteira entre regiões da mesma cor = costura, não fronteira.**
2. **O ventre branco pode ser lido como "branco pintado".** O peixe é um
   contorno; o interior é painel. Se o motor tratar o branco como cor, ele vai
   propor pintar 1,8 m² de branco que não existe — e inverter completamente a
   ordem do §2 (o "branco" viraria a maior cobertura).
3. **Os crescentes vermelhos afinam para <1 cm.** `detalhe_minimo_mm` vai
   reportar sub-milimétrico nas pontas e mandar 7,9 m de curva suave para a rota
   cara do §3.2, por causa de ~5 cm de ponta.
4. **Antialiasing entre vermelho e azul cria um roxo fantasma** ao longo de
   7,9 m — o par de cores de maior extensão da peça pode virar três cores.
5. **Curvatura variável ao longo de um único elemento**: raio de 300 cm no meio
   do corpo e 25 cm no focinho. Um único número de "raio mínimo" classificaria a
   fronteira inteira como "fechada" e escolheria máscara de máquina. O §1 pede
   **histograma** de curvatura, não mínimo — e a decisão deve ser pelo percentil,
   não pelo extremo.
6. **Três bolhas isoladas** podem ser filtradas como sujeira/ruído (a menor tem
   9 cm em 950 cm de painel = 0,9%).
7. **Substrato invisível no mockup**: nada na imagem diz "isoplastic". A
   inferência vem do **ramo do cliente** (pescado → isotérmico), não dos pixels.
   O motor precisa de um campo de metadados do cliente, senão erra a escolha de
   fita e esquece o lixamento.

### 10. Correções à análise antiga

- **`analysis_D` §7 (BELLAVER FRUTAS) item 5 — "maçã → recorte plotado fiel aos
  rasgos (weeding pesado — centenas de ilhas; **alternativa: impressão do
  bloco**)"**: **ERRADO**. A alternativa "impressão do bloco" não existe. Este é
  o caso mais próximo do BOM PEIXE na base antiga (fruta/logo em duas chapadas
  com um contato curto) e a análise antiga já oferecia a saída proibida.
- **`analysis_D` §7 item 6 — "único T-T: cabo da folha × topo da maçã (suave,
  trecho curto) → cura 3h + adesivo (mais simples que fita para trecho curto)"**:
  a formulação "adesivo" como técnica final é ambígua e vem sendo lida como
  entrega. Aqui a formulação correta é: **cura + máscara de corte manual**. E o
  BOM PEIXE mostra que "trecho curto" não é a norma: são **7,9 m** de T-T entre
  duas cores, o que muda completamente o dimensionamento.
- **`analysis_D` §PADRÕES-4 — "slogans → vinil final"**: **ERRADO**. "Qualidade
  e confiança sempre à mesa" tem 23 cm de caixa e 4 cm de traço. É pintado, corte
  manual.
- **`analysis_D` §12 (BOI MIX traseira) — "selo SIF = vinil obrigatório"**:
  **ERRADO**, e é o análogo direto do "®" desta arte. Micro-símbolo oficial vira
  **máscara recortada a máquina sobre o painel**, e é pintado.
- **`analysis_D` §8 (BERGAMINI) item 1 — "se for sider de lona, nada se pinta
  (lona impressa)"**: **ERRADO pela doutrina §4**, que lista **LONA como
  substrato pintável** e inclusive como o caso onde a fita amarela é a melhor
  escolha. Lona não é sinônimo de impressão.
- **`analysis_D` nunca atribui substrato com consequência**: aqui o substrato
  (isoplastic) determina (a) o lixamento, (b) a liberação da fita amarela, (c) o
  tom marfim do fundo. Nenhuma dessas três consequências aparece na análise
  antiga.

---

# 8. CASA DO PÃO DE QUEIJO.jpg

### 1. Implemento e substrato provável
Lateral de baú. Proporção **3,19:1** (1600×501 px) → com 2,60 m de altura,
≈ **8,30 m de comprimento**.

**Substrato: ISOPLASTIC** (alta confiança). Justificativa (§4): distribuidora de
salgados e pão de queijo **congelados** → baú isotérmico. Reforça a leitura o
fato de a arte cobrir o painel inteiro de borda a borda, sem respeitar frisos —
típico de painel isotérmico liso.

**Consequências:** fita amarela liberada (mas esta arte não tem faixa nenhuma —
não se aproveita), **lixamento obrigatório antes e depois**, e — crucialmente —
**o isoplastic precisa de fundo/primer antes de uma pintura geral desta
magnitude**, o que adiciona uma demão e uma cura ao cronograma.

### 2. Fundo
**PINTURA GERAL. ~98% do painel é tinta.** Este é o único caso de pintura geral
da fatia, e é integral:

- **Vinho/bordô** (~#9E1B2F): ~**68%** do painel (todo o lado esquerdo e central,
  8,30 × 2,60 m menos o campo amarelo).
- **Amarelo-ouro** (~#FDC300): ~**30%** (a extremidade direita, ~250 cm de
  largura, com uma divisa recortada em torno da logomarca circular).
- **Painel preservado: ≈ 2%** — e mesmo esses 2% não são "fundo": são as bandejas
  brancas das fotos e os brancos do lettering, ou seja, **ilhas de painel
  reservadas dentro de blocos pintados**.

Isso muda o pipeline inteiro (§6.2): entra lavagem + lixamento + empapelamento
total + fundo/primer + duas cores de campo, antes de qualquer elemento gráfico.
Não existe "economia de fundo branco" nesta arte.

### 3. Inventário de elementos
Escala derivada: 830 cm / 1600 px ≈ **0,519 cm/px**.

| Elemento | Texto exato | Dimensão estimada |
|---|---|---|
| E1 — Campo vinho/bordô | — | ~600 × 260 cm |
| E2 — Campo amarelo-ouro (extremidade direita, divisa vertical com recorte curvo em torno de E7) | — | ~250 × 260 cm |
| E3 — Lettering script pincelado, branco (painel reservado) | "Deliciosos e" | ~250 cm larg × **31 cm** de caixa; traço **2 a 8 cm**; acentos e pingos soltos |
| E4 — Lettering display amarelo com contorno escuro | "ORIGINAIS" | ~290 cm larg × **39 cm** de caixa |
| E5 — Raios/starburst amarelos (≈8 traços afilados) acima de "e" | — | 10 a 26 cm cada, ~2 cm de espessura |
| E6 — Faixa/banner rosa-avermelhado com pontas recortadas, texto branco | "casadopaodequeijoecia.com.br" | ~272 cm larg × **23 cm** de altura; texto com **10 cm** de caixa |
| E7 — Logomarca circular: anel externo dourado biselado + anel vermelho brilhante com reflexos + lettering branco em 3D em arco + anel dourado interno + **inserto fotográfico** (cozinha ao fundo com pão de queijo num prato) | "Casa do Pão de Queijo" + "& Cia" | **Ø 192 cm**; inserto fotográfico **Ø 104 cm**; letras do arco com **~20 cm** de caixa |
| E8 — Círculo tracejado branco (contorno pontilhado) | — | Ø **75 cm**, traço ~2 cm |
| E9 — **Bloco fotográfico A**: pães, esfihas e enroladinhos sobre bandejas brancas | — | ~450 × 90 cm (base esquerda) |
| E10 — **Bloco fotográfico B**: pilha de pães de queijo | — | ~80 × 75 cm |
| E11 — **Bloco fotográfico C**: grupo de coxinhas inteiras + uma coxinha cortada mostrando recheio de frango desfiado | — | ~184 × 260 cm (extremidade direita) |

### 4. Paleta
Esta arte quebra a régua: **quase nada é chapado.**

| Cor | Chapada ou degradê |
|---|---|
| Vinho/bordô (E1) | **chapada** |
| Amarelo-ouro (E2, E4, E5) | **chapada** |
| Rosa-avermelhado (E6) | **chapada** |
| Contorno escuro de "ORIGINAIS" | **chapada**, traço ~1,5 cm |
| Vermelho brilhante do anel do logo (E7) | **DEGRADÊ** com reflexos especulares e sombreado 3D |
| Dourado/metálico dos biséis (E7) | **DEGRADÊ metálico** multidirecional |
| Brancos 3D do lettering do logo (E7) | painel reservado + **sombra/relevo em degradê** |
| E9, E10, E11 (fotográficos) | **degradês contínuos multidirecionais**: crostas douradas, brilhos, sombras projetadas, recheio de frango desfiado com dezenas de fibras individuais |
| Branco (E3, E8, texto de E6, bandejas) | painel preservado |

### 5. Fronteiras T-T

Esta é, de longe, a arte mais carregada da fatia. Pares de cores **ambas
não-brancas** em contato:

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | **Vinho (E1) × Amarelo (E2)** — divisa dos campos | ≈ **410 cm** (260 cm de trecho vertical + ~150 cm de recorte em torno do logo) | trecho vertical **reto**; recorte **médio** (raio ~90 cm) | **Vinho** (≈14,7 m² × ≈6,5 m²) |
| T-T 2 | **Amarelo (E4 "ORIGINAIS") × contorno escuro** | ≈ **990 cm** (perímetro de 9 letras) | **média**, com contraformas fechadas | **Amarelo** |
| T-T 3 | **Contorno escuro (E4) × Vinho (E1)** | ≈ **990 cm** | **média** | **Vinho** |
| T-T 4 | **Amarelo (E5 raios) × Vinho (E1)** | ≈ **440 cm** (8 traços × ~55 cm de perímetro) | **reta** afilada | **Vinho** |
| T-T 5 | **Rosa (E6 banner) × Vinho (E1)** | ≈ **590 cm** | **reta** com pontas recortadas em "V" | **Vinho** |
| T-T 6 | **Vermelho do logo (E7) × Dourado dos biséis (E7)** | ≈ **1130 cm** (2 circunferências de Ø ~180 e ~110 cm) | **fechada** constante | **Vermelho** |
| T-T 7 | **Dourado (E7) × Amarelo (E2)** | ≈ **300 cm** (arco externo sobre o campo amarelo) | **fechada**, raio 96 cm | **Amarelo** |
| T-T 8 | **Dourado (E7) × Vinho (E1)** | ≈ **300 cm** (arco externo sobre o campo vinho) | **fechada**, raio 96 cm | **Vinho** |
| T-T 9 | **Fotográfico C (E11 coxinhas) × Amarelo (E2)** | ≈ **500 cm** | **extrema** — silhueta irregular de 5 coxinhas com pontas e reentrâncias | **Amarelo** |
| T-T 10 | **Fotográfico A+B (E9, E10) × Vinho (E1)** | ≈ **1000 cm** | **extrema** — silhueta de dezenas de pães sobrepostos | **Vinho** |
| T-T 11 | **Inserto fotográfico (E7) × Dourado interno (E7)** | ≈ **330 cm** (circunferência de Ø 104 cm) | **fechada** | **Dourado** localmente |

**11 pares de cor T-T distintos, ≈ 70 m de contato somado.** Compare com a
BURES 1 (0 m) — a métrica do §1 sozinha explica a diferença de custo entre as
duas artes.

**Pares que NÃO se tocam:**
- **Rosa (E6) × Amarelo (E2)**: separados por ~180 cm.
- **Amarelo dos raios (E5) × Amarelo do campo (E2)**: mesma cor, separados.
- **Círculo tracejado (E8) × qualquer cor não-branca**: é branco (painel
  reservado) sobre vinho → T-F.
- **Script "Deliciosos e" (E3) × qualquer cor não-branca**: é branco (painel
  reservado) sobre vinho → T-F. **Mas isso só é verdade se o script for pintado
  como reserva de painel** — ver §7.

### 6. Ordem de pintura (§2)

Áreas: contorno escuro de E4 ≈ **0,25 m²** < raios E5 ≈ **0,05 m²** < rosa E6 ≈
**0,6 m²** < "ORIGINAIS" amarelo ≈ **0,8 m²** < campo amarelo E2 ≈ **6,5 m²** <
campo vinho E1 ≈ **14,7 m²**.

Cadeia obrigatória, par a par:

1. **T-T 1 (vinho × amarelo)**: amarelo 6,5 m² contra vinho 14,7 m² → **amarelo
   primeiro**, cura, mascara o campo amarelo (6,5 m²), pinta vinho. Mascarar
   6,5 m² é caro, mas mascarar 14,7 m² é 2,3× pior.
2. **T-T 4 (raios amarelos × vinho)**: os raios são amarelos sobre o campo
   vinho — **pintá-los na mesma sessão do campo amarelo** exigiria mascarar o
   vinho antes, o que ainda não existe. Solução correta: os raios entram como
   **reserva** — a máscara do campo vinho carrega 8 janelas de raio, pintadas com
   o amarelo **antes** do vinho, na sessão 1. Isso mantém a regra (amarelo antes
   de vinho) sem sessão extra.
3. **T-T 2/3 ("ORIGINAIS")**: contorno escuro (0,25 m²) < amarelo das letras
   (0,8 m²) < vinho (14,7 m²) → **contorno → amarelo → vinho**. Na prática:
   pintar o contorno e o amarelo das letras na sessão 1 (com o campo amarelo),
   como reservas dentro da futura área vinho.
4. **T-T 5 (rosa × vinho)**: rosa 0,6 m² < vinho 14,7 m² → **rosa antes do
   vinho**. Entra também na sessão 1 (rosa não toca amarelo).
5. **T-T 6/7/8/11 (logomarca)**: a logomarca inteira (2,9 m²) é menor que
   qualquer campo → **vem depois** dos campos, sobre eles, porque ela **se
   sobrepõe** à divisa dos dois. Aqui a regra do §2 se inverte na prática: o
   elemento pequeno é aplicado por último porque está **por cima** de duas cores
   grandes. A leitura doutrinária correta: os campos são o "fundo" (§6.2), e a
   logomarca é um elemento sobre fundo curado, mascarado como janela.
6. **T-T 9/10 (fotográficos × campos)**: idem — blocos aplicados sobre campos
   curados, como janelas mascaradas.

**Cadeia final: (amarelo do campo + amarelo das letras + raios + contorno escuro
+ rosa) → vinho → logomarca → blocos fotográficos → verniz.**

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| E2 campo amarelo (250 × 260 cm) | **CORTE_MANUAL** | Divisa com um trecho reto de 260 cm e um recorte curvo de raio ~90 cm. Cortável com folga. |
| E1 campo vinho (600 × 260 cm) | **CORTE_MANUAL** (é o campo restante; a máscara é o amarelo já curado) | — |
| E4 "ORIGINAIS" (caixa 39 cm, contorno de 1,5 cm) | **CORTE_MANUAL** para o amarelo; **MASCARA_MAQUINA_SOBRE_VERNIZ** para o contorno de 1,5 cm | As letras têm 39 cm — fáceis. O **contorno de 1,5 cm** acompanhando 990 cm de perímetro é o problema: cortar duas linhas paralelas a 1,5 cm de distância ao longo de 10 m à mão é possível, mas a variação humana aparece. Máquina para o contorno é o uso correto do §3.2. |
| E5 raios (8 traços de 10–26 cm × 2 cm) | **CORTE_MANUAL** | Traços retos afilados de 2 cm de espessura. Cortáveis. |
| E6 banner rosa (272 × 23 cm) | **CORTE_MANUAL** | Retângulo com pontas em "V". Trivial. |
| E6 texto "casadopaodequeijoecia.com.br" (caixa 10 cm, branco) | **MASCARA_MAQUINA_SOBRE_VERNIZ**, variante sobre painel/rosa | 28 caracteres com caixa de 10 cm e traço de ~1,5 cm, incluindo pontos de ~1 cm. No limite do estilete e com 28 chances de errar. Máquina. O branco é **painel reservado**: a máscara vai antes do rosa. |
| E3 script "Deliciosos e" (caixa 31 cm, traço 2–8 cm, branco) | **CORTE_MANUAL**, com ressalva | Script pincelado com traços de 2 a 8 cm — a maior parte é cortável. As **entradas e saídas de pincel afilam para <1 cm** e há acentos soltos de ~2 cm. É o elemento-limiar da arte. Recomendação: corte manual para os corpos das letras, **máscara-máquina para os acentos e as pontas de pincel**, na mesma folha do E6. |
| E8 círculo tracejado (Ø 75 cm, traço 2 cm, ~24 dashes) | **MASCARA_MAQUINA_SOBRE_VERNIZ**, variante sobre painel | 24 ilhas de 2 × 6 cm dispostas num círculo: posicionar à mão com espaçamento regular é inviável; a máquina corta o anel inteiro numa peça e resolve o registro. |
| E7 logomarca circular (Ø 192 cm) — anéis dourados biselados, anel vermelho com reflexos, lettering branco em 3D em arco, inserto fotográfico de cozinha com pão de queijo | **PENDÊNCIA — decisão do dono: aerografia × pintura artística à mão** | Os anéis são **metálicos com reflexos especulares**; o lettering tem **relevo 3D com sombra própria**; o inserto de Ø 104 cm é uma **fotografia de cozinha**. Nada disso é decomponível em máscaras: não há chapadas a delimitar, há modelagem de luz. **Não é adesivo impresso e não é impressão digital.** As duas saídas reais são (a) aerografia sobre o campo curado, (b) pintura artística à mão. A Ø 192 cm dá escala confortável para as duas. Estimativa grosseira: 1 a 2 dias de artista. **Confirmar com o dono antes de orçar.** |
| E9 bloco fotográfico A (pães/esfihas/enroladinhos sobre bandejas, 450 × 90 cm) | **PENDÊNCIA — aerografia × pintura à mão** | Dezenas de peças sobrepostas, crostas douradas com textura, brilhos, sombras projetadas nas bandejas, orégano salpicado. Fotorrealismo puro. |
| E10 bloco fotográfico B (pilha de pães de queijo, 80 × 75 cm) | **PENDÊNCIA — aerografia × pintura à mão** | ~14 esferas sobrepostas com sombreado mútuo. |
| E11 bloco fotográfico C (coxinhas + coxinha cortada com recheio de frango desfiado, 184 × 260 cm) | **PENDÊNCIA — aerografia × pintura à mão** | O recheio de frango desfiado tem **dezenas de fibras individuais** com brilho próprio; a crosta tem granulação. É o bloco mais difícil da fatia inteira. A 184 × 260 cm há escala para pintar — mas é trabalho de artista, não de pintor de máscara. |
| Empapelamento total + lixamento do isoplastic | etapa obrigatória | 98% do painel é pintado: empapelar borrachas, frisos, ferragens, perfis, e lixar o isoplastic antes do primer. |

**Nota central e não negociável**: E7, E9, E10 e E11 somam ~**8,5 m²** de
conteúdo fotográfico — mais de 40% do painel. A análise antiga chamaria isso de
"impressão digital obrigatória". **Não é uma opção.** É uma **PENDÊNCIA formal**
para o dono decidir entre aerografia e pintura artística à mão, e é o item que
domina o orçamento desta peça.

### 8. Sequência de sessões e dias

- **D1 — Preparação pesada**: lavar; **lixar o isoplastic** em todo o painel;
  empapelar borrachas, frisos, ferragens, perfis; aplicar **fundo/primer** em
  21,6 m²; cura.
- **D2 manhã — Sessão 1: AMARELO + ROSA + CONTORNO ESCURO** (§6.4: rosa não toca
  amarelo; o contorno toca só o amarelo das letras e o vinho, e o vinho ainda não
  existe). Inclui: campo amarelo (6,5 m²), "ORIGINAIS" amarelo, os 8 raios, o
  banner rosa. Reservas de painel já mascaradas: script E3, tracejado E8, texto
  do banner. Cura.
- **D2 tarde / D3 manhã — Sessão 2: VINHO** (14,7 m²). Mascarar todo o campo
  amarelo, o banner, as letras e os raios; pintar o vinho. É a maior sessão de
  pistola da fatia. Cura.
- **D3 tarde — Verniz do fundo** (necessário se a logomarca e os blocos forem
  para aerografia sobre superfície curada e envernizada, conforme §3.2). Cura.
- **D4 e D5 — PENDÊNCIA: logomarca + 3 blocos fotográficos**. 8,5 m² de
  aerografia ou pintura à mão. **Esta é a variável do orçamento**: pode ser
  1 dia (aerografia estilizada, simplificando as fotos) ou 3–4 dias (pintura
  realista fiel).
- **D6 — Verniz final.**

**Total: 5 a 8 dias**, dependendo inteiramente da decisão do dono sobre os blocos
fotográficos. Sem essa decisão **não é possível orçar esta arte** — a faixa é de
mais do dobro.

Comparação útil para o dono: BURES 1 = 1 dia; esta = 5 a 8 dias. Mesma metragem
de implemento.

### 9. Armadilhas para o motor de visão

1. **A armadilha número um: o motor vai querer "imprimir".** 8,5 m² de conteúdo
   fotográfico com milhares de clusters. Qualquer heurístico de "densidade de
   gradiente alta → impressão" (que é literalmente a regra §PADRÕES-5 da
   `analysis_D`) devolve a resposta proibida. A saída correta é **marcar
   PENDÊNCIA e parar** — não decompor, não imprimir, não estimar.
2. **Explosão combinatória de fronteiras**: as silhuetas dos blocos fotográficos
   têm curvatura extrema e ~15 m de perímetro somado. Um motor que tenta medir
   T-T por segmento produzirá milhares de micro-fronteiras, todas irrelevantes,
   porque o bloco inteiro é uma pendência única.
3. **Brancos que não são painel**: as bandejas brancas das fotos e os brilhos
   especulares **parecem** painel preservado, mas estão dentro de um bloco
   fotográfico. A regra "branco = painel" é verdadeira para E3 e E8 e **falsa**
   dentro de E9/E11. O motor precisa de escopo: a regra vale para o *layout*, não
   para dentro de um bloco pictórico.
4. **98% de cobertura**: o gatilho de pintura geral dispara corretamente, mas o
   heurístico "≥80% de UMA cor" não dispara (vinho tem 68%). O gatilho certo é
   **% total pintado**, não % da maior cor. Sem isso, o motor pula a etapa de
   primer e de empapelamento total.
5. **O contorno de "ORIGINAIS" tem 1,5 cm** e some no raster: o motor lerá
   "amarelo direto sobre vinho" e perderá **dois** pares T-T (T-T 2 e T-T 3) e a
   necessidade de uma máscara-máquina.
6. **A divisa vinho/amarelo é reta na maior parte e curva só em torno do logo**:
   um raio mínimo global classificaria os 410 cm inteiros como "curva média" e
   descartaria a solução barata (régua nos 260 cm retos).
7. **Aparência de "adesivo já pronto"**: esta arte é visualmente indistinguível
   de um envelopamento impresso. É exatamente por isso que ela é o teste mais
   duro da doutrina: **o produto final é pintura, sempre**, e o que não se pinta
   por máscara vira decisão humana, não vira impressão.
8. **Espelhamento**: os blocos fotográficos são direcionais (a coxinha cortada
   está à direita). Espelhar o lado oposto duplica o trabalho de artista — não é
   "a mesma máscara invertida". Custo real: 2× a pendência, não 1×.

### 10. Correções à análise antiga

Esta arte é onde a `analysis_D` erra de forma mais grave e mais cara:

- **`analysis_D` §6 (BANANA OURO VERDE) item 5 — "logo Bananas → **impressão
  digital obrigatória** (fotorrealismo)"**: **ERRADO, e é exatamente o caso desta
  arte** (cacho fotorrealista ≡ coxinhas/pães fotorrealistas). Não existe
  impressão digital como entrega. O destino é **PENDÊNCIA: aerografia × pintura
  artística à mão**, decidida pelo dono. A doutrina cita nominalmente este
  padrão ("morangos do 2 Amigos, banner dourado com dobras") como pendência.
- **`analysis_D` §3 (BAHIA SUL traseira) item 5 — "imprimir o bloco inteiro em
  painel adesivo — mais barato e consistente"**: **ERRADO**. Aplicado aqui,
  mandaria imprimir 8,5 m² e entregaria um envelopamento, não uma pintura.
- **`analysis_D` §10 (bismark) item 5 — "emblema → impressão digital (única
  opção sã para metálicos/cromo/radial)"**: **ERRADO**, e é o gêmeo exato da
  logomarca circular desta arte (anéis metálicos biselados + reflexos + lettering
  3D). A "única opção sã" é aerografia ou pincel — a impressão nunca foi uma
  opção.
- **`analysis_D` §PADRÕES-5 — "degradê = decisão de rota: linear/radial simples →
  aerografia; fotográfico/metálico multidirecional → **impressão do bloco
  inteiro** (não decompor)"**: **a regra transversal mais danosa do documento
  antigo. Deve ser removida do motor.** A substituição correta é: linear/radial
  simples → modulação de pistola dentro da máscara; fotográfico/metálico
  multidirecional → **PENDÊNCIA (aerografia × pintura à mão), sinalizada ao dono
  antes de orçar**.
- **`analysis_D` §6 item 5 — "filete da divisa → vinil escuro final"**:
  **ERRADO**. O análogo aqui é o contorno de 1,5 cm de "ORIGINAIS": é **pintado**
  por máscara recortada a máquina.
- **`analysis_D` §PADRÕES-4 — "texto pequeno nunca se pinta → vinil
  final/impressão"**: **ERRADO**. O endereço "casadopaodequeijoecia.com.br"
  (caixa 10 cm) é pintado, com máscara-máquina, e o branco é painel reservado.
- **`analysis_D` §6 item 6 — "verde×branco = T-F (fundo preservado)"**: este
  raciocínio **está certo** e deve ser mantido — é a mesma lógica que aqui
  classifica o script "Deliciosos e" e o círculo tracejado como T-F, e não como
  cor a pintar. É o único ponto em que a análise antiga aplicou "branco = fundo
  preservado" corretamente.
- **`analysis_D` §PADRÕES-9 — "estimar dias por nº de janelas sequenciais (+2
  pintura geral, +1 aerografia, +0,5 vinis)"**: a aritmética falha aqui por uma
  ordem de grandeza. Esta arte tem 5 a 8 dias, e a variância inteira está numa
  pendência que a fórmula não modela. O motor tem de devolver **"não orçável sem
  decisão do dono"**, não um número.

---

## Padrões transversais desta fatia (v2)

1. **A métrica T-T explica o custo melhor que qualquer outra.** Comparação
   direta, todas em lateral de baú de 8,3 a 9,5 m:
   BURES 1 (0 m de T-T) = 1 dia; BOM PEIXE (7,9 m) = 2 dias; BURES 2 (6,8 m) =
   2 dias; CASA DO PÃO DE QUEIJO (~70 m + pendência) = 5 a 8 dias. Sem medir T-T,
   as quatro pareceriam equivalentes.
2. **Keyline de painel é a maior alavanca de custo, e os designers já a usam.**
   BURES 1 tem três (10 cm entre painel dourado e swoosh; 2–4,5 cm no emblema;
   1–2 cm no lettering) e por isso cabe em uma sessão. 100FRONTEIRAS tem duas
   (6 cm e 12 cm) e por isso junta 3 cores numa sessão. Detectar filete de
   cor-de-fundo antes de declarar T-T é a primeira coisa que o motor deve fazer.
3. **Branco sobre cor não é impossível — é painel reservado desde o início.**
   Os selos da BRAVO, o "®" do BOM PEIXE, as estrelas da bandeira e o texto do
   banner da CASA são todos ilhas de painel protegidas por máscara-máquina
   aplicada **antes** da primeira demão. Isso dispensa o ciclo de verniz do §3.2
   sempre que o micro-detalhe é branco — economia recorrente de ~1 dia por peça.
4. **A junta central da traseira não é uma fronteira T-T.** Na BRAVO traseira o
   designer alinhou o vinco do desenho 3D com a fresta das portas. Contá-la como
   T-T insere uma cura inexistente. Regra: fronteira vertical na linha média de
   uma peça traseira = junta.
5. **Degradê monotônico dentro de um componente = uma cor modulada.** Vale para
   as facetas cinza e a faixa verde da BRAVO, o painel dourado da BURES 1 e a
   onda azul da BURES 2. Nenhum deles precisa de máscara adicional, nenhum deles
   é candidato a impressão.
6. **Substrato decide fita e decide lixamento, e não é legível nos pixels.**
   Vem do ramo do cliente: pescado e alimento congelado → isoplastic (BOM PEIXE,
   CASA); transportadora de carga geral → chapa branca (100FRONTEIRAS, BRAVO,
   BURES). A consequência mais cara está na BURES 2: as duas ondas de 9 m são
   FITA_AMARELA em isoplastic e CORTE_MANUAL em chapa.
7. **A mesma logomarca em duas escalas tem duas estratégias.** A bandeira do
   Brasil da 100FRONTEIRAS é máscara-máquina na lateral (Ø 45 cm) e PENDÊNCIA na
   traseira (Ø 15 cm). O limiar `cortavel_a_mao` tem de ser **métrico absoluto**,
   nunca normalizado pela imagem.
8. **Peças do mesmo cliente devem ser rodadas em batelada.** BRAVO
   lateral + lateral espelhada + traseira compartilham cores, curas e a mesma
   folha de máscara-máquina: rodar juntas economiza ~1 dia. Idem 100FRONTEIRAS
   lateral + traseira.
9. **"Impressão", "vinil final" e "adesivo aplicado por cima" não aparecem
   nenhuma vez nesta análise, por construção.** Onde a máscara não alcança, a
   resposta é **PENDÊNCIA — aerografia × pintura artística à mão, decisão do
   dono** — e a peça não é orçável até essa decisão.
