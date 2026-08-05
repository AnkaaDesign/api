# Análise de Produção — Lote F (casos canônicos de referência)

Convenções usadas:
- **T-T** = fronteira tinta-tinta (exige fita+corte OU cura ~3h + adesivo por cima)
- **T-F** = fronteira tinta-fundo-original (branco da chapa preservado sob adesivo; NÃO gera corte nem fita)
- Curvas: reta / suave / média / fechada / extrema

---

## 1. CJ PILGER.png

### 1) Implemento / vista / substrato
Arte de proporção ~3,5:1 — lateral de baú. Fundo 100% branco liso no layout, sem indicação de frisos; provável chapa lisa branca (ou isoplastic — se isoplastic, lembrar do lixamento pós-adesivo). Sem mockup: é arte vetorial pura.

### 2) Fundo
Branco ~85–88% da superfície. **Branco original da chapa — NÃO há pintura geral.** Todo o trabalho é elemento sobre fundo preservado.

### 3) Inventário de elementos
- Monograma "CJ" circular (~25% da altura útil): anel/letra em verde escuro envolvendo uma laranja estilizada em corte (gomos) na cor laranja, com folhas verdes no topo.
- "Pilger" em script cursivo preto, grande (~40% da largura), traços conectados com variação fina/grossa.
- "Citricultura    Comércio" em laranja, texto pequeno reto.

### 4) Paleta
3 cores chapadas: verde escuro, laranja, preto. **Sem degradês, sem metálicos, sem sombras.** Caso ideal para laca + adesivo de recorte.

### 5) Estratégia por elemento
- **"Pilger" (script preto)**: adesivo de recorte plotado + pintura laca preta. Só toca o branco → máscara única, zero corte manual. As curvas do script são fechadas em alguns laços, mas como a fronteira é T-F, o plotter resolve tudo.
- **"Citricultura Comércio" (laranja)**: mesma máscara plotada (mesma demão de laranja da fruta — economiza uma cor/dia).
- **Monograma**: é o único ponto com T-T. Os gomos da laranja têm frestas BRANCAS entre si (fundo preservado → T-F, plotter). Mas a fruta laranja encosta no anel verde por dentro, e as folhas verdes encostam na fruta. Curvas fechadas/extremas (pontas dos gomos, estrela central, recortes das folhas) → **cortar fita na chapa seria inviável; usar cura+adesivo**: pintar todo o miolo em laranja, envernizar, curar ~3h (ou overnight), aplicar máscara plotada do verde por cima e pintar o verde.

### 6) Fronteiras
| Fronteira | Tipo | Curva | Solução |
|---|---|---|---|
| Preto (Pilger) × branco | T-F | fechada (script) | só adesivo plotado |
| Laranja (textos, gomos) × branco | T-F | suave/fechada | só adesivo plotado |
| Verde (anel, folhas) × branco | T-F | média | só adesivo plotado |
| Laranja (fruta) × verde (anel/folhas) | **T-T** | fechada/extrema | **cura + adesivo por cima** (fita+corte inviável) |

### 7) Camadas e ordem sugerida
- **Dia 1 manhã**: aplicar máscara geral; pintar LARANJA (fruta — só onde é laranja + margem de segurança sob o verde; o verde cobre a margem). Pintar também "Citricultura Comércio". Verniz localizado no laranja.
- **Dia 1 tarde (após ~3h de cura)**: aplicar 2ª máscara plotada registrada por cima do laranja curado; pintar VERDE (anel + folhas). Na mesma janela, pintar PRETO do "Pilger" (independente, só T-F — pode até ser de manhã em paralelo, preto e laranja não se tocam).
- **Dia 2**: remover máscaras, retoques, verniz final sobre tudo.
- Total: **1,5–2 dias** por lado.

### 8) Processos extras
- Elemento repetido nos dois lados (script NÃO se espelha — mesma orientação, reposicionar).
- Se baú isoplastic: lixar superfície dentro das janelas da máscara antes de pintar.
- Registro entre as duas máscaras do monograma é crítico (marcas de registro no plotter).

### 9) Armadilhas para segmentação automática
- Antialiasing nas bordas do script (pixels cinza entre preto e branco) pode gerar "cor fantasma".
- As frestas brancas finas entre gomos da laranja podem ser lidas como "linha branca pintada" quando são fundo preservado.
- Estrela central da laranja: vértices extremos — vetorização tende a arredondar; para máscara plotada precisa manter os bicos.

