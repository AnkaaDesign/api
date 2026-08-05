# Slice 4 (v2) — AAN, BALALAC/Trans Salto, Argus, BIAVA, Cavalcante

Refeito contra `api/PAINTING_PRODUCTION_DOCTRINE.md` (ago/2026). A doutrina tem
precedência sobre `layout database/analysis/analysis_A..F.md`.

**Premissas desta revisão** (as antigas violavam todas):

- Adesivo é **máscara**, nunca produto final. Não existe "adesivo impresso
  aplicado por cima" em nenhuma arte deste lote.
- **Branco não é tinta.** Todo branco é chapa preservada por máscara — inclusive
  quando o branco aparece *dentro* de uma massa pintada (keyline, letra vazada).
- A única etapa de máquina é o **corte do formato da máscara**.
- Bloco fotográfico/metálico → **PENDÊNCIA** (aerografia × pintura artística à
  mão), decisão do dono. Nunca "impressão digital".

**Escalas assumidas** (o raster é 1600 px de largura em todas as laterais; as
medidas em cm derivam daí e devem ser reconferidas com a ficha do implemento):

| arte | px | implemento assumido | cm/px |
|---|---|---|---|
| AAN lateral | 1600×543 | baú truck 7,60 × 2,58 m | 0,475 |
| AAN traseira | 1600×1471 | portas 2,55 × 2,34 m | 0,159 |
| BALALAC lateral | 1600×287 | carreta baú 14,20 × 2,55 m | 0,888 |
| BALALAC traseira | 1524×1600 | portas 2,55 × 2,68 m | 0,167 |
| argus lateral | 1600×287 | carreta baú **14,70** × 2,64 m (nome do arquivo) | 0,919 |
| argus traseira | 1524×1600 | portas 2,55 × 2,68 m | 0,167 |
| BIAVA | 1600×283 | carreta baú 14,40 × 2,55 m | 0,900 |
| CAVALCANTE (jamaica) | 1600×270 | carroceria jamaica 8,50 × 1,43 m | 0,531 |

---

## Tabela-resumo

| arte | substrato | fundo | nº fronteiras T-T | estratégia dominante | complexidade |
|---|---|---|---|---|---|
| AAN lateral | CHAPA_BRANCA | chapa original, sem pintura geral (~82% branco) | **4** (todas dentro do ícone-estrada) | CORTE_MANUAL + FITA_BRANCA nas ondas | média-baixa |
| AAN traseira | CHAPA_BRANCA | chapa original (~88% branco) | **4** (mesmo ícone, 3× menor) | CORTE_MANUAL; WhatsApp = máscara de máquina | média |
| BALALAC 2024 lateral | CHAPA_BRANCA | chapa original (~93% branco) | **0** | CORTE_MANUAL — 1 sessão só | baixa |
| BALALAC 2024 traseira | CHAPA_BRANCA | chapa original (~88% branco) | **0** (keyline branca de ~1 cm) | CORTE_MANUAL | baixa-média |
| argus 14,70 lateral | ISOPLASTIC (frigorífico) | chapa original (~62% branco) | **2** (só dentro do badge) | FITA_AMARELA nas ondas + PENDÊNCIA no badge | média (alta se o badge for aerografado) |
| argus 14,70 traseira | ISOPLASTIC | chapa original (~93% branco) | **2** (só dentro do badge) | PENDÊNCIA no badge; resto quase nulo | baixa (alta só no badge) |
| BIAVA | CHAPA_BRANCA → pintura geral preta | **pintura geral preta ~92%** | **2** | CORTE_MANUAL do logo + preto por cima (§2 literal) | média |
| CAVALCANTE (jamaica) | OUTRO (chapa de carroceria) → pintura geral azul | **pintura geral azul ~100%** | **4** | CORTE_MANUAL + ESPOVO_SOBRE_MASCARA no padrão | **alta** |

**Total do slice: 8 artes, 18 fronteiras T-T.**

---

## 1. AAN lateral

### 1. Implemento e substrato provável
Lateral de baú de carga seca, proporção **2,95:1** — perfil de truck/bitruck
(~7,6 m × 2,58 m), não de carreta. Nada na arte sugere refrigerado (sem
aparelho de frio, sem testeira, transportadora genérica). Substrato:
**CHAPA_BRANCA** (chapa metálica/pintada de fábrica em branco).

Consequência para fita (doutrina §4): chapa branca **não** é isoplastic nem
lona → a fita amarela flexível **não está liberada**. As ondas duplas em S
teriam de sair em **FITA_BRANCA (com corte)** ou em máscara cortada à mão.
Este é o ponto onde a análise antiga errou mais caro (ver §10).

