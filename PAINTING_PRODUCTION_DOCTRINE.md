# Doutrina de produção — pintura de implementos

Fonte: correção do dono (ago/2026). **Este documento tem precedência sobre
`layout database/analysis/analysis_A..F.md` e sobre as seções de estratégia do
`PAINTING_COST_ENGINE_PLAN.md`** onde houver conflito. As análises A–F foram
escritas sob uma premissa errada e precisam ser refeitas contra esta rubrica.

---

## 0. A premissa que estava errada

> "Nunca são usados adesivos já prontos. Os adesivos sempre são apenas para
> molde das pinturas."

**Adesivo nunca é o produto final. Adesivo é máscara.** Tudo que aparece pintado
no implemento foi pintado. O vinil recortado existe só para delimitar onde a
tinta entra.

O que as análises A–F afirmam e está **errado**:

| Análise diz | Realidade |
|---|---|
| "globo impresso aplicado por cima (impintável)" | é máscara; o globo é pintado |
| "morangos+banner = IMPRESSÃO DIGITAL recortada no contorno" | não existe painel impresso final |
| "impressão digital só se prazo apertar" | não é alternativa à pintura |
| "ícones WhatsApp impressos" | pintados |

**Só uma etapa é feita por máquina: o corte do formato da máscara.** Todo o
resto — posicionar, depilar, cortar in situ, mascarar, bater carvão, pintar,
envernizar — é manual. Qualquer estimativa de tempo tem que partir daí.

**Resolvido pelo dono (ago/2026)** — o 2 Amigos é o caso extremo de referência:

| elemento | técnica real |
|---|---|
| morangos (fotográfico) | **aerografia** |
| banner dourado | **pintura com degradê**, cor sobre cor |
| texto "Frutícula 2 Amigos" | impossível cortar → adesivo **sobre o banner já pintado e envernizado** |

A sequência do banner é a doutrina §3.2-b em estado puro: máscara do banner →
pinta → enverniza → só então cola as máscaras do texto por cima → pinta.

Fotográfico **nunca** vira impresso: vira aerografia. Degradê **não é**
fotográfico — é rampa entre duas cores, e se distingue por medida (§7.2).

> **Aerografia ainda leva adesivo.** Correção do dono (2026-08-05): *"o polvo
> era uma aerografia, devia ter o adesivo do formato em volta, mas a pintura em
> si é aerografia"*.
>
> O adesivo define o **contorno**, e **apenas o contorno externo** — *"a
> aerografia só tem adesivo no shape exterior, apenas"*. Nada de recorte
> interno, nada de depilação de miolo: o que está dentro da silhueta é todo
> trabalho à mão livre do setor de Aerografia.
>
> Consequências para o orçamento, nos dois sentidos:
> - **custa mais** do que "sem adesivo": há recorte, aplicação e remoção da
>   silhueta externa
> - **custa menos** do que um elemento normal da mesma área: o comprimento de
>   corte é só o **perímetro exterior**, não a soma de todos os contornos
>   internos, e não há depilação por cor lá dentro
>
> No motor: a região de aerografia entra com `perimetro_corte_cm` = perímetro
> do anel externo, ignorando `holes[]` e sub-regiões.

---

## 1. A medida que faltava: fronteira T-T

Fronteira **tinta-tinta** = duas cores **ambas não-brancas** se tocando. É o que
gera trabalho de mascaramento, e o motor precisa medir, por fronteira:

- **comprimento em cm** do trecho em contato
- **quão curvilíneo** é esse trecho (raio de curvatura, em cm)
- qual das duas cores **cobre mais área**

Fronteira **tinta-fundo** (T-F), onde a cor encosta na chapa branca original,
não gera esse trabalho — não há segunda cor para proteger.

O `painting-engine` já extrai adjacência e histograma de curvatura
(`boundaries.py`). O que falta é **classificar cada fronteira como T-T ou T-F
usando "branco/cor-do-fundo" como critério** e propagar comprimento + curvatura
para a decisão de estratégia abaixo.

---

## 2. Ordem de pintura: decidida pela CORTABILIDADE da cor menor