---

## 2. CLEBIN lateral.png

### 1) Implemento / vista / substrato
Lateral de baú ~3:1. Baú frigorífico de distribuidora de frios → **muito provavelmente isoplastic** (liso, sem frisos): corte facilitado, mas exige **lixamento da superfície nas janelas do adesivo** antes de pintar.

### 2) Fundo
Branco ~75–80%. **Branco original — sem pintura geral.** Áreas pintadas: banner diagonal do canto sup. esquerdo, barra inferior corrida, logo e ícones.

### 3) Inventário
- Banner de canto sup. esq. bordô com corte diagonal, texto branco "clebin.com.br" (~8% da área).
- Logotipo CLEBIN grande no centro-esquerda: letras arredondadas cinza-escuro/grafite, arcos "swoosh" em bordô, amarelo e preto envolvendo o "n", ® pequeno, "Distribuidora de Frios" em cinza fino.
- "Entrega ágil e rápida!" em cinza-escuro bold (2 linhas).
- Fileira de 6 selos quadrados arredondados bordô com pictogramas brancos em linha (galo, porco, boi, peixe, fábrica, pote) + micro-rótulos pretos embaixo (AVES, SUÍNOS, BOVINOS, PESCADOS, INDUSTRIALIZADOS, LATICÍNIOS).
- Barra inferior corrida bordô full-width: "Umuarama - Pr" e "(44) 3622-3000" em branco.

### 4) Paleta
3 cores chapadas: bordô (vinho), amarelo, cinza-escuro/grafite (quase preto). Sem degradê. Brancos = sempre fundo reservado.

### 5) Estratégia por elemento
- **Barra inferior bordô com textos brancos**: aplicar adesivo plotado dos TEXTOS (letras brancas viram fundo preservado), delimitar a faixa reta com fita de corte (reta → fita é trivial e mais rápida que plotar 11 m de borda), pintar bordô por cima. Remover adesivo → texto branco perfeito, **zero pintura branca**.
- **Selos com pictogramas**: mesmo truque — plotar o quadrado arredondado com o pictograma em negativo (linhas do animal = adesivo que fica), pintar bordô. Micro-rótulos pretos: avaliar altura real — se <3 cm, considerar **impressão digital** dos selos inteiros (6 selos pequenos idênticos são fortes candidatos a adesivo impresso).
- **Logotipo CLEBIN**: letras grafite = T-F puro, máscara plotada (curvas arredondadas suaves — recorte fácil). Arcos swoosh: bordô, amarelo e preto se aproximam/encostam.
  - Amarelo × bordô no topo: fronteira curta, curva suave de arco → **fita+corte compensa** OU claro→cura→escuro. Como amarelo é claro e bordô cobre bem, ordem claro→escuro com fita na junta resolve no mesmo dia.
  - Arcos pretos × bordô: afinam a pontas extremas; se houver respiro branco entre eles no layout → T-F, só adesivo; se tocarem → cura+adesivo.
- **Banner de canto**: reta diagonal → fita de corte nas bordas + adesivo do texto, pintar bordô.

### 6) Fronteiras
| Fronteira | Tipo | Curva | Solução |
|---|---|---|---|
| Bordô (barra, banner, selos) × branco | T-F | reta/suave | fita (retas) + adesivo (contornos) |
| Textos/pictogramas brancos dentro do bordô | T-F (reservado) | média/fechada | adesivo aplicado ANTES da tinta |
| Grafite (logo, textos) × branco | T-F | suave | adesivo plotado |
| Amarelo × bordô (swoosh) | **T-T** | suave (arco) | fita+corte (fronteira curta) |
| Arcos pretos × bordô (se tocarem) | **T-T** | suave | cura+adesivo ou respiro branco do próprio layout |

### 7) Camadas e ordem
- **Dia 1 manhã**: lixar janelas (isoplastic), mascarar tudo; pintar AMARELO (swoosh) e GRAFITE (logo + "Entrega ágil...") — não se tocam, mesma sessão.
- **Dia 1 tarde**: fita na junta amarelo/bordô; pintar BORDÔ (barra, banner, selos, swoosh).
- **Dia 2**: remover máscaras, retoque, verniz geral.
- Total: **~1,5 dias por lado**.

