# Análise de produção v2 — fatia 2 (8 artes)

Refeita contra `api/PAINTING_PRODUCTION_DOCTRINE.md` (ago/2026), que tem precedência
sobre `analysis/analysis_A..F.md`.

**Premissas inegociáveis aplicadas aqui:**
- Adesivo **nunca** é produto final. Vinil recortado existe só como **máscara**.
- Só o **corte do formato da máscara** pode ser feito por máquina. Posicionar,
  depilar, cortar in situ, bater carvão, pintar e envernizar são manuais.
- **Branco nunca é tinta.** Branco é chapa original preservada por máscara —
  inclusive dentro de painéis com pintura geral (mascara-se a letra branca
  *antes* do fundo).
- Bloco fotográfico → **PENDÊNCIA para o dono** (aerografia × pintura artística
  à mão). Nunca "impressão".

**Escala assumida** (nenhum arquivo traz cota; todos vieram normalizados a 1600 px
de largura). Laterais ≈ **800 cm × 230–253 cm**, traseiras ≈ **245–250 cm × 245 cm**.
Toda medida em cm abaixo é derivada dessa conversão e está marcada como estimativa.
Se a arte for aplicada em escala menor, os elementos limítrofes migram de
`CORTE_MANUAL` para máscara de máquina — ver §9 de cada arte.

---

## Tabela-resumo

| # | Arte | Substrato | Fundo | Fronteiras T-T | Estratégia dominante | Complexidade |
|---|------|-----------|-------|----------------|----------------------|--------------|
| 1 | AGROMINA lateral | ISOPLASTIC (provável) | **Pintura geral escura, 100%** | **7** | ESPOVO_SOBRE_MASCARA (dourado) + aerografia livre | **EXTREMA — 1 pendência aberta** |
| 2 | AGROMINA traseira | ISOPLASTIC (provável) | **Pintura geral preta, 100%** | **9** | MASCARA_MAQUINA_SOBRE_VERNIZ (máscara única) | ALTA |
| 3 | ATACADÃO FOLLY lateral | ISOPLASTIC (provável) | Chapa ~52% + campo verde ~48% | **0** | CORTE_MANUAL + FITA_AMARELA | BAIXA |
| 4 | ATACADÃO FOLLY traseira | ISOPLASTIC (provável) | **Pintura geral verde, 100%** | **0** | CORTE_MANUAL (tudo knockout de chapa) | BAIXA |
| 5 | AP RANCHARIA lateral | CHAPA_BRANCA | Chapa ~78%, sem pintura geral | **0** | CORTE_MANUAL | BAIXA |
| 6 | AVGLOG lateral | CHAPA_BRANCA | Chapa ~85%, sem pintura geral | **0** (2 a verificar) | CORTE_MANUAL | MUITO BAIXA |
| 7 | BELLAVER FRUTAS | ISOPLASTIC (provável) | Chapa ~88%, sem pintura geral | **1** | CORTE_MANUAL + 1 máscara de máquina | MÉDIA |
| 8 | CJ PILGER | ISOPLASTIC (provável) | Chapa ~85%, sem pintura geral | **3** (+1 a verificar) | CORTE_MANUAL + 1 máscara de máquina | MÉDIA-ALTA |

**Total: 20 fronteiras T-T confirmadas + 3 candidatas a verificar no vetor.**
4 das 8 artes têm **zero** T-T — todas as cores podem ir na mesma sessão (§6.4).

---

# 1. AGROMINA lateral

### 1. Implemento e substrato provável
Lateral de baú, proporção **3,47:1** (≈ 800 × 230 cm). Transporte de carne suína
→ baú **frigorífico/isotérmico**, logo **ISOPLASTIC** é o substrato provável
(painel sanduíche com face lisa), não chapa de alumínio com frisos. Consequência
pelo §4: se houvesse faixa, a **fita amarela** estaria liberada. Aqui não há faixa
— a única curva longa é a aresta do bloco fotográfico, que é máscara, não fita.
Se na inspeção o baú for chapa com frisos, a arte fotográfica atravessando friso
piora muito a aerografia (sombra de relevo) — verificar antes de orçar.

### 2. Fundo
**Pintura geral obrigatória.** 0% de chapa aparente: o painel inteiro é escuro
(vinho-aubergine → marrom-quente → cinza-violeta) — ≈ 18,4 m². O fundo **não é
chapado**: há 3 grandes bandas tonais verticais em S, cada uma com ~230–260 cm de
altura e raio de curvatura 200–500 cm, com ΔE pequeno entre elas → aerografadas
molhado-sobre-molhado, sem máscara.

**O branco desta arte é chapa, não tinta.** O subtítulo "TRADIÇÃO EM CARNE SUÍNA"
é branco sobre fundo escuro: mascara-se a letra **na chapa nua** e pinta-se o
fundo geral por cima. Zero tinta branca.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Bloco fotográfico | — (costelas suínas grelhadas, com gergelim, sobre tábua de madeira; panela com molho ao fundo) | ≈ 365 × 230 cm, aresta direita = arco convexo único de ~245 cm |
| Faíscas / brasas | — | ~70 partículas de 2–15 cm, com bloom laranja-avermelhado |
| Bandas tonais do fundo | — | 3 curvas em S, 230–260 cm cada |
| Logotipo script | `Agromina` | ≈ 305 × 60 cm |
| Swash / sublinhado | — | 302 cm de comprimento × 12 cm de espessura |
| Selo de fundação | `EST. 1973` | ≈ 50 × 9 cm, entre 2 filetes de 68 cm × 1,5 cm |
| Folhas (ponto do "i") | — | 2 folhas de ≈ 22 × 17 cm |
| Subtítulo | `TRADIÇÃO EM CARNE SUÍNA` (leve + bold em "CARNE SUÍNA") | ≈ 195 cm × 14 cm de altura de caixa-alta |

### 4. Paleta
- **Fundo escuro** — 3 tons próximos (vinho-aubergine, marrom-quente, cinza-violeta): **degradê contínuo**, não chapado.
- **Dourado do logotipo** — **degradê metálico** (varredura clara→escura ao longo das letras).
- **Laranja/vermelho de brasa** — degradê radial por partícula (bloom).
- **Paleta fotográfica da carne** — dezenas de marrons, âmbares, pretos de crosta, creme do gergelim: **fora de qualquer paleta de pintura chapada**.
- **Branco** — chapa preservada (subtítulo). Não é tinta.

Nenhuma cor desta arte é chapada. É o oposto das outras 7 da fatia.

### 5. Fronteiras T-T
Todas as fronteiras aqui são T-T: **não existe chapa exposta a não ser sob o
subtítulo mascarado**.

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | dourado (script) × fundo escuro | ≈ **1250 cm** (perímetro de 9 glifos ligados) | **EXTREMA** — terminais de script afinam a ~1,5 cm de raio | fundo escuro |
| T-T 2 | dourado (swash) × fundo escuro | ≈ **630 cm** | **SUAVE** — raio 250–600 cm | fundo escuro |
| T-T 3 | dourado (`EST. 1973` + 2 filetes) × fundo | ≈ **520 cm** | FECHADA (glifos de 9 cm) / RETA (filetes) | fundo escuro |
| T-T 4 | dourado (folhas) × fundo | ≈ **120 cm** | FECHADA→EXTREMA — pontas de raio ~1 cm | fundo escuro |
| T-T 5 | bloco fotográfico × fundo escuro | ≈ **245 cm** | **SUAVE** — arco único, raio 250–400 cm | fundo escuro (10,0 m² vs 8,4 m²) |
| T-T 6 | faíscas × fundo escuro | ≈ 600 cm nominais | **não mascarável** — transição de bloom de 1–3 cm | fundo escuro |
| T-T 7 | bandas tonais do fundo entre si | ≈ 700 cm | SUAVE, raio 200–500 cm | — (mesma família) |

**Não se tocam:** o dourado e o bloco fotográfico estão separados por ≈ 55 cm de
fundo escuro → podem ir na mesma sessão se necessário. O subtítulo branco não toca
o dourado (≈ 20 cm de folga).

### 6. Ordem de pintura
Aplicação do §2, com uma **exceção explícita**: a regra "menor cobertura primeiro"
governa **elemento contra elemento**. O **fundo geral** (§6, passo 2) é a base de
tudo e não entra na regra — mascarar 18 m² de painel para pintar 1,3 m² de dourado
seria o oposto da economia que a regra busca.

1. **Máscara do branco** (subtítulo) na chapa nua — é o único "menor" que precede o fundo.
2. **Fundo escuro geral** + bandas tonais aerografadas.
3. **Bloco fotográfico** (T-T 5): 8,4 m² contra 10,0 m² de fundo — o fundo cobre mais, então o bloco vem antes e o fundo já existe embaixo dele; a aresta é resolvida por máscara do arco na hora de aerografar o bloco.
4. **Faíscas** (T-T 6): aerografia livre sobre o fundo curado; não há segunda cor a proteger porque a transição é bloom.
5. **Dourado** (T-T 1–4): 1,3 m² contra 10,0 m² → menor cobertura, mas vem por último porque o fundo é a base. Todos os elementos dourados são a **mesma tinta** e não se tocam entre si além do lock-up → **uma sessão só**.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Subtítulo `TRADIÇÃO EM CARNE SUÍNA` | **CORTE_MANUAL** | Caixa-alta de 14 cm, traço ~2,5 cm, 22 glifos. Um humano corta isso com estilete sem hesitar. Máscara vai na chapa nua, antes do fundo. |
| Fundo + bandas tonais | aerografia livre (sem máscara) | Transições de raio 200–500 cm com ΔE pequeno; máscara criaria aresta dura que a arte não tem. |
| Bloco fotográfico (costelas) | ⚠️ **PENDÊNCIA — decisão do dono** | Não é adesivo impresso. Restam **aerografia** ou **pintura artística à mão**. 8,4 m² de textura de carne, brilho especular, gergelim e granulado de crosta. Diferença de horas para dias. **Bloquear o orçamento até a decisão.** A única coisa decidida é a **aresta**: máscara lisa cortada à mão no arco (raio 250–400 cm, um corte só). |
| Faíscas / brasas | aerografia livre + respingo | ~70 micro-elementos com bloom; qualquer máscara produziria borda dura errada. Parte da mesma pendência do bloco fotográfico (mesmo artista, mesma sessão). |
| Script `Agromina` | **ESPOVO_SOBRE_MASCARA** | 305 cm de largura → cabe no "MUITO GRANDE" do §3.3. É o uso 2 do espovo: aplica a máscara lisa sobre o fundo curado, bate carvão pelo kraft furado, corta seguindo a marca. Traços grossos de 6–15 cm são fáceis; os terminais de 1,5 cm exigem mão firme mas são cortáveis nesta escala. Evita máquina de corte **e** ciclo de verniz. |
| Swash / sublinhado | **CORTE_MANUAL** | Curva única de 302 cm, raio > 250 cm, espessura 12 cm. Régua flexível + estilete. |
| `EST. 1973` + filetes | **CORTE_MANUAL** | 9 cm de caixa-alta; filetes retos de 1,5 cm × 68 cm. Limítrofe mas cortável. |
| Folhas | **CORTE_MANUAL** | 22 × 17 cm, 2 peças, pontas de raio 1 cm. |
| Varredura metálica do dourado | aerografia dentro da máscara | Degradê dentro de uma cor só — não é fronteira. |

