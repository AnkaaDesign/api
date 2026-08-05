# Análise de Produção — Lote E (12 layouts)

Convenções: "adesivo" = adesivo de recorte plotado usado como máscara; "tinta-fundo" = fronteira entre tinta e o branco original da chapa (só máscara, sem corte/fita); "tinta-tinta" = fronteira entre duas cores pintadas (exige fita+corte OU sequência pintar→verniz→cura ~3h→adesivo→próxima cor).

---

## 1. BOIPORÉ lateral.png

1. **Implemento/vista/substrato**: lateral de baú frigorífico (frigorífico ⇒ altíssima chance de baú isoplastic liso refrigerado). Vista lateral completa, proporção longa (~3.5:1).
2. **Fundo**: branco ~75–80% (esquerda/centro) + painel cinza claro ~15–20% na extremidade direita, separados por faixa curva vermelha. O branco é o original da chapa — **sem pintura geral**. O cinza da direita É pintado.
3. **Inventário**: (a) boi em line-art cinza-escuro (traços caligráficos, ~60% da altura, grande); (b) "FRIGORÍFICO BOIPORÉ" em bloco vermelho escuro (elemento dominante); (c) tagline script "Qualidade em Alimentos!" cinza-escuro (traços finos); (d) faixa curva vermelha ~15cm de largura acompanhando a borda do painel cinza; (e) campo cinza claro até a traseira.
4. **Paleta**: 3 cores chapadas — vermelho escuro (tipo bordô), cinza-escuro (quase preto), cinza claro. Sem degradês, sem metálicos.
5. **Estratégia por elemento**:
   - Boi line-art + tagline script: adesivo de recorte plotado sobre o branco (só tinta-fundo). Traços finos do script exigem plotagem cuidadosa, mas viável em laca.
   - Texto "FRIGORÍFICO BOIPORÉ": adesivo de recorte, laca vermelha. Letras bold retas — corte fácil.
   - Campo cinza claro: máscara grande + laca cinza (fronteira com branco = só adesivo).
   - Faixa curva vermelha: a fronteira interna (vermelho×cinza) é tinta-tinta em curva longa e suave → **fita amarela flexível** é ideal; a fronteira externa (vermelho×branco) é tinta-fundo.
6. **Fronteiras**:
   - Tinta-tinta: vermelho×cinza claro ao longo da curva (curva **suave**, raio grande) → fita amarela flexível compensa; alternativa: pintar cinza→verniz→cura→adesivo→vermelho.
   - Tinta-fundo: todas as letras, boi, tagline, e a borda esquerda da faixa vermelha — só adesivo.
7. **Camadas/ordem**: Dia 1: (se isoplastic) aplicar adesivo geral da região e **lixar superfície exposta**; 1) cinza claro do painel; 2) cinza-escuro (boi+tagline) — regiões não se tocam, mesmo dia com máscaras separadas; 3) fita amarela na divisa curva; 4) vermelho (faixa+texto). Verniz final sobre tudo. Total: 1–1,5 dia sem esperas de cura obrigatórias (fita resolve a única tinta-tinta). Atenção: são 2 cinzas distintos (painel claro × boi escuro).
8. **Extras**: se isoplastic — lixamento pós-adesivo obrigatório; sem frisos para empapelar. Arte espelhada no lado oposto (boi deve olhar para a frente nos dois lados). Faixa refletiva de rodapé. Verificar continuidade da curva/painel cinza na quina traseira.
9. **Armadilhas de segmentação**: traços caligráficos do boi têm antialiasing pesado e larguras variáveis (vetorizador quebra o traço); cinza claro do painel × cinza de mockup podem se confundir; a curva vermelha é fina — threshold pode fundi-la com o cinza.

---

## 2. BOM PEIXE 9,50.png

1. **Implemento**: lateral de baú 9,50 m (nome do arquivo). Frigorífico de pescado ⇒ provável isoplastic liso. Vista lateral, arte centrada.
2. **Fundo**: branco ~85%, **original da chapa** — sem pintura geral. Toda a produção é logo central + tagline.
3. **Inventário**: (a) logo-peixe grande (~70% da altura): letras "BOM PEIXE" azul-marinho formando o corpo do peixe, contorno de boca/nadadeira/cauda em vermelho, 4 bolhas azuis à esquerda, símbolo ® pequeno; (b) tagline "Qualidade e confiança sempre à mesa" azul (~10% da altura).
4. **Paleta**: 2 cores chapadas — azul-marinho e vermelho. Sem degradês.
5. **Estratégia**:
   - Letras, bolhas e tagline: adesivo de recorte + laca azul (tinta-fundo pura).
   - Detalhes vermelhos (crescente da boca, cauda em X): laca vermelha. **Ponto crítico**: o vermelho toca o azul em várias arestas.
   - 2 cores apenas: pintar azul → verniz → cura ~3h → adesivo por cima nas bordas de contato → vermelho. Alternativa: fita+corte nos poucos contatos (curvas da boca **médias/fechadas**; pontas da cauda **extremas** — corte manual arriscado).
   - ®: muito pequeno para pintura — omitir ou vinil recortado definitivo.