### 8) Processos extras
- Isoplastic: lixamento obrigatório em cada janela aberta.
- Arte repetida nos DOIS lados.
- Faixa refletiva regulamentar na borda inferior — conferir conflito com a barra bordô.
- 6 pictogramas × 2 lados = 12 aplicações → padronizar num único rolo plotado.

### 9) Armadilhas de segmentação
- Micro-textos dos selos somem em máscara plotada — detector deve sinalizar "texto abaixo de altura mínima → impressão digital".
- Linhas brancas finas dos pictogramas = fundo reservado, não "cor branca".
- O ® minúsculo é ruído clássico.
- Barra inferior encosta na borda da arte → decidir dobra para rodapé/para-choque na chapa real.

---

## 3. CLEBIN traseira.png

### 1) Implemento / vista / substrato
**Traseira de baú** (formato ~quadrado; moldura fina = contorno do mockup, NÃO é arte). Portas traseiras: **duas folhas com seam vertical central, dobradiças nas laterais, fechos/varões verticais** — a arte real será interrompida por ferragens.

### 2) Fundo
Branco ~85%. **Branco original — sem pintura geral.**

### 3) Inventário
- Logotipo CLEBIN grande centralizado (mesma construção da lateral: letras grafite, swoosh bordô+amarelo+preto, ®, "Distribuidora de Frios").
- "(44) 3622-3000" em bordô bold no canto inferior direito.

### 4) Paleta
Mesmas 3 cores: grafite, bordô, amarelo. Sem degradê.

### 5) Estratégia
Idêntica ao logo da lateral: adesivo plotado para tudo que é T-F; junta amarelo×bordô do swoosh com fita+corte ou claro→cura→escuro. Telefone bordô: T-F puro, adesivo. **Reaproveitar o arquivo de corte da lateral em escala maior** (escala maior = fronteira amarelo/bordô maior → fita+corte ainda mais confortável).

### 6) Fronteiras
Todas T-F (adesivo), exceto amarelo×bordô no swoosh (T-T, suave, fita+corte) e eventuais toques dos arcos pretos (ver lateral).

### 7) Camadas e ordem
Fazer NO MESMO ciclo das laterais (mesmas cores, mesmas demãos): manhã amarelo+grafite, tarde bordô, dia seguinte verniz. **Sincronizar traseira com as duas laterais para economizar sessões de pistola.**

### 8) Processos extras — CRÍTICOS na traseira
- **Seam central das portas**: o logo cruza o vão — cortar o adesivo exatamente no vão e alinhar as duas folhas com portas FECHADAS; quebras de registro esperadas nas ferragens.
- **Dobradiças e fechos**: empapelar/mascarar ferragens; o "n" e o swoosh estão na região direita — provável conflito com varão direito.
- **Para-choque e faixa refletiva traseira obrigatória** — telefone bordô fica logo acima; conferir folga.
- Placa/luzes: manter zona livre inferior.

### 9) Armadilhas de segmentação
- A moldura preta fina é do MOCKUP — segmentador ingênuo cria "borda preta" fantasma.
- Mesmo logo em duas artes/escalas: motor deve deduplicar ("mesmo asset, escala ~1,8×"), não reanalisar do zero.

---

## 4. COMFRO 11,50.png  ← caso canônico: pães fotográficos = AEROGRAFIA

### 1) Implemento / vista / substrato
Lateral de **11,50 m** (proporção extrema ~7:1) — carreta/baú grande. Assumindo **baú de chapa** (caso de pintura do dono): chapa com possíveis frisos verticais a empapelar. (Se fosse sider de lona, viraria impressão em lona — fora do fluxo de pintura.)

### 2) Fundo
**Vermelho vivo ~70–75%** + onda branca orgânica no canto esquerdo (~15%) + zona fotográfica à direita emergindo do vermelho (~15%). Vermelho dominante → **PINTURA GERAL**: lavar, empapelar molduras/frisos e ferragens, fundo laca em tom próximo (rosa/vermelho claro), vermelho final, verniz ao final (obrigatório se poliéster).
IMPORTANTE: as áreas brancas (onda, textos) **são branco original RESERVADO por adesivo antes do vermelho** — não se pinta branco.

