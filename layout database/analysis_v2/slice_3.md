# Análise de produção v2 — fatia 3 (8 artes)

Rubrica: `api/PAINTING_PRODUCTION_DOCTRINE.md` (ago/2026). Esta análise **substitui**
o que `analysis/analysis_C.md` diz sobre as artes aqui presentes.

Premissas aplicadas em todas as artes:

- **Adesivo nunca é produto final.** Vinil/máscara existe só para delimitar tinta.
- **Branco nunca é tinta.** Todo branco/quase-branco é **chapa (ou lona) preservada por
  máscara aplicada ANTES da primeira demão**. Isso inverte a ordem de várias análises antigas.
- **Só o corte do formato da máscara é feito por máquina.** Posicionar, depilar, cortar in
  situ, mascarar, bater carvão, pintar e envernizar é tudo manual.
- **Fronteira T-T** = duas cores **ambas não-brancas** se tocando. Fronteira contra a
  chapa/lona preservada é **T-F** e não gera trabalho de proteção.
- **Ordem (§2)**: entre duas cores que se tocam, pinta primeiro a de **MENOR** cobertura,
  mascara ela, pinta a de maior por cima.
- Blocos fotográficos (degradês contínuos, tecido, foto) → **PENDÊNCIA**: aerografia ou
  pintura artística à mão. Nunca impressão.

Escala: derivada do nome do arquivo quando há medida; senão inferida da proporção do
layout assumindo 2,45–2,60 m de altura de painel. Comprimentos T-T são estimativas
(±25%) obtidas por contagem de pixels de fronteira sobre o layout reamostrado a 900 px
de largura, corrigidas pelo fator de escada de rasterização.

---

## Tabela-resumo

| # | Arte | Substrato | Fundo | Fronteiras T-T (tipos de par / metros lineares) | Estratégia dominante | Complexidade |
|---|---|---|---|---|---|---|
| 1 | ACM 8,30m lateral | CHAPA_BRANCA | chapa original ~45%, sem pintura geral | **16 pares / ~130 m** | CORTE_MANUAL (retas de 43 cm) | **EXTREMA** |
| 2 | ACM 8,30m traseira | CHAPA_BRANCA | chapa original ~59%, sem pintura geral | **16 pares / ~50 m** | CORTE_MANUAL (retas de ~19 cm) | **EXTREMA** |
| 3 | BAHIA SUL lateral | CHAPA_BRANCA (flag: creme?) | chapa original ~68%, sem pintura geral | 1 par duro + 3 degradês internos / ~14,5 m | ESPOVO_DIRETO + CORTE_MANUAL | MÉDIA |
| 4 | BAHIA SUL traseira | CHAPA_BRANCA (flag: creme?) | chapa original ~86%, sem pintura geral | **0 pares duros** + 2 degradês internos / ~0 m | CORTE_MANUAL | BAIXA |
| 5 | astutilog-sider PRETO lateral | **LONA** (sider) | pintura geral PRETA ~62% sobre lona branca | 5 pares / ~15 m | FITA_AMARELA + CORTE_MANUAL | ALTA (pendência globo) |
| 6 | astutilog-sider PRETO traseira | CHAPA_BRANCA (portas) | pintura geral VERMELHA ~87% | 2 pares / ~13 m | CORTE_MANUAL | ALTA (pendência globo) |
| 7 | BERGAMINI 11,50 | CHAPA_BRANCA | chapa original ~63%, sem pintura geral | **0 pares / 0 m** | FITA_BRANCA + CORTE_MANUAL | BAIXA |
| 8 | CIPRIANO | CHAPA_BRANCA (pintada) | pintura geral LARANJA ~80% | 2 pares duros + bloco / ~50 m | CORTE_MANUAL | ALTA (pendência bandeira) |

**Total da fatia: ~50 tipos de par T-T, ~270 m lineares de fronteira tinta-tinta.**
Duas artes (ACM lateral+traseira) respondem sozinhas por ~65% dos metros e por ~32 dos 50 pares.
Três artes carregam **pendência de bloco fotográfico** (globo Astutilog ×2, bandeira Cipriano).

---

# 1. ACM 8,30m lateral.jpg

### 1. Implemento e substrato provável
Baú seco de carga geral, **8,30 m × ~2,55 m** (layout 1600×488 px, proporção 3,28:1 →
830 cm / 254 cm; escala **0,52 cm/px**). Empresa é "DISTRIBUIDORA E TRANSPORTES", não
frigorífico — não há motivo para isoplastic. O fundo do layout é branco puro e responde
por 45% da área, o que só faz sentido econômico se for **chapa branca original preservada**.

**Substrato: CHAPA_BRANCA.**

Consequência para fita (doutrina §4): fita amarela está **fora** (só isoplastic/lona).
Restaria fita branca — mas a arte não tem uma única faixa curva; o mosaico é 100%
retilíneo e o logo é elíptico. Fita branca em traçado **horizontal-diagonal curto** não
ajuda: cada aresta tem 43 cm. Então a fita é irrelevante aqui e tudo cai em CORTE_MANUAL.

### 2. Fundo
**Chapa branca original, sem pintura geral.** Branco = 44,7% da lateral. O branco aparece
em três papéis diferentes, todos chapa preservada:
1. o campo central (onde ficam o logo e o texto),
2. os **triângulos brancos dentro do próprio mosaico** (são "buracos" do padrão, ~15–20 unidades),
3. as letras **A-C-M vazadas** dentro da elipse verde.

Nenhum deles é tinta branca. Todos são máscara aplicada antes de qualquer verde.

### 3. Inventário de elementos
1. **Faixa-mosaico esquerda** — malha de triângulos equiláteros, **lado ≈ 43 cm**, cerca
   de **70 triângulos**, ocupando x = 0…~420 px (≈ 218 cm de comprimento) × altura toda.
   A borda direita da faixa não é um contorno: é o padrão terminando em serrilha
   (triângulos isolados avançando para o campo branco).
2. **Faixa-mosaico direita** — mesmo padrão, mais larga (~245 cm), ~80–90 triângulos,
   também terminando em serrilha à esquerda.