Quando duas cores se tocam, a pergunta que ordena tudo é **"a cor de menor
cobertura é cortável à mão?"** — e ela tem duas respostas com custos opostos:

### 2.1 Cortável à mão → a MENOR vem primeiro

```
1. pinta a cor que cobre MENOS área, direto na chapa
2. mascara ela (máscara pequena) e corta à mão
3. pinta a cor que cobre MAIS área por cima
```

Exemplo do dono: vermelho e azul se encontram, vermelho cobre mais área →
**pinta o azul primeiro**, mascara o azul, pinta o vermelho. Mascarar a área
menor gasta menos máscara e menos tempo de corte que mascarar a maior.

### 2.2 NÃO cortável à mão → o FUNDO vem primeiro

```
1. pinta a cor que cobre MAIS área (o campo)
2. enverniza e cura                          ← só neste ramo
3. aplica a adesivo recortado no plotter
4. pinta a cor menor por cima
```

Não dá para criar a forma pequena primeiro se ninguém consegue cortá-la: ela
depende de uma adesivo, e essa máscara pousa sobre o campo já
pintado. É o §3.2-b, e é o ramo caro — paga máquina, verniz e espera.

### 2.3 Consequência para o motor

`cortavel_a_mao` tem de ser avaliado **ANTES** de ordenar as sessões, não
depois de escolher a técnica. Ele decide as duas coisas ao mesmo tempo:

| cortável à mão? | ordem | estratégia | pousa sobre |
|---|---|---|---|
| sim | menor primeiro | `CORTE_MANUAL` | CHAPA |
| não | fundo primeiro | `ADESIVO_SOBRE_VERNIZ` | TINTA |

A última coluna explica por que o sinal `sobre` do §7.1 funciona: numa arte
pronta, o elemento que **teve** de esperar o campo é o que aparece cercado de
tinta. Medir `sobre` é ler, no resultado, a decisão que a produção foi obrigada
a tomar.

---

## 3. Árvore de decisão por elemento

Avaliada nesta ordem. O critério dominante é **"um humano consegue cortar isso
com estilete, no implemento?"**

### 3.0 A primeira pergunta é T-F ou T-T — não "dá para cortar"

```
duas cores DO DESENHO se tocam neste elemento?
├── NÃO → adesivo aplicado INTEIRO, depilado por cor.
│         Nada de corte manual. Sem verniz, sem espera. §3.2-a
└── SIM → aí sim entra a pergunta da cortabilidade. §3.1 / §3.2-b
```

**A pintura geral não conta como "tinta que se toca".** Ela é feita no dia
anterior e chega curada, então o adesivo assenta direto sobre ela — sem ciclo
de verniz e sem espera, exatamente como sobre chapa nua. O que dispara o ramo
caro é **duas cores do próprio desenho** se encontrando (dentro de uma
logomarca, de uma faixa), não o encontro do desenho com o campo.

> Correção do dono, 2026-08-05: *"no caso de pintura geral o toca-tinta não se
> aplica, porque a pintura geral sempre é feita no dia anterior; a não ser que
> tenha 2 outras cores que se toquem numa logomarca ou faixa"*.
>
> Sem isso, toda arte com pintura geral jogaria **todos** os elementos na rota
> de verniz + espera — no 137 PESCADOS seriam 7 elementos de uma vez.

> **Correção 2026-08-05.** Este documento tratava corte manual como rota
> *preferida*. É **rara**. O dono: *"quase nunca será mascaramento e corte
> manual"* e *"achei que o corto/não corto seria para caso de cor sobre cor;
> quando é sobre o branco mesmo, raramente é cortado"*.
>
> Faz sentido mecânico: sobre chapa não há camada de baixo para proteger nem
> para separar no tempo. O plotter recorta a máscara, ela é aplicada inteira, e
> a depilação de cada parte libera a cor da vez. Corte à mão só existe quando é
> preciso separar **duas tintas**.

**A máscara é aplicada inteira, não por cor.** Uma folha cobre o elemento todo;
o que muda entre sessões é a **depilação** — remove-se a parte da cor que entra
agora e o resto segue protegido. Um plano com uma etapa de máscara por cor está
errado.

### 3.1 Corte manual in situ — só em cor sobre cor, e mesmo assim raro