### 3) Inventário
- Onda branca orgânica no canto sup. esquerdo contendo: selo circular "COMFRO COMFRO" em arco (vermelho) + **cluster fotográfico de 4 embalagens de produto** (sacos plásticos com pães congelados, rótulos azul/vermelho/marrom/cinza, foto de pão de queijo em cesta).
- Bloco central: "A indústria de **pães congelados** que fortalece o seu negócio!" em branco, sublinhado amarelo manuscrito + raios amarelos.
- Rodapé: @comfro_ e www.comfro.com.br em branco com ícones.
- **Faixa direita fotográfica**: pães, peça de queijo, xícara de café, pães de queijo — imagem que se FUNDE no vermelho por transição suave (sem borda dura).
- Pequenos glifos "&&"/réguas verticais no terço direito = marcas de arquivo, não arte.

### 4) Paleta
- Chapada: vermelho (campo), amarelo (detalhes), branco (reservado).
- **Fotográfico multicor com degradê para o vermelho**: pães dourados, queijo creme, café — impossível em chapado.
- Rótulos das embalagens: azul, vermelho, marrom, tipografia minúscula.

### 5) Estratégia por elemento (justificativa detalhada)
- **Campo vermelho**: pintura geral em laca (secagem rápida sustenta o cronograma). Fundo em tom próximo primeiro para cobertura uniforme em 11,5 m.
- **Onda branca + textos brancos**: adesivo plotado ANTES do vermelho → tudo T-F. Borda da onda = curva suave gigante; adesivo dá borda perfeita (fita amarela na borda + papel também funciona).
- **Cluster de embalagens fotográficas**: **IMPRESSÃO DIGITAL** (adesivo impresso laminado) aplicado sobre a área branca reservada. Justificativa: rótulos com texto minúsculo, fotos de produto, fidelidade de marca — nenhuma pintura reproduz com custo viável.
- **Faixa fotográfica direita (pães/queijo/café)**: **AEROGRAFIA** — referência explícita do dono. Justificativa: a imagem NÃO tem contorno — dissolve no campo vermelho (degradê livre); adesivo impresso teria borda dura e emenda sobre vermelho pintado (diferença de brilho denuncia). Aerógrafo trabalha sobre o vermelho curado, com máscaras soltas/stencils de papel para os volumes grandes e mão livre nos degradês. Para o desenho-base dos volumes grandes: **stencil de papel + carvão sobre máscara de transferência** (caso "muito grande e simples").
- **Sublinhado/raios amarelos**: T-T sobre vermelho curado → cura + adesivo + amarelo (pintado é mais durável que vinil; verniz final sela de qualquer forma).

### 6) Fronteiras
| Fronteira | Tipo | Curva | Solução |
|---|---|---|---|
| Vermelho × onda branca | T-F (reservado) | suave (grande) | adesivo antes do vermelho |
| Vermelho × textos brancos | T-F | média (tipografia bold) | adesivo antes do vermelho |
| Amarelo (detalhes) × vermelho | **T-T** | suave, traços curtos | cura do vermelho + adesivo + amarelo |
| Foto (aerografia) × vermelho | **T-T sem borda** (degradê) | — | aerografia em transição livre, sem máscara dura |
| Impressão digital × branco reservado | n/a (vinil) | — | aplicação sobre fundo |

### 7) Camadas e ordem (ciclo longo — pintura geral)
- **Dia 1**: lavar, preparar, empapelar frisos/molduras/borrachas/faixa refletiva; aplicar adesivos de reserva (onda + textos brancos).
- **Dia 2 manhã**: fundo laca tom próximo. **Tarde**: vermelho final.
- **Dia 3 manhã** (vermelho curado overnight): amarelos; início da aerografia (base dos volumes com stencil papel/carvão).
- **Dia 3 tarde – Dia 4**: aerografia completa (luzes, texturas dos pães, queijo, café).
- **Dia 4**: remover reservas, aplicar impressão digital das embalagens na área branca.
- **Dia 5**: **verniz geral** (unifica brilho entre laca, aerografia e vinil impresso).
- Total: **~5 dias por lado**; dois lados: aerografia refeita à mão em cada lado (não espelhável mecanicamente) → orçar dobrado.

