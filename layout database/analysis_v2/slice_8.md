# Análise de Produção v2 — Slice 8 (9 artes)

> Escrita contra `api/PAINTING_PRODUCTION_DOCTRINE.md` (ago/2026), que tem
> **precedência** sobre `layout database/analysis/analysis_A..F.md`.
>
> **Premissa inegociável:** adesivo/vinil **nunca é produto final** — é sempre
> apenas máscara para pintura. A única etapa feita por máquina é o **corte do
> formato da máscara**. Posicionar, depilar, cortar in situ, mascarar, bater
> carvão, pintar e envernizar é tudo manual.
>
> **Branco nunca é tinta.** Todo branco é chapa original preservada por máscara.
>
> **Fronteira T-T** = duas cores **ambas não-brancas** se tocando. Só isso gera
> trabalho de mascaramento. T-F (cor × chapa branca) não gera.
>
> **Ordem (§2):** a cor de **MENOR cobertura vem primeiro**, é mascarada, e a de
> maior cobertura vem por cima. Exceção explícita do §6.2: a **pintura geral de
> fundo** é sequenciada antes dos pares (etapa 2 do §6), não sujeita à regra §2.
>
> **Escala:** cada arte declara o implemento de referência assumido e o fator
> px→cm usado. As medidas de fronteira são estimativas derivadas desse fator;
> mudando o implemento, escalam linearmente.

---

## Tabela-resumo

| # | Arte | Proporção | Substrato provável | Fundo | Fronteiras T-T | Estratégia dominante | Complexidade |
|---|---|---|---|---|---|---|---|
| 1 | ADRI FRUTAS lateral | 5,97:1 | CHAPA_BRANCA (isoplastic possível) | chapa branca ~72%, sem pintura geral | **7** | CORTE_MANUAL + ESPOVO_DIRETO nas faixas | Média-Alta |
| 2 | ADRI FRUTAS traseira | 1,00:1 | CHAPA_BRANCA (isoplastic possível) | chapa branca ~78%, sem pintura geral | **4** | CORTE_MANUAL | Média |
| 3 | Aquarela lateral | 3,26:1 | ISOPLASTIC (isotérmico de gelo) | **pintura geral azul-marinho ~93%** | **0** | CORTE_MANUAL (reservas) — 1 única demão | Baixa |
| 4 | Aquarela traseira | 1,06:1 | ISOPLASTIC | **pintura geral azul-marinho ~92%** | **0** | CORTE_MANUAL + 1× MASCARA_MAQUINA (QR) | Baixa-Média |
| 5 | AFO lateral | 4,41:1 | ISOPLASTIC (produtos perecíveis) | chapa branca ~86%, sem pintura geral | **1** (3 travessias) | CORTE_MANUAL + aerografia em janela T-F | Média |
| 6 | Atacado Frios lateral | 2,58:1 | ISOPLASTIC (distribuidora de frios) | **pintura geral cinza-claro ~88%** (ver §2 — decisão crítica) | **7 macro + dezenas internas** | CORTE_MANUAL + MASCARA_MAQUINA_SOBRE_VERNIZ nas marcas + **PENDÊNCIA (BRF)** | Alta |
| 7 | Azzioly lateral | 5,97:1 | CHAPA_BRANCA (LONA se sider) | chapa branca ~85%, sem pintura geral | **4** | CORTE_MANUAL; fita depende do substrato | Média |
| 8 | SGT | 5,54:1 | CHAPA_BRANCA | chapa branca ~58%, sem pintura geral | **3 confirmadas + 1 condicional** | ESPOVO_DIRETO (estrada + linha) + CORTE_MANUAL | Média-Alta |
| 9 | bismark | 2,67:1 | ISOPLASTIC (frigorífico) | chapa branca ~62%, sem pintura geral | **6** | **PENDÊNCIA (brasão metálico)** + FITA_AMARELA na faixa | Muito Alta |

**Total de fronteiras T-T macro identificadas: 32** (mais dezenas de micro-fronteiras
dentro do selo BRF da arte 6, contadas como uma família).

**Pendências para o dono (aerografia × pintura artística à mão — nunca impressão):**
arte 6 (selo facetado BRF, selo Perdigão, blob Kidelli) e arte 9 (brasão Bismark
inteiro: biséis dourados, degradê radial azul, letras cromadas).

---

# 1. ADRI FRUTAS — lateral

*(1600×268 px; proporção 5,97:1)*
**Implemento de referência assumido:** carreta/baú longo **14,0 m × 2,35 m**.
**Fator de escala:** 1 px ≈ 8,75 mm. (Se for baú de truck 8,6 m × 1,45 m, dividir
tudo por 1,63.)

### 1) Implemento e substrato provável
Proporção 5,97:1 é longa demais para baú de truck com altura normal de baú
(2,3–2,6 m) — é **carreta / baú longo**, ou um baú de truck rebaixado. Cliente:
hortifruti no CEASA de São José-SC ("Box 118 A-C"), carga **não climatizada**
(frutas e legumes em caixa). Isso empurra para **CHAPA_BRANCA** (baú de carga
seca em chapa lisa), não para isoplastic — isoplastic é o padrão de frigorífico,
e hortifruti de CEASA raramente é isotérmico.

**Consequência de fita (§4):** em chapa, **fita amarela não é opção**. As curvas
longas das faixas da esquerda só podem sair por **corte manual** ou
**ESPOVO_DIRETO**. Se o dono confirmar que o baú é isoplastic, essas mesmas
faixas viram FITA_AMARELA e o custo cai bruscamente — é o item nº 1 a confirmar
nesta arte.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 72% da superfície: toda a
metade direita e a faixa superior da esquerda são chapa preservada. As áreas
pintadas são: o campo cinza-prata do canto inferior esquerdo (~14%), as duas
faixas curvas (grafite + laranja, ~5%), o cluster do logo (~7%) e o selo "25
Anos" (~1%).

O branco de "LEGUMES" (dentro da barra preta) e o "25" do selo **não são tinta
branca** — são chapa preservada por máscara aplicada antes da tinta escura.

### 3) Inventário de elementos
1. **Campo cinza-prata** no canto inferior esquerdo, delimitado por uma curva
   ampla que sobe da borda esquerda para a direita. Leve degradê no layout.
2. **Faixa grafite** (cinza-escuro quase preto), estreita, curva, concêntrica à
   mesma família de curvas, atravessando o terço esquerdo.
3. **Faixa laranja**, estreita, curva, imediatamente acima da grafite.
4. **Slogan** canto inferior esquerdo: `"Dedicação, trabalho e fé"` — itálico
   serifado, grafite, entre aspas.
5. **Anel/"tomate" vermelho**: swoosh em C aberto (~stroke variável), com um
   realce vermelho-claro interno, envolvendo o wordmark.
6. **Cálice/folhas verdes** do tomate, no topo do anel — 5 folhas lanceoladas
   com pontas finas.
7. **Wordmark `ADRI`** em preto, letras muito gordas, itálico levíssimo.
8. **Barra preta** com `LEGUMES` em branco reservado.
9. **Telefone/endereço** em preto: `48 3257-8371   Box 118 A-C` (bold, grande) e
   abaixo `adrifrutaseverduras@gmail.com` + `Ceasa - São José - SC` (micro).
10. **Cenoura laranja** com talos verdes, à direita do wordmark, inclinada,
    com filetes internos mais claros (nervuras).
11. **Selo "25 Anos"** no canto superior direito: fita/laço vermelho com `25` em
    branco reservado, `Anos` em pequeno, e sombras em vermelho-escuro.

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Cinza-prata (campo) | chapada com **leve degradê** no layout — produzir chapada |
| Grafite (faixa + slogan) | chapada |
| Laranja (faixa + cenoura) | chapada; a cenoura tem **filetes internos claros** (nervuras) que são laranja-claro, não degradê |
| Vermelho (anel + selo) | chapada + **um segundo vermelho mais claro** de realce no anel e **um vermelho-escuro** de sombra no selo |
| Verde (folhas do tomate + talos da cenoura) | chapada |
| Preto (ADRI, barra, textos) | chapada |
| Branco (LEGUMES, "25") | **não é tinta** — chapa reservada |

Sem degradê fotográfico, sem metálico. **Nenhuma pendência de aerografia nesta arte.**

### 5) Fronteiras T-T
| # | Par (ambas não-brancas) | Extensão de contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T1 | **Laranja (faixa) × Grafite (faixa)** | ~420 cm | **suave** (raio ~4–6 m) | **Grafite** (faixa mais larga e mais longa) |
| T2 | **Grafite (faixa) × Cinza-prata (campo)** | ~450 cm | **suave** (raio ~4–6 m) | **Cinza-prata** (campo de ~7 m²) |
| T3 | **Verde (folhas) × Vermelho (anel)** | ~175 cm | **fechada** (raio 2–5 cm nas pontas das folhas) | **Vermelho** |
| T4 | **Vermelho (anel) × Preto (ADRI + barra)** | ~155 cm | **média** (bordas de letra gorda, raio 5–12 cm) | **Preto** (marginalmente — quase empate) |
| T5 | **Verde (talos) × Laranja (cenoura)** | ~52 cm | **fechada** (raio 1–3 cm) | **Laranja** |
| T6 | **Preto (ponta direita da barra LEGUMES) × Laranja (cenoura)** | ~44 cm | **reta** | **Laranja** (cenoura + faixa somadas) |
| T7 | **Vermelho × Vermelho-escuro** (sombras do selo 25 Anos) | ~35 cm | **média/fechada** (dobras da fita) | **Vermelho** |

**Pares que NÃO se tocam** (podem ir na mesma sessão, §6.4):
- Laranja × Cinza-prata — a faixa grafite fica **inteiramente entre elas**.
- Verde × Preto — há respiro branco entre as folhas e o topo das letras.
- Verde × Grafite / Cinza-prata — elementos em metades opostas da lateral.
- Slogan grafite × qualquer coisa — está isolado no canto inferior esquerdo,
  sobre chapa branca.
- Selo "25 Anos" × qualquer coisa — isolado no canto superior direito.

> ⚠️ **Incerteza de maior impacto econômico:** T1 e T2 dependem de existir ou não
> um **filete branco** entre as três faixas. No raster de layout as bordas são
> antialiasadas e um filete de 1–3 px (≈1–2,6 cm no implemento) desaparece. Se o
> filete existir, T1 e T2 **deixam de ser T-T** e viram 4 T-F — laranja, grafite e
> cinza-prata passam a caber na **mesma sessão**, eliminando 2 ciclos de máscara e
> ~870 cm de mascaramento curvo. Verificar no vetor, não no raster.

### 6) Ordem de pintura (§2 — menor cobertura primeiro)
Cobertura estimada em ordem crescente:
`verde < vermelho < preto < laranja < grafite < cinza-prata`

Essa ordem crescente global satisfaz **todos** os sete pares simultaneamente:

| Par | Ordem | Justificativa |
|---|---|---|
| T3 verde×vermelho | **verde → vermelho** | as 5 folhas somam ~0,25 m²; o anel vermelho ~0,9 m². Mascarar as folhas é muito mais barato que mascarar o anel inteiro. |
| T5 verde×laranja | **verde → laranja** | os talos são 2 traços finos; a cenoura é um corpo cheio. |
| T4 vermelho×preto | **vermelho → preto** | quase empate em área, mas o vermelho é um **anel fino** (perímetro grande, área pequena) e o preto é sólido — mascarar o anel gasta menos filme. Quando há empate de área, a doutrina se resolve pela **razão perímetro/área**: mascara-se o corpo sólido, não o traço. |
| T6 preto×laranja | **preto → laranja** | somando faixa + cenoura, o laranja cobre mais que o preto. |
| T1 laranja×grafite | **laranja → grafite** | a faixa grafite é ~1,4× mais larga. |
| T2 grafite×cinza-prata | **grafite → cinza-prata** | o campo prata é ~5× a área da faixa grafite. Mascarar a faixa (≈0,45 m²) é muito mais barato que mascarar o campo (≈2,3 m²). |
| T7 vermelho×vermelho-escuro | **vermelho-escuro → vermelho** | as sombras da fita somam poucos cm²; o vermelho do laço cobre tudo. |

**Nota contraintuitiva a defender com o pintor:** a regra manda pintar o campo
cinza-prata **por último**, não primeiro. O instinto é "faz o fundo grande e
depois os detalhes"; a doutrina inverte porque quem entra depois é quem se
protege sozinho pela máscara do menor.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3 — "um humano corta isso com estilete, no implemento?") |
|---|---|---|
| Campo cinza-prata | **ESPOVO_DIRETO** para marcar a curva + máscara/empapelamento | É uma faixa **muito grande e muito fácil** (uma curva única de ~3 m, raio >4 m) — o caso literal do §3.3. Bater carvão pelo estêncil de kraft direto na chapa e mascarar por fora custa menos material que 3 m de filme cortado. |
| Faixa grafite | **ESPOVO_DIRETO** | Mesma família de curva, mesmo estêncil de kraft (o kraft pode carregar as 3 curvas de uma vez, garantindo paralelismo — que é justamente o que se perde se cada faixa for marcada isolada). |
| Faixa laranja | **ESPOVO_DIRETO** | idem. |
| *(alternativa se isoplastic)* | **FITA_AMARELA** nas 3 divisas | Curvas suaves de raio >4 m: a fita amarela acompanha sem vinco e **zera o corte**. Só liberada se o substrato for isoplastic/lona (§4). |
| Slogan `"Dedicação, trabalho e fé"` | **CORTE_MANUAL** | Itálico serifado a ~11 cm de altura de caixa-alta em 14 m de lateral. Serifas de ~1,5 cm são cortáveis a estilete, com cuidado. Se o implemento for menor (truck 8,6 m → ~7 cm de altura), reclassificar para MASCARA_MAQUINA. |
| Anel vermelho + realce | **CORTE_MANUAL** | Duas curvas em C de raio 40–90 cm. Trivial à mão. |
| Folhas verdes | **CORTE_MANUAL** | 5 lanças de ~25–40 cm com pontas de raio 2–5 cm. Perfeitamente cortável; é grande. |
| `ADRI` + barra `LEGUMES` | **CORTE_MANUAL** | Letras de ~50 cm de altura, geometria reta/arredondada larga. O branco de LEGUMES são 7 ilhas de ~25 cm — cortáveis. |
| `48 3257-8371  Box 118 A-C` | **CORTE_MANUAL** | ~15 cm de altura. Cortável. |
| `adrifrutaseverduras@gmail.com` / `Ceasa - São José - SC` | **MASCARA_MAQUINA** (sem verniz prévio) | Altura real ~6 cm com contrapunções de ~4 mm num e-mail de 29 caracteres — **não é cortável à mão**. Mas assenta sobre **chapa original**, não sobre laca curada: a máscara de máquina cola direto na chapa limpa e **não exige o ciclo de verniz do §3.2**. Essa distinção economiza um dia inteiro. |
| Cenoura laranja + nervuras | **CORTE_MANUAL** | Corpo de ~1,3 m; as nervuras são 5 filetes longos de raio suave. Cortável. |
| Talos verdes | **CORTE_MANUAL** | 2 traços de ~30 cm. |
| Selo "25 Anos" | **CORTE_MANUAL** | ~1,4 m × 0,6 m no implemento. As dobras da fita são raio 3–8 cm. Cortável, ainda que seja o elemento mais fino da arte. |

**Nada nesta arte é impresso. Nada nesta arte é adesivo final.**

### 8) Sequência de sessões e dias
- **S0 — Preparação.** Lavar, empapelar perfis, borrachas, ferragens, faixa
  refletiva inferior. Furar os estêncis de kraft das 3 faixas (o item de maior
  lead-time — pode ser preparado fora do implemento, em paralelo).
- **Dia 1 manhã — S1: VERDE.** Folhas do tomate + talos da cenoura. Não tocam
  nada mais → sessão curta.
- **Dia 1 meio — S2: VERMELHO + VERMELHO-ESCURO.** Anel + realce + selo 25 Anos.
  O vermelho-escuro das sombras entra antes do vermelho na mesma janela de
  máscara. Cura de laca ~1 h.
- **Dia 1 tarde — S3: PRETO + GRAFITE do slogan.** `ADRI`, barra, telefone,
  slogan. **O grafite do slogan e o grafite da faixa são o mesmo tom mas não se
  tocam** — o slogan pode adiantar aqui, e a faixa fica para S5.
- **Dia 2 manhã — S4: LARANJA.** Cenoura + faixa laranja. (Cenoura e faixa não se
  tocam entre si, mesma demão.)
- **Dia 2 meio — S5: GRAFITE (faixa).**
- **Dia 2 tarde — S6: CINZA-PRATA (campo).**
- **Dia 3 manhã — S7: MASCARA_MAQUINA do micro-texto** (e-mail + endereço),
  pintura preta localizada. Independente de tudo (T-F sobre chapa) — pode
  inclusive ser adiantada para o Dia 1.
- **Dia 3 tarde — Verniz geral**, remoção de máscaras, retoques.

**Total: ~2,5–3 dias por lado.**
Se o filete branco entre as faixas existir, **S4+S5+S6 colapsam numa só sessão**
→ **~2 dias por lado**.
Arte repetida nos dois lados; o conteúdo **não espelha** (texto), então é a mesma
máscara reposicionada — o estêncil de kraft das faixas **precisa ser espelhado**
ou virado.

### 9) Armadilhas para o motor de visão
1. **O campo cinza-prata pode ser lido como sombra de mockup.** Ele é degradê
   suave e encosta no branco sem borda dura em parte do percurso. Um segmentador
   que trate "cinza claro ≈ branco sujo" some com 14% da área pintada e erra o
   orçamento em ~2 sessões.
2. **Filete branco entre as três faixas** (1–3 px): muda T1/T2 de T-T para T-F e
   corta ~1 dia. É a medição mais valiosa e a mais frágil da arte.
3. **Dois vermelhos e dois laranjas.** O realce claro do anel e as nervuras da
   cenoura são tons próximos do principal; quantização vai fundi-los (perde-se
   T7) ou multiplicá-los (inventa 4 vermelhos).
4. **`LEGUMES` branco dentro da barra preta** e o **`25` branco** do selo: são
   chapa reservada, não tinta branca. Regra: branco cercado por tinta ≠ camada.
5. **Antialiasing do wordmark** gera cinzas fantasmas entre preto e branco que um
   contador de cores lê como um 7º tom.
6. **Micro-texto do e-mail** (~4 px de altura no raster): abaixo do limiar de
   corte manual. O motor precisa sinalizar `detalhe_minimo_mm < limiar` e trocar
   a estratégia, **não** sugerir impressão.
7. **O anel vermelho tem razão perímetro/área altíssima** — se o motor decidir a
   ordem só por área, dá empate com o preto e escolhe errado. Precisa do critério
   de desempate por perímetro/área.