3. **Logo ACM** — elipse verde-médio (#1F6B45), ~245 × 195 cm, com um **crescente verde
   mais escuro** (#2A5F42) atrás/sobreposto, visível no topo-esquerdo e na base-direita
   (dá o efeito de "seta de reciclagem"). Dentro, "**ACM**" em letras brancas vazadas,
   tipografia geométrica cortada em diagonal, altura de letra ≈ 78 cm.
4. **"DISTRIBUIDORA E TRANSPORTES"** — grafite (#3A3A3A), caixa alta, sem serifa,
   altura de letra ≈ 23 cm, largura total ≈ 262 cm, centralizada sob o logo, sobre branco.

Texto exato: `ACM` · `DISTRIBUIDORA E TRANSPORTES`

### 4. Paleta
Tudo **chapado**, zero degradê real. Sete verdes distintos no mosaico + o verde do logo:

| tom | RGB aprox | % da lateral | papel |
|---|---|---|---|
| verde-escuro | (40,104,72) | 17,8% | triângulos escuros + elipse do logo |
| verde-escuro-2 (crescente) | (42,95,66) | — (funde com o anterior na quantização) | crescente do logo |
| verde-médio | (88,184,120) | 7,5% | mosaico |
| verde-musgo | (8,136,72) | 7,3% | mosaico |
| verde-esmeralda | (24,184,88) | 5,9% | mosaico |
| verde-sálvia | (136,200,136) | 4,5% | mosaico |
| verde-claro | (168,216,168) | 4,4% | mosaico |
| verde-menta pálido | (216,232,216) | 7,6% | mosaico |
| grafite | (58,58,58) | 0,4% | texto |
| branco | chapa | 44,7% | fundo + triângulos vazios + letras ACM |

**Nenhum degradê.** Isso é excelente para pintura e péssimo para o cronograma: são
**8 tintas** distintas, não 8 tons de uma mesma coisa.

### 5. Fronteiras T-T (crítico)
Os triângulos são **contíguos, compartilham arestas inteiras**. Praticamente **todo par de
verdes se toca em algum ponto** do mosaico. Medição:

| par (ambas não-brancas) | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| esmeralda ↔ musgo | ~3.660 cm | **reta** (arestas de 43 cm) | musgo (7,3% vs 5,9%) |
| escuro ↔ musgo | ~2.060 cm | reta | escuro |
| menta ↔ claro | ~1.240 cm | reta | menta |
| médio ↔ sálvia | ~1.160 cm | reta | médio |
| médio ↔ esmeralda | ~1.010 cm | reta | médio |
| escuro ↔ médio | ~850 cm | reta | escuro |
| claro ↔ sálvia | ~740 cm | reta | sálvia |
| médio ↔ claro | ~595 cm | reta | médio |
| médio ↔ musgo | ~535 cm | reta | musgo |
| escuro ↔ menta | ~475 cm | reta | escuro |
| menta ↔ sálvia | ~410 cm | reta | menta |
| escuro ↔ claro | ~410 cm | reta | escuro |
| escuro ↔ esmeralda, menta ↔ musgo, menta ↔ esmeralda, claro ↔ musgo | < 350 cm cada | reta | — |
| **elipse verde-médio ↔ crescente verde-escuro** (logo) | **~330 cm** (dois arcos) | **suave**, raio ≈ 90–110 cm | elipse |

**Total ≈ 130 m de fronteira T-T** só nesta lateral, distribuídos em **16 tipos de par** e
em **algo entre 200 e 250 arestas individuais**.

Fronteiras que **NÃO** são T-T (e portanto não geram trabalho de proteção):
- qualquer verde ↔ campo branco (**T-F**) — inclusive toda a serrilha das duas faixas;
- letras "ACM" ↔ elipse verde (**T-F**, o branco é chapa);
- "DISTRIBUIDORA E TRANSPORTES" grafite ↔ branco (**T-F**);
- **o grafite do texto não toca nenhum verde** — está centralizado no campo branco, a
  ~50 cm de qualquer triângulo. Isso libera o grafite para **qualquer** sessão.

### 6. Ordem de pintura
Coberturas em ordem crescente: claro (4,4%) → sálvia (4,5%) → esmeralda (5,9%) →
musgo (7,3%) → médio (7,5%) → menta (7,6%) → escuro (17,8%).

Aplicando §2 par a par, a ordem consistente é exatamente essa cadeia:

```
1. verde-claro      (4,4%)  → mascara
2. verde-sálvia     (4,5%)  → mascara   [claro↔sálvia: sálvia cobre mais, vem depois ✔]
3. verde-esmeralda  (5,9%)  → mascara   [médio↔esmeralda: médio cobre mais, vem depois ✔]
4. verde-musgo      (7,3%)  → mascara   [esmeralda↔musgo: musgo cobre mais ✔]
5. verde-médio      (7,5%)  → mascara   [médio↔musgo: musgo cobre mais… ✘ conflito]
6. verde-menta      (7,6%)  → mascara
7. verde-escuro     (17,8%) → última    [escuro cobre mais que todos ✔]
```

Há **um conflito local** (médio × musgo, 7,5% vs 7,3% — diferença de 0,2%, dentro do erro
de medição). Resolver pela regra prática: a diferença é irrelevante, quem tem menos
**perímetro exposto** vai antes. O verde-médio tem mais arestas (toca 5 outros verdes),
o musgo toca 4 → **musgo antes, médio depois**, invertendo 4 e 5.

O grafite do texto entra em **qualquer** sessão (não toca cor nenhuma).

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3) |
|---|---|---|
| Mosaico (ambas as faixas), por cor | **CORTE_MANUAL** | Todas as arestas são **retas de 43 cm**. Reta longa é o caso mais fácil que existe para estilete + régua. O problema desta arte não é cortabilidade, é o número de cores. |
| Elipse do logo | **CORTE_MANUAL** | Curva suave, raio ~100 cm, perímetro ~700 cm. |
| Crescente escuro do logo | **CORTE_MANUAL** | Dois arcos suaves; a ponta de cada arco tem raio ~8 cm — no limite, mas cortável. |
| Letras "ACM" vazadas | **CORTE_MANUAL** (máscara de preservação, aplicada antes do verde) | Letras de 78 cm, geometria retilínea com um chanfro diagonal. Trivial. |
| "DISTRIBUIDORA E TRANSPORTES" | **CORTE_MANUAL** | Letras de 23 cm, sem serifa, hastes de ~4 cm. Cortável. |

**Nenhum elemento desta arte justifica MASCARA_MAQUINA_SOBRE_VERNIZ.** Nenhum justifica
espovo (o mosaico é grande mas não é "de formato fácil" — são 150 triângulos, bater carvão
em cada um é pior que cortar).

### 8. Sequência de sessões e dias
Todos os verdes se tocam entre si → **a regra 4 da §6 não salva nada aqui**. É uma cadeia
serial de 7 sessões.

```
D1  preparação: lavar, empapelar perfis/borrachas/ferragens.
    máscara de preservação de TODO o branco (campo central, triângulos vazios, letras ACM).
    S1: verde-claro          → cura → mascara
D2  S2: verde-sálvia         → cura → mascara
    S3: verde-esmeralda      → cura → mascara
D3  S4: verde-musgo          → cura → mascara
    S5: verde-médio          → cura → mascara
D4  S6: verde-menta          → cura → mascara
    S7: verde-escuro (elipse + crescente + triângulos escuros) + grafite do texto
D5  remoção de máscaras, retoque de arestas, verniz final.
```

**5 dias de cabine para UMA lateral.** Com a lateral espelhada do outro lado e a traseira,
o job inteiro passa de 10 dias.

> **Recomendação comercial obrigatória:** negociar a **redução da paleta de 7 para 3
> verdes** (escuro / médio / menta). Isso derruba de 7 sessões para 3 e de ~5 dias para
> ~2,5, sem alterar a leitura visual do mosaico a 20 m de distância — que é a distância
> real de leitura de um baú. Esta é a maior alavanca de custo de toda a fatia.

### 9. Armadilhas para o motor de visão
1. **Explosão de elementos**: um segmentador ingênuo devolve ~150 polígonos e trata cada
   triângulo como um "elemento". O correto é agrupar por **cor** e emitir 7 elementos
   multi-ilha, cada um com ~20 ilhas.
2. **Fusão de tons** (o erro caro): os 7 verdes estão a ΔE pequeno uns dos outros.
   Quantização tolerante funde `esmeralda`+`musgo` e `claro`+`sálvia`, devolvendo 4 cores
   e **subestimando o cronograma em 3 sessões**. Aqui a tolerância tem que ser apertada.
3. **Branco em três papéis**: fundo, triângulo vazio do mosaico e contraforma das letras
   ACM são a mesma cor com funções diferentes. Se o motor emitir "pintar branco", inventa
   uma 8ª cor e uma 8ª sessão que não existe.
4. **Serrilha da borda**: a transição do mosaico para o campo branco não é um contorno de
   faixa — é o padrão terminando. Um detector de "faixa" vai tentar traçar uma poligonal
   de 200 vértices que não corresponde a nada que se corta.
5. **Crescente do logo**: #1F6B45 vs #2A5F42 estão a ΔE ~6. Vai ser lido como uma cor só,
   apagando a única fronteira **curva** da arte.
6. **Compressão JPEG** nas arestas de 60° gera pixels intermediários que o motor pode
   promover a "cor real" — cada aresta vira uma faixa fantasma de 1 px.

### 10. Correções à análise antiga
Esta arte **não está em `analysis_C.md`**. As correções abaixo são aos **padrões
transversais** da análise antiga, que se aplicariam a ela e a levariam ao resultado errado:

- **Transversal #7** ("texto pequeno... altura < 6–8 cm ⇒ vinil recortado final"): aplicado
  aqui, mandaria "DISTRIBUIDORA E TRANSPORTES" (23 cm) para pintura e qualquer coisa menor
  para vinil final. **Vinil final não existe.** O escalonamento correto é
  CORTE_MANUAL → MASCARA_MAQUINA_SOBRE_VERNIZ, nunca "adesivo aplicado por cima".
- **Transversal #8** ("cores que realmente se tocam são raras"): **falso nesta arte**. Aqui
  praticamente todo par de cores se toca, ~130 m de T-T. A generalização de que respiros
  brancos resolvem tudo é o que fez a análise antiga não medir T-T.
- **Transversal #5** (fita escolhida pela **curvatura**): a doutrina §4 escolhe a fita pelo
  **substrato**. Em chapa branca não há fita amarela, ponto — mesmo que a curva seja suave.
- **Convenção do cabeçalho** ("T-T exige fita+corte OU cura ~3h + adesivo por cima"):
  o adesivo aqui é máscara, não acabamento; e a alternância não é "fita ou adesivo", é
  "corte manual sobre laca curada" (padrão) vs "máscara de máquina sobre verniz" (exceção).
- A análise antiga **nunca aplica a regra da menor cobertura primeiro** (§2). Numa arte de
  7 cores encadeadas, essa regra é o que define a sequência inteira.

---

# 2. ACM 8,30m traseira.jpg

### 1. Implemento e substrato provável
Traseira do mesmo baú: **portas duplas**, ~250 × 258 cm (layout 1600×1600 px, escala
**0,156 cm/px**). Ferragens (dobradiças, fechos, maçanetas verticais) não aparecem no
layout mas existem no físico e cruzam a arte.

**Substrato: CHAPA_BRANCA**, mesmo do conjunto lateral.

### 2. Fundo
**Chapa branca original, sem pintura geral.** Branco = 59,3%. Mesma tripla função da
lateral (campo central + triângulos vazios + letras ACM vazadas).

### 3. Inventário de elementos
1. **Faixa-mosaico esquerda** — malha triangular vertical colada à borda esquerda,
   largura ≈ 45 cm, ocupando a altura toda. **Triângulos de lado ≈ 19 cm** (menores que
   os da lateral!), ~110 unidades.
2. **Faixa-mosaico direita** — espelhada, largura ≈ 48 cm, ~110 unidades.
   Ambas as faixas têm a borda interna em serrilha de dentes triangulares grandes (efeito
   de "zigue-zague" de ~60 cm de amplitude).
3. **Logo ACM** — elipse verde + crescente verde-escuro + "ACM" vazado em branco.
   ~115 × 90 cm, centralizado no terço superior.
4. **"DISTRIBUIDORA E TRANSPORTES"** — grafite, altura de letra ≈ 8 cm, largura ≈ 127 cm.
5. **Metade inferior**: branco puro, vazia (só as faixas laterais continuam).

Texto exato: `ACM` · `DISTRIBUIDORA E TRANSPORTES`

### 4. Paleta
Idêntica à lateral, chapada: verde-escuro (24,120,72) 11,5%, verde-sálvia (120,200,136)
5,9%, verde-médio (88,184,104) 6,1%, verde-esmeralda (24,184,88) 5,8%, verde-claro
(168,216,168) 5,0%, verde-menta (216,232,216) 4,3%, verde-crescente escuríssimo
(40,72,56) 1,8%, grafite 0,3%, branco-chapa 59,3%.

Aqui a quantização **separou** o crescente do logo (40,72,56) do verde-escuro do mosaico
(24,120,72) — confirmando que na lateral eles são de fato dois tons distintos.

### 5. Fronteiras T-T

| par | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| sálvia ↔ médio | ~1.195 cm | **reta** (arestas de 19 cm) | médio |
| sálvia ↔ claro | ~810 cm | reta | sálvia |
| escuro ↔ esmeralda | ~500 cm | reta | escuro |
| claro ↔ menta | ~465 cm | reta | claro |
| escuro ↔ médio | ~455 cm | reta | escuro |
| esmeralda ↔ médio | ~405 cm | reta | médio |
| **escuro ↔ crescente** (logo) | **~340 cm** | **suave**, raio ≈ 45 cm | escuro |
| escuro ↔ sálvia | ~260 cm | reta | escuro |
| claro ↔ crescente | ~160 cm | reta | claro |
| sálvia ↔ menta | ~155 cm | reta | sálvia |
| escuro ↔ claro | ~145 cm | reta | escuro |
| demais pares (5) | < 140 cm cada | reta | — |

**Total ≈ 50 m de T-T em 16 tipos de par.** Área muito menor que a lateral, mas
**densidade de fronteira muito maior** (triângulos de 19 cm em vez de 43 cm), o que
significa mais tempo de corte por m² e mais risco de falha de máscara.

Não são T-T:
- verdes ↔ branco (T-F, inclusive as duas serrilhas internas);
- "ACM" ↔ elipse (T-F);
- grafite ↔ branco (T-F);
- **o grafite não toca verde nenhum** — está no campo branco central, a ~40 cm da faixa
  mais próxima. Vai em qualquer sessão.

### 6. Ordem de pintura
Cadeia crescente: crescente (1,8%) → menta (4,3%) → claro (5,0%) → esmeralda (5,8%) →
sálvia (5,9%) → médio (6,1%) → escuro (11,5%).

Verificações par a par: escuro↔crescente (escuro cobre 6× mais → crescente primeiro ✔);
sálvia↔médio (médio cobre mais → sálvia primeiro ✔); claro↔menta (claro cobre mais →
menta primeiro ✔); escuro é sempre o último ✔. A cadeia por cobertura é consistente,
sem conflito — diferente da lateral.

**Reutilizar as mesmas bateladas de tinta da lateral.** As duas faces têm exatamente a
mesma paleta; pintar traseira e lateral na **mesma sessão de cada cor** é a única
economia real disponível nesse conjunto.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| Mosaico por cor (2 faixas) | **CORTE_MANUAL** | Arestas retas de 19 cm. Menores que na lateral, mas ainda muito acima do limiar de corte à mão (o problema começa abaixo de ~2 cm de detalhe). |
| Elipse + crescente do logo | **CORTE_MANUAL** | Arcos suaves; a ponta do crescente tem raio ~4 cm — no limite inferior do estilete, mas viável. |
| "ACM" vazado | **CORTE_MANUAL** (máscara de preservação, antes do verde) | Letras de 37 cm. |
| "DISTRIBUIDORA E TRANSPORTES" | **CORTE_MANUAL** | Letras de 8 cm, hastes de ~1,3 cm. É o menor elemento cortável à mão da arte — **limiar**. Se o operador achar que rebarba, cai para MASCARA_MAQUINA_SOBRE_VERNIZ. |

### 8. Sequência de sessões e dias
Encadeada como a lateral, mas **sincronizada com ela** (mesma tinta, mesma sessão):

```
D1  preparação: lavar, empapelar dobradiças/fechos/borrachas de vedação.
    ATENÇÃO: alinhar as máscaras com as portas FECHADAS; o logo e o texto atravessam a
    junção das duas folhas → cortar a película na junção após aplicar.
    máscara de preservação de todo o branco.
    S1 crescente escuro (junto com a sessão correspondente da lateral)
D2  S2 menta → S3 claro
D3  S4 esmeralda → S5 sálvia
D4  S6 médio → S7 escuro + grafite
D5  remoção, retoque, verniz.
```

**Não acrescenta dias** ao conjunto se for pintada em paralelo com as laterais. Sozinha,
seria ~4 dias — o que mostra por que sincronizar é obrigatório.

### 9. Armadilhas para o motor de visão
1. Mesmas 6 armadilhas da lateral, agravadas: com triângulos de 19 cm e o layout
   reamostrado, cada triângulo tem ~30 px — perto do limiar em que a compressão apaga tons.
2. **Metade inferior vazia**: um detector de proporção/conteúdo pode concluir que o layout
   está cortado ou que o painel é menor do que é. A área branca inferior é intencional
   (fica atrás do para-choque e da faixa refletiva).
3. **A junção das portas não aparece no layout.** O motor não tem como saber que o logo
   está sobre uma descontinuidade física. Isso precisa vir do cadastro do implemento, não
   da imagem.
4. O crescente (40,72,56) e o verde-escuro (24,120,72) **estão separados aqui e fundidos na
   lateral**. Um motor que analise as duas faces do mesmo job independentemente vai emitir
   contagens de cor diferentes para o mesmo logotipo. Emparelhar faces pelo prefixo do
   arquivo e **unificar a paleta do job** antes de decidir sessões.
5. As serrilhas internas das duas faixas são espelhadas — o motor pode achar que são duas
   formas diferentes e gerar dois arquivos de máscara em vez de um espelhado.

### 10. Correções à análise antiga
Arte ausente de `analysis_C.md`. Correções aos padrões transversais aplicáveis:

- **Transversal #1** ("traseira = versão condensada da lateral, reusar paleta e reescalar
  máscaras"): a direção está certa, mas a análise antiga usa isso para **reduzir** o
  trabalho. Aqui a traseira tem os triângulos **na metade do tamanho** — a máscara
  reescalada não serve, e o corte é mais lento por metro, não mais rápido.
- **Transversal #3** ("blocos de alta entropia/micro-regiões → rotular impressão digital"):
  o mosaico ACM é exatamente um bloco de "micro-regiões" e um detector de entropia o
  classificaria como imprimível. **É pintado, triângulo a triângulo.** Entropia não é
  critério — o critério é "um humano corta isso com estilete?", e retas de 19 cm passam.
- **Transversal #11** ("traseiras têm portas... arte cruzando a junção → dividir máscara"):
  correto e mantido, é a única recomendação antiga que sobrevive integralmente.

---

# 3. BAHIA SUL lateral.jpg

### 1. Implemento e substrato provável
Baú seco de hortifrúti (distribuidora de frutas). Layout 1600×287 px, proporção **5,57:1**.
Assumindo 2,60 m de altura → **~14,5 m de comprimento** (carreta ou bitrem). Escala
**≈ 0,91 cm/px**. Sem medida no nome do arquivo — **inferência, confirmar**.

O fundo do layout é **osso/creme (#F5F4EC)**, não branco puro. Decisão crítica:
- se for a **chapa branca com iluminação de mockup** → 0% de pintura de fundo;
- se o cliente realmente quer um creme → vira **pintura geral** de 14,5 m e o job triplica.

Recomendação: tratar como **CHAPA_BRANCA** (o desvio é de 3 pontos em 255, típico de
mockup) e **sinalizar a confirmação ao dono antes de orçar**. Se confirmado isoplastic
(fruta refrigerada), libera fita amarela na onda inferior e o custo cai bastante.

**Substrato: CHAPA_BRANCA (flag: creme vs branco; flag: isoplastic?).**

### 2. Fundo
**Chapa original preservada, ~68% da lateral.** Sem pintura geral. O osso aparece em
quatro papéis, todos chapa:
1. o campo geral;
2. o **fio de contorno do mamão** (respiro de ~4 cm que separa a fruta do disco verde);
3. a **cavidade interna do mamão** (a lente clara onde ficam as sementes);
4. os vãos entre a fita clara e a massa escura da onda inferior, à esquerda.

### 3. Inventário de elementos
1. **Disco verde-oliva** — círculo de Ø ≈ 172 cm, atrás do mamão, com variação suave de
   tom (mais claro no topo-direito, mais escuro à esquerda/base).
2. **Mamão cortado ao meio** — ~135 × 200 cm. Composto de:
   - casca/polpa externa com **degradê vertical amarelo-ouro (#F8A808) → laranja (#F87808)**;
   - **cabinho** laranja no topo (~15 cm);
   - **cavidade** interna cor-osso (chapa preservada), formato de lente;
   - **~20 sementes pretas** elípticas de ~11 × 13 cm cada, distribuídas na cavidade.
   Todo o mamão é envolvido por um **fio osso de ~4 cm** que o separa do disco verde.
3. **"BahiaSul"** — lettering geométrico bold, letras conectadas, altura de caixa ≈ 100 cm,
   largura ≈ 490 cm. **Degradê vertical** de verde-oliva claro (#A8A828) no topo para
   verde-escuro (#4A7818) na base.
4. **"FRUTAS"** — âmbar/laranja (#F8A808), caixa alta muito espaçada, altura ≈ 25 cm.
5. **Onda inferior** — ocupa o terço inferior da lateral:
   - **massa verde-oliva escuro** subindo da base-esquerda e crescendo até dominar toda a
     direita do painel;
   - **fita verde-oliva claro** (#A8A828) acompanhando a massa em S muito longo, de
     ponta a ponta (~1.400 cm);
   - **segundo filete claro** destacado, que se separa da massa e sobe pelo canto
     superior-direito, sobre o osso.

Texto exato: `BahiaSul` · `FRUTAS`

### 4. Paleta
| cor | RGB | % | chapada / degradê |
|---|---|---|---|
| osso (chapa) | (245,244,236) | 68,3% | — |
| verde-oliva escuro | (72,120,24) | 13,8% | **chapada** (massa da onda + base do lettering) |
| verde-oliva claro | (168,168,40) | 6,2% | **chapada** (fita) / topo do degradê do lettering |
| verde-oliva médio | (120,136,24) | 5,5% | **degradê** (intermediário do lettering e do disco) |
| laranja | (248,120,8) | 0,9% | **degradê** (base da polpa) |
| âmbar | (248,168,8) | 1,4% | **degradê** (topo da polpa) + "FRUTAS" chapado |
| preto | (8,8,8) | 0,3% | **chapada** (sementes) |

Degradês reais: 3 (lettering, polpa do mamão, disco verde). Nenhum é fotográfico —
todos são degradês de 2 paradas em forma fechada, candidatos legítimos a **simplificação
para cor chapada** ou, se o cliente exigir, a **aerografia leve**.

### 5. Fronteiras T-T

| par | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| **fita verde-claro ↔ massa verde-escuro** (onda) | **~1.400 cm** — a fronteira dominante da arte | **suave**, S de raio > 500 cm, sem inflexão fechada | massa escura (13,8% vs 6,2%) |
| verde-claro ↔ verde-médio (dentro do lettering e do disco) | ~2.300 cm | é **degradê**, não fronteira dura | — |
| verde-médio ↔ verde-escuro (dentro do lettering) | ~1.950 cm | **degradê** | — |
| âmbar ↔ laranja (dentro da polpa) | ~480 cm | **degradê** vertical | — |
| sementes pretas ↔ polpa laranja | **~60 cm no total** (só 3–4 sementes da borda inferior encostam) | fechada, raio ~5 cm | laranja |

**Total de fronteira T-T DURA: ~14,6 m, em 2 pares.** Os outros 3 são transições internas
de degradê, que não exigem máscara se a cor for chapada.

**Fronteiras que NÃO se tocam — e por isso vão na mesma sessão:**
- **mamão (laranja/âmbar) e disco verde NÃO se tocam.** Estão separados pelo fio osso de
  ~4 cm em todo o contorno. → laranja e verdes podem ser pintados no mesmo dia.
- **sementes pretas e cavidade osso**: T-F (osso é chapa).
- **"FRUTAS" âmbar e o lettering verde NÃO se tocam** — há ~10 cm de osso entre eles.
- **"BahiaSul" e a onda inferior NÃO se tocam** — há ~25 cm de osso.
- **o disco verde e a onda inferior NÃO se tocam.**
- Todo contato de qualquer cor com o campo osso é **T-F**.

Este é o oposto exato da ACM: uma arte com muita cor e quase nenhuma interação.

### 6. Ordem de pintura
Só existe **um par duro** a ordenar:

```
1. fita verde-oliva claro (6,2%)   ← MENOR cobertura, vai primeiro
2. mascara a fita inteira
3. massa verde-oliva escuro (13,8%) ← MAIOR cobertura, por cima
```

Justificativa (§2): mascarar a fita, que é uma tira de ~15–25 cm de largura por 14 m,
gasta muito menos máscara do que mascarar a massa escura, que é um triângulo de vários m².

Os demais elementos (laranja, âmbar, preto, disco) **não têm ordem obrigatória** porque
não tocam nada.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3) |
|---|---|---|
| **Massa + fita da onda inferior** | **ESPOVO_DIRETO** para marcar o traçado nos 14 m, seguido de **CORTE_MANUAL** da máscara sobre a marca de carvão | Caso canônico do §3.3: elemento **muito grande** (14 m) e **muito fácil** (uma curva S sem inflexão). O espovo evita ter que transportar um desenho de 14 m com precisão à mão livre. Fita amarela está **proibida em chapa branca** (§4); fita branca não faz a curva. |
| Disco verde | **CORTE_MANUAL** | Círculo de 172 cm de Ø, raio constante — a curva mais fácil que existe. |
| Contorno do mamão + fio osso | **CORTE_MANUAL** | Forma orgânica grande (135 cm), curvas médias, raio mínimo ~10 cm no bico. |
| Sementes (20 elipses de 11 cm) | **CORTE_MANUAL** | 11 cm é grande. É trabalho repetitivo (20 recortes), não trabalho difícil. Estimar por unidade, não por área. |
| "BahiaSul" (letras de 100 cm) | **CORTE_MANUAL** | Letras enormes, geometria de bordas retas e arcos generosos. |
| "FRUTAS" (letras de 25 cm) | **CORTE_MANUAL** | Sem serifa, hastes de ~4 cm. |
| Degradê do lettering | **PENDÊNCIA** | Preferência: chapar em **um** verde (decisão comercial, economiza uma sessão inteira). Se o cliente exigir o degradê: aerografia sobre a máscara já cortada. |
| Degradê da polpa | **PENDÊNCIA** | Idem — chapar em laranja, ou aerografia amarelo→laranja dentro da máscara. |
| Degradê do disco | **PENDÊNCIA** | É o mais sutil dos três; chapar é a recomendação forte. |

**Nenhum MASCARA_MAQUINA_SOBRE_VERNIZ.** O menor detalhe da arte é uma semente de 11 cm.

### 8. Sequência de sessões e dias
Assumindo os degradês chapados (cenário recomendado):

```
D1  preparação: lavar, empapelar perfis/borrachas.
    espovo do traçado da onda (14 m) + corte manual da máscara da fita.
    S1: verde-oliva CLARO (fita da onda + segundo filete)
        — mesma sessão: nada mais usa este verde.
    cura.
D2  mascara a fita.
    S2 (sessão múltipla — nenhuma destas cores se toca):
        verde-oliva ESCURO (massa da onda + lettering "BahiaSul" + disco)
        LARANJA (polpa do mamão + cabinho + "FRUTAS")
        PRETO (20 sementes)
    cura.
D3  remoção de máscaras, retoque do fio osso do mamão, verniz geral.
```

**2 sessões de tinta, ~2,5 dias.** A regra 4 da §6 economiza aqui um dia inteiro: laranja,
preto e verde-escuro só podem ir juntos porque foi medido que **não se tocam**.

Se o dono decidir manter os 3 degradês, acrescentar 1 dia de aerografia entre D2 e D3.

### 9. Armadilhas para o motor de visão
1. **Fundo osso ≠ branco puro** (#F5F4EC). Um limiar rígido de "branco = chapa" falha e o
   motor emite pintura geral de 14,5 m — o erro mais caro possível nesta arte. Precisa de
   regra "quase-branco de baixa amplitude ⇒ chapa, com flag de confirmação".
2. **A cavidade do mamão é a mesma cor do fundo** e está **cercada** por laranja. Um motor
   que classifique "branco = fundo" vai achar que há um buraco no implemento; um que
   classifique por conectividade vai achar que é uma ilha de tinta branca. É chapa
   preservada por máscara — nem uma coisa nem outra.
3. **O fio osso de 4 cm** ao redor do mamão tem ~4 px no layout e some em thumbnail.
   Perdê-lo transforma dois T-F em um T-T falso (laranja↔verde) e adiciona uma sessão
   inexistente ao cronograma.
4. **Degradê de elemento × degradê de mockup**: os três degradês daqui são de elemento
   (alta amplitude, dentro de forma fechada), mas a variação do fundo osso é de mockup
   (baixa amplitude, campo inteiro). O motor tem que distinguir os dois — a heurística de
   amplitude serve.
5. **As sementes** são 20 regiões pretas pequenas dentro de uma região clara dentro de uma
   região laranja: um segmentador hierárquico ingênuo emite 3 níveis de aninhamento e pode
   inverter dentro/fora.
6. **A onda inferior sangra pelas duas bordas** do layout: o motor não consegue fechar o
   polígono e pode descartar o elemento como "aberto".
7. O layout tem **fio de contorno de arquivo** (linha fina ao redor de tudo) — não é moldura.

### 10. Correções à análise antiga
Arte ausente de `analysis_C.md`. Correções aos padrões transversais que a levariam a erro:

- **Transversal #5** ("curvas S longas e suaves nas divisas de campos = domínio da fita
  amarela flexível"): **errado aqui**. A doutrina §4 amarra a fita ao **substrato**, não à
  curvatura. Esta é chapa branca → fita amarela proibida. A onda vai de espovo + corte
  manual. A análise antiga teria orçado a solução mais barata que existe para um caso em
  que ela não é aplicável — subestimando o job em pelo menos meio dia.
- **Transversal #4** (degradês de elemento "reproduzir via impressão/aerografia"): a opção
  "impressão" tem que sair. Restam **chapar** (recomendado) ou **aerografia**.
- **Transversal #7** ("altura de letra < 6–8 cm ⇒ vinil"): não se aplica a nenhum elemento
  daqui, mas a regra em si está errada — o degrau é para máscara de máquina, não vinil final.
- **Transversal #8** ("designers deixam respiros brancos... cores que realmente se tocam
  são raras"): aqui a intuição da análise antiga acerta (o fio osso é exatamente isso), mas
  ela **nunca mede** o respiro. Sem medir, não dá para afirmar que laranja e verde vão na
  mesma sessão — e é justamente essa afirmação que economiza o dia.
- A análise antiga trata "cura + adesivo" como **alternativa mais cara** à fita. Na doutrina
  §3.1, corte manual sobre a laca curada é o caminho **PREFERIDO**, não o caro; o caro é
  máscara de máquina + ciclo de verniz.

---

# 4. BAHIA SUL traseira.jpg

### 1. Implemento e substrato provável
Traseira do mesmo baú, **portas duplas**. Layout 1523×1600 px → ~250 × 262 cm.
Escala **≈ 0,16 cm/px**. Mesmo substrato da lateral: **CHAPA_BRANCA** (com a mesma
ressalva do osso #F5F4EC e a mesma pergunta sobre isoplastic).

### 2. Fundo
**Chapa original preservada, ~86%.** Sem pintura geral. Toda a metade inferior do painel
é chapa nua (área que fica atrás do para-choque e da faixa refletiva).

### 3. Inventário de elementos
1. **Logo mamão completo** — disco verde-oliva (Ø ≈ 78 cm) + mamão cortado (~72 × 78 cm)
   com casca em degradê âmbar→laranja, cabinho, cavidade osso e **~20 sementes pretas**
   de ~5,5 × 6,5 cm cada. Fio osso de ~2,5 cm separando fruta e disco.
   Centralizado no terço superior.
2. **"BahiaSul"** — lettering em degradê vertical verde-claro→verde-escuro, altura de
   caixa ≈ 42 cm, largura ≈ 200 cm.
3. **"FRUTAS"** — âmbar, caixa alta espaçada, altura ≈ 11 cm.
4. **Metade inferior**: vazia.
5. **Sem onda inferior** — este é o elemento que a traseira NÃO herda da lateral.

Texto exato: `BahiaSul` · `FRUTAS`

### 4. Paleta
osso-chapa 86,0%; verde-oliva claro (136,152,40) 5,9%; verde-oliva escuro (88,120,24)
3,5%; âmbar (248,168,8) 1,7%; laranja (248,120,8) 1,2%; preto 0,5%.

Chapadas: verdes (se simplificados), âmbar do "FRUTAS", preto das sementes.
Degradês: lettering (vertical) e polpa (vertical). Os mesmos 2 da lateral, menos o do disco.

### 5. Fronteiras T-T

| par | contato | curvatura | cobre mais |
|---|---|---|---|
| verde-claro ↔ verde-escuro (dentro do lettering) | ~555 cm | é **degradê interno**, não fronteira dura | — |
| âmbar ↔ laranja (dentro da polpa) | ~117 cm | **degradê interno** | — |
| sementes pretas ↔ polpa | ~15 cm (2–3 sementes de borda) | fechada, raio ~3 cm | laranja |

**Fronteira T-T DURA: praticamente ZERO.** Este é o caso mais limpo da fatia inteira.

Explicitamente **não se tocam** (→ mesma sessão):
- **mamão ↔ disco verde**: separados pelo fio osso de 2,5 cm;
- **lettering verde ↔ logo**: ~20 cm de osso entre eles;
- **"FRUTAS" âmbar ↔ lettering verde**: ~6 cm de osso;
- **preto das sementes ↔ qualquer verde**: distantes.
- Todos os contatos com o osso são **T-F**.

### 6. Ordem de pintura
**Não há par T-T duro a ordenar.** A regra §2 não tem o que decidir aqui — e é exatamente
isso que faz a arte ser de um dia. Se o cliente insistir nos degradês, a ordem passa a ser
dentro de cada máscara (aerografia claro→escuro), não entre elementos.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| Disco verde | **CORTE_MANUAL** | Círculo de 78 cm. |
| Contorno do mamão + fio osso | **CORTE_MANUAL** | Forma de 72 cm, raio mínimo ~5 cm no bico. |
| 20 sementes de 5,5 × 6,5 cm | **CORTE_MANUAL** | 5,5 cm é pequeno mas cortável — é uma elipse simples, não um detalhe interno. **Limiar**: abaixo de ~3 cm, cairia para máscara de máquina. |
| "BahiaSul" (42 cm) | **CORTE_MANUAL** | Letras grandes, geometria limpa. |
| "FRUTAS" (11 cm) | **CORTE_MANUAL** | Hastes de ~1,8 cm. Cortável. |
| Degradês (lettering, polpa) | **PENDÊNCIA** — chapar (recomendado) ou aerografia | |

### 8. Sequência de sessões e dias
```
D1  preparação: lavar, empapelar dobradiças/fechos/borrachas.
    alinhar máscaras com as portas FECHADAS — o logo cai sobre a junção das duas folhas;
    cortar a película na junção depois de aplicada.
    S1 (sessão única — nada se toca):
        verde-oliva escuro (disco + lettering)
        verde-oliva claro (se mantiver 2 verdes chapados)
        laranja + âmbar (polpa, cabinho, "FRUTAS")
        preto (sementes)
    cura → remoção → verniz.
```

**1 sessão, 1 dia.** Sincronizar com a lateral: as mesmas tintas, os mesmos recortes em
escala menor (fator ~0,4). O disco/mamão da traseira é a mesma geometria em 45% do tamanho.

### 9. Armadilhas para o motor de visão
1. Mesma armadilha do **osso ≠ branco** da lateral, agravada: aqui o osso é 86% e um limiar
   rígido emitiria pintura geral quase total do painel traseiro.
2. **Metade inferior vazia** (~45% do painel): auto-crop pode descartar a face como
   "quase vazia" ou reescalar o conteúdo achando que o layout está mal enquadrado.
3. **Sementes de 5,5 cm** = ~34 px no layout original, ~6 px em thumbnail. Somem, e com
   elas some o único elemento preto do job.
4. **Fio osso de 2,5 cm** = ~15 px: mais frágil que na lateral. Se sumir, o motor inventa
   um T-T laranja↔verde e uma sessão extra.
5. **Mesma família de cores da lateral com percentuais diferentes** (verde-claro 5,9% aqui
   vs 6,2% lá): se o motor decidir a ordem §2 por face, pode emitir ordens contraditórias
   para o mesmo par. A ordem tem que ser decidida **no nível do job**, não da face.
6. A traseira **não tem** a onda da lateral — um motor que "reuse as decisões da lateral"
   (padrão transversal #1 da análise antiga) vai emitir espovo e fita para um elemento que
   não existe aqui.

### 10. Correções à análise antiga
Arte ausente de `analysis_C.md`. Correções aos padrões transversais:

- **Transversal #1** ("traseira = versão condensada da lateral; REUSAR paleta/decisões"):
  reusar **paleta** sim, reusar **decisões de estratégia** não. Aqui a traseira perde a
  onda (elimina o espovo e a única fronteira dura do job) e reduz as sementes de 11 cm
  para 5,5 cm (aproxima do limiar de corte manual). São decisões diferentes.
- **Transversal #2** (três arquétipos de fundo, limiar de 80% para pintura geral): o
  arquétipo está certo, mas o classificador "% da cor dominante ≥80% ⇒ pintura geral"
  **dispara falso aqui** — o dominante é o osso a 86%, e osso é chapa. O teste
  `é-branco?` tem que rodar **antes** do teste de percentual, e com tolerância.
- **Transversal #7** (vinil final para texto pequeno): "FRUTAS" tem 11 cm e a regra antiga
  o mandaria para vinil. Vinil final não existe; 11 cm corta-se à mão.
- A análise antiga não tem vocabulário para "**zero fronteiras T-T**". Ela sempre acha
  alguma coisa a mascarar. O achado mais valioso desta arte é negativo: **nada se toca,
  tudo numa sessão**.

---

# 5. astutilog-sider PRETO lateral.jpg

### 1. Implemento e substrato provável
**Sider (carreta de lona lateral)** — o nome do arquivo declara. Layout 1600×317 px,
proporção 5,05:1 → assumindo 2,68 m de altura de lona, **~13,5 m**. Escala
**≈ 0,84 cm/px**.

**Substrato: LONA.**

Consequência direta (§4): **fita amarela liberada** — flexível, faz qualquer curva, zero
corte. É o substrato mais barato da fatia para faixas curvas, e esta arte tem exatamente
uma faixa curva de 11 m.

Consequência de processo: sider é lona **removível** — produção em bancada com a lona
esticada, fora do chassi. Tinta flexível (vinílica), sem verniz poliéster rígido.

### 2. Fundo
O layout é preto em ~62% + grafite do swoosh em ~13%. **Preto não é branco → é pintura.**

Aqui há uma decisão doutrinária que a análise antiga errou de ponta a ponta:

> Se a lona for encomendada **preta de fábrica**, então "ASTUTI" branco, o filete branco do
> swoosh e a url branca teriam que ser **tinta branca** — o que a doutrina proíbe.
>
> Logo: **encomendar a lona BRANCA e pintar o preto**, preservando todo o branco por máscara
> aplicada antes da demão preta. É a única sequência compatível com "branco nunca é tinta".

**Fundo: PINTURA GERAL PRETA (~62%) sobre lona branca**, com todos os elementos brancos
mascarados antes.

### 3. Inventário de elementos
1. **Globo/monograma "a"** — Ø ≈ 169 cm, canto esquerdo. Quatro lóbulos translúcidos
   sobrepostos, cada um com **degradê contínuo** prata → cinza-médio → quase-preto,
   em direções diferentes. Há sobreposições com transparência (onde dois lóbulos cruzam,
   o tom é a multiplicação dos dois). **Bloco de degradê complexo.**
2. **"ASTUTI"** — branco, caixa alta, tipografia geométrica de cantos arredondados com
   contraformas fechadas (o "A" tem a barra deslocada). Altura de letra ≈ 76 cm.
3. **"LOG"** — cinza-médio (#888888), mesma tipografia, mesma altura, colado a "ASTUTI"
   com respiro mínimo.
4. **Swoosh inferior** — massa cinza-grafite (#282828) ocupando a base do painel da
   esquerda até a direita, com a aresta superior em curva ascendente única. Ao longo de
   toda essa aresta corre um **filete branco/prata em degradê**, de ~4–8 cm de largura,
   por ~11 m.
5. **"www.astutilogistica.com.br"** — branco, sobre o swoosh grafite, altura de letra
   ≈ 30 cm, largura ≈ 390 cm.
6. **Selo "Desde 2003"** — canto superior direito, placa cinza-médio de ~45 × 80 cm com
   moldura de fio de ~1,5 cm e cantos arredondados assimétricos. Dentro: "**Desde**" e
   "**2003**" em **script caligráfico** quase-preto com traços capilares (as finas dos
   laços têm **< 5 mm** de espessura real) e dois filetes horizontais de ~0,5 cm.
7. **Mini-selo SASSMAQ** — canto inferior esquerdo, ~35 × 25 cm, retângulo com fundo
   amarelo, borda e micro-texto ilegível na resolução do layout. Certificação obrigatória.

Texto exato: `ASTUTI` · `LOG` · `www.astutilogistica.com.br` · `Desde` · `2003` · `SASSMAQ`

### 4. Paleta
| cor | RGB | % | chapada / degradê |
|---|---|---|---|
| preto | (8,8,8) | 62,2% | **chapada** (fundo geral) |
| grafite | (40,40,40) | 13,1% | **chapada** (massa do swoosh) |
| branco (lona preservada) | — | 8,9% | — |
| cinza-médio | (136,136,136) | 6,1% | **chapada** ("LOG" + placa do selo) |
| escada de cinzas (72/104/168/200) | | 9,6% | **degradê** (globo + filete do swoosh) |
| amarelo | (248,216,56) | 0,04% | **chapada** (SASSMAQ) |

### 5. Fronteiras T-T

| par | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| **grafite do swoosh ↔ preto do fundo** | **~1.100 cm** | **suave** — arco único ascendente, raio > 800 cm, sem inflexão | preto (62% vs 13%) |
| **cinza-médio "LOG" ↔ preto** | ~380 cm | **média** — os bojos do O e do G têm raio ~15 cm | preto |
| **cinza-médio da placa "Desde 2003" ↔ preto** | ~250 cm | reta nos lados, **fechada** (raio ~6 cm) nos dois cantos chanfrados | preto |
| **script quase-preto "Desde/2003" ↔ cinza da placa** | ~600 cm de perímetro em traço capilar | **extrema** — laços de raio 1–3 cm, traços de < 5 mm | cinza (a placa) |
| **amarelo SASSMAQ ↔ preto** | ~120 cm | reta + micro-detalhes internos | preto |
| escada de cinzas ↔ escada de cinzas (dentro do globo) | ~2.700 cm | contínua, sem aresta | — (**degradê, pendência**) |

**Total de T-T dura: ~15 m em 5 pares** (+ o interior do globo, que é pendência).

**NÃO são T-T:**
- **filete branco do swoosh ↔ grafite**: o filete é lona preservada → **T-F**, ao longo de
  todos os 11 m. Isso é enorme: a aresta mais longa da arte não custa mascaramento duplo.
- **"ASTUTI" branco ↔ preto**: T-F.
- **"ASTUTI" ↔ "LOG"**: medido — **não se tocam**. Há um respiro de lona entre o "I" e o
  "L". Isso significa que o cinza-médio e o branco **não têm dependência**.
- **url branca ↔ grafite do swoosh**: T-F.
- **grafite do swoosh ↔ cinza-médio**: **não se tocam** (o swoosh está na base, "LOG" e a
  placa estão acima). → **mesma sessão**.

### 6. Ordem de pintura
Três cores pintadas: cinza-médio (6,1%), grafite (13,1%), preto (62,2%).

```
par grafite ↔ preto      : grafite (13,1%) < preto (62,2%)  → grafite primeiro
par cinza-médio ↔ preto  : cinza  (6,1%)  < preto (62,2%)  → cinza primeiro
par cinza-médio ↔ grafite: NÃO SE TOCAM                     → mesma sessão
par script ↔ placa cinza : script (~0,1%) < placa (6,1%)    → script depois? NÃO —
                           o script é traço capilar e não é cortável à mão; sai do
                           fluxo normal e vai para §3.2 (máscara de máquina sobre verniz)
```

Sequência resultante: **[cinza-médio + grafite] → mascara ambos → preto geral.**
Duas sessões apenas, graças à medição de que cinza e grafite não se tocam.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3/§4) |
|---|---|---|
| **Aresta superior do swoosh** | **FITA_AMARELA** | Substrato é **lona** (§4): fita amarela faz qualquer curva, sem corte. 11 m de arco suave é o caso barato canônico. |
| Massa do swoosh | pintura dentro da fita | — |
| Filete branco do swoosh | **máscara de preservação de lona** (fita amarela paralela, 4–8 cm de vão) | Branco = lona. Duas fitas amarelas paralelas resolvem o filete inteiro sem um corte. |
| "ASTUTI" (76 cm, branco) | **CORTE_MANUAL** da máscara de preservação | Letras enormes, contraformas de ~12 cm. Trivial. |
| "LOG" (76 cm, cinza) | **CORTE_MANUAL** | Idem. |
| url (30 cm, branca) | **CORTE_MANUAL** da máscara de preservação | Hastes de ~5 cm. Cortável com folga. |
| Moldura da placa "Desde 2003" | **CORTE_MANUAL** | Fio de 1,5 cm — no limite inferior, mas é um retângulo, não um laço. |
| **Script "Desde"/"2003"** | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Traço capilar de **< 5 mm** com laços de raio 1–3 cm. Nenhum humano corta isso com estilete no implemento. Caso de exceção do §3.2: pintar/curar/envernizar a placa, depois aplicar a máscara recortada a máquina e pintar o script. |
| **Mini-selo SASSMAQ** | **MASCARA_MAQUINA_SOBRE_VERNIZ** | 35 × 25 cm com micro-texto de certificação. Mesma janela do script. |
| **Globo** | **PENDÊNCIA** | Quatro lóbulos com degradês contínuos multi-direcionais e sobreposição translúcida. Não é adesivo impresso. Restam **aerografia** (provável) ou **pintura artística à mão**. Decisão do dono — é a diferença entre 4 h e 2 dias neste job. |

### 8. Sequência de sessões e dias
```
D1  lona BRANCA esticada em bancada (produção fora do chassi).
    máscaras de preservação de todo o branco: "ASTUTI", url, filete do swoosh
        (duas fitas amarelas paralelas).
    fita amarela na aresta do swoosh.
    S1 (sessão múltipla — cinza e grafite não se tocam):
        cinza-médio ("LOG" + placa do selo)
        grafite (massa do swoosh)
    cura (tinta flexível).
D2  mascara cinza e grafite.
    S2: PRETO geral (62%).
    cura.
D3  remoção; laca/verniz flexível.
    cura do verniz.
D4  §3.2: máscara recortada a máquina do script "Desde 2003" e do SASSMAQ,
        sobre o verniz curado; pintar; retirar.
        (esta é a única etapa que paga máquina de corte + ciclo de verniz)
D4/D5  PENDÊNCIA do globo: aerografia ou pintura artística à mão.
```

**~4 dias + a pendência do globo.** Repetir para o lado oposto (espelhado — o globo sempre
à frente; textos **nunca** espelham).

### 9. Armadilhas para o motor de visão
1. **Degradês do globo viram bandas falsas** na quantização: o motor devolve 5–7 "cores"
   e monta 5–7 sessões de pintura para o que é um único bloco de decisão pendente.
2. **Compressão JPEG no preto** gera blocos de (16,16,16) e (0,0,0) que a quantização
   promove a duas cores — um "preto claro" e um "preto escuro" inexistentes.
3. **O filete branco do swoosh** tem 4–8 cm (≈ 6 px no layout). Some em downscale; com ele
   some a única razão pela qual a aresta de 11 m é barata.
4. **O respiro entre "ASTUTI" e "LOG"** tem poucos pixels. Se o motor o perder, cria um par
   T-T branco↔cinza que **não existe** e serializa duas sessões que podem ser paralelas.
5. **Mini-selo SASSMAQ**: poucos pixels, alto risco de ser descartado como ruído — e é
   item **obrigatório** por certificação. Deve haver uma lista de "elementos de compliance
   nunca descartáveis".
6. **Script "Desde 2003"**: alta densidade de traço capilar. É exatamente o caso em que o
   motor precisa emitir `cortavel_a_mao: false`. Se emitir `true`, o operador descobre no
   implemento e o job atrasa um dia.
7. **`sider` e `PRETO` no nome do arquivo são metadados de substrato e de cor.** Parsear o
   nome é etapa 0. Mas `PRETO` aqui descreve a **arte**, não a lona a encomendar — a lona
   deve ser branca. Não confundir os dois.
8. O layout tem **fio de contorno de arquivo** que pode virar "moldura".

### 10. Correções à análise antiga
Esta arte **é o item 5 de `analysis_C.md`**. Erros explícitos:

| `analysis_C.md` diz | Por que está errado |
|---|---|
| "Caminho padrão de mercado: **impressão digital da lona inteira**" | Adesivo/impressão nunca é produto final (§0). A lona é **pintada**. |
| "Esfera com degradês: **impressão digital em adesivo para lona**" | Idem. O globo é **PENDÊNCIA**: aerografia ou pintura artística à mão. |
| "Swoosh prata degradê + site: **painel impresso**" | Idem. O swoosh é grafite chapado com filete de lona preservada + url mascarada. |
| "Selos pequenos: **vinil impresso**" | O script "Desde 2003" e o SASSMAQ são **MASCARA_MAQUINA_SOBRE_VERNIZ** — pintados. O vinil é só a máscara. |
| "'ASTUTI'/'LOG': vinílica com máscara plotada **OU vinil recortado**" | A alternativa "vinil recortado" (como acabamento) não existe. E "ASTUTI" é **lona preservada**, não tinta branca. |
| "**Recomendação: encomendar lona preta** e produzir só os elementos" | **Inverte a doutrina.** Com lona preta, todo o branco viraria tinta branca — proibido. A lona tem que ser **branca** e o preto é que é pintado. |
| "Fundo preto ~90%" | Medido: preto 62% + grafite do swoosh 13%. São **duas** cores, não uma, e a fronteira entre elas é a segunda maior T-T da arte. |
| "branco/cinza sobre preto = T-T se pintado; sobre lona preta de fábrica vira análogo a T-F" | O branco **nunca** é T-T, independente da lona, porque nunca é tinta. Já o **cinza-médio ↔ preto** é T-T de verdade e a análise antiga não o mediu. |
| "Ordem: lona preta → máscaras texto → vinílica branca" | Ordem invertida em dois níveis: (a) branco não se pinta; (b) §2 manda pintar a **menor** cobertura primeiro — cinza e grafite antes do preto, nunca depois. |
| "**1 dia**. (Impressão total: só confecção + 1 dia de instalação.)" | ~4 dias + pendência do globo. A estimativa antiga é 4× otimista porque supõe impressão. |
| "Curvas: letras bold = suaves; swoosh = suave longa; esfera = médias" | Descrição qualitativa sem comprimento nem raio. A doutrina §1 exige **cm e raio de curvatura** por fronteira. |

A análise antiga também **não identifica** o par mais valioso da arte: **cinza-médio e
grafite não se tocam**, e por isso podem ser pintados na mesma sessão (§6 regra 4).

---

# 6. astutilog-sider PRETO traseira.jpg

### 1. Implemento e substrato provável
Traseira do mesmo conjunto. Aqui **não é lona**: a traseira de um sider são **portas
metálicas**. Layout 1553×1600 px → ~250 × 258 cm. Escala **≈ 0,16 cm/px**.

**Substrato: CHAPA_BRANCA (portas metálicas).**

Consequência (§4): **fita amarela proibida** nesta face — o oposto da lateral do mesmo
job. Não há faixa curva aqui, então a restrição não dói; mas o motor precisa saber que
**as duas faces do mesmo veículo têm substratos diferentes**.

### 2. Fundo
**PINTURA GERAL VERMELHA (#981828, carmim escuro), ~87%.** Vermelho não é branco → é tinta.
Lavar, empapelar dobradiças/fechos/borrachas, fundo em vermelho próximo, vermelho final.

O branco de "ASTUTI" (#E8E8E8) é **chapa preservada**, mascarada antes do vermelho.

> Lateral preta + traseira vermelha é uma escolha de identidade incomum. **Confirmar com o
> cliente antes de misturar as tintas** — se for engano, o job inteiro muda.

### 3. Inventário de elementos
1. **Globo/monograma "a"** — Ø ≈ 70 cm, centralizado no topo. Mesmos quatro lóbulos em
   degradê contínuo prata→cinza→quase-preto, com sobreposição translúcida.
2. **"ASTUTI"** — off-white (#E8E8E8), altura de letra ≈ 32 cm.
3. **"LOG"** — grafite (#383838), mesma altura, colado a "ASTUTI".
4. **"www.astutilogistica.com.br"** — grafite, altura de letra ≈ 10 cm, largura ≈ 197 cm,
   logo abaixo do lettering.
5. **Metade inferior do painel**: vermelho puro, vazia.

Texto exato: `ASTUTI` · `LOG` · `www.astutilogistica.com.br`

### 4. Paleta
vermelho-carmim (152,24,40) 87,2%; grafite (56,56,56) 5,0%; off-white (chapa) 4,2%;
escada de cinzas do globo (104/152/184) 2,6%.

Chapadas: vermelho, grafite. Degradê: só o globo.

### 5. Fronteiras T-T

| par | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| **grafite ("LOG" + url) ↔ vermelho** | **~1.060 cm** | **mista**: retas nas hastes, **média** nos bojos do O/G/o/a (raio ~4 cm), **fechada** nos pontos e no ponto-final da url (raio ~1 cm) | vermelho (87% vs 5%) |
| **cinzas do globo ↔ vermelho** | ~220 cm | **suave** — circunferência de raio 35 cm | vermelho |
| cinzas ↔ cinzas (dentro do globo) | ~700 cm | contínua, sem aresta | — (**degradê, pendência**) |

**Total de T-T dura: ~12,8 m em 2 pares.**

**NÃO são T-T:**
- **"ASTUTI" off-white ↔ vermelho**: T-F (branco é chapa).
- **"ASTUTI" ↔ "LOG"**: **medido — não se tocam.** A adjacência entre o cluster off-white e
  o cluster grafite é nula; há um respiro de chapa entre o "I" e o "L". A análise antiga
  afirma o contrário (ver §10).
- **globo ↔ lettering**: separados por ~8 cm de vermelho — mas ambos tocam o vermelho, então
  isso não os torna independentes do vermelho; torna-os independentes **entre si**
  (grafite e cinzas do globo podem ir na mesma sessão).

### 6. Ordem de pintura
```
par grafite ↔ vermelho : grafite (5,0%) < vermelho (87,2%) → GRAFITE PRIMEIRO
par cinzas  ↔ vermelho : cinzas  (2,6%) < vermelho (87,2%) → CINZAS PRIMEIRO
par grafite ↔ cinzas   : NÃO SE TOCAM                       → MESMA SESSÃO
```

Sequência: **[grafite + cinzas do globo] → mascara → vermelho geral.**

Isso é o **inverso exato** do que a análise antiga propõe ("fundo vermelho D1 → cura →
máscara + branco D2"). Mascarar 5% da área é muito mais barato que mascarar 87%.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| "ASTUTI" (32 cm, off-white) | **CORTE_MANUAL** da máscara de preservação, aplicada **antes** do vermelho | Letras de 32 cm com contraformas de ~5 cm. Cortável com folga. |
| "LOG" (32 cm, grafite) | **CORTE_MANUAL** | Idem. |
| url (10 cm, grafite) | **CORTE_MANUAL** — **no limiar** | Letras de 10 cm, hastes de ~1,7 cm, mas com pontos e a sequência `.com.br` com detalhes de ~1 cm. Se o operador julgar que rebarba, cai para **MASCARA_MAQUINA_SOBRE_VERNIZ**. Este é o elemento a calibrar com o dono (§5: `cortavel_a_mao` não está calibrado). |
| Contorno externo do globo | **CORTE_MANUAL** | Circunferência de raio 35 cm. |
| Interior do globo | **PENDÊNCIA** | Mesmos degradês da lateral, em 41% do tamanho — o que os torna **mais** difíceis, não menos. Aerografia ou pintura artística à mão. Nunca impressão. |
| Vermelho | pintura geral | |

### 8. Sequência de sessões e dias
```
D1  preparação: lavar; empapelar dobradiças, fechos, borrachas de vedação, para-choque.
    máscara de preservação de "ASTUTI" (chapa).
    S1 (sessão múltipla — grafite e cinzas não se tocam):
        grafite ("LOG" + url)
        cinzas do globo (as paradas chapadas; o degradê fica para a pendência)
    cura.
D2  mascara grafite e cinzas.
    S2: VERMELHO geral (fundo próximo + vermelho final).
    cura → remoção → verniz.
D3  PENDÊNCIA do globo (aerografia ou pintura artística) + faixa refletiva traseira.
```

**~2 dias + a pendência do globo.** Sincronizar a pendência do globo com a da lateral —
é o mesmo desenho em duas escalas; decidir a técnica **uma vez** para o job inteiro.

### 9. Armadilhas para o motor de visão
1. **Grafite (#383838) sobre vermelho escuro (#981828)** tem contraste baixo em thumbnail;
   um segmentador pode **fundir "LOG" e a url ao fundo** e perder a maior fronteira T-T
   da face.
2. **Degradê do globo** → bandas falsas, mesma armadilha da lateral.
3. **Metade inferior vazia** (~40% do painel) confunde detecção de proporção e enquadramento.
4. **Anel de antialiasing vermelho/grafite**: a quantização criou um cluster inteiro
   (104,40,40) com 0,7% da área só de borda. Se promovido a cor real, o motor emite uma
   quarta sessão de pintura que é puro serrilhado.
5. **"ASTUTI" off-white é #E8E8E8, não #FFFFFF.** Um teste `== branco puro` falha e o motor
   emite tinta branca — violação direta da doutrina, e uma sessão a mais.
6. **Substrato diferente da lateral do mesmo arquivo-par** (lona × chapa). Se o motor
   herdar `LONA` do nome `sider`, libera fita amarela numa face onde ela é proibida.
7. O nome do arquivo diz `PRETO` mas esta face é **vermelha** — parsear o nome do arquivo
   como cor da face é um erro que este par de arquivos demonstra bem.

### 10. Correções à análise antiga
Esta arte **é o item 6 de `analysis_C.md`**. Erros explícitos:

| `analysis_C.md` diz | Por que está errado |
|---|---|
| "Esfera: **impressão digital** aplicada após o verniz (degradês)" | Adesivo impresso nunca é produto final (§0). É **PENDÊNCIA**: aerografia ou pintura artística à mão. |
| "'ASTUTI': máscara plotada + **laca branca** sobre vermelho curado" | **Duplo erro.** (a) Branco nunca é tinta: "ASTUTI" é chapa preservada. (b) A ordem está invertida — a máscara do branco vai **antes** do vermelho, não depois. |
| "'LOG' + site cinza-escuro: segunda cor → segunda sessão **ou vinil recortado cinza** (mais barato: 1 sessão de pintura só)" | "Vinil recortado" como acabamento não existe. O grafite é pintado, e vai na **primeira** sessão, não na segunda. |
| "**Ordem**: fundo vermelho (D1) → cura overnight → máscara + branco (D2 manhã) → cura 3h → cinza → verniz → esfera impressa por cima" | Viola §2 em cheio. Vermelho cobre **87%** e é a cor que deve ser pintada **por último**. Mascarar 87% da porta para pintar 5% de grafite é exatamente o desperdício que a regra da menor cobertura existe para evitar. |
| "'ASTUTI' e 'LOG' são **adjacentes sem vão** — fronteira T-T **reta** vertical entre o I e o L" | **Medido e refutado**: a adjacência entre o cluster off-white e o cluster grafite é **nula**; há respiro de chapa. E, mesmo que se tocassem, não seria T-T — branco não é tinta. Este é o exemplo mais claro da fatia de uma fronteira T-T **inventada**. |
| "Fundo vermelho escuro/carmim ~85% ⇒ PINTURA GERAL vermelha" | **Correto** — é a única conclusão da análise antiga que sobrevive nesta face. Medido: 87,2%. |
| "~2 dias" | Coincidentemente certo, mas pelo caminho errado (sem a pendência do globo, que pode acrescentar 1 dia). |
| "branco↔vermelho e cinza↔vermelho = T-T via cura+adesivo" | branco↔vermelho é **T-F**. Só cinza↔vermelho é T-T. A análise antiga conta **duas** fronteiras onde há **uma**, e depois não mede nenhuma das duas. |

---

# 7. BERGAMINI 11,50.jpg

### 1. Implemento e substrato provável
Baú seco de hortifrúti — "COMÉRCIO DE FRUTAS BERGAMINI LTDA.", box na CEASA de Foz do
Iguaçu. **11,50 m** (nome do arquivo). Layout 1600×294 px, proporção 5,44:1 → altura de
arte ≈ **2,11 m**. Escala **≈ 0,72 cm/px**.

Fundo branco em 63% da área e nenhuma cor cobrindo mais de 24% ⇒ o desenho foi feito
**para uma chapa branca**. Não é frigorífico; não há motivo para isoplastic.

**Substrato: CHAPA_BRANCA.**

Consequência (§4): fita amarela **proibida**. As faixas desta arte são **retas horizontais**
de 11,5 m — o caso exato da **fita branca** (não faz curva, é mais larga, exige corte nas
extremidades e nas interrupções).

### 2. Fundo
**Chapa branca original, sem pintura geral.** Branco = 62,9%.

Papéis do branco, todos chapa preservada:
1. o campo geral (metade inferior, onde ficam os 3 blocos de texto);
2. os **vãos de ~11,5 cm entre as 5 faixas verdes** — são chapa, não "faixas brancas";
3. o **cartucho central** onde vive o logotipo vermelho — o vão de ~10 cm acima e abaixo
   do lettering que impede o vermelho de tocar o verde;
4. as **contraformas** das letras do logotipo.

### 3. Inventário de elementos
1. **5 faixas horizontais verde-escuro** (#285838), **altura de 10,8 cm cada**, com vãos de
   **11,5 cm** entre elas, ocupando a metade superior do painel (banda total de ~103 cm).
   Comprimento: **11,50 m cada, de ponta a ponta**. Medido no layout:
   `y = 0–14, 32–46, 64–78, 96–110, 128–142 px`.
   As faixas **3 e 4** são **interrompidas no centro** (x ≈ 500–1080 px) pelo cartucho do
   logotipo; as faixas 1, 2 e 5 correm inteiras. Isso dá **7 segmentos** de faixa, não 5.
2. **"Bergamini"** — lettering geométrico bold arredondado em **vermelho** (#E83838),
   altura de caixa ≈ 33 cm, largura ≈ 390 cm, centralizado na banda de faixas.
3. **"COMÉRCIO  DE  FRUTAS  BERGAMINI  LTDA."** — verde-escuro, caixa alta itálica,
   espaçamento duplo entre palavras, altura de letra ≈ 13 cm.
4. **"BERGAMINI@BERGAMINIFRUTAS.COM     FONE: 3028-5203  /  3025-1433"** — verde-escuro,
   altura de letra ≈ 9 cm.
5. **"WWW.BERGAMINIFRUTAS.COM     AV. JK  1254 - CEASA - BOX: 307/309/311/313/314 - FOZ DO IGUAÇU-PR."**
   — verde-escuro, altura de letra ≈ 9 cm. É a linha mais densa da arte.
6. **Fio de contorno fino** ao redor de todo o layout — **é a borda do arquivo, não um
   elemento**. Não pintar.

### 4. Paleta
| cor | RGB | % | chapada / degradê |
|---|---|---|---|
| branco (chapa) | — | 62,9% | — |
| verde-escuro | (40,88,56) | 23,5% | **chapada** |
| vermelho | (232,56,56) | 3,7% | **chapada** |

**Duas tintas. Zero degradê. Zero cor de terceiro.** É a arte mais simples da fatia.

### 5. Fronteiras T-T

**ZERO. Nenhuma.**

Medição: o contato direto entre o cluster verde e o cluster vermelho é **nulo** — nem
aparece entre os 18 pares mais frequentes de adjacência da imagem. Verificação por
varredura vertical em `x = 800 px` (centro do logotipo):

```
verde 0–14 | branco 16–31 | verde 32–46 | branco 48–61 | VERMELHO 63–108 |
branco 110–126 | verde 128–142 | branco 143–293
```

Há **14 px de branco acima** do vermelho e **17 px abaixo** — ou seja, **~10 cm e ~12 cm de
chapa** separando o lettering das faixas. O designer deixou o respiro de propósito.

Todas as fronteiras da arte são **T-F**:
- verde ↔ branco (5 faixas × 2 arestas × 11,5 m ≈ **115 m de T-F**, mais as extremidades);
- vermelho ↔ branco (perímetro do lettering ≈ 20 m de T-F);
- verde dos 3 blocos de texto ↔ branco (≈ 45 m de T-F).

**Consequência direta (§6 regra 4): verde e vermelho vão na MESMA SESSÃO.** Não há nada a
proteger entre eles. Nenhuma cura intermediária, nenhuma máscara sobre tinta.

### 6. Ordem de pintura
**Não há ordem obrigatória.** A regra §2 só se aplica a cores que se tocam, e aqui nenhuma
se toca.

Se por algum motivo operacional se quisesse uma ordem (por exemplo, para reaproveitar o
mesmo mascaramento), a regra daria: vermelho (3,7%) antes de verde (23,5%). Mas isso é
otimização de bancada, não obrigação de doutrina.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3/§4) |
|---|---|---|
| **5 faixas horizontais** | **FITA_BRANCA** nas arestas longas + **CORTE_MANUAL** nas 4 terminações do cartucho central e nas 10 extremidades | Substrato = chapa branca e traçado **perfeitamente reto** de 11,5 m. É o caso da fita branca (§4): não faz curva — e não precisa —, é mais larga, e paga corte só nos poucos pontos onde a faixa termina. |
| **"Bergamini"** (33 cm) | **CORTE_MANUAL** | Letras de 33 cm, geométricas, contraformas de ~8 cm (o bojo do "g", o olho do "e", o vão do "B"). Um estilete resolve isso sem esforço. |
| **"COMÉRCIO DE FRUTAS BERGAMINI LTDA."** (13 cm) | **CORTE_MANUAL** | Hastes de ~2,5 cm, itálico. Cortável. |
| **Linha de e-mail/telefone** (9 cm) | **CORTE_MANUAL** — no limiar | Hastes de ~1,7 cm, com `@`, `:` e `/`. O `@` é o glifo mais complexo da arte (espiral de raio ~1,5 cm). Viável, mas é o primeiro candidato a máscara de máquina se o operador achar que rebarba. |
| **Linha de site/endereço** (9 cm) | **CORTE_MANUAL** — no limiar | A sequência `BOX: 307/309/311/313/314` tem 5 barras finas e 15 algarismos em ~90 cm. É a linha mais cara de cortar da arte. **Candidata a MASCARA_MAQUINA_SOBRE_VERNIZ** — mas isso obrigaria um ciclo de verniz inteiro só para uma linha de rodapé, o que provavelmente não compensa. Decidir com o operador. |
| Fio de contorno do arquivo | **não é elemento** | Não pintar. |

### 8. Sequência de sessões e dias
```
D1  preparação: lavar, empapelar perfis, molduras, borrachas, ferragens.
    aplicar fita branca nas 10 arestas longas das 5 faixas.
    aplicar máscara lisa nos campos a preservar; cortar à mão:
        - as 4 terminações das faixas 3 e 4 no cartucho central
        - o lettering "Bergamini"
        - os 3 blocos de texto
    S1 (SESSÃO ÚNICA — verde e vermelho não se tocam):
        verde-escuro (5 faixas + 3 blocos de texto)
        vermelho (lettering "Bergamini")
    cura.
    remoção de fitas e máscaras; verniz.
```

**1 sessão de tinta. 1 dia.** É a arte mais barata da fatia.

Extras: espelhar no lado motorista (textos e o endereço **não** espelham); faixa refletiva
regulamentar na parte baixa, aplicada por último, sobre o verniz.

### 9. Armadilhas para o motor de visão
1. **T-T falso verde↔vermelho.** O respiro é de ~14 px no layout original; em qualquer
   thumbnail de 300 px ele vira sub-pixel e o motor conclui que as faixas encostam no
   lettering. Isso inventaria uma cura + um mascaramento e **dobraria** o cronograma de
   uma arte de 1 dia. É a armadilha mais cara desta arte e a que melhor demonstra por que
   a medição de T-T precisa acontecer **em resolução alta**.
2. **Vãos brancos lidos como faixas brancas pintadas.** Os 4 vãos de 11,5 cm entre as
   faixas verdes têm exatamente a mesma geometria das faixas. Um motor que não teste
   "é-branco? ⇒ chapa" emite 4 faixas de tinta branca de 11,5 m cada.
3. **Faixas interrompidas contadas como elementos separados**: 5 faixas viram 7 segmentos
   viram 7 elementos. Devem ser 5 elementos, 2 deles com 2 ilhas.
4. **Fio de contorno do arquivo** lido como moldura pintada de perímetro 27 m.
5. **Rodapé de 3 linhas** = ~180 glifos. Um segmentador por componente conexa devolve 180
   polígonos; o correto é 3 elementos de texto com N ilhas cada.
6. **Antialiasing verde/branco** produziu 5 clusters intermediários nesta imagem
   ((104,136,120), (184,200,184), (136,168,152), (216,216,216), (72,104,88)) somando 9,3%
   da área — mais que o vermelho inteiro. Um motor que quantize sem colapsar borda
   conclui que a arte tem 8 cores e monta 8 sessões numa arte de 2 tintas.

### 10. Correções à análise antiga
Arte ausente de `analysis_C.md`. Correções aos padrões transversais que a levariam a erro:

- **Transversal #5** ("diagonais/retas = **fita de corte**"): a análise antiga inventa uma
  categoria "fita de corte" que não está na doutrina. A §4 tem só **fita amarela**
  (isoplastic/lona) e **fita branca** (demais substratos). Aqui é fita branca.
- **Transversal #7** ("altura de letra < 6–8 cm ⇒ **vinil**; acima ⇒ máscara+pintura"):
  as linhas de rodapé daqui têm 9 cm e ficariam no limiar. Pela regra antiga iriam para
  "vinil recortado final" — que não existe. Pela doutrina, ou se cortam à mão (recomendado)
  ou se vai para máscara de máquina sobre verniz, e **ambos os caminhos terminam em tinta**.
- **Transversal #8** ("designers deixam respiros brancos... o motor deve detectar o respiro
  (vira T-F) e NÃO emitir ordem de fita+corte"): esta é a **única** afirmação transversal
  da análise antiga que descreve corretamente o que acontece aqui. Mas ela não vem
  acompanhada de nenhum procedimento de medição — e sem medir os 14 px, a regra não
  dispara.
- **Convenção do cabeçalho** ("T-F = branco da chapa não pintado; **só o adesivo de recorte
  protege**"): a formulação sugere que o adesivo é o acabamento do branco. Não é: o adesivo
  é a máscara que preserva a chapa, e sai no fim.
- A análise antiga **não tem categoria para "0 fronteiras T-T"**, e por isso nunca chegaria
  ao achado principal desta arte: **as duas tintas vão juntas, num dia só**.

---

# 8. CIPRIANO.jpg

### 1. Implemento e substrato provável
Baú seco de transportadora — "CIPRIANO CAMINHÕES & TRANSPORTES". Layout 1600×281 px,
proporção **5,69:1**. Assumindo 2,45 m de altura → **~14 m**. Escala **≈ 0,88 cm/px**.
Sem medida no nome do arquivo — **inferência, confirmar**.

O fundo é **laranja em ~80%**. Laranja não é branco ⇒ é tinta ⇒ **pintura geral**.

**Substrato: CHAPA_BRANCA (que será integralmente pintada de laranja).**

Consequência (§4): fita amarela proibida. Não há faixa nesta arte de qualquer modo — o
único traçado longo é o contorno do bloco da bandeira, que é irregular demais para
qualquer fita.

### 2. Fundo
**PINTURA GERAL LARANJA (#F88828), ~80%.**
Lavar, empapelar perfis/borrachas/ferragens, fundo laca em cor próxima, laranja final.

Há **um** branco na arte: o campo claro (#E8E8E8) do canto superior-esquerdo da marca "C",
**1,3% da área**. Esse branco é **chapa preservada**: sua máscara entra **antes** da demão
laranja e só sai no final. Não existe tinta branca neste job.

### 3. Inventário de elementos
1. **Marca "C"** — bloco de ~175 × 175 cm, canto superior-esquerdo do painel. Composição:
   - silhueta de **quadrado com cantos muito arredondados** (raio ~35 cm) em grafite (#383838);
   - dentro dela, a letra **"C"** vazada, formando o contorno interno;
   - um **campo branco (chapa preservada)** ocupando o canto superior-esquerdo do bloco;
   - uma **banda diagonal grafite** cortando o bloco de baixo-esquerda para cima-direita,
     que separa o campo branco do resto e dá o efeito de "para-brisa de caminhão";
   - o vão interno do "C" é **laranja** (fundo aparecendo).
2. **"CIPRIANO"** — grafite, caixa alta geométrica sem serifa, altura de letra ≈ **48 cm**,
   largura ≈ 410 cm.
3. **"CAMINHÕES & TRANSPORTES"** — grafite, caixa alta espaçada, altura de letra ≈ **20 cm**,
   largura ≈ 275 cm.
4. **Bloco Brasil/bandeira** — canto direito, ~270 × 245 cm, **sangrando pela borda direita**
   do layout. Silhueta do **mapa do Brasil** preenchida com uma **fotografia/render da
   bandeira brasileira ondulando ao vento**:
   - campo **verde** com dobras de tecido e sombreamento contínuo;
   - **losango amarelo** deformado pelas dobras, com gradações de sombra;
   - **círculo azul-marinho** com gradiente e reflexo;
   - **faixa branca curva** com "**ORDEM E PROGRESSO**" em verde, letras de ~6 cm, seguindo
     uma curva e com sombreado de dobra;
   - **~27 estrelas brancas** de 5 tamanhos diferentes, de **~2 cm a ~8 cm**;
   - a silhueta do mapa tem o **litoral recortado**, com reentrâncias de 5 a 10 cm.
   O laranja do fundo aparece **dentro** do recorte do mapa (a região a oeste/nordeste
   fora da bandeira? não — o laranja aparece **fora** do mapa, e o mapa cobre a bandeira).

Texto exato: `CIPRIANO` · `CAMINHÕES & TRANSPORTES` · `ORDEM E PROGRESSO`

### 4. Paleta
| cor | RGB | % | chapada / degradê |
|---|---|---|---|
| laranja | (248,136,40) | 79,7% | **chapada** (fundo geral) |
| grafite | (56,56,56) | 5,7% | **chapada** (marca + textos) |
| branco (chapa) | (232,232,232) | 1,3% | — |
| azul-marinho | (8,40,104) | 5,7% | **degradê** (bloco bandeira) |
| verdes | (8,120,56) e derivados | 2,1% | **degradê** (bloco bandeira) |
| amarelos | (248,248,40) / (232,200,8) / (184,168,8) / (152,136,8) | 5,4% | **degradê** (bloco bandeira) |

Fora do bloco da bandeira: **duas tintas chapadas** (laranja e grafite) + chapa preservada.
Dentro do bloco: dezenas de tons em degradê contínuo de tecido.

### 5. Fronteiras T-T

| par | contato aprox | curvatura | cobre mais |
|---|---|---|---|
| **grafite ↔ laranja** (marca "C" + "CIPRIANO" + tagline) | **~4.100 cm (41 m)** | **mista**: retas longas na banda diagonal e nas hastes de I/P/R/N; **média** nos bojos de C/O/P/R/S/G (raio ~8 cm); **fechada** no vão interno do "C" da marca e no `&` da tagline (raio ~2 cm) | **laranja** (79,7% vs 5,7%) |
| **bloco-bandeira ↔ laranja** (silhueta do mapa) | **~900 cm** | **extrema** — o litoral tem reentrâncias de 5–10 cm e ângulos reflexos; não há trecho contínuo com raio > 20 cm | **laranja** |
| verde ↔ amarelo ↔ azul ↔ branco (dentro da bandeira) | ~2.500 cm somados | contínua/degradê de dobra | — (**PENDÊNCIA, bloco único**) |
| grafite ↔ azul-marinho | ~100 cm | — | é **contaminação de quantização** (as sombras profundas da bandeira caem no cluster grafite), não fronteira real |

**Total de T-T dura fora do bloco: ~50 m em 2 pares.**

**NÃO são T-T:**
- **campo branco da marca ↔ grafite**: **T-F** (branco é chapa preservada);
- **campo branco da marca ↔ laranja**: **T-F**;
- **vão interno do "C" (laranja) ↔ grafite**: é o mesmo par grafite↔laranja já contado;
- **grafite dos textos ↔ bloco-bandeira**: **não se tocam** — há ~200 cm de laranja entre
  "CIPRIANO" e a borda do mapa. → grafite e o bloco são independentes entre si.

### 6. Ordem de pintura
```
par grafite ↔ laranja  : grafite (5,7%) < laranja (79,7%)  → GRAFITE PRIMEIRO
par bloco   ↔ laranja  : bloco   (13%)  < laranja (79,7%)  → BLOCO PRIMEIRO (em tese)
par grafite ↔ bloco    : NÃO SE TOCAM                       → mesma sessão, em tese
```

Ressalva prática: o bloco da bandeira é **pendência**. Se a decisão for aerografia, ela
precisa de uma superfície pronta e de tempo de secagem próprio, e é mais seguro fazê-la
**depois** do laranja, dentro de uma máscara já cortada — pagando o custo de mascarar o
laranja num recorte de 270 × 245 cm. Se a decisão for pintura artística à mão, o mesmo.

Ou seja: a regra §2 diz "bloco antes do laranja", mas a natureza do bloco (executado à mão,
com tempo longo e risco de retrabalho) recomenda inverter deliberadamente esse par
específico e **isolá-lo** atrás de uma máscara. **Sinalizar ao dono** — é uma exceção
consciente à §2, não um esquecimento.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3) |
|---|---|---|
| **Campo branco da marca "C"** | **CORTE_MANUAL** da máscara de preservação, aplicada antes de tudo | Forma grande (~70 × 70 cm) com um lado reto (a diagonal) e um canto arredondado de raio 35 cm. |
| **Silhueta + banda diagonal + "C" da marca** | **CORTE_MANUAL** | Bloco de 175 cm; o detalhe mais fechado é o vão do "C" (raio ~2 cm). Cortável. |
| **"CIPRIANO"** (48 cm) | **CORTE_MANUAL** | Letras enormes, geometria limpa, contraformas de ~10 cm. |
| **"CAMINHÕES & TRANSPORTES"** (20 cm) | **CORTE_MANUAL** | Hastes de ~3 cm; o `&` e o til do "Õ" são os pontos mais finos (~1,5 cm). Cortável. |
| **Laranja** | pintura geral | 80% da área. |
| **Bloco Brasil/bandeira** | **PENDÊNCIA — decisão do dono** | Fotografia de tecido ondulante: sombreamento contínuo em três cores, ~27 estrelas de 2–8 cm, e o texto "ORDEM E PROGRESSO" de 6 cm **curvado e sombreado**. Não é adesivo impresso. Restam **aerografia** ou **pintura artística à mão**. |
| ↳ contorno do mapa (dentro da pendência) | **CORTE_MANUAL** viável | O litoral é irregular mas as reentrâncias são de 5–10 cm — grande o bastante para estilete. É o **interior** que é impossível de mascarar, não o contorno. |
| ↳ estrelas de 2 cm e "ORDEM E PROGRESSO" de 6 cm | **MASCARA_MAQUINA_SOBRE_VERNIZ** como apoio | Se a decisão for aerografia, as estrelas menores (2 cm) e o micro-texto curvo provavelmente precisam de máscara de máquina como acabamento — nem aerógrafo nem pincel resolvem 27 estrelas de 2 cm com bordas limpas. |

### 8. Sequência de sessões e dias
```
D1  preparação: lavar, empapelar perfis, borrachas, ferragens.
    máscara de preservação do campo branco da marca.
    máscara + corte manual da marca "C", de "CIPRIANO" e da tagline.
    S1: GRAFITE (5,7% — menor cobertura, vem primeiro por §2)
    cura.
D2  mascara todo o grafite.
    S2: LARANJA geral (79,7%) — fundo próximo + laranja final.
    cura.
D3  remoção de máscaras; verniz nas áreas concluídas.
    máscara do recorte do mapa do Brasil (corte manual do litoral).
D3+ PENDÊNCIA: execução do bloco-bandeira dentro da máscara
        (aerografia OU pintura artística à mão — decisão do dono).
    se aerografia: máscara de máquina sobre verniz para as 27 estrelas
        e para "ORDEM E PROGRESSO".
    verniz final geral.
```

**2 dias para tudo, exceto o bloco.** O bloco sozinho vale entre **meio dia (aerografia
solta, aceitando simplificação das dobras)** e **2–3 dias (pintura artística fiel)**.
Esta é a maior incerteza de orçamento da fatia inteira — **não orçar sem a decisão**.

Extras: espelhar no lado motorista (o mapa vai para o outro canto; **textos não espelham**);
faixa refletiva na parte baixa; a bandeira sangra pela borda — validar onde ela termina no
implemento real (traseira? nada?).

### 9. Armadilhas para o motor de visão
1. **A bandeira ondulante é o pior caso possível**: milhares de tons em degradê de tecido.
   Um segmentador devolve centenas de polígonos e um estimador ingênuo monta **dezenas de
   sessões de pintura**. Tem que ser detectado como **um bloco de alta entropia** e
   marcado `PENDÊNCIA` — **não** como "imprimir".
2. **"ORDEM E PROGRESSO"** (6 cm, curvado, sobre faixa sombreada) e as **estrelas de 2 cm**
   somem em qualquer downscale. E são justamente os elementos que decidem se o bloco
   precisa de máscara de máquina.
3. **Campo branco da marca é #E8E8E8**, não branco puro. Um teste rígido falha e o motor
   emite tinta branca sobre laranja — violação da doutrina e uma sessão inventada.
4. **Anel de antialiasing laranja/grafite**: a quantização criou um cluster (152,136,8) com
   ~1,7% da área que é **só borda** e concentra os maiores contatos medidos. Se promovido a
   cor real, vira uma quarta tinta.
5. **Grafite (#383838) e azul-marinho profundo da bandeira (#082868)** podem cair no mesmo
   cluster, fazendo o motor achar que "CIPRIANO" e o círculo da bandeira são a mesma cor —
   e portanto que **se tocam** (eles estão a 2 m de distância).
6. **A silhueta sangra pela borda direita** do layout: o polígono não fecha, e um detector
   de contorno pode descartar o maior elemento da arte.
7. **Laranja com variação de compressão JPEG** gera pseudo-degradês no fundo. É pintura
   geral chapada — colapsar.
8. **Elemento de terceiro / símbolo nacional**: a bandeira brasileira tem regras de
   representação. Vale um flag de revisão humana, mas por motivo jurídico, não técnico.

### 10. Correções à análise antiga
Arte ausente de `analysis_C.md`. Correções aos padrões transversais que a levariam
diretamente ao erro mais grave da análise antiga:

- **Transversal #3** ("QR codes, logos de terceiros, logos glossy e **FOTOS nunca se
  pintam** → detectar blocos de alta entropia, **rotular 'impressão digital'**, tratar como
  contorno único e **retirar da análise de fronteiras**"): esta regra, aplicada a esta arte,
  produziria "bandeira = adesivo impresso recortado no contorno". **É exatamente a premissa
  que a doutrina §0 derruba.** A detecção de bloco de alta entropia está certa; o rótulo
  está errado. O rótulo correto é **PENDÊNCIA: aerografia ou pintura artística à mão**.
- **Transversal #4** ("degradê de ELEMENTO → reproduzir via **impressão**/aerografia"):
  remover "impressão". Sobra aerografia ou pintura à mão.
- **Transversal #2** (classificador "% da cor dominante + limiar 80% + é-branco?"): funciona
  aqui (laranja 79,7% ≈ limiar ⇒ pintura geral), mas por pouco. Vale notar que o limiar de
  80% é arbitrário: o que decide pintura geral não é o percentual, é **a cor dominante não
  ser branco**. Com 60% de laranja o resultado seria o mesmo.
- **Transversal #7** ("altura de letra < 6–8 cm ⇒ vinil"): "ORDEM E PROGRESSO" tem 6 cm e
  cairia nessa regra ⇒ vinil impresso ⇒ erro. O caminho correto é máscara de máquina sobre
  verniz, dentro da pendência do bloco.
- **Transversal #9** ("parsear o filename é a etapa 0"): correto, mas este arquivo não tem
  nem comprimento nem vista no nome. O motor precisa degradar com elegância para inferência
  por proporção — e **marcar a inferência**, não fingir que sabe.
- **Convenção do cabeçalho** ("T-T exige fita+corte OU cura ~3h + **adesivo por cima**"):
  na doutrina, a alternativa ao corte manual não é "adesivo por cima", é **máscara de
  máquina sobre verniz** (§3.2) — que custa uma máquina de corte, um ciclo de verniz e a
  espera. Chamar isso de "adesivo" apaga o custo real.

---

# Síntese da fatia

## Contagem
- **8 artes** analisadas (5 laterais, 3 traseiras; 4 jobs: ACM, BAHIA SUL, ASTUTILOG, e 2 avulsas).
- **~50 tipos de par T-T**, **~270 m lineares** de fronteira tinta-tinta.
- **2 artes com ZERO fronteira T-T dura** (BERGAMINI, BAHIA SUL traseira) → 1 sessão, 1 dia cada.
- **2 artes com pintura geral** (ASTUTILOG traseira vermelha 87%, CIPRIANO laranja 80%).
- **1 arte com pintura geral sobre lona** (ASTUTILOG lateral, preto 62% sobre lona **branca**).
- **3 blocos em PENDÊNCIA** (globo Astutilog ×2, bandeira Cipriano) — nenhum é adesivo.
- **3 elementos em MASCARA_MAQUINA_SOBRE_VERNIZ** (script "Desde 2003", selo SASSMAQ,
  estrelas+"ORDEM E PROGRESSO"). Todo o resto é **CORTE_MANUAL**.
- **1 uso legítimo de FITA_AMARELA** (swoosh Astutilog — único substrato de lona da fatia).
- **1 uso legítimo de FITA_BRANCA** (faixas Bergamini — chapa, retas de 11,5 m).
- **1 uso legítimo de ESPOVO_DIRETO** (onda Bahia Sul — 14 m, curva única, formato fácil).

## O que esta fatia ensina ao motor
1. **A medição de T-T decide o cronograma inteiro.** Bergamini (0 T-T) é 1 dia; ACM
   (16 pares, 130 m) é 5. As duas têm o mesmo tamanho de painel e a mesma quantidade
   aparente de "arte".
2. **O respiro branco é a informação mais frágil e mais valiosa do layout.** 14 px em
   Bergamini, 4 px no fio do mamão da Bahia Sul, poucos px entre "ASTUTI" e "LOG".
   Perder qualquer um deles inventa uma sessão. Medir T-T em thumbnail é inútil.
3. **"Branco = chapa preservada" inverte a ordem de produção**, não só o custo do material.
   Máscara de branco entra **antes** da primeira demão; a análise antiga a colocava depois.
4. **Número de cores ≠ dificuldade de corte.** ACM tem 7 cores de geometria trivial
   (retas de 43 cm) e é a arte mais cara da fatia. Astutilog tem 3 cores e um bloco
   impossível. São eixos independentes: `n_cores` dirige as **sessões**, `cortavel_a_mao`
   dirige a **técnica**.
5. **A escolha de fita é do substrato, não da curvatura.** A mesma curva suave é
   fita amarela num sider e espovo+corte manual numa chapa branca. E **as duas faces do
   mesmo veículo podem ter substratos diferentes** (Astutilog: lona na lateral, chapa na
   traseira).
6. **Alta entropia ⇒ PENDÊNCIA, nunca impressão.** O detector de bloco fotográfico continua
   sendo útil; só o rótulo de saída muda. E a pendência precisa aparecer no orçamento como
   faixa (meio dia a 3 dias), não como número.
