# Análise de Produção — Lote B (12 layouts)

Planejamento de produção de pintura de implementos rodoviários. Cada análise segue os 9 pontos:
(1) implemento/vista/substrato · (2) fundo · (3) inventário de elementos · (4) paleta ·
(5) estratégia por elemento · (6) fronteiras tinta-tinta vs tinta-fundo · (7) camadas/ordem/curas ·
(8) processos extras · (9) armadilhas de segmentação automática.

---

## 1. ACM 8,30m lateral.png

**(1) Implemento/vista/substrato** — Lateral de baú 8,30 m (proporção ~4,7:1). Arte vetorial "flat" sem mockup; presume-se chapa de alumínio com frisos verticais (baú de carga seca padrão). Se for isoplastic, o corte fica mais fácil, mas exige lixamento pós-adesivo.

**(2) Fundo** — Branco ≈ 55–60% da área (centro). É o **branco original da chapa** — não pintar. As duas colunas laterais de mosaico triangular verde ocupam ~20% cada, mas como o branco domina, **não há pintura geral**.

**(3) Inventário**
- Mosaico geométrico de triângulos (facetado "low-poly") nas duas extremidades — grande, altura total do baú, ~1,5–2 m de largura cada.
- Elipse verde-escura central com setas envolventes (logo ACM) — grande, ~2,5 m diâmetro.
- Letras "ACM" vazadas em branco dentro da elipse — grandes, ~1 m de altura.
- Texto "DISTRIBUIDORA E TRANSPORTES" em cinza-escuro — médio, faixa única.

**(4) Paleta** — 4–6 tons de verde chapados no mosaico (verde-escuro, verde-médio, verde-claro, ~2 tons de verde-menta) + verde-escuro do logo + cinza-grafite do texto + branco (fundo). Sem degradês reais — o efeito de "profundidade" é feito por facetas chapadas. Total realista de tintas: **~5 verdes + 1 cinza**.

**(5) Estratégia por elemento**
- **Mosaico triangular**: ponto crítico. Dezenas de triângulos adjacentes tom-sobre-tom → dezenas de fronteiras tinta-tinta retas. Cortar com fita cada aresta é viável (todas retas), mas o volume é enorme. Recomendado: **adesivo de recorte plotado como máscara multi-estágio** — pintar o verde mais claro em toda a mancha do mosaico, aplicar máscara plotada revelando só os triângulos do próximo tom, pintar, repetir do claro para o escuro (laca seca rápido). Alternativa econômica: **impressão digital** do mosaico inteiro (elimina 100% das fronteiras internas) e pintar só o logo central. Triângulos que tocam o branco: só adesivo, sem corte.
- **Elipse do logo + setas**: máscara plotada (curva grande e suave); letras ACM ficam **vazadas na máscara** — o branco das letras é a própria chapa: zero pintura, zero fronteira tinta-tinta.
- **Texto cinza**: máscara plotada, 1 cor. Fronteira só com fundo branco.

**(6) Fronteiras**
- Tinta-tinta: TODAS as arestas internas do mosaico (retas — compensa fita/máscara plotada, sem cura entre tons se usar sequência claro→escuro com máscara acumulada); junção elipse-escura × faceta de sombra da seta (reta/suave — fita).
- Tinta-fundo (só adesivo, sem corte): contorno externo do mosaico contra o branco, contorno da elipse, contorno do texto, **letras ACM (knockout branco = chapa)**.

**(7) Camadas/ordem**
1. Dia 1 manhã: lavar; aplicar máscara geral das áreas de mosaico; pintar tom verde 1 (mais claro).
2. Dia 1: laca seca rápido — aplicar 2ª máscara, tom 2; repetir tons 3–5 (claro→escuro evita cobrir escuro com claro). Se usar cura+adesivo por cima entre tons: +3h por estágio → estica para 2 dias.
3. Dia 2: elipse verde-escura do logo (máscara própria) + texto cinza.
4. Dia 2 fim/Dia 3: verniz geral sobre tudo.
Total: **2–3 dias** por lado se pintado; 1 dia se mosaico for impresso.

**(8) Extras** — Arte espelhada/repetida no outro lado (dobra o mosaico!); se chapa com frisos, os triângulos atravessam frisos → cortes de fita sobre relevo (mais retoques); faixa refletiva regulamentar na parte inferior; empapelar moldura perimetral.