Aplica máscara lisa sobre a laca **curada**, corta o desenho à mão, pinta.

Vale quando é humanamente cortável **e** há duas tintas para separar, porque
evita as duas coisas caras do §3.2-b: **recortar uma máscara nova** e **esperar
o verniz**. A máscara gruda direto na laca.

### 3.2-a Adesivo recortado no plotter sobre CHAPA NUA — sem ciclo de verniz

Quando o desenho não é cortável à mão **mas não há tinta embaixo** (vai direto
sobre a chapa original), a adesivo entra direto: não há o que
proteger, então não há verniz nem espera.

Levantado independentemente pelas reanálises das fatias 2, 4 e 7. Tratar esses
casos como §3.2 superestima o cronograma em ~3 h por peça.

### 3.2-b Adesivo recortado no plotter sobre verniz — quando não dá para cortar à mão

Quando o desenho é pequeno demais e tem dezenas de detalhes (impossível de
cortar à mão):

```
1. pinta a cor que cobre mais área (ex.: vermelho)
2. ENVERNIZA e espera curar
3. aplica a adesivo recortado no plotter com o desenho (ex.: azul)
4. pinta
```

Custa mais: uma máquina de corte + um ciclo de verniz + a espera. É o caminho de
exceção, não o padrão.

### 3.3 Espovo (estêncil de kraft + carvão) — só para MUITO GRANDE e MUITO FÁCIL

Papel kraft furado à mão com milhares de furos no formato do desenho. Posiciona
no implemento e bate carvão por cima; o pó atravessa os furos e marca o desenho.

Dois usos, diferentes:

- **Faixa**: espovo batido **direto na chapa**. É o caso comum de faixa.
- **Logo grande** (ex.: um triângulo muito grande): aplica a **máscara primeiro**,
  bate o carvão **por cima da máscara**, depois corta seguindo a marca de carvão
  — sai o desenho como se fosse adesivo, mas cortado à mão.

Mais barato em material, mais lento em mão de obra. **Raramente escolhido** —
só quando o elemento é extremamente grande *e* de formato fácil.

---

## 4. Faixas: fita, não adesivo

Faixas quase nunca usam adesivo. As opções são espovo (§3.3) ou fita, e a
escolha da fita depende do **substrato** e da **orientação**:

A condição são **duas**, e a segunda é do traçado, não do material:

| Substrato | Traçado | Fita | Consequência |
|---|---|---|---|
| Isoplastic ou lona | qualquer curva | **amarela** | flexível, sem corte |
| Outros (chapa…) | curva tranquila / horizontal | **amarela** | flexível, sem corte |
| Outros (chapa…) | **muito vertical** | **branca** | não curva, é mais larga → **exige corte** |

> ⚠️ **Correção 2026-08-05.** Este documento dizia "fita amarela só em
> isoplastic/lona; em chapa é branca". Errado — generalização minha. O dono
> havia dito "se for outro tipo de implemento, **se estiver muito vertical**
> não dá para usar fita amarela". Em chapa com traçado tranquilo a amarela
> passa: é o caso das duas ondas da **BURES 2**, que é chapa branca.
>
> As reanálises v2 herdaram o erro. Onde uma fatia acusou "fita amarela
> prescrita em substrato que a proíbe" (AAN, SGT, BURES 2, Cavalcante), a
> acusação precisa ser reavaliada pela **verticalidade do traçado**, não
> descartada.

Falta calibrar o que é "muito vertical". Medida proposta: ângulo da tangente do
eixo medial da faixa; se passar de um limiar por um trecho relevante, cai para
fita branca.

---

## 5. O que o motor precisa passar a produzir

Por elemento e por fronteira, para alimentar a árvore do §3:

```
boundary: { a, b, tipo: T_T | T_F, comprimento_cm, curvatura[], raio_min_cm,
            cor_maior_cobertura }
elemento: { area_cm2, perimetro_cm, ilhas, detalhe_minimo_mm,
            cortavel_a_mao: bool, estrategia: CORTE_MANUAL | ADESIVO_SOBRE_VERNIZ
                                            | ESPOVO_DIRETO | ESPOVO_SOBRE_MASCARA
                                            | FITA_AMARELA | FITA_BRANCA }
substrato: CHAPA_BRANCA | ISOPLASTIC | LONA | OUTRO   # decide a fita
```