### 8) Processos extras
- Empapelamento completo (pintura geral): frisos, travas, dobradiças, para-choque, paralamas, caixa de ferramentas.
- Faixa refletiva: aplicar POR ÚLTIMO, sobre o verniz curado.
- Frente e traseira provavelmente também vermelhas (continuidade da pintura geral).
- Aerografia exige cabine/clima: vento e poeira arruínam degradê de 3 m.

### 9) Armadilhas de segmentação
- **Degradê foto→vermelho não tem borda**: segmentador por contorno inventa fronteira falsa; classificar como "zona de transição = aerografia".
- Fotos dentro de fotos (embalagens contêm foto de pão): hierarquia de elementos.
- Texto minúsculo nos rótulos → flag "abaixo do mínimo pintável → impressão digital".
- Marcas "&&"/réguas do arquivo não são arte.
- Branco da onda × branco dos pacotes: mesmo RGB, papéis de produção diferentes (fundo reservado × vinil impresso).

---

## 5. mar e rio.png  ← casos canônicos: faixas horizontais = FITA AMARELA; polvo = AEROGRAFIA

### 1) Implemento / vista / substrato
Lateral longa (~3,2:1, possivelmente recorte de arte maior) de baú frigorífico de pescados → forte candidato a **isoplastic** (liso; lixamento nas janelas antes de pintar).

### 2) Fundo
Composição em faixas: azul médio/escuro ~45%, teal claro/médio ~25%, branco ~30% (onda central-direita + base). Não-branco ≈ 70–75% e o desenho é "ambiente" ocupando a chapa toda → tratar como **pintura geral em azuis** com brancos RESERVADOS por adesivo (a grande onda branca é fundo original protegido, não elemento pintado).

### 3) Inventário
- 3–4 faixas onduladas horizontais atravessando toda a lateral (azul escuro, teal claro, teal médio, branco) — curvas longas e suaves ("mar").
- "DESDE 2003 / AINDA MAIS / PERTO DE VOCÊ." branco, à esquerda.
- Logotipo central: placa orgânica BRANCA contendo "Mar & Rio" em lettering manuscrito azul-claro com respingos, peixe ilustrado com escamas, "PESCADOS®" em letras outline texturizadas — acabamento "pincel/giz".
- **Mascote polvo** grande (~altura total da chapa) à direita: ilustração com volume — coral/salmão com sombras vermelhas, luzes claras, pintas, olhos azuis com brilho, lenço marinheiro azul-escuro, tentáculos com ventosas.
- "www.mareriopescados.com.br" em azul sobre a faixa branca.

### 4) Paleta
- Chapadas: 2–3 azuis (escuro, teal claro, teal médio) + azul do lenço.
- **Degradês/volume**: todo o polvo (coral→vermelho→rosa-claro, brilhos, oclusão), texturas do logo (respingos, traço seco).
- Branco: sempre reservado.

### 5) Estratégia por elemento (justificativa detalhada)
- **Faixas onduladas**: **FITA AMARELA FLEXÍVEL** — referência explícita do dono. Justificativa: fronteiras T-T (azul×teal) e T-F (azul×branco) de curvatura SUAVE e comprimento enorme (11+ m); plotar adesivo em fronteira contínua de dezenas de metros é caro e cheio de emendas; a fita amarela acompanha curvas suaves sem vinco, define a borda, e o preenchimento entre fitas é empapelado. **Zero corte manual.**
- **Ordem claro→escuro entre azuis**: teal claro primeiro, fita amarela na divisa, azul escuro depois (escuro cobre invasão mínima). Laca seca rápido — as faixas saem em um dia.
- **Textos brancos**: adesivo de reserva ANTES dos azuis → T-F puro.
- **Placa do logo**: a placa branca inteira = grande reserva de adesivo. O interior (lettering texturizado, peixe com escamas, respingos) tem traço orgânico fino demais para máscara+pistola → **(a) impressão digital da placa inteira** sobre a reserva branca (recomendado: texturas de pincel são identidade da marca) ou (b) aerografia com stencils — mais caro, só se o cliente exigir "tudo pintado".
- **Polvo**: **AEROGRAFIA** — referência explícita do dono. Justificativa: volume contínuo (degradê coral→sombra), pintas, brilhos nos olhos, ventosas com luz — inviável em chapado. Borda externa = T-T contra os azuis com curvas fechadas (tentáculos) → mascarar a silhueta com adesivo plotado (aplicado APÓS cura dos azuis) e aerografar dentro. Desenho-base: **stencil de papel + carvão sobre máscara de transferência** (exatamente o caso "muito grande e simples" da técnica).
- **Lenço azul-escuro do polvo**: chapado em laca na sessão de aerografia (máscara local) — mesma tinta do azul escuro das faixas.

