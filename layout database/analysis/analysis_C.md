# Análise de Produção — Lote C (12 layouts)

Convenções usadas:
- **T-T** = fronteira tinta-tinta (exige fita+corte OU cura ~3h + adesivo por cima)
- **T-F** = fronteira tinta-fundo-original (branco da chapa não pintado; só o adesivo de recorte protege — sem corte, sem fita)
- Curvas: reta / suave / média / fechada / extrema
- "Pintura geral" = lavar + empapelar molduras/frisos + fundo laca em cor próxima + cor final + verniz (se poliéster)

---

## 1. Aquarela lateral.png

**(1) Implemento/vista/substrato:** Lateral de baú frigorífico (empresa de gelo → muito provavelmente baú isoplastic liso, refrigerado). Proporção ~14–15 m de lateral. Arte não mostra frisos; se for isoplastic: corte fácil, mas **lixar a superfície após aplicar o adesivo** para a tinta aderir.

**(2) Fundo:** Azul-marinho escuro ~100% da superfície, com leve degradê radial (centro mais claro) que é efeito de arte/mockup — na prática vira **azul chapado**. Fundo ≠ branco ⇒ **PINTURA GERAL azul-marinho**: lavar, empapelar molduras, fundo laca azul próximo, azul final, verniz.

**(3) Inventário:**
- "GELO" — texto branco espaçado, ~8% da altura, topo centro.
- Moldura retangular branca (filete ~2–3 cm) + "AQUARELA®" serifado branco grande (~35% da altura) — elemento dominante central.
- Linha de contatos: ícone WhatsApp, ícone telefone, ícone Instagram + números/handle — texto pequeno (~5% da altura).

**(4) Paleta:** 2 cores efetivas: azul-marinho (fundo) + branco (tudo). O degradê do fundo é ignorado (vira chapado). Sem metálicos.

**(5) Estratégia por elemento:**
- Fundo: pintura geral em laca azul.
- "AQUARELA" + moldura + "GELO": grandes o bastante para **recorte plotado (máscara) + pintura laca branca** sobre o azul curado. Serifas finas do tipo Didone exigem plotagem precisa; alternativa segura: as serifas mais finas em vinil branco aplicado (sem pintura).
- Linha de contatos + ícones: **muito pequenos para pintar** — aplicar direto em **vinil branco recortado** (adesivo final, não máscara).
- ® minúsculo: vinil.

**(6) Fronteiras:** Todas as divisões são **branco-sobre-azul = T-T**, mas como o fluxo é "pintura geral primeiro → curar → aplicar máscara por cima → pintar branco", **nenhuma fita de corte é necessária**: a cura do fundo transforma tudo em caso "cura+adesivo". Curvas: letras serifadas = médias a fechadas (ápices do A, terminais do Q); moldura = retas. Zero fronteiras T-F (não sobra chapa branca original).

**(7) Camadas/ordem:**
1. Dia 1: lavar, empapelar, lixar (isoplastic), fundo laca azul.
2. Dia 1–2: azul final (laca seca rápido).
3. Cura ~3h mínimo (ideal overnight) → aplicar máscaras plotadas de todos os elementos brancos.
4. Pintar branco laca (1 cor só — uma sessão).
5. Remover máscaras, aplicar vinis pequenos (contatos), **verniz geral por cima de tudo**.
Total: ~2 dias.

**(8) Extras:** Empapelamento de molduras/perfis de alumínio do baú; se isoplastic, lixamento pós-adesivo obrigatório; a mesma arte repete espelhada no lado motorista (recorte espelhado — atenção: textos e ® NÃO espelham); faixa refletiva regulamentar na parte baixa (aplicar por último, sobre o verniz).

**(9) Armadilhas p/ segmentação automática:** degradê radial do fundo pode gerar dezenas de "cores" falsas — precisa clusterização tolerante (o fundo é UMA cor); antialiasing branco/azul nas serifas finas; ícones pequenos podem ser detectados como ruído; o filete da moldura pode desaparecer em downscale.

---

## 2. Aquarela traseira.png

**(1)** Traseira de baú frigorífico — **portas com dobradiças, fechos e maçanetas verticais** (não visíveis no layout mas existem no físico). Formato quase quadrado (~2,6×2,4 m).

**(2)** Mesmo azul-marinho ~100% ⇒ **pintura geral azul** na traseira também.

**(3) Inventário:** "GELO" + caixa "AQUARELA®" (mesma lockup da lateral, ~60% da largura); **QR code** branco (~15% da largura, inferior esquerdo); monograma "A" serifado grande (~20% da altura, inferior direito).

**(4) Paleta:** azul + branco (2 cores). QR = branco sobre azul.