**(9) Armadilhas de segmentação** — Muitos tons de verde vizinhos com baixa distância cromática → clustering funde facetas; antialiasing nas arestas diagonais cria pixels intermediários que parecem "tons extras"; verdes translúcidos (menta ~quase branco) confundíveis com fundo; contagem de cores por histograma superestima (amostras de AA) ou subestima (merge de facetas).

---

## 2. ACM 8,30m traseira.png

**(1)** — Traseira de baú (formato ~quadrado). Portas traseiras: 2 folhas com **dobradiças, fechos/barras de fechamento verticais e batentes** — a arte atravessa a divisão central das portas.

**(2)** — Branco ≈ 60%, original da chapa. Sem pintura geral.

**(3)** — Mesmo sistema da lateral: colunas de mosaico triangular nas bordas esquerda/direita, logo ACM central grande (~1,2 m), texto "DISTRIBUIDORA E TRANSPORTES".

**(4)** — Idêntica à lateral: ~5 verdes + cinza + branco-chapa. Consistência de tons entre lateral e traseira é obrigatória (mesmas misturas, pintar na mesma leva).

**(5)** — Igual à lateral em técnica; escala menor torna o mosaico proporcionalmente mais trabalhoso (triângulos menores = fita mais difícil → máscara plotada ainda mais indicada; impressão digital é forte candidata na traseira).

**(6)** — Mesmas classes da lateral. Atenção: o logo central cruza a **junção das duas portas** — fronteira física, não de cor: máscara aplicada com portas fechadas e cortada na junção.

**(7)** — Mesmo cronograma da lateral; pintar traseira na mesma janela de cada tom de verde para bater cor. +meio dia pelo trabalho em volta de ferragens.

**(8) Extras** — **Desmontar/mascarar fechos, barras verticais, dobradiças e borrachas de vedação** (empapelamento demorado); faixa refletiva e para-choque traseiro; placa/luzes; corte da máscara na junção das portas para não rasgar ao abrir.

**(9)** — Além das armadilhas da lateral: em fotos reais da traseira as barras de fechamento criam listras verticais escuras que um segmentador leria como "faixas da arte"; sombras das dobradiças viram falsas fronteiras.

---

## 3. ADRI FRUTAS lateral.png (arte "ADRI LEGUMES")

**(1)** — Lateral de baú longa (~6:1). Vetor flat; provável chapa com frisos (baú de hortifrúti). Sem indicação de isoplastic.

**(2)** — Branco ≈ 55–60% original da chapa + **campo cinza-claro chapado ≈ 25%** na metade esquerda (painel cinza sob os swooshes). O cinza é grande mas <80% → **não é pintura geral**, é um elemento pintado gigante.

**(3)**
- Bloco esquerdo: campo cinza + 3 swooshes longos (branco vazado, laranja, grafite) varrendo ~4 m — elementos enormes de curvatura suave.
- Frase pequena "Dedicação, trabalho e fé" em cinza sobre o cinza-claro (itálico, pequena).
- Logo central-direito: elipse vermelha caligráfica (tomate estilizado com talos verdes), cenoura laranja grande com talos verdes e sombreado, "ADRI" grafite grande (~80 cm), barra grafite com "LEGUMES" vazado em branco, linha de contato (fone/box/e-mail) pequena.
- Selo "25 Anos" vermelho/prata pequeno no canto superior direito — **tem degradê metálico prata**.

**(4)** — Vermelho vivo, laranja (cenoura e swoosh), laranja-escuro (sombra da cenoura), verde (talos), grafite/preto, cinza-claro, cinza-médio; branco = chapa. Degradê real apenas no selo "25 anos" (prata).

**(5)**
- **Swooshes longos**: curvas horizontais suaves de vários metros → caso clássico de **fita amarela flexível** (sem corte) nas bordas longas; preenchimento a pistola. O swoosh branco é **vazado**: definido pelas bordas do cinza e do laranja — não se pinta branco.
- **Campo cinza**: fita nas bordas retas + pistola.
- **Elipse vermelha caligráfica + cenoura**: máscara plotada (curvas médias, pontas finas de talo — plotter obrigatório, fita não faz ponta).
- **Textos ADRI/contatos**: máscara plotada, grafite. "LEGUMES" é **knockout branco** dentro da barra grafite — vazado na máscara, zero fronteira de tinta.
- **Talos verdes sobre o vermelho/laranja**: fronteira tinta-tinta fechada → **pintar → envernizar → curar ~3h → adesivo por cima → pintar verde** OU máscaras plotadas registradas (preferível: formas pequenas).
- **Selo 25 anos (prata degradê)**: pequeno demais para aerografia valer → **adesivo impresso digital** aplicado por cima do verniz, ou simplificar para prata chapada.
- Sombreado escuro da cenoura: 2º tom laranja com máscara registrada.