### 6) Fronteiras
| Fronteira | Tipo | Curva | Solução |
|---|---|---|---|
| Azul escuro × teal (faixas) | **T-T** | suave, longa | **fita amarela flexível** (sem corte) |
| Azuis × faixa branca | T-F | suave, longa | fita amarela na borda + branco reservado |
| Textos brancos × azul | T-F | média | adesivo antes da tinta |
| Placa do logo × azuis | T-F | média/orgânica | adesivo de reserva (ou borda do vinil impresso) |
| Silhueta do polvo × azuis/branco | **T-T** (sobre azul) | fechada (tentáculos) | adesivo plotado pós-cura + aerografia interna |
| Interior do polvo | — | — | aerografia mão livre |

### 7) Camadas e ordem
- **Dia 1**: lavar, (isoplastic: lixar), aplicar reservas brancas (onda, textos, placa), fita amarela nas divisas, empapelar.
- **Dia 2 manhã**: teal claro; **tarde**: reposicionar papel, azul escuro. Cura overnight.
- **Dia 3**: máscara do polvo sobre azuis curados; transferência do desenho (papel+carvão); base da aerografia.
- **Dia 4**: aerografia completa (sombras, luzes, pintas, olhos, ventosas); lenço em laca.
- **Dia 5**: remover máscaras, aplicar impressão digital da placa (opção a), retoques, **verniz geral**.
- Total: **~5 dias por lado**; polvo nos dois lados = 2 aerografias completas (orçar as duas).

### 8) Processos extras
- Faixa refletiva por cima do verniz na borda inferior.
- Traseira: versão reduzida provável — dobradiças/fechos a empapelar e seam central.
- Isoplastic: lixar janelas do polvo e das faixas.
- Continuidade das faixas nas quinas frente/traseira — alinhar altura das ondas.

### 9) Armadilhas de segmentação
- Texturas de pincel/respingos do logo: segmentador gera centenas de micro-shapes — colapsar em "asset texturizado → impressão digital", não em 300 peças de corte.
- Sombreado do polvo: gradiente contínuo — quantização "inventa" 15 tons; classificar região como "aerografia", não como 15 camadas.
- Faixas onduladas: fronteira longa+suave → regra automática "fita amarela", nunca "plotter de 12 m".
- Branco da onda × branco da placa: papéis diferentes (fundo reservado × área de vinil impresso).

---

## 6. SGT.png  ← caso canônico: degradê encontrando branco

### 1) Implemento / vista / substrato
Lateral muito longa (~6:1) — carreta/baú grande. Chapa; frisos possíveis a empapelar nas zonas pintadas.

### 2) Fundo
Branco ~55–60% (campo direito/superior). Bloco laranja no canto esquerdo (~15%), estrada cinza em curva varrendo a base (~25%). **Não há pintura geral** — o branco original domina; os elementos grandes são pintados sobre reservas.

### 3) Inventário
- Bloco laranja chapado no canto esquerdo, limitado por grande curva contra o branco.
- "Estrada": faixa cinza-prata larga em curva suave atravessando toda a base, com **linha amarela** contínua acompanhando a curva e fio/filete branco separando laranja e cinza.
- Logotipo "SGT" grande à direita: letras italic com **degradê laranja→amarelo** (base escura, topo claro) cortadas por traços vermelhos horizontais de velocidade; "LOG" vertical cinza; barra cinza-escura "SISTEMA DE GESTÃO EM TRANSPORTE" com texto branco reservado; sombra sutil cinza sob as letras.

### 4) Paleta
- Chapadas: laranja, cinza-prata (estrada — possível leve gradiente), amarelo (linha), cinza-escuro (barra), vermelho (riscos).
- **Degradê**: interior das letras SGT (laranja→amarelo) — **encontrando o BRANCO da chapa na borda** (o caso citado pelo dono).