**Nenhum elemento desta arte justifica máquina de corte.** O que a encarece é o
bloco fotográfico, que não é problema de máscara — é problema de artista.

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo | Cura |
|---|---|---|---|
| S0 | D1 manhã | Lavar; empapelar perfis, borrachas, ferragens; máscara do subtítulo branco na chapa nua | — |
| S1 | D1 | Fundo escuro geral + 3 bandas tonais aerografadas; remover máscara do branco | noite |
| S2 | D2–D4 | ⚠️ **PENDENTE** — bloco fotográfico (aerografia ou pintura à mão) | por demão |
| S3 | D4 fim | Faíscas / brasas (aerografia livre) — mesma sessão do artista | — |
| S4 | D5 | Dourado: espovo + corte da máscara do script; swash; `EST. 1973` + filetes; folhas. **Tudo numa sessão** (§6.4: mesma tinta, elementos não se tocam) | 3 h |
| S5 | D6 | Verniz geral (metálico exige verniz) | — |

**Total: 6 dias por lado**, dos quais 3 são a pendência. Se o dono optar por
simplificar o bloco fotográfico (silhueta estilizada em vez de foto), cai para
**2,5 dias**. O outro lado repete tudo, com a foto **reposicionada** (não espelhada).

### 9. Armadilhas para o motor de visão
- **Fundo quase-preto com ΔE < 5 entre 3 tons**: threshold vê "1 cor" e perde as 3 bandas em S → subestima a aerografia de fundo.
- **Branco = chapa dentro de painel 100% pintado**: o motor tende a classificar "sem chapa exposta ⇒ nenhuma fronteira T-F". Errado: o subtítulo branco é chapa preservada e gera 990 cm de fronteira **T-F**, não T-T.
- **Faíscas**: ~70 micro-blobs com bloom → o segmentador as conta como 70 elementos pintáveis e explode a contagem de máscaras. São **uma** operação de aerografia.
- **Dourado com varredura metálica**: o gradiente interno vira bandas na quantização → o motor inventa 3–4 "cores douradas" e 3–4 fronteiras T-T internas que não existem.
- **Bloco fotográfico**: entropia local altíssima. O motor precisa reconhecê-lo como **bloco único com flag de pendência**, nunca fragmentá-lo em regiões.
- **A aresta do bloco fotográfico é a única fronteira limpa da arte** — é o único lugar onde medir curvatura faz sentido.
- **Sem cota no arquivo**: a decisão "script cortável à mão" depende inteiramente dos 305 cm assumidos. A 100 cm, o script vira caso do §3.2.

### 10. Correções à `analysis_B.md` (item 9)
| A análise antiga diz | Correção |
|---|---|
| "**impressão digital total (wrap) é a única via sã**" / "**Recomendação: wrap impresso**" | **ERRADO — viola a premissa central.** Adesivo nunca é produto final. Não existe caminho impresso. A arte é pintada; o bloco fotográfico é pendência entre aerografia e pintura artística à mão. |
| "Se impresso: nenhuma fronteira de produção" | Contabilidade fantasma. Há **7 fronteiras T-T**, ~4000 cm de contato, sendo 1250 cm de curvatura extrema no script dourado. |
| "1 dia de aplicação" (caminho impresso) | Não existe. O piso realista é **2,5 dias** (foto simplificada) e o teto **6 dias**. |
| "Viável só como serviço premium explícito (semana+)" — pintura tratada como exceção cara | Pintura é o **único** caminho. A frase inverte o padrão e o excepcional. |
| Não menciona que o branco do subtítulo é chapa preservada | O subtítulo deve ser **mascarado antes do fundo geral**. A análise antiga, ao propor wrap, elimina a questão sem responder — e no caminho pintado ela levaria a pintar branco sobre escuro (2 demãos + cobertura ruim). |
| "Nada aqui é caso de fita" | Correto, e é o único ponto que sobrevive. |
| Nenhuma medida de comprimento (cm) ou raio de curvatura por fronteira | O §1 da doutrina exige as duas. A análise antiga não tem nenhuma. |

---

# 2. AGROMINA traseira

### 1. Implemento e substrato provável
Traseira de baú, proporção **1,02:1** (≈ 250 × 245 cm). Duas folhas de porta com
dobradiças, barras de fechamento verticais e borrachas de vedação. Substrato
**ISOPLASTIC** (mesma unidade da lateral, frigorífico). Pelo §4 isso libera **fita
amarela** — e há exatamente um lugar onde ela vale: a onda superior da faixa
dourada (curva suave de 250 cm). Todo o resto é máscara.

### 2. Fundo
**Pintura geral preta, 100%.** Zero chapa exposta em toda a peça — não há **nenhuma
fronteira T-F nesta arte**. É a única das 8 nessa condição.

O preto é a **base** e, o que a análise antiga não viu, também é a **cor de todos os
textos da faixa**: os textos pretos sobre o dourado são **knockouts do preto de
base**, não uma segunda pintura preta.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Silhueta do porco (estilo cortes de açougue) | — | ≈ 209 × 133 cm, área de preenchimento ≈ 1,6 m² |
| Linhas internas de corte | — | ~16 segmentos, ≈ 950 cm de extensão, traço de **0,8 cm** |
| Rabo em espiral | — | laço de ~14 cm de diâmetro, traço de 0,8 cm, ~40 cm de percurso |
| Faixa dourada inferior | — | 250 cm de largura × ~84 cm de altura média; aresta superior em onda |
| Logotipo script (preto) | `Agromina` | ≈ 77 × 20 cm |
| Swash (preto) | — | 73 cm × 1,2 cm |
| Selo (preto) | `EST. 1973` + 2 filetes | ≈ 13 cm × 2,5 cm de caixa-alta |
| Folhas (pretas) | — | ≈ 6 × 5 cm |
| Subtítulo (preto) | `TRADIÇÃO EM CARNE SUÍNA.` | ≈ 61 cm × 3,4 cm de caixa-alta |
| QR code (preto) | — | ≈ 34 × 34 cm, ~37 módulos → **módulo de 0,93 cm** |
| Contato 1 | ícone WhatsApp + `98 9 3012 7810` | dígitos de 4,7 cm |
| Contato 2 | ícone Instagram + `@grupoagromina` | 3,7 cm |
| Contato 3 | ícone globo + `agromina.com.br` | 3,7 cm |

### 4. Paleta
Duas tintas apenas: **preto** (chapado, fundo geral) e **dourado metálico**
(degradê de varredura, aplicado em duas regiões — porco e faixa). Nenhum branco.
Nenhuma terceira cor. Paleta curtíssima, complexidade toda concentrada no **corte
da máscara**.

### 5. Fronteiras T-T
Todas T-T. **Zero T-F.**

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | dourado (porco) × preto (fundo) | ≈ **700 cm** de perímetro | **MÉDIA a EXTREMA** — focinho r≈8 cm, orelhas r≈2 cm, cascos r≈3 cm, **rabo em espiral r≈7 cm com traço de 0,8 cm** | preto (2,4 m² vs 1,6 m²) |
| T-T 2 | preto (linhas de corte) × dourado (interior do porco) | ≈ **1900 cm** de corte (950 cm × 2 arestas) | MÉDIA — arcos suaves, mas **largura de 0,8 cm** | dourado |
| T-T 3 | dourado (faixa) × preto (fundo) | ≈ **250 cm** (onda) + 2 × 84 cm nas laterais | **SUAVE** — amplitude ~14 cm em 250 cm, raio 400–600 cm | dourado (2,1 m² vs preto acima) |
| T-T 4 | preto (script `Agromina`) × dourado | ≈ **400 cm** | **EXTREMA** — hairlines de script a 0,6 cm | dourado |
| T-T 5 | preto (swash) × dourado | ≈ **150 cm** | SUAVE (raio > 200 cm), mas traço de 1,2 cm | dourado |
| T-T 6 | preto (`EST. 1973` + filetes) × dourado | ≈ **90 cm** | FECHADA — glifos de 2,5 cm | dourado |
| T-T 7 | preto (subtítulo) × dourado | ≈ **320 cm** | FECHADA — caixa-alta de 3,4 cm | dourado |
| T-T 8 | preto (QR) × dourado | ≈ **1500–2000 cm** | RETA em ângulo de 90°, mas **passo de 0,93 cm** | dourado |
| T-T 9 | preto (3 ícones + 3 linhas de contato) × dourado | ≈ **500 cm** | FECHADA — o ícone de globo tem grade interna sub-centimétrica | dourado |

**Não se tocam:** o **porco não toca a faixa dourada** — há ≈ 8–15 cm de preto entre
o casco mais baixo e a crista da onda. Isso é decisivo: **porco e faixa são a mesma
tinta e não se tocam ⇒ uma única máscara, uma única sessão de dourado** (§6.4).

### 6. Ordem de pintura
Duas cores só, e a regra do §2 é atendida pelo caminho natural do §3.2:

1. **Preto** (cobre 6,1 m² = o painel inteiro) — é fundo geral **e** a cor de maior cobertura. Vai primeiro.
2. **Verniz + cura** — exigido pelo §3.2 porque a máscara seguinte é recortada a máquina e vai sobre tinta.
3. **Dourado** (3,7 m²) por cima, através de uma máscara única.

Note que aqui o §2 e o §6 coincidem sem exceção: o preto é simultaneamente o fundo
e a cor maior. A "inversão" que a regra pediria (menor primeiro) não se aplica
porque o dourado só existe como janela recortada no preto.

**O ganho de leitura correta:** os textos pretos da faixa não são uma terceira
operação. São o preto do passo 1 aparecendo pelas ilhas da máscara do passo 3.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Fundo preto | pintura geral (§6.2) | — |
| Onda superior da faixa | **FITA_AMARELA** | §4: substrato isoplastic + curva suave de 250 cm ⇒ fita amarela faz a curva sem corte. É a única economia de corte disponível na peça. |
| **Todo o resto do dourado** (porco + linhas de corte + script + swash + `EST. 1973` + folhas + subtítulo + QR + ícones + contatos) | **MASCARA_MAQUINA_SOBRE_VERNIZ — máscara única** | "Um humano consegue cortar isso com estilete, no implemento?" — **Não.** Três impedimentos independentes, qualquer um deles bastaria: (a) **linhas de corte de 0,8 cm** exigem dois cortes paralelos a 8 mm ao longo de 950 cm; (b) **QR com módulo de 0,93 cm** — centenas de quinas, e um erro de 2 mm mata a leitura; (c) **script preto de 2,5–3,4 cm de altura** com hairlines de 6 mm. Como a máquina já vai ser paga e o verniz já vai ser esperado, **tudo entra na mesma máscara** — o custo marginal de acrescentar o porco é zero. |
| Varredura metálica do dourado | aerografia dentro da máscara | Degradê numa cor só; não é fronteira. |

