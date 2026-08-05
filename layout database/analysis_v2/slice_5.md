# Slice 5 — reanálise sob a doutrina corrigida (ago/2026)

Artes: **A&P FOODS** (lateral + traseira), **BOI MIX-1470** (lateral + traseira),
**CLEBIN** (lateral + traseira), **BOIPORÉ** (lateral), **CASA DO QUEIJO**.

Referência normativa: `api/PAINTING_PRODUCTION_DOCTRINE.md`. Onde esta análise
conflita com `layout database/analysis/analysis_A|D|E|F.md`, **esta prevalece**.

Três premissas aplicadas em todas as 8 artes, e que sozinhas mudam quase tudo:

1. **Branco não é cor.** Todo branco é chapa preservada por máscara. Logo, toda
   fronteira `branco × qualquer coisa` é **T-F** e não entra na contagem de T-T.
2. **Adesivo não é produto final.** Não existe "vinil final", "selo impresso",
   "ícone impresso". Vinil/adesivo aparece só como máscara.
3. **Ordem = menor cobertura primeiro** (§2). Isso inverte a ordem proposta na
   maioria das análises antigas.

Escala: cada arte foi medida em pixels e convertida assumindo altura de painel
**2,46–2,60 m**; o fator cm/px está declarado em cada análise. Todos os
comprimentos de fronteira são estimativas ±25 % — servem para ranquear, não
para orçar sem conferência no vetor.

---

## Tabela-resumo

| Arte | Substrato | Fundo | Fronteiras T-T (loci / pares de cor / comprimento) | Estratégia dominante | Complexidade |
|---|---|---|---|---|---|
| A&P FOODS lateral | ISOPLASTIC | **pintura geral roxa ~85 %** | 5 loci / 1 par (amarelo×roxo) / **~31 m** | CORTE_MANUAL sobre roxo curado + FITA_AMARELA na faixa | média-alta |
| A&P FOODS traseira | ISOPLASTIC | **pintura geral roxa ~93 %** | 5 loci / 1 par (amarelo×roxo) / **~22 m** | CORTE_MANUAL sobre roxo curado | média |
| BOI MIX-1470 lateral | ISOPLASTIC | chapa branca ~72 %, sem pintura geral | 2 loci / 1 par (carmim×vinho) / **~4,6 m** | CORTE_MANUAL (+ aerógrafo dentro da máscara) | média |
| BOI MIX-1470 traseira | ISOPLASTIC | chapa branca ~88 % | 1 locus / 1 par (carmim×vinho) / **~2,0 m** | CORTE_MANUAL + 1 exceção §3.2 (selo SIF) | média |
| CLEBIN lateral | ISOPLASTIC | chapa branca ~76 % | 3 loci / 3 pares / **~3,8 m** | CORTE_MANUAL + máscara-máquina só nos 4 pictogramas | média |
| CLEBIN traseira | ISOPLASTIC | chapa branca ~90 % | 2 loci / 2 pares / **~0,2 m** | CORTE_MANUAL puro | **baixa** |
| BOIPORÉ lateral | ISOPLASTIC | chapa branca ~74 % + painel cinza pintado ~24 % | 1 locus / 1 par (vermelho×cinza) / **~3,5 m** | CORTE_MANUAL + FITA_AMARELA na divisa | **baixa** |
| CASA DO QUEIJO | ISOPLASTIC | chapa branca ~55 % (sem pintura geral) | 5 loci / 2 pares / **~37 m** | CORTE_MANUAL denso + 2× FITA_AMARELA | **alta** |

**Total do slice: 24 loci T-T, 8 pares de cor distintos, ~104 m de fronteira T-T.**

Padrão do slice: **os 5 clientes são todos de cadeia fria** (açaí/sorvete,
frigorífico, distribuidora de frios, frigorífico, laticínio/perecíveis) →
**todos ISOPLASTIC** → **fita amarela liberada em 100 % das artes** (§4). Nenhuma
arte deste slice precisa de fita branca, e portanto nenhuma faixa deste slice
gera corte por causa de fita.

---

# 1. A&P FOODS — lateral

Arquivo: `A&P FOODS lateral.png` · 1600×472 px (3,39:1) · escala adotada
**0,55 cm/px** (painel ~8,8 m × 2,60 m ≈ 22,9 m²).

### 1. Implemento e substrato provável
Lateral de baú de **distribuidora de açaí, sorvete e complementos** — carga
congelada. Proporção 3,39:1 num painel de ~2,6 m de altura dá **~8,8 m de
comprimento**: truck/toco longo ou carreta curta. Superfície do mockup é lisa e
contínua, **sem frisos e sem costelas** ao longo dos 8,8 m — assinatura de baú
**ISOPLASTIC** (sanduíche liso), não de carga seca com chapa rebitada.

**Substrato: ISOPLASTIC.** Consequência direta (§4): **fita amarela liberada**,
o que resolve a única curva longa da arte sem uma única faca. Consequência
secundária: toda janela aberta na máscara precisa de **lixamento** antes da
tinta, porque isoplastic de fábrica é liso demais para ancoragem.

### 2. Fundo
**Pintura geral roxa/índigo, ~85 % da área.** Não é chapa. O roxo cobre da
borda direita até a curva S da esquerda e é o campo sobre o qual tudo o mais
acontece.

**Branco = chapa preservada, nunca tinta.** São chapa: o lettering "A&P", o
símbolo ®, os dois contatos do canto superior direito, e as palavras "DE",
"QUALIDADE PARA", "O SEU" do bloco de slogan. Todas essas regiões precisam ser
**mascaradas na chapa nua antes do roxo** — elas são o motivo de a preparação
vir antes da pintura geral, não depois.

Área de chapa preservada ≈ 1,1 m² (~5 %). Faixa amarela ≈ 2,1 m² (~9 %).

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Faixa orgânica na borda esquerda, em S, sangrando nas bordas superior/inferior | — | amarelo |
| E2 | Lettering itálico pesado | `A&P` | branco (chapa) |
| E3 | Lettering script/geométrico encostado no E2 | `foods` | amarelo |
| E4 | Símbolo de marca registrada, anel fino + R | `®` | branco (chapa) |
| E5 | Linha descritiva sob o logo | `DISTRIBUIDORA DE AÇAÍ, SORVETE E COMPLEMENTOS.` | amarelo |
| E6 | Ícone de telefone (fone inclinado) | — | amarelo |
| E7 | Telefone | `(63) 99112-2940` | branco (chapa) |
| E8 | Ícone globo com meridianos + seta de cursor | — | amarelo |
| E9 | Site | `apfoods.com.br` | branco (chapa) |
| E10 | Slogan em 3 linhas, palavras alternadas | `PRODUTROS DE / QUALIDADE PARA / O SEU NEGÓCIO.` | `PRODUTROS` e `NEGÓCIO.` amarelo; resto branco (chapa) |

⚠️ **Erro de texto no arquivo do cliente: `PRODUTROS` (deveria ser `PRODUTOS`).**
Isso tem que voltar ao comercial antes de qualquer corte — depois de pintado é
retrabalho de máscara + repintura de fundo.

### 4. Paleta
- **Roxo/índigo** — chapado, sem degradê. Cobertura ~19,3 m².
- **Amarelo-ouro** — chapado, sem degradê. Cobertura ~2,6 m² (faixa 2,1 + tipografia 0,5).
- **Branco** — não é tinta. Chapa.

**Duas tintas. Zero degradê. Zero bloco fotográfico.** Do ponto de vista de
tinta esta é a arte mais simples do slice; o custo dela está inteiramente em
comprimento de fronteira, não em número de cores.

### 5. Fronteiras T-T
Um único par não-branco existe: **amarelo × roxo**. Ele aparece em 5 loci:

| Locus | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | Aresta direita da faixa E1 (S completo, borda a borda) | **~290 cm** | **média** no gancho superior (raio ~15 cm), **suave** nos 2/3 inferiores (raio >1 m) | roxo |
| T2 | Contorno de `foods` (E3), 5 glifos com contra-formas fechadas em o/o/d | **~10 m** | **fechada** (raio interno dos "o" ~12 cm) | roxo |
| T3 | Contorno da linha `DISTRIBUIDORA DE AÇAÍ, SORVETE E COMPLEMENTOS.` (E5), 47 glifos de ~8,8 cm de altura | **~12 m** | **média/fechada** | roxo |
| T4 | Contorno de `PRODUTROS` + `NEGÓCIO.` (17 glifos de ~12 cm) | **~6 m** | média | roxo |
| T5 | Contorno dos ícones E6 (fone) e E8 (globo com meridianos + cursor) | **~50 cm** | **extrema** (traços de 0,5 cm no globo) | roxo |

**Não se tocam** (podem conviver na mesma sessão sem proteção):
- Amarelo e branco tocam-se em um só lugar — o `P` de `A&P` encosta no `f` de
  `foods` por ~30 cm — mas **isso é T-F, não T-T**, porque branco é chapa.
  É, ainda assim, o ponto de **registro mais crítico da arte**: o amarelo tem
  que morrer exatamente na aresta de chapa deixada pela máscara do `A&P`.
- As palavras amarelas e brancas do slogan E10 estão separadas por espaços de
  roxo — **não se tocam**.
- E1 (faixa) não toca nenhum elemento tipográfico.

### 6. Ordem de pintura
Aplicando §2 ao único par: amarelo cobre 2,6 m², roxo cobre 19,3 m² →
**amarelo primeiro, mascara, roxo por cima.**

Só que §6 põe a *pintura geral* antes de tudo, e §2 fala de pares. A leitura
correta, e que este slice deixa clara, é que **a regra §2 se aplica por
geometria do elemento, não por cor global**:

- **E1 (faixa)**: é um campo grande e contínuo colado na borda do painel. Aqui
  §2 vale ao pé da letra e paga muito: pinta amarelo → **fita amarela sobre o S**
  → roxo por cima. Zero corte nos 290 cm de curva, e o roxo cobre o amarelo sem
  risco de translucidez (roxo sobre amarelo cobre; amarelo sobre roxo não).
- **E3/E5/E10-amarelo (tipografia)**: aqui §2 é impraticável. Pintar 64 glifos
  amarelos primeiro exigiria uma máscara *positiva* sobre cada glifo, com
  registro perfeito, antes da geral — e a máscara positiva tem exatamente o
  mesmo comprimento de corte da janela negativa. Não se ganha nada e se perde o
  registro. Estes vão **depois do roxo curado**, cortados in situ (§3.1).

Ordem final de tintas: **amarelo (faixa) → roxo (geral) → amarelo (tipografia)**.

> **Calibração para o motor**: §2 deve ser condicionada à topologia. Proposta:
> se a cor menor é *adjacente ao fundo/borda* → §2 literal (pinta antes,
> mascara). Se a cor menor está *contida* na maior (letra dentro de campo) →
> inverte: maior primeiro, corta janela na maior curada. O critério mecânico é
> "a região menor toca a borda do painel ou a chapa nua?".

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa (§3: "um humano corta isso com estilete, no implemento?") |
|---|---|---|
| E1 faixa amarela | **FITA_AMARELA** | Isoplastic (§4) → fita flexível faz o gancho de raio 15 cm sem corte. É o caso barato canônico: 290 cm de curva por zero faca. |
| E2 `A&P` (branco) | **CORTE_MANUAL** (máscara positiva na chapa nua) | Glifos de ~90 cm de altura, contornos retos e bowls amplos. Trivialmente cortável. |
| E3 `foods` | **CORTE_MANUAL** sobre roxo curado | Glifos de ~50–80 cm; raio interno mínimo ~12 cm. Muito acima do limiar humano. |
| E4 `®` | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Anel de **0,55 cm de espessura** e 7,7 cm de diâmetro, com um `R` dentro. Um humano não corta um anel de 5 mm com estilete no implemento. **Alternativa a negociar: aumentar o ® para 12 cm** — aí vira CORTE_MANUAL e economiza um ciclo de verniz. |
| E5 tagline | **CORTE_MANUAL** sobre roxo curado | Caixa alta de 8,8 cm, sans geométrico, sem serifa: no limite, mas cortável. 47 glifos = ~2,5 h de faca. |
| E6 ícone fone | **CORTE_MANUAL** | Silhueta única e cheia, ~8 cm, sem ilhas. |
| E7/E9 contatos brancos | **CORTE_MANUAL** (máscara positiva na chapa) | Caixa de 8 cm, sans bold. |
| E8 ícone globo | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Círculo de 8 cm com 4 meridianos de 0,55 cm + seta de cursor. Dezenas de micro-detalhes → §3.2. **Ou** simplificar para globo sólido (recomendado). |
| E10 slogan | **CORTE_MANUAL** (branco na chapa; amarelo sobre roxo) | Caixa de 12 cm. Fácil. |