### 5) Estratégia por elemento (justificativa detalhada)
- **Letras SGT com degradê**: caso-modelo de "degradê encontrando branco": a silhueta das letras é definida por **adesivo plotado sobre o branco original (T-F — nenhum corte, nenhuma fita)**; o degradê interno é feito com **aerografia/pistola em leque** (laranja embaixo → amarelo em cima) dentro da janela. Justificativa: como a fronteira é tinta-fundo, o degradê pode ser pintado livremente sem risco de invadir outra cor — a máscara segura a borda. Os **riscos vermelhos** dentro das letras: T-T sobre o degradê curado → cura ~3h + adesivo das faixas retas (retas → fita serviria, mas estão dentro das letras junto do degradê fresco; adesivo plotado registrado é mais seguro) → vermelho.
- **Bloco laranja**: laca chapada; borda = curva grande suave contra branco → T-F; **fita amarela flexível** define a curva com rapidez (ou adesivo).
- **Estrada cinza**: contra branco em cima = T-F, fita amarela na borda + empapelar o resto. Contra o laranja: **se o filete branco do layout for mantido, o T-T vira DOIS T-F com filete de fundo reservado no meio — elimina o corte**; sem filete: laranja primeiro, cura, fita na divisa, cinza depois. Se a estrada tem leve degradê de prata: pistola em leque dentro do papel.
- **Linha amarela da pista**: literalmente o caso da **fita amarela flexível**: curva suave contínua de ~11 m — mascarar com duas fitas paralelas e pintar amarelo entre elas após cura do cinza (T-T suave → fita compensa totalmente, corte zero). Alternativa provocativa: a própria fita amarela como elemento final não serve (durabilidade) — pintar.
- **Barra "SISTEMA DE GESTÃO..."**: retângulo cinza-escuro com texto branco reservado → adesivo do texto + fita nas retas, uma demão.
- **"LOG" vertical + ®**: adesivo plotado, cinza, T-F.

### 6) Fronteiras
| Fronteira | Tipo | Curva | Solução |
|---|---|---|---|
| Letras SGT (degradê) × branco | T-F | média (italic) | adesivo plotado; degradê livre dentro |
| Riscos vermelhos × degradê | **T-T** | reta | cura 3h + adesivo/fita |
| Laranja × branco (curva grande) | T-F | suave | fita amarela flexível |
| Estrada cinza × branco | T-F | suave | fita amarela flexível |
| Estrada × laranja | T-T **ou** 2×T-F se filete branco mantido | suave | filete reservado (ideal) ou fita na divisa após cura |
| Linha amarela × cinza | **T-T** | suave | fita amarela dupla pós-cura |
| Barra escura × branco | T-F | reta | fita de corte |

### 7) Camadas e ordem
- **Dia 1 manhã**: mascarar; pintar LARANJA (bloco) e, em paralelo, barra CINZA-ESCURA e "LOG" (não se tocam).
- **Dia 1 tarde** (~3h de cura): empapelar laranja, pintar ESTRADA cinza-prata (leque suave se gradiente).
- **Dia 2 manhã**: fita amarela dupla sobre o cinza curado → linha AMARELA. Máscara das letras SGT → **degradê aerografia laranja→amarelo**.
- **Dia 2 tarde** (degradê curado ~3h): adesivo dos riscos VERMELHOS por cima → vermelho.
- **Dia 3**: remover tudo, retoques, **verniz geral**.
- Total: **~3 dias por lado**. Dois lados: mesma máscara reposicionada (conteúdo não espelha).

### 8) Processos extras
- Empapelamento de frisos dentro das zonas laranja/cinza.
- A estrada provavelmente continua na traseira/contorna a frente — alinhar altura nas quinas.
- Faixa refletiva inferior sobre a estrada cinza — prever.
- Sombra cinza sob as letras: avaliar suprimir (custo/benefício) ou véu leve de aerógrafo antes de remover a máscara externa.