**(5) Estratégia:**
- Fundo: pintura geral azul (mesma batelada da lateral).
- Lockup AQUARELA: máscara plotada + laca branca (reaproveitar arquivo de corte da lateral em escala menor).
- **QR code: NUNCA pintar** — módulos minúsculos, tolerância zero. **Impressão digital (adesivo impresso) ou vinil recortado eletronicamente**, aplicado após o verniz. Testar leitura após aplicação.
- Monograma "A": grande e simples → máscara + pintura branca.

**(6) Fronteiras:** todas T-T resolvidas por cura+adesivo (fluxo de pintura geral). Curvas: médias/fechadas nas serifas; QR = fora do fluxo de pintura.

**(7) Ordem:** junto com a lateral (mesma cabine/dia): fundo azul → cura → máscaras → branco → verniz → QR adesivo por último (sobre o verniz, para poder trocar).

**(8) Extras:** **portas traseiras**: dobradiças e fechos de inox empapelados ou removidos; a arte atravessa a divisão entre as duas folhas da porta — alinhar máscara com as portas fechadas; borrachas de vedação protegidas; faixa refletiva traseira obrigatória.

**(9) Armadilhas:** QR code = centenas de mini-regiões pretas/brancas — segmentador ingênuo explode em milhares de polígonos; deve ser detectado como bloco único "imprimir". Degradê do fundo idem lateral. Moldura fina e ® somem em baixa resolução.

---

## 3. argus 14,70 lateral.png

**(1)** Lateral de baú/carreta frigorífica 14,70 m (frigorífico Argus). Provável isoplastic (frigorífico) — lixar após adesivo. Layout muito horizontal (proporção ~6:1).

**(2)** Fundo **branco ~60–65% = branco original da chapa — NÃO pintar**. Massa vinho/bordô ondulada ocupa ~35% (canto sup. esquerdo + faixa inferior que corre até a direita). Como <80%, **não é pintura geral**: pintam-se somente as massas vinho.

**(3) Inventário:**
- Onda vinho superior-esquerda (grande massa) separada da faixa inferior vinho por um **fio branco ondulado** (respiro do fundo original).
- Sombra cinza suave sob a onda (efeito 3D do layout).
- Logo Argus (~15% da largura, direita-topo): badge vermelho glossy com degradê + borda prata, "Argus" script prata metálico com bisel 3D, "FRIGORÍFICO" branco, cabeça de boi prata.
- Slogan "Qualidade que reúne" — script vinho fino sob o logo.

**(4) Paleta:** vinho/bordô chapado; badge com degradê vermelho claro→escuro; prata metálico com bisel (multi-tom); cinza de sombra. Efetivamente: 1 cor pintada (vinho) + 1 arte impressa (logo) + sombra opcional.

**(5) Estratégia:**
- Ondas vinho: **recorte plotado (máscara)** OU — melhor em 14,7 m — **fita amarela flexível** definindo a borda ondulada + empapelamento do restante (emenda de plotagem em peça tão longa é o maior risco; curvas longas e suaves são o caso ideal da fita flexível).
- Fio branco entre as duas massas: é fundo original aparecendo — a máscara tem esse vão (ou duas fitas flexíveis paralelas).
- Sombra cinza sob a curva: **aerografia leve** (opcional) ou suprimir — sombras de mockup normalmente não são reproduzidas.
- Logo Argus completo (badge glossy + prata bisel + boi): **impressão digital** — degradês metálicos/glossy multi-direcionais inviáveis em recorte; aerografia cara demais para ~2 m de logo. Adesivo impresso laminado, aplicado após a pintura.
- Slogan script: traço fino conectado → **vinil recortado vinho** (pintar script fino gera rebarba).

**(6) Fronteiras:**
- Vinho ↔ branco original: **T-F** (só adesivo/fita, sem corte) — curvas suaves/longas → fita amarela flexível.
- Fio branco entre massas vinho: também **T-F** (o fio É o fundo).
- Não há T-T pintada (logo é impresso). Sombra aerografada sobre branco = sem fronteira dura.

**(7) Ordem:**
1. Lavar; (isoplastic) aplicar máscara/fita das ondas, lixar área exposta.
2. Pintar vinho laca (1 sessão). Cura ~3h.
3. (Opcional) aerografia da sombra cinza.
4. Verniz nas áreas pintadas.
5. Aplicar logo impresso + slogan em vinil por cima.
Total: 1–1,5 dia. Trabalho dominado pela aplicação de fita/máscara em 14,7 m.

**(8) Extras:** arte espelhada no outro lado (confirmar sentido da onda); faixa refletiva inferior por cima da faixa vinho; empapelar molduras dianteira/traseira; "14,70" no nome do arquivo = comprimento do baú → padronizar arquivo por comprimento de chapa.