**(6) Fronteiras**
- Tinta-tinta: swoosh laranja × grafite (suave/longa — fita flexível); cinza × swoosh grafite (suave — fita flexível); talos verdes × vermelho (fechada — cura+adesivo ou registro plotado); cenoura × elipse na sobreposição (média — máscara registrada); laranja-escuro × laranja (suave — máscara).
- Tinta-fundo (só adesivo): todos os contornos contra o branco — elipse externa, cenoura externa, ADRI, contatos, borda superior dos swooshes; "LEGUMES" e swoosh branco são knockouts (= chapa).

**(7) Ordem**
1. Dia 1: lavar, empapelar frisos; máscaras; cinza-claro do campo + grafite (laca, mesma jornada, secagem entre demãos).
2. Dia 1/2: laranja (swoosh + cenoura + sombra) e vermelho (elipse).
3. Dia 2: verniz → cura 3h → máscara dos talos → verde. Selo impresso aplicado.
4. Dia 2 fim: verniz final geral.
Total: **2 dias** por lado.

**(8) Extras** — Arte espelhada no lado oposto (swooshes espelham; texto NUNCA espelha); frisos atravessados pelos swooshes (fita flexível acompanha bem); faixa refletiva inferior; selo digital = item impresso à parte.

**(9)** — Swoosh branco vazado entre duas cores lido como "objeto branco pintado" quando é chapa; degradê prata do selo gera dezenas de tons espúrios; texto pequeno de contato abaixo da resolução; cinza-claro confundível com sombra de mockup.

---

## 4. ADRI FRUTAS traseira.png

**(1)** — Traseira de baú (quadrada), 2 folhas de porta com ferragens. Moldura fina vermelha no perímetro do arquivo — provável guia; em dúvida, tratar como guia e NÃO pintar.

**(2)** — Branco ≈ 80% original da chapa. Sem pintura geral. Arte concentrada no terço superior/central.

**(3)** — Logo completo grande centralizado: elipse caligráfica vermelha (~2 m), talos verdes, cenoura laranja com sombreado, "ADRI" grafite, barra "LEGUMES" vazada, linha de contato.

**(4)** — Vermelho, laranja (2 tons), verde, grafite, branco-chapa. Sem prata (sem selo) → paleta mais simples que a lateral.

**(5)** — Tudo por máscara plotada + laca: vermelho (elipse), laranja (cenoura, 2º tom por máscara registrada), grafite (textos/barra), verde (talos — cura+adesivo sobre vermelho/laranja OU registro plotado). "LEGUMES" e brilhos = knockout/chapa.

**(6)** — Tinta-tinta: verde × vermelho (fechada — cura+adesivo), laranja-escuro × laranja (suave — máscara), cenoura × elipse (média — registro). Tinta-fundo: todos os contornos externos e knockouts.

**(7)** — 1 dia: grafite + vermelho + laranja (laca, mesma jornada, máscaras independentes) → verniz → 3h → verde dos talos → verniz final. **1,5 dia** contando ferragens.

**(8) Extras** — Empapelar fechos/dobradiças/borrachas; arte cruza junção das portas (cortar máscara na junção); faixa refletiva; para-choque.

**(9)** — Moldura vermelha fina do arquivo é guia, não arte — segmentador vai contá-la como elemento; sobreposições vermelho/laranja/verde com AA criam tons falsos de fronteira.

---

## 5. AFO lateral.png

**(1)** — Lateral de baú (~4,5:1). Canto "718" = numeração de frota. Chapa branca padrão.

**(2)** — Branco ≈ 75–80% original. Sem pintura geral.

**(3)**
- Globo/esfera azul-violeta grande (~2,2 m) com **degradê radial 3D** (brilho no topo-esquerda) e dois anéis orbitais em **degradê prata/cinza metálico**.
- "AFO" azul-marinho serifado, letras grandes (~1 m) com divisores verticais finos.
- "transportes" cinza, médio.
- Número de frota "718" preto, pequeno.
- Bloco legal minúsculo canto inferior direito ("PRODUTOS PERECÍVEIS" + endereço/fone).

**(4)** — Azul-violeta em degradê (esfera), azul-marinho (tipografia), cinza-médio, cinza-prata degradê (anéis), preto, branco-chapa.

