# Slice 7 — Reanálise sob a Doutrina de Produção (ago/2026)

Refaz, contra `api/PAINTING_PRODUCTION_DOCTRINE.md`, as artes:
137 PESCADOS (lateral + traseira), 2 amigos 15, 2 amigos, 3 IRMÃOS 8,40 (lateral +
traseira), BOX DA TERRA, CARLOTTI carreta.

**Premissas aplicadas (não negociáveis):**

- Adesivo é **máscara**, nunca produto final. Não existe painel impresso aplicado.
- Branco **nunca é tinta**. Todo branco visível é chapa preservada por máscara.
- A única etapa de máquina é o **corte do formato da máscara**. Posicionar,
  depilar, cortar in situ, mascarar, bater carvão, pintar e envernizar são manuais.
- Bloco fotográfico ⇒ **PENDÊNCIA do dono** (aerografia × pintura artística à mão),
  nunca impressão.
- Nota de método introduzida aqui: `MASCARA_MAQUINA_SOBRE_VERNIZ` só custa o ciclo
  de verniz quando a máscara pousa sobre **tinta fresca**. Quando o elemento
  micro-detalhado pousa sobre **chapa nua** (ou laca já curada do dia anterior), a
  máscara cortada a máquina entra **sem ciclo de verniz** — mesma técnica, metade
  do custo. Marco esses casos como `MASCARA_MAQUINA (direto na chapa)`.

Escalas assumidas (derivadas da proporção do arquivo; confirmar em obra):

| Arte | proporção do arquivo | dimensão assumida | cm por px (render 1600) |
|---|---|---|---|
| 137 PESCADOS lateral | 3,66:1 | 9,00 × 2,46 m | 0,56 |
| 137 PESCADOS traseira | 1,01:1 | 2,50 × 2,48 m | 0,16 |
| 2 amigos 15 | 5,52:1 | 15,00 × 2,72 m | 0,94 |
| 2 amigos (esq.) | 2,94:1 | **8,00 × 2,70 m** (≠ do outro lado!) | 0,50 |
| 3 IRMÃOS 8,40 lateral | 3,50:1 | 8,40 × 2,40 m (bate exato com o nome) | 0,53 |
| 3 IRMÃOS 8,40 traseira | 1,07:1 | 2,55 × 2,38 m | 0,17 |
| BOX DA TERRA | 3,27:1 | 8,00 × 2,45 m | 0,50 |
| CARLOTTI carreta | 5,52:1 | 14,00 × 2,55 m | 0,88 |

---

## Tabela-resumo

| Arte | Substrato | Fundo | Pares T-T | Estratégia dominante | Complexidade |
|---|---|---|---|---|---|
| 137 PESCADOS lateral | ISOPLASTIC (provável; pescado refrigerado) | **pintura geral cinza ~86%** (pendência de tom) | **7** | CORTE_MANUAL sobre cinza curado; low-poly em máscaras sequenciais | média-alta |
| 137 PESCADOS traseira | ISOPLASTIC, portas duplas | **pintura geral cinza ~92%** (tom ≠ da lateral) | **10** | CORTE_MANUAL + MASCARA_MAQUINA na bandeira | alta |
| 2 amigos 15 (lat. dir.) | OUTRO — confirmar (frutícula: chapa ou isoplastic) | **pintura geral chumbo ~80%** | **9** | pintura geral + CORTE_MANUAL + **aerografia mural (PENDÊNCIA)** | muito alta |
| 2 amigos (lat. esq.) | idem | **pintura geral preta ~78%** (preto ≠ chumbo do outro lado) | **9** | idem + correção de texto espelhado | muito alta |
| 3 IRMÃOS 8,40 lateral | ISOPLASTIC (provável; frigorífico) | **chapa branca ~88%, sem pintura geral** | **1** | CORTE_MANUAL em **negativo** (todo branco = chapa) | média |
| 3 IRMÃOS 8,40 traseira | ISOPLASTIC, portas duplas | **chapa branca ~92%, sem pintura geral** | **3** | CORTE_MANUAL negativo + MASCARA_MAQUINA no micro-texto | média |
| BOX DA TERRA | ISOPLASTIC (provável; hortifruti) | **chapa branca ~42%, sem pintura geral** | **7** (5 certos + 2 a confirmar) | CORTE_MANUAL (curvas orgânicas grandes) | média-alta |
| CARLOTTI carreta | CHAPA_BRANCA (ou LONA se sider — confirmar) | **chapa branca ~93%, sem pintura geral** | **1** | CORTE_MANUAL puro; zero fita | baixa |

**Total de pares T-T no slice: 47.**

---

# 1. 137 PESCADOS — lateral

### 1. Implemento e substrato provável
Lateral de baú de **pescado refrigerado**, proporção 3,66:1 (~9,00 × 2,46 m).
Segmento pescado ⇒ baú frigorífico ⇒ **ISOPLASTIC liso** com altíssima
probabilidade (chapa lisa laminada, sem frisos horizontais — o arquivo confirma:
não há nenhuma quebra de relevo na composição).

Consequência doutrinária (§4): isoplastic **habilitaria fita amarela**, mas esta
arte **não tem nenhuma faixa** — só letras e triângulos. A escolha de fita é
irrelevante aqui; o que o substrato realmente decide é: **lixamento obrigatório
nas janelas da máscara** antes de pintar (isoplastic não ancora laca sem
lixamento) e **verniz poliéster** no fechamento.

### 2. Fundo
Cinza médio uniforme cobrindo ~86% da superfície. **Não é branco, logo é tinta ⇒
PINTURA GERAL CINZA.** Zero chapa branca preservada nesta arte.