### 10) Correções à análise antiga
`analysis_F.md` não analisa ADRI FRUTAS diretamente, mas suas **regras
transversais** (seção "PADRÕES TRANSVERSAIS") seriam aplicadas a esta arte e
produziriam os seguintes erros:

1. **Padrão transversal nº 4** — *"asset delimitado com texto abaixo da altura
   mínima pintável → impressão digital"*. Aplicado aqui, mandaria **imprimir o
   bloco de e-mail/endereço**. **ERRADO:** adesivo nunca é produto final. A
   solução correta é máscara recortada a máquina + pintura preta.
2. **Padrão transversal nº 2 e a coluna "Solução" das tabelas de fronteira** —
   `analysis_F` mapeia fronteira suave e longa para **"fita amarela flexível"
   sem consultar o substrato**. **ERRADO por §4:** fita amarela só vale em
   isoplastic/lona. Em chapa branca (o caso provável aqui), as três faixas
   exigem espovo ou corte manual — o que muda material, mão de obra e prazo.
3. **Padrão transversal nº 6** — *"ordem claro→escuro"*. **ERRADO/incompleto:**
   a doutrina §2 não ordena por luminosidade, ordena por **cobertura**. Aqui as
   duas regras divergem em T2: claro→escuro mandaria pintar o **cinza-prata
   antes** do grafite; a doutrina manda **grafite antes**, porque o prata cobre
   5× mais área. Seguir a regra antiga significa mascarar 2,3 m² em vez de
   0,45 m².
4. **Uso sistemático da expressão "adesivo plotado" como se fosse uma tecnologia
   de acabamento.** Mesmo quando `analysis_F` usa vinil como máscara, ela nunca
   distingue **corte manual in situ** (o preferido, §3.1) de **corte a máquina**
   (a exceção, §3.2). Nesta arte, **12 dos 13 elementos são cortáveis à mão** —
   plotar todos eles seria pagar corte de máquina + ciclo de verniz sem
   necessidade.
5. **"cura ~3h + adesivo por cima" como solução padrão para curva fechada**
   (linha do CJ PILGER). **ERRADO:** T3 (folhas × anel) tem raio de 2–5 cm e é
   perfeitamente cortável à mão porque as folhas medem 25–40 cm no implemento. A
   doutrina julga cortabilidade **em cm no implemento**, não em curvatura do
   vetor.

---

# 2. ADRI FRUTAS — traseira

*(1599×1600 px; proporção 1,00:1)*
**Implemento de referência assumido:** traseira de baú **2,40 m × 2,40 m**.
**Fator de escala:** 1 px ≈ 1,50 mm.

### 1) Implemento e substrato provável
Formato quadrado = **traseira de baú**. A **moldura vermelha fina** que corre
pelas 4 bordas do arquivo é **marca de mockup/recorte**, não arte — não pintar.

Mesmo substrato da lateral: **CHAPA_BRANCA** provável (hortifruti de CEASA, carga
não climatizada). Consequência §4: sem fita amarela.

Nesta arte a decisão de fita é **irrelevante na prática**, porque não há nenhuma
faixa longa — todas as fronteiras são de logo, resolvidas por corte manual.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 78%. O logo ocupa o terço
superior-central e a metade inferior é chapa limpa (provavelmente por causa da
zona de placa, lanternas, para-choque e faixa refletiva).

`LEGUMES` branco dentro da barra preta = chapa reservada.

### 3) Inventário de elementos
Mesmo cluster da lateral, **ampliado ~1,55×** e sem os elementos periféricos:
1. **Anel/"tomate" vermelho** em C aberto, com realce vermelho-claro interno.
2. **Cálice de folhas verdes** (5 lanças) no topo do anel.
3. **Wordmark `ADRI`** preto.
4. **Barra preta** com `LEGUMES` branco reservado.
5. `48 3257-8371   Box 118 A-C` preto bold.
6. `adrifrutaseverduras@gmail.com` + `Ceasa - São José - SC` — micro-texto preto.
7. **Cenoura laranja** com nervuras claras e talos verdes.

**Ausentes em relação à lateral:** campo cinza-prata, faixas grafite/laranja,
slogan, selo "25 Anos". → **Paleta reduzida de 6 cores para 4.**

### 4) Paleta
Vermelho (+ realce vermelho-claro), verde, preto, laranja (+ nervuras
laranja-claro). Todas **chapadas**. Branco = chapa reservada. **Sem degradê,
sem metálico, sem pendência.**

### 5) Fronteiras T-T
| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | **Verde (folhas) × Vermelho (anel)** | ~75 cm | **fechada** (raio 1–3 cm nas pontas) | **Vermelho** |
| T2 | **Vermelho (anel) × Preto (`ADRI` + barra)** | ~68 cm | **média** (raio 3–8 cm) | **Preto** |
| T3 | **Verde (talos) × Laranja (cenoura)** | ~22 cm | **fechada** (raio 0,8–2 cm) | **Laranja** |
| T4 | **Preto (ponta direita da barra) × Laranja (cenoura)** | ~18 cm | **reta** | **Laranja** |

**Pares que NÃO se tocam:**
- **Verde × Preto** — há respiro branco entre o cálice e o topo do `A`/`D`.
  Confirmado visualmente: as folhas passam por cima do anel, não por cima das
  letras.
- **Verde (folhas do tomate) × Verde (talos da cenoura)** — mesma cor, sem
  fronteira, mas em **ilhas separadas**: mesma demão.
- **Micro-texto preto × qualquer cor** — está inteiramente sobre chapa branca.

> Note que a traseira tem **4 T-T** contra **7** da lateral, e todas as 4 são
> internas ao logo. É a mesma família de fronteiras, em escala 1,55× **menor em
> centímetros absolutos** — porque na lateral o logo está sobre um implemento de
> 14 m, enquanto aqui está sobre 2,4 m. **O logo da traseira é maior em px e
> menor em cm que o da lateral.** Um motor que deduplique "mesmo asset" e
> reaproveite as medidas de fronteira da lateral vai errar por fator 2,3.

### 6) Ordem de pintura (§2)
Cobertura crescente: `verde < preto < vermelho < laranja`.

Atenção — **a ordem relativa vermelho/preto se INVERTE em relação à lateral.**
Na lateral o preto somava `ADRI` + barra + telefone + slogan e superava o anel;
aqui, com o logo ampliado e o slogan ausente, o **anel vermelho + realce** cobre
mais que o preto. Verificando os pares:

| Par | Ordem | Justificativa |
|---|---|---|
| T1 verde×vermelho | **verde → vermelho** | 5 lanças de ~0,04 m² contra um anel de ~0,32 m². |
| T2 vermelho×preto | **preto → vermelho** | invertido em relação à lateral: sem o slogan e o telefone da faixa, o preto (letras + barra ≈ 0,20 m²) fica abaixo do vermelho (≈ 0,32 m²). |
| T3 verde×laranja | **verde → laranja** | 2 talos finos contra o corpo da cenoura. |
| T4 preto×laranja | **preto → laranja** | a cenoura (~0,26 m²) supera a barra. |

Ordem crescente global `verde < preto < vermelho < laranja` satisfaz T1–T4
simultaneamente.

**Esta divergência entre lateral e traseira é o achado operacional mais útil
desta arte:** se as duas vistas forem pintadas no mesmo ciclo (o que é
desejável), o vermelho e o preto precisam ser aplicados em **duas ordens
diferentes** nas duas vistas — ou aceita-se pintar o preto primeiro nas duas,
pagando uma máscara ligeiramente maior na lateral. Recomendação prática: **pintar
preto antes do vermelho nas duas vistas**, unificando o ciclo; o excedente de
máscara na lateral é da ordem de 0,05 m², muito menor que o custo de uma sessão
extra.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| Anel vermelho + realce | **CORTE_MANUAL** | Duas curvas em C de raio 15–35 cm no implemento. Fácil. |
| Folhas verdes | **CORTE_MANUAL** | Lanças de 12–20 cm com pontas de raio ~1,5 cm. No limite do confortável, mas cortável — é o elemento mais exigente da arte. |
| `ADRI` + barra `LEGUMES` | **CORTE_MANUAL** | Caixa-alta de ~45 cm. As 7 ilhas brancas de `LEGUMES` têm ~12 cm. Trivial. |
| `48 3257-8371  Box 118 A-C` | **CORTE_MANUAL** | ~7 cm de altura, dígitos com hastes de ~1,2 cm. Cortável com atenção. |
| `adrifrutaseverduras@gmail.com` / `Ceasa - São José - SC` | **MASCARA_MAQUINA** (direto na chapa, sem verniz) | ~2,5 cm de altura, contrapunções de ~2 mm, 29 caracteres. **Fora do alcance do estilete.** Assenta sobre chapa original → dispensa o ciclo de verniz do §3.2. |
| Cenoura + nervuras | **CORTE_MANUAL** | Corpo de ~50 cm; nervuras são 5 filetes suaves. |
| Talos verdes | **CORTE_MANUAL** | 2 traços de ~12 cm. |
| Moldura vermelha do arquivo | **NÃO PINTAR** | é mockup. |

### 8) Sequência de sessões e dias
- **S0 — Preparação específica de traseira:** empapelar dobradiças, varões de
  fechamento, borrachas de vedação, para-choque, lanternas e a zona de placa.
  **Alinhar as duas folhas de porta FECHADAS** antes de posicionar qualquer
  máscara: o logo cruza o vão central e o registro entre as folhas só é honesto
  com a porta fechada.
- **Dia 1 manhã — S1: VERDE** (folhas + talos, ilhas separadas, mesma demão).
- **Dia 1 meio — S2: PRETO** (`ADRI`, barra, telefone).
- **Dia 1 tarde — S3: VERMELHO** (anel + realce).
- **Dia 2 manhã — S4: LARANJA** (cenoura + nervuras).
- **Dia 2 meio — S5: MASCARA_MAQUINA** do micro-texto → preto localizado.
  (Pode ser adiantada para o Dia 1 — é T-F sobre chapa e não depende de nada.)
- **Dia 2 tarde — Verniz geral**, remoção, retoques.
- Faixa refletiva regulamentar aplicada **por último, sobre o verniz curado**.

**Total: ~1,5–2 dias.**
**Sincronizar com as duas laterais** — mesmas 4 tintas, mesmas demãos. A traseira
não justifica sessões próprias de pistola.

### 9) Armadilhas para o motor de visão
1. **A moldura vermelha do arquivo é mockup** — um segmentador ingênuo cria um
   retângulo vermelho de perímetro 9,6 m e uma fronteira T-T fantasma
   vermelho×branco (que nem T-T seria, mas infla a contagem de elementos).
2. **Dedupe traiçoeiro:** é o "mesmo logo" da lateral, mas em **escala física
   menor**. Deduplicar sem aplicar o fator de escala do implemento inverte a
   conclusão de cortabilidade (o micro-texto é cortável na lateral de 14 m? não —
   mas está 1,63× maior lá).
3. **Inversão da ordem vermelho/preto** entre as duas vistas: o motor precisa
   calcular cobertura **por vista**, não por asset.
4. O **vão central das portas** corta o wordmark: o raster não mostra o vão, mas
   ele existe. Sem isso o motor subestima o tempo de posicionamento.
5. **Realce vermelho-claro** no anel: fácil de fundir com o vermelho principal
   (perde-se um par) ou de ler como sombra de mockup.
6. Grande área branca inferior: um heurístico de "% não-branco" pode concluir
   "arte pequena, trabalho pequeno" — mas o custo está concentrado nas 4 T-T
   fechadas do logo, não na área.

### 10) Correções à análise antiga
`analysis_F.md` analisa a **CLEBIN traseira** como caso análogo (§3 daquele
documento). As afirmações dela que estariam erradas aqui:

1. **"Reaproveitar o arquivo de corte da lateral em escala maior"** e o padrão
   transversal nº 7 (*"mesmo asset em escala diferente = 1 análise + fator de
   escala"*). **Insuficiente:** o fator de escala muda a **classificação de
   cortabilidade** e pode inverter a **ordem de pintura**, não só o tamanho do
   arquivo. Aqui inverte de fato (vermelho/preto).
2. **"escala maior = fronteira amarelo/bordô maior → fita+corte ainda mais
   confortável"**. **ERRADO no raciocínio:** a traseira tem escala de arquivo
   maior mas **implemento menor** — a fronteira em centímetros **encolhe**.
   `analysis_F` confunde px do layout com cm do implemento em toda a seção.
3. **Padrão transversal nº 1** afirma que "todo branco é fundo reservado por
   adesivo aplicado ANTES da tinta". A conclusão está certa; a **formulação está
   errada** — não é "adesivo", é **máscara**, e o corte é manual sempre que
   possível. A diferença não é semântica: define se se paga corte de máquina.
4. **`analysis_F` nunca lista extensão em cm nem raio de curvatura por
   fronteira**, apesar de o §1 da doutrina exigir exatamente isso. As tabelas de
   fronteira dela têm só {tipo, curva qualitativa, solução} — o que a torna
   inutilizável para calibrar `cortavel_a_mao`.
5. **Nenhuma menção a impressão nesta arte específica** — mas o padrão
   transversal nº 4 mandaria imprimir o bloco de e-mail. **Rejeitado.**

---

# 3. Aquarela (Gelo Aquarela) — lateral

*(1600×491 px; proporção 3,26:1)*
**Implemento de referência assumido:** baú de truck **7,80 m × 2,40 m**.
**Fator de escala:** 1 px ≈ 4,88 mm.

### 1) Implemento e substrato provável
Proporção 3,26:1 = **lateral de baú de truck**. Cliente: **fábrica/distribuidora
de gelo**. Gelo exige **caixa isotérmica** — o substrato quase certo é
**ISOPLASTIC** (painel de poliéster/fibra sobre isolamento), liso, sem frisos.

**Consequências do substrato (§4 e §3):**
- **Fita amarela liberada** — mas esta arte **não tem nenhuma faixa**, então a
  liberação não é aproveitada. Registrar como "vantagem não utilizada".
- **Isoplastic exige lixamento** dentro de cada janela de máscara antes de
  pintar, e o corte a estilete direto sobre isoplastic é **mais arriscado** que
  sobre chapa (o gel coat marca com facilidade). Ver §7.

### 2) Fundo
**PINTURA GERAL azul-marinho, ~93% da superfície.** Este é o oposto das artes 1 e
2: aqui há sim demão de fundo cobrindo o painel inteiro.

Todo o grafismo é **branco = chapa/gel coat original preservado por máscara**.
Não existe uma gota de tinta branca nesta arte.

O layout mostra o azul com um **degradê radial suave** (mais claro no centro-alto,
mais escuro nos cantos). Isso é **iluminação de mockup**, não especificação:
produzir **azul chapado**. Se o cliente exigir o degradê, ele vira um serviço de
pistola em leque sobre 18 m² e muda a arte de categoria.

### 3) Inventário de elementos
1. **`G E L O`** — caixa-alta, sans serif, com **entreletra muito aberta**
   (~5 caracteres espaçados), centralizado no topo.
2. **Moldura retangular** de traço fino, aberta, envolvendo o wordmark.
3. **`AQUARELA`** — serifado de alto contraste (didone), caixa-alta; o `A`
   inicial e o `Q` têm **terminações decorativas curvas** (o rabo do `Q` sai por
   baixo do `U` e sobe; o `A` tem um filete interno curvo).
4. **`®`** sobrescrito, junto ao `A` final.
5. **Rodapé, 3 blocos:**
   - ícone **WhatsApp** (fone dentro de círculo com bico de balão) + `67 9 9660 9199`
   - ícone **telefone** (fone clássico) + `67 9 9913 3437`
   - ícone **Instagram** (quadrado de cantos arredondados + círculo + ponto) + `GELOAQUARELA`

### 4) Paleta
**Uma única tinta: azul-marinho.** Chapada.
**Branco: chapa reservada (nunca tinta).**

Zero degradês reais, zero metálicos, zero blocos fotográficos, **zero pendências**.
Esta é a arte mais simples do slice — e a que mais expõe o erro da premissa
antiga, porque é 100% "adesivo" no vocabulário velho e 0% adesivo na realidade.

### 5) Fronteiras T-T
**NENHUMA. Zero fronteiras T-T.**

Só existe uma cor não-branca na arte inteira. Todas as fronteiras são
**azul × branco = T-F**, e T-F não gera trabalho de mascaramento entre tintas
(§1). O perímetro total de fronteira T-F é grande — estimo **~48 m** somando
letras, moldura e ícones — mas isso é perímetro de **corte de máscara**, não de
**proteção entre tintas**.

Registrando explicitamente o que a doutrina pede: **não há duas cores não-brancas
que se toquem**, portanto **tudo cabe numa única sessão de pintura**. É o limite
inferior do §6.4.

### 6) Ordem de pintura
Trivial, mas vale escrever o raciocínio porque é o caso-limite:
1. Aplica-se máscara sobre **toda** a área que deve permanecer branca (letras,
   moldura, ícones, ®).
2. Pinta-se **azul-marinho em uma única demão de cobertura** (2 passes de laca).
3. Não há segunda cor → **não há §2 a aplicar**.

Note a inversão em relação às artes 1/2: aqui a máscara protege o **branco**, e a
tinta é o campo. Nas artes 1/2 a máscara abre janelas para a tinta e protege o
branco por omissão. **É o mesmo material e a mesma mão de obra, mas a métrica de
consumo de filme é invertida** — aqui o filme cobre ~1,3 m² (só os grafismos),
enquanto o empapelamento cobre as bordas e ferragens.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| `G E L O` | **CORTE_MANUAL** | Caixa-alta de ~19 cm, sans serif geométrico, hastes de ~3 cm. Trivial. |
| Moldura retangular | **CORTE_MANUAL** (guiada por régua) | 4 retas, traço de ~4 cm de largura, ~4,5 m × 1,0 m. É a peça mais longa mas a mais fácil: corte reto com régua. **Alternativa: FITA_BRANCA** — a fita branca é larga e não faz curva, mas aqui **não há curva nenhuma**, e o §4 diz que ela serve exatamente para "traçado muito vertical/reto". Duas fitas paralelas por lado da moldura definem o traço sem corte nenhum. **Esta é a escolha mais barata.** |
| `AQUARELA` | **CORTE_MANUAL** | Caixa-alta de ~63 cm. Serifas de ~2 cm e hastes finas do didone de ~1,5 cm — no implemento isso é confortável. O rabo do `Q` é uma curva longa de raio ~8 cm. Cortável. |
| `®` | **CORTE_MANUAL** | ~12 cm de diâmetro. Fica no limite (o `R` interno tem ~5 cm), mas passa. |
| Números `67 9 9660 9199` e `67 9 9913 3437` | **CORTE_MANUAL** | ~15 cm de altura. Trivial. |
| `GELOAQUARELA` | **CORTE_MANUAL** | ~15 cm. Trivial. |
| Ícone **WhatsApp** | **CORTE_MANUAL** | ~20 cm de diâmetro. O fone interno tem lóbulos de raio ~1,5 cm e o bico do balão é um triângulo de ~3 cm. **Cortável** — este é precisamente o ícone que a doutrina cita como tendo sido erradamente marcado como impresso. |
| Ícone **telefone** | **CORTE_MANUAL** | ~15 cm, silhueta única sem ilhas. Fácil. |
| Ícone **Instagram** | **CORTE_MANUAL** | ~20 cm. Tem **3 ilhas** (moldura arredondada, círculo, ponto) e o traço da moldura tem ~2 cm — é o elemento mais delicado da arte, mas ainda cortável à mão. Se o implemento for menor que 6 m de lateral, reavaliar para MASCARA_MAQUINA. |

**Nenhum elemento desta arte exige máquina de corte. Nenhum exige verniz
intermediário. Nenhum é impresso.**

**Cuidado específico de isoplastic:** cortar a máscara com estilete **sobre o gel
coat original** (não sobre laca curada) exige lâmina nova e pressão baixa —
qualquer risco fica visível no branco final, que é justamente o elemento gráfico.
Recomendação: usar filme de máscara de baixa gramatura e **corte "kiss cut"**;
se a equipe não tiver confiança, esta é a única arte do slice onde vale
considerar máscara recortada a máquina **por risco de substrato**, não por
complexidade de desenho.

### 8) Sequência de sessões e dias
- **Dia 1 manhã — Preparação:** lavar/desengraxar, empapelar borrachas, perfis de
  canto, ferragens, faixa refletiva. **Lixar** (isoplastic) toda a área que vai
  receber azul.
- **Dia 1 tarde — Máscara:** aplicar filme sobre as regiões dos grafismos, cortar
  à mão as letras/ícones, depilar o negativo (fica só o desenho branco protegido).
  Montar a moldura com fita branca. Esta é a etapa mais longa da arte: estimo
  **4–6 h** para os ~48 m de contorno.
- **Dia 2 manhã — S1 (única sessão): AZUL-MARINHO.** Fundo + cobertura, 2 passes.
- **Dia 2 tarde — Remoção de máscaras**, retoque de bordas.
- **Dia 3 manhã — Verniz geral.**
- Faixa refletiva por cima do verniz curado.

**Total: ~2 a 2,5 dias por lado.**
**Arte não espelha** (texto) → mesma máscara reposicionada no outro lado.

> Observação de cronograma: com **0 fronteiras T-T**, o gargalo desta arte deixa
> de ser pintura e passa a ser **corte e depilagem de máscara**. Um motor que
> orce por "nº de cores × sessões" vai subestimar grosseiramente esta arte; um
> que orce por **perímetro de corte** acerta.

### 9) Armadilhas para o motor de visão
1. **Degradê radial do azul.** É iluminação de mockup. Quantização vai produzir
   3–6 azuis chapados, inventar 3–6 fronteiras T-T inexistentes e transformar uma
   sessão em cinco. **Esta é a armadilha mais cara do slice inteiro.**
2. **Inversão figura/fundo.** Em 93% da área a tinta é o fundo e o branco é a
   figura. Um classificador treinado em "branco = fundo, cor = elemento" vai
   listar o azul como um "elemento gigante" e ignorar que os elementos reais são
   os brancos.
3. **`G E L O` com entreletra extrema** pode ser lido como 4 elementos
   independentes em vez de uma palavra — irrelevante para custo, mas polui o
   inventário.
4. **A moldura aberta** (retângulo de traço fino) pode ser confundida com borda
   de mockup, como acontece na arte 2 — mas aqui **é arte**. O discriminante:
   ela está **dentro** do campo azul, não na borda do arquivo.
5. **Ícones de rede social** são o gatilho clássico do erro antigo ("ícone
   WhatsApp = impresso"). O motor precisa de uma regra explícita: ícone de
   marca ≠ impressão; avaliar por **tamanho em cm no implemento**.
6. **JPEG artifacts** ao redor do texto branco sobre azul saturado geram halos
   azul-claro que quantizam como uma segunda cor.

### 10) Correções à análise antiga
Esta arte é o **contraexemplo direto** da premissa errada, e a tabela do §0 da
doutrina cita literalmente o caso:

1. **`analysis_F` / premissa antiga: "ícones WhatsApp impressos".**
   **ERRADO.** Os três ícones são **pintados** — ou melhor, são **chapa
   preservada**: nem tinta levam. São recortes de máscara de ~20 cm, cortáveis à
   mão em minutos. Marcá-los como impressão adiciona um custo de vinil impresso
   + laminação + aplicação que **não existe**.
2. **Padrão transversal nº 4** (*"asset com micro-texto/textura de marca →
   impressão digital"*) mandaria imprimir o bloco de rodapé inteiro (ícones +
   telefones). **Rejeitado**: 15–20 cm de altura está muito acima de qualquer
   limiar de cortabilidade.
3. **Padrão transversal nº 10(b)**: `analysis_F` propõe classificar "pintura
   geral" por *threshold ~80% não-branco*. Aqui o valor é 93% e o veredito
   coincide — mas o critério é frágil: nas artes 1, 2, 8 e 9 o mesmo threshold
   acerta por sorte. O critério correto é **semântico** (existe uma demão que
   cobre o painel?), não estatístico.
4. **`analysis_F` sempre presume que "adesivo plotado" é o instrumento das
   fronteiras T-F.** Aqui isso significaria plotar ~48 m de contorno numa arte
   onde **tudo é cortável à mão** e onde a moldura sai de graça com fita branca.
   Custo inventado: uma máquina de corte + 48 m de vinil.
5. **`analysis_F` não tem vocabulário para "0 fronteiras T-T".** Suas tabelas
   sempre listam pelo menos uma linha T-T, porque ela conta fronteiras
   cor×branco na mesma tabela. Isso apaga exatamente a informação que o §6.4 usa
   para colapsar sessões.

---

# 4. Aquarela (Gelo Aquarela) — traseira

*(1521×1440 px; proporção 1,06:1)*
**Implemento de referência assumido:** traseira **2,40 m × 2,27 m**.
**Fator de escala:** 1 px ≈ 1,58 mm.

### 1) Implemento e substrato provável
Quase quadrada → **traseira de baú isotérmico**. Mesmo substrato da lateral:
**ISOPLASTIC**. Mesmas consequências: lixamento nas janelas, cuidado com estilete
sobre gel coat, fita amarela liberada mas sem uso (não há faixa).

Traseira de caminhão de gelo tipicamente tem **porta única de enrolar ou duas
folhas**; a arte cobre o painel inteiro, então **as ferragens vão cortar o
grafismo** — ver §8.

### 2) Fundo
**PINTURA GERAL azul-marinho, ~92%.** Mesmo azul da lateral, mesmo degradê radial
de mockup (produzir chapado).

Branco = chapa reservada, em 100% dos casos — **exceto uma nuance no QR code**,
ver §5.

### 3) Inventário de elementos
1. **`G E L O`** — caixa-alta espaçada, topo.
2. **Moldura retangular** de traço fino.
3. **`AQUARELA`** — didone caixa-alta, com o rabo decorativo do `Q` e o filete
   interno do `A`.
4. **`®`**.
5. **QR code** — quadrado branco sólido com módulos pretos, canto inferior
   esquerdo. Estimo **~29×29 módulos** num quadrado de ~36 cm → **módulo de
   ~1,25 cm**.
6. **Monograma `A`** grande, branco, canto inferior direito — o mesmo `A` didone
   do wordmark, isolado e ampliado, com o filete curvo interno.

**Ausentes em relação à lateral:** os três blocos de contato do rodapé
(telefones, ícones de rede social).

### 4) Paleta
| Cor | Natureza |
|---|---|
| Azul-marinho | chapada, pintura geral |
| **Preto** (módulos do QR) | chapada — **a única segunda tinta da arte** |
| Branco | chapa reservada |

Sem degradê real, sem metálico, **sem bloco fotográfico, sem pendência**.

### 5) Fronteiras T-T
**NENHUMA. Zero fronteiras T-T.**

Vale destrinchar porque é contraintuitivo — há **duas** tintas na arte:
- **Azul × branco (letras, moldura, `A`, quadrado do QR)** → **T-F**.
- **Preto (módulos) × branco (papel do QR)** → **T-F** — o campo do QR é chapa
  reservada, não tinta branca.
- **Preto × azul** → **não se tocam.** Os módulos pretos estão inteiramente
  contidos no quadrado branco reservado, que tem margem de silêncio (*quiet
  zone*) obrigatória em todo o perímetro. **Essa margem é o que impede a
  fronteira T-T** — e ela é obrigatória por especificação do próprio QR, não por
  escolha de design. Vale registrar: **a norma do QR entrega de graça a
  separação que a doutrina cobraria caro.**

Consequência §6.4: **azul e preto podem, em princípio, ir na mesma sessão** — não
há o que proteger entre eles. Na prática elas se separam por outro motivo
(cortabilidade, §7), não por fronteira.

**Esta arte é a prova de que T-T e cortabilidade são eixos independentes.** O QR
é o elemento mais caro do slice em relação ao seu tamanho, e tem **zero**
fronteiras T-T.

### 6) Ordem de pintura
1. Mascarar tudo que fica branco: `GELO`, moldura, `AQUARELA`, `®`, monograma
   `A`, e o **quadrado inteiro do QR** (36×36 cm de filme cheio).
2. **AZUL-MARINHO**, demão geral.
3. Remover a máscara do quadrado do QR; o restante do branco pode sair junto.
4. **PRETO** dos módulos, sobre o quadrado branco já exposto — com máscara
   recortada a máquina (§7).

O §2 não se aplica (nenhum par se toca). A ordem acima é ditada pela
**sequência de máscaras**, não por cobertura: o preto vem depois do azul porque
depende de o quadrado branco já estar delimitado e limpo.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| `G E L O` | **CORTE_MANUAL** | ~11 cm de caixa-alta, sans geométrico. Cortável. |
| Moldura retangular | **FITA_BRANCA** (ou corte manual com régua) | 4 retas puras, traço de ~4 cm. §4: fita branca é a opção para traçado reto — não faz curva, mas aqui não há curva. Zero corte. |
| `AQUARELA` | **CORTE_MANUAL** | ~28 cm de caixa-alta; hastes finas do didone com ~1,2 cm e serifas de ~1 cm. Menor que na lateral, mas ainda dentro do alcance do estilete. |
| `®` | **CORTE_MANUAL** — no limite | ~7 cm de diâmetro, `R` interno de ~3 cm. Se a equipe achar arriscado, agregar ao mesmo arquivo de corte de máquina do QR (o custo marginal é zero, já que a máquina será usada de qualquer jeito). |
| Monograma `A` | **CORTE_MANUAL** | ~44 cm de altura, traço grosso, uma ilha (a contrapunção) e o filete curvo. Trivial. |
| Quadrado branco do QR | **CORTE_MANUAL** | é um quadrado de 36 cm. |
| **Módulos pretos do QR** | **MASCARA_MAQUINA_SOBRE_VERNIZ** — ou, melhor, **MASCARA_MAQUINA direto sobre a chapa** | **Impossível à mão:** ~400 quadradinhos de 1,25 cm em posições irregulares, com tolerância de posição sub-milimétrica porque **o código precisa ser lido por leitor óptico**. Um erro de corte não é estético, é funcional. É o caso literal do §3.2 ("pequeno demais e com dezenas de detalhes"). **Porém:** o QR assenta sobre **chapa branca original** (dentro da reserva), **não sobre laca curada** — logo a máscara de máquina cola direto no substrato limpo e **o ciclo de verniz + espera do §3.2 é dispensável**. Isso derruba a etapa de meio-dia que a árvore do §3.2 assume por padrão. |

**Detalhe de execução do QR:** a máscara de máquina deve ser cortada em
**negativo** (o filme fica onde o QR é branco, e os ~400 furos abrem onde é
preto) e transferida com **fita de transferência** — depilar 400 ilhas soltas à
mão sem transferência é inviável. Alternativa que vale testar: cortar em
**positivo** (as ilhas pretas ficam vazadas) e pintar o preto por cima; escolha
depende de qual lado tem menos ilhas soltas, o que varia com o conteúdo do
código.

### 8) Sequência de sessões e dias
- **Dia 1 manhã — Preparação:** lavar, empapelar borrachas, dobradiças, varões,
  para-choque, lanternas, zona de placa. Lixar (isoplastic).
- **Dia 1 tarde — Máscara branca:** corte manual de `GELO`, `AQUARELA`, `®`,
  monograma `A`, quadrado do QR; fita branca na moldura. Estimo **3–4 h**.
- **Dia 2 manhã — S1: AZUL-MARINHO** (2 passes).
- **Dia 2 tarde — Remoção** das reservas; expor o quadrado branco do QR.
- **Dia 3 manhã — S2: PRETO do QR.** Aplicar máscara de máquina, pintar,
  remover. **Verificar com leitor de celular antes de envernizar** — se não ler,
  há tempo de retocar.
- **Dia 3 tarde — Verniz geral.** Atenção: verniz sobre QR precisa ser **fosco ou
  semifosco** na região do código; verniz brilhante gera reflexo especular que
  **impede a leitura óptica** em muitos ângulos. Este é um requisito real que
  nenhuma análise anterior levanta.
- Faixa refletiva por último.

**Total: ~2,5–3 dias.**
**Sincronizar com as laterais** — mesmo azul, mesma demão. O único item que a
traseira acrescenta ao ciclo é a sessão de preto do QR (~2 h) e o arquivo de
corte de máquina.

### 9) Armadilhas para o motor de visão
1. **O QR explode a contagem de elementos.** Uma segmentação por região honesta
   devolve ~400 retângulos pretos. O motor precisa colapsá-los num único
   elemento `QR_CODE` com `detalhe_minimo_mm ≈ 12` e `ilhas ≈ 400`, senão
   qualquer métrica de "nº de elementos" fica inútil.
2. **`ilhas` é o discriminante certo aqui, não `raio_min_cm`.** O QR é feito só
   de retas e cantos retos — um classificador que decida cortabilidade por
   curvatura vai dizer "reta = fácil" e mandar cortar à mão. **Curvatura é o
   critério errado para este elemento.**
3. **Preto × azul lidos como adjacentes.** Se a quiet zone for estreita no
   raster, uma dilatação morfológica de 2 px funde os módulos com o campo azul e
   **inventa uma fronteira T-T** que não existe.
4. **Degradê radial do azul** — mesma armadilha da arte 3, mesma gravidade.
5. **O monograma `A` é o mesmo glifo do wordmark.** Dedupe correto (mesmo
   arquivo de corte, escala diferente); mas a **contrapunção** do `A` ampliado é
   uma ilha solta grande que exige transferência.
6. **Requisito funcional invisível no pixel:** o QR precisa **ler**. Nenhuma
   métrica geométrica captura isso; precisa de um flag semântico
   `funcional: true` que force máquina + verniz fosco.

### 10) Correções à análise antiga
1. **Padrão transversal nº 4 de `analysis_F`** (*"texto abaixo da altura mínima
   pintável → impressão digital"*) mandaria, sem hesitar, **imprimir o QR em
   vinil e colar**. **ERRADO — e é o erro mais tentador do slice**, porque
   imprimir um QR é de fato mais fácil. A doutrina é categórica: **adesivo nunca
   é produto final**. O QR é pintado, com máscara recortada a máquina.
2. **`analysis_F` §2 (CLEBIN), sobre os selos**: *"6 selos pequenos idênticos são
   fortes candidatos a adesivo impresso"*. Mesma classe de erro, mesma rejeição.
3. **`analysis_F` nunca separa "não-cortável à mão" de "fronteira T-T".** Nesta
   arte os dois eixos se descolam totalmente: **0 T-T e 1 elemento
   não-cortável.** O modelo antigo, que deriva estratégia da tabela de
   fronteiras, não consegue nem expressar esta arte.
4. **`analysis_F` presume que máscara de máquina sempre exige verniz curado
   antes** (o "custa mais: máquina + ciclo de verniz + espera"). Aqui **não
   exige**, porque o elemento assenta sobre chapa original. A árvore do §3.2
   precisa dessa ramificação — é meio dia de diferença.
5. **Nenhuma análise anterior menciona o conflito verniz brilhante × leitura de
   QR.** Não é um erro delas, é uma lacuna — mas é a única coisa nesta arte que
   pode obrigar a repintar.

---

# 5. AFO Transportes — lateral

*(1600×363 px; proporção 4,41:1)*
**Implemento de referência assumido:** baú longo **10,50 m × 2,38 m**.
**Fator de escala:** 1 px ≈ 6,56 mm.

### 1) Implemento e substrato provável
Proporção 4,41:1 → **baú longo de truck ou carreta curta**. O bloco de dados no
canto inferior direito diz `PRODUTOS PERECÍVEIS` — transporte refrigerado.
Substrato provável: **ISOPLASTIC** (painel liso de frigorífico).

**Consequências (§4):** fita amarela liberada. Nesta arte há **arcos de raio
grande** (os swooshes orbitando a esfera) que seriam candidatos naturais a fita
amarela — mas eles são **elementos**, não faixas de borda a borda, e têm ponta
afilada nas duas extremidades. Fita amarela define bem o corpo do arco; as pontas
exigem corte manual. Estratégia mista, ver §7.

**Também:** lixamento obrigatório nas janelas antes de pintar; cuidado com
estilete sobre gel coat.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 86%.
Áreas pintadas: esfera (~4%), arcos cinza (~3%), wordmark `AFO transportes`
(~5%), `718` (~0,5%), bloco de dados (~1%).

Nenhum branco desta arte é tinta. O **realce claro no alto-esquerda da esfera** é
o único ponto ambíguo: é o ponto mais claro de um degradê, e no layout ele chega
quase a branco puro. **Não é chapa reservada** — é a extremidade clara do
degradê, e vai ser pintada (ou, se o dono preferir, pode literalmente **ser**
chapa reservada, o que economiza tinta e dá o branco mais branco possível). Ver
§9, armadilha 2.

### 3) Inventário de elementos
1. **`718`** — numeral de frota, bold, grafite/quase-preto, canto superior
   esquerdo. ~59 cm de altura.
2. **Esfera/globo** — círculo de **~2,16 m de diâmetro**, preenchido com
   **degradê radial**: realce quase-branco no quadrante superior esquerdo →
   azul-violeta médio no centro → azul-marinho escuro na borda inferior direita.
3. **Arcos "swoosh" cinza-prata** — 2 a 3 crescentes finos, de ponta afilada,
   orbitando a esfera: passam **por cima** dela e se estendem para fora à
   esquerda e à direita. Cada arco tem **degradê próprio** ao longo do
   comprimento (mais claro nas pontas, mais escuro no meio) e largura variável
   (~23 cm no corpo, afilando a ~2 cm nas pontas).
4. **`AFO`** — serifado bold, azul-marinho, caixa-alta, ~111 cm de altura, com
   **duas barras verticais finas** separando `A|F|O` (mesmo azul, ~5 cm de
   largura).
5. **`transportes`** — sans serif humanista, caixa-baixa, cinza médio, ~62 cm de
   altura de caixa-alta.
6. **Bloco de dados** canto inferior direito: retângulo de ~98 × 36 cm com fio
   preto de contorno, contendo `PRODUTOS PERECÍVEIS` (~5 cm), `Rua Conselheiro
   Saraiva, 837`, `Sala 2 - Santana - São Paulo/SP`, `AFO Transportes Ltda - EPP`,
   `Fone: (16) 3639-9181` (~3 cm cada).

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Azul-violeta da esfera | **DEGRADÊ RADIAL** — claro→escuro, contínuo |
| Cinza-prata dos arcos | **DEGRADÊ LONGITUDINAL** suave em cada arco |
| Azul-marinho (`AFO` + barras) | **chapada** |
| Cinza médio (`transportes`) | **chapada** |
| Grafite/preto (`718`, bloco de dados, fio do retângulo) | **chapada** |
| Branco | chapa reservada |

**Sobre os degradês:** não são fotográficos. São degradês geométricos simples
(radial numa esfera, longitudinal num arco) — **território de pistola em leque /
aerógrafo com máscara dura**, tecnicamente rotineiro. **Não é pendência.** A
pendência do §0 da doutrina se refere a blocos *fotográficos* (morangos, banner
com dobras); uma esfera é um degradê de duas variáveis que qualquer aerografista
resolve. **Registrar explicitamente que esta arte NÃO tem pendência**, porque a
doutrina cita "globo impresso" como exemplo do erro antigo e é importante não
sobrecorrigir para o outro extremo ("degradê ⇒ pendência").

### 5) Fronteiras T-T
| # | Par | Extensão de contato | Curvatura | Cobre mais área |
|---|---|---|---|---|
| T1 | **Cinza-prata (arcos) × Azul-violeta (esfera)** | **~700 cm** somando as 3 travessias (cada arco cruza a esfera e contribui 2 bordas de ~115 cm) | **suave** (raio ~1,5–3 m no corpo do arco); **fechada** só nos ~4 pontos onde a borda do arco encontra a borda da esfera (raio ~3 cm) | **Esfera** (~3,7 m² contra ~1,3 m² dos três arcos somados) |

**Uma única família de fronteira T-T na arte inteira.** As três travessias são a
mesma dupla de cores e podem ser tratadas como uma decisão só.

**Pares que NÃO se tocam** — e é uma lista longa, que é o que torna esta arte
barata:
- **Azul-marinho (`AFO`) × Azul-violeta (esfera)** — separados por ~40 cm de
  chapa branca. São **dois azuis distintos que nunca se encontram** → podem ir na
  **mesma sessão** com pistolas diferentes.
- **Cinza-prata (arcos) × Azul-marinho (`AFO`)** — a ponta do arco superior
  direito chega perto do `A`, mas há respiro branco. **Verificar no vetor**: se
  encostar, aparece uma T-T curta (~15 cm, reta) e o arco passa a ter que ser
  pintado antes do `AFO`.
- **Cinza médio (`transportes`) × `AFO`** — linhas de texto separadas por
  entrelinha branca.
- **Cinza médio (`transportes`) × arcos** — a ponta inferior do arco direito
  termina antes do `t`.
- **`718`** — isolado no canto, não toca nada.
- **Bloco de dados** — isolado no canto, não toca nada.
- **Arcos × arcos** — mesma cor; onde se cruzam fora da esfera, não há fronteira.

### 6) Ordem de pintura (§2)
Só há um par a ordenar, e a regra é inequívoca:

**ARCOS CINZA-PRATA primeiro → mascarar os arcos → ESFERA AZUL por cima.**

Justificativa: a esfera cobre ~3,7 m² e os três arcos somam ~1,3 m². Mascarar os
arcos (fitas curvas estreitas) custa uma fração de mascarar um disco de 2,16 m de
diâmetro. Além disso — e este é o argumento decisivo aqui — **a esfera é um
degradê radial contínuo**: se ela fosse pintada primeiro e os arcos mascarados
por cima depois, qualquer retoque na borda dos arcos exigiria recompor o degradê
localmente, o que é a operação mais difícil de acertar em aerografia. Pintando os
arcos antes e a esfera por cima, o degradê é aplicado **numa única passada
contínua sobre a máscara**, sem emenda.

Ordem geral crescente de cobertura:
`718 ≈ bloco de dados < transportes < AFO < arcos < esfera`
— mas como só os dois últimos se tocam, os demais são livres.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| `718` | **CORTE_MANUAL** | 59 cm de altura, 3 dígitos, geometria bold. Trivial. |
| **Arcos cinza-prata** | **FITA_AMARELA no corpo + CORTE_MANUAL nas pontas** | O substrato isoplastic libera fita amarela (§4). Os arcos são curvas de raio 1,5–3 m, exatamente o caso "faz qualquer curva, sem corte". Mas cada arco **afila até ~2 cm** nas duas extremidades, e fita não resolve ponta — os ~40 cm terminais de cada ponta saem a estilete. **Economia estimada: ~6 m de corte manual evitados.** Se o substrato for chapa (não isoplastic), tudo isso vira corte manual. |
| Degradê longitudinal dos arcos | **pistola em leque dentro da janela** | Degradê num corpo de 23 cm de largura: um passe de leque com dois tons de cinza. Rotineiro. |
| **Esfera** | **CORTE_MANUAL** da silhueta + **aerografia/pistola em leque** dentro | A silhueta é **um círculo de 2,16 m** — é o corte mais fácil possível (um compasso improvisado ou um gabarito resolve). O interior é degradê radial livre, contido pela máscara. **Este é o caso barato descrito no padrão nº 5 de `analysis_F`, e ali ela acerta:** degradê dentro de silhueta com borda mascarada é barato. A diferença é que aqui a borda **não** é toda T-F — os arcos a cortam. |
| Realce claro da esfera | **chapa reservada** (recomendado) ou extremidade clara do degradê | Ver §2 e §9. Reservar a chapa dá o ponto mais claro sem custo de tinta e sem risco de o branco "sujar" com o violeta. |
| `AFO` + barras | **CORTE_MANUAL** | Caixa-alta de 111 cm, serifas de ~4 cm, barras de 5 cm × 90 cm. Trivial. |
| `transportes` | **CORTE_MANUAL** | 62 cm, sans humanista, hastes de ~7 cm. Trivial. |
| **Bloco de dados** | **MASCARA_MAQUINA direto sobre a chapa** (sem verniz prévio) | 5 linhas, 4 delas com ~3 cm de altura e contrapunções de ~2 mm, num total de ~180 caracteres. **Muito além do estilete.** Mas assenta sobre chapa original → **dispensa o ciclo de verniz do §3.2**, como nas artes 1, 2 e 4. Cortar em negativo e transferir. |
| Fio do retângulo do bloco | **incluir no mesmo arquivo de corte** | traço de ~2 mm; sai junto. |

**Nada é impresso. Nada é adesivo final. A esfera é pintada.**

### 8) Sequência de sessões e dias
- **Dia 1 manhã — Preparação:** lavar, empapelar perfis/ferragens/borrachas,
  lixar (isoplastic) as áreas de esfera, arcos e textos.
- **Dia 1 tarde — Máscaras da sessão 1:** fita amarela no corpo dos arcos, corte
  manual das pontas; máscara de `718`, `transportes`.
- **Dia 2 manhã — S1: CINZAS.** Três tintas cinza que **não se tocam entre si**
  → mesma sessão (§6.4):
  - cinza-prata dos arcos (com leque longitudinal),
  - cinza médio de `transportes`,
  - grafite de `718`.
- **Dia 2 tarde — Mascarar os arcos** por inteiro; abrir a janela circular da
  esfera; aplicar máscara de `AFO` + barras.
- **Dia 3 manhã — S2: AZUIS.** Também na mesma sessão, porque **não se tocam**:
  - azul-marinho de `AFO` + barras (chapado),
  - degradê radial da esfera (aerografia/leque, claro → escuro).
- **Dia 3 tarde — S3: PRETO do bloco de dados** com máscara de máquina.
  Independente; poderia ser feita no Dia 1.
- **Dia 4 manhã — Remoção de máscaras**, retoques (crítico: as 4 junções
  arco/borda-da-esfera, raio ~3 cm).
- **Dia 4 tarde — Verniz geral.** Obrigatório para unificar brilho entre laca
  chapada e aerografia.

**Total: ~3,5 dias por lado.**
**A arte não espelha** (texto e o numeral de frota); e a **esfera é aerografia —
não duplica de graça**: cada lado exige um degradê refeito à mão. Orçar 2×
o tempo de aerografia, 1× o de corte (a máscara se reposiciona).

### 9) Armadilhas para o motor de visão
1. **Degradê radial da esfera vira N azuis chapados.** Uma quantização de 8 níveis
   devolve 8 regiões concêntricas e **7 fronteiras T-T fantasmas**, todas de
   curvatura fechada. Custo inventado: 7 sessões. O motor precisa reconhecer
   "gradiente contínuo dentro de silhueta fechada" e colapsar em **uma** região
   tecnológica.
2. **O realce da esfera é quase-branco.** Um classificador que use "≈ branco ⇒
   chapa reservada" vai abrir um furo no meio da esfera e reportar uma ilha
   branca. Semanticamente ele até acerta a *solução recomendada* (reservar a
   chapa), mas pelo motivo errado — e se o dono decidir pintar o realce, o motor
   não tem como saber.
3. **Os arcos cruzam a esfera.** A adjacência arco/esfera é uma travessia, não um
   contorno: o mesmo par (a,b) aparece **3 vezes** no grafo. O motor precisa
   somar comprimentos por par, não emitir 3 pares idênticos.
4. **Pontas afiladas dos arcos** (largura → 2 cm): a razão perímetro/área do arco
   é altíssima, o que um limiar ingênuo de `cortavel_a_mao` lê como
   "não-cortável". Mas o corpo é largo e só as pontas são finas — **o limiar
   precisa ser por trecho, não por elemento**.
5. **Duas famílias de azul** (violeta da esfera × marinho do `AFO`) muito
   próximas em matiz: quantização pode fundi-las e concluir erradamente que se
   trata de uma cor só — perdendo a informação de que **não se tocam** e, com
   isso, a economia de sessão do §6.4.
6. **Micro-texto do bloco de dados** (~5 px no raster): abaixo do limiar de
   corte. Sinalizar troca de estratégia, **não impressão**.
7. **`718` é numeral de frota, não marca** — muda de veículo para veículo. O
   motor deve marcá-lo como **variável por unidade**, senão o arquivo de corte é
   reaproveitado errado na próxima carreta.

### 10) Correções à análise antiga
Esta é a arte que a doutrina cita **nominalmente** no §0.

1. **"globo impresso aplicado por cima (impintável)"** — a linha 1 da tabela de
   erros do §0. **ERRADO.** A esfera é **pintada**: silhueta circular de 2,16 m
   mascarada (o corte mais fácil da arte) e degradê radial aplicado com
   aerógrafo/pistola em leque dentro da janela. Nada nela é impintável; ao
   contrário, é o tipo de degradê mais controlável que existe, porque é radial e
   está contido por uma borda dura.
2. **A justificativa antiga — "degradê ⇒ não dá para pintar" — é inválida** em
   ambos os sentidos. `analysis_F` o admite parcialmente no seu padrão nº 5
   ("degradê dentro de silhueta T-F é barato", caso SGT), mas não aplica o mesmo
   raciocínio ao globo. **É a mesma situação geométrica.** A incoerência interna
   da análise antiga é o achado aqui.
3. **`analysis_F` classifica bloco com micro-texto como impressão digital**
   (padrão nº 4). Aplicado ao bloco de endereço da AFO, mandaria imprimir. **Não.**
   Máscara de máquina + tinta preta, sem verniz prévio.
4. **`analysis_F` mapeia "curva suave e longa ⇒ fita amarela" sem checar
   substrato.** Aqui o substrato **permite** fita amarela — ela acerta por sorte.
   Mas o raciocínio dela é o mesmo que erra na arte 8 (SGT, chapa). A regra
   correta é substrato-primeiro.
5. **`analysis_F` sempre presume que a cor de fundo/maior entra primeiro e a
   menor por cima** (o esquema "claro→escuro", padrão nº 6). Aqui isso mandaria
   pintar a esfera e depois mascarar os arcos — invertendo a doutrina §2 e, pior,
   forçando retoque de degradê nas 4 junções. **Custo real: a diferença entre um
   degradê contínuo e um degradê emendado.**

---

# 6. Atacado Frios (Grupo Jorge Batista) — lateral

*(1600×619 px; proporção 2,58:1)*
**Implemento de referência assumido:** baú de truck **6,20 m × 2,40 m**.
**Fator de escala:** 1 px ≈ 3,88 mm.

### 1) Implemento e substrato provável
2,58:1 é a proporção clássica de **lateral de baú de truck**. Cliente:
distribuidora de frios, **distribuidor exclusivo BRF** — carga **refrigerada**.
Substrato: **ISOPLASTIC**, com alta confiança (é o padrão absoluto de baú
frigorífico).

**Consequências (§4):** fita amarela liberada. Aqui ela **é aproveitável de
verdade**: a grande seta vermelha é uma curva de raio ~1,5–2 m, e as três barras
paralelogramo da direita são retas. Ver §7.
**Lixamento** obrigatório nas janelas — e nesta arte, se a leitura de "pintura
geral" se confirmar, o lixamento é do **painel inteiro**, o que é um item de
custo relevante por si só.

### 2) Fundo — **DECISÃO CRÍTICA DESTA ARTE**
O campo de fundo **não é branco puro**: é um **cinza-claro levemente
azulado/quente**, uniforme, cobrindo ~100% do painel. Ao mesmo tempo, existem
brancos **puros** dentro dos selos de marca (o script `Kidelli`, as aves do selo
`Perdigão`). **Dois brancos diferentes na mesma arte é a evidência decisiva:**
se o fundo fosse a chapa original, os brancos dos selos teriam exatamente o mesmo
valor. Não têm.

**Leitura adotada: PINTURA GERAL cinza-claro, ~88% da superfície.**

Consequências pesadas dessa leitura:
- **Todo elemento não-branco passa a ter fronteira T-T com o fundo.** Numa arte
  sem pintura geral, texto sobre chapa é T-F e não custa nada; aqui **cada linha
  de texto navy tem fronteira tinta-tinta com o cinza**.
- Os brancos dos selos precisam ser **reservados antes da demão de cinza**, o que
  exige aplicar a máscara dos selos **duas vezes em registro** (uma antes do
  cinza, outra para as cores do selo).

**Leitura alternativa (a confirmar com o dono/cliente): o cinza é renderização de
mockup e o painel é chapa branca.** Nesse caso a arte perde **3 fronteiras T-T
macro** (todas contra o fundo), perde a demão geral e perde ~1,5 dia. **É a
ambiguidade de maior impacto financeiro de todo o slice — confirmar antes de
orçar.** Amostra de tinta ou o vetor original resolvem em 5 minutos.

O restante desta análise assume a leitura principal (pintura geral cinza-claro) e
sinaliza onde a alternativa muda a conclusão.

### 3) Inventário de elementos
1. **Campo cinza-claro** — pintura geral.
2. **Seta vermelha grande** — traço espesso (~21 cm) descrevendo um arco de
   ~270° em torno do bloco do logo: sobe pela esquerda, curva por cima, e a
   **cabeça de seta** aponta para cima-esquerda no topo; a cauda desce pela
   direita e termina afilando embaixo, no centro. Comprimento de eixo ~5,8 m.
3. **Logotipo `Atacado FRIOS`** — navy escuro, itálico bold:
   - `Atacado` em caixa-alta itálica (~21 cm),
   - `FRIOS` em caixa-alta itálica maior (~29 cm),
   - **três barras paralelogramo** navy à esquerda do texto (marca de velocidade).
4. **`DISTRIBUIDOR EXCLUSIVO` / `BRF REGIÃO SUL PIAUÍ`** — navy bold, 2 linhas,
   ~12 cm de altura de caixa-alta, à esquerda.
5. **`Grupo` / `Jorge Batista`** — navy itálico bold, 2 linhas, canto superior
   direito, ~14 cm.
6. **`ENTREGA RÁPIDA!`** — navy bold, ~15 cm, centro.
7. **Fileira de 4 selos de marca**, altura ~27 cm:
   - **BRF**: círculo facetado *low-poly* de ~25 cm de diâmetro, com **dezenas de
     facetas triangulares** em azul, ciano, roxo, laranja, vermelho e amarelo,
     cada faceta com leve variação de tom; ao lado, `brf` em caixa-baixa preta.
   - **`Sadia`**: `S` vermelho + `adia` preto.
   - **Perdigão**: selo oval vermelho com emblema de **duas aves** em branco e o
     nome em letras pequenas.
   - **Kidelli**: blob orgânico vermelho com contorno/realce **amarelo** e o
     script `Kidelli` em branco.
8. **Rodapé esquerdo**: `TELEVENDAS:` (pequeno) / `0800 280 1600 |` (grande
     navy) / `E-COMMERCE:` (pequeno) / `www.vendasjb.com` (grande navy).
9. **Três barras paralelogramo navy grandes** no canto direito (~58 × 136 cm
   cada), **cortadas pela borda direita** da arte — versão ampliada da marca de
   velocidade do logo.

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Cinza-claro (fundo geral) | chapada |
| Vermelho (seta, `S` da Sadia, selo Perdigão, blob Kidelli) | chapada — **verificar se é um único vermelho ou três** |
| Navy escuro (todo o texto + barras) | chapada |
| Preto (`brf`, `adia`) | chapada |
| Amarelo (contorno Kidelli) | chapada |
| **Facetas BRF** (azul, ciano, roxo, laranja, vermelho, amarelo) | **degradê por faceta** — bloco complexo |
| Branco (script Kidelli, aves Perdigão) | chapa reservada — mas **sob a pintura geral**, o que exige reserva antecipada |

### 5) Fronteiras T-T
**Macro (3):**

| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | **Vermelho (seta) × Cinza-claro (fundo)** | **~1160 cm** (todo o contorno da seta: 2 × 5,8 m) | **suave** no corpo (raio 1,5–2 m); **fechada** na cabeça de seta (3 vértices de raio ~2 cm) e na ponta da cauda | **Cinza-claro** (~13 m² contra ~1,3 m²) |
| T2 | **Vermelho (seta) × Navy (`Atacado FRIOS`)** | ~95 cm | **média** (contornos de letras itálicas, raio 3–10 cm) | **Navy** (letras + 3 barras grandes ≈ 2,0 m² contra 1,3 m²) |
| T3 | **Navy (todos os elementos) × Cinza-claro (fundo)** | **~3100 cm** (perímetro somado de todo o texto navy + as 3 barras grandes) | **média** nas letras (raio 1–5 cm); **reta** nas barras | **Cinza-claro** |

**Internas aos selos de marca (4 famílias, dezenas de fronteiras):**

| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T4 | **Facetas BRF × Facetas BRF** — dezenas de pares distintos (azul×ciano, ciano×roxo, roxo×vermelho, vermelho×laranja, laranja×amarelo…) | cada aresta 3–8 cm; total estimado **~180 cm** distribuídos em **~40 arestas** | **reta** (facetas poligonais) — mas em escala de **2–4 cm** | varia por par |
| T5 | **Vermelho × Amarelo** (Kidelli) | ~35 cm | **suave/fechada** (blob orgânico, raio 2–6 cm) | **Vermelho** |
| T6 | **Vermelho × Preto** (`S` da Sadia × `adia`) | ~10 cm | **fechada** (raio ~0,5 cm) | **Preto** (`adia` tem 4 letras contra 1) |
| T7 | **Vermelho × Branco interno** (aves e nome do selo Perdigão) | ~60 cm | **fechada** (raio 0,5–2 cm) | **Vermelho** — mas o branco é **chapa reservada**, então tecnicamente é T-F… |

> **T7 é o caso mais sutil do slice.** O branco das aves da Perdigão é chapa
> reservada — logo a fronteira vermelho×branco é T-F e "não gera trabalho". **Mas
> essa conclusão só vale se o branco tiver sobrevivido à pintura geral cinza.**
> Como há demão geral, aquele branco só existe se tiver sido mascarado **antes**
> do cinza. Ou seja: **numa arte com pintura geral, um branco interno de logo
> deixa de ser gratuito e passa a custar uma máscara extra em registro.** A
> doutrina não cobre esse caso; registro como refinamento necessário do §1.

**Pares que NÃO se tocam:**
- **Navy × Amarelo**, **Navy × facetas BRF**, **Navy × vermelho dos selos** — os
  selos são ilhas isoladas na fileira; o `brf`/`adia` pretos ficam fora dos
  blobs coloridos.
- **Seta vermelha × barras navy grandes da direita** — separadas por ~1 m.
- **Seta vermelha × selos** — a cauda da seta termina acima da fileira de selos.
- **`Grupo Jorge Batista` × qualquer coisa que não seja o fundo.**

### 6) Ordem de pintura
Aplicando **§6.2 antes de §2** — a pintura geral é sequenciada explicitamente
como etapa 2 do §6 e **não** está sujeita à regra de "menor cobertura primeiro".
Sem essa leitura, §2 mandaria pintar todo o texto navy **antes** do fundo cinza,
mascarar ~31 m de contorno de letra e só então dar a demão geral — absurdo
operacional. **Registro isto como a leitura doutrinária correta:** §2 governa
pares de *elementos*; §6.2 governa a *demão de fundo*.

**Ordem:**
1. **Reservas antecipadas:** máscara sobre os brancos internos dos selos
   (script Kidelli, aves e nome Perdigão) — **antes de tudo**.
2. **CINZA-CLARO** — pintura geral (§6.2).
3. **VERMELHO** (seta + `S` da Sadia + selo Perdigão + blob Kidelli).
   Justificativa T2: vermelho (~1,3 m²) < navy (~2,0 m²) → **vermelho antes de
   navy**, mascarar o vermelho, navy por cima.
4. **AMARELO** (contorno Kidelli) — não toca navy nem cinza diretamente… **toca o
   vermelho** (T5). Amarelo (~0,02 m²) << vermelho → **amarelo deveria vir antes
   do vermelho**. Corrigindo: amarelo entra **junto com a etapa 3, imediatamente
   antes do vermelho**, na mesma sessão de máscara local do Kidelli.
5. **NAVY** (todo o texto + 3 barras grandes).
6. **PRETO** (`brf`, `adia`) — toca só o vermelho do `S` (T6). Preto (~0,03 m²) >
   vermelho do `S` (~0,004 m²) → o `S` vermelho vem antes, junto da etapa 3.
   O preto entra na sessão do navy (não se tocam, mesma sessão — §6.4).
7. **FACETAS BRF** — ver §7; entram depois do verniz.

Ordem final consolidada:
`reservas brancas → CINZA (geral) → AMARELO → VERMELHO → NAVY + PRETO → verniz → FACETAS BRF`

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| Campo cinza-claro | **pintura geral** com empapelamento das bordas | Não é "elemento": é demão. |
| **Seta vermelha** | **FITA_AMARELA no corpo + CORTE_MANUAL na cabeça e na cauda** | Substrato isoplastic libera fita amarela (§4). O corpo é um arco de raio 1,5–2 m e largura constante de 21 cm — **duas fitas amarelas paralelas** definem os dois lados sem nenhum corte, ~11 m de fita. A **cabeça de seta** (3 vértices de raio ~2 cm) e a **ponta afilada da cauda** exigem estilete: ~80 cm de corte manual. **Economia: ~10 m de corte evitados.** Se a leitura de substrato mudar para chapa, tudo isso vira corte manual — ou **ESPOVO_DIRETO**, já que a seta é grande e geometricamente simples. |
| `Atacado FRIOS` + 3 barras do logo | **CORTE_MANUAL** | 21–29 cm de caixa-alta, itálico bold, hastes de ~4 cm. Cortável com folga. |
| `DISTRIBUIDOR EXCLUSIVO` / `BRF REGIÃO SUL PIAUÍ` | **CORTE_MANUAL** | ~12 cm de caixa-alta, bold. No limite confortável; contrapunções de `O`/`R` com ~2 cm. Passa. |
| `Grupo Jorge Batista` | **CORTE_MANUAL** | ~14 cm, itálico bold. |
| `ENTREGA RÁPIDA!` | **CORTE_MANUAL** | ~15 cm, bold. Trivial. |
| `TELEVENDAS:` / `E-COMMERCE:` | **CORTE_MANUAL** — no limite | ~5 cm de altura. Sans bold, sem serifa; contrapunções de ~0,8 cm. **É o ponto de calibração** de `cortavel_a_mao` nesta arte. Se o implemento for menor que 6 m, reclassificar para máquina. |
| `0800 280 1600` / `www.vendasjb.com` | **CORTE_MANUAL** | ~11 cm. Cortável. |
| **3 barras paralelogramo grandes (direita)** | **FITA_BRANCA** | 12 retas ao todo, sem uma única curva. §4: fita branca serve exatamente para traçado reto; é mais larga e não curva, mas aqui não há curva. **Zero corte.** (Fita amarela também serviria, mas a branca é mais larga e cobre mais de uma vez.) |
| **Selo `Sadia`** | **MASCARA_MAQUINA_SOBRE_VERNIZ** | ~17 cm de largura total, letras de ~10 cm mas com o `S` script de traço variável descendo a ~0,5 cm. Está no limite; o risco é que um erro no `S` estrague uma marca de terceiro (BRF é dona da Sadia — erro de marca tem consequência contratual). **Máquina por segurança de marca, não por geometria.** |
| **Selo `Perdigão`** | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Oval de ~33 cm contendo duas aves entrelaçadas de ~8 cm com traços de ~3 mm, mais o nome em ~2 cm. **Fora do estilete.** |
| **Selo `Kidelli`** | **CORTE_MANUAL** para o blob vermelho + amarelo; **MASCARA_MAQUINA** para o script branco | O blob tem ~45 cm e curvas de raio 2–6 cm — cortável. O script `Kidelli` tem traços de ~1 cm com conexões cursivas — máquina. E ele é **branco reservado**, logo tem que ser mascarado **antes da demão geral cinza**: exige o arquivo de corte já na primeira sessão. |
| **Selo `BRF` (círculo facetado)** | ⚠️ **PENDÊNCIA — decidir com o dono** | ~25 cm de diâmetro com **~40 facetas triangulares de 2–4 cm, cada uma com degradê próprio, em 6 famílias de cor**. Não é cortável à mão (fora de questão). Máscara de máquina exigiria **40 janelas em 6 registros diferentes** num círculo de 25 cm — tecnicamente possível, praticamente proibitivo (6 ciclos de máscara + 6 curas num elemento de 0,05 m²). **Não pode ser impresso.** Restam: **(a) aerografia** — pintar as facetas à mão com aerógrafo e máscaras soltas de papel, aceitando aproximação; **(b) pintura artística à mão** — pincel fino sobre o cinza curado; **(c) negociar com o cliente uma versão simplificada** do selo BRF (3–4 cores chapadas em vez de 40 facetas), que voltaria a ser cortável à máquina em 1 registro. **A opção (c) é a única com custo previsível** e deve ser levada ao cliente antes do orçamento. |
| `brf` / `adia` (textos pretos das marcas) | **MASCARA_MAQUINA_SOBRE_VERNIZ** | ~8 cm de caixa-baixa mas com traços de ~1,2 cm; entram no mesmo arquivo dos selos. |

### 8) Sequência de sessões e dias
- **Dia 1 — Preparação pesada:** lavar/desengraxar o painel inteiro, empapelar
  perfis, borrachas, ferragens, para-choque; **lixar o painel inteiro**
  (isoplastic + pintura geral). Aplicar as **reservas brancas** dos selos
  (script Kidelli, aves e nome Perdigão) com máscara de máquina em registro.
- **Dia 2 manhã — S1: CINZA-CLARO (pintura geral).** Fundo + cobertura. Cura.
- **Dia 2 tarde — Máscaras da seta:** fita amarela dupla no corpo, corte manual
  na cabeça e cauda. Máscara local do Kidelli.
- **Dia 3 manhã — S2: AMARELO** (contorno Kidelli) → cura ~1 h → **S3: VERMELHO**
  (seta + `S` Sadia + oval Perdigão + blob Kidelli). Mesma janela de trabalho.
- **Dia 3 tarde — Mascarar o vermelho.** Aplicar fita branca nas 3 barras
  grandes; máscara de todo o texto.
- **Dia 4 manhã — S4: NAVY + PRETO.** Não se tocam → mesma sessão (§6.4). Todo o
  texto, as 3 barras do logo, as 3 barras grandes, `brf`, `adia`.
- **Dia 4 tarde — Remoção de máscaras, retoques.**
- **Dia 5 manhã — VERNIZ GERAL.** Cura.
- **Dia 5 tarde / Dia 6 — S5: SELOS DE MARCA** sobre o verniz curado
  (`MASCARA_MAQUINA_SOBRE_VERNIZ`): Sadia, Perdigão, e o script do Kidelli.
- **Dia 6 — S6: BRF.** ⚠️ **Duração indefinida até a pendência ser resolvida.**
  Estimativa: 2 h se a versão simplificada for aprovada; **6–10 h por lado** se
  for aerografia/pincel das 40 facetas.
- **Verniz localizado** sobre os selos, para nivelar brilho.

**Total: ~5 dias por lado, MAIS a pendência BRF (0,25 a 1,5 dia por lado).**

**Se a leitura alternativa do fundo se confirmar (chapa branca, sem pintura
geral):** cai o Dia 1 de lixamento total, cai a S1 inteira, caem as reservas
antecipadas dos brancos de selo (viram T-F gratuitos) e as fronteiras T1 e T3
deixam de ser T-T. **Total cairia para ~3 dias.** Diferença: ~2 dias por lado,
×2 lados = **4 dias de obra dependendo de uma amostra de tinta.**

### 9) Armadilhas para o motor de visão
1. **O fundo cinza-claro é a armadilha nº 1 do slice inteiro.** Qualquer
   normalização de branco, correção de ponto branco ou "auto-levels" transforma
   `#e8e9ec` em `#ffffff` e **apaga 3 fronteiras T-T e uma demão inteira**. O
   motor precisa comparar o fundo com os **brancos internos dos selos** — a
   presença de dois brancos distintos é o sinal.
2. **O selo BRF explode em ~40 regiões.** Sem colapso, o grafo de adjacência
   ganha ~40 nós e ~60 arestas T-T num elemento de 0,05 m² — **o elemento com
   0,4% da área geraria 65% das fronteiras do grafo**. Colapsar em uma região
   tecnológica `BLOCO_COMPLEXO` e emitir **PENDÊNCIA**.
3. **Três vermelhos possivelmente distintos** (seta, Sadia, Perdigão/Kidelli):
   marcas de terceiros têm Pantones próprios. Fundi-los economiza uma tinta no
   papel e gera retrabalho de marca na prática.
4. **As 3 barras grandes estão cortadas pela borda direita** do arquivo. Isso é
   *bleed* de arte, não elemento truncado: no implemento elas continuam até a
   quina. O motor tende a fechar o polígono na borda e subestimar o perímetro.
5. **`Sadia` tem `S` vermelho e `adia` preto colados** — uma fronteira T-T de
   10 cm com raio 0,5 cm dentro de um logo de 17 cm. Um detector de fronteiras
   com suavização de 3 px a apaga inteira.
6. **`TELEVENDAS:` e `E-COMMERCE:` a ~5 cm** ficam exatamente em cima do limiar
   de `cortavel_a_mao`. Esta arte é uma boa amostra de calibração: se o dono
   disser "isso a gente corta", o limiar está abaixo de 5 cm.
7. **Os brancos dos selos parecem T-F mas custam máscara antecipada** por causa
   da demão geral. O motor precisa de uma regra: `branco interno + pintura geral
   ⇒ reserva em registro, custo > 0`.
8. **JPEG sobre o círculo BRF** cria dezenas de tons intermediários entre facetas
   — a contagem de cores pode passar de 100 se não houver colapso.

### 10) Correções à análise antiga
`analysis_F.md` §2 (CLEBIN lateral) é o análogo mais próximo — distribuidora de
frios, selos de marca em fileira, fundo claro, faixa/banner colorido.

1. **`analysis_F` §2.5: "6 selos pequenos idênticos são fortes candidatos a
   adesivo impresso"** e **§2.9: "detector deve sinalizar 'texto abaixo de altura
   mínima → impressão digital'"**. **ERRADO — é literalmente a premissa que a
   doutrina derrubou.** Aqui isso mandaria imprimir BRF + Sadia + Perdigão +
   Kidelli, os quatro elementos mais caros da arte, e sumiria com a pendência. A
   solução correta é **máscara de máquina sobre verniz** para os três selos
   chapados e **PENDÊNCIA (aerografia × pintura à mão × simplificação
   negociada)** para o BRF.
2. **`analysis_F` padrão transversal nº 4: "asset delimitado com texto abaixo da
   altura mínima pintável → impressão digital"** — a regra transversal que
   institucionaliza o erro. **Deve ser removida do motor.** A substituição é:
   *asset abaixo da altura mínima → máscara recortada a máquina; asset com
   degradê contínuo por sub-região → PENDÊNCIA.*
3. **`analysis_F` §2.2 afirma para a CLEBIN "Branco ~75–80%. Branco original —
   sem pintura geral"** com base em inspeção visual. Aqui, a mesma inspeção
   visual daria a mesma resposta e **estaria errada**: o fundo é cinza-claro
   pintado, não chapa. `analysis_F` não tem nenhum teste para distinguir
   "off-white de mockup" de "cinza pintado" — e o teste existe (comparar com os
   brancos internos dos logos).
4. **`analysis_F` §2.5: "delimitar a faixa reta com fita de corte (reta → fita é
   trivial)"** — usa "fita" genericamente, **sem distinguir amarela de branca e
   sem consultar o substrato** (§4). Nesta arte a distinção importa: a seta curva
   só aceita **amarela** (e só porque o substrato é isoplastic); as barras retas
   aceitam **branca**. Um orçamento com a fita errada erra em ~10 m de corte.
5. **`analysis_F` padrão nº 6: "ordem claro→escuro"**. Aqui mandaria pintar o
   **cinza-claro por último** (é a cor mais clara). A doutrina §6.2 manda pintar a
   **pintura geral primeiro**. Regras diretamente contraditórias; a antiga
   inverte todo o cronograma.
6. **`analysis_F` §2.5 sobre o swoosh: "Como amarelo é claro e bordô cobre bem,
   ordem claro→escuro com fita na junta resolve"**. O critério é luminosidade.
   **A doutrina §2 usa cobertura de área.** Aqui, em T5 (Kidelli), as duas regras
   coincidem por acaso — mas em T2 (vermelho × navy) a regra antiga mandaria
   vermelho primeiro por ser mais claro, e a doutrina manda vermelho primeiro por
   cobrir menos. **Coincidir por acaso é pior que errar**, porque esconde que o
   critério está errado.

---

# 7. Azzioly Transportes — lateral

*(1600×268 px; proporção 5,97:1)*
**Implemento de referência assumido:** carreta **14,0 m × 2,35 m**.
**Fator de escala:** 1 px ≈ 8,75 mm.

### 1) Implemento e substrato provável
5,97:1 → **carreta / baú longo**. Cliente: transportadora de carga geral
(`AZZIOLY TRANSPORTES`), sem indicação de refrigeração.

**Dois cenários de substrato, com consequências opostas:**
- **CHAPA_BRANCA** (baú de carga seca em chapa lisa) — cenário adotado.
  §4: **sem fita amarela**. O grande campo navy do canto esquerdo tem uma borda
  em curva de raio ~2 m que teria de sair por **corte manual** ou
  **ESPOVO_DIRETO**.
- **LONA** (semirreboque sider) — plausível numa carreta de 14 m de carga geral.
  §4: **fita amarela liberada**, e a curva do campo navy sai sem corte nenhum.
  **Porém**: pintura sobre lona é outro sistema de tinta e outro fluxo — se for
  sider, provavelmente a arte nem entra no fluxo de pintura.

Adotado **CHAPA_BRANCA**; confirmar, porque é a diferença entre ~2,5 m de corte
manual em curva e zero.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 85%.
Áreas pintadas: campo navy do canto esquerdo (~9%), logo circular + monograma
(~3%), wordmark `AZZIOLY` + `TRANSPORTES` (~2,5%), slogan e URL (~0,5%).

Nenhum branco é tinta. O interior do anel do logo é chapa branca, e o vão entre
os traços do monograma `Z` também.

### 3) Inventário de elementos
1. **`17` dentro de um círculo fino**, canto superior esquerdo — **número de
   referência do mockup/prancha, NÃO É ARTE.** Não pintar. (Ver §9.)
2. **Campo navy** ocupando o canto esquerdo, delimitado por uma **curva convexa
   ampla** que sai da borda esquerda em cima, avança até ~3,4 m e volta à borda
   inferior. Raio ~2 m.
3. **Anel bicolor do logo** — círculo aberto de ~1,75 m de diâmetro, traço de
   ~12 cm: o **arco superior/direito é navy** e o **arco inferior/esquerdo é
   teal** (verde-azulado). Os dois arcos se encontram em **duas junções**.
4. **Monograma `Z` em forma de raio** — um `Z` estilizado com corte diagonal,
   ~1,3 m × 1,2 m, **bipartido**: a metade superior-direita em navy e a metade
   inferior-esquerda em teal, com um pequeno detalhe `zz` navy dentro da porção
   superior. Os traços do `Z` **atravessam o anel**.
5. **`AZZIOLY`** — caixa-alta bold, cinza médio, ~74 cm de altura, ~4,5 m de
   largura.
6. **`T R A N S P O R T E S`** — caixa-alta cinza com entreletra aberta, ~19 cm.
7. **`"O segredo é ter Fé em Deus"`** — script cursivo itálico navy, entre aspas,
   ~19 cm de altura de corpo, centro inferior.
8. **`AZZIOLY.COM.BR`** — caixa-alta bold navy, ~22 cm, canto inferior direito.

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Navy escuro (campo, arco superior, parte do `Z`, slogan, URL) | **chapada** |
| Teal / verde-azulado (arco inferior, parte do `Z`) | **chapada** |
| Cinza médio (`AZZIOLY`, `TRANSPORTES`) | **chapada** (com leve variação de renderização no layout — produzir chapada) |
| Branco | chapa reservada |

**3 tintas. Sem degradê real, sem metálico, sem bloco fotográfico. Sem
pendência.**

### 5) Fronteiras T-T
| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | **Navy (arco superior) × Teal (arco inferior)** | ~24 cm (duas junções de ~12 cm, = a espessura do traço do anel) | **reta** (corte transversal do anel) | **Navy** |
| T2 | **Navy (`Z`) × Teal (`Z`)** | ~175 cm | **média a fechada** (ângulos agudos do raio, raio 2–6 cm) | **Navy** |
| T3 | **Teal (arco do anel) × Navy (traços do `Z`)** | ~52 cm (2 travessias × 2 bordas × ~13 cm) | **reta** | **Navy** |
| T4 | **Cinza (`A` de `AZZIOLY`) × Navy (ponta direita do arco)** | ~26 cm | **suave** (raio ~85 cm — a borda do anel) | **Navy** |

**Pares que NÃO se tocam** — a lista que torna esta arte barata:
- **Teal × Cinza** — o teal está confinado ao quadrante inferior-esquerdo do logo
  e o cinza começa depois do anel. **Podem ir na mesma sessão** (§6.4).
- **Teal × Campo navy do canto esquerdo** — separados por ~2 m de chapa branca.
  (Ambos tocam navy, mas por elementos diferentes.)
- **Campo navy × qualquer elemento do logo ou texto** — o campo termina a ~2 m do
  anel.
- **Slogan navy × `AZZIOLY` cinza** — o script fica abaixo e à esquerda, com
  respiro branco.
- **`AZZIOLY.COM.BR` navy × tudo** — isolado no canto inferior direito.
- **`TRANSPORTES` cinza × tudo** — isolado abaixo do wordmark.

> **T4 é a única fronteira duvidosa.** No layout a ponta direita do arco navy
> parece encostar na perna esquerda do `A`. Se houver respiro branco, T4
> desaparece e **cinza e teal ficam ambos totalmente livres de navy exceto pelo
> logo**, o que não muda a contagem de sessões (2), mas simplifica a máscara.
> Verificar no vetor.

### 6) Ordem de pintura (§2)
Cobertura estimada, em ordem crescente:

| Cor | Área estimada |
|---|---|
| **Teal** | ~0,35 m² (meio anel + metade do `Z`) |
| **Cinza** | ~1,6 m² (`AZZIOLY` + `TRANSPORTES`) |
| **Navy** | ~4,6 m² (campo esquerdo ~3,8 m² + anel + `Z` + slogan + URL) |

Verificando cada par:

| Par | Ordem | Justificativa |
|---|---|---|
| T1 navy×teal (anel) | **teal → navy** | o teal é meio anel (~0,17 m²); o navy soma 4,6 m². Mascarar o arco teal é trivial. |
| T2 navy×teal (`Z`) | **teal → navy** | idem; a metade teal do monograma é ~0,18 m². |
| T3 teal×navy (travessia) | **teal → navy** | idem. |
| T4 cinza×navy | **cinza → navy** | `AZZIOLY` cobre 1,6 m²; navy 4,6 m². Mascarar o wordmark cinza é mais barato que mascarar o campo navy de 3,8 m². |

Ordem crescente global `teal < cinza < navy` satisfaz os quatro pares.

**E o achado de cronograma:** **teal e cinza NÃO se tocam** → vão na **MESMA
SESSÃO** (§6.4). A arte inteira sai em **2 sessões de pintura**.

Note o contraste com a arte 1: lá havia 7 T-T encadeadas formando uma corrente de
6 elos, exigindo 6 sessões. Aqui há 4 T-T mas todas convergem para **um único
vértice** (navy), então o grafo tem profundidade 2. **É a topologia do grafo de
fronteiras que dita o cronograma, não a contagem de fronteiras.** Um motor que
orce por "nº de T-T" daria à Azzioly (4 T-T) quase o mesmo custo da traseira ADRI
(4 T-T), quando na verdade uma sai em 2 sessões e a outra em 4.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| `17` no círculo | **NÃO PINTAR** | marca de prancha. |
| **Campo navy do canto esquerdo** | **ESPOVO_DIRETO** (+ empapelamento) | Uma **única curva convexa de ~2,5 m de comprimento e raio ~2 m**, delimitando um campo de 3,8 m². É o caso literal do §3.3: "muito grande e muito fácil", faixa batida **direto na chapa**. Kraft furado marca a curva com carvão, empapela-se por fora, pinta. **Alternativa se isoplastic/lona: FITA_AMARELA**, que elimina até o espovo. **Nunca vinil**: 2,5 m de filme cortado para uma curva única é desperdício. |
| **Anel bicolor** | **CORTE_MANUAL** | Círculo de 1,75 m de diâmetro com traço de 12 cm. Duas curvas concêntricas de raio 82 e 94 cm — o corte mais fácil que existe (gabarito/compasso). As duas junções teal/navy são cortes retos de 12 cm. |
| **Monograma `Z`** | **CORTE_MANUAL** | 1,3 m × 1,2 m, traços de ~20 cm, ângulos agudos de raio 2–6 cm. Grande e anguloso: estilete resolve. O detalhe `zz` interno tem ~15 cm — também cortável. |
| **Travessias `Z` × anel** | **CORTE_MANUAL in situ** | Este é o ponto que exige atenção de registro: o `Z` navy corta o arco teal em 2 lugares. Cortar in situ (§3.1), com o teal **já curado**, garante encaixe perfeito sem depender de registro de máquina. **É exatamente o argumento do §3.1**: a máscara gruda na laca curada e o corte segue o que está lá, não o que o arquivo previa. |
| `AZZIOLY` | **CORTE_MANUAL** | Caixa-alta de 74 cm, sans bold geométrico, hastes de ~11 cm. Trivial. |
| `T R A N S P O R T E S` | **CORTE_MANUAL** | ~19 cm, entreletra aberta, hastes de ~2,5 cm. Cortável. |
| `"O segredo é ter Fé em Deus"` | **CORTE_MANUAL** — elemento mais exigente | Script cursivo com traço variável: as finas do script têm ~0,8–1,2 cm no implemento, com laços fechados nos `g`, `e`, `D`. **Está no limite do estilete.** Recomendação: cortar à mão com lâmina nova; se a equipe não confiar, é o único candidato a máquina desta arte — e como assenta sobre chapa branca, **não exige verniz prévio**. |
| `AZZIOLY.COM.BR` | **CORTE_MANUAL** | ~22 cm, bold. Trivial. |

**Nada é impresso. Nada é adesivo final.**

### 8) Sequência de sessões e dias
- **Dia 1 manhã — Preparação:** lavar, empapelar perfis, borrachas, ferragens,
  faixa refletiva inferior. Furar o estêncil de kraft da curva do campo navy
  (pode ser feito fora do implemento, em paralelo, e serve para os dois lados
  se espelhado).
- **Dia 1 tarde — Máscaras da S1:** corte manual do arco teal, da metade teal do
  `Z`, de `AZZIOLY` e de `TRANSPORTES`.
- **Dia 2 manhã — S1: TEAL + CINZA** (mesma sessão — não se tocam, §6.4). Duas
  pistolas ou duas passagens; laca cura ~1 h.
- **Dia 2 tarde — Máscara da S2:** mascarar todo o teal e todo o cinza; bater
  carvão pelo espovo da curva do campo navy; empapelar; cortar in situ as
  travessias do `Z` sobre o teal curado; máscara do slogan e da URL.
- **Dia 3 manhã — S2: NAVY.** Campo esquerdo + arco superior + metade navy do `Z`
  + `zz` + slogan + URL. Tudo numa demão.
- **Dia 3 tarde — Remoção**, retoques (atenção às 2 junções do anel e às 2
  travessias do `Z` — 4 pontos de encontro teal/navy).
- **Dia 4 manhã — Verniz geral.** Faixa refletiva por cima do verniz curado.

**Total: ~3 a 3,5 dias por lado** — dos quais **apenas 2 são sessões de
pintura**; o resto é preparação, mascaramento e verniz. **Este é o padrão
esperado quando o grafo de fronteiras é raso.**

**Não espelha** (texto): mesma máscara reposicionada; o **estêncil de kraft do
campo navy precisa ser virado** para o outro lado.

### 9) Armadilhas para o motor de visão
1. **O `17` no círculo é numeração de prancha, não arte.** Um segmentador
   ingênuo cria um elemento circular navy de 26 cm no canto superior esquerdo,
   sobre o campo navy — inventando inclusive uma fronteira navy×navy. Regra:
   glifos numéricos isolados em canto de arquivo, com contorno fino e sem relação
   com a paleta, são metadados de prancha.
2. **Navy do campo × navy do logo são a mesma tinta mas elementos distintos.**
   Um grafo por cor (não por região) funde os dois e conclui erradamente que o
   campo esquerdo toca o anel teal. Precisa ser grafo de **regiões conexas**,
   com atributo de cor.
3. **T4 (cinza × navy) é decidida por poucos pixels.** Antialiasing na ponta do
   arco pode criar ou apagar a fronteira. Impacto: baixo em sessões, alto em
   instrução de máscara.
4. **Teal e navy são vizinhos em matiz** sob JPEG: na junção do anel há ~3 px de
   pixels intermediários que quantizam como uma terceira cor "azul-petróleo"
   inexistente.
5. **O `Z` atravessa o anel** — mesma armadilha da arte 5 (arcos × esfera): o par
   (teal, navy) aparece 3 vezes no grafo (T1, T2, T3). Somar por par.
6. **O slogan em script** tem traço variável que, no raster de 1600 px, tem 1–2 px
   nas finas. `detalhe_minimo_mm` calculado no raster vai dizer "0,9 cm" — que é
   exatamente o valor real e exatamente o limite. Boa amostra de calibração.
7. **Topologia, não contagem:** o motor precisa emitir a **profundidade do grafo
   de precedência** (aqui: 2) além da contagem de T-T (aqui: 4). São duas artes
   com 4 T-T neste slice (esta e a traseira ADRI) e cronogramas bem diferentes.

### 10) Correções à análise antiga
1. **`analysis_F` padrão transversal nº 2** diz: *"suave/longa → fita amarela
   flexível"*, como regra de motor, **sem consultar o substrato**. Aplicada à
   curva do campo navy (2,5 m, raio 2 m), mandaria fita amarela. **ERRADO se o
   baú for de chapa** (§4: fita amarela só em isoplastic/lona). A solução correta
   em chapa é **espovo direto** — outro material, outro tempo, outra pessoa.
2. **`analysis_F` §5 (mar e rio) e §6 (SGT) tratam "adesivo plotado" como o
   instrumento padrão de qualquer silhueta.** Aqui, o anel de 1,75 m e o `Z` de
   1,3 m são **os elementos mais fáceis de cortar à mão do slice inteiro**.
   Plotá-los seria pagar máquina para cortar um círculo.
3. **`analysis_F` padrão nº 6 ("claro→escuro")** mandaria: cinza (mais claro) →
   teal → navy. A doutrina §2 manda **teal → cinza → navy** e, mais importante,
   revela que **teal e cinza cabem na mesma sessão**. A regra antiga, ao impor
   uma ordem total por luminosidade, **destrói a informação de paralelismo** e
   produz 3 sessões onde bastam 2. Numa frota, isso é um dia por veículo.
4. **`analysis_F` não distingue corte in situ de corte pré-fabricado.** Nas 2
   travessias do `Z` sobre o anel teal, o §3.1 é decisivo: cortar in situ sobre a
   laca curada dispensa registro de máquina e absorve qualquer desvio de
   posicionamento. A análise antiga trataria como "registro crítico entre duas
   máscaras plotadas" (a linha que ela escreve para o monograma da CJ PILGER) —
   um problema que **não precisa existir**.
5. **`analysis_F` não tem conceito de topologia do grafo.** Suas tabelas de
   fronteira são listas planas; o cronograma dela é derivado de "quantas cores
   empilhadas", não de "qual a profundidade da cadeia de precedência". Nesta arte
   as duas leituras divergem (4 fronteiras, profundidade 2).
6. **Nada nesta arte é impresso** e `analysis_F` também não afirmaria isso —
   mas o padrão nº 4 dela marcaria o **script do slogan** (traço de ~1 cm) como
   candidato a impressão. **Rejeitado:** é corte manual no limite, ou máscara de
   máquina sem verniz. Nunca vinil impresso.

---

# 8. SGT LOG — lateral

*(1600×289 px; proporção 5,54:1)*
**Implemento de referência assumido:** carreta **13,5 m × 2,44 m**.
**Fator de escala:** 1 px ≈ 8,44 mm.

> **Esta é a única arte do slice que `analysis_F.md` analisa diretamente
> (seção 6). A seção §10 abaixo é uma correção item a item, e inclui erros de
> observação — não só de doutrina.**

### 1) Implemento e substrato provável
5,54:1 → **carreta / baú longo**. Cliente: `SGT LOG — Sistema de Gestão em
Transporte`, transporte rodoviário genérico, sem indicação de refrigeração.

Substrato adotado: **CHAPA_BRANCA** (baú de carga seca).

**Esta decisão é o pivô econômico da arte.** §4:
- Em **chapa**, fita amarela **não é opção**. A borda superior da estrada (curva
  de ~15 m, raio 4–8 m) e a linha amarela (curva de ~7,6 m) **não podem** ser
  feitas com fita amarela.
- A **fita branca** é a alternativa de fita em chapa — mas ela **não faz curva**,
  e aqui é tudo curva. **Fita está fora nas duas curvas principais.**
- Restam **ESPOVO_DIRETO** (§3.3) e **CORTE_MANUAL**.

`analysis_F` prescreveu fita amarela para os dois elementos. Ver §10.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 58%.

Áreas pintadas: bloco laranja do canto esquerdo (~13%), estrada cinza-prata
(~26%), linha amarela (~0,5%), logotipo `SGT LOG` + tagline (~2,5%).

O branco predominante fica na faixa superior-central e à direita, atrás do
logotipo. **Nenhum branco é tinta.**

Nota: a estrada tem um **degradê de prata** (mais clara na borda superior/à
esquerda, mais escura descendo à direita), e o topo do degradê chega perto do
branco — a fronteira estrada/branco tem contraste baixíssimo em parte do
percurso. Ver §9.

### 3) Inventário de elementos
1. **Bloco laranja** — campo chapado no canto esquerdo, ocupando da borda
   esquerda até ~2,9 m, delimitado por uma **curva ampla** que desce da borda
   superior-esquerda e sai pela borda inferior.
2. **Estrada** — faixa cinza-prata larga com **degradê longitudinal**,
   atravessando a lateral inteira: entra pela borda superior-esquerda (~1 m do
   canto), descreve uma curva ampla descendente e ocupa toda a base à direita.
   Largura variável (~40 cm no topo esquerdo, alargando para ~1,4 m à direita).
3. **Linha amarela** — filete contínuo de ~6 cm de largura, acompanhando a curva
   da estrada, entrando pelo alto à esquerda e saindo pela borda inferior a
   ~5,9 m da esquerda. Comprimento ~7,6 m.
4. **`SGT`** — caixa-alta itálica muito bold, **preenchida por um degradê
   vertical laranja (topo) → vermelho (base)**.
5. **Traços de velocidade vermelhos** — 3 a 4 barras horizontais finas, à
   esquerda/abaixo do `S` e do `G`, no mesmo vermelho da base do degradê.
6. **`LOG`** — caixa-alta cinza, **rotacionada 90°** (vertical), encaixada à
   direita do `T`.
7. **`SISTEMA DE GESTÃO EM TRANSPORTE`** — caixa-alta cinza com entreletra
   aberta, ~17 cm de altura, **sobre chapa branca** (ver §10, erro de observação
   de `analysis_F`).

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Laranja (bloco) | **chapada** |
| Cinza-prata (estrada) | **degradê longitudinal suave** (2 tons) |
| Amarelo (linha) | **chapada** |
| Laranja→vermelho (`SGT`) | **DEGRADÊ VERTICAL** dentro das letras |
| Vermelho (traços de velocidade) | **chapada** — provavelmente **o mesmo vermelho** da base do degradê |
| Cinza médio (`LOG`, tagline) | **chapada** |
| Branco | chapa reservada |

**Sem bloco fotográfico. Sem metálico. Sem pendência.** Os dois degradês são
geométricos simples (um leque longitudinal numa faixa, um leque vertical dentro
de letras) — território de pistola em leque.

### 5) Fronteiras T-T
| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | **Laranja (bloco) × Cinza-prata (estrada)** | ~127 cm | **suave** (raio ~3–5 m) | **Cinza-prata** (~8,5 m² contra ~4,1 m²) |
| T2 | **Amarelo (linha) × Cinza-prata (estrada)** | **~1520 cm** (as duas bordas do filete ao longo de 7,6 m) | **suave** no trecho alto (raio ~5 m), **média** na descida (raio ~1,5 m) | **Cinza-prata** (~8,5 m² contra ~0,05 m²) |
| T3 | **Cinza (`LOG`) × Degradê laranja/vermelho (`SGT`)** | ~51 cm | **reta a média** (bordas de letra itálica bold) | **`SGT`** (~1,0 m² contra ~0,08 m²) |
| T4 *(condicional)* | **Vermelho (traços de velocidade) × Degradê (`SGT`)** | ~170 cm **se forem tintas distintas** | **reta** | **`SGT`** |

> **T4 provavelmente NÃO É uma fronteira.** O vermelho dos traços de velocidade
> é, quase certamente, **o mesmo vermelho da extremidade inferior do degradê das
> letras**. Se for, os traços e as letras são **um único elemento cromático**:
> saem da **mesma janela de máscara**, na **mesma passada de leque**, com os
> traços sendo apenas ilhas adicionais dessa máscara. **Zero fronteira, zero
> sessão extra.** Se o cliente especificar um vermelho distinto, T4 volta a
> existir e obriga uma sessão adicional após a cura do degradê. **Item a
> confirmar no vetor — vale meio dia.**

**Pares que NÃO se tocam** — e é o que salva o cronograma desta arte:
- **Amarelo × Laranja** — a linha amarela entra no alto a ~1,7 m da borda e o
  bloco laranja termina antes; a linha só cruza território cinza. **Não se
  tocam** → mesma sessão (§6.4).
- **Laranja (bloco) × `SGT`** — extremos opostos da lateral, ~9 m de distância.
- **Amarelo × `SGT` / `LOG` / tagline** — idem.
- **Cinza-prata (estrada) × `LOG` / tagline / `SGT`** — o logotipo fica no terço
  superior direito; a estrada, na base. **Verificar a quina inferior direita**:
  se a estrada subir até a altura da tagline, aparece uma T-T nova (cinza-prata ×
  cinza médio) que, sendo dois cinzas, é fácil de perder.
- **Cinza médio (`LOG`, tagline) × Cinza-prata (estrada)** — ver acima. **Se
  forem o MESMO cinza**, não há fronteira, mas há um conflito de sequência
  (`LOG` tem que vir antes do `SGT`, e a estrada tem que vir depois do amarelo):
  resolver com **duas janelas de máscara na mesma demão** ou com dois tons.

### 6) Ordem de pintura (§2)
Cobertura estimada, em ordem crescente:

| Cor | Área estimada |
|---|---|
| Amarelo (linha) | ~0,05 m² |
| Cinza médio (`LOG` + tagline) | ~0,08 m² |
| Degradê `SGT` (+ traços) | ~1,0 m² |
| Laranja (bloco) | ~4,1 m² |
| Cinza-prata (estrada) | ~8,5 m² |

Verificando os pares:

| Par | Ordem | Justificativa |
|---|---|---|
| T1 laranja × estrada | **laranja → estrada** | 4,1 m² contra 8,5 m². Mascarar o bloco laranja é ~metade do trabalho de mascarar a estrada. |
| T2 amarelo × estrada | **amarelo → estrada** | **170× menos área.** Este é o caso mais claro do §2 no slice inteiro: pintar um filete de 6 cm × 7,6 m e mascará-lo custa uma fração de mascarar uma faixa de 8,5 m² para depois pintar o amarelo dentro. **A regra economiza aqui ~8 m² de mascaramento.** |
| T3 `LOG` × `SGT` | **`LOG` → `SGT`** | 0,08 m² contra 1,0 m². |
| T4 (se existir) | **traços → `SGT`**… | …mas veja acima: provavelmente é a mesma tinta e a questão não se coloca. |

Ordem crescente global: `amarelo ≈ cinza médio < SGT < laranja < estrada`.

**Colapso de sessões (§6.4):** amarelo, cinza médio e laranja **não se tocam
entre si**. Todos os três podem ir na **mesma sessão**. E o `SGT` não toca a
estrada nem o laranja — pode ir junto da estrada.

**Sessões finais: 2.**
- **S1** = amarelo (linha) + cinza médio (`LOG` + tagline) + laranja (bloco)
- **S2** = cinza-prata (estrada, com leque) + `SGT` (degradê + traços)

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| **Estrada cinza-prata** | **ESPOVO_DIRETO** | Faixa de ~15 m de extensão, borda superior em curva única de raio 4–8 m, geometria simples. É a definição literal do §3.3: "**Faixa**: espovo batido **direto na chapa**. É o caso comum de faixa." Kraft furado com a curva, carvão, empapelamento por fora, leque de prata dentro. **Em chapa, fita amarela está proibida (§4) e fita branca não faz curva — espovo é a única saída barata.** |
| **Linha amarela** | **ESPOVO_DIRETO para marcar + CORTE_MANUAL do filete** | Também é uma faixa (6 cm × 7,6 m), muito grande e muito fácil. O espovo marca a linha de centro; o filete de 6 cm é delimitado por duas máscaras paralelas cortadas seguindo o carvão. **Não é fita amarela** (substrato) **nem vinil** (7,6 m de filme para um filete). |
| **Bloco laranja** | **ESPOVO_DIRETO** | Uma curva única de ~3 m, raio 3–5 m, delimitando 4,1 m². Mesmo estêncil de kraft pode carregar a curva do bloco e a da estrada juntas, **garantindo o paralelismo entre elas** — que é o que se perde ao marcar cada uma isoladamente. |
| Degradê longitudinal da estrada | **pistola em leque** dentro do empapelamento | 2 tons de prata ao longo de 15 m. Rotineiro; exige ambiente sem vento (leque de 15 m denuncia qualquer poeira). |
| **`SGT`** | **CORTE_MANUAL** da silhueta + **leque vertical laranja→vermelho** dentro | Caixa-alta itálica de ~93 cm, muito bold, hastes de ~18 cm. O corte é fácil. O degradê é **contido pela máscara** e encosta apenas em **chapa branca** na maior parte do contorno → **degradê dentro de silhueta T-F, o caso barato**. Não precisa de precisão de borda: a máscara segura. |
| **Traços de velocidade vermelhos** | **incluir na mesma máscara do `SGT`** (se for o mesmo vermelho) | Ver T4. Se for tinta distinta: CORTE_MANUAL + sessão após a cura do degradê. |
| **`LOG`** | **CORTE_MANUAL** | ~46 cm de altura, 3 letras rotacionadas, bold. Trivial. |
| **`SISTEMA DE GESTÃO EM TRANSPORTE`** | **CORTE_MANUAL** | ~17 cm de caixa-alta, entreletra aberta, sans bold, hastes de ~2,5 cm. Cortável com folga. **Não é texto branco dentro de barra escura** (ver §10). |

**Nada é impresso. Nada é adesivo final. Nenhuma fita amarela — o substrato não
permite.**

### 8) Sequência de sessões e dias
- **Dia 1 manhã — Preparação:** lavar, empapelar perfis, borrachas, ferragens,
  para-choque, faixa refletiva. **Furar o estêncil de kraft** com as três curvas
  (borda do bloco laranja, borda superior da estrada, eixo da linha amarela) —
  **num único kraft**, para preservar o paralelismo entre elas. Este é o item de
  maior lead-time e pode ser preparado em paralelo, fora do implemento.
- **Dia 1 tarde — Marcação e máscaras da S1:** bater carvão pelo espovo; cortar
  as máscaras do filete amarelo (duas paralelas), do bloco laranja e das letras
  `LOG` + tagline.
- **Dia 2 manhã — S1: AMARELO + CINZA MÉDIO + LARANJA.** Três tintas que **não se
  tocam** → uma sessão (§6.4). Cura de laca ~1 h entre elas.
- **Dia 2 tarde — Máscaras da S2:** mascarar o filete amarelo inteiro (6 cm ×
  7,6 m — operação delicada mas barata), mascarar o bloco laranja, mascarar
  `LOG`; abrir a janela da estrada e a silhueta do `SGT`.
- **Dia 3 manhã — S2: CINZA-PRATA (leque na estrada) + `SGT` (leque vertical
  laranja→vermelho + traços).** Não se tocam → mesma sessão.
- **Dia 3 tarde — Remoção de máscaras**, retoques. Pontos críticos: a junção
  laranja/estrada (T1) e as duas bordas do filete amarelo ao longo de 7,6 m.
- **Dia 4 manhã — Verniz geral** (obrigatório para unificar brilho entre chapado
  e leque). Faixa refletiva por cima do verniz curado.

**Total: ~3,5 dias por lado.**
**Não espelha** (texto e a direção da curva da estrada): mesma máscara
reposicionada, **estêncil de kraft espelhado**.
**Continuidade nas quinas:** a estrada muito provavelmente contorna para a
traseira e/ou a frente — alinhar a altura da curva nas quinas antes de qualquer
marcação, senão a arte "quebra" no canto.

### 9) Armadilhas para o motor de visão
1. **Degradê laranja→vermelho das letras `SGT` vira bandas.** Quantização cria
   4–8 laranjas/vermelhos concêntricos e **inventa 3–7 fronteiras T-T fechadas**
   dentro de um elemento de 1 m². Classificar a **região** como degradê, não os
   níveis.
2. **Degradê da estrada lido como dois cinzas chapados** — e aí a fronteira entre
   eles vira uma T-T fantasma de 15 m, a mais cara que o motor poderia inventar.
3. **Borda da estrada contra o branco tem contraste baixíssimo** no trecho
   superior (prata claro × branco). Segmentação por gradiente "vaza" e perde a
   borda; o resultado é uma estrada 20% menor e um espovo curto.
4. **Vermelho dos traços × vermelho do degradê:** se o motor os separar, inventa
   T4 e uma sessão. Se os fundir sem checar, pode errar no caso oposto. Precisa
   comparar amostras de cor, não posições.
5. **Dois cinzas** (prata da estrada × médio do `LOG`/tagline) muito próximos:
   fundi-los cria uma dependência de sequência falsa (o `LOG` precisa vir antes
   do `SGT`; a estrada precisa vir depois do amarelo).
6. **Filete branco entre laranja e estrada:** `analysis_F` especula que ele
   existe. **Na imagem eu não o vejo** — laranja e prata parecem encostar
   diretamente. Se existir no vetor, T1 vira 2×T-F e laranja+estrada podem ir na
   mesma sessão. **Vale checar** — mas não presumir.
7. **A linha amarela tem 6 cm de largura em 7,6 m de comprimento**: razão
   perímetro/área ≈ 34 m⁻¹. Um limiar de `cortavel_a_mao` baseado em
   perímetro/área a rejeitaria; na prática é o elemento mais fácil da arte
   (2 retas paralelas curvas seguindo carvão). **Contraexemplo importante para
   calibrar o limiar: perímetro/área alto ≠ não-cortável quando a curvatura é
   suave e monótona.**
8. **`SISTEMA DE GESTÃO EM TRANSPORTE` está sobre branco**, não dentro de uma
   barra — não procurar por texto reservado ali.

### 10) Correções à análise antiga — `analysis_F.md` §6 (SGT.png)

**A. Erros de observação (o que a análise antiga descreve e não está na arte):**

1. **`analysis_F`: "barra cinza-escura 'SISTEMA DE GESTÃO EM TRANSPORTE' com
   texto branco reservado"** e, na tabela de fronteiras, *"Barra escura × branco
   | T-F | reta | fita de corte"*. **NÃO EXISTE BARRA.** Na arte, a tagline é
   **texto cinza diretamente sobre a chapa branca**. Consequências: some um
   elemento chapado de ~0,4 m², some uma máscara de texto reservado em registro,
   e some uma linha inteira da tabela de fronteiras. `analysis_F` cobra por um
   elemento inexistente.
2. **`analysis_F`: "degradê laranja→amarelo (base escura, topo claro)"**. O
   degradê real é **laranja (topo) → vermelho (base)**. Não há amarelo nas
   letras. O amarelo da arte é só a linha da pista. Isso importa: uma tinta a
   menos no pedido, e o par de tintas do leque muda.
3. **`analysis_F`: "sombra sutil cinza sob as letras"** e a recomendação de
   *"véu leve de aerógrafo antes de remover a máscara externa"*. **Não vejo
   sombra** sob as letras na arte. Se não existe, é meia hora de aerógrafo
   cobrada a mais e um risco desnecessário de sujar o branco.
4. **`analysis_F`: "fio/filete branco separando laranja e cinza"** — apresentado
   como fato no inventário (§6.3) e depois como condicional na tabela. Na imagem
   as duas cores **parecem encostar**. Tratar como **incerteza a verificar**, não
   como característica.

**B. Erros de doutrina:**

5. **`analysis_F` prescreve FITA AMARELA para o bloco laranja, para a borda da
   estrada e para a linha amarela** — três vezes, e chama a linha amarela de
   *"literalmente o caso da fita amarela flexível"*. **ERRADO por §4:** fita
   amarela só se aplica a **isoplastic ou lona**. Esta é uma carreta de carga
   geral em **chapa**; em chapa a opção de fita é a **branca**, que **não faz
   curva**. As três curvas exigem **espovo direto** ou corte manual. Este é o
   erro de maior impacto de custo da análise antiga nesta arte: ela orça o
   caminho mais barato que existe (fita flexível, zero corte) para um substrato
   onde ele é indisponível.
6. **`analysis_F` ordena por luminosidade ("claro→escuro", padrão nº 6)**, não
   por cobertura. Em T2 (amarelo × estrada) as duas regras coincidem por acaso;
   em T1 (laranja × estrada) a regra antiga é ambígua (laranja e prata têm
   luminosidades parecidas) e a doutrina é inequívoca (laranja cobre 4,1 m²,
   estrada 8,5 m² → laranja primeiro).
7. **`analysis_F` diz, sobre os riscos vermelhos: "T-T sobre o degradê curado →
   cura ~3h + adesivo das faixas retas … adesivo plotado registrado é mais
   seguro"**. Duplo erro: (a) presume que os traços são uma **tinta diferente**
   sem verificar — provavelmente são o mesmo vermelho e saem da mesma máscara,
   custo zero; (b) mesmo se fossem, **corte manual in situ é o preferido (§3.1)**
   sobre traços retos de ~14 cm × 90 cm, e plotter é a exceção (§3.2), não "o
   mais seguro".
8. **`analysis_F` usa "adesivo plotado" como default para a silhueta das letras
   `SGT`.** As letras têm 93 cm de altura e hastes de 18 cm — **o corte manual é
   trivial**. §3.1 é explícito que o corte manual é preferido *porque evita
   imprimir/recortar uma máscara nova e esperar o verniz secar*. Plotar aqui é
   pagar máquina para cortar um `S` de quase um metro.
9. **`analysis_F` estima "~3 dias por lado" e acerta o número pelo caminho
   errado.** O cronograma dela tem 5 momentos de pintura (laranja+barra, estrada,
   amarelo, degradê, vermelhos). O correto são **2 sessões**, porque amarelo +
   cinza médio + laranja não se tocam e estrada + `SGT` não se tocam. Os dias
   extras dela vêm de esperas de cura que o §6.4 elimina; os dias que faltam na
   minha conta vêm do espovo, que ela não previu. **Coincidência de total,
   divergência total de composição** — o que significa que o modelo antigo não
   escala para outras artes.
10. **`analysis_F` menciona "impressão digital" como alternativa em outras artes
    do mesmo lote (COMFRO, mar e rio) e institucionaliza a regra no padrão
    transversal nº 4.** Nesta arte não chega a aplicá-la, mas a regra permanece
    ativa no motor. **Deve ser extirpada:** adesivo nunca é produto final.

---

# 9. Bismark Frigorífico — lateral

*(1600×600 px; proporção 2,67:1)*
**Implemento de referência assumido:** baú de truck **6,50 m × 2,44 m**.
**Fator de escala:** 1 px ≈ 4,06 mm.

### 1) Implemento e substrato provável
2,67:1 → **lateral de baú de truck**. Cliente: **frigorífico** (`BISMARK
FRIGORÍFICO — Excelência em Carnes`). Carga refrigerada → **ISOPLASTIC** com
alta confiança.

**Consequências (§4):**
- **Fita amarela liberada.** E aqui ela é **muito bem aproveitada**: a grande
  faixa dourada curva do lado direito é um arco de raio 2,5–4 m, largura
  constante de ~20 cm, ~4 m de comprimento. **Duas fitas amarelas paralelas
  resolvem sem um único corte.** Compare com a arte 8 (mesma geometria, substrato
  de chapa, custo completamente diferente) — **é o par de comparação mais
  didático do slice.**
- **Lixamento** obrigatório nas janelas.
- Cuidado com estilete sobre gel coat.

### 2) Fundo
**Chapa branca original, sem pintura geral.** Branco ≈ 62%.

Áreas pintadas: campo navy do canto inferior direito (~24%), faixa dourada
(~4%), brasão (~9%), script `Excelência em Carnes` (~0,5%).

O branco é toda a metade esquerda-superior, atrás e ao redor do brasão. **Nenhum
branco desta arte é tinta** — **exceto**, potencialmente, os **realces
especulares** dentro do brasão (o brilho branco atravessando as letras cromadas e
os pontos de luz do bisel dourado). Esses realces estão **cercados por navy e
dourado**, então só podem ser: (a) chapa reservada através de **duas** demãos
(exige mascarar minúsculas formas de brilho desde o início e nunca mais
removê-las), ou (b) **tinta branca/aerografia por cima**. Na prática, (b). **É a
única situação do slice onde tinta branca provavelmente é usada** — e é uma
consequência direta do bloco metálico, não uma exceção à regra.

### 3) Inventário de elementos
1. **Brasão hexagonal** (~2,7 m × 1,9 m), composto de:
   - **moldura externa dourada ornamentada**, com perfil em **bisel metálico**:
     4 a 6 tons de dourado (amarelo claro, ouro, ocre, marrom escuro) mais
     realces quase-brancos, seguindo um hexágono com **entalhes em cruz** nas
     laterais;
   - **interior azul-marinho com degradê radial** (azul médio no centro, quase
     preto nas bordas);
   - **silhueta de touro dourada** (~45 × 28 cm) no topo, com patas, chifres e
     cauda;
   - **banda retangular** horizontal, contornada de dourado, com fundo navy quase
     preto, contendo **`BISMARK`** (~45 cm de caixa-alta) em **gradiente cromado**
     (dourado no topo, faixa de brilho branco no meio, dourado na base);
   - **`FRIGORÍFICO`** (~14 cm) em letras douradas com gradiente, abaixo da banda.
2. **`Excelência em Carnes`** — script cursivo azul-petróleo/navy, ~22 cm de
   altura de corpo, abaixo do brasão, sobre chapa branca.
3. **Faixa dourada curva** — arco de ~20 cm de largura e ~4 m de comprimento,
   entrando pela borda direita no alto e descendo até a base do centro-direita.
   Também com leve gradiente metálico.
4. **Campo navy** — preenche todo o canto inferior direito, abaixo da faixa
   dourada.
5. **Filete navy superior** — uma faixa fina de navy **acima** da faixa dourada,
   no canto superior direito (a faixa dourada corre **entre dois navies**).

### 4) Paleta
| Cor | Chapada / degradê |
|---|---|
| Navy escuro (campo, filete superior, interior do brasão) | **chapada no campo**; **DEGRADÊ RADIAL** no interior do brasão |
| Dourado (faixa, moldura, touro, letras) | **DEGRADÊ METÁLICO multi-tom** — 4 a 6 valores + realces |
| Azul-petróleo (script) | chapada |
| Branco | chapa reservada no fundo; **provavelmente tinta** nos realces especulares do brasão |

**Este é o bloco mais complexo do slice.**

### 5) Fronteiras T-T
| # | Par | Extensão | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | **Dourado (faixa) × Navy (campo inferior)** | ~406 cm | **suave** (raio 2,5–4 m) | **Navy** (~3,6 m² contra ~0,9 m² de dourado total) |
| T2 | **Dourado (faixa) × Navy (filete superior)** | ~365 cm | **suave** (raio 2,5–4 m) | **Navy** |
| T3 | **Dourado (moldura do brasão) × Navy (interior do brasão)** | **~893 cm** (perímetro interno da moldura, com os entalhes em cruz) | **média a fechada** (raio 3–8 cm nos ornamentos e cantos do hexágono; até ~1,5 cm nos entalhes) | **Navy** |
| T4 | **Dourado (touro) × Navy (interior)** | ~114 cm | **fechada** (raio 1–3 cm em patas, chifres e cauda) | **Navy** |
| T5 | **Dourado/cromado (`BISMARK`) × Navy (fundo da banda)** | ~568 cm | **média** (letterforms bold sans, raio 2–5 cm) | **Navy** |
| T6 | **Dourado (`FRIGORÍFICO`) × Navy (interior)** | ~244 cm | **média** (raio 1–3 cm) | **Navy** |

**Total: ~2590 cm de fronteira T-T**, e **todas as seis são o mesmo par de
cores: dourado × navy.** Este é o extremo oposto da arte 1: lá, 7 fronteiras
entre 6 cores diferentes; aqui, 6 fronteiras entre **2** cores.

**Pares que NÃO se tocam:**
- **Azul-petróleo (script) × Dourado** — o script está sobre chapa branca, abaixo
  do brasão, a ~15 cm da moldura. **Verificar folga no vetor.**
- **Azul-petróleo (script) × Navy** — separados por chapa branca.
- **Faixa dourada × Brasão** — separados por ~1,5 m de chapa branca.
- **Realces brancos × chapa branca do fundo** — mesmo valor, mas **não são a
  mesma coisa** (um é reserva, outro é provavelmente tinta). Sem contato.

**Nota estrutural:** o fato de haver apenas **um par de cores** significa que a
arte tem **profundidade de grafo 2** — dourado, depois navy. Se o brasão fosse
chapado, esta seria uma arte de **2 sessões** e ~3 dias. **Toda a complexidade
vem do degradê, não da topologia.**

### 6) Ordem de pintura (§2)
Cobertura estimada:

| Cor | Área |
|---|---|
| Azul-petróleo (script) | ~0,04 m² |
| Dourado (faixa + moldura + touro + letras) | ~0,9 m² |
| Navy (campo + filete + interior do brasão) | ~3,6 m² |

Todas as seis fronteiras são dourado × navy, e o navy cobre **4× mais**:

**DOURADO PRIMEIRO → mascarar todo o dourado → NAVY por cima.**

Justificativa reforçada além da área: o navy do interior do brasão é um **degradê
radial**, e o navy do campo é chapado. Pintando o dourado antes e mascarando-o,
o degradê radial pode ser aplicado numa **passada contínua** dentro da janela do
brasão, sem emenda — o mesmo argumento decisivo da esfera na arte 5. Se
invertesse, cada retoque dourado exigiria recompor o degradê navy ao redor.

O **azul-petróleo do script** não toca nada → **sessão livre**, pode entrar junto
com o navy (§6.4) se o tom for próximo, ou em qualquer momento.

**Os realces especulares (branco/cromado)** entram **por último**, sobre o
dourado e o navy já curados — é a camada de acabamento do efeito metálico.

### 7) Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| **Faixa dourada curva** | **FITA_AMARELA** | Substrato isoplastic (§4). Arco de raio 2,5–4 m, largura constante de 20 cm, ~4 m de extensão: **duas fitas amarelas paralelas**, zero corte. **~8 m de corte manual evitados.** O leve gradiente metálico da faixa sai com um leque de dois dourados dentro das fitas. |
| **Campo navy + filete superior** | **FITA_AMARELA** (as mesmas fitas, reposicionadas) + empapelamento | Depois de curado o dourado, as fitas delimitam de novo as mesmas curvas para o navy. Nada de vinil. |
| **`Excelência em Carnes`** | **CORTE_MANUAL** | Script cursivo de ~22 cm de corpo; as finas do script têm ~1,2–1,8 cm no implemento, com laços em `E`, `l`, `C`. **Cortável à mão com lâmina nova** — comparável ao slogan da arte 7. |
| **Silhueta externa do brasão** | **CORTE_MANUAL** | Hexágono com entalhes, ~2,7 m de largura. Retas longas e cantos definidos: fácil. |
| **Moldura dourada ornamentada (bisel)** | ⚠️ **PENDÊNCIA** | A geometria da moldura é cortável (é uma faixa hexagonal de ~15 cm de largura). **O que não é resolvível por máscara é o bisel:** 4 a 6 tons de dourado em bandas que acompanham o relevo, mais realces especulares localizados. Isso não é "uma cor com máscara" — é **modelagem de volume**. |
| **Interior navy com degradê radial** | **pistola em leque / aerógrafo** dentro da janela | Degradê radial contido por máscara: rotineiro, como a esfera da arte 5. **Não é pendência.** |
| **Touro dourado** | **CORTE_MANUAL** (silhueta) + **aerografia** (modelagem) | ~45 × 28 cm com patas de ~3 cm de largura e chifres de ~1,5 cm — está no **limite** do estilete. A silhueta pode sair à mão; se o dono preferir segurança, entra no mesmo arquivo de corte de máquina do resto do brasão. |
| **`BISMARK` cromado** | ⚠️ **PENDÊNCIA** | Caixa-alta de 45 cm: a **silhueta** é trivial de cortar. O **preenchimento cromado** (dourado → faixa branca de brilho → dourado, com transição dura no meio da altura) é um **degradê horizontal com aresta**, aplicável com aerógrafo e máscara auxiliar. **Provável tinta branca aqui.** |
| **`FRIGORÍFICO`** | **CORTE_MANUAL** + leque dourado | ~14 cm de caixa-alta, bold, hastes de ~2,5 cm. Cortável. O gradiente é suave. |
| **Realces especulares** (moldura + letras) | ⚠️ **PENDÊNCIA — parte do mesmo bloco** | — |

> ### ⚠️ PENDÊNCIA para o dono — brasão Bismark
>
> O brasão inteiro (moldura biselada + touro + letras cromadas + degradê radial)
> é um **bloco metálico com modelagem de volume**. Ele **não pode ser adesivo
> impresso** — adesivo é máscara, nunca produto final. E **não cabe em máscara**:
> o bisel tem 4 a 6 bandas de dourado seguindo o relevo, mais realces localizados
> — seriam 6+ ciclos de máscara em registro num elemento de 5 m², com curas
> intermediárias, o que é economicamente absurdo.
>
> **Restam duas rotas, e a diferença entre elas é de horas para dias:**
> 1. **Aerografia** — silhueta e moldura mascaradas, volume modelado a aerógrafo
>    sobre o dourado base. É a rota natural para metal: o aerógrafo faz bisel e
>    especular sem esforço.
> 2. **Pintura artística à mão** — pincel fino sobre o dourado curado, para os
>    filetes de bisel e os brilhos. Mais lenta, mais "joalheria".
>
> **Terceira opção comercial a considerar:** negociar com o cliente uma
> **versão simplificada do brasão em 2 douradinhos chapados** (um ouro, um ocre
> para o lado sombreado) sem especular. Isso o traria de volta para
> `CORTE_MANUAL` puro e **cortaria ~1,5 dia por lado**. Em implemento, a 3 m de
> distância, a perda visual é pequena — é a conversa que vale ter antes de orçar.
>
> **Confirmar com o dono antes de fechar preço.** É a diferença entre ~3 dias e
> ~5 dias por lado.

### 8) Sequência de sessões e dias
- **Dia 1 — Preparação:** lavar, empapelar perfis/ferragens/borrachas, lixar
  (isoplastic) as janelas. Aplicar as **fitas amarelas** da faixa curva; cortar à
  mão a silhueta do brasão, a moldura, o touro, `BISMARK`, `FRIGORÍFICO` e o
  script.
- **Dia 2 manhã — S1: DOURADO BASE.** Faixa curva (com leque) + moldura + touro
  + letras. Uma demão do dourado principal em tudo.
- **Dia 2 tarde — Mascarar todo o dourado.** Reposicionar as fitas amarelas para
  o navy. Abrir a janela do interior do brasão.
- **Dia 3 manhã — S2: NAVY.** Campo inferior direito + filete superior (chapados)
  + interior do brasão (**degradê radial a leque**) + fundo da banda do
  `BISMARK`. **`Excelência em Carnes`** entra nesta sessão (não toca nada, §6.4).
- **Dia 3 tarde — Cura.**
- **Dia 4 — ⚠️ S3: MODELAGEM DO BRASÃO (PENDÊNCIA).** Bisel dourado, sombras,
  realces especulares, cromado do `BISMARK`, volume do touro. **6–10 h por lado
  se aerografia; até 1,5 dia se pintura artística à mão; ~1 h se a versão
  simplificada for aprovada.**
- **Dia 5 manhã — Remoção**, retoques.
- **Dia 5 tarde — Verniz geral.** Essencial: unifica o brilho entre laca chapada
  e aerografia, e é o que dá ao "dourado" o aspecto metálico final. **Considerar
  verniz de alto brilho** — num brasão metálico, o verniz é parte do efeito, não
  só proteção.
- Faixa refletiva por cima do verniz curado.

**Total: 4,5 a 6 dias por lado** conforme a pendência.
**A aerografia não duplica de graça:** cada lado exige a modelagem refeita à mão.
Orçar **2× o tempo de S3**, **1× o de corte** (a máscara se reposiciona).

### 9) Armadilhas para o motor de visão
1. **O dourado biselado vira 6+ "cores chapadas".** Uma quantização honesta
   devolve amarelo-claro, ouro, ocre, marrom e branco como regiões distintas,
   todas adjacentes, gerando **dezenas de fronteiras T-T fechadas** dentro da
   moldura. O motor precisa reconhecer **"faixas de tom paralelas ao contorno de
   um elemento" como assinatura de bisel metálico** e colapsar em uma região
   `METALICO`.
2. **Os realces especulares brancos são brancos que NÃO são chapa.** Isso viola a
   regra global "branco = reserva". O discriminante é **topológico**: branco
   **cercado por tinta em todo o perímetro, dentro de um bloco metálico** é
   realce, não reserva. Sem essa exceção, o motor conclui que existem ilhas de
   chapa reservada dentro do brasão e projeta máscaras que teriam de sobreviver a
   duas demãos.
3. **O degradê radial do interior do brasão** vira 5–8 anéis navy chapados,
   inventando fronteiras T-T concêntricas. Mesma armadilha da esfera (arte 5).
4. **O navy do campo e o navy do interior do brasão são a mesma tinta em regiões
   desconexas.** Um grafo por cor os funde e conclui que o brasão toca a faixa
   dourada (não toca — há 1,5 m de branco entre eles).
5. **A faixa dourada corre entre dois navies.** Um segmentador que só pegue a
   região grande perde o **filete navy superior** e transforma T2 numa fronteira
   dourado × branco (T-F, custo zero). Erro de ~3,6 m de fronteira.
6. **A silhueta do touro tem patas de ~3 cm e chifres de ~1,5 cm** — é o valor
   que decide se ele vai a estilete ou a máquina. Boa amostra para calibrar
   `detalhe_minimo_mm`.
7. **Contagem de fronteiras engana:** 6 T-T parece pouco, e a arte é a mais cara
   do slice. **O custo aqui não está na topologia, está na tecnologia.** Um motor
   que orce por `nº de T-T × comprimento` subestima esta arte em ordens de
   grandeza. Precisa de um multiplicador por `região tecnológica = METALICO`.
8. **JPEG sobre o dourado** cria bandas de compressão que imitam bandas de bisel
   — impossível distinguir por gradiente local; usar o vetor.

### 10) Correções à análise antiga
`analysis_F.md` não analisa Bismark, mas a doutrina cita explicitamente o análogo
(*"banner dourado com dobras"*) na sua nota de pendência do §0, e os padrões
transversais de `analysis_F` se aplicariam assim:

1. **Padrão transversal nº 4:** *"asset delimitado com texto abaixo da altura
   mínima pintável → **impressão digital**"* e *"região com gradiente contínuo ou
   textura fotográfica → aerografia **ou impressão digital**"*. Aplicado ao
   brasão Bismark — um asset delimitado, com gradiente contínuo, textura metálica
   e identidade de marca — a regra antiga classificaria o brasão inteiro como
   **impressão digital laminada**. **ERRADO, e é o erro mais caro possível nesta
   arte:** elimina a etapa que define o preço (a modelagem metálica) e substitui
   por um vinil que a doutrina proíbe como produto final. **O brasão é pintado.**
2. **A doutrina §0 lista literalmente o "banner dourado com dobras" como
   PENDÊNCIA a confirmar com o dono** — não como decisão do analista. Toda vez
   que uma análise resolve um bloco metálico/fotográfico sozinha, ela está
   fabricando um número. Aqui a resposta correta é **abrir a pendência**, com as
   duas rotas e a terceira opção comercial quantificadas.
3. **`analysis_F` padrão nº 2 mapeia "suave/longa → fita amarela flexível" sem
   checar substrato.** Aqui a fita amarela é de fato a resposta certa — **mas por
   sorte**, porque o substrato é isoplastic. O mesmo raciocínio erra na arte 8.
   Comparar as artes 8 e 9 é o melhor argumento a favor de tornar o substrato uma
   entrada obrigatória do motor: **mesma geometria de faixa curva, custos
   opostos.**
4. **`analysis_F` padrão nº 1: "Branco quase nunca é tinta … cor ≈ branco →
   classificar como reserva/T-F, nunca como camada de tinta".** Correto em 8 das
   9 artes deste slice, e **errado aqui**: os realces especulares do brasão são
   tinta. A regra precisa da exceção topológica (branco cercado por tinta dentro
   de bloco metálico).
5. **`analysis_F` padrão nº 6 ("claro→escuro")** mandaria pintar o **dourado
   antes do navy** — mesma conclusão da doutrina, mas de novo **pelo critério
   errado**. Se o cliente trocasse o dourado por um bronze escuro, a regra antiga
   inverteria a ordem e mandaria mascarar 3,6 m² de navy em vez de 0,9 m² de
   metal.
6. **`analysis_F` padrão nº 7:** *"aerografia não duplica de graça … dedupe vale
   para corte/máscara, não para horas de aerógrafo"*. **Isto está CORRETO** e
   vale reter — é um dos poucos pontos da análise antiga que sobrevive intacto à
   doutrina. Aqui ele dobra o item mais caro do orçamento.

---

# Notas transversais do slice 8

1. **Substrato decide preço mais do que desenho.** Artes 8 e 9 têm a mesma
   geometria de faixa curva larga. Na 9 (isoplastic) sai com duas fitas amarelas
   e zero corte; na 8 (chapa) exige espovo e corte. **O substrato deve ser entrada
   obrigatória, coletada no orçamento, não inferida do desenho.**
2. **Topologia do grafo > contagem de fronteiras.** Arte 2 e arte 7 têm 4 T-T
   cada; a 2 precisa de 4 sessões (cadeia linear) e a 7 de 2 (estrela em torno de
   um vértice). O motor precisa emitir a **profundidade da cadeia de
   precedência**, não só `count(T_T)`.
3. **Cortabilidade e T-T são eixos independentes.** O QR da arte 4 tem **0
   fronteiras T-T** e é o elemento que obriga máquina de corte. O brasão da arte
   9 tem **6 fronteiras** e é o mais caro do slice. Nenhum dos dois é previsível
   pela tabela de fronteiras.
4. **Máscara de máquina nem sempre exige o ciclo de verniz.** O §3.2 descreve o
   caminho caro (pintar → envernizar → mascarar → pintar) porque assume que o
   micro-elemento assenta **sobre outra tinta**. Quando ele assenta sobre a
   **chapa original** (bloco de endereço da arte 5, e-mail das artes 1 e 2, QR da
   arte 4), a máscara cola direto no substrato e **o ciclo de verniz é
   dispensável**. Esta ramificação vale meio dia por elemento e deveria entrar na
   árvore do §3.
5. **`§6.2` prevalece sobre `§2` para a demão de fundo.** Numa arte com pintura
   geral (3, 4, 6), a regra "menor cobertura primeiro" mandaria pintar todo o
   texto antes do fundo — absurdo. O §6 já sequencia a pintura geral como etapa
   2; §2 governa apenas pares de elementos. Convém tornar isso explícito na
   doutrina.
6. **Branco tem uma exceção, e só uma.** Em 8 das 9 artes, todo branco é chapa
   reservada. A exceção é o **realce especular dentro de bloco metálico** (arte
   9). Discriminante: branco cercado por tinta em todo o perímetro, dentro de
   região classificada como metálica/fotográfica.
7. **Dois brancos diferentes na mesma arte revelam pintura geral** (arte 6). É o
   teste mais barato para distinguir "off-white de mockup" de "cinza pintado", e
   nenhuma análise anterior o usa.
8. **Curvatura é o critério errado para elementos ortogonais.** O QR (arte 4) é
   feito só de retas e é incortável; a linha amarela da SGT (arte 8) tem
   perímetro/área altíssimo e é fácil. `cortavel_a_mao` precisa de pelo menos
   três entradas: **detalhe mínimo em mm, número de ilhas e monotonicidade da
   curva** — não só raio mínimo.
9. **Marcas de terceiros são um regime próprio.** Os selos BRF/Sadia/Perdigão/
   Kidelli (arte 6) e o QR (arte 4) têm **requisitos funcionais ou contratuais**
   (leitura óptica, fidelidade de Pantone) que sobrepõem qualquer heurística
   geométrica. Sinalizar `funcional: true` e forçar máquina.
10. **Nenhuma das 9 artes usa adesivo como produto final. Nenhuma é impressa.**
    Duas têm pendência aberta (artes 6 e 9), e nas duas a decisão é entre
    **aerografia e pintura artística à mão** — nunca impressão.