`cortavel_a_mao` é o limiar central e ainda não está calibrado. Candidatos a
critério: menor detalhe em mm, número de ilhas, razão perímetro/área, raio
mínimo de curvatura. **Precisa ser calibrado contra artes reais com o dono.**

---

## 6. Sequência de sessões

Consequência direta do §2 e §3, e é o que gera o cronograma:

1. **Só se houver pintura geral**: lavagem + empapelamento de perfis, borrachas,
   ferragens e faixa refletiva.
   **Sem pintura geral (chapa branca): não se lava, e o empapelamento é apenas
   uma cinta em volta das máscaras** — protege do overspray, nada mais.
   Aplicar o ciclo de preparação inteiro numa arte de chapa infla o orçamento
   com horas que não acontecem.
2. Fundo de preparação (primer/laca de fundo), se o substrato exigir
3. Para cada par de cores que se toca, na ordem que o §2 determinar:
   - cor menor **cortável à mão** → menor primeiro: pinta → cura → mascara →
     pinta a maior (inclusive quando a maior é a pintura geral)
   - cor menor **não cortável** → campo primeiro: pinta → **enverniza e cura** →
     adesivo → pinta a menor
4. Cores que **não se tocam** entram na **mesma sessão** (não há o que proteger)
5. Elementos do §3.2 entram só depois do verniz
6. Verniz final

A regra 4 é a maior economia de cronograma e depende inteiramente da medição de
T-T do §1: sem ela, não dá para saber o que pode ir junto.

---

## 7. Como o motor detecta os casos difíceis

Tudo aqui é medida, não palpite. Cada detector abaixo produz um número que a
árvore do §3 consome.

### 7.1 "Não dá para cortar à mão" — dois eixos, não um

**Cortabilidade = espessura × retilineidade.** Nenhum dos dois decide sozinho.

Caso de referência do dono (**ACM**): os triângulos do mosaico são cor tocando
cor — T-T legítimo — e **são cortados à mão**, porque são retos e o estilete
corre. Um script da mesma espessura é incortável, porque muda de direção o
tempo todo.

Daí `vertices_per_m`: vértices por metro de contorno depois de simplificar a
0,5 cm. Triângulo fica perto de 1/m; filigrana passa de dezenas. É o eixo que
faltava — e explica por que a correlação com espessura sozinha deu em nada
(§ ⚠️ abaixo).

**Primeira calibração do dono (2026-08-05)**, 9 elementos marcados, todos
"corto", de **14 mm** a 61 mm, incluindo 3 do ACM. Nenhum "não corto": o limiar
está **abaixo de 14 mm** e ainda sem cota superior. A rodada 2 tem de varrer a
faixa fina e cruzar os dois eixos.

Sinais medidos:

O critério que decide entre §3.1 (barato) e §3.2 (caro). Nenhum sozinho basta:

| sinal | como medir | por que importa |
|---|---|---|
| **menor traço em mm reais** | transformada de distância / eixo medial dentro da máscara, × `px_per_cm` | fonte script tem junções finas; abaixo do limiar o estilete rasga |
| **está sobre tinta ou sobre chapa?** | `containment`: a região que contém o elemento é fundo ou é cor pintada? | necessário, **não suficiente** — ver ⚠️ abaixo |
| **densidade de detalhe** | vértices de alta curvatura por metro de contorno; ilhas por m² | filigrana e micro-texto |
| **compacidade** | `perímetro² / (4π·área)` | letra chapada ≈ 1–3; script e ornamento rendilhado explodem |

O 2 Amigos mostra por que o tamanho sozinho não decide: "Frutícula 2 Amigos" tem
letra de ~1 m de altura e mesmo assim vai de adesivo, porque pousa
**sobre o banner pintado e envernizado**.