### 9) Armadilhas de segmentação
- **Degradê laranja→amarelo nas letras**: quantização cria bandas falsas; classificar a REGIÃO como "degradê → aerografia em janela T-F".
- Degradê encostando no branco: limite claro-do-degradê × branco tem contraste baixíssimo — segmentador "vaza" a letra para o fundo; usar o vetor da silhueta, não o raster.
- Gradiente sutil da estrada prata pode ser lido como duas cinzas chapadas.
- Filete branco entre laranja e estrada: 2–3 px no raster — fácil de perder no antialiasing, mas MUDA a classificação da fronteira (T-T → 2×T-F), impacto direto de custo.

---

# PADRÕES TRANSVERSAIS

1. **Branco quase nunca é tinta.** Nas 6 artes, todo branco (textos, ondas, filetes, placas, frestas de gomos) é fundo original da chapa reservado por adesivo aplicado ANTES da tinta. Regra de motor: cor ≈ branco → classificar como "reserva/T-F", nunca como camada de tinta — e isso zera corte e fita nessas fronteiras.
2. **A classificação da fronteira vale mais que a contagem de cores.** O custo não vem do nº de cores, vem de quantas fronteiras são T-T e de sua curvatura: reta/curta → fita+corte no mesmo dia; suave/longa → fita amarela flexível; fechada/extrema → cura ~3h + adesivo por cima (meio-dia extra por cor empilhada). Motor: para cada par de regiões adjacentes, emitir (tipo, curvatura, comprimento) e mapear para {fita, fita-amarela, cura+adesivo, nada}.
3. **Filete branco entre duas cores é um "downgrade" de custo**: transforma um T-T em dois T-F (SGT laranja/estrada; respiros do swoosh CLEBIN). Detectar filetes de 1–3 px é economicamente relevante — e frágil no raster (antialiasing).
4. **Degradê/textura/foto = mudar de tecnologia, não de nº de camadas**: região com gradiente contínuo ou textura fotográfica → aerografia (se se funde com fundo pintado: pães COMFRO, polvo) ou impressão digital (asset compacto com micro-texto/textura de marca: embalagens COMFRO, placa Mar & Rio). Heurística: degradê SEM borda → aerografia; asset delimitado com texto abaixo da altura mínima pintável → impressão digital.
5. **Degradê dentro de silhueta T-F é barato** (SGT): máscara plotada segura a borda e o degradê é livre. Degradê que se dissolve em cor pintada é caro (COMFRO): sem máscara possível, mão livre em cabine.
6. **Ordem claro→escuro + laca de secagem rápida** comprime o cronograma: claros de manhã, escuros à tarde (3h de cura), verniz geral no último dia unificando brilho (laca × aerografia × vinil impresso).
7. **Elementos repetidos** (dois lados, lateral+traseira) devem ser deduplicados: mesmo asset em escala diferente = 1 análise + fator de escala; MAS aerografia não duplica de graça (cada lado é repintado à mão) — dedupe vale para corte/máscara, não para horas de aerógrafo.
8. **Extras estruturais previsíveis por vista**: traseira → seam de portas, dobradiças, fechos, faixa refletiva, zona de placa; lateral longa → frisos a empapelar, continuidade de faixas nas quinas, faixa refletiva inferior; baú frigorífico (frios/pescados) → provável isoplastic → lixamento nas janelas do adesivo.
9. **Armadilhas raster recorrentes**: antialiasing gera cores fantasmas nas bordas; molduras/réguas/marcas de arquivo não são arte; texturas de pincel explodem em micro-shapes (colapsar por região); mesmo RGB pode ter papéis de produção diferentes (branco-reserva × branco de vinil impresso) — a semântica vem do contexto, não do pixel.
10. **Pipeline sugerido para o motor**: (a) segmentar regiões por cor com colapso de gradiente/textura em "regiões tecnológicas"; (b) classificar fundo (branco original × pintura geral pelo threshold ~80% não-branco — com bom senso para composições "ambiente" tipo mar e rio); (c) grafo de adjacência de regiões com tipo/curvatura/comprimento de fronteira; (d) atribuir técnica por região (laca / aerografia / impressão digital / fita amarela / stencil-carvão para transferência) e por fronteira (nada / fita+corte / fita amarela / cura+adesivo); (e) ordenar camadas (claro→escuro, T-F antes, T-T empilhados com esperas de 3h) e emitir cronograma em meias-jornadas; (f) anexar extras estruturais pela vista/tipo de implemento.