**Nenhum ESPOVO.** Não há elemento simultaneamente muito grande e muito fácil:
a faixa é grande mas a fita resolve melhor, e o resto é tipografia.

### 8. Sequência de sessões e dias
Assumindo 2 laterais + 1 traseira no mesmo ciclo de tintas.

| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar perfis, borrachas, ferragens, aparelho de frio da testeira | — |
| S1 | Aplicar máscaras positivas de **todo o branco** (E2, E4, E7, E9, brancos do E10) na chapa nua; lixar a janela da faixa; pintar **AMARELO** de E1 | cura |
| S2 | **Fita amarela** sobre o S de E1 + mascarar a faixa inteira; pintar **ROXO** em todo o restante do painel | cura |
| S3 | Remover máscaras brancas; aplicar máscara lisa sobre o roxo curado; **cortar à mão** E3, E5, E6, amarelos do E10; lixar janelas; pintar **AMARELO** | cura |
| S4 | **Verniz geral** | cura |
| S5 | *(só se E4 e E8 não forem simplificados)* máscara recortada a máquina do ® e do globo sobre o verniz curado; pintar; verniz local | — |

**3 dias** com E4/E8 simplificados; **4 dias** mantendo o ® fino e o globo com
meridianos. Ou seja: **um dia inteiro de cronograma depende de dois elementos
que somam 15 cm de arte.** Vale a conversa com o cliente.

### 9. Armadilhas para o motor de visão
- **Antialias amarelo/roxo gera um alaranjado** que clusteriza como terceira
  cor ao longo de 31 m de fronteira. Exigir erosão de 1–2 px antes de quantizar.
- O motor vai ler "roxo ≥80 % → pintura geral" corretamente, mas depois vai
  classificar `A&P` como *tinta branca* e transformar 8 m de T-F em T-T.
  Regra obrigatória: **cor == branco global ⇒ chapa ⇒ T-F**, sempre.
- O `P` branco e o `f` amarelo formam um único blob conectado na segmentação;
  são dois elementos de **processos diferentes** (um é máscara pré-geral, outro
  é corte pós-geral). Blob conectado ≠ mesmo elemento.
- O globo (E8) tem densidade de aresta altíssima em 8 cm — é exatamente o sinal
  que o motor deve usar para disparar `cortavel_a_mao = false`. Bom caso de
  calibração do limiar.
- A tipografia amarela representa ~28 m dos ~31 m de T-T. **Se o motor medir
  fronteira só por região "grande", subestima esta arte em ~90 %.**
- `PRODUTROS` — o OCR precisa marcar suspeita de erro tipográfico, não corrigir
  silenciosamente.

### 10. Correções à análise antiga (`analysis_A.md` §9)
| A análise antiga diz | Correção |
|---|---|
| "**3 cores chapadas**, zero degradê — arte 'amiga da laca'" | **2 tintas**. Branco não é cor: é chapa. A contagem de cores infla o orçamento e esconde que o custo real está em comprimento de fronteira. |
| "**letras×roxo = T-T** média/fechada (cura+adesivo); **sem T-F**" | Exatamente invertido no caso das letras brancas: `A&P`, `®`, contatos e 3 palavras do slogan são **T-F** (chapa preservada). Só a tipografia **amarela** é T-T. A frase "sem T-F" está errada — esta arte tem ~8 m de T-F. |
| "textos <8 mm → **vinil**" | **Proibido.** Adesivo não é produto final. Texto pequeno demais para faca vira **máscara recortada a máquina sobre verniz** (§3.2) — e pintado. |
| "'A&P' e textos por **recorte+laca pós-cura**" | Errado para o `A&P`: ele é **anterior** à pintura geral (máscara na chapa nua), não posterior. Inverte a ordem de duas sessões inteiras. |
| "D3 amarelo + branco (**não se tocam → mesma sessão**)" | Não existe "sessão de branco". Branco não é pintado. Esta linha some do cronograma. |
| "banda amarela em S = fita amarela flexível" | ✅ **Correto e mantido** — e agora justificado pelo substrato (isoplastic, §4), não por intuição. |
| O ® e o ícone globo não são mencionados | São os dois únicos elementos não-cortáveis à mão da arte e sozinhos decidem se o job leva 3 ou 4 dias. |

---

# 2. A&P FOODS — traseira

Arquivo: `A&P FOODS traseira.png` · 1600×1515 px (1,06:1) · escala **0,163 cm/px**
(painel ~2,60 m × 2,46 m ≈ 6,4 m²).

### 1. Implemento e substrato provável
Traseira do mesmo baú: **portas duplas**, quase quadrada. O mockup não desenha
dobradiças, varões, fechos, para-choque nem lanternas, mas eles existem — e a
**emenda vertical central em x ≈ 1,30 m** divide fisicamente a arte em duas
folhas que se movem independentemente.

**Substrato: ISOPLASTIC** (mesmo baú da lateral). Fita amarela liberada, mas
esta traseira não tem nenhuma curva que precise dela.

### 2. Fundo
**Pintura geral roxa, ~93 %.** Sem faixa amarela. Chapa preservada ≈ 5 %.
Metade inferior do painel (abaixo de y ≈ 1,90 m) é roxo liso, sem nenhum
elemento — reserva natural para faixa refletiva, placa e lanternas.

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Lettering, canto sup. esquerdo | `A&P` | branco (chapa) |
| E2 | Lettering, canto sup. direito | `foods` | amarelo |
| E3 | Marca registrada, acima do `s` | `®` | branco (chapa) |
| E4 | Descritivo, coluna esquerda | `DISTRIBUIDORA DE AÇAÍ,` | amarelo |
| E5 | Descritivo, coluna direita (continuação) | `SORVETE E COMPLEMENTOS.` | amarelo |
| E6 | Slogan, 3 linhas | `PRODUTROS DE / QUALIDADE PARA / O SEU NEGÓCIO.` | `PRODUTROS`/`NEGÓCIO.` amarelo, resto branco |
| E7 | Ícone fone + telefone | `(63) 99112-2940` | ícone amarelo, texto branco |
| E8 | Ícone globo + site | `apfoods.com.br` | ícone amarelo, texto branco |

Mesmo erro de texto: **`PRODUTROS`**.

### 4. Paleta
Roxo (~6,0 m²), amarelo (~0,35 m²), chapa branca (~0,3 m²). Tudo chapado.

### 5. Fronteiras T-T
Par único: **amarelo × roxo**, em 5 loci.

| Locus | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | Contorno de `foods` (E2) — glifos de ~45 cm | **~9 m** | fechada (contra-formas dos "o", raio ~7 cm) | roxo |
| T2 | Contorno de `DISTRIBUIDORA DE AÇAÍ,` (E4) | **~4 m** | média | roxo |
| T3 | Contorno de `SORVETE E COMPLEMENTOS.` (E5) | **~4,5 m** | média | roxo |
| T4 | Contorno de `PRODUTROS` + `NEGÓCIO.` (E6) | **~4 m** | média | roxo |
| T5 | Ícones fone + globo (E7/E8) | **~50 cm** | extrema (globo) | roxo |

**Não se tocam — e aqui a diferença em relação à lateral é relevante:**
- Na lateral o `P` branco encosta no `f` amarelo. **Na traseira, `A&P` e `foods`
  estão em cantos opostos, separados por ~23 cm de roxo. Não se tocam.**
  Cai o único ponto de registro crítico da lateral.
- Palavras amarelas e brancas do slogan: separadas por espaço de roxo.
- Ícones amarelos e textos brancos dos contatos: separados por ~4 cm de roxo.

### 6. Ordem de pintura
Único par amarelo×roxo, e **todo o amarelo desta traseira é tipografia contida
no campo roxo** — nenhum elemento amarelo toca a borda do painel ou a chapa nua.
Pela condição de topologia derivada na lateral, §2 se inverte aqui:
**roxo (geral) primeiro, amarelo depois, cortado in situ na laca roxa curada.**

Chapa branca continua sendo mascarada **antes** do roxo — isso não é ordem de
tinta, é preservação de substrato.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 `A&P` | **CORTE_MANUAL** (máscara positiva na chapa) | Glifos de ~55 cm. Fácil. |
| E2 `foods` | **CORTE_MANUAL** sobre roxo curado | Glifos de ~45 cm, raio mínimo ~7 cm. Confortável. |
| E3 `®` | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Anel de ~0,5 cm. Idem lateral: negociar aumento. |
| E4/E5 descritivos | **CORTE_MANUAL** sobre roxo curado | Caixa alta ~5–6 cm — **este é o elemento no limiar da arte**. Sans bold sem serifa ajuda; ainda assim é o candidato nº 1 a estourar o limiar `cortavel_a_mao`. Confirmar altura real no vetor antes de fechar. |
| E6 slogan | **CORTE_MANUAL** | Caixa ~9 cm. Fácil. |
| E7 fone + telefone | **CORTE_MANUAL** | Ícone sólido; texto ~7 cm. |
| E8 globo | **MASCARA_MAQUINA_SOBRE_VERNIZ** ou simplificar | Meridianos de ~0,4 cm num círculo de 6 cm. Não é cortável à mão. |
| E8 texto site | **CORTE_MANUAL** (máscara na chapa) | ~7 cm. |

### 8. Sequência de sessões e dias
Deve rodar **no mesmo ciclo de tintas das duas laterais** — mesmas duas tintas,
mesmas duas demãos.

| Sessão | Conteúdo |
|---|---|
| S0 | Lavagem; **empapelar dobradiças, varões, fechos e borrachas**; mascarar zona de placa/lanternas |
| S1 | Máscaras positivas de todo o branco (E1, E3, textos de E6/E7/E8) na chapa nua; pintar **ROXO** geral |
| S2 | *(cura)* Máscara lisa sobre o roxo; **cortar à mão** E2, E4, E5, amarelos de E6, ícone fone; lixar janelas; pintar **AMARELO** |
| S3 | **Verniz geral** |
| S4 | *(se mantidos)* máscara-máquina de ® e globo sobre verniz; pintar; verniz local |

**2 sessões de pistola.** Zero fita. Custo marginal ~0 se rodar junto das
laterais — a traseira não adiciona nenhum ciclo de cura novo. **1 dia
incremental.**

### 9. Armadilhas para o motor de visão
- Metade inferior é roxo liso e vazio: qualquer artefato de mockup (sombra,
  ruído JPEG, gradiente de compressão) vira "elemento" fantasma. Exigir área
  mínima antes de promover uma região a elemento.
- Mesma armadilha da lateral: branco lido como tinta transforma ~6 m de T-F em
  T-T e inventa uma sessão inexistente.
- O motor deve prever a **divisão vertical central**: a arte é toda de porta,
  e a emenda em x≈1,30 m passa exatamente no vão entre `A&P` e `foods` — o
  layout já respeita, mas `QUALIDADE PARA` (x 0,25–1,10 m) e o bloco de
  contatos (x 1,55–2,35 m) precisam ser confirmados como confinados a uma folha
  cada.
- Traseira é **subconjunto reordenado da lateral**: o motor pode herdar as
  decisões de técnica por template-matching, mas **não** as fronteiras — o
  contato `P`×`f` existe na lateral e não existe aqui.