Compare com a lateral: lá **nenhum** elemento pedia máquina; aqui **quase tudo**
pede — e a causa é escala, não desenho. O mesmo script `Agromina` que na lateral
tem 305 cm e é cortável à mão, aqui tem 77 cm e não é.

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo | Cura |
|---|---|---|---|
| S0 | D1 manhã | Lavar; **empapelar ferragens traseiras** (dobradiças, barras verticais, fechos, borrachas) — o custo fixo da traseira | — |
| S1 | D1 | Fundo preto geral (laca) | noite |
| S2 | D2 manhã | **Verniz** sobre o preto (§3.2) | ~3 h |
| S3 | D2 tarde | Aplicar a **máscara única** recortada a máquina; **cortá-la na junção das portas** (com as portas fechadas) para não rasgar ao abrir; fita amarela na onda; dourado metálico + varredura aerografada | noite |
| S4 | D3 | Remover máscaras; retoques nas quinas de ferragem; **verniz final** | — |

**Total: 3 dias.** Testar a leitura do QR depois do verniz (preto sobre dourado
tem contraste menor que preto sobre branco — se falhar, o dono decide entre
aumentar o QR ou trocar a área por um campo preto).

### 9. Armadilhas para o motor de visão
- **Linhas de corte de 0,8 cm somem em downscale** — justamente as linhas que definem o desenho de açougue. Se sumirem, o motor conclui "silhueta lisa, cortável à mão" e erra a estratégia por completo.
- **Degradê metálico do dourado vira bandas** na quantização → falsas fronteiras T-T dentro do porco e dentro da faixa.
- **QR**: precisa ser detectado como **bloco único** (finder patterns) e classificado como **máscara de máquina obrigatória**, nunca como 800 regiões pretas. E — contra a análise antiga — **nunca** como vinil aplicado.
- **Zero chapa exposta**: o motor tem que reconhecer que "sem branco ⇒ todas as fronteiras são T-T", e não o contrário.
- **Texto preto sobre dourado é knockout do fundo**, não uma cor nova. Um grafo de adjacência ingênuo cria uma terceira sessão de pintura que não existe.
- **A junção das portas** cruza o porco na vertical (x ≈ metade) — é fronteira física, não cromática. Um segmentador de foto real a leria como aresta da arte.
- **Porco e faixa não se tocam por ~8–15 cm** — se o motor errar essa folga por 1 px, ele funde os dois numa região só e perde a informação de que já estavam na mesma sessão de qualquer forma (erro benigno aqui, grave em outras artes).

### 10. Correções à `analysis_B.md` (item 10)
| A análise antiga diz | Correção |
|---|---|
| "**Textos pretos sobre dourado**: curar o dourado (~3h) → máscara plotada → **preto**" | **ERRADO e caro.** O preto já está embaixo. Os textos são **knockouts** da máscara do dourado. Elimina uma cura de 3 h, uma máscara inteira e uma sessão de pintura. |
| "**QR: vinil recortado preto aplicado ao final (não pintar)**" | **ERRADO — viola a premissa central.** Adesivo nunca é produto final. O QR é **pintado**, como knockout do preto de base, dentro da mesma máscara de máquina. |
| "**Caminho impressão: wrap**" oferecido como alternativa | Não é alternativa. Não existe. |
| "**Faixa dourada inferior: fita amarela flexível**" (isolada) | Correto quanto à fita, mas a análise não amarrou a escolha ao **substrato** (§4). A fita amarela só é legítima aqui porque o baú é **isoplastic**; em chapa a onda voltaria a ser corte manual. |
| "Silhueta do porco × preto: **máscara plotada**" — e as linhas internas tratadas como knockout "grátis" | O knockout está certo, mas a análise não percebeu que **linhas de 0,8 cm são o motivo pelo qual a máquina é obrigatória** — ela trata a máquina como default, não como exceção justificada (§3.2). |
| Duas máscaras separadas (porco e faixa), em sessões diferentes | Porco e faixa **não se tocam** e são **a mesma tinta** ⇒ §6.4: **uma máscara, uma sessão**. |
| Nenhum comprimento em cm nem raio por fronteira | Exigência do §1, ausente. |

---

# 3. ATACADÃO FOLLY lateral

### 1. Implemento e substrato provável
Lateral de baú, proporção **3,69:1** (≈ 850 × 230 cm). O texto "Ceasa – Londrina PR"
identifica atacadista de hortifrúti em entreposto → baú **isotérmico**, substrato
**ISOPLASTIC** provável. Isso importa muito aqui: o chevron verde é uma curva longa
e, pelo §4, **isoplastic libera fita amarela** — a técnica mais barata do documento
(qualquer curva, zero corte). Se na inspeção for chapa com frisos, o chevron cai
para corte manual e a arte ganha ~2 h.

### 2. Fundo
**Sem pintura geral.** Chapa branca original ≈ **52%** (metade direita, onde vive
todo o lock-up). Campo verde pintado ≈ **48%** (metade esquerda) — grande, mas
abaixo do limiar de "pintura geral": é um **elemento pintado gigante** de ≈ 9,8 m².