**(9) Armadilhas:** sombra cinza degradê→branco não tem borda definida (threshold corta em lugar arbitrário); branco do fundo × branco do fio × branco do logo são a MESMA cor com papéis diferentes; logo glossy contém dezenas de tons — deve virar bloco único "impressão digital"; leve vinheta de mockup nos cantos.

---

## 4. argus 14,70 traseira.png

**(1)** Traseira de baú frigorífico (portas duplas, dobradiças/fechos). Quase quadrada.

**(2)** Fundo **branco ~90% = branco original — nenhuma pintura de fundo.**

**(3) Inventário:** apenas logo Argus (badge glossy, ~40% da largura, quadrante superior direito) + slogan script vinho.

**(4) Paleta:** vermelhos degradê/prata metálico (logo impresso) + vinho (slogan).

**(5) Estratégia:** logo → **impressão digital** (mesmo motivo da lateral); slogan → vinil recortado vinho. **Zero pintura** nesta face. É o caso "só adesivo".

**(6) Fronteiras:** nenhuma T-T; tudo elemento-sobre-fundo-original (aplicação de adesivo final, sem máscara).

**(7) Ordem:** lavar → aplicar impresso + vinil (adesivo laminado dispensa verniz). Meio dia.

**(8) Extras:** posicionar o logo para NÃO cair sobre dobradiça/fecho (no layout fica na folha direita — validar com foto do implemento); faixa refletiva traseira; para-choque.

**(9) Armadilhas:** página quase toda branca — auto-crop pode descartar a face como "vazia"; a borda fina do arquivo (linha de contorno do layout) pode ser lida como moldura real; logo glossy = bloco impresso único.

---

## 5. astutilog-sider PRETO lateral.png

**(1)** **SIDER (lona lateral!)** — o nome do arquivo confirma. Processo diferente de chapa: lona flexiona — pintura rígida trinca; usa-se tinta vinílica específica ou impressão. Vista lateral ~15 m.

**(2)** Fundo **preto ~90%**. Em sider: ou a lona já vem preta de fábrica (ideal — zero pintura de fundo) ou pinta-se com vinílica. **Recomendação: encomendar lona preta** e produzir só os elementos. Se pintar lona branca de preto: "pintura geral" adaptada (tinta flexível, sem verniz poliéster rígido).

**(3) Inventário:**
- Esfera/globo abstrato (~20% da largura, esquerda): gomos em degradês prata/cinza/branco multi-direcionais + recorte preto.
- "ASTUTI" branco bold + "LOG" cinza médio — texto gigante (~50% da largura).
- Swoosh inferior: faixa curva com **degradê prata→cinza** correndo toda a base, com "www.astutilogistica.com.br" branco sobre ela.
- Selo "Desde 2003" com moldura ornamental fina (canto sup. direito, pequeno).
- Mini-selo amarelo de certificação (SASSMAQ?) no canto inf. esquerdo, minúsculo.

**(4) Paleta:** preto (fundo), branco, cinza médio, degradês prata (esfera + swoosh), amarelo (mini-selo). Degradês dominam os elementos gráficos.

**(5) Estratégia (assumindo lona):**
- Caminho padrão de mercado: **impressão digital da lona inteira** (sider com degradês). Alternativa híbrida:
- Fundo: lona preta de fábrica.
- "ASTUTI"/"LOG": vinílica com máscara plotada (letras grandes bold — corte fácil) OU vinil recortado.
- Esfera com degradês: **impressão digital em adesivo para lona** (degradês multi-tons inviáveis em corte; aerografia sobre lona flexível é frágil).
- Swoosh prata degradê + site: painel impresso; ou simplificar para cinza chapado (decisão comercial) com borda superior em curva suave (fita flexível).
- Selos pequenos: vinil impresso.

**(6) Fronteiras:** branco/cinza sobre preto = T-T se pintado (cura+adesivo); sobre lona preta de fábrica vira análogo a T-F (sem corte); esfera e swoosh = blocos impressos (sem fronteira de pintura). Curvas: letras bold = suaves; swoosh = suave longa; esfera = médias.

**(7) Ordem (híbrido):** lona preta → máscaras texto → vinílica branca; cura → cinza "LOG" (ou tudo vinil, sem espera) → aplicar painéis impressos (esfera, swoosh, selos). 1 dia. (Impressão total: só confecção + 1 dia de instalação.)

**(8) Extras:** **sider = lona removível**: produção em bancada com lona esticada, fora do chassi; tensores/fivelas verticais "cortam" a arte quando a lona ondula; repetir nos DOIS lados com a esfera sempre à frente (espelhar layout, nunca os textos); traseira deste conjunto é chapa vermelha (item 6) — validar intenção preto-lona × vermelho-chapa com o cliente; cores em lona ≠ cores em laca+verniz.