### 10. Correções à análise antiga (`analysis_A.md` §10)
| A análise antiga diz | Correção |
|---|---|
| "Tudo **T-T letra×fundo**; **zero fronteira cor×cor entre elementos → nenhuma fita**" | Duplamente errado. (a) As letras brancas são **T-F**, não T-T. (b) A tipografia amarela **é** cor×cor com o roxo — são ~22 m de T-T, o grosso do trabalho da peça. A conclusão "nenhuma fita" acerta por acaso (não há curva longa aqui), pelo motivo errado. |
| "Roxo, amarelo, branco — chapadas" | 2 tintas + chapa. |
| "amarelo e branco em uma única sessão pós-cura" | Não existe sessão de branco. O branco é mascarado **antes** do roxo; se for tratado como "sessão pós-cura", perde-se a chapa e a peça vira retrabalho. |
| "textos... → **vinil**" (herdado da lateral) | **Proibido.** Adesivo é máscara. |
| "D1 fundo, D2 roxo, D3 amarelo+branco, D4 verniz" | 4 dias viram **1 dia incremental** se a traseira rodar no ciclo das laterais, porque não há cor exclusiva da traseira. |
| Vão central "passa entre A&P e foods (layout já respeita)" | ✅ **Correto e mantido.** |

---

# 3. BOI MIX-1470 — lateral

Arquivo: `BOI MIX-1470 lateral.png` · 1600×268 px (5,97:1) · escala **0,92 cm/px**
(painel **14,70 m** × 2,46 m ≈ 36,2 m²).

### 1. Implemento e substrato provável
Lateral de **carreta de 14,70 m** (o comprimento está no nome do arquivo).
Cliente é **frigorífico** → carga refrigerada → **ISOPLASTIC**. A superfície do
mockup é lisa nos 14,7 m, sem frisos — coerente. Fita amarela liberada (§4);
esta arte tem duas curvas longas que se beneficiam disso.

Painel enorme e **arte concentrada**: o logo ocupa o terço central-esquerdo e o
bloco decorativo a extremidade direita; ~60 % do painel é chapa vazia.

### 2. Fundo
**Chapa branca original, sem pintura geral, ~72 %.** O branco entre e dentro
das letras (contra-formas de `B`, `O`, `O` de `BOI`) é chapa. As áreas pintadas
são: o bloco da extremidade direita (~7,0 m²), a marca (~1,7 m²) e o swoosh
(~0,8 m²).

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Palavra em caixa alta espacejada, acima da marca | `FRIGORÍFICO` | carmim |
| E2 | Marca, serifada leve | `BOI` | vinho escuro |
| E3 | Marca, slab serif pesada, colada em E2 | `MIX` | vinho escuro |
| E4 | Swoosh: fita afilada que cruza a base de `MIX` e sai à direita com gancho; **degradê carmim→vinho** ao longo do comprimento | — | carmim→vinho |
| E5 | Assinatura manuscrita | `É a sua escolha` | carmim |
| E6 | Fita curva em S na extremidade direita, **degradê vertical carmim claro→carmim profundo** | — | carmim |
| E7 | Campo maciço da extremidade direita, atrás de E6, sangrando na borda | — | vinho escuro |