Ressalva importante: no arquivo o campo direito é um cinza-clarííssimo (≈ #ECECEC),
não branco puro. Na traseira, o mesmo lock-up aparece em **branco puro** sobre
verde. A leitura correta é que o cinza do arquivo é tinta de render e o campo
direito é a **chapa original**. **Se for realmente cinza-claro chapado**, a arte
muda de categoria: vira pintura geral em dois campos, o lock-up passa a ter
fronteiras T-T em vez de T-F, e o dia sobe para 2. **Confirmar no vetor antes de
orçar** — é a decisão de maior impacto desta arte.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Campo verde com degradê | — | ≈ 425 × 230 cm; aresta direita em chevron |
| Chevron (aresta do campo) | — | trecho superior 159 cm + trecho inferior 123 cm; vértice arredondado r ≈ 13 cm |
| Assinatura de praça (branca) | `Ceasa – Londrina PR` | ≈ 234 cm × 22 cm de caixa-alta, bold itálico |
| Marca "FB" facetada (verde-escuro) | — | ≈ 175 × 135 cm, hexágono facetado com fendas brancas internas |
| Amêndoa preta | — | ≈ 21 × 74 cm |
| Nome (verde-escuro) | `ATACADAO` | ≈ 191 cm, caixa-alta de 28 cm, traço de 4 cm |
| Nome (preto) | `FOLLY` | ≈ 117 cm, caixa-alta de 28 cm |
| Fundação (preto, entreletrado) | `DESDE 1994` | ≈ 178 cm, caixa-alta de 11 cm |

### 4. Paleta
- **Verde-médio** do campo — **degradê** claro→escuro dentro da mesma cor (não é fronteira).
- **Verde-escuro** (marca + `ATACADAO`) — **chapado**.
- **Preto** (amêndoa + `FOLLY` + `DESDE 1994`) — **chapado**.
- **Branco** — chapa: campo direito, `Ceasa – Londrina PR` e as fendas internas da marca.

Três tintas. Um único degradê, interno a uma cor.

### 5. Fronteiras T-T
**ZERO.** Verificação par a par:

| Par | Se tocam? | Folga medida |
|---|---|---|
| verde-médio (campo) × verde-escuro (marca) | **NÃO** | ≥ 130 cm — a marca está inteira sobre a chapa |
| verde-médio (campo) × preto | **NÃO** | ≥ 150 cm |
| verde-escuro (`ATACADAO`) × preto (`FOLLY`) | **NÃO** | ≈ 6 cm entre o "O" e o "F" |
| verde-escuro (marca) × preto (amêndoa) | **NÃO** | ≈ 13 cm |
| verde-escuro (marca) × preto (`DESDE 1994`) | **NÃO** | ≈ 25 cm |

Fronteiras T-F (não geram trabalho de proteção de segunda cor): chevron do campo
verde contra a chapa (282 cm); `Ceasa – Londrina PR` como knockout dentro do verde
(≈ 1200 cm); contornos da marca, da amêndoa e dos três textos contra a chapa.

**Consequência direta do §6.4: as três tintas vão na MESMA sessão.** Não há nada a
proteger, nenhuma cura intermediária, nenhuma máscara de segundo estágio.

### 6. Ordem de pintura
Sem T-T, o §2 não tem par para ordenar. A ordem é só de conveniência de bico e de
overspray:

1. Máscaras do knockout branco (`Ceasa – Londrina PR`) e fita amarela no chevron.
2. **Verde-médio** do campo (maior área, 9,8 m²) — primeiro por causa do overspray: é o que mais espalha.
3. **Verde-escuro** e **preto**, em qualquer ordem, na mesma jornada, com máscaras independentes.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Chevron do campo verde | **FITA_AMARELA** | §4 puro: isoplastic + trecho curvo (raio ~425 cm) e vértice de r=13 cm ⇒ a fita amarela faz a curva sem nenhum corte. Se o substrato for chapa, a fita branca não faz esse vértice → cai para CORTE_MANUAL. |
| Degradê do campo | aerografia dentro da fita | Degradê numa cor só. |
| `Ceasa – Londrina PR` | **CORTE_MANUAL** | Caixa-alta de 22 cm em bold itálico, 17 glifos. Trivialmente cortável. Máscara vai na chapa nua, antes do verde. |
| Marca "FB" facetada | **CORTE_MANUAL** | 175 cm de largura, **todas as arestas retas ou chanfradas**; fendas internas de ~7 cm. Régua + estilete. O menor raio é o do canto arredondado do hexágono, ~5 cm. |
| Amêndoa preta | **CORTE_MANUAL** | Lente simples de 74 cm com duas pontas de r ≈ 2 cm. |
| `ATACADAO` / `FOLLY` | **CORTE_MANUAL** | Caixa-alta de 28 cm, traço de 4 cm, geométrica sem serifa. Caso fácil. |
| `DESDE 1994` | **CORTE_MANUAL** | Caixa-alta de 11 cm, entreletrado (nenhum glifo encosta no vizinho — cada um é uma ilha independente, o que **facilita** o corte). |

**Zero elementos de máquina. Zero verniz intermediário.** Esta é a arte mais barata
da fatia junto com a AVGLOG.

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo |
|---|---|---|
| S0 | D1 manhã | Lavar; empapelar perfis e borrachas; aplicar máscaras (knockout branco, marca, amêndoa, textos) e fita amarela no chevron |
| S1 | D1 | **Sessão única de cor**: verde-médio (campo + degradê) → verde-escuro (marca + `ATACADAO`) → preto (amêndoa + `FOLLY` + `DESDE 1994`). Sem cura entre cores: **nada se toca** (§6.4) |
| S2 | D1 fim / D2 manhã | Remover máscaras, retoques, verniz geral |

**Total: 1 dia por lado.** O lado oposto espelha o campo verde e o chevron; **os
textos e a marca não espelham**.

### 9. Armadilhas para o motor de visão
- **O campo direito é #ECECEC, não #FFFFFF.** Um classificador de "branco = chapa" com tolerância apertada vai declarar 52% de tinta cinza-clara e transformar 5 fronteiras T-F em T-T. É o erro mais caro possível nesta arte. Regra sugerida: região clara **conectada à borda do painel** e com luminância > 90% ⇒ chapa, independentemente da matiz.
- **Dois verdes distintos** (campo médio × marca escura) com ΔE moderado: o clustering pode fundi-los e inventar uma fronteira T-T que não existe (eles estão a 130 cm um do outro).
- **Degradê do campo** vira bandas na quantização → falsas fronteiras T-T internas.
- **Anti-aliasing no chevron diagonal** cria pixels verde-claros intermediários lidos como "terceira cor de transição".
- **`ATACADAO` verde e `FOLLY` preto na mesma linha de texto**: OCR os junta numa string só e o motor perde que são **duas cores**.
- O **vértice do chevron** é o único ponto de curvatura relevante do desenho todo; se o motor amostrar curvatura só por comprimento, ele o dilui em 282 cm de aresta quase reta e não vê que ali há um r=13 cm.

### 10. Correções à `analysis_B.md`
Esta arte **não tem entrada individual** na `analysis_B.md` (o lote B cobre ACM,
ADRI, AFO, AGI, Agrícola Premium, AGROMINA, AKTL e AP RANCHARIA). As correções são
aos **padrões transversais** da mesma análise, que se aplicariam a ela:

| O padrão transversal antigo diz | Correção |
|---|---|
| Padrão 3: "serifa, script, ponta fina ou talo → **máscara plotada, sem exceção**" | Falso como regra. O critério do §3 é **tamanho no implemento**, não tipo de forma. Aqui há amêndoa com ponta e chanfros e **tudo é corte manual**, porque tudo tem 20–175 cm. |
| Padrão 5: textos pequenos e blocos legais "→ **sempre vinil recortado/impresso aplicado após o verniz**" | Adesivo nunca é final. `DESDE 1994` tem 11 cm de altura e é **pintado**, com máscara cortada à mão. |
| Padrão 3: "fronteiras retas → fita de corte" | Confunde as ferramentas. Fita é para **faixa** (§4) e a escolha depende do **substrato**; para formas fechadas com arestas retas o caminho é máscara lisa + corte manual com régua. |
| "Ideias para o motor": "aresta região × branco-de-fundo = **só adesivo**" | A expressão "só adesivo" descreve a fronteira pelo material da máscara e sugere entrega adesiva. O nome correto é **T-F**, e a consequência é "não há segunda cor a proteger". |
| A lista de técnicas por aresta ("fita reta / fita flexível / máscara plotada / cura+adesivo") | Não contém **CORTE_MANUAL** nem **ESPOVO** — ou seja, omite a técnica **preferida** e a técnica de exceção da doutrina inteira. |

---

# 4. ATACADÃO FOLLY traseira

### 1. Implemento e substrato provável
Traseira de baú, proporção **1,008:1** (≈ 245 × 243 cm). Duas folhas de porta:
dobradiças, barras verticais de fechamento, borrachas. **ISOPLASTIC** (mesma
unidade da lateral). Substrato aqui **não** decide fita, porque **não há faixa
nenhuma** — a peça é um campo cheio com knockouts. É a arte da fatia em que o
substrato menos importa.

### 2. Fundo
**Pintura geral verde, 100%** (≈ 5,95 m²). Zero chapa exposta **como fundo** — mas,
diferentemente da AGROMINA traseira, aqui **todo o grafismo é chapa preservada**.

Monograma, `ATACADAO FOLLY` e `DESDE 1994` são **brancos = chapa mascarada antes do
verde**. Nenhuma tinta branca. É o exemplo mais limpo da regra "branco nunca é
tinta" em toda a fatia: a arte tem **uma única tinta**.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Campo verde | — | 245 × 243 cm, chapado |
| Monograma "FB" (branco/chapa) | — | ≈ 110 × 97 cm; barras internas de ~3,4 cm; amêndoa com ponta de r ≈ 2 cm |
| Nome (branco/chapa) | `ATACADAO FOLLY` | ≈ 227 cm × 15 cm de caixa-alta, traço de 1,5 cm |
| Fundação (branco/chapa, entreletrado) | `DESDE 1994` | ≈ 81 cm × 5,2 cm de caixa-alta, traço de 0,8 cm |
| Terço inferior | vazio (verde) | ≈ 245 × 80 cm — reservado para para-choque, placa, luzes e faixa refletiva |

### 4. Paleta
**Uma tinta: verde-médio chapado.** Sem degradê (ao contrário da lateral, onde o
campo tem varredura). Branco = chapa. É a paleta mais curta possível.

### 5. Fronteiras T-T
**ZERO — e por construção**: só existe uma tinta na peça. Duas cores não-brancas
não podem se tocar se só há uma cor não-branca.

Fronteiras T-F, para dimensionar o corte:
- monograma × verde: ≈ **700 cm** (contorno externo + contraformas internas), curvatura RETA a MÉDIA, menor raio ≈ 2 cm (ponta da amêndoa);
- `ATACADAO FOLLY` × verde: ≈ **850 cm**, 14 glifos, curvatura MÉDIA (o "O", o "C", o "D"), traço de 1,5 cm;
- `DESDE 1994` × verde: ≈ **180 cm**, 9 ilhas independentes, traço de 0,8 cm.

Total ≈ 1730 cm de corte, **todo ele T-F** — nenhum minuto gasto protegendo uma
segunda cor. É o que faz esta peça barata apesar do volume de corte.

### 6. Ordem de pintura
Não há par de cores para ordenar (§2 vazio). A ordem é:

1. Máscaras de **todos** os knockouts brancos, na chapa nua.
2. Verde geral, uma demão + retoque.
3. Remoção das máscaras, verniz.

Vale registrar por que a alternativa está errada: pintar verde primeiro e **branco
por cima** exigiria 2–3 demãos de branco (poder de cobertura baixo sobre verde),
mais uma cura, mais uma máscara — e produziria letras com relevo. Preservar a chapa
resolve tudo em uma operação.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Monograma "FB" | **CORTE_MANUAL** | 110 cm, arestas retas e chanfradas, contraformas de 3,4 cm. Fácil. |
| `ATACADAO FOLLY` | **CORTE_MANUAL** | Caixa-alta de 15 cm com traço de 1,5 cm — fino para o tamanho, mas 14 glifos geométricos são cortáveis à mão com paciência (~40 min). |
| `DESDE 1994` | **CORTE_MANUAL** (limítrofe) | Caixa-alta de 5,2 cm, traço de 0,8 cm, 9 ilhas separadas. **Está no limiar** `cortavel_a_mao` que a doutrina admite não estar calibrado (§5). O entreletramento ajuda (nenhuma ilha encosta na outra). |
| Junção das portas | corte da máscara in situ | O monograma é centralizado e a junção passa pela sua perna direita: **cortar a máscara na junção com as portas fechadas**, senão ela rasga na primeira abertura. |

**Nota de lacuna na doutrina (vale para o motor):** se o shop decidir usar máscara
recortada a máquina para `DESDE 1994`, **não há ciclo de verniz** — a máscara vai
sobre a **chapa nua**, não sobre tinta. O §3.2 embute o verniz porque assume tinta
embaixo; o enum não tem um valor para "máscara de máquina sobre chapa nua". Isso
aparece em 3 artes desta fatia (esta, BELLAVER e CJ PILGER) e **muda o custo em ~3 h
por peça**. Sugestão: acrescentar `MASCARA_MAQUINA_SOBRE_CHAPA` ao enum do §5.

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo |
|---|---|---|
| S0 | D1 manhã | Lavar; **empapelar ferragens** (dobradiças, barras verticais, fechos, borrachas); aplicar e cortar as máscaras dos knockouts; cortar na junção das portas |
| S1 | D1 tarde | **Verde geral, sessão única** |
| S2 | D1 fim / D2 manhã | Remover máscaras, retoque de quinas de ferragem, verniz |

**Total: 1 dia**, com o empapelamento das ferragens sendo mais da metade do tempo.
Pintar na mesma leva de tinta da lateral, para bater o verde.

### 9. Armadilhas para o motor de visão
- **Painel 100% verde com grafismo branco**: um motor que use "% de branco conectado à borda" para decidir "chapa vs pintura geral" acerta que há pintura geral, mas pode concluir que o branco interno **é tinta**. Não é. Regra: branco **cercado** por uma única cor = knockout = custo zero de tinta.
- **Zero fronteiras T-T**, mas **1730 cm de corte T-F** — se o motor usar T-T como proxy de esforço, subestima esta peça em cheio. T-F custa **corte**, só não custa **proteção**.
- **`DESDE 1994` com traço de 0,8 cm** cai abaixo de 1 px em qualquer downscale agressivo e some. É exatamente o elemento que decide manual × máquina.
- **Terço inferior vazio**: um crop automático "de conteúdo" cortaria a peça e distorceria a escala de todos os outros elementos.
- **A junção das portas** é uma aresta física vertical no meio da peça, invisível no arquivo vetorial e visível em foto — o motor tem que sabê-la pelo tipo de vista, não pela imagem.
- Lateral e traseira compartilham o mesmo lock-up em **cores invertidas** (escuro sobre claro na lateral, branco sobre verde na traseira): um motor que casa artes por similaridade vai tratá-las como a mesma peça e reutilizar a estratégia errada.

### 10. Correções à `analysis_B.md`
Sem entrada individual no lote B. Correções aos padrões transversais aplicáveis:

| O padrão transversal antigo diz | Correção |
|---|---|
| Padrão 6: "Traseiras repetem a lateral em versão compacta" | Aqui a traseira **inverte** a lateral (fundo verde cheio × campo parcial) e por isso tem uma **estratégia completamente diferente**: pintura geral + knockouts, contra fita + máscaras isoladas. A generalização leva a copiar o plano errado. |
| Padrão 1: "região branca conectada ao fundo OU vazada dentro de máscara = chapa" | Certo, mas a `analysis_B` só aplica isso em artes com fundo de chapa. **Em painéis com pintura geral ela esquece a regra** (ver AGROMINA traseira, onde propõe pintar preto por cima do dourado). Esta arte é a prova de que a regra vale **também** sob pintura geral, e é onde ela mais economiza. |
| Padrão 5: texto pequeno "→ sempre vinil recortado" | `DESDE 1994` com 5,2 cm é **pintado**. Adesivo nunca é final. |
| Padrão 2: arquétipos "logo sobre chapa branca" × "arte fotográfica" | Falta o terceiro arquétipo, que é justamente este: **pintura geral com grafismo inteiramente em knockout de chapa** — 1 tinta, 0 T-T, custo concentrado em corte. |

---

# 5. AP RANCHARIA lateral

### 1. Implemento e substrato provável
Lateral de baú, proporção **3,17:1** (≈ 800 × 252 cm). Transportadora rodoviária de
carga geral ("LOGÍSTICA E TRANSPORTE RODOVIÁRIO"), sem nenhum indício de
refrigeração ou hortifrúti → **CHAPA_BRANCA** é o substrato provável, muito
possivelmente com frisos verticais.

Isso tem consequência direta pelo §4 e é o ponto mais importante desta arte: as
duas faixas vermelhas são curvas longas, e **em chapa a fita amarela não é
indicada**. A fita branca "não faz curva" e é o caso de traçado **muito vertical** —
estas faixas são quase horizontais. **Logo: nenhuma fita serve; as faixas caem para
CORTE_MANUAL.** Se a inspeção revelar isoplastic, elas viram FITA_AMARELA e a peça
economiza ~2 h de corte.

### 2. Fundo
**Sem pintura geral.** Chapa branca original ≈ **78%**. Todo o branco da arte é
chapa: o fundo, a fenda que divide o swoosh do monograma "AP" (~4 cm de largura) e
a faixa branca entre as duas bandas vermelhas (~22 cm). Nenhuma tinta branca.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Monograma vermelho com swoosh | `AP` | ≈ 240 × 87 cm; fenda branca interna de ~4 cm; cunha vermelha solta no canto inferior-esquerdo (~50 × 20 cm) |
| Banda vermelha superior | — | ≈ 340 cm de percurso, sangra na borda direita |
| Banda vermelha inferior | — | ≈ 415 cm de percurso, sangra na borda direita |
| Vão branco entre as bandas | — | ≈ 22 cm (chapa) |
| Nome (grafite) | `TRANSPORTADORA` | ≈ 342 cm × 29 cm de caixa-alta, bold itálico |
| Praça (cinza-médio) | `Rancharia-SP` | ≈ 172 cm × 21 cm de caixa-alta |
| Descritor (grafite) | `LOGÍSTICA E TRANSPORTE RODOVIÁRIO` | ≈ 225 cm × 11 cm |
| E-mail (cinza-médio) | `transportadora.ap@rancharia.com.br` | ≈ 215 cm × 11 cm |
| Telefone 1 (grafite) | `Fone (18) 3265-4855` | ≈ 132 cm × 13 cm |
| Telefone 2 (cinza-médio) | `(18) 3265-5143` | ≈ 110 cm × 13 cm |

### 4. Paleta
Três tintas, **todas chapadas, zero degradê**:
- **vermelho** vivo (monograma, swoosh, cunha, 2 bandas);
- **grafite** / quase-preto (`TRANSPORTADORA`, descritor, `Fone (18) 3265-4855`);
- **cinza-médio** (`Rancharia-SP`, e-mail, `(18) 3265-5143`).

Branco = chapa. É a paleta mais previsível da fatia.

### 5. Fronteiras T-T
**ZERO.** Verificação par a par:

| Par | Se tocam? | Folga medida |
|---|---|---|
| vermelho (`AP`/cunha) × grafite (`TRANSPORTADORA`) | **NÃO** | ≈ 10 cm de chapa entre a base do monograma e a caixa-alta do "T" |
| vermelho (bandas) × grafite (descritor / `Fone`) | **NÃO** | ≥ 35 cm |
| vermelho (bandas) × cinza-médio (e-mail / telefone 2) | **NÃO** | ≥ 35 cm |
| grafite (`TRANSPORTADORA`) × cinza-médio (`Rancharia-SP`) | **NÃO** | ≈ 8 cm entre linhas de base |
| grafite (descritor) × cinza-médio (e-mail) | **NÃO** | ≈ 6 cm |
| grafite (`Fone (18) 3265-4855`) × cinza-médio (`(18) 3265-5143`) | **NÃO** | ≈ 6 cm (linhas empilhadas) |

Os pares mais apertados são os blocos de texto empilhados (6–8 cm). **Verificar no
vetor** que nenhuma perna de "g"/"ç" desce até a linha seguinte — é o único risco
de virar T-T.

Fronteiras T-F relevantes (custo de corte, não de proteção): contorno das 2 bandas
(≈ 1500 cm de corte, contando as duas arestas de cada), contorno do monograma
(≈ 620 cm), a fenda branca interna do swoosh (≈ 260 cm) e os 6 blocos de texto
(≈ 2600 cm somados).

**Consequência §6.4: as três tintas na mesma sessão.** Nenhuma cura intermediária,
nenhuma máscara de segundo estágio, nenhum verniz intermediário.

### 6. Ordem de pintura
O §2 não tem par para ordenar. Ordem por overspray e ergonomia:

1. **Vermelho** primeiro — é a maior área de tinta (≈ 1,6 m²) e a que mais espalha; sair dela livra as máscaras de texto de contaminação.
2. **Grafite** e **cinza-médio** na sequência, na mesma jornada. Como grafite e cinza-médio são tons vizinhos, pintar o cinza-médio **por último** evita que salpico de grafite escureça o cinza (contaminação é mais visível no tom mais claro).

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Bandas vermelhas (2) | **CORTE_MANUAL** | 340 e 415 cm de curva **muito suave** (raio ≈ 1000 cm), quase reta. Pelo §4, em **chapa** nenhuma fita serve: a amarela é para isoplastic/lona, a branca não faz curva e é para traçado vertical. Máscara lisa + régua flexível + estilete. ≈ 1500 cm de corte, mas todo ele em curva mansa — é corte rápido. **Se isoplastic → FITA_AMARELA e o corte some.** |
| Monograma `AP` + swoosh | **CORTE_MANUAL** | 240 cm de largura; a fenda branca interna tem 4 cm — larga o bastante para dois cortes paralelos à mão. As pontas do swoosh afinam a r ≈ 2 cm: cortável nesta escala. |
| Cunha vermelha solta | **CORTE_MANUAL** | Trapézio de 50 cm, arestas retas. |
| `TRANSPORTADORA` | **CORTE_MANUAL** | Caixa-alta de 29 cm em bold itálico — traço de ~6 cm. Caso fácil. |
| `Rancharia-SP` | **CORTE_MANUAL** | Caixa-alta de 21 cm. |
| Bloco de contatos (4 linhas) | **CORTE_MANUAL** | Aqui está a correção mais importante da arte: em escala real esses textos têm **11–13 cm de altura de caixa-alta**, com traço de 2–3 cm. Isso é perfeitamente cortável com estilete. "Texto pequeno no arquivo" ≠ "texto pequeno no implemento". |

**Zero elementos de máquina. Zero degradê. Zero cura intermediária.** Junto com a
AVGLOG, é o piso de custo da fatia.

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo |
|---|---|---|
| S0 | D1 manhã | Lavar; **empapelar frisos**, perfis, borrachas; aplicar máscaras e cortar: 2 bandas, monograma, cunha, 6 blocos de texto |
| S1 | D1 tarde | **Sessão única de cor**: vermelho → grafite → cinza-médio (§6.4) |
| S2 | D1 fim / D2 manhã | Remover máscaras, retocar onde as bandas atravessam friso, verniz geral |

**Total: 1 dia por lado.** No lado oposto as bandas e o swoosh **espelham** (para
apontarem para a frente nos dois lados); **os textos não espelham**.

### 9. Armadilhas para o motor de visão
- **A fenda branca de 4 cm dentro do swoosh** e o **vão de 22 cm entre as bandas** são chapa. Um segmentador os lê como "objeto branco pintado" e cria dois elementos + duas fronteiras que não existem.
- **Grafite × cinza-médio** têm ΔE moderado: a quantização pode fundi-los numa cor só e apagar o fato de haver **três** tintas — o que muda o número de máscaras.
- **Itálico com anti-aliasing nas diagonais** de `TRANSPORTADORA` gera pixels intermediários que parecem uma quarta cor.
- **Escala**: sem cota no arquivo, o motor tende a chamar o bloco de contatos de "texto minúsculo → vinil". A 11–13 cm reais ele é pintado. **Extrair escala é pré-requisito para a árvore do §3**, não um detalhe.
- **As bandas sangram na borda direita** — o motor precisa saber que elas continuam para além do arquivo e não fechar o polígono na borda (isso subestima o perímetro em ~15%).
- **Zero T-T** é a informação de maior valor econômico desta arte e é justamente a que um pipeline sem classificação T-T/T-F não produz.

### 10. Correções à `analysis_B.md` (item 12)
| A análise antiga diz | Correção |
|---|---|
| "**contatos pequenos em vinil recortado**" | **ERRADO — adesivo nunca é produto final.** Em escala real são 11–13 cm de caixa-alta: **CORTE_MANUAL**. |
| "fones em vermelho = 2ª cor no bloco pequeno (**vinil resolve**)" | Idem, e além disso a leitura está errada: os telefones são **grafite e cinza-médio**, não vermelho. Nenhum texto desta arte é vermelho. |
| "**Faixas swoosh longas: fita amarela flexível** — o caso-alvo da técnica" | Conclusão certa pelo motivo errado, e provavelmente errada no substrato. O §4 amarra a fita amarela a **isoplastic ou lona**. A análise antiga afirmou "chapa branca com frisos prováveis" no item (1) e mesmo assim indicou fita amarela — **contradiz o próprio diagnóstico de substrato**. Em chapa, as bandas são CORTE_MANUAL. |
| "Monograma AP + swoosh: **máscara plotada**" | Máquina não se justifica: 240 cm com fenda de 4 cm é cortável à mão. §3.1 é o preferido justamente para evitar máquina + verniz. |
| "Textos: **máscara plotada**" | Idem — 21–29 cm de caixa-alta. |
| "Tinta-tinta: **NENHUMA**" | **Correto** — o único achado da `analysis_B` sobre esta arte que a doutrina confirma. Faltou, porém, o que a doutrina exige junto: dizer que **por isso as três tintas vão na mesma sessão** (§6.4), que é de onde vem o "1 dia". |
| Nenhuma medida de comprimento de fronteira em cm | Exigência do §1. Ausente. |

---

# 6. AVGLOG lateral

### 1. Implemento e substrato provável
Lateral de baú, proporção **3,47:1** (≈ 800 × 230 cm). "AVG LOG TRANSPORTES", carga
geral, sem indício de refrigeração → **CHAPA_BRANCA** provável, possivelmente com
frisos.

Consequência pelo §4: **irrelevante nesta arte**, porque não há uma única faixa nem
uma única curva longa. Todo o desenho é composto de segmentos retos e letras
geométricas fechadas. Substrato só importaria se houvesse faixa; aqui não há. É a
arte da fatia em que a escolha de fita simplesmente não se coloca.

### 2. Fundo
**Sem pintura geral.** Chapa branca original ≈ **85%**. O arquivo mostra o fundo em
cinza-clarííssimo (≈ #F0F0F0), que é tinta de render — trata-se da chapa. Mesma
ressalva da ATACADÃO lateral: **confirmar no vetor**; se for cinza-claro chapado de
verdade, a arte ganha 8 m² de pintura e vira 2 dias.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Triângulo vermelho superior (forma de "A") | — | apex em cima, ≈ 130 × 75 cm, arestas retas |
| Barra preta superior (paralelogramo) | — | ≈ 125 × 18 cm |
| Triângulo vermelho invertido (forma de "V") | — | ≈ 130 × 88 cm, arestas retas |
| Barra preta inferior (paralelogramo) | — | ≈ 125 × 21 cm |
| Nome (preto) | `AVG LOG` | ≈ 400 cm × 50 cm de caixa-alta, itálico geométrico pesado |
| Descritor (cinza-médio) | `TRANSPORTES` | ≈ 368 cm × 30 cm de caixa-alta, itálico |
| Site (preto) | `WWW.AVGLOG.COM.BR` | ≈ 192 cm × 12 cm |
| E-mail (preto) | `contato@avglog.com.br` | ≈ 195 cm × 11 cm |
| Telefone (preto) | `(31) 3532-7630` | ≈ 135 cm × 13 cm |

### 4. Paleta
Três tintas, **todas chapadas, zero degradê**:
- **vermelho** vivo (os dois triângulos da marca);
- **preto** (as duas barras da marca, `AVG LOG`, e as três linhas de rodapé);
- **cinza-médio** (`TRANSPORTES`).

Branco = chapa (fundo + as fendas internas do símbolo).

### 5. Fronteiras T-T
**ZERO confirmadas, 2 candidatas a verificar.**

| Par | Se tocam? | Observação |
|---|---|---|
| vermelho (triângulo "A") × preto (barra superior) | **provavelmente NÃO** | Na renderização há um respiro branco de ~1–1,5 cm entre a aresta direita do triângulo e a ponta esquerda da barra. **VERIFICAR NO VETOR.** Se não houver respiro: 1 fronteira **RETA** de ≈ 20 cm; o preto cobre mais (0,26 m² de barras vs 0,10 m² do triângulo superior). |
| vermelho (triângulo "V") × preto (barra inferior) | **provavelmente NÃO** | Mesmo respiro de ~1–1,5 cm. Se houver contato: 1 fronteira **RETA** de ≈ 25 cm. |
| preto (`AVG LOG`) × cinza-médio (`TRANSPORTES`) | **NÃO** | ≈ 15 cm de folga vertical |
| vermelho × qualquer texto | **NÃO** | ≥ 25 cm |
| preto (rodapé) × cinza-médio | **NÃO** | ≥ 20 cm |

O respiro branco de 1–1,5 cm é um recurso de design deliberado (keyline) e é o que
mantém a arte em zero T-T. **Se confirmado, as três tintas vão na mesma sessão.**
Mesmo no pior caso (2 contatos retos somando 45 cm), o custo extra é de ~15 min de
fita: reta curta é o caso mais barato de T-T que existe.

Fronteiras T-F: perímetro do símbolo (≈ 700 cm, **100% em segmentos retos**),
`AVG LOG` (≈ 950 cm), `TRANSPORTES` (≈ 900 cm), rodapé (≈ 1500 cm).

### 6. Ordem de pintura
Sem T-T confirmada, o §2 não tem par para ordenar. Ordem por overspray:

1. **Preto** (maior área de tinta, ≈ 1,5 m²) primeiro.
2. **Vermelho**.
3. **Cinza-médio** por último (tom mais claro, mais sensível a salpico).

Se as candidatas T-T se confirmarem, o §2 inverte o par no ponto de contato: o
triângulo vermelho é a **menor** cobertura ⇒ **vermelho primeiro, mascara o
vermelho, preto por cima**. Como são só 45 cm de contato reto, isso significa duas
tiras de fita, não uma sessão a mais.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Símbolo inteiro (2 triângulos + 2 barras) | **CORTE_MANUAL** | 208 × 113 cm, **todas as arestas são segmentos retos**. Régua + estilete. É o elemento mais fácil de cortar de toda a fatia — nem sequer há um raio a negociar. Menor detalhe: o respiro de 1–1,5 cm entre vermelho e preto. |
| `AVG LOG` | **CORTE_MANUAL** | Caixa-alta de **50 cm**, itálico geométrico com traço de ~12 cm; contraformas do "G" e do "O" com raio ≥ 8 cm. Trivial. |
| `TRANSPORTES` | **CORTE_MANUAL** | Caixa-alta de 30 cm. |
| Rodapé (site / e-mail / telefone) | **CORTE_MANUAL** | 11–13 cm de altura, traço de 2–3 cm. Cortável. Os únicos pontos delicados são o "@" do e-mail (espiral de raio ~1,5 cm, 1 unidade) e os parênteses. |

**Zero máquina, zero verniz intermediário, zero cura entre cores.**

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo |
|---|---|---|
| S0 | D1 manhã | Lavar; empapelar frisos, perfis, borrachas; aplicar máscaras e cortar (símbolo com régua, 2 blocos de nome, 3 linhas de rodapé) |
| S1 | D1 tarde | **Sessão única**: preto → vermelho → cinza-médio (§6.4) |
| S2 | D1 fim / D2 manhã | Remover máscaras, retocar friso, verniz geral |

**Total: 1 dia por lado**, e é o **piso de custo da fatia**. Os textos **não
espelham**; o símbolo é assimétrico e também não deve espelhar (o "A/V" ficaria
invertido) — repetir idêntico nos dois lados.

### 9. Armadilhas para o motor de visão
- **O respiro branco de 1–1,5 cm entre vermelho e preto** é a informação decisiva da arte inteira: com ele há 0 T-T, sem ele há 2. Em qualquer downscale ele fica sub-pixel e **desaparece**, e o motor passa a reportar 2 fronteiras T-T inexistentes. Esta é a armadilha mais instrutiva da fatia: **medir T-T exige resolução na fronteira, não na região**.
- **Encaixe vermelho/preto sem respiro visual** produz, no anti-aliasing, pixels marrom-escuros lidos como uma quarta cor de transição.
- **Fundo #F0F0F0** — mesmo risco da ATACADÃO lateral: chapa classificada como tinta cinza.
- **Preto (`AVG LOG`) e cinza-médio (`TRANSPORTES`)** empilhados e no mesmo estilo itálico: OCR os junta e o motor perde as duas cores.
- **O símbolo é vazado**: as fendas brancas entre as barras e os triângulos são chapa. Um contador de regiões as trata como elementos pintáveis.
- **Todas as arestas retas** deveriam disparar o caminho mais barato da árvore. Um motor que só olhe "número de regiões" (9 elementos) vai classificar esta arte como média, quando o histograma de curvatura diria "100% reta ⇒ trivial".

### 10. Correções à `analysis_B.md`
Sem entrada individual no lote B. Correções aos padrões transversais aplicáveis:

| O padrão transversal antigo diz | Correção |
|---|---|
| Padrão 5: "blocos legais minúsculos ... → **sempre vinil recortado/impresso aplicado após o verniz**" | O rodapé desta arte tem 11–13 cm de caixa-alta e é **pintado** com máscara cortada à mão. Adesivo nunca é final. |
| Padrão 3: "fronteiras retas (mosaico ACM, monograma AKTL) → **fita de corte**" | Para um símbolo fechado de arestas retas o caminho é **máscara lisa + corte manual com régua**, não fita. Fita é o instrumento de **faixa** (§4) e depende do substrato. |
| Padrão 4: "Fronteiras tinta-tinta reais são raras ... quando existem: **encaixe direto de letras (AKTL — fita reta)**" | O diagnóstico do arquétipo está certo (esta arte é o gêmeo da AKTL), mas a `analysis_B` **assume** o contato sem medir o respiro. Aqui o respiro de 1–1,5 cm provavelmente elimina a fronteira. **Medir antes de afirmar** é exatamente o que o §1 acrescenta. |
| "Ideias para o motor": aresta "cor × branco-de-fundo = **só adesivo**" | Nomenclatura que sugere entrega adesiva. É **T-F**: custa corte, não custa proteção. |
| A análise antiga do arquétipo AKTL diz "pintar amarelo primeiro ... laca seca rápido, fita em ~1h" | A intuição de ordem está certa mas o critério é acidental. O §2 dá o critério objetivo: **menor cobertura primeiro**. Aqui isso significaria vermelho antes de preto. |

---

# 7. BELLAVER FRUTAS

### 1. Implemento e substrato provável
Vista única, proporção **3,16:1** (≈ 800 × 253 cm) — compatível com lateral de baú.
"Frutas Selecionadas" → hortifrúti → baú **isotérmico**, **ISOPLASTIC** provável.

Consequência pelo §4: **fita amarela liberada**, mas **não há faixa nesta arte** —
nenhum elemento é uma faixa longa. O substrato importa por outro motivo: em
isoplastic, máscara sobre a face lisa adere bem e o corte in situ é limpo; em chapa
com frisos, as ~45 fendas finas da maçã atravessariam relevo e sangrariam.

### 2. Fundo
**Sem pintura geral.** Chapa original ≈ **88%**. O arquivo mostra o fundo em
cinza-clarííssimo (≈ #EFEFEF) — mesma ressalva das artes 3 e 6: é a chapa.

Todo o branco da arte é chapa: o fundo **e** as ~45 fendas internas da maçã. **A
maçã não tem "riscos brancos pintados"** — ela tem tinta vermelha aplicada por uma
máscara cheia de ilhas.

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Maçã/coração em pinceladas (vermelho) | — | ≈ 175 × 158 cm; preenchimento "riscado" com **~45 fendas de chapa** de 1,5–4 cm de largura × 10–60 cm de comprimento, muitas afinando em ponta (r < 0,5 cm); contorno externo rasgado, com dezenas de reentrâncias |
| Folha (verde-vivo) | — | ≈ 172 × 77 cm; amêndoa lisa + haste curva que afina em ponta |
| Nome (verde-escuro) | `Bellaver` | ≈ 385 cm; "B" de 87 cm; x-height ≈ 57 cm; traço ≈ 11 cm |
| Assinatura (vermelho itálico) | `Frutas Selecionadas` | ≈ 143 cm × 15 cm de caixa-alta |

### 4. Paleta
Quatro cores, **todas chapadas — zero degradê em toda a arte**:
- **vermelho** vivo (maçã + `Frutas Selecionadas`);
- **verde-vivo** (folha);
- **verde-escuro / musgo** (`Bellaver`) — **é uma segunda tinta verde**, bem distinta do verde da folha;
- **branco** = chapa (fundo + as 45 fendas da maçã).

O fato de haver **dois verdes** que **não se tocam** é o que permite pintá-los na
mesma sessão.

### 5. Fronteiras T-T
**1 confirmada.**

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | verde-vivo (haste da folha) × vermelho (maçã) | ≈ **25–35 cm** (as duas bordas da haste onde ela avança sobre a zona de pinceladas) | **FECHADA→EXTREMA** — a haste afina para ponta, raio < 1 cm no extremo | **vermelho** (≈ 0,89 m² incl. a assinatura, contra ≈ 0,73 m² da folha) |

Pares que **não se tocam** (e por isso vão juntos):

| Par | Se tocam? | Folga |
|---|---|---|
| verde-escuro (`Bellaver`) × verde-vivo (folha) | **NÃO** | ≈ 10 cm |
| verde-escuro (`Bellaver`) × vermelho (`Frutas Selecionadas`) | **NÃO** | ≈ 7,5 cm — **é o par mais apertado da arte; verificar no vetor** se nenhuma perna de "Bellaver" desce até o itálico |
| verde-escuro × vermelho (maçã) | **NÃO** | ≥ 240 cm |
| vermelho (`Frutas Selecionadas`) × verde-vivo | **NÃO** | ≥ 480 cm |

Fronteiras T-F (custo de corte): contorno externo rasgado da maçã (≈ 900 cm,
curvatura irregular) + **as 45 fendas internas (≈ 3600 cm de corte, contando as
duas arestas de cada)** + folha (≈ 420 cm) + `Bellaver` (≈ 1400 cm) +
`Frutas Selecionadas` (≈ 500 cm).

**O custo desta arte está concentrado numa única fronteira T-F**: as fendas da maçã.
Uma única fronteira T-T de 30 cm é ruído no orçamento.

### 6. Ordem de pintura
Um par T-T ⇒ uma aplicação do §2:

- **T-T 1 (verde-vivo × vermelho):** o vermelho cobre mais área (0,89 m² contra 0,73 m²) ⇒ **pinta o verde-vivo primeiro, mascara a folha inteira, pinta o vermelho por cima.**
  Isso também coincide com o empilhamento visual (a folha está **na frente** da maçã): pintar o vermelho por último e mascarar a folha produz exatamente a sobreposição desenhada.
- **verde-escuro (`Bellaver`)** não toca ninguém ⇒ entra na **mesma sessão do verde-vivo** (§6.4), com máscara própria.
- **vermelho (`Frutas Selecionadas`)** não toca ninguém ⇒ entra na **mesma sessão do vermelho da maçã**.

Resultado: **duas sessões de cor**, separadas apenas pela cura da folha — e a laca
cura rápido, então cabem no mesmo dia.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Maçã em pinceladas | **MASCARA_MAQUINA_SOBRE_VERNIZ** (com ressalva) | "Um humano consegue cortar isso com estilete, no implemento?" — **Não em tempo são.** São ~45 fendas de 1,5–4 cm de largura, muitas com ponta de r < 0,5 cm, mais um contorno externo com dezenas de reentrâncias: ≈ **40 m de corte** em detalhe sub-4 cm. É o caso literal do §3.2 ("pequeno demais e tem dezenas de detalhes"). **Ressalva:** a máscara vai sobre a **chapa nua** (o vermelho é a primeira tinta naquela região), logo **não há verniz nem espera de cura** — o ciclo de verniz do §3.2 existe para proteger tinta subjacente, e aqui não há. O custo é só a máquina de corte. Ver a nota de lacuna no enum na arte 4. |
| Folha | **CORTE_MANUAL** | 172 cm, uma amêndoa lisa e uma haste; único detalhe fino é a ponta da haste (r < 1 cm), e ponta é o que estilete faz melhor. |
| `Bellaver` | **CORTE_MANUAL** | x-height de 57 cm, traço de 11 cm, contraformas de raio ≥ 10 cm. Caso fácil. |
| `Frutas Selecionadas` | **CORTE_MANUAL** | Caixa-alta de 15 cm em itálico fino — limítrofe, mas cortável. Se a arte for aplicada a menos de ~500 cm de largura total, migra para a mesma máscara de máquina da maçã (o registro já está pago). |

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo | Cura |
|---|---|---|---|
| S0 | D1 manhã | Lavar; empapelar perfis e borrachas; aplicar a máscara de máquina da maçã na **chapa nua** (sem verniz); cortar à mão as máscaras da folha, `Bellaver` e `Frutas Selecionadas` | — |
| S1 | D1 tarde | **Verde-vivo (folha) + verde-escuro (`Bellaver`)** — mesma sessão, não se tocam (§6.4) | laca, ~1–2 h |
| S2 | D1 fim | Mascarar a folha (§2: menor cobertura já pintada); **vermelho (maçã + `Frutas Selecionadas`)** | noite |
| S3 | D2 manhã | Remover máscaras, retoques nas pontas das fendas, verniz geral | — |

**Total: 1,5 dia.** O gargalo não é pintura — é a aplicação e depilação da máscara
de 45 ilhas da maçã.

### 9. Armadilhas para o motor de visão
- **A maçã parece "textura de pincel" e não é.** É uma forma vetorial com ~45 furos. Um motor que aplique detector de textura fotográfica vai marcá-la como bloco fotográfico e disparar uma pendência de aerografia que **não existe**. O discriminante: as fendas são **branco puro idêntico ao fundo** (chapa), não tons intermediários.
- **Inversamente**, um quantizador que erode 1–2 px nas fronteiras antes de fundir (a receita da própria `analysis_B`) **apaga as fendas de 1,5 cm** e transforma a maçã numa mancha vermelha chapada — o que inverteria a decisão de máquina para manual e erraria o custo em horas.
- **Dois verdes distintos** (folha viva × `Bellaver` musgo) com ΔE grande: risco baixo de fusão, mas um motor que agrupe por matiz os junta e perde uma máscara.
- **O contato folha × maçã é ambíguo por natureza**: a haste avança sobre pinceladas esparsas, então "quanto" de contato existe depende de quais riscos ela cruza. O motor vai medir um comprimento instável entre execuções. Tratar como **um** contato de ordem de grandeza 30 cm, não como N micro-contatos.
- **Folga de 7,5 cm entre `Bellaver` e `Frutas Selecionadas`** é o único ponto que pode virar T-T; em downscale os dois blocos se fundem.
- **Sem cota no arquivo**: a maçã só é "não-cortável" porque as fendas têm 1,5–4 cm na escala assumida. Se a arte for aplicada com 300 cm de largura, as fendas caem para 0,6–1,5 cm e o caso fica **ainda mais** de máquina; se for aplicada em 12 m, as fendas passam de 2 cm e o corte manual volta a ser discutível.

### 10. Correções à `analysis_B.md`
Sem entrada individual no lote B. Correções aos padrões transversais aplicáveis:

| O padrão transversal antigo diz | Correção |
|---|---|
| Padrão 2: arquétipo (b) "arte fotográfica/full-bleed → **impressão digital obrigatória**" | A maçã pincelada é exatamente o tipo de elemento que a `analysis_B` classificaria como "textura → imprimir". **Não é fotográfica e não é impressa.** É máscara com 45 ilhas + tinta vermelha chapada. |
| Padrão 7: "**Degradê = decisor de técnica**: degradê pequeno → **imprimir**" | Regra inválida por completo (nada é impresso), e irrelevante aqui: **esta arte não tem degradê nenhum**. |
| Padrão 5: "selos com degradê metálico pequeno, ... → **sempre vinil recortado/impresso aplicado após o verniz**" | Adesivo nunca é final. |
| Padrão 3: "**ponta fina ou talo → máscara plotada, sem exceção**" | Falso. A haste da folha tem ponta fina em 172 cm e é **corte manual** — ponta é justamente o que estilete faz bem. O que força a máquina não é "ter ponta", é **densidade de detalhe abaixo do limiar de corte** (as 45 fendas). |
| A lista de técnicas por aresta do "motor" ("fita reta / fita flexível / máscara plotada / cura+adesivo") | Não contém **CORTE_MANUAL**, que é a estratégia de 3 dos 4 elementos desta arte. |
| A `analysis_B` nunca ordena um par pela **cobertura** | Aqui a ordem correta (verde-vivo antes de vermelho) só sai aplicando o §2. Sem essa regra, o instinto seria pintar a maçã (elemento principal) primeiro e depois lutar para encaixar a folha. |

---

# 8. CJ PILGER

### 1. Implemento e substrato provável
Vista única, proporção **3,46:1** (≈ 800 × 231 cm) — compatível com lateral de baú.
"Citricultura / Comércio" → transporte de cítricos → baú **isotérmico** ou baú de
carga com face lisa; **ISOPLASTIC** provável, com chapa branca como alternativa.

Consequência pelo §4: **irrelevante aqui**, porque **não há faixa**. Todo o desenho
é logotipo fechado. O substrato importa por adesão da máscara: a fruta exige uma
máscara com ~15 ilhas finas, e face lisa (isoplastic) reduz muito o risco de
sangria; em chapa com frisos, as cunhas de 2–3,5 cm cruzando relevo sangrariam.

### 2. Fundo
**Sem pintura geral.** Chapa branca original ≈ **85%** — aqui o arquivo traz branco
puro, sem a ambiguidade das artes 3, 6 e 7.

Todo o branco é chapa: o fundo, **os gomos da laranja**, o miolo em estrela, os 3
brilhos em gota, a faixa que separa a meia-laranja da laranja inteira e a nervura
central de uma das folhas. **Nada disso é tinta branca.**

### 3. Inventário de elementos
| Elemento | Texto exato | Medida estimada |
|---|---|---|
| Crescente "C/J" (verde-escuro) | — | ≈ 184 × 175 cm; espessura do anel ≈ 37 cm; haste do "J" afina de 45 cm até ponta de r ≈ 1–2 cm |
| Laranja inteira (laranja) | — | círculo de ≈ 110 cm de diâmetro |
| Meia-laranja com gomos (laranja) | — | ≈ 88 × 107 cm |
| Gomos / divisórias (chapa) | — | ~10 cunhas de **2–3,5 cm** de largura × 20–45 cm |
| Miolo em estrela (chapa) | — | roseta de ~10 pontas de **1,5–2,5 cm** |
| Brilhos em gota (chapa) | — | 3 gotas de ≈ 4 × 7 cm |
| Separação meia/inteira (chapa) | — | faixa de ≈ 3 cm |
| Folhas (verde-escuro) | — | ≈ 45 × 72 cm, 3 folhas + haste; 1 nervura em chapa de ≈ 1,5 cm |
| Nome (quase-preto) | `Pilger` | ≈ 330 × 175 cm (com a descendente do "g"); traço grosso ≈ 27 cm; terminais de script ≈ 2,5 cm |
| Descritor 1 (laranja) | `Citricultura` | ≈ 135 cm × 16 cm de caixa-alta |
| Descritor 2 (laranja) | `Comércio` | ≈ 112 cm × 16 cm de caixa-alta |

### 4. Paleta
Três tintas, **todas chapadas — zero degradê**:
- **verde-escuro** (crescente + haste + folhas);
- **laranja** (fruta inteira + meia-laranja + `Citricultura` + `Comércio`);
- **quase-preto / grafite-quente** (`Pilger`).

Branco = chapa. É a arte com mais T-T da fatia **sem ter nenhum degradê** — a
complexidade vem de sobreposição de formas, não de tonalidade.

### 5. Fronteiras T-T
**3 confirmadas + 1 candidata.**

| # | Par | Extensão | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T-T 1 | laranja (fruta) × verde-escuro (borda interna do anel "C") | ≈ **105 cm** de arco | **MÉDIA** — raio ≈ 55 cm (o raio interno do crescente) | **verde-escuro** (≈ 1,05 m² contra ≈ 0,88 m² do laranja) |
| T-T 2 | laranja (fruta) × verde-escuro (haste do "J" que atravessa a fruta) | ≈ **90 cm** (2 bordas × ~45 cm) | **FECHADA** — a haste afina para ponta, r de 1–2 cm no extremo | **verde-escuro** |
| T-T 3 | laranja (fruta) × verde-escuro (folhas sobre o topo-direito) | ≈ **45 cm** | **FECHADA→EXTREMA** — pontas de folha com r ≈ 1 cm | **verde-escuro** |
| T-T 4 | laranja (`Citricultura` / `Comércio`) × quase-preto (laço da descendente do "g" de `Pilger`) | **candidata: 2 contatos de ≈ 8 cm** | MÉDIA | quase-preto (≈ 1,15 m² contra 0,08 m² dos dois descritores) |

Sobre a T-T 4: na renderização há folga de **3–5 cm** entre o laço do "g" e as
palavras. **Verificar no vetor.** Se tocar, são dois contatos curtos e de curvatura
mansa — 20 min de fita, não uma sessão.

Pares que **não se tocam:**
| Par | Folga |
|---|---|
| quase-preto (`Pilger`) × verde-escuro (crescente/folhas) | ≈ 22 cm |
| quase-preto (`Pilger`) × laranja (fruta) | ≥ 35 cm |
| laranja (descritores) × verde-escuro | ≥ 60 cm |

Fronteiras T-F: contorno externo do crescente e das folhas (≈ 900 cm), contorno da
fruta contra a chapa (≈ 180 cm), **os gomos + miolo + brilhos + faixa (≈ 900 cm de
corte em detalhe de 1,5–3,5 cm)**, `Pilger` (≈ 1400 cm) e os dois descritores
(≈ 700 cm).

### 6. Ordem de pintura
Três aplicações do §2, todas apontando na mesma direção:

1. **T-T 1, 2 e 3 (laranja × verde-escuro):** o verde-escuro cobre mais (≈ 1,05 m² contra ≈ 0,88 m²) ⇒ **pinta o laranja primeiro, mascara a fruta inteira, pinta o verde-escuro por cima.**
   Coincide com o empilhamento visual: o crescente, a haste do "J" e as folhas estão **na frente** da fruta. Pintar o verde por último e mascarar a fruta produz exatamente essa sobreposição.
2. **`Citricultura` / `Comércio`** são laranja e não tocam nada além da candidata T-T 4 ⇒ **mesma sessão do laranja da fruta** (§6.4).
3. **T-T 4 (candidata, laranja × quase-preto):** o quase-preto cobre muito mais ⇒ o laranja já vem antes pela regra 2, o que resolve a ordem sem nenhum ajuste. **Mascara-se apenas os ~16 cm de contato**, não os textos inteiros.
4. **`Pilger`** não toca verde nem a fruta (22 cm de folga) ⇒ **mesma sessão do verde-escuro**.

Resultado: **duas sessões de cor**, e o §2 nunca entra em conflito com o
empilhamento visual — o que é raro e vale registrar.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3) |
|---|---|---|
| Fruta (inteira + meia, com gomos, miolo, brilhos e faixa) | **MASCARA_MAQUINA_SOBRE_VERNIZ** (com a mesma ressalva da arte 7) | **Não é cortável à mão.** O impeditivo específico é o **miolo em estrela: ~10 pontas de 1,5–2,5 cm convergindo num ponto**. Somam-se ~10 cunhas de 2–3,5 cm e 3 gotas de 4 cm — "dezenas de detalhes" do §3.2, literalmente. **Ressalva:** a máscara vai sobre a **chapa nua** (laranja é a primeira tinta ali) ⇒ **sem verniz, sem espera de cura**. Só o custo da máquina. |
| Crescente "C" + haste do "J" | **CORTE_MANUAL** | 184 cm, anel de 37 cm de espessura, raios de 45–90 cm; o único detalhe fino é a ponta da haste (r 1–2 cm), que estilete resolve. Não há motivo para máquina. |
| Folhas | **CORTE_MANUAL** (limítrofe) | 72 cm de altura, 3 peças, pontas de r ≈ 1 cm e uma nervura em chapa de 1,5 cm. Cortável, mas se a máquina já vai ser paga pela fruta, **agregar as folhas à mesma máscara custa quase nada** e elimina o risco na nervura. Decidir com o pintor. |
| `Pilger` | **CORTE_MANUAL** | Script de 330 cm com traço grosso de 27 cm; os terminais afinam a ~2,5 cm — largo o bastante para estilete nesta escala. |
| `Citricultura` / `Comércio` | **CORTE_MANUAL** | Caixa-alta de 16 cm, traço de ~2,5 cm. Cortável. |

### 8. Sequência de sessões e dias
| Sessão | Dia | Conteúdo | Cura |
|---|---|---|---|
| S0 | D1 manhã | Lavar; empapelar perfis e borrachas; aplicar a máscara de máquina da fruta na **chapa nua**; cortar à mão as máscaras do crescente, folhas, `Pilger` e descritores | — |
| S1 | D1 tarde | **Laranja**: fruta + `Citricultura` + `Comércio` — mesma sessão, não se tocam (§6.4) | laca, ~1–2 h |
| S2 | D1 fim / D2 manhã | Mascarar a fruta inteira (§2); **verde-escuro** (crescente + haste + folhas) + **quase-preto** (`Pilger`) — mesma sessão, verde e preto não se tocam (22 cm) | noite |
| S3 | D2 | Remover máscaras; retoque nas 3 fronteiras T-T (245 cm somados) e nas pontas da roseta; verniz geral | — |

**Total: 1,5–2 dias.** O que empurra para 2 dias não são as fronteiras T-T (245 cm
é pouco) — é a **depilação da máscara da fruta**, com ~15 ilhas de 1,5–3,5 cm.

### 9. Armadilhas para o motor de visão
- **Os gomos brancos da laranja são chapa, não tinta branca.** Um motor que os leia como "branco pintado" inventa uma quarta tinta e ~900 cm de fronteira inexistente.
- **O miolo em estrela** (~10 pontas de 1,5–2,5 cm) é o **único** detalhe que decide máquina × manual na arte inteira. Ele desaparece em qualquer downscale abaixo de ~800 px de largura. Um motor que decida em thumbnail vai dizer "corte manual" e errar por horas de retrabalho.
- **A haste do "J" cruza a fruta**: em segmentação por cor isso gera **duas regiões laranjas desconexas** (acima e abaixo da haste) e o motor conta 2 elementos laranja em vez de 1 — inflando o número de máscaras.
- **Sobreposição sem contorno**: o verde está na frente do laranja sem keyline. O anti-aliasing na fronteira produz tons oliva lidos como uma quarta cor e como fronteira dupla (laranja→oliva→verde).
- **Folga de 3–5 cm entre `Citricultura`/`Comércio` e o laço do "g"** — decide a existência da T-T 4. Sub-pixel em thumbnail.
- **`Pilger` é script com traço de 27 cm**: um heurístico "script ⇒ máquina" (que é o que a `analysis_B` propõe) erra aqui. O que decide é o **menor detalhe em cm**, não a classe tipográfica.
- **Duas laranjas sobrepostas** (inteira atrás, meia na frente) separadas por uma faixa de chapa de 3 cm: o motor pode fundi-las numa mancha só e perder a faixa, que é o elemento que dá a leitura de "fruta cortada".

### 10. Correções à `analysis_B.md`
Sem entrada individual no lote B. Correções aos padrões transversais aplicáveis:

| O padrão transversal antigo diz | Correção |
|---|---|
| Padrão 3: "**serifa, script, ponta fina ou talo → máscara plotada, sem exceção**" | Falso três vezes nesta arte: `Pilger` é **script** e vai a corte manual (traço de 27 cm); a **ponta** da haste do "J" vai a corte manual; as **folhas** (o "talo" do padrão) são limítrofes por conveniência, não por regra. O critério da doutrina é **menor detalhe em cm no implemento**. |
| Padrão 4: "detalhe pequeno sobre cor (talos ADRI) → **cura 3h + adesivo** ou registro plotado" | Aqui a ordem correta do §2 (laranja primeiro, mascara, verde por cima) **elimina** a necessidade de pintar detalhe verde sobre laranja curado. A `analysis_B` resolve esse arquétipo pela ordem inversa e paga uma cura que não precisava existir. |
| Padrão 5: "elementos não-pintáveis padronizados ... → **sempre vinil recortado/impresso aplicado após o verniz**" | Nada nesta arte é não-pintável. Adesivo nunca é final. |
| Padrão 1: "região branca conectada ao fundo OU vazada dentro de máscara = chapa" | Certo — e é a regra que salva os gomos, o miolo e os brilhos. Mas a `analysis_B` só a aplica a **letras vazadas**; aqui ela precisa valer para **ilhas gráficas dentro de uma forma pintada** (roseta, cunhas, gotas), que é onde ela mais economiza. |
| "Ideias para o motor": técnicas por aresta sem **CORTE_MANUAL** e sem medir **comprimento em cm** | 4 dos 5 elementos desta arte são corte manual, e as 3 fronteiras T-T somam **245 cm** — número que a rubrica antiga não produz e sem o qual não dá para saber que a arte é de 1,5 dia e não de 3. |

---

# Padrões transversais desta fatia (v2)

1. **Metade da fatia tem ZERO fronteiras T-T** (artes 3, 4, 5, 6). Em todas elas as
   cores estão separadas por chapa ou por keyline branca. Consequência do §6.4:
   **todas as tintas na mesma sessão, 1 dia por peça.** Esta é a informação de maior
   valor econômico do documento e é exatamente a que a rubrica antiga não produzia.

2. **Escala decide técnica, não forma.** O mesmo script `Agromina` é **corte manual**
   na lateral (305 cm) e **máscara de máquina** na traseira (77 cm). Qualquer regra
   do tipo "script ⇒ plotter" está errada. O limiar `cortavel_a_mao` do §5 deve ser
   função de **menor detalhe em cm no implemento**, e a fatia sugere um valor
   ancorado por: cortável a partir de ~2,5 cm de menor detalhe (terminais de
   `Pilger`, fendas largas da maçã); não cortável abaixo de ~2 cm quando há
   **dezenas** de instâncias (roseta do CJ Pilger a 1,5–2,5 cm; linhas do porco a
   0,8 cm; módulos de QR a 0,93 cm). O número de instâncias pesa tanto quanto a
   largura.

3. **"Máscara de máquina sobre chapa nua" é um caso que o enum do §5 não tem.** Nas
   artes 4, 7 e 8 a máscara recortada a máquina vai direto na chapa, porque a cor
   que ela delimita é a **primeira** naquela região. Não há tinta embaixo, logo não
   há verniz nem espera. Usar `MASCARA_MAQUINA_SOBRE_VERNIZ` para esses casos
   **superestima o cronograma em ~3 h por peça**. Sugestão: acrescentar
   `MASCARA_MAQUINA_SOBRE_CHAPA`.

4. **Branco = chapa vale também sob pintura geral.** Artes 1 e 4 têm painéis 100%
   pintados e ainda assim seu grafismo branco é chapa preservada por máscara
   aplicada **antes** do fundo. A arte 2 leva isso ao extremo oposto: lá o **preto** é
   o fundo, e todos os textos "pretos sobre dourado" são knockouts do fundo. Regra
   geral: **a cor do fundo geral é gratuita em qualquer elemento que a repita.**

5. **Fronteira T-F custa corte; fronteira T-T custa corte + proteção + cura.** A arte
   4 tem 0 T-T e 1730 cm de T-F, e ainda assim é de 1 dia. A arte 2 tem 9 T-T e
   ~6400 cm de contato, e é de 3 dias. Usar T-T como único proxy de esforço
   subestima artes de muito knockout; usar perímetro total superestima artes sem
   T-T. O motor precisa das **duas** métricas separadas.

6. **O respiro branco de 1–1,5 cm é uma decisão de projeto com efeito de custo.**
   Nas artes 3, 5 e 6 o designer separou as cores com keylines de chapa. Isso zera
   as T-T. Uma recomendação acionável para o comercial: **pedir 1,5 cm de respiro
   entre cores em artes novas** transforma um trabalho de 2 sessões num de 1.

7. **Nenhuma das 8 artes admite adesivo como entrega — inclusive o QR code.** O QR
   da arte 2 é **pintado**, como knockout do preto de base dentro da máscara do
   dourado. Foi o único elemento da fatia que a rubrica antiga declarava
   explicitamente "não pintar".

8. **Uma única pendência real em 8 artes:** o bloco fotográfico das costelas da
   AGROMINA lateral (8,4 m² de textura de carne). Nenhuma outra arte da fatia tem
   conteúdo fotográfico — a maçã da BELLAVER **parece** textura e não é. Distinguir
   as duas coisas (forma vetorial com furos × imagem contínua) é o discriminante
   que mais impacta o orçamento no motor.