**(9) Armadilhas:** degradês prata viram bandas falsas na quantização; compressão JPEG no preto; mini-selo amarelo de poucos px pode ser descartado como ruído mas é obrigatório (certificação); "sider"/"PRETO" no filename são metadados de substrato/cor — parsear.

---

## 6. astutilog-sider PRETO traseira.png

**(1)** Traseira do mesmo conjunto — **chapa** (portas traseiras metálicas). Formato quadrado.

**(2)** Fundo **vermelho escuro/carmim ~85%** ⇒ **PINTURA GERAL vermelha**: lavar, empapelar, fundo em vermelho próximo, vermelho final, verniz. (Lateral preta + traseira vermelha = identidade da frota; confirmar antes de pintar.)

**(3) Inventário:** esfera prata degradê grande (~40% da largura, topo); "ASTUTI" branco-gelo + "LOG" cinza-escuro; "www.astutilogistica.com.br" cinza-escuro. Metade inferior vazia (vermelho puro).

**(4) Paleta:** vermelho (fundo), branco-gelo, cinza-escuro (quase preto), degradês prata da esfera.

**(5) Estratégia:**
- Fundo: pintura geral vermelha.
- Esfera: **impressão digital** aplicada após o verniz (degradês).
- "ASTUTI": máscara plotada + laca branca sobre vermelho curado.
- "LOG" + site cinza-escuro: segunda cor → segunda sessão (cura+máscara) ou **vinil recortado cinza** (mais barato: 1 sessão de pintura só).

**(6) Fronteiras:** branco↔vermelho e cinza↔vermelho = **T-T via cura+adesivo** (fluxo de pintura geral). "ASTUTI" e "LOG" são adjacentes sem vão — fronteira T-T **reta** vertical entre o I e o L: se ambas pintadas, pintar branco, curar, mascarar e pintar cinza (ou fita na junção reta). Vinil elimina o problema.

**(7) Ordem:** fundo vermelho (D1) → cura overnight → máscara + branco (D2 manhã) → cura 3h → cinza (vinil OU pintura D2 tarde) → verniz → esfera impressa por cima. ~2 dias.

**(8) Extras:** dobradiças/fechos empapelados; faixa refletiva; par lateral-lona/traseira-chapa com acabamentos diferentes das mesmas cores.

**(9) Armadilhas:** cinza-escuro sobre vermelho tem baixo contraste em thumbnail (segmentador pode fundir "LOG" ao fundo); degradê da esfera; metade inferior vazia confunde detecção de proporção/conteúdo.

---

## 7. ATACADÃO FOLLY lateral.png

**(1)** Lateral de baú seco (hortifrúti/atacado). ~7–8 m (caminhão médio, "Ceasa Londrina"). Chapa lisa ou com frisos finos.

**(2)** Dois campos: **verde ~55%** (esquerda) com degradê vertical claro→escuro (mockup; na prática **verde chapado**) e **cinza-claro/branco ~45%** (direita). O campo direito é quase branco — tratar como **branco original da chapa** (o tom cinza é sombreamento do mockup). Verde <80% ⇒ **sem pintura geral**: pinta-se só o campo verde.

**(3) Inventário:**
- Divisão diagonal em forma de seta/chevron (recorte poligonal reto grande).
- Logo "F" hexagonal verde-escuro + meia-lua preta (~25% da largura, campo branco).
- "ATACADAO FOLLY" — caixa-alta fina, verde + preto; "DESDE 1994" preto espaçado.
- "Ceasa – Londrina PR" — itálico branco bold sobre o verde (inf. esquerdo).

**(4) Paleta:** verde médio (chapado), verde-escuro, preto, branco. 100% cores chapadas — **zero degradês reais**. Arte ideal para pintura pura.

**(5) Estratégia:**
- Campo verde: fronteira diagonal RETA → **fita de corte simples** (fita larga + corte manual, sem plotter) + empapelamento do campo direito; laca verde.
- "Ceasa – Londrina PR": máscara plotada + branco sobre verde curado, OU vinil branco.
- Logo "F" hexagonal: formas grandes geométricas → recorte plotado + pintura verde-escuro e preto — hexágono e meia-lua têm respiro branco entre si → sem interação de cores.
- Textos finos "ATACADAO FOLLY"/"DESDE 1994": traço fino → **vinil recortado** (haste fina pintada gera rebarba) ou máscara se letra ≥8 cm.