> ⚠️ **Medido em 2026-08-05 nas 66 artes — a hipótese NÃO se sustentou.**
> `menor_traco_mm`, `compacidade` e `area_cm2` têm distribuições
> **indistinguíveis** entre elementos sobre chapa e sobre tinta (medianas
> 28,7 × 25,6 mm; 4,5 × 4,0; 773 × 770 cm²; n=422).
>
> A razão é estrutural: numa arte com **pintura geral, todo elemento pousa sobre
> tinta**, tenha ele 1 m ou 1 cm. `sobre` acaba detectando "esta arte tem fundo
> pintado", não "este elemento exigiu o ramo caro". Serve para *excluir* o ramo
> caro (elemento sobre chapa nua nunca precisa dele), nunca para *confirmá-lo*.
>
> Consequência: **não existe rótulo automático de cortabilidade.** O limiar só
> sai de exemplos marcados pelo dono (§7.5). Os detectores geram a lista
> ordenada; a linha de corte é decisão humana.

### 7.2 Aerografia × degradê × chapado — pelo resíduo do ajuste

Os três parecem "não-chapado" no histograma, mas exigem trabalho muito diferente.
O discriminador é **quão bem L\* é explicado por uma rampa**:

```
ajusta L* = a·x + b·y + c   (e a variante radial) dentro da região
R² alto  + poucos matizes            → DEGRADE      (rampa entre 2 cores)
R² baixo + entropia alta + N matizes → AEROGRAFIA   (tom contínuo, fotográfico)
variância desprezível                → CHAPADO
```

O `painting-engine` já faz esse ajuste em `classify.py`; o que falta é **usar o
resíduo como discriminador** em vez de só rotular DEGRADE/FOTOGRAFICO, e trocar
o destino de FOTOGRAFICO de "impresso" para **AEROGRAFIA**.

### 7.3 Elemento com degradê PARCIAL — a máscara dentro da máscara

Caso do "Frutícula 2 Amigos" cinza: a parte de cima é cinza chapado, a de baixo
tem degradê, e existe uma marcação separando as duas. Produção: pinta o cinza
base → **fita + papel cobrindo a parte de cima** → degradê só embaixo. É uma
segunda sessão de mascaramento **dentro de um único elemento** — invisível para
qualquer análise que trate o elemento como uma cor só.

Como detectar:

```
1. projeta L* dos pixels da região sobre o eixo principal (PCA)
2. ajusta dois modelos: (a) rampa única  (b) constante até s, rampa depois
3. se (b) reduz o resíduo de forma relevante → há divisão
4. emite split_pos_pct = s, e a cor chapada e os extremos da rampa
```

Saída: `internal_split: { eixo, split_pos_pct, cor_chapada, degrade_de, degrade_ate }`
→ vira o passo "mascarar metade e aerografar o resto", com seu próprio custo de
fita e papel.

### 7.4 Contrato — o que o engine precisa passar a emitir

```
fronteira: { tipo: T_T | T_F, comprimento_cm, raio_min_cm, curvatura[],
             cor_maior_cobertura, containment }
elemento:  { area_cm2, perimetro_cm, ilhas, menor_traco_mm, compacidade,
             sobre: CHAPA | TINTA,          # 7.1, o sinal forte
             textura: CHAPADO | DEGRADE | AEROGRAFIA,   # 7.2 por resíduo
             internal_split: {...} | null,  # 7.3
             cortavel_a_mao: bool,          # ⭐ decide ORDEM e técnica (§2.3)
             ordem: MENOR_PRIMEIRO | CAMPO_PRIMEIRO,
             estrategia: CORTE_MANUAL | ADESIVO_SOBRE_CHAPA
                       | ADESIVO_SOBRE_VERNIZ | ESPOVO_DIRETO
                       | ESPOVO_SOBRE_MASCARA | FITA_AMARELA | FITA_BRANCA
                       | AEROGRAFIA }
substrato: CHAPA_BRANCA | ISOPLASTIC | LONA | OUTRO
```

### 7.5 Calibração

`menor_traco_mm`, `compacidade` e a densidade de detalhe **não têm limiar
definido**. O caminho é rodar os detectores nas 66 artes, ordenar por cada
sinal, e pedir ao dono para apontar onde está a linha do "isso eu não corto".
Duas ou três artes de cada lado da fronteira bastam para fixar o limiar.