6. **Fronteiras**:
   - Tinta-tinta: azul×vermelho na boca (curva **fechada**) e na cauda (pontas **extremas**) → cura+adesivo em vez de fita+corte (pontas agudas rasgam o corte manual).
   - Tinta-fundo: ~90% do perímetro (letras sobre branco, bolhas, contorno externo do vermelho) — só adesivo.
7. **Camadas/ordem**: Dia 1: adesivo geral + lixamento (isoplastic); laca azul; verniz sobre o azul; cura 3h (mesmo dia à tarde) → mascarar azul → vermelho. Dia 2: verniz final geral. Fita+corte nas 3–4 zonas de contato elimina a espera se a agenda apertar.
8. **Extras**: arte espelhada no lado oposto (peixe nada para a frente). Portas traseiras com versão reduzida. Faixa refletiva rodapé.
9. **Armadilhas**: o vermelho aparece só como filetes finos entre azul e branco — segmentação por cor pode absorvê-lo no antialiasing azul→branco; o ® é ruído de 3–4 px; bolhas pequenas confundidas com ruído.

---

## 3. BOX DA TERRA-final.png

1. **Implemento**: lateral de baú (hortifruti ⇒ baú refrigerado provável, isoplastic). Vista lateral longa.
2. **Fundo**: branco ~40–45% (metade esquerda + vãos entre vegetais). É o branco original **e** funciona como cor de desenho (keylines brancas dentro dos vegetais). **Sem pintura geral** — mas mais da metade da superfície recebe tinta.
3. **Inventário**: (a) logo pequeno à esquerda: cenoura ilustrada com galhos/folhinhas finas + "BOX DA TERRA" verde-oliva + "· HORTIFRUTI ·" (~40% da altura, detalhado); (b) composição gigante à direita: rabanete/pitaia vermelho-pink, cenoura laranja (com **mancha de tom mais escuro** = sombreado sutil), beterraba roxa, folhas verdes grandes com nervuras brancas — flat vector cortado pelas bordas.
4. **Paleta**: vermelho-pink, laranja (2 tons), roxo/magenta (2 tons), verde claro (folhas), verde-oliva (texto), branco (nervuras/keylines = chapa). ~6–7 cores efetivas.
5. **Estratégia**:
   - Insight-chave: **quase todas as divisões entre vegetais são separadas por keylines/nervuras brancas** — chapa aparecendo. Isso converte fronteiras tinta-tinta em duas fronteiras tinta-fundo. Adesivo resolve quase tudo.
   - Cada vegetal: máscara própria + laca chapada. Curvas orgânicas grandes → plotter corta fácil.
   - Sombras de 2º tom: (i) simplificar para 1 tom (recomendado), (ii) 2ª máscara + 2º tom (fronteira tom×tom **suave** → fita amarela ou cura+adesivo), ou (iii) aerografia leve com stencil solto.
   - Logo pequeno da esquerda (galhos finos): adesivo de recorte viável se >80cm; senão **impressão digital** aplicada.
   - Texto verde-oliva: adesivo + laca.
6. **Fronteiras**:
   - Tinta-fundo (dominante): contornos externos de todos os vegetais, nervuras internas, letras.
   - Tinta-tinta (poucas): eventuais contatos folha×cenoura sem keyline (curvas **suaves** → fita fina); tons de sombra no mesmo vegetal (**suave** longa) → fita amarela ou cura+adesivo.
7. **Camadas/ordem**: Dia 1: adesivo geral + lixamento; todas as cores que não se tocam em sessões sequenciais no mesmo dia (vermelho → laranja → roxo → verdes; laca seca rápido). Dia 2 (se houver 2º tom): fita ou cura, tons de sombra; verniz final. 1,5–2 dias.
8. **Extras**: lado oposto espelhado (decidir qual borda ancora a composição); lixamento isoplastic; faixa refletiva; folhas morrem na moldura superior — empapelar friso.
9. **Armadilhas**: nervuras brancas finas somem em threshold agressivo; 2 tons de laranja com ΔE baixo — clusterização funde; branco entre folhas é fundo, não figura (confusão figura/fundo na borda superior).

---

## 4. BRAVO traseira.png