**(6) Fronteiras:**
- Verde ↔ branco original: **T-F**, retas/diagonais → só adesivo/fita. A mais barata possível.
- Verde-escuro do F ↔ preto da meia-lua: separados por respiro branco → **T-F**.
- Branco "Ceasa" ↔ verde: T-T por cura+adesivo — ou vinil (zero espera).
- **Nenhuma fronteira exige fita+corte curvo.**

**(7) Ordem:** lavar → fita na diagonal + empapelar → verde laca (D1) → cura 3h → "Ceasa" branco (máscara ou vinil) → logo F verde-escuro + preto (áreas disjuntas — mesma sessão; ou vinil) → verniz. 1–1,5 dia.

**(8) Extras:** degradê do verde é só mockup — chapado; espelhar no outro lado (validar sentido da seta); traseira (item 8) compartilha o verde — mesma batelada de tinta.

**(9) Armadilhas:** degradê vertical do verde é artifício de mockup — clusterizar como 1 cor; o campo "branco" é cinza no arquivo (#e6e8e8) — não confundir com cor a pintar; sombra sutil na dobra da diagonal; letras finas espaçadas fragmentam na segmentação.

---

## 8. ATACADÃO FOLLY traseira.png

**(1)** Traseira de baú — portas duplas com ferragens. Quadrada.

**(2)** Fundo **verde ~100%** ⇒ **PINTURA GERAL verde** (mesmo verde da lateral — mesma batelada).

**(3) Inventário:** logo "F" hexagonal em BRANCO (negativo, ~50% da largura, metade superior); "ATACADAO FOLLY" branco fino; "DESDE 1994" branco espaçado. Metade inferior verde puro.

**(4) Paleta:** verde + branco. 2 cores, chapadas.

**(5) Estratégia:** fundo verde geral → cura → todos os elementos brancos em **uma única sessão**: máscara plotada do F (formas grandes) + textos finos em vinil branco (hastes de ~2 cm não valem pintura).

**(6) Fronteiras:** tudo **branco-sobre-verde = T-T via cura+adesivo** (1 espera só). Curvas: hexágono = retas/médias; letras finas = médias. Sem fita de corte.

**(7) Ordem:** D1 fundo verde + cura overnight; D2 máscara + branco + verniz. 2 dias corridos, ~1 dia de mão de obra.

**(8) Extras:** dobradiças/fechos empapelados; o F atravessa a junção das duas portas — alinhar com portas fechadas e cortar a película na junção; faixa refletiva; para-choque.

**(9) Armadilhas:** leve vinheta no verde; o F branco é vazado (contraformas verdes internas) — o segmentador deve manter os buracos como fundo, não como "ilhas brancas".

---

## 9. Atacado Frios lateral.png

**(1)** Lateral de baú frigorífico (distribuidor BRF) — provável isoplastic ⇒ lixar após adesivo. ~8–9 m.

**(2)** Fundo **cinza-gelo muito claro ~100%**. Decisão crítica: se a cor da frota for realmente cinza-claro ≠ branco ⇒ pintura geral cinza; se for chapa branca com sombreamento de mockup ⇒ branco original, zero pintura de fundo. Recomendação: tratar como **branco original** (economia enorme) e confirmar com o cliente.

**(3) Inventário:**
- Seta circular vermelha grande envolvendo o logotipo (~30% da largura, centro-topo).
- "ATACADO FRIOS" azul-marinho itálico bold + barras diagonais estilizadas.
- "DISTRIBUIDOR EXCLUSIVO BRF REGIÃO SUL PIAUÍ" — azul, médio.
- "ENTREGA RÁPIDA!" — azul, grande.
- 4 logomarcas de terceiros: **brf** (globo facetado multicolorido degradê!), **Sadia**, **Perdigão** (selo circular detalhado), **Kidelli** (badge amarelo degradê) — pequenas (~5% da largura cada).
- "Grupo Jorge Batista" itálico azul (canto sup. direito).
- Barras diagonais azul-marinho gigantes (canto inf. direito, ~20% da largura).
- Rodapé: TELEVENDAS 0800 / E-COMMERCE www — azul, pequeno.

**(4) Paleta:** azul-marinho e vermelho chapados + logos de terceiros com degradês multicoloridos. Fundo cinza-gelo/branco.

**(5) Estratégia:**
- Seta vermelha: grande, curvas suaves/médias → **máscara plotada + laca vermelha** (ou fita flexível na curva externa + plotter só na ponta da flecha, que tem cantos fechados).
- "ATACADO FRIOS" + barras: itálico bold grande → máscara plotada + laca azul. Barras do canto = retas → **fita de corte**.
- Textos médios: máscara + azul (mesma sessão — mesma cor).
- Textos pequenos (rodapé, Grupo JB): vinil azul recortado.
- **Logos de terceiros (brf/Sadia/Perdigão/Kidelli): impressão digital obrigatória** — marcas registradas com degradês e detalhes minúsculos; fidelidade exigida pelos guias de marca. Adesivo impresso laminado.

**(6) Fronteiras:**
- Vermelho ↔ fundo e azul ↔ fundo: **T-F** (só adesivo).
- Vermelho ↔ azul onde a seta cruza o lettering "FRIOS": **T-T** → pintar vermelho, curar 3h, mascarar e pintar azul por cima (recomendado — junções curvas), ou fita+corte nas junções (curvas médias — viável mas trabalhoso).
- Logos impressos: sem fronteira de pintura.

**(7) Ordem:** lavar (+lixar isoplastic sob as artes) → máscara vermelha → vermelho; cura 3h → máscaras azuis (todas as peças azuis numa sessão) → azul → verniz áreas pintadas → aplicar logos impressos + vinis pequenos. 1,5 dia.

**(8) Extras:** isoplastic sem frisos facilita as curvas da seta; espelhamento no outro lado (sentido da seta); faixa refletiva; logos de terceiros exigem arquivos oficiais/aprovação das marcas.

**(9) Armadilhas:** fundo cinza-gelo ≠ branco puro no arquivo — regra "quase-branco = fundo original" necessária; globo brf facetado = dezenas de micro-regiões (bloco impresso único); sobreposição seta×texto quebra vetorização simples; itálico com barras gera muitos paralelogramos pequenos.

---

## 10. AURIZ FOODS 640 lateral.png

**(1)** Lateral de baú ("640" = 6,40 m — caminhão 3/4). Chapa lisa ou isoplastic (foods).

**(2)** Tri-campo: **branco ~45%** (esquerda/centro — branco original, não pintar), **amarelo ~25%** (faixa inferior esquerda em onda), **verde ~30%** (painel direito inteiro). Nenhuma cor ≥80% ⇒ **sem pintura geral**; pintam-se os campos amarelo e verde.

**(3) Inventário:**
- Logo auriz: "auriz" marrom bold arredondado + colinas (verde-claro + verde-escuro) + sol laranja; "FOODS" laranja/âmbar (~35% da largura).
- Onda amarela inferior com **fio/filete preto-grafite** acompanhando a crista (curva S longa).
- Painel verde direito separado do branco por curva S vertical com **fio preto**.
- **FOTO de prato com frango assado, batatas e pimentas** sobre o verde (~20% da largura) — fotografia com sombras.
- "Sabor de um novo dia" preto bold sobre o amarelo.
- Instagram @aurizfoods branco sobre o verde.

**(4) Paleta:** branco (fundo), amarelo-ouro, verde médio, marrom, verde-claro, verde-escuro, laranja, preto/grafite + FOTO full-color. 7 cores chapadas + fotografia.

**(5) Estratégia:**
- Campo amarelo: curva suave longa → **fita amarela flexível** + laca amarela.
- Fio preto da crista: filete de ~3–5 cm em curva suave → **duas fitas flexíveis paralelas** e pintura do vão em preto (técnica clássica de filete), ou vinil preto em tira flexível.
- Painel verde: borda em curva S → fita flexível + laca verde.
- Fio preto vertical da divisa branco/verde: idem filete.
- Logo auriz: colinas verde-claro/verde-escuro se encostam e o sol fica atrás → junções resolvidas com **pintar→envernizar→curar 3h→adesivo→próxima cor**, OU vinil recortado multi-camada, OU impresso. "auriz" marrom e "FOODS" laranja grandes → máscara+pintura.
- **FOTO do prato: impressão digital obrigatória** (fotografia impossível de pintar; aerografia fotográfica custaria mais que o serviço). Adesivo impresso recortado no contorno, aplicado sobre o verde curado.
- "Sabor de um novo dia": máscara + preto após cura do amarelo (T-T) ou vinil preto.
- @instagram: vinil branco.

**(6) Fronteiras:**
- Amarelo ↔ branco original com filete preto no meio: vira amarelo↔preto↔branco — duas fronteiras suaves resolvidas com fitas flexíveis (caso de uso canônico da fita flexível).
- Verde ↔ branco: idem, com filete.
- Colina verde-claro ↔ verde-escuro: **T-T suave** → fita flexível OU cura+adesivo.
- Sol laranja ↔ colinas: **T-T média** → cura+adesivo.
- Preto texto ↔ amarelo: T-T (cura+adesivo) ou vinil.
- Foto: bloco impresso.

**(7) Ordem (~2 dias):**
D1 manhã: lavar; fitas flexíveis; pintar amarelo + verde (áreas disjuntas — mesma sessão). Cura 3h.
D1 tarde: filetes pretos (fita dupla); máscaras do logo → marrom + um dos verdes.
D2: cura → segundo verde, laranja (sol/FOODS) e preto (slogan); verniz; aplicar foto impressa + vinis.

**(8) Extras:** foto impressa com laminação UV (desbota); versão espelhada no outro lado; "640" = variante dimensional — o cliente terá layouts 640/790/etc.: escalar componentes, não o layout inteiro; faixa refletiva sobre o amarelo inferior.

**(9) Armadilhas:** FOTO = milhares de cores — detectar como "bloco fotográfico → impressão" (alta entropia local); filetes pretos finos somem/serrilham em thumbnail; sombras da foto vazam para o verde (borda suave); dois verdes próximos (colinas × painel) podem ser fundidos pela quantização.

---

## 11. AURIZ FOODS 640 traseira.png

**(1)** Traseira de baú 3/4 — portas com ferragens. Quase quadrada.

**(2)** **Branco ~60% (original — não pintar)** + faixa amarela inferior ~35% com crista em curva S e **fio preto-grafite grosso** acompanhando. Sem pintura geral.

**(3) Inventário:** logo auriz completo grande centralizado (~70% da largura); onda amarela inferior; fio preto ondulado; **QR code** grafite sobre o amarelo (inf. esquerdo); @aurizfoods preto sobre amarelo (inf. direito).

**(4) Paleta:** branco, amarelo, preto/grafite, marrom, verde-claro, verde-escuro, laranja.

**(5) Estratégia:** onda amarela → fita flexível + laca; fio preto grosso ondulado → fita dupla flexível + preto (curva suave, caso ideal) ou vinil; logo → mesma solução da lateral (multi-sessão cura+adesivo ou vinil multi-camada); **QR → impresso/vinil eletrônico, jamais pintado**; handle → vinil.

**(6) Fronteiras:** amarelo↔branco original = **T-F**; filete preto = fronteiras suaves via fita flexível; colinas/sol = T-T (cura+adesivo); QR fora da pintura.

**(7) Ordem:** sincronizar com a lateral (mesmas cores/sessões — pintar lateral+traseira juntas): D1 amarelo; cura; fio + 1ª leva de cores do logo; D2 2ª leva + verniz + QR/vinis.

**(8) Extras:** logo centralizado cai na junção das duas folhas da porta — dividir o arquivo de máscara na junção; dobradiças empapeladas; QR em área plana (não sobre friso) e teste de leitura; faixa refletiva.

**(9) Armadilhas:** QR (explosão de micro-regiões); fio preto de espessura variável; sombra leve do mockup na base; mesma família de cores da lateral — reutilizar clusterização entre faces do mesmo job.

---

## 12. AVGLOG lateral.png

**(1)** Lateral de baú seco (transportadora). Chapa com ou sem frisos; arte simples tolera frisos.

**(2)** **Branco ~100% = branco original da chapa. ZERO pintura de fundo.** Todo o trabalho é elemento-sobre-branco.

**(3) Inventário:**
- Logo AVG: triângulo "A" vermelho + barras/triângulos pretos — geometria 100% retilínea (~20% da largura).
- "AVG LOG" preto itálico gigante (~45% da largura).
- "TRANSPORTES" cinza itálico (contorno grosso, vazado).
- Rodapé: site, e-mail, telefone — preto, pequeno.

**(4) Paleta:** vermelho, preto, cinza. 3 cores, 100% chapadas, zero degradês. A arte mais simples do lote.

**(5) Estratégia:**
- Logo: todas as bordas RETAS → **fita de corte** (fita larga + corte manual) é imbatível; vermelho e preto não se tocam (respiros brancos) → sem espera entre cores.
- "AVG LOG": letras grandes itálicas de bordas retas → fita de corte ou máscara plotada + laca preta.
- "TRANSPORTES": cinza, mesma lógica; terceira cor disjunta → mesma jornada.
- Rodapé: vinil preto recortado.

**(6) Fronteiras:** **TODAS T-F** (elemento sobre branco original) — nenhuma fita+corte por fronteira tinta-tinta, nenhuma espera de cura entre cores (nada se toca). Curvas: retas e poucas suaves (G/O). Caso mínimo absoluto.

**(7) Ordem:** lavar → mascarar tudo (fita nas retas, plotter nos G/O) → pintar vermelho + preto + cinza na MESMA sessão (áreas disjuntas) → remover → vinil rodapé → verniz opcional nas áreas pintadas. **1 dia ou menos.**

**(8) Extras:** espelhar no outro lado; letras itálicas atravessam frisos sem problema (bordas retas disfarçam degraus); faixa refletiva; a traseira provavelmente repete o logo (arquivo não fornecido).

**(9) Armadilhas:** quase nenhuma — arte vetorial limpa; antialiasing do itálico pode gerar "cinza fantasma" entre preto e branco; o contorno de "TRANSPORTES" é vazado (contraforma branca interna a preservar).

---

# PADRÕES TRANSVERSAIS

**Padrões recorrentes:**

1. **Traseira = versão condensada da lateral.** Mesma lockup/cores, formato ~quadrado, elementos re-empilhados. Motor: analisar a lateral primeiro e REUSAR paleta/decisões na traseira (mesma batelada de tinta, mesmas máscaras reescaladas; agendar as faces na mesma janela de pintura).
2. **Três arquétipos de fundo:** (a) pintura geral 1 cor (Aquarela azul, Astutilog traseira vermelha, Folly traseira verde); (b) branco original + massas de cor <80% (Argus lateral, Folly lateral, Auriz); (c) branco quase total "só adesivo" (Argus traseira, AVGLOG). O classificador "% da cor dominante + limiar 80% + é-branco?" decide o pipeline inteiro.
3. **QR codes, logos de terceiros (brf, Sadia, Perdigão, Kidelli), logos glossy (Argus) e FOTOS nunca se pintam** → detectar blocos de alta entropia/micro-regiões, rotular "impressão digital", tratar como contorno único e retirar da análise de fronteiras.
4. **Degradês em duas espécies:** (a) degradê de MOCKUP no fundo (vinheta/iluminação de baixa amplitude — achatar para 1 cor); (b) degradê de ELEMENTO (esfera Astutilog, badge Argus, globo brf — reproduzir via impressão/aerografia). Heurística: degradê que cobre a região-fundo inteira com baixa amplitude = mockup; degradê dentro de forma pequena com alta amplitude = real.
5. **Curvas S longas e suaves nas divisas de campos** (Argus, Auriz ×2, swoosh Astutilog) = domínio da **fita amarela flexível**; diagonais/retas (Folly, AVGLOG, barras Atacado Frios) = **fita de corte**; só curvas médias/fechadas de letras/logos justificam plotter; sobreposições curvas de cores = cura 3h + adesivo.
6. **Fios/filetes de 2–5 cm acompanhando curvas** (fio branco Argus, fios pretos Auriz) → técnica de fita dupla paralela; na segmentação são as regiões mais frágeis (somem em thumbnail).
7. **Texto pequeno (contatos, rodapés, handles, "desde XXXX") nunca compensa pintura** → vinil recortado final. Regra: altura de letra < ~6–8 cm ⇒ vinil; acima ⇒ máscara+pintura.
8. **Designers deixam respiros brancos entre cores** (AVGLOG, logo Folly, badge/lettering) — o motor deve detectar o respiro (vira T-F) e NÃO emitir ordem de fita+corte. Cores que realmente se tocam são raras e quase sempre resolvidas com 1 espera de cura (branco sobre fundo geral).
9. **"sider" no filename muda o processo inteiro** (lona: impressão total ou vinílica flexível, produção em bancada, tensores). Filenames carregam substrato ("sider", "PRETO"), comprimento ("14,70", "640") e vista ("lateral/traseira") — **parsear o filename é a etapa 0 do motor**.
10. **Segmento frigorífico (gelo, frios, foods) ⇒ provável isoplastic** ⇒ inserir automaticamente o passo "lixar após aplicação do adesivo".
11. **Traseiras têm portas**: ferragens a empapelar, arte cruzando a junção das folhas (dividir máscara na junção), QR/logos posicionados fora de dobradiças. Toda face traseira ganha esses passos por default.

**Ideias para o motor de análise automática:**

- Pipeline sugerido: (0) parse do filename → vista/substrato/comprimento/cor; (1) detectar e extrair blocos "não-pintáveis" (QR, fotos, logos glossy/terceiros) por entropia local e contagem de cores em janela; (2) quantizar o restante com merge por ΔE tolerante a degradê de mockup; (3) % da cor dominante ⇒ pintura geral (≥80% e ≠branco); (4) classificar cada fronteira: vizinho quase-branco ⇒ T-F; senão T-T + curvatura (reta→fita de corte; suave→fita flexível; média/fechada→plotter ou cura+adesivo); (5) altura de glifo ⇒ vinil vs pintura; (6) montar grafo de dependência de sessões de cor (disjuntas = mesma sessão; sobrepostas = cura 3h entre) e estimar dias/mão de obra.
- Emparelhar lateral+traseira do mesmo cliente (prefixo do filename) para reaproveitar paleta e sincronizar bateladas.
- Flags para revisão humana: fundo cinza-quase-branco (Atacado Frios: cor da frota ou mockup?); pares de faces com fundos diferentes (Astutilog preto×vermelho); presença de logos de terceiros (exigem arquivos oficiais).
