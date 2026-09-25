# Doutrina de cotagem de layout

Como o projetista da Ankaa cota uma face de implemento, medido — não suposto.

## De onde vieram os números

Base: `kennedy@ankaadesign.com.br:/srv/files/Clientes/*/Layouts/PDFs/*.pdf`,
357 arquivos, dos quais **347 foram baixados e lidos**; 201 tinham cota legível
por máquina. Delas saíram **2.102 cotas com âncora exata** (98% dos rótulos
resolvidos, erro máximo de 0,9 cm), **2.202 âncoras classificadas** contra a
geometria vetorial e **1.697 cotas com a linha de extensão medida ponta a ponta**.

O leitor de cotas usado no estudo está em `harness/` (fora do repositório):
ele acha o rótulo azul, procura as linhas de extensão perpendiculares que
tocam a linha de cota e escolhe o par cuja distância bate com o número escrito.
Esse casamento é auto-verificável — se o par não reproduz o rótulo, a cota é
descartada.

## O que é fixo no arquivo

| Item | Valor | Evidência |
|---|---|---|
| Escala | **1:10** (1 cm real = 1 mm no papel = 2,8346 pt) | 190 de 205 arquivos |
| Cor da cota | `#3374A9` | uniforme |
| Traço | 0,22 pt | 4.361 de 4.383 segmentos |
| Seta | triângulo cheio 10,6 × 5,7 pt | 2.178 setas |
| Rótulo | Arial 36 pt (24 pt em detalhe) | 945 de 1.096 |
| Valor | inteiro em cm, mínimo 3 cm | 2.071 de 2.071 |
| Faces por arquivo | 3 (motorista, sapo, traseira) | 161 de 205 |
| Cotas por face | mediana 3, p75 5, máximo 13 | 325 faces |

A traseira costuma ser cotada sobre a **foto** do implemento, não sobre um
desenho — porta, dobradiça e lanterna não cabem num retângulo.

## As regras

### 1. Vertical: a borda de referência sai da altura do elemento

- centro do adesivo dentro dos **3/4 de cima** → cota a partir do **TOPO**
  (186 casos; **zero** no último quarto);
- centro no **último 1/4** → cota a partir da **BASE**
  (33 casos; **zero** no primeiro quarto).

### 2. Vertical: mede-se até o TOPO do elemento

`borda de cima → topo do adesivo` 129 × `borda de cima → base do adesivo` 15.

### 3-bis. Um plano só, e ele sempre tem altura E distância

Não há variante. Houve por um tempo um segundo plano, espelhado, que o clique
repetido alternava — e a alternância era o defeito, não o recurso: o mesmo
adesivo dava dois pares de números conforme quantas vezes se clicasse nele, e
quem vai colar não tem como saber qual dos dois vale. A borda de referência é a
que §1 e §3 escolhem, sempre.

Com uma consequência que precisa estar escrita: **quando a borda escolhida não
tem número a dar, quem posiciona é a oposta.** A peça colada na borda preferida
— o QR a 1 cm da lateral, o letreiro que encosta no teto, a arte que transborda
o quadro e dá distância negativa — devolvia um valor abaixo do piso de 3 cm e a
cota era simplesmente descartada: o operador clicava e via meia posição. Medido
em modo navegador: **159 de 2.710 itens (5,9%)** perdiam uma das duas assim,
131 a horizontal e 28 a vertical, todas com a borda escolhida a 0 ou 1 cm. A
âncora é presa dentro da face antes da conta, senão a arte que sangra produz
número negativo.

A cota de POSIÇÃO do adesivo também deixou de disputar espaço com as
acessórias: o piso de valor e o teto por face (`maxDims`) cortam o vão interno
do conjunto e a travessia do envelopamento, nunca a altura e a distância de uma
peça.

E duas cotas só viram uma quando dizem a mesma coisa — **o NÚMERO incluído**.
Pontas a menos de 2 cm uma da outra não bastavam: com essa folga sozinha, o
"149" da assinatura do MACHADÃO era absorvido pelo "147" da faixa que passa
atrás dela, e quem clicava na assinatura recebia a posição do vizinho. Medido:
289 das 543 cotas herdadas traziam um valor diferente do que a peça herdeira
mediria sozinha. Números diferentes são duas medidas, e as duas são verdade
sobre peças diferentes.