1. **Implemento/vista**: **traseira** de baú — portas duplas (arte contínua atravessando a divisão central). Chapa com dobradiças, fechos e batentes verticais.
2. **Fundo**: cinza muito claro ~50% (metade inferior) — tratar como chapa original branca (se for cinza pintado de fato, muda para pintura geral — confirmar com cliente). Metade superior tomada pelo chevron.
3. **Inventário**: (a) chevron gigante apontando para baixo, cinza-escuro **com degradê metálico** (bisel claro→escuro por face) + banda verde **em degradê** (limão→escuro) em diagonal; (b) 2 selos octogonais vermelhos "VEÍCULO RASTREADO VIA SATÉLITE"; (c) "VELOCIDADE MÁXIMA CONTROLADA" + roundel 80 km/h; (d) "COMO ESTOU DIRIGINDO?" + telefone; (e) logo BRAVO: setas em camadas verde/cinza **com degradês** + "BRAVO" cinza bold + "logística" espaçado; (f) logo Kovell (degradê verde→azul).
4. **Paleta**: cinza-escuro (rampa), cinza médio, verde (rampa), vermelho, branco, preto. Degradês em todos os elementos gráficos grandes.
5. **Estratégia**:
   - Chevron + banda verde: rampas grandes e direcionais → **aerografia** com máscaras de adesivo definindo as arestas (cada face mascarada, degradê aerografado dentro). Alternativa econômica: achatar para tons chapados (negociar).
   - Faces do chevron entre si: arestas **retas** = fita de corte fácil ou máscaras sequenciais.
   - Banda verde sobre cinza: tinta-tinta **reta/diagonal** → fita; degradê interno via aerografia.
   - Logo BRAVO: texto = adesivo+laca cinza (tinta-fundo). Setas com degradês pequenos → aerografia com stencils ou simplificar para 2 verdes + 2 cinzas chapados (fronteiras **retas** → fita).
   - Selos rastreamento + roundel 80 + Kovell: pequenos, multicoloridos, detalhe fino → **impressão digital** (padrão de mercado para selos regulamentares).
   - Textos pretos: adesivo+laca ou vinil.
6. **Fronteiras**:
   - Tinta-tinta: face×face do chevron (**retas** — fita trivial); verde×cinza (**retas** — fita). Degradês internos não são fronteiras (aerografia contínua).
   - Tinta-fundo: contorno inferior do chevron sobre a chapa, letras, roundel.
7. **Camadas/ordem**: Dia 1: mascarar; aerografar faces cinza (uma máscara por face); Dia 2: verniz+cura OU fita nas arestas → banda verde aerografada; logo BRAVO; Dia 3: textos pretos, aplicação dos impressos, verniz final. ~3 dias.
8. **Extras**: **portas traseiras**: empapelar dobradiças, fechos, maçanetas e borrachas; arte cruza o vão central — alinhar as duas folhas com a arte fechada e prever perda no vão; para-choque e faixa refletiva traseira (norma); selos repetem nas laterais.
9. **Armadilhas**: degradê cinza→claro contra fundo cinza-claro = fronteira de baixo contraste (segmentador vaza); degradê verde cruza luminâncias iguais ao cinza (cluster mistura); selos com texto de 2 px viram borrão; a divisão física das portas não existe no arquivo — motor deve saber que traseira = 2 metades.

---

## 5. BRAVO.png (lateral)

1. **Implemento**: lateral de baú longa (~3.2:1). Mesma identidade do item 4.
2. **Fundo**: cinza claríssimo ~85% — tratar como chapa original (mesma ressalva). Sem pintura geral.
3. **Inventário**: (a) meio-chevron na borda esquerda (degradês cinza+verde, sangrando); (b) logo BRAVO central grande; (c) Kovell pequeno; (d) 2 selos octogonais vermelhos minúsculos no topo.
4. **Paleta**: idêntica ao item 4.
5. **Estratégia**: idêntica: chevron = máscaras por face + aerografia (ou achatar); texto = adesivo+laca; setas = aerografia com stencil ou chapado; selos e Kovell = impressão digital.
6. **Fronteiras**: chevron: arestas **retas** tinta-tinta → fita; contorno direito do chevron sobre chapa = tinta-fundo; sobreposições internas das setas (**retas curtas**) → fita ou cura.
7. **Camadas/ordem**: Dia 1: faces cinza aerografadas; Dia 2: verde (fita nas arestas), texto cinza laca; impressos; verniz final. ~2 dias.
8. **Extras**: espelhar (chevron na frente do baú nos dois lados ⇒ lado direito recebe chevron na borda direita); alinhamento com a quina frontal; faixa refletiva.
9. **Armadilhas**: mesmas do item 4; selos de ~30 px ilegíveis — motor deve marcá-los como "elemento impresso padrão", não vetorizar.