**(5)**
- **Esfera com degradê radial**: caso claro de **aerografia** — máscara plotada do círculo, aerografar degradê violeta com ponto de luz. Alternativa: **impressão digital** do globo inteiro (com anéis); para 1 unidade, impressão ganha; para frota pintada padronizada, aerografia.
- **Anéis prata**: aerografia com máscaras por cima da esfera, ou parte do mesmo impresso.
- **AFO + transportes**: máscara plotada + laca chapada (serifa exige plotter).
- **718 e bloco legal**: vinil recortado/impresso pronto — texto pequeno demais para pintar.

**(6)** — Tinta-tinta: anel prata × esfera violeta (curva média dos dois lados — máscaras registradas + aerografia, não fita); o brilho da esfera não é fronteira (degradê contínuo). Tinta-fundo: contorno da esfera, letras, textos — só adesivo.

**(7)** — Dia 1: lavar/empapelar; máscara do globo, aerografia (violeta base → sombra → luz → anéis prata) — meio dia; tipografia azul + cinza (laca); verniz geral. **1–1,5 dia** por lado; meio dia se globo impresso.

**(8) Extras** — Numeração de frota variável por veículo (recorte avulso); bloco "Produtos Perecíveis" = exigência regulatória, manter legível; lado oposto: globo/anéis espelham, texto não; faixa refletiva.

**(9)** — Degradê radial violeta→quase branco: threshold come a borda clara da esfera contra o fundo branco; anéis prata → dezenas de cinzas; texto legal abaixo da resolução; "718" lido como arte quando é metadado de frota.

---

## 6. AGI SOLAR lateral.png

**(1)** — Faixa lateral longa e baixa (~7:1) — perfil de **sider/carreta ou faixa superior de baú**. Se lona sider: NADA de pintura — tudo adesivo/impressão; análise assume chapa pintável, com plano B para lona.

**(2)** — Branco ≈ 85% original. Sem pintura geral.

**(3)**
- Ícone painel solar: 3 colunas curvas (verde-petróleo, laranja, azul-ciano) com **degradês internos e reflexos**, ~1,2 m.
- "AGI" laranja + "SOLAR BRASIL" verde-petróleo — bold arredondado grande.
- "Energia Solar" laranja, médio.
- **QR code** + ícones WhatsApp/Instagram + fone/@ — pequenos.
- "Integrador autorizado: nexen distribuidora" — pequeno, canto direito.

**(4)** — Verde-petróleo, laranja, azul-ciano (chapados na tipografia; **em degradê no ícone**), cinza-escuro, preto (QR), branco-chapa.

**(5)**
- **Tipografia**: máscara plotada + laca, 2 cores, fronteira só com fundo → simples.
- **Ícone com degradês/reflexos**: pequeno e complexo → **adesivo impresso digital**; aerografar 3 degradês registrados em 1,2 m custa mais que imprimir. Se pintado: simplificar para chapado em 3 estágios de máscara.
- **QR code**: NUNCA pintar — vinil recortado/impresso (precisão de módulos; borrão mata a leitura). Testar leitura após aplicação.
- Contatos/nexen: vinil recortado.

**(6)** — Tinta-tinta: nenhuma relevante se ícone for impresso (colunas do ícone se tocam: verde×laranja×azul, curvas médias — mais um motivo para imprimir). Tinta-fundo: toda a tipografia (só adesivo).

**(7)** — 1 dia: máscaras, laca laranja + petróleo (mesma jornada), verniz, aplicar impressos (ícone, QR, contatos) após verniz curado. Plano B lona: 100% impressão/recorte, 0 pintura.

**(8) Extras** — QR precisa de zona quieta branca (chapa dá de graça); lado oposto: QR e textos não espelham; logo "nexen" é marca de terceiro — fidelidade obrigatória.

**(9)** — QR = centenas de micro-regiões pretas (detectar como bloco único "QR", não como arte); degradês do ícone somem no threshold contra branco; ícones sociais minúsculos viram ruído.

---

## 7. AGI SOLAR traseira.png

**(1)** — Traseira de baú (quadrada), portas com ferragens.

**(2)** — Branco ≈ 85% original. Sem pintura geral.

**(3)** — Ícone painel solar grande (~1,5 m) no quadrante superior esquerdo (degradês); bloco tipográfico "AGI / SOLAR / BRASIL / Energia Solar" à direita; **QR code grande** (~70 cm) isolado no canto inferior esquerdo.

**(4)** — Igual à lateral: petróleo, laranja, ciano (degradês no ícone), preto (QR), branco-chapa.