### 3. Horizontal: sempre da borda lateral MAIS PRÓXIMA

- `borda esquerda → esquerda do adesivo`: 109
- `direita do adesivo → borda direita`: 110

Adesivo centralizado recebe as duas (Ki Distribuidora: 725 à esquerda e 612 à
direita do mesmo logotipo).

### 4. Onde a linha mora

| | metade de cima | último quarto |
|---|---|---|
| cota horizontal | linha **acima** da face (119 × 12) | linha **abaixo** (60 × 1) |

Cota vertical fica do lado da borda que serviu de referência
(esquerda 96 × 15, direita 98 × 15).

### 5. Envelopamento não tem cota de bloco

Arte que sangra pelas bordas (fundo colorido, faixa, marca d'água) não tem
posição a cotar — o que o aplicador precisa é **em que ponto da aresta
superior ela começa**. É a cota 142 do GRESPAN 840, a 252 do Ki 1538 e a 160
do Norte Minas 1442. São raras: 28 de 2.202 âncoras. O motor emite no máximo 2
por face, preferindo a aresta de cima (13 × 5).

Com uma ressalva que só aparece quando a faixa entra pela quina: a travessia e
a distância de bloco podem medir **o mesmo ponto**. A faixa do DiCasa 839 sobe
da esquerda e termina no alto — a ponta da tinta e o lugar onde ela cruza a
aresta de cima estão a meio centímetro um do outro, e saíam como **416 e 417,
empilhados sobre a mesma seta**. Duas cotas do MESMO dono a menos de 2 cm uma
da outra são uma medida só; fica a de natureza mais forte (a borda antes da
travessia), que é também a que a peça tem garantida. A exigência de mesmo
NÚMERO que protege a herança entre peças diferentes (§ `dedupe`) não vale aqui:
sem dono a herdar, ela só produzia o número duplo.

### 6. A linha de extensão vai ATÉ o item — e sai do ponto certo

Não é enfeite: é o que diz a que peça o número se refere. Em **2.780 de 3.348**
linhas de extensão a ponta cai DENTRO da peça medida (folga mediana **0 cm**), e
as duas extensões de uma mesma cota terminam no mesmo lugar (diferença mediana
2 cm). A sobra além da linha de cota é fixa: **2,5 cm** (p10 a p75 todos em 2,5).

O ponto de saída não é o canto da caixa, é **onde a tinta encosta na medida**.
No conjunto "maçã + folha + HORTIFRUTI" da Norte Minas, o topo do conjunto (8 cm
do teto) é a ponta da FOLHA, no meio do desenho — a caixa começa 180 cm à
esquerda, na maçã. Amarrar a extensão na caixa faz a linha apontar para o vazio:
o número fica certo e ilegível. Por isso `owningPart` acha a peça que produziu o
extremo e `PartExtremes` guarda a coordenada exata desse contato.

### 7. A linha de cota fica PERTO do item — e desvia da arte

Distância da linha até o item que ela mede: p25 19, **p50 35**, p75 69, p90 135 cm.
Não existe faixa distante na margem.

| onde o item está | onde vai a linha | contagem |
|---|---|---|
| encostado numa borda perpendicular (< 60 cm) | FORA da face, a ~18 cm dela | 773 × 213 |
| no meio da face (> 200 cm de qualquer borda) | DENTRO, ao lado dele | 91 × 48 |

O lado escolhido é o mais próximo do item em 793 casos contra 199 no lado oposto.
Empilhamento é raro: 451 lados com uma faixa só, 170 com duas, 20 com três, e o
passo entre faixas é de 18 cm (p50).

**A linha nasce AO LADO do trecho medido, nunca em cima dele.** Se ela cair
dentro do intervalo que a peça ocupa, a linha de extensão fica com comprimento
zero: a cota flutua sem nada que a ligue à peça, e o número parece pertencer ao
primeiro traço que estiver por perto — foi assim que o "25" de "Sabor e
Qualidade" foi parar na cauda do "Q". Por isso o afastamento é contado a partir
da BORDA do trecho, não do meio dele.

A linha ainda se desvia: partindo da posição ideal ela caminha para os lados até
achar um corredor livre de arte. Sem isso a cota de uma assinatura embaixo de um
logotipo sobe cortando o logotipo inteiro, com o número e as setas por cima do
desenho. A extensão pode cruzar arte — é fio de cabelo e o projetista faz o
tempo todo —, a linha de cota não.

### 8. A seta vira aos 25 cm — e é do VALOR, não do zoom

Medido em 1.723 cotas com as setas identificadas:

| valor da cota | setas |
|---|---|
| < 12 cm | 92% FORA do vão, apontando para dentro |
| 12–25 cm | 98% fora |
| 25–60 cm | 78% DENTRO |
| 60–150 cm | 98% dentro |
| > 150 cm | 99% dentro |

O limiar é 25 cm. Decidir isso pelo tamanho em PIXELS faz a seta virar sozinha
quando o operador dá zoom — foi assim que o defeito apareceu.

### 9. Cotas relativas dentro do conjunto

O vão entre o logotipo e a assinatura (o "36" do GRESPAN) diz ao aplicador como
montar o conjunto antes de colar. Uma por conjunto, a do maior vão. A variante
horizontal existe mas é rara (11 âncoras) e está desligada por padrão
(`relativeHorizontalDims`).

### 10. O que é UM adesivo

O agrupamento decide o que o operador clica, e errar para mais é pior que errar
para menos: item grande demais engole o vizinho e a cota fica sem dono.

- **Peça** — glifos soldados por uma folga que ACOMPANHA a altura deles, e é
  anisotrópica: na mesma linha o alcance é 1,0 × altura com teto de 30 cm e
  piso de 0,35 × altura (teto 50 cm) — o vão real de palavra chega a
  0,31 × altura ("Trans Daldegan": 45,5 cm com glifo de 2 m), a ponte falsa
  começa em 0,50 ("Você!" e o "C" da CONFIANÇA, 38 cm com glifo de 77) —;
  entre linhas, 0,25 × altura com teto de 8 cm. Folga fixa parte a palavra no
  letreiro de 1 m ou solda duas linhas de um bloco de 11 cm.
  **O piso proporcional é da caixa MENOR do par**, e não da maior: tomado da
  maior, ele vaza para fora do letreiro — o logotipo de 134 cm do MAR & RIO
  emprestava 47 cm de alcance ao bloco de texto que está a 40 cm dele, os dois
  soldavam, a peça resultante cobria 39% da face e daí a face inteira virava
  um item só. Quem espaça as letras é o texto; é a altura DELE que diz quanto.
- **A LINHA DE BASE é o que reúne uma frase.** Duas caixas que assentam na
  mesma reta (bases a menos de 0,15 × altura menor) ganham alcance de
  1,5 × altura, sempre sob o teto de 30 cm. É o que junta
  "Alimentando  Saúde" do Perboni, onde o projetista pôs espaço duplo — 23 cm
  de vão para 21 de altura, 1,12 × — e o alcance de uma altura cortava a frase
  no meio. Nenhuma outra prova serve para esse par: a cor é a mesma da faixa
  que passa atrás, a altura é a de meia dúzia de blocos, e o VÃO PURO não
  separa nada (o vão interno de uma linha, mediana 8 cm, e a separação
  intencional entre peças, mediana 23 cm, se sobrepõem). Só o texto miúdo
  sente: acima de 20 cm de altura o teto de 30 já mandava.
- **Ícone é satélite do TEXTO, e o selo é mais alto que a letra.** A caixa de
  uma linha é a altura de maiúscula; o selo redondo do WhatsApp ao lado dela
  abraça ascendente e descendente e ainda sobra — 26 cm contra 15. Medindo o
  ícone pela diagonal contra uma altura e meia da linha, ele era "grande
  demais" e ficava órfão em 62 pares do acervo, enquanto o mesmo desenho
  juntava no Norte Minas só porque lá o selo é menor. O limite é por LADO
  (nenhum lado acima de 2 × a altura da linha, e nunca acima de 60 cm), e a
  prova de que está NA linha usa a MENOR das duas alturas — um selo que engole
  a linha dá 1,0, um ícone numa fileira acima continua dando 0.
- **Cor separa.** Vinil é cortado por cor: "GRESPAN" vermelho e "Pães
  congelados" preto são duas peças, mesmo coladas uma na outra no desenho.
- **PORTE separa, e o porte se mede na LETRA, não na caixa.** A caixa de uma
  palavra é esticada pelo acento e pela perna do "g": a de `amigão` mede 104 cm
  e a letra mediana tem 54. Ao lado do coração, de 116, a caixa dizia "mesmo
  porte" (0,90) e soldava os dois num item de 550 × 124 — com a cota vertical
  ancorada no til do "ã", 67 cm, quando o projetista escreveu 75, que é o topo
  do coração. Pela letra o par dá 0,46 e se separa; então a marca sai com
  145 e 75 e a palavra com 144 e 91, que são quatro dos cinco números do
  desenho dele. A altura típica é a mediana das subformas **depois de unir as
  que se sobrepõem** — sem isso o coração seria três crescentes de 60, 65 e
  116 cm e passaria por texto de 65. O limiar é 0,5: letras de uma palavra
  ficam acima de 0,6, e o par mais apertado do próprio coração dá 0,52.
  Duas ressalvas: **quem se ENCOSTA é um logotipo só** (é por ela que os
  crescentes continuam juntos), e entre CORES diferentes a régua só vale para
  quem está EMPILHADO — assinatura fica embaixo do letreiro, metade de degradê
  fica ao lado, e separar quem corre ao lado despedaça desenho (a laranja do
  FRUTAS METZ tem catorze pares assim). O miúdo — pingo, vírgula, acento — é
  exceção pelos dois lados, área abaixo do piso de adesivo ou fração
  desprezível do parceiro: separá-lo deixa órfão ou o faz sumir.
  Foi esta régua que tirou `comércio de frutas` de dentro do `FRUTASMETZ`
  (0,35 de porte, e a caixa da cursiva é quase toda ar — 0,43 de área, acima
  do piso de 0,40 da marca multicor, era o que a deixava entrar).
- **Cores diferentes só se juntam quando as FORMAS se encostam.** A caixa não
  decide: "HORTIFRUTI" cai 99% dentro da caixa da maçã sem tocar nela — a maçã
  é um traço em C e o texto vive no vão. Já o "Ki" branco encosta no círculo
  verde, e aí é um logotipo só. O encostar é medido no CONTORNO com teste de
  cruzamento — dois contornos que se cruzam entre vértices distam ZERO, não os
  39 cm que a distância vértice-a-segmento inventava (tiles do RKO) — e o
  alcance da junção multicolor acompanha a peça: 0,6 × altura menor, entre
  8 e 12 cm; na faixa (8, 12] só junta quem compartilha fronteira de verdade.
- **Caixa sobreposta não é tinta vizinha — nem entre peças da MESMA cor.** A
  folga entre caixas é um limite inferior da distância entre tintas: duas
  caixas que se cruzam dão folga zero, e zero passa por qualquer alcance. Numa
  forma cheia isso é verdade; numa forma que é quase toda vazio, não. O brilho
  branco da onda do DiCasa é um crescente cuja CAIXA mede 144 × 99 cm e cuja
  tinta é um filete diagonal; a caixa das letras brancas do logotipo entra por
  dentro dela a 40 cm de qualquer pixel do crescente. Mesma cor (#fefefe contra
  #ffffff), folga zero, solda — e por esse fio o logotipo inteiro entrava na
  faixa: **na traseira, clicar na marca devolvia a marca e a faixa num item
  só.** Quando as caixas se sobrepõem, a cor sozinha não conclui: a tinta tem
  de estar dentro do alcance que a caixa alegou. É a mesma trava que o estágio
  de CONJUNTO já tinha (o bloco de telefone da FRICARNE 840, encaixado na quina
  da caixa do logotipo com a tinta 78 cm longe) e que faltava no de peça. O
  piso de área (90 cm²) deixa de fora o miúdo, onde a caixa é pequena o
  bastante para a sobreposição já ser prova.
- **A fusão roda até PONTO FIXO no conjunto.** Par a par não fecha cadeia: o
  predicado que falha entre dois cacos passa entre os conjuntos já fundidos.
  As guardas anti-monstro (varrer mais de 55% do eixo sem encostar em aresta;
  continência de tinta 0,9) seguram a fusão de fugir.
- **Degradê é geometria de verdade.** O fountain fill do Corel sai como
  shading (1.476 operadores em 103 dos 260 arquivos), não como faixas chapadas;
  descartá-lo deixava a lataria do SÓ MINAS com 4 itens triviais onde há ~15
  peças. O shading entra recortado pelo clip vigente, com recusa de fundo
  (clip retangular de 250 × 100 cm para cima é lataria, não adesivo).
- **Fundo é o que SANGRA — a área sozinha não prova sangria.** A pergunta "isto
  é fundo?" era feita em quatro lugares do agrupamento com uma conta (varre um
  eixo OU cobre 35% da face) e respondida no fim, na hora de declarar o
  envelopamento, com outra: lá a cláusula de área exige encostar em alguma
  aresta, porque o logotipo da FRICARNE mede 463 × 176 cm, cobre 40% da face e
  não é envelopamento nenhum. A divergência custava a face inteira do MAR & RIO:
  a peça de 447 × 163 cm que o estágio anterior montou não encosta em aresta
  nenhuma, mas cobria 39% — virava "fundo", a invariante abaixo já não separava
  nada, e o fundo d'água a engolia por continência. Agora a régua é a mesma nos
  dois lugares.
- **FUNDO COM FUNDO, ARTE COM ARTE.** Envelopamento e adesivo são naturezas
  diferentes — um SANGRA, o outro tem posição — e nenhuma evidência de
  vizinhança faz dos dois a mesma peça. Não vale a cor (a chapa verde do Ki
  está a 1,7 da assinatura verde impressa sobre ela), não vale o toque (a borda
  de um fundo varre a face e cruza tudo que passa por cima: a chapa esquerda do
  Ki termina em 553 cm, no meio da assinatura), não vale o porte (a onda preta
  do TRANSGENIO tem só 53 cm de largura e área parecida com a do bloco de
  contato que ela quase engoliu). No estágio de CONJUNTO isto é uma invariante
  que recusa antes de qualquer regra; fechar ramo a ramo não funciona, porque o
  par cai na regra seguinte e passa. Sem ela a face do Ki saía como UM item de
  1538 × 246 cm: o operador clicava na marca e recebia a carreta inteira.
- **Imagem tem moldura, não contorno** — e APARAR NA TINTA NÃO SALVA A MOLDURA.
  Metade dos logotipos entra como raster, e a caixa declarada é a do arquivo,
  com a folga transparente em volta; sem recortar a tinta por pixel, a cota
  ancora no vazio. Mas o recorte devolve outro RETÂNGULO, e o de uma onda que
  atravessa a face continua quase todo vazio: a onda do DiCasa, aparada, ia de
  0 a 263 cm e a aresta direita cruzava o logotipo que começa em 203 — contato
  zero, porte 0,42, e a marca multicor soldou os dois. Imagem de
  tamanho-sangria não entra nos testes de contorno, com ou sem recorte; o
  recorte segue valendo para a MEDIDA.
- **Caminho com subformas distantes vira vários itens.** O CorelDRAW exporta uma
  marca d'água de dois blocos como UM caminho de 24 subformas.

### 11. O que NÃO se cota

Não se cota o **tamanho** do adesivo: 10 casos em 1.697 (0,6%). Cota-se onde ele
vai, não quanto ele mede — quem corta o vinil já tem o arquivo.

Distribuição das categorias:

| categoria | contagem | |
|---|---|---|
| borda da face → item | 808 | 47,6% |
| borda da face → âncora que o motor não isola | 536 | 31,6% |
| não classificada | 245 | 14,4% |
| entre dois itens | 98 | 5,8% |
| tamanho do item | 10 | 0,6% |

Por face: mediana de **6 cotas cobrindo 2 itens** (p75: 9 cotas, 4 itens).

### 12. A linha de alinhamento — LIGADA, e a pergunta certa é sobre TINTA

Em "Supermercado" o "p" desce sozinho abaixo de todas as outras letras. Cotar
até ele dá um número certo e inútil: naquela altura não há nada para alinhar.
A referência do aplicador é a base onde S, u, e, r, m, c, a, d, o se apoiam. Do
outro lado da mesma palavra, o til de `amigão` sobe 25 cm acima das letras: a
cota do topo saía 67 quando o projetista escreveu 92.

A regra ficou **desligada por quatro tentativas**, e a razão era honesta: o
ápice de um círculo dá 75% de apoio e se disfarça de planalto, a capitular é
larga demais para o quantil e estreita demais para a moda, a cursiva não faz
planalto por subforma, e a maçã lisa faz planalto falso. Cada limiar que
resolvia um caso estragava outro.

**O que faltava não era um limiar melhor, era outra pergunta.** Não "isto parece
reto?", mas **"quanta TINTA sobra além daqui?"**. Descendente é fino por
definição — a perna do "p" desce 25% da altura e leva 3% da tinta; uma linha que
deixasse de fora um oitavo da tinta não estaria aparando exceção, estaria
cortando letra. Com esse freio (`alignmentMaxInkBeyond`, 8%) somado à contagem
de subformas distintas que param na mesma faixa e à fração de colunas que
terminam nela, o acerto foi de 30,0% para 41,1% e a **preservação do extremo,
quando é ele que vale, de 73,4% para 98,9%** — três falsos positivos em 358
âncoras, contra setenta antes.

Como o extremo é apurado hoje: uma faixa de 3,5% do tamanho da peça (com 7% o
ápice do círculo reunia 51% das colunas e passava), 160 colunas de perfil, pelo
menos 8 subformas parando na faixa — ou 2 que cubram 55% da largura, escape para
fonte de poucas peças —, 45% das colunas terminando nela, e recuo entre 8% e 40%
da altura. Peça abaixo de 8 cm ou com menos de 6 subformas é desenho, não texto,
e não tem linha a inferir. Os valores são o **preset conservador**: o preset
solto (6 subformas, 30% de colunas, 12% de tinta) dá 0,6 ponto a mais de recall
triplicando os falsos positivos — e uma linha errada corta letra, que é pior do
que não ter linha.

**Só na horizontal.** Nos lados a palavra termina numa letra só, e aparar ali
tira o "N" de GRESPAN: a cota deixa de bater com o extremo que o projetista usou
(175, medido no arquivo dele).

⚠️ A linha é apurada **por peça**, e é isso que amarra esta regra à §10: quando
o coração e a palavra do `amigão` saíam soldados, o topo do item era o til e
nenhuma varredura o recuava — a tinta do coração e das letras responde em
colunas diferentes, e 27% das colunas não fazem 45%. Separadas as peças, a
palavra recua sozinha para 91 e o coração mantém o seu 75.

### 13. A face pode vir desenhada em SEÇÕES

Nem todo molde desenha a lateral como um retângulo só. O do MACHADÃO desenha as
seções do baú encostadas uma na outra — 192 + 107 + 492 cm no motorista,
253 + 106 + 325 + 106 no sapo — com a mesma caneta, a mesma altura e as arestas
verticais compartilhadas. Cada seção virava uma "face" candidata, nenhuma casava
com a proporção de 790 × 252 que o implemento tem, e o arquivo abria só com a
**traseira** reconhecida: as duas laterais, que são onde a arte está, ficavam
de fora.

Colam-se retângulos que dividem o topo E a base, foram desenhados com a MESMA
caneta e se encostam pela lateral (folga ≤ 2 pt). Duas faces diferentes não
passam nesse crivo — a traseira tem outra altura, e o que está dentro de outra
face é aninhado, não vizinho. O piso de largura (15% da página) passou a valer
sobre a face JÁ COLADA: uma seção de 107 cm é estreita demais para ser face
sozinha, mas é parte de uma.

Nas 260 pastas do acervo isso muda **16 arquivos, e os 16 para melhor**:
MACHADÃO (2), bergamini (3), GRESPAN (3), DiCasa, FRUTAS FOLLY, FRUTAS METZ,
LOUSADA, Marquespan 566, PNAE, SEMPRE VIVA — em todos a segunda lateral vinha
como um pedaço (542 de 839, 448 de 839, 547 de 939) ou duplicada. Faces
reconhecidas em modo navegador: 629 → 606, faces sem cota nenhuma 5,7% → 4,6%,
faces com um item só 13,4% → 11,7%.

### 13-bis. A borda de baixo é a que está DESENHADA

A ponte pt ↔ cm sai da LARGURA — `ptPerCm = largura do quadro ÷ largura
informada` — e é só ela: a posição da tinta, a linha de extensão, o afastamento
da linha de cota, tudo passa por esse número. A altura informada entrava depois,
sozinha, como o valor de "y da borda de baixo". Quando as duas medidas não
fecham na mesma escala, o quadro tem uma altura e a conta tem outra, e **a reta
que deveria assentar no piso do baú assenta no ar**.

É o DiCasa 839 × 242: o desenho traz 686 pt de altura, que a 1:10 são 242 cm
redondos; o cadastro diz 241. A extensão da cota de base saía 2,9 pt acima do
traço do quadro — visível na tela e sem explicação possível para quem olha, já
que o número está certo e é a reta que não bate.

Então a face mede o que está desenhado nos DOIS eixos: a largura por construção,
a altura pela mesma régua (`altura do quadro ÷ ptPerCm`). A medida informada
continua sendo a verdade sobre o implemento, e é contra ela que
`aspectErrorPct` cobra a divergência: quem avisa que desenho e cadastro
discordam é o aviso da face, não uma cota que não fecha com o próprio traço.

⚠️ **As bancadas não medem isto.** `bench.mjs` e `grouping-bench.mjs` montam a
face a partir do NOME do arquivo ("839 - 242"), que é a mesma medida com que o
desenho foi feito — ali a divergência é sempre zero e a mudança sai neutra até
o último dígito (verificado). Quem sente é o arquivo real, com a medida que o
cadastro tem.

### 14. Não saber cotar é um defeito; impedir de medir é outro, e pior

⚠️ Esta seção descreve o motor **quando ele rodava no navegador**. Hoje ele roda
aqui, no servidor, e a web e o celular recebem o resultado pronto — o
congelamento que ela conta não pode mais acontecer na máquina de quem usa. As
correções seguem valendo (uma face patológica passou a custar 0,42 s em vez de
6,1 s, e isso agora é tempo de servidor), e o freio de mão continua sendo o que
impede um desenho impossível de ocupar um processo da API.

O cotador e a régua manual corriam na MESMA thread do navegador. Enquanto o
agrupamento trabalha, o operador não mede nada — nem à mão, que é justamente o
que ele faria para contornar uma face que o motor não entende. O MAR & RIO
custava **seis segundos** de aba congelada por arquivo, e o operador só via um
visualizador travado.

Três coisas, nesta ordem:

1. **O teste de contorno pruna antes de contar.** Ele é O(n·m) por PAR de
   itens, e o fundo d'água do MAR & RIO chega com 25 mil pontos em 299
   polígonos: eram 193 milhões de pares de segmento. Cada contorno vira trechos
   de 32 segmentos com a caixa de cada um, e dois trechos cujas caixas estão
   mais longe que o limite caem fora por uma comparação de retângulo. Todos os
   chamadores perguntam a mesma coisa — "encosta?" —, então a função só promete
   a distância REAL até o limite recebido, e é essa promessa mais fraca que
   torna a poda possível. Medido: 164,8 s → 28,9 s na bancada inteira, com
   `metrics` e `perFace` idênticos byte a byte; o pior arquivo do acervo, em
   modo navegador, caiu de 6,1 s para 0,42 s.
2. **Há um freio de mão.** Um teto de trabalho de contorno por face
   (`contourWorkBudget`, 60 M unidades — catorze vezes o pior caso do acervo,
   que gasta 4,2 M). Estourou, o agrupamento para de soldar e a face é
   declarada inutilizável. O relógio é de TRABALHO, não de parede: a mesma arte
   gasta o mesmo orçamento em qualquer máquina, e o resultado não muda conforme
   o processador.
3. **A face diz quando não dá.** `LayoutFaceResult.unusable` marca três formas
   de não dar — orçamento estourado, nenhum item reconhecido, ou UM item
   cobrindo 90% da face (o fundo que engoliu tudo). Nesses casos a face não
   publica item nem cota, o visualizador não oferece seleção, e um aviso diz
   para usar a régua. Nas 629 faces do acervo isso pega 36 (5,7%), e as 5 que
   não estavam simplesmente vazias são retângulos espúrios de 54 × 7 a
   252 × 11 cm — nenhuma face real é perdida.

## O que a bancada mede

`harness/run.mjs` roda o motor nas 325 faces e compara com o que o projetista
desenhou no mesmo arquivo.

| Métrica | Antes da linha de alinhamento | Agora |
|---|---|---|
| Cotas do projetista reproduzidas (mesmo eixo, âncoras a ≤ 4 cm, valor a ≤ 3 cm) | 33,6% | **45,0%** |
| **Cotas cujas DUAS âncoras o motor enxerga** | 57,7% | **65,0%** |
| Dessas, valor correto | 100% | **1.099 de 1.099 (100%)** |
| Idem, com o ímã manual (cada caminho isolado) | 73,5% | **78,8%** |
| Faces reproduzidas por inteiro | 13 de 325 | **27 de 325** |

A leitura certa: **quando o motor vê as duas pontas, o número está sempre
certo.** A diferença para 100% não é erro de medida, é escolha editorial — qual
das cotas visíveis vale a pena desenhar. O motor erra por excesso de propósito
(4.200 cotas contra 1.690 do projetista, porque cota TODO item): na tela só
aparecem as do adesivo escolhido, e o PDF sai com o que está na tela.

`harness/snaptest2.mjs` mede o ímã manual: com erro de mira de 3 cm e raio de
8 cm, 1.653 medições simuladas deram **77,9% exatas (≤ 1 cm)** e mediana de erro
**0,00 cm**.

## A cota gerada fica perto do item?

É a pergunta que decide se o desenho se lê. Medido em 258 faces:

| | motor | projetista |
|---|---|---|
| cotas por face | 6,0 | 6 (mediana) |
| linha DENTRO da face | 65% | 26% |
| distância linha → item (p50) | **35 cm** | 35 cm |
| idem (p90) | **59 cm** | 135 cm |
| idem (máximo) | **101 cm** | 577 cm |
| extensão encosta num adesivo | **97,6%** | 83% |

**A divergência do "dentro" é deliberada.** O projetista leva a linha para a
margem em 74% dos casos porque coloca à mão e prefere a folha limpa; o preço é
uma extensão que atravessa metade do implemento e um número que ninguém sabe de
onde saiu. O motor traz a linha para o lado do item, e isso é seguro aqui: uma
cota "topo da face → topo do item" ocupa exatamente a faixa VAZIA entre os dois,
nunca por cima da arte. O resultado é uma cauda muito mais curta — nenhuma cota
a mais de 1 m do que ela mede, contra 5,77 m do pior caso do projetista.

O que sobra de ambiguidade se resolve na tela: no visualizador, clicar num
adesivo mostra **só as cotas dele**.

O envelopamento aparece pelo **contorno real**, não pela caixa: a forma dele é
côncava (uma curva que varre a face de canto a canto) e o retângulo cobre metade
de área vazia. Com a caixa, a cota da travessia parecia não bater com o desenho
— quem não batia era a caixa.