---

## 6. BURES 1.png

1. **Implemento**: lateral de baú (~3.5:1), chapa lisa ou com frisos leves.
2. **Fundo**: branco ~75% original. Sem pintura geral.
3. **Inventário**: (a) banda vertical ondulada na borda esquerda: **degradê dourado** (âmbar no topo → bege claro embaixo) + filete branco + faixa azul-marinho ondulada; (b) logo grande: rosácea/bússola azul-marinho atravessada por estrela de 4 pontas douradas **muito agudas**; "BURES" com BU azul e RES dourado; "TRANSPORTE & LOGÍSTICA" cinza espaçado.
4. **Paleta**: azul-marinho, dourado/âmbar (degradê na banda; chapado no logo), cinza. Dourado simulado por degradê, não metálico real.
5. **Estratégia**:
   - Banda: máscara da silhueta + **aerografia** do degradê âmbar→claro (rampa longa vertical = caso clássico). Faixa azul: adesivo+laca (o filete branco entre elas é chapa ⇒ ambas as bordas viram tinta-fundo!).
   - Rosácea: laca azul. Estrela dourada: pontas **extremas** — corte manual impossível; cura+adesivo: azul → verniz → cura 3h → adesivo da estrela → dourado. Pontas finíssimas podem falhar em laca → considerar vinil dourado definitivo só para a estrela.
   - "BURES": adesivo+laca (azul e dourado em máscaras separadas; se BU toca RES, tinta-tinta **reta** curta → fita trivial).
   - Tagline cinza: adesivo+laca.
6. **Fronteiras**:
   - Tinta-tinta: estrela × rosácea (**pontas extremas** → cura+adesivo obrigatório); eventual BU×RES (**reta** → fita).
   - Tinta-fundo: banda ondulada (ambos os lados, graças ao filete branco), letras, tagline.
7. **Camadas/ordem**: Dia 1: máscara geral; aerografia do degradê; laca azul (faixa + rosácea + BU + cinza da tagline em máscara própria); verniz na rosácea; cura 3h → adesivo da estrela → dourado (junto com RES). Verniz final dia 2. ~1,5–2 dias.
8. **Extras**: espelhar (banda acompanha a frente); a onda deve casar com a quina dianteira; faixa refletiva; se houver frisos, empapelar molduras — degradê atravessa friso com quebra visual aceita.
9. **Armadilhas**: degradê âmbar→quase-branco: borda inferior invisível (degradê morre no branco da chapa) — fechar silhueta pelo vetor, não pela cor; pontas da estrela de 1–2 px somem; filete branco fino funde as duas faixas em um blob no threshold.

---

## 7. BURES 2.png

1. **Implemento**: lateral de baú (~3.5:1) — variação da mesma frota (truck menor?).
2. **Fundo**: branco ~60–65% original. Sem pintura geral.
3. **Inventário**: (a) logo BURES grande centralizado (rosácea+estrela+letras bicolores, maior que no item 6); (b) telefone "(65) 99281-0087" itálico azul bold; (c) rodapé: **três ondas entrelaçadas** varrendo toda a largura — dourada, azul-marinho e azul-escuro-profundo, cruzando-se, com filetes brancos em trechos e contato direto em outros.
4. **Paleta**: azul-marinho, azul quase-preto (**2º azul!**), dourado (leve rampa), cinza. 4 cores + branco da chapa.
5. **Estratégia**:
   - Logo: idêntico ao item 6 (cura+adesivo para a estrela).
   - Telefone: adesivo+laca azul.
   - Ondas: curvas **longas e suaves** — caso ideal de **fita amarela flexível** nas divisas tinta-tinta. Onde há filete branco, vira tinta-fundo. **Cruzamentos** geram cunhas finas → cura+adesivo local ou corte muito cuidadoso.
   - Dois azuis próximos: exigir dois códigos de tinta distintos.
6. **Fronteiras**:
   - Tinta-tinta: dourado×azul e azul×azul-escuro nas ondas (**suaves** → fita amarela); cunhas nos cruzamentos (**fechadas** → cura+adesivo local); estrela×rosácea (**extrema** → cura+adesivo).
   - Tinta-fundo: topo das ondas contra o branco, logo, telefone.
7. **Camadas/ordem**: Dia 1: laca azul-marinho (rosácea, BU, telefone, onda azul); fita amarela nas divisas → dourado (RES, onda dourada); Dia 2: azul-escuro (fita na divisa com o marinho); estrela via cura noturna+adesivo; verniz final. ~2 dias.
8. **Extras**: espelhamento; ondas descem até saia/para-lama — definir corte; faixa refletiva × onda (posicionar refletivo após verniz); traseira compacta.
9. **Armadilhas**: azul-marinho × azul-escuro com ΔE baixíssimo — clusterizadores fundem os dois; cunhas dos cruzamentos geram polígonos-fiapo; leve rampa no dourado dispara falsa detecção de degradê.