**(5)** — Tipografia: máscara plotada + laca (2 cores). Ícone: **impresso digital** (degradês + reflexos diagonais). QR grande: **recorte de vinil preto** (módulos retos, plotter corta perfeito); pintar via máscara plotada é possível a 70 cm, mas risco de sangria em aresta de módulo não compensa.

**(6)** — Tinta-tinta: nenhuma (elementos isolados sobre branco). Tinta-fundo: tudo — arte inteiramente "só adesivo". Traseira tecnicamente simples.

**(7)** — Meio dia a 1 dia: empapelar ferragens, laca 2 cores, verniz, aplicar ícone impresso + QR. Testar leitura do QR à distância.

**(8) Extras** — Junção de portas cruzando o bloco tipográfico; faixa refletiva; QR fora da faixa do para-choque e da placa.

**(9)** — QR = bloco único; ícone com degradê; grandes áreas brancas fazem crop automático "perder" elementos isolados nos cantos.

---

## 8. Agricola Premium (NEW) 6,30 lateral.png

**(1)** — Lateral de baú 6,30 m (~2,7:1). Chapa branca; se refrigerado (hortifrúti), pode ser **isoplastic** → lixar sob o adesivo antes de pintar (mas aqui quase não há pintura, ver abaixo).

**(2)** — Branco ≈ 55% (metade direita) original da chapa. Metade esquerda ≈ 40% é uma **FOTOGRAFIA** (abóboras, pimentões, morangos, tomates sobre madeira) com corte diagonal.

**(3)**
- Painel fotográfico full-bleed esquerdo (~2,5 m de largura, altura total) — fotografia real com **marca d'água de banco de imagem visível ("shutterstock")**.
- Logo central-direito: coroa de 7 estrelas verdes, espiga estilizada, faixas curvas de "campo" em degradê verde, "AGRÍCOLA" espaçado, "PREMIUM" serifado grande em **degradê verde** (~70 cm de altura).

**(4)** — Foto = milhares de cores (fora de qualquer paleta de pintura). Logo: 2–3 verdes em degradê (escuro→claro).

**(5)**
- **Foto**: **impressão digital obrigatória** — nenhuma técnica de pintura reproduz fotografia de alimentos com custo são. Vinil impresso laminado, painel único com corte diagonal.
- **Logo**: (a) imprimir junto (1 fornecedor, 1 aplicação, resolve degradês) ou (b) pintar: máscara plotada + laca verde chapado (perde degradê) ou aerografia leve dentro da máscara. Como a foto já obriga impressão, **(a) domina**: imprimir tudo, pintar nada.
- Diagonal foto/branco: borda do próprio vinil (corte reto no plotter).

**(6)** — Tinta-tinta: nenhuma se tudo impresso. Se logo pintado: estrelas/espiga × faixas = mesma máscara/tom; o resto é tinta-fundo (só adesivo).

**(7)** — Meio dia: preparar superfície (impressão não exige lixamento — o lixamento do isoplastic vale para TINTA sobre adesivo), aplicar painel impresso + logo; sem verniz (laminação substitui). Se logo pintado: +1 dia (verde + aerografia + verniz).

**(8) Extras** — **Marca d'água de banco de imagem = licença NÃO comprada**: BLOQUEAR produção até o cliente licenciar (risco jurídico + marca d'água sairia impressa!). Lado oposto: reposicionar a foto em vez de espelhar. Junções de painéis de vinil em 2,5 m: sobrepor ~1 cm em zona de textura.

**(9)** — Fotografia = anti-caso de vetorização (milhares de cores, texturas, sombras); marca d'água semitransparente confunde OCR/segmentação; corte diagonal é a única fronteira "limpa"; degradê de "PREMIUM" some no branco nas partes claras.

---

## 9. AGROMINA lateral.png

**(1)** — Lateral de baú (~3,5:1). Arte cobre 100% da superfície com fundo escuro.

**(2)** — Fundo marrom/preto-vinho escuro ≈ 100% ≠ branco → **PINTURA GERAL obrigatória** se pintado: lavar, empapelar molduras/frisos, fundo laca em cor próxima (marrom-escuro), cor final, verniz. PORÉM o fundo não é chapado: foto de costela assada (metade esquerda), fagulhas/brasas voando, curvas tom-sobre-tom → o "fundo" é fotográfico.

**(3)**
- Foto de costelas de porco assadas sobre tábua (~metade esquerda) — texturas de carne, brilho, gergelim.
- Partículas de brasa/fagulhas sobre toda a metade direita.
- Curvas sutis tom-sobre-tom no fundo escuro.
- Logo script "Agromina" em **dourado com degradê metálico** (~2,5 m), sublinhado caligráfico, folha dourada, "EST. 1973" branco com filetes.
- "TRADIÇÃO EM CARNE SUÍNA" branco/creme, médio.