### 4. Paleta
- **Vinho escuro** (~#7B1520) — chapado nas letras e no campo E7. Cobertura **~8,7 m²**.
- **Carmim** (~#C8102E) — chapado em E1/E5, **em degradê** em E4 e E6. Cobertura **~2,5 m²**.
- **Branco** — chapa.

**Duas tintas da mesma família.** Os degradês de E4 e E6 são transições
**entre essas mesmas duas cores** — não são um terceiro tom e não são bloco
fotográfico. Resolvem-se com **aerógrafo dentro da máscara** (o aerógrafo é
aplicação de tinta, não estratégia de máscara), ou aceitando chapado carmim se
o cliente liberar.

⚠️ **Não confundir com degradê**: entre E6 e E7 o arquivo tem uma **sombra
projetada** (banda escura difusa de ~1,5 cm). É efeito de vetor do designer,
**não é tinta**. Ela não deve virar região no motor nem entrar no orçamento.

### 5. Fronteiras T-T
Par único: **carmim × vinho**, em 2 loci.

| Locus | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | Aresta superior do swoosh E4 contra as bases de `M`, `I`, `X` (E3) — o swoosh passa por cima e corta as serifas inferiores; 3 trechos horizontais + os degraus verticais nas hastes; mais o topo escuro do swoosh contra a serifa direita do `X` | **~180 cm** | **suave** no arco (raio ~4 m), **fechada** apenas nos 8 encontros haste/aresta (cantos, raio ~0) | vinho (E3 = ~1,7 m² vs swoosh ~0,8 m²) |
| T2 | Aresta direita da fita E6 contra o campo E7, do topo à base do painel | **~280 cm** | **média** (S de raio ~1 m) | vinho (E7 = ~7,0 m²) |

**Não se tocam** (mesma sessão, sem proteção):
- `FRIGORÍFICO` (E1) não toca `BOI`/`MIX` — há ~10 cm de chapa entre eles.
- `É a sua escolha` (E5) não toca as letras nem, com folga confortável, o
  swoosh; a ponta afilada do swoosh e o `É` chegam a ~5 cm. **Conferir no
  vetor**: se encostarem, são carmim×carmim → segue sem fronteira.
- E1, E5, E4 e E6 são **todos carmim** → uma única sessão de carmim cobre a
  arte inteira dessa cor, dos dois lados do baú.
- E2/E3 e E7 são **todos vinho** → idem.

**A arte inteira tem exatamente 2 fronteiras T-T e 1 par de cores.** Para um
painel de 36 m², é excepcionalmente barata.

### 6. Ordem de pintura
Carmim cobre 2,5 m², vinho cobre 8,7 m². §2 → **carmim primeiro, mascara o
carmim, vinho por cima.** Vale para os dois loci, sem conflito — não há ciclo
no grafo de ordem.

Confirmação por locus:
- **T1**: mascarar o swoosh (0,8 m² de fita afilada) é muito mais barato que
  mascarar as letras `MIX` (1,7 m² com contra-formas). Além disso o vinho é a
  cor mais escura e **cobre o carmim**; o inverso não cobriria.
- **T2**: mascarar a fita E6 (~1,4 m²) contra mascarar o campo E7 (7,0 m²) —
  fator 5 de economia de máscara.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 `FRIGORÍFICO` | **CORTE_MANUAL** | Caixa alta de ~20 cm, sans espacejada, contornos retos. Trivial. |
| E2 `BOI` + E3 `MIX` | **CORTE_MANUAL** | **Letras de ~1,15 m de altura.** Serifas de ~6 cm. É o oposto de micro-detalhe. |
| E4 swoosh | **CORTE_MANUAL**, degradê a **aerógrafo dentro da máscara** | Fita de 4,1 m de comprimento por 20 cm de largura, curva única de raio grande. Cortar 4 m de arco suave à mão é rotina. O degradê não muda a máscara. |
| E5 `É a sua escolha` | **CORTE_MANUAL** | Script com traços de 3–8 cm de largura em glifos de ~35 cm. No limite inferior do confortável, mas cortável — os traços não afinam abaixo de ~3 cm. |
| E6 fita direita | **FITA_AMARELA** na aresta contra E7 + corte manual na aresta contra a chapa | Isoplastic (§4) → a fita amarela faz o S de raio 1 m sem faca. Economiza 2,8 m de corte. |
| E7 campo direito | **CORTE_MANUAL** (só a aresta contra a chapa, ~2,6 m de curva suave) | Uma curva, sem detalhe. |

**Nada de ESPOVO**: o campo E7 é grande (7 m²) mas seu contorno é uma curva
simples já resolvida pela fita; espovo aqui só adicionaria mão de obra.

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar perfis, borrachas, aparelho de frio da testeira | — |
| S1 | Máscaras de E1, E4, E5, E6; lixar janelas (isoplastic); pintar **CARMIM** — chapado em E1/E5, aerógrafo carmim→vinho em E4 e degradê vertical em E6 | cura |
| S2 | Fita amarela na aresta E6/E7; mascarar swoosh e fita; máscaras de E2, E3, E7; lixar; pintar **VINHO** | cura |
| S3 | **Verniz geral** | — |

**2 sessões de pistola, 2 dias por lado**, e as duas laterais entram no mesmo
ciclo de cura (a segunda lateral não adiciona dia, só horas de faca).

### 9. Armadilhas para o motor de visão
- **A sombra projetada entre E6 e E7** é o falso positivo nº 1 desta arte: uma
  banda escura difusa de ~1,5 cm × 2,5 m que qualquer quantizador promove a
  terceira cor e a duas fronteiras extras. Regra: gradiente *difuso e
  unilateral* acompanhando um contorno = sombra de mockup, não tinta.
- O swoosh sobrepõe as letras: na segmentação a região de sobreposição vira um
  terceiro blob (carmim escuro sobre vinho) e o motor conta 3 cores onde há 2.
- O degradê de E4 vai do carmim ao vinho — ou seja, **a fronteira T1 desaparece
  fotometricamente na ponta direita** (as duas cores convergem). O motor precisa
  de adjacência topológica, não só de diferença de cor, para não truncar T1.
- As serifas leves de `BOI` (~6 cm) somem em máscara de baixa resolução.
- 60 % do painel é chapa vazia: o motor não pode inferir "arte pequena = job
  pequeno" — o custo aqui está no campo E7 de 7 m², que é a maior mancha do
  slice.

### 10. Correções à análise antiga (`analysis_D.md` §11)
| A análise antiga diz | Correção |
|---|---|
| "**D1 vinho → 3h → vermelho vivo**"; "swoosh×MIX: **pintar vinho → 3h → máscara → aerografia por cima**" | **Ordem invertida.** §2 manda a cor de menor cobertura primeiro: carmim (2,5 m²) antes de vinho (8,7 m²). Pintar vinho primeiro obriga a mascarar 8,7 m² para depois aplicar 2,5 m² — o contrário da economia. |
| "bloco direito → aerografia (**transições pintadas, sem borda dura entre tons**)" | Existe **borda dura**: a fita E6 e o campo E7 são dois chapados distintos separados por uma aresta nítida de 2,8 m (T2). O que a análise leu como "transição" é a **sombra projetada do vetor**, que não é tinta. Tratar T2 como aerografia livre custa uma aresta suja de 2,8 m. |
| "vinco interno = transição de aerógrafo (sem máscara)" | O "vinco" é a mesma sombra de mockup. Não existe vinco pintado. |
| "**2 famílias + degradê**", "textos → recorte+laca em **2 janelas** (vinho / vermelho)" | ✅ Direção correta, mas subdimensiona: são 2 tintas, e os degradês são transições *entre elas*, não uma terceira família. |
| Não menciona fita | Substrato isoplastic libera **FITA_AMARELA** no S de 2,8 m da extremidade direita (§4) — economiza o corte mais longo da arte. A análise antiga não considerou o substrato ao escolher a técnica. |
| "espelhar (swoosh muda direção)" | ✅ **Correto e mantido**: a composição espelha, o texto nunca. |

---

# 4. BOI MIX-1470 — traseira

Arquivo: `BOI MIX-1470 traseira.png` · 1600×1515 px (1,06:1) · escala **0,163 cm/px**
(painel ~2,60 m × 2,46 m ≈ 6,4 m²).

### 1. Implemento e substrato provável
Traseira de portas duplas do mesmo frigorífico. **ISOPLASTIC**. Emenda vertical
central em x ≈ 1,30 m. O terço inferior está vazio (reserva de para-choque,
placa, lanternas e refletiva).

### 2. Fundo
**Chapa branca original, ~88 %. Sem pintura geral.** Todas as contra-formas
(`B`, `O`, `O`, o miolo do ícone Instagram, o interior do selo SIF) são chapa.

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Caixa alta espacejada | `FRIGORÍFICO` | carmim |
| E2 | Marca | `BOI` | vinho |
| E3 | Marca slab | `MIX` | vinho |
| E4 | Swoosh cruzando a base de `MIX`, degradê carmim→vinho | — | carmim→vinho |
| E5 | Assinatura manuscrita | `É a sua escolha` | carmim |
| E6 | Ícone Instagram (quadrado arredondado vazado + círculo + ponto) | — | vinho |
| E7 | Arroba | `@frigoboimix` | vinho |
| E8 | Selo oficial circular: anel duplo, texto curvo, texto reto | `MINISTÉRIO DA AGRICULTURA` / `BRASIL` / `INSPECIONADO` / `3386` / `S.I.F.` | **preto** |

### 4. Paleta
Vinho (~0,9 m²), carmim (~0,35 m²), **preto** (~0,03 m², só o selo), chapa
branca. Degradê apenas no swoosh E4. **Três tintas** — uma a mais que a lateral,
por causa do selo.

### 5. Fronteiras T-T
| Locus | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|
| T1 | Aresta superior do swoosh E4 contra as bases de `M`, `I`, `X` | **~200 cm** | suave no arco (raio ~2,5 m); fechada nos encontros com as hastes | vinho |

**Não se tocam:**
- `FRIGORÍFICO` × `BOIMIX`: ~8 cm de chapa entre eles.
- `É a sua escolha` × swoosh: chapa entre eles (a ponta do swoosh passa acima
  do `É`); e ainda que encostassem seriam carmim×carmim.
- Ícone Instagram × `@frigoboimix`: ambos vinho.
- **Selo SIF (preto) não toca nenhuma outra tinta** — está isolado no meio de
  chapa branca, a ~40 cm de qualquer outro elemento. **Isso significa que o
  preto pode ser pintado na mesma sessão de qualquer outra cor**, não fosse a
  restrição de máscara (§7).

**1 locus, 1 par de cores.** A traseira é ainda mais barata em fronteira que a
lateral.

### 6. Ordem de pintura
- **T1 (carmim × vinho)**: carmim (0,35 m²) < vinho (0,9 m²) → **carmim
  primeiro**, mascara o swoosh, vinho por cima. Idêntico à lateral, o que
  permite rodar traseira e laterais nas mesmas duas demãos.
- **Preto**: não toca nada → sem restrição de ordem por §2. A ordem dele é
  ditada só pela técnica: como exige máscara de máquina, cai **depois do verniz**
  (§3.2 / §6.5).

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 `FRIGORÍFICO` | **CORTE_MANUAL** | Caixa alta ~6 cm, espacejada, retas. Cortável. |
| E2/E3 `BOIMIX` | **CORTE_MANUAL** | Letras de ~50 cm de altura. Trivial. |
| E4 swoosh | **CORTE_MANUAL**, degradê a aerógrafo dentro da máscara | Fita de ~1,7 m × 5 cm, curva única. |
| E5 `É a sua escolha` | **CORTE_MANUAL** | Script de ~12 cm de altura, traços de 1–3 cm. **Está no limiar** — traços de 1 cm em curva de script. Confirmar; se o cliente aceitar aumentar 20 %, sai do limiar. |
| E6 ícone Instagram | **CORTE_MANUAL** | Quadrado arredondado de ~9 cm com anel e ponto; traço de ~1,2 cm. Limiar, mas geometria é círculo+quadrado — cortável com gabarito. |
| E7 `@frigoboimix` | **CORTE_MANUAL** | Caixa ~9 cm, sans bold. |
| E8 **selo SIF** | **MASCARA_MAQUINA_SOBRE_VERNIZ** | Selo de ~37 cm de diâmetro com **texto curvo de ~3 cm de altura e traço de ~0,5 cm**, em dois anéis concêntricos, mais 3 linhas de texto reto. São dezenas de micro-detalhes num disco pequeno: **não é humanamente cortável no implemento**. É o caso-exemplo do §3.2 — e é obrigatório ser fiel, porque é selo oficial. |

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar dobradiças, varões, fechos, borrachas; reservar zona de placa/lanternas | — |
| S1 | Máscaras de E1, E4, E5; pintar **CARMIM** (aerógrafo no degradê de E4) | cura |
| S2 | Mascarar o swoosh; máscaras de E2, E3, E6, E7; pintar **VINHO** | cura |
| S3 | **Verniz geral** | **cura completa** |
| S4 | Aplicar **máscara recortada a máquina** do selo E8 sobre o verniz curado; pintar **PRETO**; verniz local | — |

S1–S3 rodam **dentro do ciclo das laterais** (mesmas tintas, mesmas demãos) →
**0 dia incremental**. S4 é exclusivo da traseira e **adiciona 1 dia**, porque
depende da cura completa do verniz.

> Ou seja: **um selo de 37 cm custa um dia inteiro.** Se houver mais de uma
> traseira no lote, agrupar todos os selos numa única sessão S4 dilui esse dia.

### 9. Armadilhas para o motor de visão
- **O selo SIF é a assinatura clássica de "não cortável à mão"**: alta
  densidade de arestas, muitas ilhas, traço mínimo <1 cm, tudo dentro de uma
  região compacta. Este é o melhor exemplar do slice para **calibrar o limiar
  `cortavel_a_mao`**.
- O motor não pode escrever "vinil" ao detectar o selo. A saída correta é
  `MASCARA_MAQUINA_SOBRE_VERNIZ` — o selo é **pintado**.
- Sobreposição swoosh/letras gera terceiro blob (mesma armadilha da lateral).
- **A emenda central corta `BOIMIX`** entre o `O` e o `I` (x≈1,30 m): a máscara
  tem que ser dividida por folha e alinhada com as portas **fechadas**; espera-se
  quebra de registro na abertura. O selo SIF (x≈1,55–1,92 m) fica inteiro na
  folha direita — bom.
- Terço inferior vazio: não mascarar a traseira inteira; mascarar por zona.

### 10. Correções à análise antiga (`analysis_D.md` §12)
| A análise antiga diz | Correção |
|---|---|
| "selo SIF → **vinil preto final obrigatório** (texto curvo minúsculo, selo oficial fiel)" | **Erro mais grave desta arte.** Adesivo nunca é produto final. O selo é **pintado** através de uma **máscara recortada a máquina aplicada sobre verniz curado** (§3.2). A fidelidade do selo oficial é garantida pelo corte da máscara, não por impressão. |
| "**'texto curvo < X cm → VINIL-FINAL' automático**" | Regra a ser **removida do motor**. A regra correta é `texto curvo < X cm → cortavel_a_mao = false → MASCARA_MAQUINA_SOBRE_VERNIZ`. A conclusão de técnica muda; a conclusão de *material final* nunca é adesivo. |
| "D1 vinho → 3h → vermelho" | Ordem invertida (ver lateral): carmim antes de vinho. |
| "D2 aerografia + **vinis** + verniz. **2 dias**" | Não há vinil. E o verniz tem de vir **antes** do selo, não depois — o que empurra o selo para uma sessão pós-verniz e faz a traseira custar **1 dia a mais que a lateral**, não "paralelizável" como a análise afirma. |
| "handle/ícone → recorte+laca (tamanho médio pintável)" | ✅ Correto para o ícone Instagram e a arroba. |
| "junta corta BOIMIX — dividir máscara por porta" | ✅ **Correto e mantido.** |

---

# 5. CLEBIN — lateral

Arquivo: `CLEBIN lateral.png` · 1600×567 px (2,82:1) · escala **0,457 cm/px**
(painel ~7,3 m × 2,60 m ≈ 19,0 m²).

### 1. Implemento e substrato provável
Lateral de baú de **distribuidora de frios** (o próprio layout declara:
`Distribuidora de Frios`, e os seis selos listam AVES/SUÍNOS/BOVINOS/PESCADOS/
INDUSTRIALIZADOS/LATICÍNIOS). Carga refrigerada, painel liso sem frisos.

**Substrato: ISOPLASTIC.** Fita amarela liberada — mas, ao contrário das outras
artes do slice, **esta não tem nenhuma curva longa que precise dela**. As duas
faixas retas (banner e barra inferior) são retas puras: fita de qualquer tipo
resolve, e a única fronteira reta relevante é T-F contra a chapa. Lixamento
obrigatório em cada janela aberta.

### 2. Fundo
**Chapa branca original, ~76 %. Sem pintura geral.** É chapa: todo o campo
central, as contra-formas de `clebin`, **os pictogramas dos seis selos**, e
todos os textos brancos (`clebin.com.br`, `Umuarama - Pr`, `(44) 3622-3000`).

Áreas pintadas: barra inferior bordô (~2,2 m²), banner do canto (~0,7 m²), seis
selos (~0,6 m²), logo e textos grafite (~1,2 m²), cunha amarela (~0,06 m²).

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Banner do canto sup. esquerdo, paralelogramo com aresta diagonal à direita | `clebin.com.br` (texto branco) | bordô |
| E2 | Logotipo, minúsculas arredondadas geométricas | `clebin` | grafite |
| E3 | Assinatura | `Distribuidora de Frios` | grafite |
| E4 | Arco grande aberto (círculo incompleto) envolvendo o `in` | — | grafite |
| E5 | Arco crescente externo, no topo direito do logo | — | bordô |
| E6 | Cunha/bandeirola entre E4 e E5 | — | **amarelo** |
| E7 | Marca registrada | `®` | grafite |
| E8 | Chamada em 2 linhas | `Entrega ágil e rápida!` | grafite |
| E9 | Seis selos quadrados arredondados com pictograma reservado em chapa | — | bordô + **contorno grafite** nos 4 primeiros |
| E10 | Micro-rótulos sob os selos | `AVES` `SUÍNOS` `BOVINOS` `PESCADOS` `INDUSTRIALIZADOS` `LATICÍNIOS` | grafite |
| E11 | Barra inferior corrida, borda a borda | `Umuarama - Pr` · `(44) 3622-3000` (textos brancos) | bordô |

**Achado que a análise antiga perdeu:** os pictogramas de **galo, porco, boi e
peixe** não são silhuetas brancas lisas — são silhuetas de **chapa com contorno
e detalhes internos em grafite** (crista, olho, barbela, narinas, orelhas,
chifres, nadadeiras, escamas). Fábrica e pote (INDUSTRIALIZADOS, LATICÍNIOS)
são silhuetas de chapa **sem** contorno. Isso cria uma terceira cor dentro do
selo e uma fronteira T-T que não estava no orçamento antigo.

### 4. Paleta
- **Bordô/vinho** — chapado. Cobertura **~3,5 m²** (barra + banner + 6 selos).
- **Grafite** (quase preto) — chapado. Cobertura **~1,2 m²**.
- **Amarelo** — chapado. Cobertura **~0,06 m²** (uma única cunha).
- **Branco** — chapa.

3 tintas, zero degradê, zero bloco fotográfico.

### 5. Fronteiras T-T
| Locus | Par | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|---|
| T1 | **amarelo × bordô** | Aresta direita da cunha E6 contra a base do arco E5 — um segmento **vertical reto** + um trecho curto quase horizontal no topo | **~28 cm** | **reta** | bordô (3,5 m² vs 0,06 m²) |
| T2 | **amarelo × grafite** | Canto inferior direito da cunha E6 contra a ponta superior do arco E4 | **~0–5 cm (contato de ponta)** | fechada | grafite |
| T3 | **grafite × bordô** | Aresta externa do contorno grafite dos 4 pictogramas (galo, porco, boi, peixe) contra o campo bordô do selo | **~350 cm** (4 animais × ~90 cm de perímetro) | **extrema** (serrilha da crista do galo, orelhas, nadadeiras: raio <1 cm) | bordô |

**Não se tocam — e isto é o achado mais valioso da arte:**
- **O arco bordô E5 e o arco grafite E4 NÃO se tocam.** Há uma faixa de chapa de
  **13 a 29 cm** entre eles em toda a extensão, inclusive na ponta inferior do
  E5. Confirmado em zoom 3,2×. As duas maiores curvas do logo são, portanto,
  **T-F dos dois lados** — custo zero de fronteira.
- O logotipo `clebin` (E2) não toca a barra E11 nem o banner E1.
- Os micro-rótulos E10 (grafite) ficam **abaixo** dos selos, sobre chapa — não
  tocam o bordô.
- O `®` (E7) está isolado em chapa.
- E1 e E11 (ambos bordô) estão em cantos opostos.
- **Todos os textos brancos são chapa preservada** → T-F, sem exceção.

**3 loci, 3 pares, ~3,8 m** — e 92 % desse comprimento está dentro de quatro
pictogramas de 22 cm.

### 6. Ordem de pintura
Coberturas: **amarelo 0,06 m² < grafite 1,2 m² < bordô 3,5 m²**. §2 aplicado par
a par dá uma cadeia consistente, sem ciclos:

1. **T1 (amarelo×bordô)** → amarelo primeiro, mascara a cunha (0,06 m²!), bordô
   por cima. Mascarar 600 cm² contra mascarar 3,5 m²: a regra paga 58×.
2. **T2 (amarelo×grafite)** → amarelo primeiro. Consistente com (1).
3. **T3 (grafite×bordô)** → pela regra, grafite antes de bordô.

Ordem nominal: **amarelo → grafite → bordô.**

**Exceção obrigatória em T3.** O contorno grafite dos pictogramas tem 1,4 cm de
espessura e segue a serrilha da crista do galo. Não há como pintá-lo *antes* e
mascará-lo: a máscara teria 1,4 cm de largura acompanhando raios de <1 cm. O
elemento cai no §3.2 e **inverte a ordem localmente**: bordô do selo primeiro →
verniz → máscara de máquina → grafite. Isso não quebra a cadeia global porque
o grafite dos selos é fisicamente independente do grafite do logo.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 banner | **CORTE_MANUAL** (aresta diagonal) + máscara do texto branco na chapa | Uma diagonal reta de ~1,1 m e um texto de ~14 cm. Fácil. |
| E2 `clebin` | **CORTE_MANUAL** | Minúsculas geométricas de ~55 cm com terminações arredondadas de raio ~7 cm. Caso ideal de faca. |
| E3 `Distribuidora de Frios` | **CORTE_MANUAL** | Caixa ~11 cm, sans light — traço de ~1,2 cm. No limiar, mas retas e curvas amplas. |
| E4 arco grafite | **CORTE_MANUAL** | Crescente de ~1,5 m de diâmetro, espessura variando de 2 a 12 cm. Curva única e limpa. |
| E5 arco bordô | **CORTE_MANUAL** | Idem. |
| E6 cunha amarela | **CORTE_MANUAL** | Quadrilátero de 26×28 cm com um lado curvo. Trivial. |
| E7 `®` | **MASCARA_MAQUINA_SOBRE_VERNIZ** ou aumentar | Anel de ~1,4 cm num disco de 14 cm, com `R` dentro. Limiar; se o cliente aceitar 20 cm, vira corte manual. |
| E8 `Entrega ágil e rápida!` | **CORTE_MANUAL** | Caixa ~25 cm, bold. Trivial. |
| E9 selos — **campo bordô + pictograma reservado em chapa** | **MASCARA_MAQUINA_SOBRE_VERNIZ** *(máscara de máquina aplicada na chapa nua — sem exigir verniz nesta etapa; ver nota)* | O contorno externo do galo/porco/boi/peixe já tem serrilha e apêndices de <1 cm. Não é cortável à mão em 22 cm. |
| E9 selos — **traços grafite internos** | **MASCARA_MAQUINA_SOBRE_VERNIZ** (§3.2 pleno) | Traço de 1,4 cm seguindo crista, olhos, narinas, escamas. Caso-livro do §3.2. |
| E10 micro-rótulos | **MASCARA_MAQUINA_SOBRE_VERNIZ** para `INDUSTRIALIZADOS`; **CORTE_MANUAL** no limite para os demais | `AVES` a ~3,8 cm de altura é cortável com esforço; `INDUSTRIALIZADOS` tem 16 glifos condensados com hastes de ~0,5 cm. Não. |
| E11 barra inferior | **CORTE_MANUAL** (aresta reta de 7,3 m) + máscaras dos textos brancos na chapa | Uma reta de 7,3 m: pode-se usar fita como guia, mas a aresta é T-F contra chapa e não precisa de proteção de segunda cor. |

> **Lacuna de taxonomia a levar ao dono.** A doutrina §3 só oferece
> `MASCARA_MAQUINA_SOBRE_VERNIZ`, que embute um ciclo de verniz. Mas quando a
> máscara de máquina é **negativa sobre chapa nua** (caso do contorno dos
> pictogramas, do `®` e de vários brancos deste slice), **não há verniz a
> esperar** — a máscara cola na laca de fábrica. Sugiro criar
> `MASCARA_MAQUINA_SOBRE_CHAPA`, sem o custo do ciclo de verniz. Sem essa
> distinção o motor vai cobrar um dia de espera que não existe.

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar perfis e borrachas; lixar janelas | — |
| S1 | Máscaras de máquina dos 6 pictogramas + máscaras manuais de todos os textos brancos, **na chapa nua**; pintar **AMARELO** (E6 — 600 cm²) | cura curta |
| S2 | Mascarar a cunha; pintar **GRAFITE** (E2, E3, E4, E7, E8, E10) | cura |
| S3 | Fita reta na junta amarelo/bordô; pintar **BORDÔ** (E1, E5, E9, E11) | cura |
| S4 | **Verniz geral** | **cura completa** |
| S5 | Máscara de máquina dos traços internos dos 4 pictogramas sobre o verniz; pintar **GRAFITE**; verniz local | — |

**S1 e S2 podem virar uma sessão só** se o contato T2 for confirmado como
respiro de chapa no vetor: nesse caso amarelo e grafite não se tocam em lugar
nenhum e vão juntos (§6.4), economizando uma cura.

**~2,5 dias por lado.** Sem o S5 (isto é, se o cliente liberar pictogramas sem
contorno interno) cai para **~1,5 dia** — a mesma conta do selo SIF do BOI MIX:
**detalhe de poucos centímetros comprando um dia inteiro de cronograma.**

### 9. Armadilhas para o motor de visão
- **Falso T-T entre os arcos.** Os arcos E4 e E5 parecem cruzar-se em baixa
  resolução; a faixa de chapa entre eles (13–29 cm) é o que salva 3 m de
  fronteira. Um motor com quantização grosseira funde os dois e cria uma T-T
  cara e inexistente. **Filete/respiro de chapa entre duas cores é a otimização
  nº 1 desta arte** — detectá-lo vale mais que qualquer refinamento de
  curvatura.
- **Pictograma lido como "branco = tinta".** Se o motor pintar o galo de branco,
  inverte todo o processo do selo.
- **Contorno grafite dos pictogramas invisível em thumbnail.** Em 1600 px de
  largura o traço tem 3 px. Ele é responsável por 92 % da fronteira T-T da arte.
  O motor precisa amostrar os selos em resolução nativa.
- Micro-rótulos `INDUSTRIALIZADOS` a 3,8 cm: densidade de aresta local altíssima
  numa região minúscula → deve disparar `cortavel_a_mao = false`.
- O `®` é ruído clássico e não deve ser descartado como ruído: ele decide uma
  técnica.
- Barra inferior encosta na borda inferior da arte: conferir se dobra para o
  para-choque e se conflita com a **faixa refletiva regulamentar** (bordô sobre
  refletiva mata a refletividade).

### 10. Correções à análise antiga (`analysis_F.md` §2)
| A análise antiga diz | Correção |
|---|---|
| "se <3 cm, considerar **impressão digital dos selos inteiros** (6 selos pequenos idênticos são **fortes candidatos a adesivo impresso**)" | **Proibido.** Adesivo/impressão não é produto final. Os selos são **pintados**: campo bordô por máscara de máquina, traços grafite por máscara de máquina sobre verniz (§3.2). |
| "detector deve sinalizar '**texto abaixo de altura mínima → impressão digital**'" | Regra a **remover do motor**. O correto: `altura < limiar → cortavel_a_mao = false → MASCARA_MAQUINA`. O produto continua sendo tinta. |
| "Linhas brancas finas dos pictogramas = fundo reservado" | Meia-verdade que esconde o custo: as linhas **brancas** são reservadas, mas há **linhas grafite** que a análise não viu. São ~3,5 m de T-T de curvatura extrema — o item mais caro da arte, ausente do orçamento antigo. |
| "**Arcos pretos × bordô**: se tocarem → cura+adesivo" / "eventuais toques dos arcos pretos" | **Não se tocam.** Verificado em zoom: 13–29 cm de chapa entre eles. A dúvida pode ser fechada — são T-F dos dois lados. |
| "3 cores chapadas... Brancos = sempre fundo reservado" | ✅ **Correto e mantido** — é a melhor passagem das análises antigas e antecipa a doutrina. |
| "Dia 1 manhã: pintar AMARELO e GRAFITE — **não se tocam, mesma sessão**" | Quase certo, mas a cunha amarela e a ponta do arco grafite **encostam-se de ponta** (T2). Ou se confirma o respiro no vetor (e aí ✅) ou entra uma cura entre as duas. |
| "Total ~1,5 dias por lado" | Só vale se os contornos grafite dos pictogramas forem eliminados. Com eles: **~2,5 dias**, por causa do ciclo de verniz do §3.2. |

---

# 6. CLEBIN — traseira

Arquivo: `CLEBIN traseira.png` · 1600×1515 px (1,06:1) · escala **0,163 cm/px**
(painel ~2,60 m × 2,46 m ≈ 6,4 m²).

### 1. Implemento e substrato provável
Traseira de portas duplas. A moldura cinza fina do arquivo é **contorno de
mockup, não é arte**. Emenda vertical central em x ≈ 1,30 m; dobradiças nas
laterais; varões/fechos verticais. **ISOPLASTIC** (mesmo baú).

### 2. Fundo
**Chapa branca original, ~90 %. Sem pintura geral.** A metade inferior está
praticamente vazia. Contra-formas de `clebin` e do `®` são chapa.

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Logotipo | `clebin` | grafite |
| E2 | Assinatura | `Distribuidora de Frios` | grafite |
| E3 | Arco grande aberto envolvendo o `in` | — | grafite |
| E4 | Arco crescente externo | — | bordô |
| E5 | Cunha/bandeirola | — | **amarelo** |
| E6 | Marca registrada | `®` | grafite/preto |
| E7 | Telefone, canto inferior direito | `(44) 3622-3000` | bordô |

Não há banner, não há barra inferior, **não há selos** — some o elemento mais
caro da lateral.

### 4. Paleta
Grafite (~0,45 m²), bordô (~0,12 m²), amarelo (~0,015 m²), chapa branca. Tudo
chapado.

### 5. Fronteiras T-T
| Locus | Par | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|---|
| T1 | **amarelo × bordô** | Aresta direita da cunha E5 contra a base do arco E4: segmento vertical reto + trecho curto no topo | **~19 cm** | **reta** | bordô |
| T2 | **amarelo × grafite** | Canto inferior direito da cunha contra a ponta superior do arco E3 | **~0–3 cm (ponta)** | fechada | grafite |

**Não se tocam:**
- **Arco bordô E4 × arco grafite E3: NÃO se tocam.** Faixa de chapa de 10–14 cm
  em toda a extensão. Verificado em resolução nativa.
- **Grafite × bordô não se tocam em lugar nenhum desta traseira** — nem o
  telefone E7 (bordô, isolado no canto inferior direito) nem o arco E4 encostam
  em grafite. **Consequência de cronograma: grafite e bordô podem ser pintados
  na MESMA sessão** (§6.4).
- O `®` está isolado em chapa.

**2 loci, 2 pares, ~22 cm de fronteira T-T no painel inteiro.** É a arte mais
barata do slice em fronteira.

### 6. Ordem de pintura
- **T1**: amarelo (150 cm²) < bordô (0,12 m²) → **amarelo primeiro**, mascara a
  cunha, bordô por cima.
- **T2**: amarelo < grafite → **amarelo primeiro**.

O amarelo é a única cor que precisa anteceder alguém. Grafite e bordô, por não
se tocarem, entram **juntos** depois.

Ordem: **amarelo → (grafite + bordô juntos)**. Duas sessões de pistola.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 `clebin` | **CORTE_MANUAL** | Minúsculas geométricas de ~40 cm, terminações de raio ~5 cm. Fácil. |
| E2 `Distribuidora de Frios` | **CORTE_MANUAL** | Caixa ~9 cm, traço ~1 cm. Limiar confortável. |
| E3 arco grafite | **CORTE_MANUAL** | Crescente de ~1,0 m de diâmetro, espessura 2–9 cm. Curva única. |
| E4 arco bordô | **CORTE_MANUAL** | Idem. |
| E5 cunha amarela | **CORTE_MANUAL** | Quadrilátero de ~19×24 cm com um lado curvo. |
| E6 `®` | **MASCARA_MAQUINA_SOBRE_VERNIZ** ou aumentar | Anel de ~0,8 cm num disco de 9 cm. Abaixo do limiar de faca. Recomendo negociar aumento — é o único item que forçaria um ciclo de verniz nesta peça. |
| E7 `(44) 3622-3000` | **CORTE_MANUAL** | Caixa ~11 cm, bold. Trivial. |

Nenhum ESPOVO, nenhuma fita necessária (a única fronteira T-T é uma reta de
19 cm; qualquer fita serve, e o substrato isoplastic garante a amarela).

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; **empapelar dobradiças, varões, fechos, borrachas**; reservar zona de placa/lanternas/para-choque | — |
| S1 | Máscaras; pintar **AMARELO** (E5) | cura curta |
| S2 | Mascarar a cunha; pintar **GRAFITE** (E1, E2, E3, E6) **e BORDÔ** (E4, E7) na mesma sessão — não se tocam | cura |
| S3 | **Verniz geral** | — |

Rodando no ciclo das laterais: **0 a 0,5 dia incremental**. Se o `®` for
mantido no tamanho atual, soma-se uma sessão pós-verniz (~1 dia) — mesma
armadilha das outras traseiras do slice.

### 9. Armadilhas para o motor de visão
- **Moldura cinza fina do arquivo = mockup.** Se lida como arte, vira um
  retângulo pintado de 10 m de perímetro.
- Mesmo falso T-T entre arcos da lateral (aqui a faixa de chapa é ainda mais
  fina: 10 cm).
- **A ausência de contato grafite×bordô é o dado que economiza uma sessão
  inteira.** Um motor que só mede "quais cores existem" e não "quais cores se
  tocam" nunca acha essa economia — é o exemplo mais limpo do slice para
  justificar a medição de T-T.
- Metade inferior vazia: não promover artefato de compressão a elemento.
- **A emenda central corta o logotipo** entre o `e` e o `b`: máscara dividida
  por folha, alinhamento com portas **fechadas**; o arco E3 e o `n` caem na
  região do varão direito — conferir conflito físico.
- Telefone bordô no canto inferior direito fica na altura provável da
  **refletiva regulamentar**; conferir folga.

### 10. Correções à análise antiga (`analysis_F.md` §3)
| A análise antiga diz | Correção |
|---|---|
| "Todas T-F, exceto amarelo×bordô no swoosh (T-T, suave, fita+corte) **e eventuais toques dos arcos pretos**" | Os arcos **não se tocam** (10–14 cm de chapa). A dúvida está fechada. Também: a fronteira amarelo×bordô é **reta**, não "suave" — não precisa de fita flexível, precisa de uma régua. |
| "junta amarelo×bordô do swoosh com fita+corte **ou claro→cura→escuro**" | A segunda opção é a certa por §2 (amarelo cobre 150 cm², bordô 0,12 m²), mas o texto a apresenta como alternativa e não como regra. |
| "**Reaproveitar o arquivo de corte da lateral em escala maior**" | Conceitualmente ok, mas na doutrina corrigida o "arquivo de corte" só existe para os poucos elementos §3.2. Tudo o mais é **cortado à mão no implemento**, e um arquivo de corte não se reaproveita — o corte manual é refeito por peça. Isso muda a conta de horas. |
| "manhã amarelo+grafite, tarde bordô" | Perde a economia real: **grafite e bordô não se tocam nesta traseira** → vão na mesma sessão. O que precisa de sessão isolada é o **amarelo**, que toca os dois. A análise antiga acertou o número de sessões e errou o agrupamento. |
| "Sincronizar traseira com as duas laterais" | ✅ **Correto e mantido.** |

---

# 7. BOIPORÉ — lateral

Arquivo: `BOIPORÉ lateral.png` · 1600×461 px (3,47:1) · escala **0,563 cm/px**
(painel ~9,0 m × 2,60 m ≈ 23,4 m²).

### 1. Implemento e substrato provável
Lateral de baú de **frigorífico** (`FRIGORÍFICO BOIPORÉ`). Proporção 3,47:1 →
~9,0 m. Painel liso e contínuo, sem frisos.

**Substrato: ISOPLASTIC.** Frigorífico ⇒ refrigerado ⇒ sanduíche liso. Isso
decide a técnica da única fronteira cara da arte: **fita amarela** faz o arco de
3,5 m sem nenhum corte (§4). Se o baú fosse carga seca com chapa rebitada, a
mesma curva exigiria fita branca — que não faz curva — e portanto **3,5 m de
corte manual**. Aqui o substrato vale literalmente meio dia.

Lixamento obrigatório nas janelas.

### 2. Fundo
**Chapa branca original ~74 %, sem pintura geral.** O cinza-claro da direita
**não** é fundo nem mockup: é **tinta** (~24 % do painel, ~5,6 m²). As
contra-formas de `O`, `Ó`, `R`, `B`, `P` são chapa.

A moldura cinza fina em volta da imagem é do mockup.

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Cabeça de boi em line-art caligráfico: chifre/orelha, arco do dorso, linha do rosto, focinho maciço, papada; traços de largura variável com pontas afiladas | — | grafite |
| E2 | Marca em 2 linhas, caixa alta, slab com cantos chanfrados | `FRIGORÍFICO` / `BOIPORÉ` | vermelho tijolo |
| E3 | Assinatura manuscrita | `Qualidade em Alimentos!` | grafite |
| E4 | Faixa curva de ~17 cm de largura, arco único, da borda superior à inferior | — | vermelho tijolo |
| E5 | Painel de fundo à direita de E4, sangrando nas 3 bordas | — | **cinza-claro** |

### 4. Paleta
- **Cinza-claro** — chapado. Cobertura **~5,6 m²** (a maior mancha).
- **Vermelho tijolo** — chapado. Cobertura **~1,3 m²** (faixa 0,6 + marca 0,7).
- **Grafite** — chapado. Cobertura **~0,9 m²**.
- **Branco** — chapa.

3 tintas, **zero degradê, zero bloco fotográfico, zero micro-detalhe**. Do ponto
de vista de execução, é a arte mais limpa do slice.

### 5. Fronteiras T-T
| Locus | Par | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|---|
| T1 | **vermelho × cinza-claro** | Aresta direita (interna) da faixa E4 contra o painel E5, da borda superior à inferior do painel | **~350 cm** | **suave** — arco de raio ~4 m, monotônico, sem inflexão | cinza-claro (5,6 m² vs 0,6 m²) |

**Não se tocam — a arte é quase toda T-F:**
- **E1 (boi grafite) não toca E2 (marca vermelha).** Verificado em zoom: o traço
  mais próximo do boi passa a ~8 cm do `F` de `FRIGORÍFICO`, e a papada passa a
  ~7 cm do `Q` de `Qualidade`.
- **E3 (script grafite) não toca E2.**
- **E2 não toca E4 nem E5** — a marca termina a ~1,2 m da faixa.
- **E1/E3 (grafite) não tocam E4/E5** — estão inteiramente no campo branco.
- A aresta **esquerda** (externa) da faixa E4 encosta na chapa branca → **T-F**,
  3,5 m de graça.

**1 locus, 1 par, 3,5 m no painel inteiro de 23 m².**

### 6. Ordem de pintura
Par único. Vermelho da faixa cobre 0,6 m²; o painel cinza cobre 5,6 m². §2 →
**vermelho primeiro, mascara a faixa, cinza por cima.** Fator ~9 de economia de
máscara.

O grafite (E1, E3) e o vermelho da marca (E2) **não tocam nada** — não têm
posição obrigatória na ordem. Logo, por §6.4, entram **na mesma sessão** que a
faixa vermelha, e o grafite pode ser pintado **junto** com o vermelho (máscaras
separadas, duas pistolas ou duas passadas na mesma janela de trabalho).

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 boi line-art | **CORTE_MANUAL** | Traços caligráficos de **6 a 14 cm de largura** em uma figura de ~2,0 m de altura, com pontas afiladas e uma ilha interna na orelha. Largura mínima muito acima do limiar; as pontas afiladas exigem faca cuidadosa, não máquina. |
| E2 `FRIGORÍFICO BOIPORÉ` | **CORTE_MANUAL** | Caixa alta de ~45 cm, slab com cantos chanfrados — só retas e chanfros. É o elemento mais fácil do slice inteiro. |
| E3 `Qualidade em Alimentos!` | **CORTE_MANUAL** | Script com traços de 2–3,4 cm em glifos de ~28 cm. **Está no limiar** — é o único elemento da arte que merece conferência no vetor. Se algum traço afinar abaixo de 1,5 cm, migra para §3.2. |
| E4 faixa curva | **FITA_AMARELA** na aresta interna (contra E5) + **CORTE_MANUAL** na aresta externa (contra chapa) | Substrato isoplastic (§4) → fita amarela faz o arco de raio 4 m sem corte. Elimina o único trecho longo de corte curvo da arte. |
| E5 painel cinza | **CORTE_MANUAL** (nenhuma aresta própria além da faixa) | O painel sangra nas 3 bordas; sua única aresta é a fronteira T1, já resolvida pela fita. |

**Candidato a ESPOVO_DIRETO — e por que não:** a faixa E4 é grande (3,5 m) e de
formato fácil (arco único), o que a qualifica pelos dois critérios do §3.3. Mas
espovo é "mais barato em material, mais lento em mão de obra", e a fita amarela
já entrega a mesma curva por custo de material trivial e **zero** mão de obra de
marcação. **Fita vence.** (Se o baú fosse carga seca — fita branca, sem curva —
o espovo direto passaria a ser a alternativa real ao corte manual dos 3,5 m.)

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar borrachas e aparelho de frio da testeira; lixar janelas | — |
| S1 | Máscaras de E1, E2, E3, E4; pintar **VERMELHO** (faixa E4 + marca E2) e **GRAFITE** (boi E1 + script E3) — **não se tocam, mesma sessão** (§6.4) | cura |
| S2 | **Fita amarela** na aresta interna da faixa + mascarar a faixa; pintar **CINZA-CLARO** do painel E5 | cura |
| S3 | **Verniz geral** | — |

**2 sessões de pistola. 1,5 a 2 dias por lado**, sem nenhuma espera de verniz
intermediária, porque **nenhum elemento cai no §3.2**. As duas laterais entram
no mesmo ciclo.

Cuidado de composição: o boi deve **olhar para a frente do veículo nos dois
lados** → a composição espelha, e a faixa muda de extremidade. Conferir também a
continuidade do painel cinza na quina traseira.

### 9. Armadilhas para o motor de visão
- **Cinza-claro de tinta × cinza de mockup.** O painel E5 (~#C0C0C0) e a moldura
  de apresentação do arquivo têm valores próximos. Se o motor descartar o cinza
  como mockup, perde 5,6 m² de tinta e a única T-T da arte. Se promover a
  moldura a arte, inventa um retângulo de 23 m de perímetro.
- **Falso "pintura geral".** O branco domina 74 % — abaixo do limiar de pintura
  geral, mas a soma branco+cinza (98 %) pode disparar um classificador mal
  calibrado. A decisão correta depende de separar chapa de cinza pintado.
- **A faixa é fina (17 cm em 9 m).** Em thumbnail ela some ou se funde com o
  cinza, e a fronteira T1 desaparece do orçamento. A faixa deve ser amostrada em
  resolução nativa.
- **Traços caligráficos do boi** têm largura variável e antialiasing pesado; um
  vetorizador quebra o traço em fragmentos e conta 15 elementos onde há 1.
- Chifre/orelha têm uma **ilha interna** (respiro branco dentro do traço) que o
  motor deve contar como ilha, não como elemento separado.

### 10. Correções à análise antiga (`analysis_E.md` §1)
| A análise antiga diz | Correção |
|---|---|
| "Dia 1: **1) cinza claro do painel; 2) cinza-escuro (boi+tagline); 3) fita amarela na divisa curva; 4) vermelho (faixa+texto)**" | **Ordem invertida.** O cinza (5,6 m²) é a cor de MAIOR cobertura e a análise o põe em primeiro. Por §2 o **vermelho vem primeiro** (0,6 m² na faixa), é mascarado, e o cinza entra por cima. Além disso a fita aparece no passo 3, entre as duas cores erradas. |
| "**tinta-tinta**: vermelho×cinza claro... **fita amarela flexível** é ideal" | ✅ **Correto e mantido** — mas agora justificado pelo substrato (isoplastic, §4) e não por preferência. |
| "3 cores chapadas — vermelho escuro, cinza-escuro, cinza claro" | Rigorosamente correto (branco não foi contado como cor) — **a melhor contagem de cores das análises antigas**. |
| "Boi line-art + tagline script: **adesivo de recorte plotado** sobre o branco" | Vocabulário perigoso: "adesivo plotado" sugere corte de máquina como norma. Estes dois elementos são **CORTE_MANUAL** (traços de 6–14 cm) — plotar aqui é gastar máquina onde a faca resolve, e é o caminho que a doutrina §3.1 manda evitar. |
| "Total: **1–1,5 dia** sem esperas de cura obrigatórias (fita resolve a única tinta-tinta)" | Otimista em 0,5 dia: **há sim uma cura obrigatória** entre o vermelho e o cinza (não se pode mascarar tinta fresca). O número correto é **1,5–2 dias**. A intuição de que a fita elimina o gargalo está certa. |
| "regiões não se tocam, mesmo dia com máscaras separadas" | ✅ **Correto e mantido** — é exatamente o §6.4. |

---

# 8. CASA DO QUEIJO

Arquivo: `CASA DO QUEIJO.png` · 1600×593 px (2,70:1) · escala **0,438 cm/px**
(painel ~7,0 m × 2,60 m ≈ 18,2 m²).

### 1. Implemento e substrato provável
Lateral de baú de **laticínios/perecíveis** — o próprio layout declara no badge:
`TRANSPORTE DE PRODUTOS PERECÍVEIS`. Proporção 2,70:1 → ~7,0 m (truck/toco).
Painel liso, sem frisos.

**Substrato: ISOPLASTIC.** Perecíveis ⇒ refrigerado ⇒ sanduíche liso. Decisão
crítica aqui, porque esta arte tem **~15 m de curva longa e suave** (a onda) e a
fita amarela transforma esses 15 m de corte em 15 m de fita sem faca (§4). Com
fita branca (carga seca) a onda seria impossível — fita branca não faz curva — e
os 15 m voltariam como corte manual.

Lixamento obrigatório nas janelas (muitas nesta arte).

### 2. Fundo
**Chapa branca original ~55 %. Sem pintura geral** — a região pintada
(onda azul + fita amarela + rodapé) soma ~40 %, abaixo do limiar. A metade
superior é chapa nua com o logo e o badge por cima.

**Branco = chapa** também: todos os textos e ícones do rodapé
(`casadoqueijo.com.br`, `@casadoqueijo.mc`, globo, Instagram, Facebook) são
chapa preservada **dentro** do campo azul. Ou seja: essas máscaras têm de estar
na chapa **antes** do azul.

### 3. Inventário de elementos
| # | Elemento | Texto exato | Cor |
|---|---|---|---|
| E1 | Badge do canto sup. esquerdo: retângulo arredondado só de contorno, texto em 2 linhas | `TRANSPORTE DE` / `PRODUTOS PERECÍVEIS` | azul (contorno + texto) |
| E2 | Silhueta única casa+chaminé+placa, com contorno contínuo de ~3 cm | — | **contorno verde, miolo amarelo** |
| E3 | Fatia de queijo dentro da casa: contorno + linha de dobra + **12 furos circulares** de 3,5 a 6,5 cm | — | verde sobre amarelo |
| E4 | Nome da marca dentro da placa, slab bold com bordas orgânicas | `CASA DO QUEIJO` | verde sobre amarelo |
| E5 | Assinatura, caixa alta, **fonte "carimbada"/erodida com respingos internos** | `TRADIÇÃO E SABOR À SUA MESA` | azul |
| E6 | Onda azul da metade inferior, crista subindo à direita, sangrando nas 3 bordas | — | azul |
| E7 | **Fita amarela interna à onda**, paralela à crista, borda a borda, espessura 9–40 cm | — | amarelo |
| E8 | Ícone globo (círculo + 4 meridianos) + site | `casadoqueijo.com.br` | chapa branca |
| E9 | Ícones Instagram e Facebook (quadrados arredondados) + arroba | `@casadoqueijo.mc` | chapa branca |

### 4. Paleta
- **Azul royal** — chapado. Cobertura **~7,3 m²** (onda + rodapé + tagline + badge).
- **Amarelo** — chapado. Cobertura **~3,0 m²** (fita da onda ~1,75 + miolo do logo ~1,26).
- **Verde bandeira** — chapado. Cobertura **~0,8 m²** (contorno + letras + queijo).
- **Branco** — chapa.

3 tintas, **zero degradê, zero bloco fotográfico**. Toda a complexidade está em
**comprimento e curvatura de fronteira**, não em cor.

### 5. Fronteiras T-T
Dois pares, cinco loci. É a arte mais cara do slice.

| Locus | Par | Onde | Compr. aprox. | Curvatura | Cobre mais |
|---|---|---|---|---|---|
| T1 | **amarelo × azul** | Aresta **superior** da fita E7 contra a faixa azul da crista da onda, da borda esquerda à direita | **~750 cm** | **suave** — onda de raio 3–6 m, uma inflexão perto do centro | azul |
| T2 | **amarelo × azul** | Aresta **inferior** da fita E7 contra o corpo azul da onda | **~750 cm** | **suave**, idem | azul |
| T3 | **verde × amarelo** | Aresta interna do contorno de E2 (silhueta casa+chaminé+placa) | **~850 cm** | **média** nas pontas arredondadas da placa (raio ~25 cm); **reta** no telhado e na chaminé | amarelo |
| T4 | **verde × amarelo** | Contorno dos 12 glifos de `CASA DO QUEIJO` (E4), altura ~22 cm, com contra-formas em A/A/D/O/Q/E/J/O | **~1000 cm** | **fechada** (contra-formas de raio 3–5 cm) + bordas orgânicas irregulares | amarelo |
| T5 | **verde × amarelo** | Contorno + dobra + **12 furos** do queijo E3 | **~400 cm** | **fechada a extrema** (furos de raio 1,7–3,3 cm) | amarelo |

**Não se tocam — economias reais:**
- **Verde e azul NUNCA se tocam.** O logo (verde+amarelo) está separado da onda
  (azul+amarelo) por ~60 cm de chapa; a tagline E5 (azul) passa a ~15 cm abaixo
  do logo, sem encostar; o badge E1 (azul) está isolado no canto.
- **Todo o amarelo do logo é interno**: o miolo E2 é **inteiramente cercado por
  verde** e não toca chapa branca em ponto algum. Não há filete/keyline branco
  entre verde e amarelo — verificado em zoom 3×. (A análise antiga mandava
  conferir isso; está conferido: **não há**.)
- Os textos e ícones brancos do rodapé são chapa → **T-F** contra o azul.
- A aresta superior da onda (onde o azul encosta na chapa) é **T-F**, ~7,5 m
  de graça.

**5 loci, 2 pares, ~37 m — o maior comprimento de T-T do slice**, e 2/3 dele
está dentro de um logotipo de 2,45 m × 1,12 m.

### 6. Ordem de pintura
Coberturas: **verde 0,8 m² < amarelo 3,0 m² < azul 7,3 m².** §2 par a par:

1. **T3/T4/T5 (verde × amarelo)** → verde primeiro, mascara o verde, amarelo por cima.
2. **T1/T2 (amarelo × azul)** → amarelo primeiro, mascara a fita, azul por cima.

Cadeia: **verde → amarelo → azul.** Sem ciclos, e como verde e azul não se
tocam, a cadeia é forçada apenas pelo amarelo, que é o intermediário nos dois
pares. Três sessões de pistola, obrigatoriamente nesta ordem.

> **Exceção que recomendo levar ao dono — o logo inverte §2.**
> Nos loci T3/T4/T5 o verde é uma **cor contida**: contorno de 3 cm, letras e
> furos, todos *dentro* do campo amarelo. Aplicar §2 ao pé da letra significa
> (a) cortar as janelas do verde na máscara, pintar verde; (b) depois **cortar
> outra vez exatamente os mesmos 22 m de contorno** para mascarar o verde antes
> do amarelo. **O corte é feito duas vezes.**
> A alternativa — amarelo primeiro preenchendo toda a silhueta, cura, e então
> **corte manual das janelas do verde sobre o amarelo curado** (§3.1) — faz o
> corte **uma vez só** e gasta ~1,3 m² a mais de amarelo, que é a tinta mais
> barata da conta.
> Regra proposta para o motor: **§2 vale quando a cor menor toca a chapa/borda;
> inverte-se quando a cor menor está topologicamente contida na maior.** Este é
> o caso mais nítido do slice inteiro para calibrar essa condição — vale ~11 m
> de corte, ou meio dia de faca.
> Abaixo apresento o cronograma na **ordem literal da doutrina**; a variante
> invertida troca as sessões S1 e S2 do logo e economiza a segunda cortada.

Para T1/T2 (fita da onda) **não há dúvida**: a fita amarela toca a borda do
painel dos dois lados, é campo largo e contínuo, e §2 vale integralmente —
pinta amarelo, protege com fita amarela nas duas curvas, azul por cima.

### 7. Estratégia por elemento
| Elemento | Estratégia | Justificativa |
|---|---|---|
| E1 badge | **CORTE_MANUAL** | Retângulo arredondado com traço de ~1,3 cm e texto de ~6 cm em 2 linhas. **No limiar** — o traço de 1,3 cm em 3,3 m de perímetro é fino. Conferir; candidato a simplificação (engrossar para 2 cm). |
| E2 silhueta casa+placa | **CORTE_MANUAL** | Contorno de 3 cm seguindo retas (telhado, chaminé) e semicírculos de raio 25 cm. Perfeitamente cortável. |
| E3 queijo (contorno + dobra + 12 furos) | **CORTE_MANUAL** | Furos de 3,5–6,5 cm de diâmetro: um humano corta círculos de 4 cm com estilete e gabarito. Tedioso (12 ilhas), não impossível. **Fica acima do limiar por pouco** — é o melhor caso de teste do slice para o limiar de ilhas. |
| E4 `CASA DO QUEIJO` | **CORTE_MANUAL** | Caixa alta de 22 cm, slab bold. Bordas orgânicas irregulares são **suavizáveis na faca sem prejuízo visual** a 22 cm. 12 glifos ≈ 10 m de corte. |
| E5 `TRADIÇÃO E SABOR À SUA MESA` | **CORTE_MANUAL** para a silhueta; **a textura erodida NÃO se reproduz à mão** | A fonte é "carimbada": tem dezenas de respingos brancos de 0,5–1,3 cm dentro de cada glifo de 17 cm. Cortar os respingos é inviável. **Duas saídas: (a) pintar os glifos sólidos, descartando a textura — recomendado, imperceptível a 3 m; (b) MASCARA_MAQUINA_SOBRE_VERNIZ para manter a textura, custando um ciclo de verniz por uma sutileza tipográfica.** Decisão do dono/cliente. |
| E6 onda azul | **CORTE_MANUAL** na aresta superior (contra chapa, T-F, ~7,5 m de curva suave) | Uma curva longa e mansa; sem segunda cor a proteger. |
| E7 fita amarela da onda | **FITA_AMARELA** nas duas arestas (T1 e T2) | Caso canônico do §4: isoplastic + curva suave contínua de 7,5 m × 2. **15 m de fronteira por zero corte.** É a maior economia isolada do slice. |
| E8 globo + site | **CORTE_MANUAL** no texto; **MASCARA_MAQUINA_SOBRE_CHAPA** no globo | Texto de ~13 cm: fácil. Globo de 15 cm com 4 meridianos de **1,8 cm**: dois anéis concêntricos separados por 1,8 cm — abaixo do limiar de faca. Recomendo simplificar para globo sólido. |
| E9 ícones sociais + arroba | **CORTE_MANUAL** (limite) | Quadrados arredondados de ~13 cm com traço de ~1,8 cm, círculo e ponto no Instagram, `f` no Facebook. Geometria simples; cortável com gabarito. |

**Candidato a ESPOVO_SOBRE_MASCARA — e por que não:** o logo E2 é grande
(2,45 m) e teria o perfil do §3.3 (aplicar máscara, bater carvão por cima,
cortar seguindo a marca). Mas a marcação por carvão só resolve o **contorno
externo**; as 12 letras, os 12 furos e a dobra do queijo continuariam a ser
cortados à mão de qualquer jeito. O espovo pouparia ~8,5 m de traçado num total
de ~22 m, ao custo de furar um kraft de 2,45 m à mão. **Não compensa.**

### 8. Sequência de sessões e dias
| Sessão | Conteúdo | Espera |
|---|---|---|
| S0 | Lavagem; empapelar borrachas e aparelho de frio; **aplicar as máscaras de chapa do rodapé** (textos e ícones brancos de E8/E9) na chapa nua; lixar janelas | — |
| S1 | Máscara sobre a chapa; cortar as janelas do **VERDE** (contorno E2, letras E4, contorno+dobra+12 furos E3); pintar **VERDE** | cura |
| S2 | Mascarar todo o verde; pintar **AMARELO** — miolo do logo **e** fita E7 da onda, na mesma sessão (não se tocam entre si) | cura |
| S3 | **Fita amarela** nas duas arestas de E7 (T1 e T2); mascarar o amarelo do logo; pintar **AZUL** — onda E6, rodapé, tagline E5, badge E1, tudo na mesma sessão (azul não toca verde em lugar nenhum) | cura |
| S4 | Remover máscaras de chapa do rodapé; retoques; **verniz geral** | — |
| S5 | *(só se a textura de E5 e/ou o globo de E8 forem mantidos)* máscara de máquina sobre verniz curado; pintar; verniz local | — |

**3 sessões de pistola. ~2,5 dias por lado**, ou **~3,5 dias** se E5/E8 forem
mantidos fiéis. Na variante recomendada (logo com amarelo antes do verde),
S1 e S2 trocam e economiza-se ~11 m de corte — **cerca de meio dia de faca por
lado**.

Duas laterais no mesmo ciclo de cura. Atenção: a **faixa refletiva
regulamentar** cai exatamente sobre o rodapé azul — ou se sobe o rodapé, ou se
embute o refletivo dentro dele; refletivo sob tinta não reflete.

### 9. Armadilhas para o motor de visão
- **A fita amarela E7 afina até 9 cm** na extremidade direita e até uma ponta na
  região central. Em resolução reduzida ela desaparece — e com ela **15 m de
  T-T, a maior fronteira da arte**. Regra: amostrar em resolução nativa
  qualquer região alongada com razão comprimento/largura > 50.
- **Onde a fita afina até zero** (no cruzamento central) o motor vê dois blobs
  amarelos separados e conta dois elementos; é **um** elemento contínuo.
- **A textura erodida de E5** gera centenas de micro-ilhas brancas dentro dos
  glifos. Um contador de ilhas ingênuo classifica a tagline como o elemento
  mais complexo da arte e dispara §3.2 — quando a resposta certa é
  "**textura decorativa, descartável**". O motor precisa distinguir *ilha
  estrutural* (contra-forma de letra, furo de queijo) de *ruído de textura de
  fonte*. Heurística: ilhas < 2 cm², sem repetição estrutural, distribuídas
  aleatoriamente dentro de um glifo = textura.
- **Ausência de keyline branco entre verde e amarelo.** Em outras artes o filete
  de chapa converte T-T em 2×T-F; aqui **não existe** — o verde encosta direto no
  amarelo em 22 m. O motor não pode assumir keyline por padrão em logos com
  contorno.
- **Verde e azul nunca se tocam** — dado que autoriza pintar a tagline, o badge,
  a onda e o rodapé todos na mesma sessão. Sem medir T-T, o motor faria três
  sessões de azul.
- Antialias verde/amarelo produz um verde-limão intermediário ao longo de 22 m;
  erosão de 1–2 px antes de quantizar.
- O globo de E8 é o item de maior densidade de aresta por área da arte —
  bom disparador de `cortavel_a_mao = false`.

### 10. Correções à análise antiga (`analysis_E.md` §10)
| A análise antiga diz | Correção |
|---|---|
| "amarelos e ícones pequenos **em vinil**" | **Proibido.** Adesivo/vinil nunca é produto final. Os ícones do rodapé são **chapa preservada** (máscara antes do azul) e os amarelos são **pintados**. |
| "Logo: **amarelo → verniz → cura 3h → adesivo → verde**" | Contradiz §2 (verde cobre 0,8 m², amarelo 3,0 m² → verde primeiro) **e** embute um ciclo de verniz desnecessário: a máscara do §3.1 cola direto na laca curada, sem verniz. Ironicamente a *ordem* proposta é a que eu recomendo como exceção — mas pelo motivo errado e com um verniz a mais. |
| "Contorno concêntrico com curvas médias → **cura+adesivo mais seguro que fita+corte**" | O contorno de E2 não é caso de fita nem de "adesivo": é **CORTE_MANUAL** de um traço de 3 cm com raios de 25 cm. Trivial à faca. |
| "Textos/ícones do rodapé: **máscara negativa** — aplicar as letras em adesivo ANTES do azul e remover depois (letras = branco da chapa)" | ✅ **Correto e mantido** — a passagem mais alinhada com a doutrina em todas as análises antigas. |
| "**conferir no vetor se há filete branco** entre amarelo e verde do lozenge (mudaria fronteiras para tinta-fundo)" | **Conferido: não há filete.** O verde encosta direto no amarelo. Os ~22 m são T-T de verdade. |
| "Filete amarelo dentro do azul: ... **2 fitas amarelas paralelas**" | ✅ Correto — e agora quantificado: são **15 m** de fronteira resolvidos por 2 corridas de fita, a maior economia isolada do slice. |
| "**4 cores chapadas**: azul-royal, amarelo, verde bandeira, branco" | **3 tintas** + chapa. |
| "~2 dias" | **2,5 dias** na ordem literal da doutrina, **3,5** se a textura da tagline e o globo forem mantidos fiéis. A tagline erodida não é mencionada na análise antiga e é o segundo maior risco de prazo da peça. |
| "ícones sociais são glifos minúsculos que **não devem virar 'elementos de pintura'**" | Errado: eles **são** elementos de pintura — no negativo. São chapa preservada e exigem máscara cortada antes do azul. Ignorá-los significa pintar por cima e perder os ícones. |

---

## Padrões transversais deste slice

1. **Substrato é decisão de primeira ordem, não de última.** Os 5 clientes são
   de cadeia fria → 8 de 8 artes em isoplastic → fita amarela liberada em todas.
   Isso sozinho elimina **~22 m de corte curvo** (A&P 2,9 m + BOI MIX 2,8 m +
   BOIPORÉ 3,5 m + CASA DO QUEIJO 15 m). Nas análises antigas o substrato era
   inferido *depois* da técnica; ele tem de vir antes.

2. **Branco tratado como tinta era o erro estrutural.** Em 8 de 8 artes a
   análise antiga contou o branco como cor e converteu T-F em T-T. Só em
   A&P lateral+traseira isso inflava ~14 m de fronteira inexistente e inventava
   uma "sessão de branco" que não existe.

3. **A tipografia é a maior fonte de T-T, não as faixas.** Contra a intuição:
   em A&P lateral a tipografia amarela responde por 28 dos 31 m; em CASA DO
   QUEIJO as letras do logo respondem por 10 dos 37 m. Um motor que meça
   fronteira só em "regiões grandes" subestima essas artes em 80–90 %.

4. **Respiro/keyline de chapa entre duas cores é a otimização nº 1** — e é
   frágil no raster. Confirmado presente em CLEBIN (13–29 cm entre os arcos, que
   a análise antiga tratou como dúvida cara) e confirmado **ausente** em CASA DO
   QUEIJO (verde encosta no amarelo). Nos dois casos a resposta valia horas.

5. **Um detalhe de poucos centímetros compra um dia inteiro.** Selo SIF (37 cm),
   contornos dos pictogramas CLEBIN (1,4 cm de traço), ® de A&P (0,55 cm),
   globo de A&P/CASA DO QUEIJO, textura erodida da tagline CASA DO QUEIJO. Cada
   um força um ciclo `verniz → cura → máscara de máquina → pintar → verniz
   local`. **Em todos os casos existe uma simplificação de design que devolve o
   dia** — e essa conversa com o cliente vale mais que qualquer otimização de
   processo.

6. **"Cores que não se tocam vão na mesma sessão" (§6.4) só é acionável com
   medição de T-T.** Casos concretos deste slice: BOIPORÉ (vermelho + grafite
   juntos), CLEBIN traseira (grafite + bordô juntos), CASA DO QUEIJO (onda +
   rodapé + tagline + badge, todos azuis, numa sessão só), BOI MIX (todo o
   carmim numa sessão, todo o vinho na outra). Sem medir adjacência, um motor
   conservador cria 2–3 sessões a mais por arte.

7. **Sombra de mockup e moldura de apresentação são tinta fantasma.**
   Confirmado em BOI MIX (sombra projetada entre a fita e o campo — que a
   análise antiga leu como transição aerografada), BOIPORÉ (moldura cinza) e
   CLEBIN traseira (moldura cinza). Filtrar antes de segmentar.

8. **Lacuna de taxonomia a fechar com o dono:** falta
   `MASCARA_MAQUINA_SOBRE_CHAPA` — máscara recortada a máquina aplicada em
   **chapa nua** (pictogramas CLEBIN, ícones do rodapé CASA DO QUEIJO, ® e globo
   de A&P). Não exige ciclo de verniz. Sem essa categoria o motor cobra um dia
   de espera inexistente em pelo menos 4 das 8 artes.

9. **Condição de topologia para §2.** A regra "menor cobertura primeiro" vale
   quando a cor menor **toca a chapa ou a borda do painel** (faixa A&P, fita
   CASA DO QUEIJO, faixa BOIPORÉ, swoosh BOI MIX). Quando a cor menor está
   **contida** na maior (letras dentro de campo: `foods` no roxo, `CASA DO
   QUEIJO` no amarelo), aplicá-la ao pé da letra faz **cortar duas vezes o mesmo
   contorno**. Recomendo inverter nesse caso — vale ~11 m de corte só em CASA DO
   QUEIJO. **Precisa de confirmação do dono.**

10. **Nenhuma arte deste slice tem bloco fotográfico.** Nenhuma pendência de
    aerografia-vs-pintura-à-mão a levar ao dono. Os únicos degradês são as duas
    transições carmim→vinho do BOI MIX, que são **entre duas cores da própria
    marca** e se resolvem com aerógrafo dentro da máscara, sem decisão de custo.