---

## 8. CARLOTTI carreta.png

1. **Implemento**: lateral de **carreta** — proporção ~6:1; carga seca com frisos verticais leves ou sider (se sider ⇒ tudo vira lona impressa; assumo chapa).
2. **Fundo**: branco ~90% original. Sem pintura geral. Arte 100% tipográfica.
3. **Inventário**: (a) "TRANS" cinza pequeno com filetes; (b) "CARLOTTI" serifado gigante violeta, com **"R" espelhado (Я) em cinza**; (c) "Transportes e Logística" cinza; (d) selo "20 Anos - desde 2001" script azul-marinho no canto direito; (e) **bloco de texto espelhado** no canto esquerdo (Tupã-SP / (14) 3491-3900 / www.carlotti.com.br) — o arquivo é template de um lado; produção deve gerar o par com o texto de contato LEGÍVEL.
4. **Paleta**: violeta, cinza médio, azul-marinho (selo). 3 cores chapadas, zero degradê.
5. **Estratégia**: tudo é letra sobre branco ⇒ **adesivo de recorte plotado + laca** — o caso mais simples possível. Serifas finas em ~1m de altura cortam sem problema. Я cinza: se encosta nas letras violetas, tinta-tinta **reta** → fita simples; se há respiro, tinta-fundo. Selo "20 Anos": adesivo+laca se ≥40cm, senão vinil/impresso. Corrigir o espelhamento do contato antes de plotar.
6. **Fronteiras**: praticamente só tinta-fundo. Única possível tinta-tinta: Я×letras violetas (**retas** curtas → fita trivial).
7. **Camadas/ordem**: Dia 1 único: adesivo; laca cinza (TRANS, Я, tagline); laca violeta (CARLOTTI); azul do selo — cores não se tocam; verniz final. **1 dia**. Arte mais barata do lote.
8. **Extras**: carreta = 2 laterais + traseira; letras gigantes atravessam frisos verticais — empapelar molduras; gerar par espelhado correto (textos NUNCA espelham); traseira com versão reduzida (dobradiças/fechos empapelados).
9. **Armadilhas**: texto espelhado engana OCR — motor deve detectar espelhamento como flag "arquivo = um dos lados"; serifas finas + antialiasing = contornos serrilhados; violeta vs azul-marinho próximos em matiz.

---

## 9. CASA DO PÃO DE QUEIJO.png

1. **Implemento**: lateral de baú (~3.2:1), provável isoplastic (perecíveis).
2. **Fundo**: **zero branco original**: vermelho ~55% + amarelo-ouro ~45%, divididos por diagonal curva. ≥80% da superfície ≠ branco ⇒ **PINTURA GERAL em duas cores** (lavar, empapelar molduras/frisos, fundo laca em cor próxima, cores finais, verniz).
3. **Inventário**: (a) fotos de produtos (esfihas, pães de queijo, salgados, coxinha gigante cortada) — **fotográficas**; (b) script branco "Deliciosos e" com raios amarelos; (c) "ORIGINAIS" amarelo bold; (d) ribbon vermelho-claro com site branco; (e) badge 3D circular "Casa do Pão de Queijo & Cia" com aro glossy, foto interna, brilhos; (f) círculo pontilhado branco decorativo.
4. **Paleta**: vermelho, amarelo-ouro, branco, vermelho claro + **gama fotográfica completa** (impossível em laca).
5. **Estratégia**:
   - Fundos: pintura geral bicolor. Divisa vermelho×amarelo: curva **suave** longa → fita amarela flexível, ou amarelo geral → cura → máscara → vermelho.
   - Fotos + badge 3D: **impressão digital** aplicada sobre pintura curada — sem alternativa em tinta.
   - Letterings sobre fundo pintado = tinta-tinta em todo o perímetro; script fino não compensa corte → incluir no material impresso OU laca branca/amarela com máscara após cura.
   - Recomendação: pintar só os 2 fundos; TODO o resto sai em impressão digital recortada — reduz o job de ~5 para ~4 dias e elimina riscos.
6. **Fronteiras**:
   - Tinta-tinta: vermelho×amarelo na diagonal (**suave** → fita amarela); se letterings pintados: branco×vermelho em script (**fechadas finas** → nem fita nem corte compensam; cura+adesivo delicado ⇒ reforça a opção impressa).
   - Tinta-fundo: nenhuma — não sobra chapa branca.