**(4)** — Marrons/pretos/vinhos contínuos, laranjas/vermelhos de glow, paleta fotográfica da carne, dourado degradê, branco/creme. Essencialmente ilimitada.

**(5)** — Arte fotográfica de ponta a ponta: **impressão digital total (wrap) é a única via sã**. Reproduzir por pintura exigiria: pintura geral escura + aerografia fotográfica da carne (dias de artista) + aerografia das fagulhas + dourado degradê (aerografia sobre máscara plotada do script). Viável só como serviço premium explícito (semana+). Recomendação: **wrap impresso**.

**(6)** — Se impresso: nenhuma fronteira de produção. Se pintado: dourado × fundo = máscara plotada (script fino — plotter obrigatório); carne × fundo = transição aerografada sem máscara; fagulhas = aerografia com stencil/respingo. Nada aqui é caso de fita.

**(7)** — Impresso: 1 dia de aplicação. Pintado: D1 pintura geral escura; D2–4 aerografia foto/brasas; D5 dourados (máscara+aerografia); D6 verniz.

**(8) Extras** — Wrap sobre frisos: vinil cast conformável + primer de borda; empapelamento completo se pintado; faixa refletiva sobre fundo escuro; lado oposto com foto reposicionada.

**(9)** — Pior caso de segmentação: foto + glow + partículas + degradê dourado + fundo quase-preto com curvas sutis; threshold vê "1 cor escura"; texto script dourado com contraste variável derrota OCR; fagulhas = milhares de micro-blobs.

---

## 10. AGROMINA traseira.png

**(1)** — Traseira de baú (quadrada), portas com ferragens.

**(2)** — Fundo preto ≈ 65% (superior) + **faixa inferior dourada em degradê metálico** ≈ 35% → 100% ≠ branco → **pintura geral** se pintado. Dourado é degradê contínuo.

**(3)**
- Porco dourado grande (~2,5 m) estilo "cortes de açougue" — silhueta dourada com **linhas pretas finas internas** dividindo os cortes; dourado com **degradê metálico** (varredura de brilho).
- Onda dourada inferior com logo "Agromina" script preto, "EST. 1973", "TRADIÇÃO EM CARNE SUÍNA."
- **QR code preto** sobre o dourado + contatos (fone, @, site) pretos.

**(4)** — Preto, dourado degradê (2 aplicações: porco e faixa), brancos mínimos. Paleta curta com metálico dominante.

**(5)**
- Caminho pintura (viável aqui, ao contrário da lateral): **pintura geral preta** (fundo laca próximo + preto final). **Porco**: máscara plotada da silhueta → **dourado metálico com varredura de brilho aerografada**. **Linhas internas dos cortes = knockout do preto**: na máscara plotada as linhas permanecem cobertas → o preto do fundo faz as linhas — ZERO pintura de linha. **Faixa dourada inferior**: curva superior suave longa → **fita amarela flexível** + dourado a pistola/aerógrafo. **Textos pretos sobre dourado**: curar o dourado (~3h) → máscara plotada → preto. **QR**: vinil recortado preto aplicado ao final (não pintar).
- Caminho impressão: wrap — mais rápido, mas dourado impresso perde o brilho metálico real; identidade "premium metálica" tende a preferir pintura com dourado verdadeiro.

**(6)** — Tinta-tinta: silhueta do porco × preto (curvas médias/fechadas em orelhas/rabo/cascos — máscara plotada, não fita); curva superior da faixa × preto (suave longa — **fita flexível**); textos/script pretos × dourado (fechadas — pintar → curar ~3h → adesivo → preto). Tinta-fundo: **NENHUMA** — não há branco de chapa; tudo é tinta sobre tinta ou knockout do preto geral.

**(7) Ordem**
1. Dia 1: lavar, empapelar ferragens/molduras; fundo laca escuro; preto final.
2. Dia 2 manhã: máscara do porco + fita flexível da faixa; dourado metálico + brilho aerografado.
3. Dia 2 tarde (após ~3h de cura do dourado): máscaras dos textos; preto dos scripts/contatos.
4. Dia 3: QR em vinil, verniz geral (metálico → verniz obrigatório).
Total: **3 dias**.

**(8) Extras** — Ferragens traseiras (empapelamento longo); junção das portas corta o porco ao meio → máscara cortada na junção, alinhada com portas fechadas; QR legível (testar); faixa refletiva sobre preto; placa/luzes.