### 2. Fundo
**Chapa branca original, sem pintura geral.** O cinza-claríssimo do arquivo
(~#E7E8E8) é renderização de mockup, não tinta. Branco/chapa ocupa ~82% da
área. Nenhuma tinta de fundo entra no orçamento.

### 3. Inventário de elementos
1. **Ícone-estrada AAN** (sup-esq, ~132 × 98 cm): seta preta apontando para
   baixo-esquerda; fita de asfalto em **S** cinza-escuro com contorno fino;
   **linha central tracejada amarelo-ouro** correndo dentro do asfalto; seta
   bordô apontando para cima-direita, sobreposta ao asfalto.
2. **"AAN"** — caixa alta, preto, ~73 cm de altura de letra.
3. **"Transportes"** — bordô, bold, ~24 cm.
4. **Dois filetes finos** sob o bloco do logo (~195 cm de comprimento, ~1 cm de
   espessura cada): filete bordô em cima, filete preto embaixo, com vão de
   chapa entre eles.
5. **Onda dupla em S** atravessando toda a lateral: banda cinza-chumbo (cima) e
   banda bordô (baixo), ~4 cm de largura cada, ~800 cm de percurso,
   **separadas por um vão de chapa de ~3 cm** (confirmado em zoom 5×).
6. **"Transportando hoje o seu amanhã"** — preto, bold, ~15 cm.
7. **Logo AL TRANSPORTES** (inf-dir, ~200 × 110 cm): "AL" cinza-médio com
   degradê vertical sutil; swoosh elíptico bordô→vermelho (degradê) passando
   por trás do "A", **com keyline branca contínua** entre swoosh e letra;
   "TRANSPORTES" cinza-escuro; dois filetes (cinza + bordô) separados por
   chapa.

### 4. Paleta
- **preto** — chapado
- **cinza-chumbo / cinza-asfalto** — chapado (dois cinzas muito próximos:
  o da onda e o do asfalto do ícone; ΔE baixo, risco de fusão)
- **bordô** — chapado
- **amarelo-ouro** (tracejado da estrada) — chapado
- **cinza-médio do "AL"** — degradê vertical sutil → **achatar para chapado**
  (amplitude baixa, não justifica aerografia)
- **swoosh AL bordô→vermelho** — degradê direcional real, ~110 cm de extensão →
  **PENDÊNCIA leve**: achatar para bordô chapado (recomendado) ou aerografia
  dentro da máscara. Não é caso de impressão.
- branco = chapa, nunca tinta.

### 5. Fronteiras T-T
Todas as fronteiras T-T desta arte estão **dentro do ícone-estrada**. Todo o
resto encosta em chapa branca (T-F).

| # | par (ambas não-brancas) | extensão ≈ | curvatura | cobre mais área |
|---|---|---|---|---|
| T-T 1 | **preto (seta) × cinza-asfalto** | ~80 cm | suave a média (raio 10–25 cm) | cinza-asfalto |
| T-T 2 | **cinza-asfalto × amarelo (tracejado)** | ~225 cm (dois lados do filete, ao longo de todo o S) | média (raio 12–25 cm), filete de ~3 cm de largura | cinza-asfalto |
| T-T 3 | **bordô (seta) × cinza-asfalto** | ~170 cm | reta (arestas da seta) cruzando borda suave do asfalto | cinza-asfalto (por pouco) |
| T-T 4 | **amarelo × bordô** | ~12 cm (2 trechos de ~6 cm onde a seta cruza o tracejado) | reta | bordô |

**Pares que NÃO se tocam** (podem ir na mesma sessão):
- **cinza-chumbo da onda × bordô da onda** — separadas por vão de chapa de ~3 cm
  em toda a extensão (~8 m). Verificado em zoom nas duas pontas. **Esta é a
  maior economia de cronograma da arte.**
- preto (seta) × bordô (seta) — o asfalto está entre elas.
- "AAN" preto × ícone — vão de ~15 cm.
- filete bordô × filete preto (sob o logo) — vão de chapa.
- "AL" cinza × swoosh bordô — keyline branca contínua (~1,5 cm).
- ondas × qualquer texto — não se tocam.

### 6. Ordem de pintura
Aplicando §2 (menor cobertura primeiro, mascarar, maior por cima), só dentro do
ícone:

1. **amarelo** primeiro — é a menor área de todas (filete tracejado) e perde
   tanto para o bordô (T-T 4) quanto para o cinza (T-T 2). Mascarar só o
   tracejado: ~2 dm² de máscara.
2. **preto (seta)** e **bordô (seta)** — não se tocam entre si, mesma sessão.
   Ambos perdem para o cinza-asfalto (T-T 1 e T-T 3). Mascarar as duas setas.
3. **cinza-asfalto** por último no ícone — é o maior dos pares em T-T 1, 2 e 3.

Fora do ícone não há ordem imposta: tudo encosta só em chapa.
O preto do "AAN"/slogan e o bordô do "Transportes" podem ser batidos **junto**
com as setas (mesma tinta, mesma sessão), e o cinza da onda junto com o
cinza-asfalto — desde que se aceite bater duas vezes o mesmo cinza, o que não é
necessário aqui porque nada obriga a separá-los.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa (§3: "um humano corta isso com estilete?") |
|---|---|---|
| "AAN" (73 cm) | **CORTE_MANUAL** | letras enormes, retas e diagonais; corte trivial sobre a laca curada |
| "Transportes" (24 cm) | **CORTE_MANUAL** | bold sem serifa, contra-formas de ~4 cm — cortável |
| slogan (15 cm) | **CORTE_MANUAL** | ainda acima do limiar de fadiga; 33 caracteres, mas todos abertos |
| seta preta / seta bordô | **CORTE_MANUAL** | polígonos retos de ~40 cm |
| asfalto cinza em S | **CORTE_MANUAL** | curva suave contínua de ~1 m, sem detalhe interno |
| tracejado amarelo | **CORTE_MANUAL** | traços de ~3 × 12 cm, retos; ~8 traços |
| filetes sob o logo (1 cm × 195 cm) | **FITA_BRANCA** | traçado **reto**, longo — caso explícito da tabela §4; a fita branca é mais larga e exige corte nas pontas, o que aqui é trivial |
| onda dupla em S (2 × ~800 cm) | **FITA_BRANCA + corte** | substrato = chapa, logo a fita amarela flexível **não se aplica** (§4). A fita branca não faz curva: é preciso segmentá-la em trechos curtos e cortar. **Alternativa a avaliar com o dono: máscara lisa em faixa larga + corte manual da curva** — em 8 m de S de raio grande, o corte à mão é competitivo e evita a emenda de fita a cada trecho |
| logo AL — letras "AL" | **CORTE_MANUAL** | letras de ~60 cm |
| logo AL — swoosh + keyline branca | **CORTE_MANUAL** | duas curvas paralelas com ~1,5 cm entre elas; ponte estreita, mas o comprimento é curto (~110 cm) e o raio é grande |
| logo AL — "TRANSPORTES" (~9 cm) | **CORTE_MANUAL**, no limite | letras de 9 cm ainda são cortáveis; abaixo de ~6 cm passar para máscara de máquina |

Nenhum elemento desta arte justifica máquina de corte + ciclo de verniz.

### 8. Sequência de sessões e dias
- **Preparação**: lavar, empapelar frisos/perfis, borrachas, ferragens.
- **Sem pintura geral** (chapa branca).
- **Sessão 1** — aplicar máscara lisa nas regiões do logo, do slogan e das
  ondas; cortar tudo à mão; pintar **amarelo** (tracejado). Cura curta.
- **Sessão 2** — mascarar o tracejado; pintar **preto** (seta + "AAN" + slogan
  + filete preto) e **bordô** (seta + "Transportes" + filete bordô + banda
  bordô da onda + swoosh AL) — preto e bordô **não se tocam em lugar nenhum**,
  vão juntos (§6 regra 4). Cura.
- **Sessão 3** — mascarar as duas setas; pintar **cinza** (asfalto do ícone +
  banda cinza da onda + "TRANSPORTES" do AL + filete cinza). O cinza da onda
  não toca o bordô da onda, então entra aqui sem custo extra.
- **Verniz final.**

**1,5 a 2 dias por lado**, dominado pela aplicação e corte da onda de 8 m — não
pela quantidade de cores. Os dois lados devem entrar no mesmo ciclo de curas
(espelha-se a composição, nunca o texto).

### 9. Armadilhas para o motor de visão
- **Fundo cinza-claríssimo (#E7E8E8)**: o limiar "é branco?" decide o plano
  inteiro. Aqui é chapa. Um limiar ingênuo classifica como pintura geral e
  transforma 4 fronteiras T-T em ~20.
- **Vão de ~3 cm entre as duas bandas da onda**: a 1600 px isso são 6 px. Em
  thumbnail as bandas se fundem em uma só região e o motor reporta uma
  fronteira T-T de 8 m que **não existe** — o erro mais caro possível nesta
  arte.
- **Keyline branca do logo AL (~1,5 cm = 3 px)**: mesma armadilha, escala menor.
- **Dois cinzas de ΔE baixo** (asfalto do ícone × chumbo da onda × cinza do
  "AL"): podem ser a mesma tinta ou três tintas; reportar como alerta, não
  decidir sozinho.
- **Degradê do swoosh AL**: alta amplitude em área pequena → é degradê de
  elemento, não de mockup; mas a área é pequena demais para justificar
  aerografia.
- Contorno fino do asfalto (linha escura de ~1 px) vira ruído ou vira uma
  quarta cor.

### 10. Correções à análise antiga (analysis_A.md, item 11)
| a antiga diz | correção |
|---|---|
| "Ícone estrada (4 cores + filete fino + sombras) e swoosh AL: **impressos** se <60 cm" | **ERRADO por doutrina.** Adesivo é máscara, nunca produto. O ícone tem 1,3 m e é composto de polígonos retos + um S de raio grande: é **CORTE_MANUAL** direto. |
| "setas×estrada e filete×asfalto = T-T média/fina → **impresso**" | as fronteiras existem (T-T 1, 2, 3) mas se resolvem com máscara cortada à mão e ordem menor→maior. Nada é impresso. |
| "swoosh×AL = T-T fechada → impresso/aero" | **não é T-T**: há keyline **branca** (chapa) entre o swoosh e a letra. É T-F dos dois lados. |
| "Faixas S: **fita amarela flexível** (caso de manual)" | **ERRADO**: §4 libera fita amarela só em **isoplastic ou lona**. Aqui o substrato é chapa → **fita branca (com corte)** ou máscara cortada à mão. A antiga transformou o item mais caro da arte no mais barato. |
| "as duas faixas têm vão branco entre si → cada uma é T-F" | **CORRETO** — único ponto da análise antiga que se sustenta, e é o mais importante. |
| "D1 + D2 = 2 dias" | ordem de grandeza aceitável, mas pelas razões erradas (contava aplicação de impresso em vez de corte de máscara). |

---

## 2. AAN traseira

### 1. Implemento e substrato provável
Traseira de baú, portas duplas (2,55 × 2,34 m), quase quadrada. Ferragens
(dobradiças, varões, fechos) não desenhadas no arquivo. Substrato
**CHAPA_BRANCA**, igual à lateral → **fita amarela vetada** (§4).

### 2. Fundo
**Chapa branca original**, ~88% da área. Sem pintura geral.

### 3. Inventário de elementos
1. **Logo AAN** (sup-esq, ~94 cm de largura): mesmo ícone-estrada da lateral,
   reduzido ~3,4× (ícone com ~29 cm), + "AAN" (~14 cm) + "Transportes" (~5 cm)
   + dois filetes.
2. **Logo AL TRANSPORTES** (sup-dir, ~59 cm de largura): "AL" cinza, swoosh
   bordô com keyline branca, "TRANSPORTES" (~2,5 cm), filetes.
3. **"www.aantransportes.com.br"** — preto, altura de letra ~4,5 cm.
4. **"www.altransportes.com"** — preto, ~4,5 cm.
5. **Ícone WhatsApp** ×2 — disco verde de ~8,7 cm de diâmetro com o balão e o
   fone **vazados** (chapa).
6. **"(41) 99561-6764"** e **"(41) 99854-0249"** — preto, ~6 cm.
7. **Onda dupla em S** na base (cinza-chumbo + bordô), ~2,55 m de percurso, vão
   de chapa entre as bandas.

### 4. Paleta
preto, cinza-chumbo, bordô, cinza-médio do "AL", **verde WhatsApp**; todas
chapadas. Degradê radial do ícone WhatsApp e degradê do swoosh AL → achatar
(elementos de 9 e 20 cm não comportam aerografia).

### 5. Fronteiras T-T

| # | par | extensão ≈ | curvatura | cobre mais |
|---|---|---|---|---|
| T-T 1 | preto (seta) × cinza-asfalto | ~24 cm | suave/média (raio 3–7 cm) | cinza-asfalto |
| T-T 2 | cinza-asfalto × amarelo (tracejado) | ~66 cm | média (raio 4–7 cm), filete de ~0,9 cm | cinza-asfalto |
| T-T 3 | bordô (seta) × cinza-asfalto | ~50 cm | reta | cinza-asfalto |
| T-T 4 | amarelo × bordô | ~4 cm | reta | bordô |

**Não se tocam:** verde do WhatsApp × preto do telefone (vão de ~0,8 cm —
**muito apertado**, sinalizar: a ponte de máscara de 8 mm é frágil e pode
rasgar na depilação); banda cinza × banda bordô da onda (vão de chapa);
"AL" × swoosh (keyline branca); os dois logos entre si; textos entre si.

### 6. Ordem de pintura
Idêntica à lateral, em escala 3,4× menor: **amarelo → (preto + bordô, mesma
sessão) → cinza**. O verde do WhatsApp não toca nada: entra em qualquer
sessão, de preferência a última para não sujar as máscaras.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| "AAN" (14 cm), "Transportes" (5 cm) | **CORTE_MANUAL** | acima do limiar |
| ícone-estrada de 29 cm | **CORTE_MANUAL**, no limite | o tracejado amarelo passa a ter ~0,9 cm de largura; cortável, mas é o elemento mais delicado da face. Se a peça vier com relevo/rebite na região, migrar para máscara de máquina |
| URLs (~4,5 cm) e telefones (~6 cm) | **MASCARA_MAQUINA_SOBRE_VERNIZ** | 25 caracteres com contra-formas de ~1 cm em cada URL — está abaixo do que se corta à mão com qualidade. **Observação para o motor: aqui não há tinta embaixo (é chapa), então a máscara de máquina vai direto sobre a laca/chapa e o ciclo de verniz do §3.2 NÃO se aplica.** O enum precisa de um valor `MASCARA_MAQUINA_SOBRE_CHAPA` |
| ícone WhatsApp (8,7 cm, fone vazado) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (idem: sobre chapa, sem verniz) | o fone vazado tem ~3 cm com raios de ~4 mm; não é corte de estilete in situ |
| logo AL (59 cm) | **CORTE_MANUAL**, exceto "TRANSPORTES" (2,5 cm) → máscara de máquina | |
| onda na base (2,55 m) | **FITA_BRANCA + corte** ou máscara cortada à mão | substrato chapa; ver §4 |
| filetes | **FITA_BRANCA** | retos |

### 8. Sequência de sessões e dias
Entra **no mesmo ciclo de curas da lateral** — mesmas tintas batidas no mesmo
dia. Sessão 1 amarelo; sessão 2 preto+bordô; sessão 3 cinza; sessão 4 (ou
junto da 3) verde. Verniz final.
**+0,5 dia** sobre o cronograma da lateral, não um cronograma próprio.

Atenção física: o vão central das portas passa entre os dois blocos de logo
(bom); mas **cada URL e cada telefone deve ser checado contra dobradiça, varão
e fecho** — máscara sobre ferragem não veda.

### 9. Armadilhas para o motor de visão
- Mesma armadilha do fundo #E7E8E8 (chapa × pintura geral).
- **Fone branco dentro do disco verde**: o branco aqui é chapa, não tinta; um
  motor que trate "branco = cor" cria uma fronteira T-T inexistente.
- Vão de 8 mm entre o disco verde e o "(41)": provavelmente some na
  segmentação e funde os dois elementos.
- Onda da base × **faixa refletiva regulamentar**: não são a mesma coisa; o
  motor não deve orçar a refletiva como elemento pintado.
- Arquivo não mostra dobradiças/varões — o planejador precisa da foto real.

### 10. Correções à análise antiga (analysis_A.md, item 12)
| a antiga diz | correção |
|---|---|
| "**ícones WhatsApp impressos**" | **ERRADO — citado nominalmente na tabela de erros da doutrina (§0).** O ícone é **pintado**: um verde chapado com o fone preservado em chapa; o adesivo é só a máscara. |
| "WhatsApp (~15–20 cm, degradê) → impresso" | o degradê radial é decorativo e some a 3 m de distância: achatar para um verde. O tamanho real é ~8,7 cm, não 15–20. |
| "Logos como na lateral (**ícones impressos**, letras recorte)" | nada é impresso; o ícone AAN de 29 cm é corte manual (no limite) e o AL é corte manual. |
| "Dominante T-F; T-T só interno aos ícones (**resolvido por impressão**)" | a topologia está certa (T-T só dentro do ícone-estrada), a solução está errada: resolve-se por ordem amarelo→setas→asfalto. |
| "faixas S por fita flexível" | fita amarela é vetada em chapa (§4). |

---

## 3. BALALAC 2024 lateral

### 1. Implemento e substrato provável
Lateral de **carreta baú**, proporção **5,57:1** (~14,2 m × 2,55 m). Cliente é
distribuidora de produtos alimentícios — pode ser carga seca **ou** refrigerado.
O arquivo não mostra testeira nem aparelho de frio. Assumo **CHAPA_BRANCA**;
**confirmar**, porque se for isoplastic a fita amarela se libera (§4) — mas
nesta arte **não há nenhuma faixa**, então a diferença de substrato só afeta a
necessidade de lixar as janelas da máscara, não a técnica.

### 2. Fundo
**Chapa branca original, sem pintura geral.** ~93% da área é chapa. O
cinza-gelo do arquivo é mockup. Confirmação barata e obrigatória: um cinza-gelo
real transformaria 0 fronteiras T-T em ~5 e somaria 2 dias.

### 3. Inventário de elementos
1. **"Balaläc"** — script pesado azul-marinho, altura de letra ~115 cm,
   largura ~460 cm; quatro pontos soltos acima (trema sobre o "a" e sobre o
   "c" — grafia da marca, **não é sujeira do arquivo**).
2. **Duas elipses/swooshes** azul-marinho de traço fino (~3,5 cm de espessura),
   ~620 cm de desenvolvimento, envolvendo o nome. Cruzam o "B" e a cauda do
   script — **mesma cor**, fundem-se com o lettering.
3. **"Distribuidora de Produtos Alimentícios"** — cinza-médio, ~12 cm de altura
   de letra, ~400 cm de largura.
4. **"(14) 3378-2124"** — azul-marinho, ~16 cm, canto inferior esquerdo.
5. **Logo Trans Salto** (sup-dir, ~222 × 120 cm): pantera azul-marinho + script
   "Trans Salto" azul-marinho **com keyline branca** sobre swoosh
   **vermelho-coral**.

### 4. Paleta
- **azul-marinho** — chapado
- **cinza-médio** (subtítulo) — chapado
- **vermelho-coral** (swoosh Trans Salto) — chapado
- branco = chapa (keyline do "Trans Salto", olho e presas da pantera)

**Zero degradê em toda a arte.** É a arte mais "amiga da laca" do slice.

### 5. Fronteiras T-T
**NENHUMA.** Verificado em zoom 3,5× e 5×:

- azul-marinho × vermelho-coral: **não se tocam** — a keyline branca do script
  "Trans Salto" (~2 cm no tamanho real) separa as duas cores em todo o
  cruzamento; a pantera está inteiramente acima do swoosh.
- azul-marinho × cinza-médio: **não se tocam** — há ~8 cm de chapa entre a
  base do script e o topo do subtítulo (o subtítulo foi posicionado
  deliberadamente na "sombra" da cauda do "l").
- as elipses finas × o script: **mesma cor** (azul-marinho) — encostam e se
  fundem, o que não é fronteira, é uma única região de tinta.
- todo o resto encosta só em chapa → **T-F**.

**Consequência direta (§6 regra 4): as três cores da arte vão na MESMA sessão.**

### 6. Ordem de pintura
Não há ordem imposta — §2 só se aplica a cores que se tocam, e aqui nenhuma se
toca. Ordem por conveniência de bico/limpeza: azul-marinho (maior volume) →
vermelho → cinza, tudo na mesma sessão, sem cura intermediária.

Única disciplina real: a keyline branca do "Trans Salto" precisa que as duas
máscaras (a do azul e a do vermelho) sejam cortadas **do mesmo desenho**, com o
azul recuado ~2 cm em relação ao vermelho — ou o vermelho invade a chapa.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| "Balaläc" (115 cm) | **CORTE_MANUAL** | script gigante, traço de 15–20 cm, contra-formas de 8 cm. Corte trivial |
| pontos do trema (~10 cm de diâmetro) | **CORTE_MANUAL** | círculos de 10 cm |
| elipses finas (3,5 cm × 620 cm) | **CORTE_MANUAL** | espessura variável (afinam nas pontas) → **fita não serve** (a fita tem largura constante). Duas linhas paralelas cortadas à mão sobre a máscara: é trabalhoso mas humanamente cortável |
| subtítulo (12 cm) | **CORTE_MANUAL** | 36 caracteres, mas com 12 cm de altura as contra-formas têm ~2 cm |
| telefone (16 cm) | **CORTE_MANUAL** | |
| pantera Trans Salto (~50 cm) | **CORTE_MANUAL** | silhueta orgânica de raio grande; olho e presas são vazados de ~2–4 cm — no limite, mas cortáveis |
| script "Trans Salto" + keyline (~35 cm) | **CORTE_MANUAL** | letras cursivas de 35 cm; a keyline de 2 cm é a única exigência de precisão |
| swoosh vermelho | **CORTE_MANUAL** | lente/folha alongada, raio grande |

Nada aqui pede máquina de corte, espovo ou fita.

### 8. Sequência de sessões e dias
1. Preparação (lavar; empapelar perfis/borrachas; se confirmar isoplastic,
   lixar as janelas depois de abrir a máscara).
2. Sem pintura geral.
3. **Sessão única**: aplicar máscara nas regiões do lettering e do logo,
   cortar tudo à mão, pintar azul-marinho + vermelho + cinza — **as três cores
   no mesmo dia**, porque nenhuma toca outra.
4. Verniz final.

**1 dia por lado.** Com os dois lados no mesmo ciclo, **1,5 dia** o conjunto.
O gargalo é o corte manual do script de 4,6 m, não a pintura.

### 9. Armadilhas para o motor de visão
- **#E4E5E5 × #FFFFFF**: decide sozinho se o job custa 1 dia ou 3. Zona
  cinzenta → exigir confirmação humana.
- **Elipses de traço fino** (3,5 cm = 4 px): fragmentam na segmentação e
  desaparecem em thumbnail; o motor tende a reportá-las como ruído e a subestimar
  o tempo de corte, que é justamente o maior item da arte.
- **Elipses × script têm a MESMA cor**: um motor que separe por conectividade
  vai contar duas regiões e inventar uma fronteira; um que separe por cor vai
  contar uma só (correto).
- **Pontos do trema**: quatro discos isolados de 10 cm são candidatos clássicos
  a filtro de área mínima — se forem descartados, a arte sai errada.
- **Keyline branca do Trans Salto (2 cm = 2 px)**: fecha por antialias e cria
  uma fronteira azul×vermelho falsa — que mudaria o plano de 1 sessão para 2
  sessões + cura.
- O subtítulo cinza sobre fundo quase-branco tem contraste baixo; halo de
  antialias pode virar uma quarta cor.

### 10. Correções à análise antiga (analysis_D.md, item 4)
| a antiga diz | correção |
|---|---|
| "textos pequenos e mini-logo → **vinil final**" | **ERRADO por doutrina.** Não existe vinil como acabamento. O logo Trans Salto tem 2,2 m nesta lateral (não é "mini") e é pintado; os textos têm 12–16 cm e são cortados à mão. |
| "elipses finas longas → **recorte plotado em seções emendadas**" | a máquina só corta o formato da máscara; e aqui nem isso é necessário — 3,5 cm de espessura variável se corta à mão sobre a máscara aplicada, sem emenda de plotagem |
| "**Fronteiras**: chapa branca → tudo T-F; pintura geral cinza → tudo vira T-T" | a primeira metade está certa, mas a antiga **não mediu nada**: o resultado relevante é que **as três cores não se tocam entre si**, logo vão na mesma sessão. Isso não aparece na análise antiga |
| "pior caso (pintura geral) = 3 dias / chapa branca = 1 dia" | a ordem de grandeza sobrevive; a justificativa não |

---

## 4. BALALAC 2024 traseira (Trans Salto)

### 1. Implemento e substrato provável
Traseira de baú com portas duplas (2,55 × 2,68 m). **CHAPA_BRANCA** (mesma
premissa da lateral, a confirmar). Sem faixas → o substrato não altera técnica,
só o lixamento das janelas.

### 2. Fundo
**Chapa branca original**, ~88%. Toda a arte ocupa o terço superior/central; a
metade inferior fica livre (para-choque, refletiva, luzes).

### 3. Inventário de elementos
1. **Pantera** azul-marinho em silhueta-swoosh, ~184 cm de largura × 47 cm de
   altura; **olho vazado** (~5 × 2 cm) e **presas/boca vazadas** (~4 cm) —
   ambos são **chapa preservada**, não tinta branca.
2. **Script "Trans Salto"** azul-marinho, altura de letra ~35 cm, largura ~240
   cm, com **keyline branca contínua de ~1 cm**.
3. **Swoosh vermelho-coral** por baixo do script, ~250 × 35 cm.

### 4. Paleta
azul-marinho chapado; vermelho-coral chapado; branco = chapa (keyline, olho,
presas). Duas cores de tinta em toda a face.

### 5. Fronteiras T-T
**NENHUMA.**

- azul-marinho × vermelho: **não se tocam**. A keyline branca acompanha todo o
  contorno do script exatamente onde ele cruza o swoosh — verificado no arquivo
  em resolução alta (1524 px de largura). Onde o script sai do swoosh, a
  keyline continua contra a chapa.
- pantera × swoosh vermelho: separados por ~40 cm de chapa.
- **Ressalva econômica importante**: geometricamente é T-F, mas a keyline tem
  **~1 cm de largura**. Cortar duas bordas paralelas a 1 cm de distância, ao
  longo de ~500 cm de contorno cursivo, custa quase o mesmo que uma fronteira
  T-T de curvatura fechada — sem a cura. O motor deve reportar
  `tipo: T_F, banda_de_fundo_cm: 1.0, alerta: ponte_fragil`.

### 6. Ordem de pintura
Nenhuma ordem imposta (as cores não se tocam). Recomendação prática:
**vermelho primeiro** (área menor, ~0,7 m² contra ~1,3 m² do azul) e azul em
seguida, na **mesma sessão**, sem cura entre eles — o que se ganha não é
proteção de cor, é que a máscara do azul (a mais delicada, por causa da
keyline) seja a última a ser depilada.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| pantera (184 cm) | **CORTE_MANUAL** | silhueta de raio grande; olho e presas são vazados de 2–5 cm, no limite mas cortáveis com estilete de ponta fina |
| script "Trans Salto" + keyline de 1 cm (35 cm de altura) | **CORTE_MANUAL** | letras grandes; a exigência é de **registro**, não de miniatura: as duas máscaras precisam sair do mesmo desenho com offset de 1 cm |
| swoosh vermelho | **CORTE_MANUAL** | uma folha alongada, raio grande |

### 8. Sequência de sessões e dias
1. Preparação (ferragens, borrachas; a junta central corta a pantera **e** o
   script → planejar a emenda da máscara nas duas folhas de porta, com a arte
   dividida no vão).
2. **Sessão única**: máscara + corte + vermelho + azul.
3. Verniz.

**0,5 a 1 dia**, dentro do ciclo das laterais.

### 9. Armadilhas para o motor de visão
- **Keyline branca de 1 cm = 6 px** neste arquivo (que é grande); em qualquer
  reamostragem para 512 px ela fecha e o motor passa a ver azul encostando em
  vermelho → inventa uma T-T de ~500 cm com curvatura fechada e joga 1 dia +
  cura no orçamento. É o erro individual mais caro possível nesta face.
- **Olho e presas vazados**: microrregiões brancas dentro de massa azul.
  Filtro de área mínima as descarta; e um motor que trate branco como tinta as
  classifica como "tinta branca" — as duas leituras estão erradas.
- O arquivo não desenha a **junta central**: o planejador precisa saber que a
  pantera é cortada ao meio.
- Fundo #E5E5E5 (mesma ambiguidade chapa × cinza-gelo da lateral).

### 10. Correções à análise antiga (analysis_D.md, item 5)
| a antiga diz | correção |
|---|---|
| "**a keyline é fundo aparente → azul e vermelho nunca se tocam**: 2 máscaras T-F independentes" | **CORRETO e é o achado certo.** Mantido. |
| "D1 manhã vermelho → **3h** → azul" | desnecessário: como as cores não se tocam, **não há cura entre elas** (§6 regra 4). A antiga impôs 3 h de espera que a própria conclusão dela dispensava |
| "adesivo sobre vermelho fresco exige 3h de cura" | só se houvesse sobreposição — não há |
| não menciona a **largura** da keyline | é a informação que decide o custo: 1 cm de ponte ao longo de 5 m de contorno cursivo é o item mais caro da face |
| "olho/presas em negativo" | correto, mas a antiga não explicita que **branco = chapa, nunca tinta** |

---

## 5. argus 14,70 lateral

### 1. Implemento e substrato provável
Lateral de **carreta baú frigorífica de 14,70 m** (comprimento no nome do
arquivo) × ~2,64 m. Cliente é frigorífico → **ISOPLASTIC** é o substrato
provável (painel liso de baú refrigerado).

Consequência (§4): **a fita amarela está liberada** — e esta é a arte do slice
que mais se beneficia disso, porque tem ~30 m de divisa ondulada. Confirmar o
substrato é a checagem de maior impacto financeiro deste lote.

Consequência secundária: em isoplastic, as janelas abertas na máscara pedem
**lixamento** antes da laca.

### 2. Fundo
**Chapa branca original, sem pintura geral** — branco ocupa ~62%. A massa
vinho/bordô ocupa ~38%, abaixo do limiar de "pintura geral". Pinta-se só a
massa vinho.

### 3. Inventário de elementos
1. **Massa vinho inferior** — onda que entra pela borda esquerda em ~40% da
   altura, desce, corre pela base e sobe até ocupar quase toda a altura na
   extremidade direita. ~14,7 m de desenvolvimento.
2. **Banda vinho superior fina** — ~15 cm de largura, acompanha a mesma onda,
   entra e sai pelas bordas laterais.
3. **Fio branco entre as duas** — ~18 cm de largura, ~14,7 m de comprimento:
   **é a chapa aparecendo**, não uma terceira cor.
4. **Sombra cinza suave** sob a crista da onda — efeito 3D do layout
   (mockup), **não reproduzir**.
5. **Badge Argus** (sup-dir, ~414 × 147 cm): retângulo arredondado
   **vermelho glossy** com degradê vertical forte e reflexo especular no topo;
   **moldura prata biselada**; "Argus" em **script cromado** com bisel 3D e
   sombra projetada; "FRIGORÍFICO" em branco, ~18 cm; **cabeça de boi**
   branco/prata com sombreado.
6. **"Qualidade que reúne"** — script vinho fino, ~340 × 41 cm.

### 4. Paleta
- **vinho/bordô** — chapado (única cor realmente chapada da arte)
- **vermelho do badge** — **degradê forte** (claro no topo, escuro na base) +
  reflexo especular
- **prata/cromo** — multi-tom, bisel com direções de luz opostas
- **cinza de sombra** — degradê sem borda definida (mockup)
- branco (FRIGORÍFICO, boi, fio entre as ondas) = chapa

### 5. Fronteiras T-T
Fora do badge: **nenhuma**. As duas massas vinho não se tocam (o fio branco de
18 cm as separa em todo o percurso — confirmado em zoom 3×), e o slogan vinho
está isolado na área branca.

Dentro do badge (todas dependem da decisão da §7):

| # | par | extensão ≈ | curvatura | cobre mais |
|---|---|---|---|---|
| T-T 1 | **prata (moldura) × vermelho (campo)** | ~1.120 cm (perímetro interno + externo da moldura) | reta com cantos arredondados (raio ~14 cm) | vermelho |
| T-T 2 | **cromo ("Argus" + boi) × vermelho** | ~1.650 cm | **fechada** (terminais de script, raio 2–5 cm) | vermelho |

Fronteiras **T-F** dentro do badge: "FRIGORÍFICO" branco × vermelho, e as áreas
brancas do boi × vermelho — chapa preservada, se e somente se o badge for
executado como pintura mascarada.

### 6. Ordem de pintura
Fora do badge não há par que se toque → **uma sessão** para todo o vinho
(massa grande + banda fina + slogan).

Dentro do badge, aplicando §2:
1. **cromo/prata** primeiro — cobre muito menos área que o campo vermelho, nos
   dois pares (T-T 1 e T-T 2).
2. mascarar todo o cromo/prata.
3. **vermelho** por cima.

Ou seja: o badge é o inverso da intuição — a letra prateada vem **antes** do
fundo vermelho do badge.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| massa vinho inferior (~14,7 m) | **FITA_AMARELA** | isoplastic + curva suave contínua de raio muito grande = o caso barato explícito da tabela §4: qualquer curva, zero corte. Cobre-se o resto com papel |
| banda vinho superior (15 cm × 14,7 m) | **FITA_AMARELA** (duas fitas paralelas) | idem; a banda é definida por duas fitas com 15 cm entre elas |
| fio branco (18 cm) | não é elemento — é o vão entre as fitas | nada a pintar |
| sombra cinza | **suprimir** | artefato de mockup; se o dono quiser, vira pendência de aerografia |
| slogan "Qualidade que reúne" (41 cm) | **CORTE_MANUAL** | script de 41 cm de altura, traço de ~4 cm; cortável |
| "FRIGORÍFICO" (18 cm, branco) | **CORTE_MANUAL** (negativo) | é chapa preservada: corta-se a janela na máscara e simplesmente não se pinta |
| **badge Argus completo** (414 × 147 cm) | **PENDÊNCIA — decisão do dono** | é um bloco com degradê vertical forte, reflexo especular e cromo com bisel multidirecional. **Não é adesivo impresso.** Restam: (a) **aerografia** dentro de máscaras — viável, porque o badge tem 4,1 m e a aerografia trabalha bem nessa escala; (b) **pintura artística à mão** do cromo; (c) **achatar** o badge para 3 cores chapadas (vermelho + prata + branco), negociando com o cliente, e aí cai em **CORTE_MANUAL** com as duas T-T acima. A diferença entre (a)/(b) e (c) é de horas para dias |

### 8. Sequência de sessões e dias
1. **Preparação**: lavar; empapelar perfis e borrachas; não pintar o aparelho
   de frio da testeira.
2. Sem pintura geral.
3. **Sessão 1** — assentar as fitas amarelas das duas ondas (é o trabalho mais
   longo do dia: ~29 m de fita em curva) + máscara do slogan; **lixar** as
   janelas (isoplastic); pintar **todo o vinho** (massa + banda + slogan) de
   uma vez, porque nada disso se toca.
4. **Sessão 2** (badge) — depende da pendência:
   - se **achatado**: prata/cromo → cura → mascarar → vermelho. Meio dia.
   - se **aerografado**: máscara do badge, base, degradê do campo vermelho,
     depois cromo à mão/aerógrafo. **1 a 2 dias só o badge, por lado.**
5. Verniz final.

**1,5 dia por lado se o badge for achatado; 3 a 4 dias por lado se for
aerografado.** Esta pendência é a maior incerteza de orçamento do slice.

### 9. Armadilhas para o motor de visão
- **Três brancos com papéis diferentes e a mesma cor**: fundo, fio entre as
  ondas, letras "FRIGORÍFICO" dentro do badge. O motor precisa de topologia
  (contido em / adjacente a), não só de cor.
- **Fio branco de 18 cm = 19 px**: sobrevive, mas se o arquivo for reduzido a
  512 px vira 6 px e o motor funde as duas massas vinho, criando uma região
  única — o que **não** muda a técnica (as duas usam fita amarela), mas erra a
  metragem de fita em ~14 m.
- **Sombra cinza sob a onda**: degradê sem borda; o limiar corta em lugar
  arbitrário e cria um elemento fantasma de ~5 m.
- **Badge glossy**: dezenas de tons numa região só. O motor **não** pode
  clusterizar isso como chapado nem rotular "impressão"; tem que emitir
  `bloco_complexo: true, decisao: PENDENTE`.
- Duas famílias de vermelho na mesma arte (o vinho chapado das ondas e o
  vermelho do badge) com ΔE médio: reportar como cores distintas, não unificar.

### 10. Correções à análise antiga (analysis_C.md, item 3)
| a antiga diz | correção |
|---|---|
| "Logo Argus completo: **impressão digital** — degradês metálicos inviáveis em recorte; **adesivo impresso laminado, aplicado após a pintura**" | **ERRADO — é a violação central da doutrina.** Adesivo é máscara. O badge é **PENDÊNCIA**: aerografia, pintura à mão ou achatamento negociado |
| "Slogan script: traço fino conectado → **vinil recortado vinho**" | **ERRADO.** Não existe vinil como acabamento. O slogan tem 41 cm de altura de letra — é corte manual folgado |
| "Não há T-T pintada (**logo é impresso**)" | há **2 fronteiras T-T** (prata×vermelho e cromo×vermelho, ~2.770 cm somadas), que a antiga apagou ao declarar o logo impresso. É exatamente a medida que faltava (§1) |
| "aerografia cara demais para ~2 m de logo" | o badge tem **4,1 m** de largura, não 2 m; e a aerografia é uma das duas saídas legítimas |
| "Ondas vinho: **recorte plotado (máscara) OU** fita amarela flexível" | a fita amarela não é alternativa, é **a** solução — desde que o substrato isoplastic se confirme (§4). Se for chapa, cai em fita branca + corte e o custo sobe muito |
| "Total: 1–1,5 dia" | vale só no cenário "badge achatado". No cenário aerografia são 3–4 dias por lado |

---

## 6. argus 14,70 traseira

### 1. Implemento e substrato provável
Traseira de baú frigorífico, portas duplas, ~2,55 × 2,68 m. **ISOPLASTIC**
(mesma premissa da lateral). Sem faixas nesta face → o substrato só importa
para o lixamento das janelas.

### 2. Fundo
**Chapa branca original**, ~93% da área. A face é quase inteiramente chapa: é o
caso "quase nada a pintar".

### 3. Inventário de elementos
1. **Badge Argus** (quadrante superior direito, ~107 × 40 cm): idêntico ao da
   lateral, **3,9× menor** — mesmo campo vermelho glossy, moldura prata
   biselada, "Argus" cromado, "FRIGORÍFICO" branco (~4,7 cm), cabeça de boi.
2. **"Qualidade que reúne"** — script vinho, ~82 × 10 cm.
3. Nada mais. Dois terços inferiores da face vazios.

### 4. Paleta
Igual à lateral: vinho chapado (só o slogan), vermelho em degradê,
prata/cromo multi-tom, branco = chapa.

### 5. Fronteiras T-T

| # | par | extensão ≈ | curvatura | cobre mais |
|---|---|---|---|---|
| T-T 1 | prata (moldura) × vermelho (campo) | ~290 cm | reta com cantos de raio ~3,6 cm | vermelho |
| T-T 2 | cromo ("Argus" + boi) × vermelho | ~425 cm | **fechada a extrema** (terminais de script com raio de 0,5–1,3 cm) | vermelho |

O slogan vinho **não toca nada** (está sobre chapa). Fora do badge: zero T-T.

**Diferença crítica em relação à lateral:** o mesmo desenho, 3,9× menor, muda
de categoria. Na lateral o cromo tem raios de 2–5 cm (cortável); aqui tem
0,5–1,3 cm — **abaixo do que se corta à mão in situ**.

### 6. Ordem de pintura
Dentro do badge, §2: **cromo/prata primeiro** (menor cobertura) → mascarar →
**vermelho** por cima. O slogan vinho entra em qualquer momento (não toca
nada). Se o badge for achatado, cromo e vinho podem ir na mesma sessão.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| slogan (10 cm de altura de letra) | **CORTE_MANUAL** | no limite inferior confortável; script conectado ajuda (poucas ilhas) |
| "FRIGORÍFICO" (4,7 cm, branco/chapa) | **MASCARA_MAQUINA_SOBRE_VERNIZ** | 11 letras com hastes de ~8 mm dentro de um campo que já terá tinta vermelha em volta. É o caso literal do §3.2: pequeno demais, dezenas de detalhes |
| badge — se **achatado** para 3 cores | moldura e campo: **CORTE_MANUAL**; script "Argus" + boi: **MASCARA_MAQUINA_SOBRE_VERNIZ** | o script de 20 cm de altura com terminais de 0,5 cm não é corte de estilete; aqui o §3.2 se aplica na íntegra: pintar vermelho → **envernizar e curar** → aplicar a máscara cortada a máquina → pintar cromo |
| badge — se **aerografado** | **PENDÊNCIA** | mesma decisão da lateral, mas em 1,07 m o aerógrafo trabalha muito pior que em 4,1 m: o custo relativo do badge traseiro é bem mais alto |

### 8. Sequência de sessões e dias
1. Preparação (ferragens, borrachas, para-choque).
2. Sem pintura geral.
3. **Sessão 1**: máscara + slogan vinho + campo vermelho do badge (não se
   tocam → mesma sessão).
4. **Verniz local sobre o badge + cura** — obrigatório se o cromo/"FRIGORÍFICO"
   forem por máscara de máquina (§3.2).
5. **Sessão 2**: aplicar as máscaras cortadas a máquina; pintar cromo/prata.
6. Verniz final.

**1 dia** dentro do ciclo das laterais — mas note que esta face é a única do
lote que **obriga** um ciclo de verniz intermediário, por causa da miniatura do
script.

### 9. Armadilhas para o motor de visão
- **Face quase toda branca**: auto-crop e detectores de "página vazia" podem
  descartar o arquivo inteiro.
- A **linha de contorno do arquivo** (borda fina do layout) não é moldura real
  do implemento.
- **Mesmo logo, escala diferente, decisão diferente**: o motor precisa decidir
  `cortavel_a_mao` em **cm reais**, não em pixels nem em fração da face. Este
  par lateral/traseira é o melhor caso de calibração do slice para o limiar do
  §5: mesmo desenho, 4,1 m → corte manual; 1,07 m → máquina.
- Badge glossy = bloco de alta entropia; nunca "impressão".

### 10. Correções à análise antiga (analysis_C.md, item 4)
| a antiga diz | correção |
|---|---|
| "logo → **impressão digital**; slogan → **vinil recortado vinho**. **Zero pintura** nesta face. É o caso 'só adesivo'" | **ERRADO em cada frase.** Não existe face "só adesivo": tudo que se vê é pintado. Esta face tem 2 fronteiras T-T, um ciclo de verniz intermediário e ~1 dia de trabalho |
| "Fronteiras: **nenhuma T-T**; tudo elemento-sobre-fundo-original (aplicação de adesivo final, sem máscara)" | há **2 T-T** (~715 cm somadas), ambas dentro do badge |
| "Ordem: lavar → aplicar impresso + vinil (**adesivo laminado dispensa verniz**). **Meio dia**" | o oposto: esta é a única face do slice que **exige** verniz intermediário, pelo §3.2 |
| "logo glossy = bloco impresso único" (armadilhas) | o bloco existe e deve ser isolado, mas o rótulo é **PENDÊNCIA**, não "impresso" |

---

## 7. BIAVA

### 1. Implemento e substrato provável
Lateral de **carreta baú**, proporção **5,65:1** (~14,4 m × 2,55 m).
Transportadora genérica, sem sinal de refrigeração. Substrato de origem:
**CHAPA_BRANCA** — que aqui desaparece sob a pintura geral preta.

Consequência (§4): fita amarela **vetada**. Como não há faixa nenhuma na arte,
isso não custa nada.

### 2. Fundo
**Pintura geral preta**, ~92% da área. Preto não é chapa de fábrica: é tinta.
Isso muda tudo em relação às artes anteriores:

- **não existe nenhuma fronteira T-F nesta arte** — todo contorno de todo
  elemento encosta em tinta preta;
- **não existe branco na arte** (o "cinza-prata" é cinza, não branco), portanto
  não há chapa preservada a planejar;
- soma-se um ciclo completo de fundo ao cronograma.

### 3. Inventário de elementos
1. **Monograma "B"** estilizado (~110 × 180 cm): duas hastes horizontais e um
   arco, em **cinza-prata**, com os "cortes" internos em preto (fundo
   aparecendo).
2. **Duas barras-paralelogramo vermelhas** (~118 × 32 cm cada), inclinadas,
   encaixadas nos vãos pretos do monograma — **sem tocar o cinza** (confirmado
   em zoom 9×: há ~9 cm de preto entre o vermelho e o prata em ambos os
   encontros).
3. **"BIAVA"** — cinza-prata, bold itálico geométrico, altura de letra ~109 cm,
   largura ~440 cm.
4. **"TRANSPORTES"** — cinza mais claro e muito mais fino, ~32 cm de altura,
   ~320 cm de largura, com espacejamento largo.

### 4. Paleta
- **preto** — chapado (pintura geral)
- **cinza-prata** — chapado (o "B" e "BIAVA")
- **cinza-claro** — chapado ("TRANSPORTES"); ΔE baixo em relação ao prata.
  **Decidir com o dono se são uma tinta ou duas** — a diferença aparente pode
  ser só o peso do traço
- **vermelho-coral** — chapado
- nenhum degradê real em toda a arte (a análise antiga viu um; ver §10)

### 5. Fronteiras T-T
Todas as fronteiras da arte são T-T, porque o fundo é tinta.

| # | par | extensão ≈ | curvatura | cobre mais |
|---|---|---|---|---|
| T-T 1 | **cinza-prata × preto** | ~3.000 cm (≈ 30 m): "BIAVA" ~1.750 cm + monograma "B" ~600 cm + "TRANSPORTES" ~700 cm | mista — retas e diagonais longas nas letras itálicas, **média** nas curvas do B/A/V (raio 8–20 cm), **suave** nas pontas arredondadas do monograma | **preto**, por larga margem |
| T-T 2 | **vermelho × preto** | ~615 cm (2 paralelogramos, perímetro ~308 cm cada) | **reta** — 100% arestas retas | **preto** |

**Par que NÃO se toca:** **cinza-prata × vermelho** — separados por uma faixa
de preto de ~9 cm nos dois pontos de aproximação. Verificado em zoom 9×.
Portanto **prata e vermelho podem ser pintados na mesma sessão**, sem cura
entre eles.

### 6. Ordem de pintura
Aqui a doutrina exige uma decisão explícita, porque §2 e §6 apontam para lados
opostos quando a cor "maior" é o próprio fundo:

- **§2 literal**: em T-T 1 e T-T 2 o preto é quem cobre mais → **prata e
  vermelho vêm primeiro, são mascarados, e o preto entra por cima.**
- **§6 passo 2**: "fundo / pintura geral, se houver" vem antes das cores.

**Recomendação: seguir o §2 literal nesta arte** — pintar o logo (prata +
vermelho, mesma sessão, sobre a chapa branca) → curar → mascarar o logo →
pintar o preto geral por cima. Três razões concretas:

1. **Cobertura.** Prata e vermelho sobre chapa **branca** cobrem em uma demão.
   Prata sobre preto exige base clara + duas demãos (a análise antiga
   reconheceu isso e mesmo assim escolheu o caminho caro).
2. **Máscara.** Mascarar o logo (~4 m²) é menos filme e menos corte do que
   preparar janelas em filme sobre 14 m de painel preto curado — é exatamente
   o argumento econômico do §2.
3. O preto cobre qualquer coisa que vaze por baixo da máscara; o inverso não é
   verdade.

Risco a aceitar: o preto, que é a superfície mais visível e mais delatora de
defeito, passa a ser a **última** camada — exige cabine limpa e a máscara tem
que resistir à demão inteira. **Pendência de processo para o dono.**

Ordem interna do logo: prata e vermelho não se tocam → **mesma sessão**.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| "BIAVA" (109 cm de altura) | **CORTE_MANUAL** | letras enormes, geométricas, itálicas; hastes de ~20 cm; corte de estilete trivial |
| monograma "B" (180 cm) | **CORTE_MANUAL** | 3 formas, cantos arredondados de raio grande |
| paralelogramos vermelhos | **CORTE_MANUAL** | 4 retas cada. É o elemento mais fácil do slice inteiro |
| "TRANSPORTES" (32 cm, traço fino) | **CORTE_MANUAL** | 11 letras com hastes de ~3 cm — acima do limiar; o cuidado é de retilinidade, não de miniatura |
| fundo preto | **pintura geral** com o logo mascarado | — |

Nenhuma máquina de corte, nenhum espovo, nenhuma fita nesta arte.

### 8. Sequência de sessões e dias
Cenário recomendado (§2 literal):

1. **D1** — preparação: lavar, **empapelamento total** (preto mancha borracha,
   friso e ferragem de forma irrecuperável), fundo/primer se necessário.
2. **D1 (tarde)** — **sessão 1**: máscara sobre a região do logo, corte manual,
   pintar **cinza-prata + vermelho** juntos (não se tocam). Cura overnight.
3. **D2** — **sessão 2**: mascarar todo o logo pintado; pintar o **preto geral**
   nos 14,4 m. Cura.
4. **D3** — depilar máscaras, retoques de aresta, **verniz final**.

**3 dias por lado**; os dois lados no mesmo ciclo → **3,5 a 4 dias** o
conjunto. O cenário §6 (preto primeiro) custa o mesmo em dias, mas soma uma
demão de base clara sob o prata.

### 9. Armadilhas para o motor de visão
- **Regra "≥80% não-branco → pintura geral"** dispara corretamente aqui, mas o
  motor precisa saber que **o preto é tinta**, não substrato — senão classifica
  todas as fronteiras como T-F e o cronograma cai pela metade.
- **Halo de antialias do prata sobre preto** é largo (alto contraste): gera um
  cinza intermediário que vira uma quinta cor fantasma ao longo de 30 m de
  contorno.
- **Preto de 9 cm entre o vermelho e o prata**: a 1600 px são 10 px. Se fechar,
  o motor cria uma T-T vermelho×prata inexistente e **quebra a sessão única do
  logo em duas sessões com cura**.
- **Prata × cinza-claro (ΔE baixo)**: risco de contar 1 tinta onde há 2, ou o
  contrário — reportar como alerta explícito.
- A análise antiga viu "degradê sutil" nos segmentos vermelhos: no arquivo eles
  são **chapados**. O motor não deve confundir compressão JPEG com degradê.

### 10. Correções à análise antiga (analysis_D.md, item 9)
| a antiga diz | correção |
|---|---|
| "preto geral → cura → **adesivo por cima com janelas** → cinza-prata → 3h → janelas vermelhas" | a linguagem de "adesivo" está certa **só** como máscara, mas a **ordem está invertida** pelo §2: o preto cobre mais, logo entra por último. E prata e vermelho **não precisam das 3 h entre si** — não se tocam |
| "cores claras sobre preto exigem **base branca/clara dentro da janela** (demão extra)" | é a consequência de ter escolhido a ordem errada; invertendo a ordem, a demão extra desaparece |
| "degradê do vermelho: achatar ou 2 passadas de aerógrafo" | **não há degradê**: os paralelogramos são chapados. Aerógrafo não entra nesta arte |
| "segmentos vermelhos separados do cinza por filetes pretos → janelas independentes, **sem contato vermelho×cinza**" | **CORRETO** — e é o achado que a antiga não explorou: significa **uma sessão só** para as duas cores |
| "**tudo T-T** (cor×preto) resolvido por cura+adesivo, **zero fita**" | correto na topologia; faltou medir: 30 m de contorno prata×preto e 6 m vermelho×preto — a medida do §1 |
| "3–4 dias" | ordem de grandeza mantida |

---

## 8. CAVALCANTE (jamaica)

### 1. Implemento e substrato provável
Painel lateral de **carroceria modelo "jamaica"** — proporção **5,93:1**,
faixa longa e baixa (~8,5 m × 1,43 m), típica de lateral de carroceria de
carga seca / graneleiro, não de baú fechado. Substrato: **OUTRO** (chapa de
carroceria; possivelmente com travessas e frisos horizontais que o arquivo não
mostra).

Consequência (§4): não sendo isoplastic nem lona, **fita amarela vetada**.
Não há faixa a traçar nesta arte, então a restrição não custa — mas ela
**proíbe** a solução que a análise antiga sugeriu para o swoosh verde.

### 2. Fundo
**Pintura geral azul-royal, 100% da face.** Não existe um único pixel de chapa
exposta — com **uma exceção decisiva** que a análise antiga não tratou:

> O texto **"Cruzeiro Do Oeste-Pr"** e o **®** são **brancos**. Branco nunca é
> tinta. Portanto essas letras são **chapa preservada por máscara**, e a
> máscara precisa ser aplicada **antes da pintura geral azul** e sobreviver
> também à demão preta. São ~106 × 10 cm de máscara que atravessam duas
> sessões inteiras.

Isso reordena o job todo e é o achado mais importante desta arte.

### 3. Inventário de elementos
1. **Massa preta** do logotipo (~398 × 117 cm): silhueta/sombra sólida que
   envolve todo o wordmark.
2. **"Cavalcante"** — letras em **azul-royal** (a mesma cor do fundo), altura
   ~53 cm, largura ~361 cm, itálico condensado pesado, **desenhadas em negativo
   dentro da massa preta**. Confirmado em zoom 6×: as letras são azuis, não
   pretas com contorno branco.
3. **"Transportadora"** — letras **pretas com keyline azul de ~0,8–1,5 cm**,
   altura ~13 cm, sobre a massa preta.
4. **"Cruzeiro Do Oeste-Pr"** — **branco**, altura de letra ~9,6 cm, ~106 cm de
   largura, dentro da massa preta.
5. **®** branco, ~5 cm.
6. **Swoosh verde** (~393 cm de comprimento, 5–27 cm de espessura) passando por
   baixo da massa preta e terminando em ponta à direita.
7. **Padrão de cubos isométricos** no terço direito (~244 × 143 cm): losangos
   em **azul-escuro** sobre o azul-royal, formando cubos de ~48 cm; ~40 cubos;
   arestas retas; **esmaece progressivamente da direita para a esquerda**
   (degradê de opacidade) e escurece junto à borda direita.

### 4. Paleta
- **azul-royal** — chapado (fundo geral **e** as letras "Cavalcante")
- **preto** — chapado
- **verde-bandeira** — chapado
- **azul-escuro** (cubos) — chapado na forma, **com degradê de opacidade** na
  transição para a esquerda
- **branco** = chapa preservada (só "Cruzeiro Do Oeste-Pr" e ®)

Quatro tintas + chapa.

### 5. Fronteiras T-T
Como o fundo é tinta, **quase tudo é T-T**. Quatro pares:

| # | par | extensão ≈ | curvatura | cobre mais |
|---|---|---|---|---|
| T-T 1 | **preto × azul-royal** | ~2.950 cm (≈ 30 m): contorno externo da massa ~1.030 cm + letras "Cavalcante" ~1.500 cm + keyline de "Transportadora" ~420 cm | **média a fechada** nas letras (raio 1–5 cm nas contra-formas); a keyline de "Transportadora" tem só **0,8–1,5 cm de largura** → **extrema** em termos de fragilidade de corte | azul-royal |
| T-T 2 | **verde × preto** | ~393 cm (todo o bordo superior do swoosh corre sob a massa preta) | **suave** (arco raso de raio muito grande, > 500 cm) | preto |
| T-T 3 | **verde × azul-royal** | ~410 cm (bordo inferior e as duas pontas) | **suave** | azul-royal |
| T-T 4 | **azul-escuro (cubos) × azul-royal** | ~4.000 cm somados (≈ 40 m de arestas) | **reta** — 100% segmentos retos de ~25 cm; nenhuma curva | azul-royal |

**Fronteira T-F:** branco ("Cruzeiro Do Oeste-Pr" + ®) × preto — ~250 cm.
Geometricamente é T-F (chapa), **mas** exige que a máscara sobreviva a duas
sessões de pintura, o que a torna mais cara que muitas T-T. O motor deve
registrar `tipo: T_F, mas atravessa_n_sessoes: 2`.

**Par que NÃO se toca:** massa preta × padrão de cubos — há ~3 cm entre a ponta
direita do logotipo e o primeiro cubo. **Margem apertadíssima**: qualquer
deslocamento de 3 cm na aplicação cria um encontro preto×azul-escuro não
previsto. Sinalizar.

### 6. Ordem de pintura
Aplicando §2 par a par, e resolvendo o mesmo conflito §2 × §6 do BIAVA:

- T-T 2 (verde × preto): verde cobre menos (~0,6 m² contra ~3,2 m²) → **verde
  antes do preto.**
- T-T 3 (verde × azul-royal): verde cobre menos → **verde antes do azul.**
- T-T 1 (preto × azul-royal): preto cobre menos (~3,2 m² contra ~8,5 m²) →
  §2 literal manda **preto antes do azul**.
- T-T 4 (cubos × azul-royal): cubos cobrem menos, mas eles são **sobrepostos ao
  fundo já pintado** e têm um degradê de opacidade que só existe em relação ao
  azul de baixo → **cubos depois do azul**, obrigatoriamente.

**Recomendação — diferente do BIAVA, aqui o §6 vence para o par T-T 1:**
pintar o azul-royal **antes** do preto. Motivos:

1. O azul cobre 8,5 m² dos 12,2 m² da face; mascará-lo para pintar por cima
   significa mascarar quase o painel inteiro.
2. Os cubos (T-T 4) exigem que o azul já esteja lá e curado — e os cubos são
   ~40 m de aresta. Pintar o azul por último obrigaria a uma terceira sessão só
   para o padrão.
3. Preto sobre azul cobre em uma demão (ao contrário do prata sobre preto do
   BIAVA, que era o argumento decisivo lá).

**Sequência final:**
1. mascarar **"Cruzeiro Do Oeste-Pr" + ®** direto na chapa (o branco);
2. **verde** (menor cobertura de todos os pares em que entra) — sobre a chapa;
3. curar; mascarar o verde;
4. **azul-royal geral** (com o branco e o verde mascarados);
5. curar; mascarar as letras "Cavalcante" e as keylines de "Transportadora"
   (que são azul preservado);
6. **preto**;
7. curar; **cubos em azul-escuro** sobre o azul curado.

### 7. Estratégia por elemento

| elemento | estratégia | justificativa |
|---|---|---|
| massa preta + letras "Cavalcante" em negativo (letras de 53 cm) | **CORTE_MANUAL** | letras de meio metro com hastes de ~8 cm; itálico condensado, contra-formas de ~3 cm. É trabalhoso (10 letras, ~15 m de contorno) mas plenamente cortável com estilete |
| "Transportadora" (13 cm) com keyline azul de 0,8–1,5 cm | **MASCARA_MAQUINA_SOBRE_VERNIZ** | é o único elemento do slice que falha o teste do §3 sem discussão: 14 letras de 13 cm cujo **contorno preservado tem menos de 1,5 cm de largura**. Cortar duas linhas paralelas a 1 cm ao longo de 4,2 m, à mão, no implemento, não se faz com qualidade. Aqui o ciclo do §3.2 se aplica na íntegra: pintar o preto → **envernizar e curar** → máscara cortada a máquina → pintar o azul da keyline. **Alternativa a negociar: engrossar a keyline para 3 cm** e cair em CORTE_MANUAL — economiza um ciclo de verniz inteiro |
| "Cruzeiro Do Oeste-Pr" + ® (9,6 cm, branco/chapa) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (aplicada **sobre a chapa**, antes de tudo) | 20 caracteres de 9,6 cm com hastes de ~1,5 cm; o ® tem 5 cm com um anel de 4 mm. Não é corte de estilete. **Observação para o motor: aqui a máscara de máquina vai sobre a chapa nua, não sobre verniz — falta o valor `MASCARA_MAQUINA_SOBRE_CHAPA` no enum do §5** |
| swoosh verde (393 cm) | **CORTE_MANUAL** | uma lente alongada de raio muito grande, sem detalhe interno. **Não pode ser fita amarela** (§4: substrato não é isoplastic nem lona) |
| padrão de cubos (~40 cubos, ~40 m de aresta reta) | **ESPOVO_SOBRE_MASCARA** | é o caso raro do §3.3: **muito grande** (2,44 × 1,43 m) e **muito fácil** (só retas, módulo repetido de 48 cm). Um único kraft furado com o módulo, reposicionado ~40 vezes, bate o carvão sobre a máscara aplicada; o corte segue as marcas. Evita cortar 40 m de aresta a olho e evita uma máquina de corte |
| **fade do padrão** | **PENDÊNCIA — decisão do dono** | o esmaecimento é um degradê de opacidade ao longo de ~120 cm. Não se resolve com máscara. Restam **aerografia** (pressão decrescente sobre o estêncil) ou **suprimir o fade** e cortar o padrão num limite duro. É a diferença entre meio dia e dois dias |

### 8. Sequência de sessões e dias
1. **D1** — preparação: lavar; empapelamento total; conferir travessas/frisos
   que quebram o padrão de cubos. **Aplicar a máscara de máquina do texto
   branco** (fica no implemento até o fim).
2. **D1** — **sessão 1**: máscara + corte manual do swoosh; pintar **verde**.
   Cura.
3. **D2** — **sessão 2**: mascarar o verde; pintar **azul-royal geral**. Cura
   overnight (superfície grande).
4. **D3** — **sessão 3**: máscara sobre a região do logotipo; corte manual das
   letras "Cavalcante" (o item mais longo do job: ~15 m de contorno cursivo);
   pintar **preto**. Cura.
5. **D3/D4** — **sessão 4**: espovo do padrão de cubos sobre a máscara; corte;
   pintar **azul-escuro** (+ aerografia do fade, se aprovado). Cura.
6. **D4** — verniz sobre o preto + cura + máscara de máquina da keyline de
   "Transportadora" + azul da keyline (**só se a keyline não for engrossada**).
7. **D5** — depilar tudo, retoques, **verniz final**.

**4 a 5 dias por lado** — a arte mais cara do slice, por três motivos
independentes: pintura geral, 4 tintas encadeadas em 4 sessões com cura, e um
ciclo de verniz intermediário exigido pela keyline de 1 cm.

Se o dono aceitar **engrossar a keyline para 3 cm** e **suprimir o fade**, o
job cai para **3 dias** e some a máquina de corte inteira, exceto pelo texto
branco.

### 9. Armadilhas para o motor de visão
- **Padrão tom-sobre-tom com contraste baixíssimo**: azul-escuro sobre
  azul-royal. Segmentação por cor perde o padrão inteiro — e com ele ~40 m de
  fronteira T-T e uma sessão de pintura.
- **O fade é degradê de opacidade**, não de cor: vetorizadores geram centenas
  de shapes espúrios e o motor conta "centenas de elementos".
- **As letras "Cavalcante" são da COR DO FUNDO.** Um motor que agrupe por cor
  vai fundir as letras com o fundo geral e concluir que a massa preta é sólida
  — perdendo 15 m de contorno de corte, que é o maior item de mão de obra da
  arte.
- **Branco dentro de massa preta dentro de fundo azul**: a única chapa da face
  está enterrada dois níveis. Qualquer heurística "branco = fundo, fundo =
  fora" erra.
- **Keyline azul de 0,8 cm = 1,5 px**: fecha por antialias e o motor conclui
  que "Transportadora" é preto sólido sobre preto (invisível) — apagando o
  único elemento que exige máquina de corte + verniz.
- **3 cm entre a ponta do logotipo e o primeiro cubo**: sub-pixel; o motor vai
  reportar contato preto×azul-escuro que provavelmente não existe.
- ® de 5 cm: ilegível em qualquer redução.

### 10. Correções à análise antiga (analysis_E.md, item 11)
| a antiga diz | correção |
|---|---|
| "logotype 'Transportadora Cavalcante' itálico bold **PRETO com contorno branco**" | **ERRADO — leitura invertida.** Confirmado em zoom 6×: as letras "Cavalcante" são **azul-royal** (cor do fundo) dentro de uma **massa preta**; não há contorno branco nenhum. A keyline de "Transportadora" é **azul**, não branca |
| "Após cura do azul → adesivo do contorno → **laca branca** → verniz → adesivo das letras → preto" | **ERRADO por doutrina**: não existe "laca branca". Branco é chapa preservada. E o único branco da arte é o texto "Cruzeiro Do Oeste-Pr", que precisa ser mascarado **antes da pintura geral azul** — a antiga o trata como um passo tardio |
| "alternativa realista: **vinil recortado em 2 camadas (branco+preto) se o prazo apertar**" | **ERRADO**: adesivo nunca é produto final; não há caminho "vinil" |
| "Branco×azul (contorno): curvas médias/fechadas → cura+adesivo" e "Preto×branco (letra no contorno)" | **essas duas fronteiras não existem.** As fronteiras reais são preto×azul (~30 m), verde×preto (~4 m), verde×azul (~4 m) e cubos×azul (~40 m) |
| "Swoosh verde: máscara + laca (curva suave contra azul → **fita ou cura**)" | **fita amarela é vetada** aqui (§4: substrato não é isoplastic nem lona). É corte manual |
| "Cubos: máscara plotada do padrão + azul-escuro em **aerografia leve**" | metade certa. A **forma** não precisa de plotter: é o caso didático de **espovo sobre máscara** (§3.3 — muito grande, só retas, módulo repetido). Só o **fade** é pendência de aerografia |
| "~3 dias" | 4–5 dias no cenário fiel ao layout; 3 dias só se a keyline for engrossada e o fade suprimido |
| "Fundo: **azul-royal 100%** ⇒ pintura geral azul" | **CORRETO**, e é o ponto de partida certo |

---

## Pendências consolidadas para o dono

1. **Badge Argus** (lateral 4,1 m e traseira 1,07 m) — aerografia, pintura
   artística à mão, ou achatar para 3 cores chapadas? Impacto: **de 1,5 para 4
   dias por lado**. É a maior incerteza de orçamento do slice.
2. **Substrato da Argus** — se for isoplastic, ~29 m de divisa ondulada saem em
   fita amarela sem corte (§4); se for chapa, viram fita branca + corte manual.
3. **Fade do padrão de cubos da Cavalcante** — aerografar ou suprimir?
4. **Keyline de "Transportadora" (Cavalcante)** — engrossar de 1 cm para 3 cm
   elimina um ciclo inteiro de verniz + máquina de corte.
5. **Ordem fundo × logo quando o fundo é pintura geral** (BIAVA e Cavalcante) —
   §2 (menor cobertura primeiro) e §6 (fundo no passo 2) se contradizem. Regra
   proposta: aplicar §2 quando a inversão elimina uma demão de base (BIAVA:
   prata sobre preto), e §6 quando o fundo precisa estar curado para receber
   outro elemento (Cavalcante: cubos). **Confirmar.**
6. **Substrato das artes de fundo claro** (AAN, BALALAC) — chapa branca ou
   cinza-gelo pintado? Decide 1 dia contra 3.

## Feedback para o motor (`painting-engine`)

- O enum de estratégia do §5 precisa separar **`MASCARA_MAQUINA_SOBRE_CHAPA`**
  de `MASCARA_MAQUINA_SOBRE_VERNIZ`: quando não há tinta embaixo (WhatsApp da
  AAN traseira, texto branco da Cavalcante), a máscara de máquina não paga o
  ciclo de verniz, e a diferença de custo é de meio dia.
- Fronteiras **T-F com banda de fundo estreita** (keyline do Trans Salto: 1 cm;
  fio da Argus: 18 cm) precisam de um campo `banda_de_fundo_cm`. Uma T-F de
  1 cm custa como uma T-T de curvatura fechada.
- Fronteiras **T-F que atravessam N sessões** (branco da Cavalcante) precisam de
  `atravessa_n_sessoes` — a máscara fica no implemento e restringe o
  cronograma.
- O par **argus lateral / argus traseira** é o melhor caso de calibração do
  limiar `cortavel_a_mao` do §5: **o mesmo desenho** a 4,1 m é corte manual e a
  1,07 m é máquina. O limiar tem que ser medido em **cm reais do menor
  detalhe** (aqui, o raio dos terminais do script: ~3 cm passa, ~0,8 cm não
  passa).
- `cor_maior_cobertura` deve ser calculado **em área do implemento**, não em
  área do elemento — em BIAVA e Cavalcante o vencedor é sempre o fundo, e é isso
  que dispara a discussão §2 × §6.