7. **Camadas/ordem**: Dia 1: lavar, lixar (isoplastic), empapelar, fundo laca; Dia 2: amarelo geral direito; cura; fita na diagonal; vermelho esquerdo; Dia 3: verniz geral, cura overnight; Dia 4: aplicação dos impressos. ~4 dias.
8. **Extras**: empapelamento completo (pintura geral); lixamento isoplastic; lado oposto espelhado (badge e coxinha trocam de lado); definir cor de frente/traseira; faixa refletiva sobre o vermelho.
9. **Armadilhas**: meio-foto-meio-vetor — segmentador de cores chapadas explode nas regiões fotográficas; brilhos/sombras 3D do badge não são cores de produção; sombras projetadas criam vermelhos escurecidos falsos; motor deve classificar regiões fotográficas como "impressão digital" e excluí-las da análise de fronteiras.

---

## 10. CASA DO QUEIJO.png

1. **Implemento**: lateral de baú (~3.4:1), perecíveis ⇒ provável isoplastic.
2. **Fundo**: branco ~55% original (metade superior). Metade inferior: onda azul-royal + filete amarelo + rodapé azul (~40% da área) — pintado, mas <80% ⇒ **sem pintura geral**.
3. **Inventário**: (a) logo central: lozenge amarelo arredondado com contorno verde, casa/telhado verde com queijo amarelo (furos), "CASA DO QUEIJO" verde condensado; (b) tagline "TRADIÇÃO E SABOR À SUA MESA" azul; (c) badge canto sup. esq. "TRANSPORTE DE PRODUTOS PERECÍVEIS" contorno azul; (d) onda azul com **filete amarelo ondulado interno** + rodapé azul com site/redes em branco e amarelo + ícones (globo, Instagram, Facebook).
4. **Paleta**: azul-royal, amarelo, verde bandeira, branco. 4 cores chapadas, zero degradê.
5. **Estratégia**:
   - Onda + rodapé: adesivo na borda superior (tinta-fundo) + laca azul.
   - Filete amarelo dentro do azul: tinta-tinta dos dois lados em curva **suave** → 2 fitas amarelas paralelas; ou amarelo em faixa larga primeiro, cura, mascarar filete, azul por cima.
   - Logo: amarelo (lozenge+queijo) → verniz → cura 3h → adesivo → verde (contornos/letras/telhado). Contorno concêntrico com curvas **médias** → cura+adesivo mais seguro que fita+corte.
   - Tagline + badge: adesivo+laca azul.
   - Textos/ícones do rodapé: **máscara negativa** — aplicar as letras em adesivo ANTES do azul e remover depois (letras = branco da chapa); amarelos e ícones pequenos em vinil.
6. **Fronteiras**:
   - Tinta-tinta: verde×amarelo no logo (**médias** → cura+adesivo); amarelo×azul no filete (**suave** → fita amarela); textos sobre rodapé azul → máscara negativa converte em "chapa revelada".
   - Tinta-fundo: borda superior da onda, lozenge×branco, tagline, badge.
7. **Camadas/ordem**: Dia 1: adesivo geral+lixamento; amarelo (lozenge, queijo, filete em faixa larga); verniz; cura 3h; verde do logo; Dia 2: azul (onda com fitas no filete, rodapé com letras protegidas, tagline, badge); verniz final. ~2 dias.
8. **Extras**: espelhar lado oposto; faixa refletiva × rodapé azul (subir rodapé ou refletivo dentro dele); isoplastic ⇒ lixar; conferir no vetor se há filete branco entre amarelo e verde do lozenge (mudaria fronteiras para tinta-fundo).
9. **Armadilhas**: filete amarelo fino some em baixa resolução; contorno verde do lozenge pode ter filete branco imperceptível; ícones sociais são glifos minúsculos que não devem virar "elementos de pintura".

---

## 11. CAVALCANTE (jamaica).png

1. **Implemento**: faixa lateral muito longa e baixa (~7:1) — testeira/faixa superior de carroceria ("jamaica" = modelo de carroceria/caçamba). Chapa metálica.
2. **Fundo**: **azul-royal 100%** ⇒ **PINTURA GERAL azul** (lavar, empapelar, fundo laca próximo, azul final, verniz se poliéster).
3. **Inventário**: (a) logotype "Transportadora Cavalcante" itálico bold PRETO com **contorno branco** + swoosh preto com "Cruzeiro Do Oeste-Pr" branco + swoosh VERDE por baixo; ® minúsculo; (b) direita: padrão de **cubos 3D tom-sobre-tom** (azul mais escuro sobre o fundo) que **esmaece** para a esquerda.
4. **Paleta**: azul-royal (fundo), azul-escuro (cubos), preto, branco, verde. 5 cores; degradê só no fade do padrão.
5. **Estratégia**:
   - Fundo: pintura geral azul.
   - Cubos tom-sobre-tom: máscara plotada do padrão + azul-escuro em **aerografia leve** — a aerografia resolve o fade (pressão decrescente) sem fronteira dura.
   - Logotype sobre fundo pintado: TODA letra é tinta-tinta. Após cura do azul → adesivo do contorno (silhueta expandida) → laca branca → verniz/cura 3h → adesivo das letras (offset interno) → preto. Registro de 2–3mm entre máscaras é crítico — alternativa realista: **vinil recortado em 2 camadas** (branco+preto) se o prazo apertar.
   - Swoosh verde: máscara + laca (curva **suave** contra azul → fita ou cura).
   - "Cruzeiro Do Oeste-Pr" branco sobre preto: máscara negativa antes do preto (letras preservam a camada branca anterior).