**(9)** — Binarização pega a silhueta do porco, mas o degradê interno vira bandas; linhas de corte internas (1–2 px) somem em downscale — justamente as linhas que definem a identidade; QR sobre dourado tem contraste menor que sobre branco.

---

## 11. AKTL.png

**(1)** — Vista única (provável lateral ~3:1 ou traseira larga). Chapa branca.

**(2)** — Branco ≈ 80% original da chapa. Sem pintura geral.

**(3)** — Monograma "AKTL" gigante (~1,5–2 m): "AK" azul-marinho + "TL" amarelo-ouro, letras geométricas grossas encaixadas, com **sombra interna sutil** no vértice A/K; "TRANSPORTE E LOGÍSTICA" cinza espaçado; "WWW.AKTL.COM.BR" cinza pequeno.

**(4)** — Azul-marinho, amarelo-ouro, cinza-escuro; branco-chapa. A "sombra" é um degradê escuro sutil — simplificável para chapado ou aerografia leve.

**(5)**
- Letras geométricas de arestas retas: candidatas ideais a **fita de corte** (todas as bordas retas) ou máscara plotada. Azul e amarelo se TOCAM na diagonal K/T → 1 fronteira tinta-tinta reta: **fita + corte**; pintar amarelo primeiro, laca seca rápido, fita em ~1h, sem espera de cura longa.
- Sombra do vértice A/K: aerografia de minutos dentro da máscara, ou omitir (decidir com cliente).
- Textos: máscara plotada + cinza; site pequeno pode ser vinil recortado.

**(6)** — Tinta-tinta: diagonal azul × amarelo no encontro K/T (**reta — fita+corte, caso de manual**); sombra interna (degradê — aerografia, não fronteira dura). Tinta-fundo: todos os demais contornos (só adesivo).

**(7)** — Dia 1: máscara do monograma; amarelo; 1–2h; fita na diagonal; azul; textos cinza; verniz no fim do dia ou manhã seguinte. **1 dia**. Arte mais simples do lote.

**(8) Extras** — Repetir em ambos os lados + traseira (letras não espelham); padronizar a sombra aerografada entre unidades da frota (stencil/registro).

**(9)** — Sombra sutil entre A e K cria "3ª cor" fantasma; encaixe K/T sem respiro → AA mistura azul+amarelo = pixels verdes falsos na fronteira.

---

## 12. AP RANCHARIA lateral.png

**(1)** — Lateral de baú (~3,2:1). Chapa branca com frisos prováveis.

**(2)** — Branco ≈ 75% original. Sem pintura geral.

**(3)**
- Monograma "AP" vermelho itálico grande (~1,2 m) atravessado por swoosh (branco vazado + vermelho).
- Duas grandes faixas swoosh vermelhas paralelas cruzando a metade direita (~4 m, curvatura suave ascendente) com faixa branca vazada entre elas.
- "TRANSPORTADORA" grafite bold itálico grande; "Rancharia-SP" cinza médio.
- Linha de contatos ("LOGÍSTICA E TRANSPORTE RODOVIÁRIO", e-mail, fones) pequena, grafite + vermelho.

**(4)** — Vermelho único, grafite, cinza-médio; branco-chapa. **3 tintas — tudo chapado, zero degradê.**

**(5)**
- **Faixas swoosh longas**: **fita amarela flexível** nas bordas (curvas horizontais suaves — o caso-alvo da técnica), pistola. A faixa branca entre as vermelhas é **vazada** (chapa), definida pelas fitas das duas vermelhas.
- **Monograma AP + swoosh interno**: máscara plotada (corte curvo médio dentro do A/P); vermelho junto com as faixas (mesma tinta, mesma jornada).
- **Textos**: máscara plotada + grafite/cinza; contatos pequenos em vinil recortado.

**(6)** — Tinta-tinta: **NENHUMA** — vermelho e grafite nunca se tocam (sempre separados por branco da chapa). Tudo é tinta-fundo (só adesivo/fita, sem corte de sobreposição, sem espera de cura). Arte exemplar de produção barata.

**(7)** — Dia 1: lavar/empapelar frisos; fita flexível das faixas + máscaras plotadas; vermelho; grafite/cinza (laca, mesma jornada); verniz fim do dia. **1 dia por lado.**

**(8) Extras** — Lado oposto: swooshes espelham (apontam para frente nos 2 lados), textos não; faixas atravessam frisos → fita flexível acompanha, retocar cantos de friso; faixa refletiva inferior; fones em vermelho = 2ª cor no bloco pequeno (vinil resolve).