> **PENDÊNCIA DE TOM:** o cinza da lateral (~#B0B0B4) e o cinza da traseira
> (~#8B9091) **não são o mesmo tom no arquivo**. Ou (a) é uma cor só e um dos dois
> arquivos foi exportado com perfil diferente, ou (b) o designer usou o cinza como
> tela de apresentação e a intenção real é chapa branca. Isso é a **decisão de
> maior impacto da arte**: com pintura geral são ~4 dias e 7 pares T-T; sem
> pintura geral são ~2 dias e **3** pares T-T (só azul×azul do low-poly).
> Assumo (a) — pintura geral cinza — mas exige confirmação escrita do cliente
> antes de comprar tinta.

### 3. Inventário de elementos
- (a) Script caligráfico itálico **"Deus seja sempre louvado"**, azul-marinho,
  topo-esquerda. ~186 × 16 cm; hastes finas de ~1–2 cm.
- (b) **"137"** em serifada didone gigante, azul-marinho. Altura ~129 cm.
- (c) **"PESCADOS"** em letreiro de pincel irregular (falhas de traço propositais),
  azul-marinho. ~506 × 51 cm, caps espacejadas.
- (d) **"www.137pescados.com.br"**, azul-marinho bold, rodapé central. ~13,5 cm de
  altura.
- (e) Glifo Instagram (quadrado arredondado + círculo + ponto) + **"137pescados"**,
  azul-marinho, rodapé-direita. Glifo ~17 cm.
- (f) **Cluster low-poly** inferior-esquerdo: ~30 triângulos em 3 azuis,
  ocupando ~185 × 161 cm, sangrando pela borda esquerda e inferior.
- (g) **Cluster low-poly** superior-direito: ~28 triângulos, ~174 × 140 cm,
  sangrando pela borda direita e superior.

### 4. Paleta
Todas **chapadas** — nenhum degradê real. O low-poly simula volume com **facetas
chapadas**, o que é uma vantagem produtiva enorme (nada de aerografia).

| Cor | Uso | Aprox. |
|---|---|---|
| Cinza médio | fundo geral (~86%) | #B0B0B4 |
| Azul-marinho | toda a tipografia | #26305E |
| Azul médio | faceta dominante do low-poly (~50% dos triângulos) | #2F6FB5 |
| Azul escuro | facetas de sombra (~30%) | #1E4E8F |
| Azul claro/aço | facetas de luz (~20%) | #5F8FC8 |

### 5. Fronteiras T-T
Com pintura geral cinza, **não existe nenhuma fronteira T-F nesta arte** — tudo
que toca o cinza é T-T.

| # | Par | Extensão aprox. | Curvatura | Cor de maior cobertura |
|---|---|---|---|---|
| 1 | marinho × cinza (todo o perímetro tipográfico: script + 137 + PESCADOS + www + @) | ~5.400 cm somados (script ~900, "137" ~700, "PESCADOS" ~2.900, rodapé ~900) | **média** nas serifas e nas curvas de S/C/O; **suave** nas hastes; o script é o pior trecho (raio mín. ~2 cm) | **cinza** (fundo) |
| 2 | azul médio × cinza | ~1.500 cm (contornos externos dos dois clusters) | **reta** (arestas de triângulo) | **cinza** |
| 3 | azul escuro × cinza | ~800 cm | **reta** | **cinza** |
| 4 | azul claro × cinza | ~600 cm | **reta** | **cinza** |
| 5 | azul médio × azul escuro | ~700 cm (≈25 arestas internas de 25–30 cm) | **reta** | azul médio |
| 6 | azul médio × azul claro | ~450 cm (≈16 arestas) | **reta** | azul médio |
| 7 | azul escuro × azul claro | ~250 cm (≈9 arestas) | **reta** | azul escuro |

**Não se tocam (⇒ mesma sessão):**
- **Azul-marinho tipográfico × qualquer azul do low-poly.** Medido: o "P" de
  PESCADOS começa a ~17 cm do triângulo mais próximo do cluster inferior-esquerdo;
  o "7" de 137 fica a ~135 cm do cluster superior-direito; o bloco "@137pescados"
  fica no rodapé, e o cluster direito morre ~85 cm acima dele. **Nenhum contato
  em nenhum ponto.** Isso é a maior economia da arte.
- Os dois clusters low-poly não se tocam entre si (separados por ~5 m de cinza).

### 6. Ordem de pintura
Aplicando §6.2 antes de §2: **a pintura geral é exceção à regra da menor
cobertura** — ela é o passo 2 do cronograma, vem antes de tudo, e depois os
elementos são pintados por cima dela. A regra "menor cobertura primeiro" (§2) só
governa os pares **entre elementos**.

1. **Cinza geral** (86%) — passo §6.2, primeiro, cura.
2. **Azul claro** do low-poly (20% do cluster = menor cobertura entre os três azuis)
   — pares 6 e 7 mandam pintá-lo primeiro. Mascara.
3. **Azul escuro** (30%) — par 5 manda pintá-lo antes do médio. Mascara.
4. **Azul médio** (50% = maior cobertura do trio) — por último dentro do low-poly.
5. **Azul-marinho** tipográfico — pode entrar em **qualquer** das etapas 2–4, pois
   não toca nenhum azul. Encaixo no passo 2 para aproveitar a mesma janela de cura.

Justificativa par a par: em 5, 6 e 7 a faceta clara e a escura são minorias de
área contra o azul médio dominante; mascarar 450–700 cm de aresta reta de um
triângulo pequeno custa muito menos máscara que mascarar todo o campo médio.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa (§3: "um humano corta isso com estilete?") |
|---|---|---|
| (b) "137" — 129 cm de altura | **CORTE_MANUAL** | Serifada gigante, hastes de ~12 cm e serifas de ~3 cm. Trivialmente cortável. |
| (c) "PESCADOS" — 51 cm | **CORTE_MANUAL** | Letreiro de pincel com falhas propositais: **ninguém confere o contorno exato**. É o caso ideal de corte manual — o traço "errado" é indistinguível do traço "certo". |
| (d) www / (e) @137pescados — 13,5 cm | **CORTE_MANUAL** | Grotesca bold de 13,5 cm; contra-formas de a/e/o com ~2,5 cm. Cortável. |
| (a) script "Deus seja sempre louvado" — 16 cm, hairlines de 1–2 cm | **CORTE_MANUAL** (marginal) | 16 cm de altura de x é grande. Hairlines de 1 cm em 186 cm de extensão: pedem lâmina nova e mão firme, mas é uma faixa única e contínua. Só cai para MASCARA_MAQUINA se a confirmação de escala derrubar a arte para <10 cm de altura de letra. |
| (f)(g) low-poly, ~58 triângulos de 20–45 cm de aresta | **CORTE_MANUAL** (3 máscaras sequenciais, uma por azul) | Só **retas**. Um triângulo de 25 cm é o desenho mais fácil que existe para estilete. Não usar máquina: seriam 3 máscaras cortadas + 2 ciclos de verniz para ganhar zero. |
| Fundo cinza | pintura geral (§6.2) | Não é um "elemento"; é o passo 2. |

Nada aqui pede fita (não há faixas), espovo (nada é ao mesmo tempo gigante e de
formato fácil — os triângulos são fáceis mas pequenos) nem máquina.

### 8. Sequência de sessões e dias
Assumindo os **dois lados** no mesmo ciclo (economia de ~40% — a cura é a mesma).

- **Dia 1** — Preparação: lavar, empapelar perfis de borda, borrachas, ferragens e
  o aparelho de frio da testeira. Fundo/primer de cor próxima ao cinza. Isoplastic
  ⇒ lixar.
- **Dia 2** — **Sessão A**: cinza geral (2 demãos). Cura overnight (obrigatória:
  toda máscara subsequente pousa sobre ele).
- **Dia 3** — **Sessão B** (uma sessão só, porque as cores não se tocam):
  máscara lisa sobre o cinza curado, corte manual de toda a tipografia **+** dos
  triângulos de azul claro; pinta **azul-marinho** e **azul claro** juntos.
  Depilar. → **Sessão C** (mesmo dia, após secagem de laca ~1 h): máscara +
  corte dos triângulos de azul escuro; pinta azul escuro.
- **Dia 4** — **Sessão D**: máscara + corte dos triângulos de azul médio; pinta.
  Retoques. → **Sessão E**: verniz poliéster geral. Cura overnight.
- **Dia 5** (meio período) — faixa refletiva de rodapé, desempapelamento,
  inspeção.

**~4 a 4,5 dias** para o par de laterais. Se a pendência de fundo resolver para
"chapa branca", cai para **~2 dias** (some o Dia 1–2 inteiro e os pares 1–4 viram
T-F).

### 9. Armadilhas para o motor de visão
- **O cinza de fundo é a decisão binária da arte inteira** e cai exatamente na
  zona cinzenta (0xB0). O motor **tem** que abrir exceção humana nesta faixa —
  errar aqui muda o orçamento em 2 dias.
- **Dois arquivos do mesmo cliente com cinzas diferentes**: o motor precisa
  comparar fundo entre vistas do mesmo job e levantar alerta de inconsistência.
- **Low-poly sobre-segmenta**: 58 triângulos viram 58 regiões; o motor deve
  **agrupar por cor** antes de contar elementos, ou vai reportar 58 elementos e
  58 estratégias.
- **Antialias entre azuis vizinhos** cria uma 4ª e 5ª cor fantasma nas arestas
  compartilhadas — exatamente onde as fronteiras T-T são medidas.
- **As falhas internas do letreiro "PESCADOS"** (pincel seco) são lidas como ruído
  a limpar. **Não são** — são o desenho, e são justamente o que torna o corte
  manual barato.
- **ΔE baixo entre azul-marinho tipográfico e azul escuro do low-poly**: são duas
  tintas distintas que o clusterizador vai fundir — e fundi-las apaga a
  descoberta mais valiosa da arte (que elas não se tocam).

### 10. Correções à análise antiga
A análise antiga desta arte está em `analysis_A.md §3` (não em `analysis_E.md`).

1. **"impressão digital só se prazo apertar (pintado dura mais)"** — ERRADO por
   definição. Impressão não é alternativa à pintura em nenhum cenário de prazo.
   Adesivo só existe como máscara.
2. **"fonte manuscrita → plotter reproduz, jamais fita"** — o raciocínio parte da
   premissa errada de que a alternativa a "plotter" é "fita". A alternativa
   correta e preferida é **corte manual in situ** (§3.1). O letreiro de pincel de
   51 cm é o caso mais favorável possível ao estilete.
3. **"textos finos <8–10 mm → vinil aplicado"** — ERRADO: não existe "vinil
   aplicado" como acabamento. Nesta arte o menor texto tem ~13,5 cm, não 8 mm; o
   erro veio de não converter px→cm com a escala do implemento.
4. **"triângulos: retas → máscaras sequenciais por tom (cura 3h entre tons)"** —
   parcialmente certo, mas a análise não mediu **quais** tons se tocam nem qual
   cobre mais, e por isso não conseguiu ordenar as três máscaras. A ordem correta
   é claro → escuro → médio.
5. **Omissão grave**: a análise antiga não percebeu que **o azul-marinho
   tipográfico não toca nenhum azul do low-poly**. Essa é a economia de sessão
   mais óbvia da arte (§6.4) e ela cobrou um dia a mais por não vê-la.
6. **"Não existe T-F (pintura geral)"** — isso está **certo** e é o único ponto da
   análise antiga que sobrevive intacto.

---

# 2. 137 PESCADOS — traseira

### 1. Implemento e substrato provável
Traseira quase quadrada (1,01:1, ~2,50 × 2,48 m) do mesmo baú ⇒ **ISOPLASTIC**,
**portas duplas**. A costura vertical das portas cai no eixo x = 125 cm.
Substrato manda o mesmo que na lateral: lixar janelas, verniz poliéster; fita
irrelevante (não há faixas).

### 2. Fundo
Cinza cobrindo ~92%. **PINTURA GERAL CINZA.** Mesma pendência de tom da lateral —
aqui o cinza é visivelmente **mais escuro** (~#8B9091 contra ~#B0B0B4). Um dos
dois arquivos está errado; **os dois lados do mesmo veículo não podem sair em
cinzas diferentes**.

Nenhuma chapa branca sobra — **exceto**, e este é o achado de produção da arte, se
a bandeira for executada como reserva (ver §5/§7).

### 3. Inventário de elementos
- (a) **"www.137pescados.com"** (note: **sem o `.br`** que existe na lateral —
  divergência de conteúdo entre vistas, confirmar) + glifo Instagram +
  **"137pescados"**, marinho, topo-esquerda.
- (b) Script **"…us seja sempre louvado"** topo-direita — **CORTADO NA BORDA DO
  ARQUIVO**. Falta o "De". **A arte está incompleta**; não é um efeito de sangria,
  é truncamento. Bloqueante para produção.
- (c) **"137"** serifada gigante, marinho. ~55 cm de altura.
- (d) **"PESCADOS"** letreiro de pincel, marinho. ~216 × 20 cm.
- (e) **Bandeira do Brasil** inferior-esquerda, ~49 × 23 cm: retângulo verde,
  losango amarelo, globo azul, faixa branca com **"ORDEM E PROGRESSO"** (~0,8 cm
  de altura de letra) e **27 estrelas brancas de 1–3 mm**.
- (f) **Cluster low-poly** inferior-direito, ~86 × 87 cm, ~25 triângulos nos mesmos
  3 azuis, sangrando pela borda direita e inferior.

### 4. Paleta
Cinza, azul-marinho, 3 azuis do low-poly (idênticos à lateral), **verde-bandeira**,
**amarelo-bandeira**, **azul-bandeira** (um 4º azul, distinto dos 3 do low-poly e
do marinho — **5 azuis diferentes na mesma vista**). Todas chapadas; zero degradê.

### 5. Fronteiras T-T

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | marinho × cinza (toda a tipografia) | ~2.600 cm | média (serifas/curvas), suave nas hastes | cinza |
| 2 | azul médio × cinza | ~600 cm | reta | cinza |
| 3 | azul escuro × cinza | ~320 cm | reta | cinza |
| 4 | azul claro × cinza | ~240 cm | reta | cinza |
| 5 | azul médio × azul escuro | ~290 cm (≈14 arestas de 10–25 cm) | reta | azul médio |
| 6 | azul médio × azul claro | ~180 cm | reta | azul médio |
| 7 | azul escuro × azul claro | ~110 cm | reta | azul escuro |
| 8 | verde-bandeira × cinza | ~144 cm (perímetro do retângulo 49×23) | **reta** | cinza |
| 9 | verde × amarelo (losango) | ~88 cm (4 lados de 22 cm) | **reta** (diagonais) | verde (767 cm² × 183 cm² do amarelo) |
| 10 | amarelo × azul-bandeira (globo) | ~47 cm (circunferência de Ø15 cm) | **fechada** (raio 7,5 cm) | amarelo |

**Não se tocam (⇒ mesma sessão):**
- azul-marinho tipográfico × qualquer um dos 3 azuis do low-poly (o "S" final de
  PESCADOS morre ~40 cm à esquerda do triângulo mais alto do cluster).
- bandeira × low-poly (separados por ~90 cm de cinza).
- bandeira × tipografia marinho.
- Ou seja: **marinho, verde e o trio low-poly formam três ilhas independentes.**

**Reserva branca — o truque que apaga fronteiras:** se o retângulo da bandeira for
**mascarado antes do cinza geral**, ele fica sendo chapa branca original. Então a
faixa "ORDEM E PROGRESSO" e as 27 estrelas **não precisam de tinta branca nenhuma**
— são chapa preservada, e viram fronteiras **T-F** (grátis). O que **não** some é a
fronteira #8 (verde × cinza no perímetro do retângulo), a menos que o cliente
aceite uma margem branca de 2 cm em volta da bandeira — que a converteria em duas
T-F e zeraria o custo dela também. **Recomendar essa margem ao cliente.**

### 6. Ordem de pintura
1. **Máscara de reserva** do retângulo da bandeira, na chapa nua.
2. **Cinza geral** (§6.2), cura overnight. Remover a reserva da bandeira.
3. Dentro da bandeira, aplicando §2 estritamente pelas áreas medidas:
   **azul-bandeira** (177 cm²) → mascara → **amarelo** (183 cm² líquidos) →
   mascara → **verde** (767 cm²). Azul e amarelo estão praticamente empatados;
   qualquer das duas ordens serve, mas **verde é inequivocamente o último**.
4. Low-poly: **azul claro** → **azul escuro** → **azul médio** (§2, mesma lógica
   da lateral).
5. **Azul-marinho** tipográfico: junto com o passo 3 ou 4 — não toca nada.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (c) "137" 55 cm | **CORTE_MANUAL** | Serifada grande; serifas de ~1,5 cm são o menor detalhe. Cortável. |
| (d) "PESCADOS" 20 cm de pincel | **CORTE_MANUAL** | Contorno não-conferível (traço de pincel). |
| (a) www + @ + glifo, ~7 cm de letra | **CORTE_MANUAL** | Grotesca bold de 7 cm; contra-formas de ~1,2 cm. No limite, mas cortável. O glifo do Instagram (quadrado arredondado + anel + ponto) é geometria pura. |
| (b) script truncado | **BLOQUEADO** | Não estrategiar antes de receber o arquivo íntegro. |
| (f) low-poly, 25 triângulos de 10–25 cm | **CORTE_MANUAL** (3 máscaras sequenciais) | Retas puras. |
| (e) bandeira — retângulo verde + losango amarelo | **CORTE_MANUAL** | Um retângulo de 49×23 e um losango de 4 lados retos. |
| (e) globo azul Ø15 cm | **CORTE_MANUAL** | Um círculo de 15 cm de diâmetro corta-se com compasso de lâmina. |
| (e) **faixa "ORDEM E PROGRESSO" (letra 0,8 cm) + 27 estrelas de 1–3 mm** | **PENDÊNCIA — ver abaixo** | Nem corte manual (0,8 cm é metade do limiar) nem máscara de máquina (depilar estrela de 2 mm em vinil de máscara arrebenta na remoção). |

> **PENDÊNCIA #1 — miolo do globo da bandeira.** Um globo de 15 cm com 27 estrelas
> de 1–3 mm e 17 caracteres de 8 mm não é cortável à mão nem depilável à máquina.
> Opções para o dono, em ordem de custo:
> (i) **simplificar** — globo azul chapado, faixa branca reservada em chapa, sem
> micro-texto e sem estrelas (o cliente aprova quase sempre; a bandeira lê a 3 m
> de distância do mesmo jeito);
> (ii) **pintura artística à mão** — as estrelas a pincel fino em branco... **não
> é possível**, branco não é tinta; teria de ser reserva de chapa, ou seja,
> mascarar 27 pontos de 2 mm à mão;
> (iii) **aerografia com estêncil solto** para o globo, mesmo problema nas estrelas.
> **Recomendação técnica: (i).** É a única saída que respeita "branco é chapa".

### 8. Sequência de sessões e dias
A traseira entra **dentro do ciclo das laterais** — mesmas tintas, mesmas curas.

- **Dia 1** — prep. Empapelar dobradiças, fechos, borrachas de vedação, lanternas,
  para-choque e a zona de placa. Máscara de reserva da bandeira. Lixar (isoplastic).
- **Dia 2** — cinza geral; cura overnight.
- **Dia 3** — Sessão B: marinho (tipografia) + azul claro (low-poly) + azul-bandeira
  (globo) — **as três não se tocam entre si**, uma só sessão. Sessão C: azul escuro
  + amarelo da bandeira (também não se tocam). Sessão D: azul médio + verde da
  bandeira (não se tocam).
- **Dia 4** — retoques, verniz poliéster, cura.

**+0,5 a 1 dia** sobre o ciclo das laterais (não é um job separado).

**Emenda de portas:** a costura em x = 125 cm corta **o "3" do "137"** e passa
entre o "S" e o "C" de "PESCADOS". Exige alinhamento das duas folhas fechadas
durante todo o corte e uma perda planejada de 1–2 mm no vão. Sem isso, o "3" sai
degrauzado.

### 9. Armadilhas para o motor de visão
- **Arte truncada na borda direita** — o motor precisa detectar glifo cortado no
  limite do canvas e **abortar**, não completar por interpolação.
- **Divergência de conteúdo entre vistas** (`.com` vs `.com.br`) — só detectável
  comparando OCR entre arquivos do mesmo job.
- **5 azuis distintos** na mesma vista, três deles com ΔE baixíssimo — a
  clusterização vai colapsar para 2 ou 3 e destruir tanto a lista de compra de
  tinta quanto a contagem de T-T.
- **A bandeira é uma armadilha de escala**: 49 cm de largura no implemento, mas
  ~300 px no render. O motor lê "muitos detalhes ⇒ complexo" quando o problema
  real é "detalhes de 2 mm ⇒ impossível". Sem px→cm, o diagnóstico é o inverso do
  correto.
- **Branco dentro do globo**: o motor vai chamar de "cor branca" e propor tinta
  branca. Tem de resolver para "chapa reservada" e propagar a exigência de máscara
  **anterior à pintura geral**.
- **O vão das portas não existe no arquivo** — a traseira é sempre 2 metades.

### 10. Correções à análise antiga
`analysis_A.md §4`:

1. **"globo+estrelas → impresso"** — ERRADO, e é exatamente o erro que a doutrina
   nomeia no §0. Não existe impresso. O globo é pintado; as estrelas e a faixa são
   **chapa reservada**; e se não for exequível, o caminho é **simplificar o
   desenho**, não imprimi-lo.
2. **"retângulo verde e losango amarelo por máscara/fita (retas)"** — a menção a
   "fita" está fora de lugar: fita é para **faixas** (§4), não para o contorno de
   um losango de 22 cm. E a análise não ordenou as três cores da bandeira por
   área, que é o que a §2 exige (a ordem correta é azul → amarelo → verde).
3. **"Tudo T-T"** — verdadeiro **só se** a bandeira não for reservada. A análise
   antiga não enxergou a reserva de chapa como técnica, porque operava com "branco
   = cor de tinta". Com reserva, 10 pares caem para 9 (e para 8 com margem branca).
4. **Omissão**: não notou que marinho, bandeira e low-poly formam **três ilhas que
   não se tocam** — 3 sessões em vez de 5.
5. **Acerto que se mantém**: sinalizar a arte cortada na borda e o vão central
   cortando o "137".

---

# 3. 2 amigos 15 — lateral (direita)

### 1. Implemento e substrato provável
Lateral de baú de **15 m** (o nome do arquivo dá a medida), proporção 5,52:1 ⇒
~15,00 × 2,72 m. Cliente é **frutícula** (morango) — pode ser carga seca com
frisos verticais **ou** refrigerado isoplastic. O arquivo não mostra nenhum friso,
mas mockups raramente mostram.

**Esta é a única arte do slice em que o substrato muda a técnica**, porque ela tem
faixas (os swooshes) e a §4 é decidida pelo substrato:

| Se o substrato for | Fita | Consequência nos swooshes |
|---|---|---|
| ISOPLASTIC / LONA | **FITA_AMARELA** | Faz o gancho curvo da ponta esquerda **sem corte**; só as pontas afiladas pedem lâmina. |
| CHAPA (carga seca) | **FITA_BRANCA** | Não faz a curva do gancho ⇒ o gancho inteiro vira corte manual, e a fita branca larga ainda exige corte na aresta. |

**Perguntar ao cliente antes de orçar.** A diferença é de ~4 h de corte por lado.

### 2. Fundo
Chumbo/grafite quase-preto (~#3A3A3A) cobrindo ~80%. **PINTURA GERAL ESCURA.**
Zero chapa branca — **inclusive o texto de rodapé "branco" não pode ser tinta
branca: é chapa preservada**, e portanto exige máscara de reserva **antes** da
pintura geral chumbo, ou fica impossível.

> **Consequência dura, que a análise antiga não tirou:** num fundo escuro geral,
> **todo elemento branco vira uma reserva planejada no passo 1**. Não dá para
> "pintar o branco depois". Isso reordena o cronograma inteiro.

> **PENDÊNCIA DE TOM:** este lado é chumbo (#3A3A3A) e o outro arquivo
> ("2 amigos.jpg") é **preto puro (#000)**. Definir uma cor só.

### 3. Inventário de elementos
- (a) **Swoosh superior**: filete cinza-claro/prata, ~1.017 cm de extensão, ~9 cm
  de espessura, retilíneo, com **gancho curvo de raio ~37 cm** na ponta esquerda
  descendo em vertical, e **ponta afilada** (bico) na direita.
- (b) **Swoosh inferior**: paralelo ao anterior, ~1.000 cm, ~7,5 cm de espessura,
  mesmo gancho e mesma ponta afilada.
- (c) Terceiro traço curto vertical na extremidade esquerda, ~84 cm, formando a
  "moldura" com os ganchos.
- (d) **"Frutícula 2 Amigos"** em script caligráfico prata, **~862 × 103 cm** —
  o maior elemento tipográfico do slice. Degradê vertical **sutil** (prata claro em
  cima → cinza médio embaixo). Hastes de ligação de ~5 cm.
- (e) Rodapé: **"www.fruticula2amigos.com.br"** e **"(61) 3461-3666 / 99556-5262"**
  em branco, ~19 cm de altura.
- (f) **BLOCO FOTOGRÁFICO** à direita, **~487 × 272 cm** (4,9 × 2,7 m — ocupa a
  altura inteira do baú): dois morangos hiper-realistas em composição de coração
  (aquênios individuais, gotas, reflexos especulares, cálices verdes com folhas
  serrilhadas e sombra própria) **atravessados por uma fita/banner dourado com
  dobras, enrolamento nas pontas e sombreamento volumétrico**, trazendo
  **"Frutícula"** em script escuro e **"2amigos"** em script vermelho com contorno.

### 4. Paleta
- **Chapadas:** chumbo (fundo), prata/cinza-claro (swooshes), branco (= chapa
  reservada, não é tinta).
- **Degradê:** o script (d) tem rampa vertical **sutil** — recomendação: **achatar
  para um prata único**; a rampa é imperceptível a 3 m e custa uma sessão de
  aerografia de 8,6 m de extensão.
- **Gama fotográfica completa:** vermelhos (do escarlate ao bordô nas sombras),
  verdes (2–3 tons no cálice), dourados (ouro claro → âmbar → marrom nas dobras),
  brancos especulares. **Não quantificável em número de cores** — é o bloco (f).

### 5. Fronteiras T-T
Com pintura geral, **nenhuma fronteira T-F existe** nesta arte.

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | prata × chumbo (swoosh sup., 2 bordas) | ~2.050 cm | **reta** em ~95% do percurso; **média** no gancho (raio 37 cm); **extrema** nos 2 bicos afilados (raio < 1 cm) | chumbo |
| 2 | prata × chumbo (swoosh inf., 2 bordas) | ~2.020 cm | idem | chumbo |
| 3 | prata × chumbo (traço vertical c) | ~180 cm | reta | chumbo |
| 4 | prata × chumbo (script "Frutícula 2 Amigos") | ~4.400 cm | **fechada** — script caligráfico com laçadas, raio mín. ~3 cm nos olhais do "a"/"g" | chumbo |
| 5 | branco(chapa) × chumbo (rodapé) | ~1.100 cm | média | chumbo — **mas é T-F por reserva**, ver nota |
| 6 | vermelho-morango × chumbo | ~700 cm (silhueta dos dois morangos) | **fechada/extrema** (aquênios e ponta do fruto) | chumbo |
| 7 | verde-cálice × chumbo | ~450 cm (folhas serrilhadas) | **extrema** (serrilha de ~2 cm) | chumbo |
| 8 | dourado-fita × chumbo | ~900 cm (bordas e enrolamentos) | **média/fechada** nos enrolamentos | chumbo |
| 9 | dourado × vermelho-morango | ~500 cm (a fita cruza os dois frutos) | **suave** | vermelho |
| — | vermelho × verde (fruto × cálice) | ~380 cm | **extrema** | vermelho |
| — | dourado × vermelho-script ("2amigos") | ~420 cm | **fechada** | dourado |
| — | dourado × marrom-dobra (sombra interna) | ~300 cm | suave | dourado |

Conto **9 pares de cores** (as três últimas linhas são fronteiras **internas ao
bloco fotográfico** e, se ele for aerografado, não são fronteiras mascaradas mas
transições de pistola — por isso não somam pares independentes).

**Nota sobre a #5:** se o rodapé branco for executado como **reserva de chapa**
(única forma válida — branco não é tinta), a máscara é aplicada **antes** do chumbo
e a fronteira, apesar de gerar trabalho de corte, é tecnicamente T-F. Ela custa
corte de máscara, mas não custa **proteção de uma cor já pintada** — que é o que a
§1 mede.

**Não se tocam (⇒ mesma sessão):**
- swooshes × script (separados por ~30 cm de chumbo em toda a extensão)
- swooshes × rodapé branco
- script × rodapé branco (~15 cm de folga)
- **bloco fotográfico × todo o resto** (o script termina ~50 cm antes do primeiro
  morango)
⇒ **prata (swooshes + script) e branco (rodapé) podem sair na mesma sessão**, e o
bloco fotográfico é um job paralelo independente.

### 6. Ordem de pintura
1. **Reserva de chapa** do rodapé (máscara de máquina ou corte manual sobre a
   chapa nua) — obrigatório antes de qualquer tinta.
2. **Chumbo geral** (§6.2). Cura overnight.
3. Remover reserva do rodapé.
4. **Prata** (swooshes + script) — sessão única; a prata é minoria absoluta de
   área contra o chumbo, mas o chumbo já existe como fundo, então §2 não se aplica
   entre eles: aplica-se §6.2 (fundo primeiro, elementos depois).
5. **Bloco fotográfico** por último, sobre chumbo curado. Dentro dele, §2 vale
   par a par: **verde-cálice** (menor) → **dourado** → **vermelho** (maior). Na
   prática, se a decisão for aerografia, a ordem é a do artista (fundo do fruto →
   sombras → aquênios → especulares) e não a de máscaras.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (a)(b) swooshes retos de 10 m, 7–9 cm de espessura | **FITA_AMARELA** se isoplastic/lona; **FITA_BRANCA** se chapa (§4) | 10 m de reta é exatamente o caso de fita. Nenhuma máscara vale 10 m de vinil para desenhar um filete. |
| ganchos curvos (raio 37 cm) das pontas esquerdas | **FITA_AMARELA** (isoplastic) ou **CORTE_MANUAL** (chapa) | A amarela faz raio de 37 cm sem cortar. A branca não faz — cai para estilete. |
| bicos afilados das pontas direitas | **CORTE_MANUAL** (em qualquer cenário) | Um afilamento de raio < 1 cm nenhuma fita reproduz; são 2 cortes de ~15 cm por swoosh. |
| (c) traço vertical curto | **FITA_BRANCA** | Traçado **muito vertical** e reto — o caso literal da tabela do §4. |
| (d) script prata de 103 cm de altura | **CORTE_MANUAL** | Altura de letra de 1 metro. As laçadas mais fechadas têm raio de 3 cm. Qualquer pintor corta isso. Máscara de máquina seria 8,6 m de vinil para nada. |
| (e) rodapé branco 19 cm | **CORTE_MANUAL** (reserva) | 19 cm de altura, grotesca; contra-formas de ~3 cm. Cortável. Vai na chapa nua, antes do chumbo. |
| degradê sutil do script | achatar para prata única (recomendado) — ou aerografia dentro da máscara já cortada | 8,6 m de rampa de 5% de contraste não paga uma sessão de aerografia. |
| (f) **bloco fotográfico 4,9 × 2,7 m** | **PENDÊNCIA — ver abaixo** | Aquênios de 1 cm, gotas, especulares, dobras com sombra. Nem estilete nem máquina. |

> **PENDÊNCIA #2 — bloco fotográfico "morangos + banner dourado" (4,9 × 2,7 m).**
> A doutrina §0 nomeia esta arte explicitamente. Restam duas saídas, **ambas
> manuais**:
> (i) **Aerografia mural** — a escala favorece muito: 4,9 × 2,7 m é área de mural,
> e aerógrafo resolve aquênio, gota e especular sem máscara. É a rota que eu
> recomendo. Ordem de grandeza: 2 a 4 dias de aerografista **por lado**, não horas.
> (ii) **Pintura artística à mão** (pincel), mais lenta e mais dependente do
> artista, com a mesma ordem de grandeza ou maior.
> **O que NÃO é opção:** adesivo impresso recortado no contorno — foi exatamente
> o que a análise antiga propôs.
> **Decisão do dono é obrigatória antes de orçar** — muda o job de 4 para 8+ dias.

### 8. Sequência de sessões e dias

- **Dia 1** — Preparação pesada (fundo escuro denuncia qualquer falha): lavar,
  desengordurar, empapelar moldura, borrachas, ferragens; lixar se isoplastic;
  **cortar e aplicar a reserva de chapa do rodapé**; fundo/primer escuro.
- **Dia 2** — **Sessão A**: chumbo geral, 2–3 demãos (cobertura escura pede
  demão extra). Cura overnight. Registrar a fórmula da cor para retoque.
- **Dia 3** — **Sessão B** (única, cores que não se tocam): remover reserva do
  rodapé; fita nos swooshes + corte manual dos bicos; corte manual do script;
  pintar **prata** em tudo de uma vez.
- **Dias 4–7** — **Sessão C**: bloco fotográfico (aerografia), 2 a 4 dias por
  lado. **É o caminho crítico do job inteiro.**
- **Dia 8** — verniz geral, cura; refletiva de alto contraste sobre o escuro;
  desempapelamento.

**~8 dias por lado**, ou **~10–11 dias para o par**, dominado pela pendência #2.
Se o dono decidir **substituir o bloco fotográfico por uma versão vetorizada
chapada** (morango estilizado + fita chapada), o job cai para **~4 dias no par**.
Essa é a conversa comercial que precisa acontecer.

### 9. Armadilhas para o motor de visão
- **Fundo quase-preto × sombra de mockup**: o motor precisa não confundir a
  vinheta de apresentação com uma segunda cor escura.
- **O mesmo cliente tem chumbo num arquivo e preto puro no outro** — alerta de
  inconsistência obrigatório.
- **Bloco fotográfico = alta entropia local.** O motor deve isolá-lo e **parar**:
  não quantizar, não contar fronteiras, não propor estratégia. Emitir PENDÊNCIA.
  (E jamais rotulá-lo como "impressão digital", que era o comportamento antigo.)
- **O degradê sutil do script** dispara falso positivo de "elemento com degradê ⇒
  aerografia"; o motor precisa de um limiar de **amplitude** da rampa, não só de
  detecção de rampa.
- **Os bicos afilados dos swooshes** são raio quase-zero em elementos que, no
  agregado, o motor classificaria como "reta ⇒ fita". A curvatura tem de ser
  reportada como **histograma ao longo da fronteira**, não como um valor único —
  senão os 10 m de reta escondem os 15 cm que exigem estilete.
- **Branco no fundo escuro**: o motor tem de propagar "branco = reserva" para
  **antes** da pintura geral. Um pipeline que ordena camadas por "fundo primeiro,
  elementos depois" coloca o rodapé branco no lugar errado do cronograma.

### 10. Correções à análise antiga
`analysis_A.md §5`:

1. **"morangos+banner = IMPRESSÃO DIGITAL recortada no contorno, aplicada sobre
   verniz curado"** — **o erro central da análise antiga**, citado na doutrina §0.
   Não existe painel impresso. O bloco é PENDÊNCIA (aerografia × pintura à mão).
2. **"(aerografia reproduziria, mas custo/tempo proibitivos para 2 lados)"** —
   raciocínio invertido: aerografia não é a alternativa cara ao impresso; é uma
   das **duas únicas** rotas possíveis. O custo é o custo do produto, e é
   exatamente isso que precisa ir para o orçamento.
3. **"D5 aplicação do painel impresso"** e **"impressão em paralelo"** — linhas de
   cronograma inteiras baseadas num passo que não existe. O caminho crítico real é
   a aerografia, e ele é 3–8× mais longo.
4. **"textos por recorte branco"** — ERRADO duas vezes: (a) não existe tinta
   branca; (b) o rodapé branco tem de ser **reserva de chapa aplicada antes do
   chumbo**, não uma camada aplicada depois. A análise antiga colocou-o no Dia 3,
   quando ele pertence ao Dia 1.
5. **"script×chumbo = T-T fechada (cura+adesivo — corte inviável)"** — ERRADO na
   escala: o script tem **103 cm de altura de letra**; o raio mínimo é de 3 cm.
   É trivialmente cortável à mão (§3.1). A análise antiga não converteu px→cm.
6. **"swooshes por fita amarela flexível ou recorte"** — a escolha não é
   discricionária: é **determinada pelo substrato** (§4), e a análise não
   perguntou qual é.
7. **Omissão**: não notou que swooshes, script e rodapé **não se tocam** ⇒ uma
   sessão só (§6.4), e que o bloco fotográfico é um job **paralelo**.

---

# 4. 2 amigos — lateral (esquerda)

### 1. Implemento e substrato provável
**ALERTA DE IDENTIDADE DO IMPLEMENTO:** a análise antiga tratou este arquivo como
"a lateral esquerda do mesmo baú de 15 m". **A proporção não permite isso.**
Este arquivo é **2,94:1**; o "2 amigos 15" é **5,52:1**. Se ambos fossem o mesmo
baú de 15 m, este teria 5,10 m de altura. É outro implemento — muito provavelmente
um **truck de ~8,00 × 2,70 m** (8,00/2,70 = 2,96 ✓), ou um recorte parcial da
lateral.

Substrato: mesma indeterminação da arte 3 (frutícula ⇒ chapa ou isoplastic).
Mesma consequência de §4 nos swooshes.

### 2. Fundo
**Preto puro (#000)** cobrindo ~78%. **PINTURA GERAL PRETA.** Zero chapa branca —
e portanto, de novo, **todo branco é reserva planejada antes da pintura geral**.

O outro lado é chumbo (#3A3A3A). **Definir uma cor única para o veículo.**

### 3. Inventário de elementos
- (a) **BLOCO FOTOGRÁFICO** à esquerda, ~330 × 220 cm: os mesmos dois morangos
  hiper-realistas com a fita dourada, agora **espelhados em posição** (a
  composição migrou para a esquerda). Fita traz **"Frutícula"** (script escuro) e
  **"2amigos"** (script vermelho).
- (b) **"Cultivando o melhor para você!"** — script caligráfico prata/branco,
  centro, ~420 × 37 cm. **Lê corretamente** (não está espelhado).
- (c) Rodapé: **"www.fruticula2amigos.com.br"** e **"(61) 3461-3666 / 99556-5262"**
  — **ESPELHADOS** (ilegíveis, escritos ao contrário no arquivo). ~10 cm de altura.
- (d) **Swoosh superior** prata à direita, ~500 cm, ~6 cm de espessura, com gancho
  curvo descendo na extremidade **direita**.
- (e) **Swoosh inferior** prata, ~470 cm, idem.
- (f) Traço vertical curto prata na extremidade direita.

### 4. Paleta
Preto (fundo), prata/cinza-claro, branco (= chapa reservada) + gama fotográfica
completa no bloco (a). Mesmas cores do lado direito.

### 5. Fronteiras T-T
Sem chapa branca aparente ⇒ tudo T-T (exceto o que for reserva).

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | prata × preto (swoosh sup.) | ~1.010 cm | reta em 90%; média no gancho (raio ~25 cm); extrema no bico | preto |
| 2 | prata × preto (swoosh inf.) | ~950 cm | idem | preto |
| 3 | prata × preto (traço vertical f) | ~120 cm | reta | preto |
| 4 | prata × preto (script "Cultivando…") | ~1.900 cm | **fechada** (laçadas, raio mín. ~2 cm) | preto |
| 5 | branco(chapa) × preto (rodapé) | ~600 cm | média | preto — **T-F por reserva** |
| 6 | vermelho-morango × preto | ~520 cm | fechada/extrema | preto |
| 7 | verde-cálice × preto | ~330 cm | **extrema** (serrilha ~1,5 cm) | preto |
| 8 | dourado-fita × preto | ~680 cm | média/fechada nos enrolamentos | preto |
| 9 | dourado × vermelho-morango (a fita cruza os frutos) | ~360 cm | suave | vermelho |

Internas ao bloco fotográfico (não contam como pares mascarados se for aerografia):
vermelho × verde (~280 cm, extrema), dourado × vermelho-script (~300 cm, fechada),
dourado × marrom-dobra (~220 cm, suave).

**Não se tocam (⇒ mesma sessão):** swooshes × script (~35 cm de folga);
script × rodapé (~20 cm); bloco fotográfico × todo o resto (~40 cm até a primeira
letra do script).

### 6. Ordem de pintura
1. **Reserva de chapa** do rodapé — **depois de corrigir o espelhamento** (ver §7).
2. **Preto geral** (§6.2), cura overnight. Preto puro pede demão extra e superfície
   impecável (cobre menos falhas que qualquer outra cor).
3. Remover a reserva.
4. **Prata** — swooshes + script + traço vertical, **sessão única** (não se tocam).
5. **Bloco fotográfico** por último, sobre preto curado.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (d)(e) swooshes de ~5 m, 6 cm | **FITA_AMARELA** (isoplastic/lona) ou **FITA_BRANCA** (chapa) — §4 | 5 m de reta; nenhuma máscara compete com fita. |
| ganchos curvos (raio ~25 cm) | **FITA_AMARELA** ou **CORTE_MANUAL** conforme substrato | Raio de 25 cm: a amarela faz; a branca não. |
| bicos afilados | **CORTE_MANUAL** | Raio < 1 cm. |
| (f) traço vertical | **FITA_BRANCA** | Traçado vertical reto — caso literal do §4. |
| (b) script "Cultivando o melhor para você!" 37 cm | **CORTE_MANUAL** | 37 cm de altura de letra; laçadas de raio 2 cm. Cortável, ainda que mais lento que o script de 1 m do outro lado. |
| (c) rodapé 10 cm — **espelhado** | **BLOQUEADO até correção**; depois **CORTE_MANUAL** (reserva) | 10 cm de altura com contra-formas de ~1,5 cm é o limite inferior do estilete, mas passa. **Não cortar nada antes de o designer devolver o texto legível.** |
| (a) **bloco fotográfico 3,3 × 2,2 m** | **PENDÊNCIA** (mesma da arte 3) | Aerografia mural × pintura artística à mão. Nunca impresso. |

> **Bloqueio de produção:** o arquivo tem **espelhamento seletivo** — a composição
> e os swooshes estão espelhados (correto: eles devem apontar para a frente nos
> dois lados), o slogan foi **corrigido de volta** para legível, mas o rodapé de
> contato **ficou espelhado**. Isso não é um "preview": é um arquivo meio-corrigido.
> Texto **nunca** espelha. Devolver ao designer.

### 8. Sequência de sessões e dias
- **Dia 1** — prep; corrigir arquivo; cortar e aplicar reserva do rodapé; primer.
- **Dia 2** — preto geral (3 demãos; preto puro é implacável com preparação).
  Cura overnight.
- **Dia 3** — sessão única de prata (fita nos swooshes + corte dos bicos + corte
  do script).
- **Dias 4–6** — bloco fotográfico por aerografia (área 55% menor que a do lado
  direito ⇒ ~2–3 dias).
- **Dia 7** — verniz, refletiva de alto contraste, desempapelamento.

**~7 dias**, dominado pela pendência. Se este for de fato **outro veículo** (e não
o outro lado do mesmo baú), **não há economia de ciclo de cura compartilhado** com
a arte 3 — o que a análise antiga assumiu e que provavelmente é falso.

### 9. Armadilhas para o motor de visão
- **Espelhamento seletivo**: um validador que só compara "OCR normal × OCR
  invertido" **na imagem inteira** conclui "arquivo espelhado" e espelha tudo de
  volta — quebrando o slogan que já estava certo. O teste tem de ser **por bloco
  de texto**.
- **Proporção incompatível entre os dois "lados"**: o motor deve comparar as
  proporções de arquivos do mesmo job e recusar a hipótese "lado A / lado B"
  quando divergem em 88%.
- **Preto puro (#000) versus sombra de mockup** — em preto puro o motor não
  consegue distinguir borda de silhueta; a silhueta dos elementos escuros do bloco
  fotográfico (o "Frutícula" escuro na fita) desaparece contra o fundo em qualquer
  limiar.
- Demais armadilhas idênticas às da arte 3.

### 10. Correções à análise antiga
`analysis_A.md §6`:

1. **"Imprimir 2 painéis de morango (posições espelhadas)"** — ERRADO. Não existe
   painel impresso; são dois blocos **pintados** (aerografia ou pincel), e cada um
   é dias de trabalho, não uma aplicação.
2. **"Lateral oposta do mesmo baú"** — provavelmente ERRADO: as proporções (2,94:1
   × 5,52:1) indicam **implementos diferentes**. Toda a economia de "mesmo ciclo de
   cura das duas laterais" que a análise antiga contabilizou pode não existir.
3. **"slogan branco chapado (recorte)"** — ERRADO: o slogan é **prata/cinza-claro**,
   não branco, e além disso a análise trata "branco" como uma tinta aplicável. Em
   fundo preto geral, branco só existe como **reserva anterior à pintura geral**.
4. **"Site e telefones espelhados = preview de aplicação invertida"** — diagnóstico
   incompleto. O espelhamento é **seletivo** (o slogan está correto), o que
   caracteriza um arquivo parcialmente corrigido — mais perigoso que um preview
   inteiro espelhado, porque um "desespelhar tudo" quebra o que estava bom.
5. **"Mesmo cronograma"** — o cronograma antigo (4–5 dias) não continha o custo
   real do bloco pintado.

---

# 5. 3 IRMÃOS 8,40 — lateral

### 1. Implemento e substrato provável
Lateral de truck de **8,40 m**; proporção do arquivo 3,50:1, que bate **exatamente**
com 8,40 × 2,40 m — a escala do arquivo é confiável (é a única arte do slice com
essa confirmação).

Frigorífico de suínos ⇒ **ISOPLASTIC** provável (baú refrigerado liso). Consequência:
**lixar as janelas da máscara** antes de pintar e verniz poliéster no fechamento.
Quanto à §4: **esta arte não tem nenhuma faixa** — não há fita a escolher. O
substrato aqui só decide preparação, não técnica de desenho.

### 2. Fundo
**Chapa branca original, ~88%. SEM pintura geral.** O leve degradê cinza nas
extremidades do arquivo é **vinheta de mockup**, não tinta: ele é radial, centrado
na arte, e não respeita nenhuma geometria do implemento.

Este é o caso base mais barato da doutrina: **elementos sobre chapa**, quase tudo
T-F, e **todo o branco do desenho (o "3", "IRMÃOS", o texto do brush) é chapa
preservada** — nenhuma tinta branca em lugar nenhum.

### 3. Inventário de elementos
- (a) **Arco dourado** superior do logo: banda curva de ~273 cm de largura e ~30–40
  cm de altura, com **degradê horizontal** (ouro escuro nas pontas → ouro claro no
  centro → ouro escuro).
- (b) **"3"** com corpo **branco (chapa)** e **contorno dourado de ~5 cm**,
  ~68 × 68 cm, montado sobre o arco e transbordando para cima dele.
- (c) **Escudo hexagonal vermelho/bordô** (~268 × 79 cm) sob o arco, com leve
  degradê radial (quase chapado).
- (d) **"IRMÃOS"** em caps grotescas condensadas **brancas (chapa)** dentro do
  escudo; altura ~45 cm; com til sobre o "A".
- (e) **"FRIGORÍFICO"** em caps espacejadas douradas com degradê, em arco suave,
  ~163 × 26 cm, abaixo do escudo, **sem tocar nada**.
- (f) **Pincelada vermelha** à direita: retângulo de traço de pincel ~367 × 94 cm,
  com bordas rasgadas/farpadas (dezenas de farpas de 1–3 cm) e ponta seca à direita.
- (g) **"Qualidade e Procedência no Abate de suínos."** em duas linhas, caps e
  minúsculas grotescas bold **brancas (chapa)**, ~16 cm de altura, dentro da
  pincelada.
- (h) **Selo SISBI** inferior-direita, ~118 × 42 cm: cinco blocos verdes com as
  letras S I S B I **brancas (chapa)**, ~10,5 cm; **micro-texto preto** acima
  ("SISTEMA UNIFICADO DE ATENÇÃO À SANIDADE AGROPECUÁRIA") e abaixo ("SISTEMA
  BRASILEIRO DE INSPEÇÃO DE PRODUTOS DE ORIGEM ANIMAL"), ~3,7 cm de altura,
  ~110 caracteres condensados no total.

### 4. Paleta

| Cor | Uso | Chapada / degradê |
|---|---|---|
| Ouro/dourado | arco, contorno do "3", "FRIGORÍFICO" | **degradê** horizontal no arco (amplitude alta, visível); degradê fraco nas letras |
| Vermelho-bordô | escudo + pincelada | quase chapado (degradê radial de baixa amplitude ⇒ **achatar**) |
| Verde-bandeira | blocos do SISBI | chapada |
| Preto | micro-texto do SISBI | chapada |
| **Branco** | "3", "IRMÃOS", texto do brush, letras do SISBI | **NÃO É TINTA — é chapa preservada** |

### 5. Fronteiras T-T
**Uma única.** Este é o resultado mais importante da arte.

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | **dourado (arco) × vermelho (escudo)** | **~270 cm** | **suave, quase reta** — corda de 273 cm com flecha de ~10 cm ⇒ raio de curvatura ≈ **930 cm** | **vermelho** (~50.000 cm² somando escudo + pincelada, contra ~11.000 cm² de dourado) |

**Todo o resto é T-F.** Verificado elemento por elemento:
- dourado do contorno do "3" × branco do miolo do "3" → **T-F** (branco = chapa).
- dourado do contorno do "3" × dourado do arco → **mesma cor, não é fronteira**.
- branco de "IRMÃOS" × vermelho do escudo → **T-F** (o branco é chapa reservada
  por máscara; o vermelho é pintado ao redor).
- branco do texto (g) × vermelho da pincelada → **T-F**, mesma lógica.
- pincelada (f) × chapa → **T-F** em todo o perímetro rasgado (~1.100 cm).
- "FRIGORÍFICO" (e) × chapa → **T-F**; não toca escudo nem arco (folga de ~13 cm).
- SISBI: verde × chapa → T-F; branco das letras × verde → T-F; preto do micro-texto
  × chapa → T-F. **O micro-texto preto não encosta nos blocos verdes** (folga de
  ~2 cm acima e abaixo) ⇒ **zero T-T no selo inteiro**.
- Logo × pincelada: separados por ~75 cm de chapa. **Não se tocam.**
- Pincelada × SISBI: separados por ~30 cm. **Não se tocam.**

### 6. Ordem de pintura
Um único par a ordenar, e ele resolve o cronograma inteiro:

1. **Dourado primeiro** (arco + contorno do "3" + "FRIGORÍFICO"): ~11.000 cm² é
   inequivocamente a menor cobertura contra os ~50.000 cm² de vermelho.
2. **Mascarar o arco dourado** ao longo dos 270 cm da fronteira #1 — curva de raio
   930 cm, ou seja, praticamente uma reta: máscara barata e rápida.
3. **Vermelho por cima** (escudo + pincelada, na mesma sessão — não se tocam entre
   si, mas são a mesma tinta).
4. **Verde e preto do SISBI**: não tocam nada ⇒ **mesma sessão do dourado**.

Se a ordem fosse invertida (vermelho primeiro), seria preciso mascarar 50.000 cm²
de vermelho para proteger 270 cm de fronteira — desperdício direto de máscara e
de tempo de corte. É o exemplo didático da §2.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (a) arco dourado, 273 × 35 cm | **CORTE_MANUAL** (máscara) + **aerografia** para preencher o degradê | Duas curvas suaves de 273 cm — o corte mais fácil da arte. A rampa horizontal de alta amplitude sobre 2,7 m é caso clássico de aerografia dentro da máscara já cortada. |
| (b) "3" 68 cm com contorno de 5 cm | **CORTE_MANUAL** | Um "3" de 68 cm com um anel de 5 cm de espessura: dois contornos concêntricos de curvas amplas. Estilete resolve. O miolo branco é chapa — só se deixa a máscara. |
| (c) escudo vermelho 268 × 79 cm | **CORTE_MANUAL** | Hexágono com lados levemente curvos. Trivial. Achatar o degradê radial. |
| (d) "IRMÃOS" branco 45 cm | **CORTE_MANUAL** (negativo/reserva) | 6 letras de 45 cm com contra-formas de ~8 cm. Cortar a máscara **em negativo** (mantendo as letras cobertas) e pintar o vermelho ao redor. |
| (e) "FRIGORÍFICO" 26 cm dourado | **CORTE_MANUAL** | 11 letras de 26 cm, espacejadas, sem contato entre si. Achatar o degradê (26 cm não sustenta rampa perceptível). |
| (f) pincelada vermelha com bordas rasgadas | **CORTE_MANUAL** | **Argumento decisivo: o contorno de uma pincelada não é conferível.** As farpas de 1–3 cm não têm posição "certa" — nenhum cliente compara com o arquivo. Cortar à mão livre acompanhando a máscara é mais rápido que mandar cortar 3,7 m de vinil na máquina e depilar as farpas. |
| (g) texto branco 16 cm dentro da pincelada | **CORTE_MANUAL** (negativo) | Grotesca bold de 16 cm; contra-formas de ~2,5 cm. Cortável, na mesma máscara da pincelada. |
| (h) SISBI — blocos verdes + letras brancas de 10,5 cm | **CORTE_MANUAL** | 5 retângulos e 5 letras grandes. Geometria simples. |
| (h) SISBI — **micro-texto preto de 3,7 cm, ~110 caracteres** | **MASCARA_MAQUINA (direto na chapa — sem ciclo de verniz)** | 3,7 cm de caps condensadas com hastes de ~5 mm, 110 vezes: **não é humanamente cortável** em tempo razoável (§3.2). Mas — e aqui está a economia — **este texto pousa sobre chapa nua**, não sobre tinta fresca: a máscara cortada a máquina entra direto, **sem envernizar e sem esperar cura**. Custa uma máscara, não um dia. |

**Nada de espovo:** nenhum elemento é simultaneamente gigante e de formato fácil.
O arco (273 cm) é grande, mas é uma curva única e a máscara sai mais barata que
furar kraft. **Nada de fita:** não há faixas.

### 8. Sequência de sessões e dias

- **Dia 1 — Sessão A**: lavar, empapelar molduras/frisos, borrachas, ferragens;
  **não pintar o aparelho de frio da testeira**; lixar as janelas (isoplastic).
  Aplicar máscara lisa sobre a laca original; cortar à mão: arco, "3",
  "FRIGORÍFICO", blocos do SISBI, letras do SISBI. Aplicar a máscara de máquina do
  micro-texto. Pintar **dourado** (aerografado no arco) + **verde** + **preto** —
  **as três não se tocam ⇒ uma sessão só** (§6.4).
- **Dia 1, tarde — Sessão B** (após a laca dourada secar ao toque, ~1 h):
  mascarar o arco dourado (270 cm de curva quase reta); cortar as máscaras
  negativas do escudo + "IRMÃOS" e da pincelada + seu texto; pintar **vermelho**
  em ambos.
- **Dia 2 — Sessão C**: desempapelar, retocar, **verniz poliéster geral**, cura;
  faixa refletiva de rodapé.

**~2 dias por lado; ~2,5 dias para o par de laterais** (mesmo ciclo).
Nenhuma cura overnight é obrigatória: a única fronteira T-T é resolvida por
máscara sobre laca seca ao toque, não por verniz.

### 9. Armadilhas para o motor de visão
- **A vinheta cinza do mockup** vai ser lida como "fundo cinza claro ⇒ pintura
  geral?". Cai na zona cinzenta de decisão e mudaria a arte de 2 para 4 dias.
  Sinal distintivo correto: a vinheta é **radial e centrada no canvas**, não
  alinhada a nenhuma aresta do implemento.
- **Branco como figura**: o motor vai detectar "branco" nas letras "IRMÃOS", no
  "3", no texto do brush e nas letras do SISBI e propor tinta branca. Todos são
  **chapa**. Regra dura: se a região branca é **topologicamente interna** a uma
  região colorida, é reserva — e o custo é de **máscara negativa**, não de camada.
- **O degradê dourado morre em ouro claro perto do branco** nas pontas do arco: o
  limiar perde a borda superior do arco e "corta" o "3". A silhueta tem de vir do
  vetor, não da cor.
- **Borda esfumada da pincelada**: o vetorizador gera centenas de polígonos-fiapo.
  O motor deve reconhecer "textura de pincel" e **baixar** a complexidade estimada
  (contorno não-conferível ⇒ corte livre), em vez de subir.
- **Micro-texto do SISBI** é o único elemento não-cortável da arte, e é ~0,25% da
  área. Um motor que decide estratégia por elemento dominante vai perdê-lo.
- **Dois dourados** (arco com rampa × letras de FRIGORÍFICO quase chapadas): não
  são duas tintas, são a mesma com tratamento diferente.

### 10. Correções à análise antiga
`analysis_A.md §7`:

1. **"SISBI → impresso"** — ERRADO (§0). O selo é pintado: verde chapado + letras
   brancas reservadas + micro-texto por **máscara cortada a máquina direto na
   chapa**. Nada é aplicado como acabamento.
2. **"alternativa: logo inteiro impresso"** — ERRADO pelo mesmo motivo, e
   desnecessário: o logo tem **uma** fronteira T-T de curvatura quase nula.
3. **"contorno fino dourado do '3' = T-T fechada (recorte fino; <6 mm → integrar
   ao impresso)"** — ERRADO em três níveis: (a) o contorno tem **5 cm**, não
   6 mm (erro de escala px→cm); (b) ele **não é T-T** — de um lado toca o branco
   da chapa (T-F) e do outro toca o próprio dourado do arco (mesma cor, não é
   fronteira); (c) "integrar ao impresso" não é uma saída existente.
4. **"arco dourado × faixa vermelha = T-T suave (fita OU dourado→cura→adesivo→
   vermelho)"** — a alternativa da fita está **errada**: fita é para faixas (§4),
   não para o contorno interno de um logo. E a análise não mediu qual cor cobre
   mais, portanto não justificou a ordem: o vermelho cobre ~4,5× a área do
   dourado, o que **prova** (não apenas sugere) a ordem dourado→vermelho.
5. **"Textos brancos = NEGATIVO T-F"** — **CORRETO**, e é o melhor insight da
   análise antiga. Vale registrar que ele sobrevive à revisão.
6. **Omissão**: não notou que **dourado, verde e preto não se tocam** ⇒ uma
   sessão só; nem que o micro-texto do SISBI, por estar sobre **chapa nua**,
   dispensa o ciclo de verniz do §3.2.

---

# 6. 3 IRMÃOS 8,40 — traseira

### 1. Implemento e substrato provável
Traseira quase quadrada (1,07:1, ~2,55 × 2,38 m), **portas duplas**, mesmo baú
frigorífico ⇒ **ISOPLASTIC**. Costura vertical das portas em x ≈ 128 cm.
Sem faixas ⇒ §4 não se aplica; substrato decide apenas lixamento + verniz
poliéster.

### 2. Fundo
**Chapa branca original, ~92%. SEM pintura geral.** Sem vinheta de mockup aqui — o
branco é limpo até as bordas, o que **reforça** a leitura de que a vinheta da
lateral era artefato de apresentação.

### 3. Inventário de elementos
- (a) **Logo 3 IRMÃOS** completo, topo-esquerda, ~107 × 81 cm: arco dourado com
  degradê + "3" branco (chapa) com contorno dourado + escudo bordô com "IRMÃOS"
  branco (chapa) + "FRIGORÍFICO" dourado.
- (b) **Fita/banner 3D** topo-direita, ~102 × 43 cm: corpo em paralelogramo
  **vermelho-bordô** com **"QUALIDADE E PROCEDÊNCIA / NO ABATE DE SUÍNOS."** em
  duas linhas de caps bold **brancas (chapa)**, ~4,7 cm de altura, ~56 caracteres;
  **pontas douradas dobradas** nas duas extremidades, cada uma com uma **cunha de
  ouro escuro** simulando a sombra da dobra; sombra projetada cinza sob a fita.
- (c) **Selo SISBI**, inferior-esquerda, ~78 × 24 cm: mesma estrutura da lateral —
  blocos verdes, letras brancas (chapa) de ~6 cm, micro-texto preto de ~2,3 cm.
- (d) **Glifo Instagram + "@frigorifico3irmaos"** e **"(48) 3658-2724"** em bordô,
  inferior-direita, ~105 × 21 cm; letras de ~5 cm; o "(48)" em peso mais leve.

### 4. Paleta
Ouro (degradê), ouro escuro (cunhas das dobras), vermelho-bordô, verde-bandeira,
preto, cinza da sombra projetada + **branco = chapa**.
O bordô do logo e o bordô dos contatos (d) parecem ser a **mesma** tinta —
confirmar no vetor para não comprar duas.

### 5. Fronteiras T-T

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | **dourado (arco) × bordô (escudo)** do logo | **~105 cm** | **suave, quase reta** (raio ≈ 350 cm) | bordô |
| 2 | **dourado (pontas dobradas) × bordô (corpo da fita)** | **~90 cm** (2 contatos de ~45 cm) | **reta** (diagonais do paralelogramo) | bordô |
| 3 | **dourado × ouro-escuro** (4 cunhas de sombra das dobras) | **~60 cm** (4 × ~15 cm) | **reta** | dourado |

**T-F (não geram trabalho de proteção):**
- todo o branco interno — "3", "IRMÃOS", o texto da fita, as letras do SISBI — é
  **chapa reservada**;
- contorno externo do logo, da fita, dos blocos verdes, do micro-texto e dos
  contatos bordô contra a chapa;
- micro-texto preto do SISBI × chapa (não encosta no verde).

**Não se tocam (⇒ mesma sessão):** logo × fita (~92 cm de folga); SISBI × contatos
bordô (~48 cm); verde × qualquer outra cor; preto × qualquer outra cor; o bordô
dos contatos (d) não toca nada.

**Sombra projetada cinza sob a fita:** é efeito de mockup, não elemento de pintura.
**Confirmar com o cliente que ela não vai para o implemento** — se for, vira um 4º
par T-T (cinza × chapa é T-F, mas cinza × bordô seria T-T de ~100 cm).

### 6. Ordem de pintura
1. **Ouro escuro** das cunhas (menor cobertura de todas, ~250 cm²) → mascarar →
2. **Dourado** (arco + contorno do "3" + FRIGORÍFICO + pontas da fita, ~2.500 cm²)
   → mascarar as fronteiras #1 e #2 →
3. **Bordô** (escudo + corpo da fita + contatos, ~7.500 cm²).
4. **Verde** e **preto** do SISBI: não tocam nada ⇒ entram na **sessão 1 ou 2**.

Justificativa dos pares: em #3 a cunha de sombra é ~1/10 da área do dourado; em #1
e #2 o dourado é ~1/3 do bordô. Em ambos, mascarar o menor é o barato. A cadeia é
estritamente crescente (ouro-escuro < dourado < bordô), o que permite **uma única
passada** sem retrocesso.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (a) arco dourado 105 cm + degradê | **CORTE_MANUAL** + aerografia no preenchimento | Curva de 105 cm, raio 350 cm. A rampa em 1 m ainda é perceptível ⇒ aerografia dentro da máscara. |
| (a) "3" 26 cm com contorno de ~2 cm | **CORTE_MANUAL** | Contorno de 2 cm num "3" de 26 cm: no limite confortável do estilete, mas passa. |
| (a) escudo bordô + "IRMÃOS" branco de ~17 cm | **CORTE_MANUAL** (negativo) | 17 cm de caps bold; contra-formas de ~3 cm. |
| (a) "FRIGORÍFICO" ~9 cm dourado | **CORTE_MANUAL** | 11 letras espacejadas de 9 cm; hastes de ~1,5 cm. Passa. Achatar o degradê. |
| (b) corpo da fita + pontas dobradas + cunhas | **CORTE_MANUAL** | Um paralelogramo e quatro triângulos. Geometria pura, arestas retas de 15–45 cm. |
| (b) **texto branco da fita, 4,7 cm, 56 caracteres** | **MASCARA_MAQUINA (direto na chapa — sem ciclo de verniz)** | 4,7 cm de caps condensadas bold com contra-formas de ~7 mm ("O", "D", "A", "P", "R") repetidas 56 vezes: **não vale corte manual**. Como é **reserva de chapa**, a máscara vai na chapa nua **antes** do bordô — sem verniz, sem espera. |
| (c) SISBI blocos verdes + letras brancas de 6 cm | **CORTE_MANUAL** | Retângulos e 5 letras de 6 cm. |
| (c) **micro-texto preto de 2,3 cm, ~110 caracteres** | **MASCARA_MAQUINA (direto na chapa)** | 2,3 cm com hastes de ~3 mm: metade do limiar manual. Mesma economia: chapa nua ⇒ sem verniz. |
| (d) contatos bordô ~5 cm + glifo Instagram | **CORTE_MANUAL** (marginal) | 5 cm de grotesca bold; contra-formas de ~8 mm. É o limite. O glifo (quadrado arredondado + anel + ponto de ~1 cm) é geometria simples. Se a escala real for menor que a assumida, migra para MASCARA_MAQUINA junto com o micro-texto — **cortar a mesma máscara de máquina cobrindo (b), (c) e (d) é a jogada econômica**. |

### 8. Sequência de sessões e dias
Entra **no ciclo das laterais**.

- **Dia 1** — prep (empapelar dobradiças, fechos, borrachas de vedação, lanternas,
  para-choque, zona de placa; lixar). Aplicar **uma única máscara de máquina**
  cobrindo o texto da fita + micro-texto do SISBI + contatos, direto na chapa.
  Aplicar máscara lisa e cortar à mão todo o resto.
  **Sessão A**: ouro-escuro (cunhas) + verde (SISBI) + preto (micro-texto) —
  não se tocam.
  **Sessão B** (após secagem ao toque): dourado (arco + "3" + FRIGORÍFICO +
  pontas da fita), aerografado no arco.
- **Dia 2** — **Sessão C**: mascarar dourado (fronteiras #1 e #2, ~195 cm de
  aresta quase reta); pintar bordô (escudo + fita + contatos).
  **Sessão D**: verniz poliéster; refletiva traseira.

**+0,5 dia** sobre o ciclo das laterais.

**Emenda de portas — boa notícia:** a costura em x ≈ 128 cm cai **no vão entre o
logo (que termina em 112 cm) e a fita (que começa em 143 cm)**, e também entre o
SISBI (termina em 96 cm) e os contatos (começam em 145 cm). **Nenhum elemento é
cortado pela emenda.** O layout já foi pensado para portas duplas — raro e digno
de nota.

### 9. Armadilhas para o motor de visão
- **A sombra projetada da fita** é um cinza suave que o motor vai contar como cor
  de produção. É mockup. Regra: sombra = região de baixa saturação, deslocada e
  desfocada em relação a uma silhueta idêntica.
- **As cunhas de ouro escuro** têm ΔE pequeno contra o dourado e área minúscula —
  o clusterizador funde e some com a fronteira #3.
- **Branco interno = chapa** (mesma armadilha da lateral, agravada: aqui o texto
  branco tem 4,7 cm e o motor vai chamá-lo de "detalhe fino ⇒ impossível" quando
  o correto é "reserva ⇒ máscara de máquina barata, sem verniz").
- **O vão das portas não existe no arquivo**; o motor precisa projetar a costura
  no eixo central e **verificar interseções** — aqui, para **confirmar** que não
  há nenhuma (é uma informação positiva que vale reportar).
- **Micro-texto duplo** (SISBI + fita + contatos) em três lugares distintos: o
  motor deve **agrupá-los numa única máscara de máquina**, não emitir três.

### 10. Correções à análise antiga
`analysis_A.md §8`:

1. **"banner: aerografia em máscaras … ou impresso"** e **"SISBI impresso"** —
   ERRADO (§0). Nada é impresso. E o banner **não precisa de aerografia**: é um
   paralelogramo com quatro triângulos de sombra — geometria chapada, corte manual.
   A análise antiga leu "3D" e concluiu "degradê", quando o volume é simulado por
   **facetas chapadas**.
2. **"borda dourada×vermelho = T-T reta (fita)"** — ERRADO: fita é para faixas
   (§4). Aqui são duas arestas retas de 45 cm no interior de um logo; a técnica é
   **corte manual da máscara**.
3. **"dobras = aerografia"** — ERRADO pelo mesmo motivo: as dobras são cunhas
   chapadas de ouro escuro, não rampas.
4. **"contatos por recorte+laca bordô"** — meio certo, mas "recorte" aqui significa
   **corte manual in situ**, não plotagem; e a análise não avaliou se 5 cm de letra
   é cortável (é, no limite) nem propôs agrupar as três máscaras de máquina numa só.
5. **"texto branco em negativo"** — **CORRETO**, sobrevive à revisão.
6. **"layout já mantém elementos fora do vão central"** — **CORRETO** e verificado
   aqui numericamente (costura em 128 cm, vãos de 112–143 cm e 96–145 cm).
7. **Omissão**: não ordenou as três cores por área (ouro-escuro < dourado < bordô),
   que é o que a §2 exige e o que aqui permite uma passada única sem retrocesso.

---

# 7. BOX DA TERRA

### 1. Implemento e substrato provável
Lateral de baú, proporção 3,27:1 ⇒ ~8,00 × 2,45 m. Cliente **hortifruti** ⇒ baú
refrigerado é o padrão do segmento ⇒ **ISOPLASTIC** provável. Confirmar: se for
carga seca com frisos, os grandes vegetais atravessam os frisos e vão mostrar
relevo no meio de campos chapados de 2 m² (aceitável, mas o cliente precisa saber).

§4: **esta arte não tem nenhuma faixa** — não há fita a escolher. O substrato
decide lixamento das janelas e verniz.

### 2. Fundo
**Chapa branca original, ~42%. SEM pintura geral** — mas atenção: ~58% da
superfície recebe tinta, o que é muito mais do que as outras artes de chapa branca
deste slice. É um caso de "muito elemento, nenhum fundo".

O branco tem **dois papéis** aqui, e essa é a chave de produção:
- **fundo** (toda a metade esquerda e o topo);
- **desenho** — os "cortes"/nervuras brancas dentro dos vegetais e as veias das
  folhas. **Todos são chapa preservada**, nenhum é tinta branca.

### 3. Inventário de elementos
**Logo (esquerda):**
- (a) **Cenoura** ilustrada, ~33 × 85 cm: corpo laranja com **5 sulcos em laranja
  mais escuro** (~1 cm de espessura, 15–30 cm de comprimento) e **rama verde**
  (3 folhas pontudas) no topo.
- (b) **Ramo horizontal** verde atravessando a cenoura, ~125 × 50 cm: hastes
  finas de ~1 cm com **14 folhinhas** ovais de ~10 × 5 cm, sete de cada lado.
- (c) **"BOX DA TERRA"** em caps serifadas verde-oliva, ~243 × 30 cm.
- (d) **"· HORTIFRUTI ·"** em caps espacejadas verde-oliva com marcadores, ~130 × 10 cm.

**Composição (direita, ~60% da largura):**
- (e) **Três massas de folhas** verde-claro sangrando pela borda superior;
  cada folha de 150–250 cm de comprimento; **veias brancas** internas (fendas de
  2–4 cm de largura, 40–120 cm de comprimento).
- (f) **Rabanete/beterraba carmim** (~215 × 112 cm) com um **lobo de carmim escuro**
  à direita (~55 × 62 cm) e uma **fenda branca** de ~180 cm atravessando-o.
- (g) **Cenoura/manga laranja gigante** (~232 × 185 cm) com uma **zona de laranja
  claro** ocupando o terço esquerdo (~90 cm de largura) e **três fendas brancas**
  curvas de 100–180 cm.
- (h) **Beterraba roxo-magenta** (~160 × 200 cm) com um **lobo de roxo escuro** no
  topo-direito (~55 × 55 cm) e **três fendas brancas**.

### 4. Paleta
Todas **chapadas** — zero degradê real em toda a arte. É a maior vantagem
produtiva desta arte e o motor precisa registrá-la.

| Cor | Uso | Aprox. |
|---|---|---|
| Verde-claro | folhas | #8DC63F |
| Verde-oliva | tipografia + ramo + rama da cenoura | #4F6B22 |
| Laranja | cenoura do logo + corpo da massa (g) | #F7941E |
| Laranja claro | zona de luz em (g) | #FBB040 |
| Laranja escuro | sulcos da cenoura do logo | ~#D97B12 |
| Carmim | massa (f) | #E8174A |
| Carmim escuro | lobo de (f) | #A81038 |
| Roxo-magenta | massa (h) | #A3308F |
| Roxo escuro | lobo de (h) | #7D1C6D |
| **Branco** | fundo + todas as fendas e veias | **chapa** |

**9 tintas.** Quatro pares com ΔE baixo (laranja/laranja-claro, laranja/laranja-
escuro, carmim/carmim-escuro, roxo/roxo-escuro) — alerta de compra e de
segmentação.

### 5. Fronteiras T-T
**A descoberta estrutural:** o designer separou quase todas as massas com **fendas
brancas**. Cada fenda converte uma T-T em **duas T-F** — e T-F não custa proteção.
O que sobra de T-T são as **duplas de tom dentro de cada vegetal**.

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | **carmim × carmim-escuro** (lobo de f) | **~110 cm** | **suave** (raio ~40 cm) | carmim (~14.400 cm² × ~2.400 cm²) |
| 2 | **laranja × laranja-claro** (zona de luz de g) | **~200 cm** | **média** (raio 20–50 cm, traçado ondulado) | laranja (~18.400 cm² × ~11.600 cm²) |
| 3 | **roxo × roxo-escuro** (lobo de h) | **~90 cm** | **suave** (raio ~35 cm) | roxo (~19.200 cm² × ~2.100 cm²) |
| 4 | **laranja × laranja-escuro** (5 sulcos da cenoura do logo) | **~110 cm** (5 × ~22 cm) | **suave** | laranja |
| 5 | **verde-oliva × laranja** (rama da cenoura sobre o corpo) | **~25 cm** | **média** | laranja |
| 6 | carmim × laranja (contato entre f e g) | **~90 cm** no trecho inferior — **A CONFIRMAR NO VETOR** | suave | laranja |
| 7 | laranja × roxo (contato entre g e h) | **~40 cm** no trecho inferior — **A CONFIRMAR NO VETOR** | suave | roxo |

**Não se tocam (verificado, ⇒ mesma sessão):**
- **verde-claro (folhas) × laranja**: separados por fenda branca em toda a
  extensão do encontro (~250 cm). **T-F dos dois lados.**
- **verde-claro × roxo**: idem, fenda branca contínua (~180 cm).
- **verde-claro × carmim**: as massas nem se aproximam (~60 cm de branco).
- **verde-oliva (tipografia c/d) × qualquer outra cor**: ilha isolada na metade
  esquerda.
- **carmim × roxo**: separados pela massa laranja inteira.
- **ramo verde (b) × cenoura (a)**: o ramo passa **atrás** da cenoura e reaparece
  do outro lado — há folga branca; **confirmar no vetor** se o ramo é interrompido
  ou se corre por baixo (se correr por baixo, some a fronteira).

Em #6 e #7, a leitura da imagem mostra uma **fenda branca clara no trecho
superior** e convergência ambígua no trecho inferior. Se o vetor confirmar fenda
contínua, os pares T-T caem de 7 para **5** e as três cores grandes (carmim,
laranja, roxo) podem sair **na mesma sessão** — uma economia de meio dia.
**Vale abrir o arquivo antes de orçar.**

### 6. Ordem de pintura
Todos os sete pares seguem o mesmo padrão: o **tom de sombra/luz é sempre a
minoria** contra a massa. Portanto, **todos os tons secundários primeiro, numa
sessão só** (eles não se tocam entre si), depois todas as massas.

1. **Sessão de tons secundários** — carmim-escuro (2.400 cm²), laranja-claro
   (11.600 cm²), roxo-escuro (2.100 cm²), laranja-escuro dos sulcos (~150 cm²) e
   **verde-oliva** (tipografia + ramo + rama). Nenhum deles toca nenhum outro.
2. **Mascarar** cada tom secundário nas fronteiras #1–#5 (total ~535 cm de aresta,
   toda de curvatura suave/média — máscara barata).
3. **Sessão de massas** — carmim, laranja, roxo e **verde-claro** das folhas.
   O verde-claro não toca nenhuma delas ⇒ entra junto. Se #6 e #7 se confirmarem
   como contatos reais, carmim e roxo (menores que laranja) vêm antes, mascaram-se,
   e o laranja fecha.

Note a inversão que a §2 impõe em #2: o **laranja-claro é a luz**, e a intuição do
pintor é "pintar a base e depois a luz". A regra manda o contrário — 11.600 cm² é
menos que 18.400 cm², então a luz vai primeiro e é mascarada.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (e) folhas verde-claro, 150–250 cm cada, com veias brancas de 2–4 cm | **CORTE_MANUAL** | Curvas orgânicas amplas de 1,5–2,5 m; o menor detalhe são as veias de 2 cm. É o corte mais confortável possível. |
| (f) massa carmim + lobo escuro + fenda de 180 cm | **CORTE_MANUAL** | Duas curvas suaves e uma fenda de 3 cm × 180 cm. |
| (g) massa laranja + zona clara + 3 fendas | **CORTE_MANUAL** | Idem; a fronteira #2 é ondulada mas com raio ≥ 20 cm. |
| (h) massa roxa + lobo escuro + 3 fendas | **CORTE_MANUAL** | Idem. |
| (c) "BOX DA TERRA" 30 cm serifada | **CORTE_MANUAL** | Serifas de ~2 cm em letras de 30 cm. |
| (d) "· HORTIFRUTI ·" 10 cm espacejada | **CORTE_MANUAL** | 10 cm de caps sem serifa fina; passa. |
| (a) cenoura do logo 33 × 85 cm, corpo + rama | **CORTE_MANUAL** | Formas grandes e simples. |
| (a) **5 sulcos de laranja escuro, 1 cm × 15–30 cm** | **MASCARA_MAQUINA_SOBRE_VERNIZ** — ou **omitir** | 1 cm de espessura sobre um corpo de 33 cm: no limite do estilete, e pousa sobre **laranja fresco** ⇒ exigiria envernizar e curar só para 110 cm de sulco decorativo. **Recomendação forte: negociar a supressão dos sulcos.** Ninguém percebe a 3 m, e economiza um ciclo de verniz inteiro. |
| (b) **ramo com 14 folhinhas e hastes de 1 cm** | **MASCARA_MAQUINA (direto na chapa — sem ciclo de verniz)** | Duas hastes paralelas a 1 cm de distância ao longo de ~250 cm, com 14 pares de folhinhas de 10 × 5 cm: são ~30 ilhas com detalhe mínimo de 1 cm. **Não é corte manual razoável.** Mas pousa na **chapa nua** ⇒ máscara de máquina entra direto, sem verniz e sem cura. Custa uma máscara pequena, não um dia. |

**Nada de espovo:** as massas são grandes (o laranja tem 232 × 185 cm), mas não
são "de formato fácil" no sentido do §3.3 — têm fendas internas e um segundo tom.
Furar kraft para elas seria mais caro que máscara + estilete.
**Nada de fita:** não há faixas.

### 8. Sequência de sessões e dias
- **Dia 1** — prep: lavar, empapelar molduras superior e inferior (as folhas
  morrem na moldura de topo — definir o corte com o cliente), borrachas, ferragens;
  lixar as janelas (isoplastic). Aplicar a **máscara de máquina do ramo** na chapa
  nua. Aplicar máscara lisa em todo o resto e cortar à mão: massas, fendas, veias,
  tipografia, cenoura.
  **Sessão A**: verde-oliva + carmim-escuro + laranja-claro + roxo-escuro — **as
  quatro não se tocam** ⇒ uma sessão (§6.4).
- **Dia 2** — **Sessão B** (laca seca ao toque): mascarar os três lobos/zonas
  (~535 cm de aresta suave); pintar **carmim + roxo + verde-claro** juntos (não se
  tocam entre si).
  **Sessão C**: mascarar carmim e roxo **apenas se** #6 e #7 forem contatos reais;
  pintar **laranja**. Se as fendas brancas se confirmarem, o laranja entra na
  própria Sessão B e **a Sessão C desaparece**.
- **Dia 3** (meio período) — retoques, **verniz** geral, cura; refletiva de rodapé.

**~2,5 dias por lado; ~3 dias para o par.** Nenhuma cura overnight obrigatória,
desde que os sulcos da cenoura sejam suprimidos.

### 9. Armadilhas para o motor de visão
- **Confusão figura/fundo**: o branco é fundo **e** desenho. Um segmentador que
  trate "branco = fundo" vai fundir as fendas internas com o exterior e reportar
  cada vegetal como uma região com buracos topológicos que "vazam" para fora.
  Regra: fenda branca **totalmente cercada** por uma cor = desenho; branco
  conectado à borda do canvas = fundo.
- **As fendas brancas são o item mais valioso da arte** e o mais frágil: 2–4 cm no
  implemento, mas 4–8 px no render. Qualquer downscale as apaga e converte 5
  fronteiras T-F em T-T falsas — o que **inverteria** o diagnóstico da arte inteira.
  Analisar **na resolução original**, e dilatar antes de aplicar limiar.
- **Quatro pares de cores com ΔE baixo** (2 laranjas + laranja-escuro, 2 carmins,
  2 roxos): a quantização vai fundir e apagar exatamente os 5 pares T-T reais.
- **Contato ambíguo carmim×laranja e laranja×roxo** — o motor deve emitir
  "fronteira incerta, confirmar no vetor" em vez de decidir, porque a decisão
  vale meio dia de cronograma.
- **As folhas sangram pela borda superior**: o motor deve reconhecer sangria
  (região que toca o limite do canvas) e não tratar a aresta do canvas como
  fronteira de cor.
- **Os sulcos da cenoura do logo** são 0,05% da área e são o único elemento que
  forçaria um ciclo de verniz. Um motor que só olha elementos dominantes perde a
  única decisão cara da arte.

### 10. Correções à análise antiga
`analysis_E.md §3`:

1. **"Logo pequeno da esquerda (galhos finos): adesivo de recorte viável se >80cm;
   senão impressão digital aplicada"** — ERRADO (§0). Nunca impressão. O ramo é
   **pintado**, com máscara cortada a máquina aplicada **direto na chapa nua** —
   sem verniz e sem cura, porque não há tinta embaixo dele. A análise antiga não
   tinha esse caminho porque não distinguia "máscara sobre tinta" de "máscara sobre
   chapa".
2. **"Adesivo resolve quase tudo"** e **"curvas orgânicas grandes → plotter corta
   fácil"** — ERRADO na hierarquia (§3.1). Curva orgânica grande é precisamente o
   caso em que **corte manual in situ é preferido**: evita cortar 15 m² de vinil na
   máquina e evita o transporte/posicionamento de máscaras gigantes. A análise
   antiga tratou o plotter como padrão; a doutrina o trata como exceção.
3. **"(iii) aerografia leve com stencil solto"** para as sombras — desnecessário:
   as sombras são **chapadas** (dois tons sólidos com aresta definida), não rampas.
   A análise leu "sombreado sutil" e concluiu degradê.
4. **"(i) simplificar para 1 tom (recomendado)"** — recomendação certa pelo motivo
   errado. Simplificar as três duplas de tom não é evitar aerografia; é eliminar
   3 fronteiras T-T de ~400 cm e uma sessão inteira de mascaramento.
5. **A análise não mediu nenhuma fronteira.** Disse "tinta-tinta (poucas):
   eventuais contatos folha×cenoura sem keyline" — e isso é factualmente **errado**:
   folha e cenoura **nunca** se tocam (fenda branca contínua em ~250 cm), enquanto
   os contatos reais (carmim×carmim-escuro, laranja×laranja-claro,
   roxo×roxo-escuro) foram listados como um item genérico de "tons de sombra".
6. **"Vermelho → laranja → roxo → verdes"** como ordem — ordem arbitrária, sem
   referência à área. A §2 exige o contrário do que a análise fez: os **tons
   secundários** (minoria) vêm todos primeiro, e as massas depois.
7. **Omissão**: não notou que **verde-oliva, carmim-escuro, laranja-claro e
   roxo-escuro não se tocam entre si** ⇒ uma sessão só; nem que **verde-claro não
   toca nenhuma das massas coloridas** ⇒ entra junto com elas.

---

# 8. CARLOTTI carreta

### 1. Implemento e substrato provável
Lateral de **carreta**, proporção 5,52:1 ⇒ ~14,00 × 2,55 m.
Transportadora genérica, carga seca ⇒ dois cenários:
- **CHAPA_BRANCA** com frisos verticais (baú de carga seca) — cenário assumido;
- **LONA** (sider) — se for, a arte não é pintada nesta oficina; é outro processo.

**Confirmar antes de qualquer coisa.** §4 é irrelevante aqui de qualquer modo:
**a arte não tem uma única faixa** — é 100% tipográfica. O substrato só decide
preparação (empapelar frisos verticais, que as letras de 87 cm atravessam).

### 2. Fundo
**Chapa branca original, ~93%. SEM pintura geral.** É a arte com mais branco do
slice e, por consequência, a mais barata.

### 3. Inventário de elementos
- (a) **"TRANS"** em caps serifadas cinza-médio, ~341 × 26 cm, ladeado por **dois
  filetes cinza** horizontais de ~5 cm de espessura e ~130 cm de comprimento cada.
- (b) **"CAЯLOTTI"** em serifada didone gigante, ~810 × 87 cm:
  **"CA"** em **violeta-azulado**, **"Я"** (R espelhado, recurso de marca) e
  **"L"** em **cinza-médio**, **"OTTI"** em violeta-azulado.
- (c) **"Transportes e Logística"** em serifada cinza-médio, ~429 × 39 cm.
- (d) **Selo "20 Anos / desde - 2001"** no canto superior-direito, ~122 × 51 cm:
  **"20"** em script pesado azul-marinho com **"Anos"** em script sobreposto, e uma
  pequena tarja escura com **"desde - 2001"** em letras de ~4 cm reservadas.
- (e) **Bloco de contato ESPELHADO** no canto esquerdo, ~200 × 70 cm, três linhas:
  **"Tupã - SP"**, **"(14) 3491-3900"**, **"www.carlotti.com.br"** — todas escritas
  ao contrário no arquivo, ilegíveis.

### 4. Paleta
Três tintas, **todas chapadas, zero degradê**:

| Cor | Uso | Aprox. |
|---|---|---|
| Violeta-azulado | "CA" e "OTTI" | #4A45A8 |
| Cinza-médio | "TRANS", filetes, "Я"+"L", "Transportes e Logística" | #7A7A7A |
| Azul-marinho | selo "20 Anos" | #1E2A5A |

Violeta (#4A45A8) e azul-marinho (#1E2A5A) têm **ΔE moderado** — são duas tintas,
não uma. Alerta de compra.

### 5. Fronteiras T-T
**Uma, e ainda assim marginal.**

| # | Par | Extensão | Curvatura | Maior cobertura |
|---|---|---|---|---|
| 1 | **violeta ("A") × cinza ("Я")** | **~85 cm** | **reta** (a perna direita do "A" e a haste esquerda do "Я" correm em paralelo) | violeta (o violeta soma ~6 letras contra 2 do cinza no letreiro) |
| — | cinza ("L") × violeta ("O") — **A CONFIRMAR**: a leitura da imagem indica folga de ~4 cm entre o pé do "L" e a curva do "O" | ~0 ou ~30 cm | reta | violeta |

**Não se tocam (⇒ mesma sessão):**
- **"TRANS" + filetes × "CAЯLOTTI"** (~10 cm de folga vertical)
- **"CAЯLOTTI" × "Transportes e Logística"** (~50 cm de folga)
- **selo "20 Anos" × tudo** (ilha no canto, ~160 cm de folga)
- **bloco de contato × tudo** (ilha no canto oposto, ~90 cm de folga)
- **cinza × azul-marinho** em qualquer ponto

⇒ **Cinza, violeta e azul-marinho poderiam sair todos na mesma sessão**, não fosse
a única fronteira #1. E mesmo essa se resolve com uma máscara de 85 cm de reta.

### 6. Ordem de pintura
Um par apenas:
1. **Cinza primeiro** — no par #1, o cinza é a menor cobertura ("Я" + "L" ≈
   2 letras × ~2.400 cm² = ~4.800 cm², contra ~14.400 cm² de "CA"+"OTTI"). Pinta-se
   cinza (incluindo TRANS, filetes e a tagline, que não tocam nada).
2. **Mascarar o "Я"** ao longo dos 85 cm de aresta reta — máscara de fita de
   máscara comum, cortada com régua.
3. **Violeta por cima**.
4. **Azul-marinho** do selo: não toca nada ⇒ **mesma sessão do cinza**.

Se a folga entre "L" e "O" se confirmar, a fronteira #1 é o **único** ponto de
mascaramento da carreta inteira — 85 cm num implemento de 14 m.

### 7. Estratégia por elemento

| Elemento | Estratégia | Justificativa |
|---|---|---|
| (b) "CAЯLOTTI" 87 cm de altura, serifada didone | **CORTE_MANUAL** | Altura de letra de quase 1 m. As serifas mais finas têm ~2 cm e as junções haste-grossa/haste-fina têm raio de ~1,5 cm. Isso é confortável para estilete e a máquina não traria nenhum ganho — só 8 m de vinil e o transporte de uma máscara gigante. |
| (a) "TRANS" 26 cm + dois filetes de 5 × 130 cm | **CORTE_MANUAL** | Letras de 26 cm; filetes são retângulos — corte com régua. (Não usar fita: filete de 5 cm de espessura e 130 cm de comprimento é um retângulo isolado, não uma faixa que percorre o implemento.) |
| (c) "Transportes e Logística" 39 cm | **CORTE_MANUAL** | Serifada de 39 cm; contra-formas de ~6 cm. |
| (d) selo "20 Anos", script de ~40 cm | **CORTE_MANUAL** | Script pesado com laçadas de raio ~4 cm. Cortável. |
| (d) tarja **"desde - 2001"**, letras reservadas de ~4 cm | **MASCARA_MAQUINA (direto na chapa)** | 4 cm de caps com hastes de ~6 mm, 12 caracteres, e são **reserva de chapa** dentro da tarja escura ⇒ máscara vai na chapa nua, sem verniz. Máscara minúscula; agrupar com nada mais (é a única). Alternativa: **negociar a supressão da tarja** — a 14 m de distância ninguém lê 4 cm. |
| (e) bloco de contato ~12 cm de altura | **BLOQUEADO até correção**; depois **CORTE_MANUAL** | 12 cm de altura, grotesca; contra-formas de ~2 cm. Cortável sem drama. **Mas o arquivo está espelhado** — não cortar nada antes da correção. |

**Nada de fita** (não há faixas). **Nada de espovo** (nada é grande *e* fácil ao
mesmo tempo — as letras são grandes mas têm serifas; furar kraft para uma didone
de 87 cm seria absurdo). **Nada de máquina**, exceto a tarja de 4 cm.

### 8. Sequência de sessões e dias
- **Dia 1 — Sessão A**: lavar, empapelar frisos verticais (as letras de 87 cm os
  atravessam — o relevo vai aparecer no meio das hastes; **avisar o cliente**),
  borrachas, ferragens. Aplicar a máscara de máquina da tarja "desde - 2001".
  Aplicar máscara lisa; cortar à mão TRANS, filetes, "Я"+"L", tagline e o selo.
  Pintar **cinza + azul-marinho** — não se tocam ⇒ uma sessão.
- **Dia 1, tarde — Sessão B**: mascarar o "Я" (85 cm de reta); cortar "CA" e
  "OTTI"; pintar **violeta**.
- **Dia 1, fim — Sessão C**: verniz. Refletiva de rodapé.

**1 dia por lado.** Com o par de laterais + traseira no mesmo ciclo: **~1,5 dia**.
**É a arte mais barata do slice, por margem larga.**

Extras estruturais: carreta = **2 laterais + traseira**; o par espelhado deve ter
o **texto na leitura correta nos dois lados** (a composição espelha, o texto
nunca); traseira com versão reduzida do letreiro, ferragens empapeladas.

### 9. Armadilhas para o motor de visão
- **"Я" é um R espelhado de propósito.** O OCR vai reportar "arquivo espelhado" ou
  "glifo inválido". É um recurso de marca. O motor precisa distinguir **um glifo
  espelhado dentro de uma palavra legível** (marca) de **um bloco inteiro espelhado**
  (erro) — e nesta arte **as duas coisas ocorrem ao mesmo tempo**: o "Я" é
  intencional, o bloco de contato é erro.
- **Serifas didone com antialiasing**: hastes finas de ~2 cm viram contornos
  serrilhados que inflam artificialmente o perímetro e, com ele, a estimativa de
  corte.
- **Violeta × azul-marinho** em matiz próxima: o clusterizador funde e a arte
  passa a "2 cores", perdendo uma tinta da lista de compra.
- **Onde exatamente "Я" toca "A" e onde "L" toca "O"** é uma decisão de ~30 cm que
  o motor não consegue resolver na resolução do render — deve emitir "confirmar no
  vetor" em vez de arbitrar.
- **Risco de superestimar**: uma arte 100% tipográfica com letras de 87 cm em
  chapa branca é o caso mais barato que existe. Um motor que pontua complexidade
  por "número de glifos" ou "perímetro total" vai classificá-la como média quando
  ela é baixa. O que importa é **fronteiras T-T (uma) e menor detalhe (2 cm)**.

### 10. Correções à análise antiga
`analysis_E.md §8`:

1. **"Selo '20 Anos': adesivo+laca se ≥40cm, senão vinil/impresso"** — ERRADO
   (§0). Não existe "vinil/impresso" como acabamento. O selo é pintado; o único
   trecho não-cortável (a tarja de 4 cm) resolve-se com **máscara de máquina
   direto na chapa**, ou negocia-se a supressão.
2. **"tudo é letra sobre branco ⇒ adesivo de recorte plotado + laca"** — ERRADO na
   escolha de técnica (§3.1). Letras de **87 cm** são o caso mais favorável
   possível ao **corte manual in situ**. Mandar plotar 8 m de vinil para desenhar
   uma didone gigante é exatamente o desperdício que a doutrina quer evitar:
   máscara nova + posicionamento de máscara gigante, para zero ganho.
3. **"se sider ⇒ tudo vira lona impressa; assumo chapa"** — a hipótese "lona
   impressa" não é uma variante de acabamento desta oficina; se for sider, é outro
   produto e sai do escopo de pintura. Não pode entrar como ramo de um orçamento
   de pintura.
4. **"Я cinza: se encosta nas letras violetas, tinta-tinta reta → fita simples"** —
   ERRADO no instrumento. **Fita é para faixas** (§4), não para a aresta de uma
   letra. O contato é uma reta de 85 cm e resolve-se com **máscara cortada com
   régua** sobre o cinza já pintado. E a análise não determinou qual cor cobre mais
   — o cinza cobre menos, logo é o cinza que vem primeiro, e a análise não disse
   isso.
5. **"1 dia. Arte mais barata do lote."** — **CORRETO**, e sobrevive à revisão
   (agora com a justificativa certa: **uma** fronteira T-T de 85 cm e detalhe
   mínimo de 2 cm).
6. **"letras gigantes atravessam frisos verticais — empapelar molduras"** —
   **CORRETO**, mas incompleto: o relevo do friso vai marcar **dentro** da haste
   pintada; empapelar não resolve, só avisa. É item de comunicação com o cliente.
7. **Omissão**: a análise antiga viu o texto espelhado, mas não notou que o
   **"Я" é espelhamento intencional de marca** — se a "correção do espelhamento"
   for aplicada ao arquivo inteiro, destrói a logomarca.

---

# Padrões transversais do slice 7

1. **A pergunta que decide tudo é "o fundo é chapa ou tinta?"** — e ela apareceu
   ambígua em 2 das 8 artes (137 PESCADOS lateral e traseira, ambas cinza-médio).
   Resolver essa pergunta vale ~2 dias por veículo. O motor **não pode arbitrar**
   na faixa 0xA0–0xC0.
2. **Branco nunca é tinta, e isso cria duas técnicas distintas** que a análise
   antiga não separava: (a) **branco como fundo** (3 IRMÃOS, BOX DA TERRA,
   CARLOTTI) — barato, T-F em quase tudo; (b) **branco como reserva sob pintura
   geral** (2 amigos, bandeira do 137) — exige máscara **antes** do fundo, o que
   reordena o cronograma inteiro. Um pipeline que sempre põe "fundo primeiro,
   elementos depois" erra o caso (b).
3. **`MASCARA_MAQUINA` custa um ciclo de verniz só quando pousa sobre tinta.**
   Sobre chapa nua (SISBI, texto da fita 3 IRMÃOS, ramo do BOX DA TERRA, tarja do
   CARLOTTI) ela é barata. Essa distinção não existia na análise antiga e é a
   diferença entre "+1 dia" e "+1 máscara" em 4 das 8 artes.
4. **Contorno não-conferível ⇒ corte manual, sempre.** Letreiros de pincel
   (137 PESCADOS), pinceladas rasgadas (3 IRMÃOS) e texturas orgânicas parecem
   complexos ao motor e são, na verdade, os cortes mais baratos: ninguém compara o
   resultado com o arquivo. É um sinal que precisa entrar no `cortavel_a_mao`.
5. **Escala é tudo.** Quatro dos erros mais graves da análise antiga vieram de
   julgar detalhe em pixels e não em centímetros (o contorno do "3" de 5 cm virou
   "6 mm"; o script de 103 cm virou "corte inviável"). O motor **tem** que fixar
   px→cm a partir da proporção + dimensão do implemento antes de qualquer decisão
   de estratégia.
6. **"Não se tocam" é uma medida, não uma impressão.** Em todas as 8 artes a
   maior economia de cronograma veio de provar que duas cores não se encostam
   (marinho × low-poly no 137; dourado × verde × preto no 3 IRMÃOS; os quatro tons
   secundários do BOX DA TERRA; cinza × marinho no CARLOTTI). A análise antiga não
   fez essa verificação em nenhuma arte.
7. **Fita é para faixas.** Em 4 lugares a análise antiga propôs fita para o
   contorno de um logo ou de uma letra. §4 é sobre **faixas**, e a escolha
   amarela/branca é **determinada pelo substrato**, não pelo gosto. Neste slice,
   **apenas a arte "2 amigos" (os dois lados) tem faixas de verdade** — e é a
   única em que a pergunta do substrato muda a técnica.
8. **Duas pendências de bloco fotográfico** (morangos + banner dourado, nos dois
   lados do 2 Amigos, somando ~2.100 cm² × 3.300 cm² de área pintada à mão) e uma
   pendência de micro-detalhe (globo da bandeira do 137, com estrelas de 2 mm).
   As três eram "impressão digital" na análise antiga. As três agora são decisões
   do dono, e as duas primeiras dominam o cronograma do job inteiro.