6. **Fronteiras** (todas tinta-tinta — não há chapa aparente):
   - Branco×azul (contorno): curvas **médias/fechadas** de tipografia itálica → cura+adesivo.
   - Preto×branco (letra no contorno): idem, registro fino → cura+adesivo.
   - Verde×azul e preto×verde nos swooshes: **suaves** → fita amarela flexível.
   - Azul-escuro×azul (cubos): aerografia com stencil (fade sem fronteira dura).
7. **Camadas/ordem**: Dia 1: preparação + pintura geral azul; Dia 2 (cura overnight): stencil dos cubos + aerografia; máscara do contorno → branco; verniz 3h; Dia 3: máscara letras → preto (com "Cruzeiro..." protegido); fita → verde; verniz final. **~3 dias**.
8. **Extras**: empapelamento total; padrão de cubos repete no lado oposto (espelhar o fade, NÃO a tipografia); verificar frisos/travessas que quebram o padrão; faixa refletiva.
9. **Armadilhas**: tom-sobre-tom com contraste baixíssimo — segmentação por cor perde o padrão inteiro; o fade é degradê de OPACIDADE (vetorizadores geram centenas de shapes espúrios); contorno branco de 2–4 px em itálico gera fiapos; ® ilegível.

---

## 12. CIPRIANO.png

1. **Implemento**: faixa lateral longa e baixa (~7:1) — testeira/faixa de sider ou saia de carroceria (mesma família do item 11).
2. **Fundo**: **laranja 100%** ⇒ **PINTURA GERAL laranja** (lavar, empapelar, fundo em cor próxima, laranja final, verniz).
3. **Inventário**: (a) logo: quadrado arredondado dividido em diagonal — metade off-white, metade cinza-escuro, com "estrada" laranja em curva formando um C (o laranja da estrada = o próprio fundo!); (b) "CIPRIANO" cinza-escuro bold; (c) "CAMINHÕES & TRANSPORTES" pequeno espaçado; (d) direita: **mapa do Brasil preenchido com foto de bandeira tremulando** (dobras, gradientes fotográficos).
4. **Paleta**: laranja (fundo), off-white, cinza-escuro + gama fotográfica da bandeira.
5. **Estratégia**:
   - Fundo: pintura geral laranja.
   - Logo: após cura → adesivo → branco → cura/verniz → adesivo → cinza-escuro. A "estrada" laranja interna é máscara que PRESERVA o fundo já pintado (adesivo como negativo).
   - "CIPRIANO" + tagline: adesivo + laca cinza sobre laranja curado (letras bold — máscara simples).
   - Mapa/bandeira: **impressão digital** recortada no contorno do mapa, aplicada sobre o laranja curado.
6. **Fronteiras** (fundo pintado ⇒ tudo tinta-tinta exceto laranja preservado):
   - Cinza×laranja (letras): curvas **médias** de tipografia bold → cura+adesivo (uma cura resolve tudo).
   - Branco×cinza na diagonal do logo: **reta** → fita trivial ou máscaras sequenciais.
   - Branco/cinza×laranja da estrada: **suaves/médias** → máscara negativa sobre o laranja curado (sem fita).
   - Contorno do mapa: borda do adesivo impresso (sem pintura).
7. **Camadas/ordem**: Dia 1: preparação + laranja geral; cura overnight; Dia 2: branco do logo; verniz 3h; cinza-escuro (logo + CIPRIANO + tagline); Dia 3: verniz final + aplicação do mapa impresso. **~2,5–3 dias**.
8. **Extras**: empapelamento; lado oposto espelhado em posição (logo à frente nos dois lados; tipografia não espelha); bordas horizontais retas da faixa fitadas contra frisos; bandeira impressa com laminação UV (verniz sobre impresso pode manchar — testar).
9. **Armadilhas**: a estrada laranja DENTRO do logo tem a mesma cor do fundo — segmentador conecta o interior do logo ao fundo (buraco topológico); bandeira fotográfica = milhares de clusters (classificar como "foto ⇒ impressão digital"); off-white vs branco puro — diferença sutil que threshold ignora.