**(9)** — Faixa branca vazada entre 2 vermelhas lida como "objeto branco"; itálico com AA nas diagonais; textos pequenos multi-cor somem em downscale.

---

# PADRÕES TRANSVERSAIS

## Padrões recorrentes nas artes
1. **Branco da chapa como cor de projeto (knockout)** — em 10 das 12 artes o branco não é pintado: letras vazadas (ACM, LEGUMES), swooshes brancos entre faixas (ADRI, AP RANCHARIA). Regra: região branca conectada ao fundo OU vazada dentro de máscara = chapa, custo zero, nenhuma fronteira.
2. **Dois arquétipos de custo opostos**: (a) "logo + textos sobre chapa branca" (AKTL, AP, AGI, AFO, ACM, ADRI) → 1–2 dias, laca + máscara plotada + fita; (b) "arte fotográfica/full-bleed" (AGROMINA lateral, AGRÍCOLA PREMIUM) → impressão digital obrigatória; pintura só como serviço premium de aerografia. AGROMINA traseira é o híbrido em que pintura geral + dourado metálico aerografado vale a pena.
3. **Curvas longas suaves horizontais (swoosh) em ~metade das artes** → fita amarela flexível é a técnica mais reutilizada do lote; fronteiras retas (mosaico ACM, monograma AKTL) → fita de corte; serifa, script, ponta fina ou talo → máscara plotada, sem exceção.
4. **Fronteiras tinta-tinta reais são raras**: na maioria, as cores são separadas por branco. Quando existem: encaixe direto de letras (AKTL — fita reta), detalhe pequeno sobre cor (talos ADRI — cura 3h + adesivo ou registro plotado), texto sobre campo pintado (AGROMINA traseira — cura + adesivo).
5. **Elementos "não-pintáveis" padronizados**: QR codes, blocos legais minúsculos, selos com degradê metálico pequeno, logos de terceiros → sempre vinil recortado/impresso aplicado após o verniz. Aparecem em 5 das 12 artes.
6. **Traseiras repetem a lateral em versão compacta** com custo extra fixo: empapelamento de fechos/dobradiças, corte de máscara na junção das portas, faixa refletiva/para-choque. Pares lateral/traseira pintados na mesma leva de tinta (batimento de cor).
7. **Degradê = decisor de técnica**: degradê pequeno (selo 25 anos, ícone AGI) → imprimir; degradê grande e único (globo AFO, dourado AGROMINA) → aerografia; degradê "fake" por facetas (mosaico ACM) → pintura chapada multi-estágio.
8. **Metadados dentro da arte**: número de frota (AFO "718"), moldura-guia (ADRI traseira), marca d'água de banco de imagem (AGRÍCOLA — bloqueio jurídico antes de produzir). Não são arte.

## Ideias para o motor de análise automática
- **Classificador de arquétipo antes de segmentar**: % de branco conectado à borda + nº de cores quantizadas + textura fotográfica (entropia local alta) → decide "logo-sobre-chapa" (pipeline vetorial) vs "full-bleed/foto" (recomendar impressão) vs "pintura geral" (≥80% não-branco com cor dominante única).
- **Grafo de adjacência de regiões**: segmentar por cor quantizada, montar grafo região×região; aresta região×branco-de-fundo = "só adesivo"; aresta cor×cor = fronteira tinta-tinta → medir curvatura ao longo da aresta (reta/suave/média/fechada/extrema) e emitir técnica por aresta (fita reta / fita flexível / máscara plotada / cura+adesivo).
- **Detecção de knockout**: região branca 100% cercada por 1 cor = vazado na máscara (custo zero) — não contar como "branco pintado".
- **Detectores dedicados de não-arte**: QR (finder patterns → bloco único "vinil"), texto < X cm em escala real (→ vinil recortado), marca d'água (padrão repetitivo semitransparente → flag jurídica), número isolado sem lock-up com o logo (→ variável de frota).
- **Anti-armadilhas**: quantizar com merge por ΔE só APÓS erodir 1–2 px das fronteiras (remove antialiasing); degradês detectados por gradiente monotônico dentro de região única (não fragmentar em bandas); escala real extraída do nome do arquivo ("8,30m", "6,30") para converter px→cm e decidir pintável vs vinil.
- **Saída por elemento**: técnica, cor(es), nº de estágios de máscara, esperas de cura acumuladas, flags (ferragens de traseira, frisos, isoplastic→lixar, QR→testar leitura, licença de imagem) → soma = estimativa de dias e custo.