---

# PADRÕES TRANSVERSAIS

## Padrões recorrentes nas artes
1. **Fundo branco domina** (9 de 12 artes): a chapa branca original é a "cor" majoritária e o trabalho é logo central + faixas decorativas ⇒ o caso base do motor é "elementos sobre chapa" (só adesivo, sem fita), não pintura geral.
2. **Pintura geral aparece em faixas estreitas e marcas de consumo** (CAVALCANTE azul, CIPRIANO laranja, CASA DO PÃO bicolor): quando ocorre, TODA fronteira vira tinta-tinta e o cronograma ganha +1 dia de preparação + curas overnight.
3. **Faixas/ondas decorativas de borda** (BOIPORÉ, BURES 1/2, CASA DO QUEIJO): curvas longas e suaves — caso ideal de fita amarela flexível. Frequentemente há **filete branco separador** que converte tinta-tinta em 2× tinta-fundo — o motor deve detectar keylines brancas como "chapa aparente" e zerar o custo da fronteira.
4. **Keyline branca como separador é truque de design recorrente** (BOX DA TERRA nervuras, BURES filete, CAVALCANTE contorno): quando o branco é chapa, barateia; quando o fundo é pintado (CAVALCANTE), o mesmo contorno vira a fronteira mais cara do job (2 máscaras + registro fino).
5. **Elementos regulamentares/pequenos repetidos** (selos "veículo rastreado", 80 km/h, ®, ícones sociais, "20 anos"): nunca pintar — classificar como impressão digital/vinil pronto. Heurística: área < ~0,3% da arte + multicolor + texto pequeno.
6. **Regiões fotográficas** (CASA DO PÃO produtos+badge, CIPRIANO bandeira): sempre impressão digital aplicada após pintura curada. Detecção: histograma local com centenas de tons = foto.
7. **Degradês em identidades corporativas** (BRAVO chevron/setas, BURES banda, CAVALCANTE fade): três respostas em ordem de custo — (i) achatar para tom chapado (negociar), (ii) aerografia com máscaras nas arestas, (iii) imprimir o elemento. Rampas grandes e direcionais = aerografia; degradê em logo pequeno = achatar ou imprimir.
8. **Duas cores quase iguais na mesma arte** (BURES 2 dois azuis, BOX DA TERRA dois laranjas, CAVALCANTE tom-sobre-tom): risco de fusão na segmentação E na compra de tinta — reportar pares com ΔE baixo como alerta explícito.
9. **Espelhamento L/R é regra**: animais/peixes/setas "apontam para a frente" nos dois lados; textos NUNCA se espelham (CARLOTTI traz o erro no próprio arquivo — contato invertido). Traseira = arte dividida em 2 portas com perda no vão central.
10. **Pontas agudas (estrelas, caudas, cunhas de ondas cruzadas)**: regra prática — reta/suave ⇒ fita; média ⇒ julgamento; fechada/extrema ⇒ cura ~3h + adesivo (ou vinil definitivo).

## Ideias para o motor de análise automática
- **Pipeline**: (1) % de branco-chapa (com tolerância para cinza-claro de mockup) → decide pintura geral; (2) segmentar foto vs vetor (entropia de cor local) → foto = impressão digital, excluir das fronteiras; (3) quantizar cores com merge protegido por alerta ΔE; (4) extrair fronteiras e classificar cada aresta: toca branco-chapa? → adesivo; senão medir raio mínimo de curvatura → fita (reta/suave) vs cura+adesivo (fechada/extrema); (5) grafo de dependência de camadas → estimar dias somando curas 3h/overnight; (6) flags: texto espelhado (comparar OCR normal vs flip), elementos <0,3% multicolor (→ impresso), keylines brancas finas (analisar em resolução original, dilatar antes do threshold), degradês (rampa monotônica em LAB → aerografia).
- **Armadilhas globais**: antialiasing cria tons fantasma em toda fronteira (limpar antes de quantizar); degradê que morre no branco não tem borda detectável (BURES) — fechar silhueta pela máscara do vetor; fundo cinza-claríssimo de mockup ≠ cinza pintado (BRAVO) — pedir confirmação humana quando o "branco" estiver fora de tolerância; filetes de 1–3 px somem em downscale.
- **Saída por arte**: lista de camadas ordenada com técnica + fronteiras críticas + nº de curas + estimativa de dias + BOM (m² de adesivo, m de fita, cores de laca com código, m² de impressão digital).
