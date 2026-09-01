# O portão de AGRUPAMENTO

`bench.mjs` mede COTAGEM: o motor reproduziu a cota que o projetista desenhou?
Esta bancada mede outra coisa, que aquela quase não enxerga — **o que o motor
chama de UM adesivo é mesmo um adesivo?** Palavra partida ao meio, ícone
descolado do texto, faixa picada em três, item que engole o vizinho.

```sh
cd api
npx esbuild src/modules/production/layout-dimensions/engine/index.ts \
  --bundle --format=esm --platform=node \
  --external:@napi-rs/canvas --external:pdf-lib --outfile=/tmp/ldim/core.js
node src/modules/production/layout-dimensions/engine/harness/grouping-bench.mjs ~/layouts
```

⚠️ **Esta bancada roda SEM o recorte de tinta** — `bench.mjs` e
`grouping-bench.mjs` não passam `trimToInk`, então a moldura de uma imagem entra
crua. Isso já foi um problema de dois motores (o do DOM contra o do Node) e
deixou de ser: com o cotador no servidor há uma rasterização só, e
`createPageInkTrimmer` funciona aqui do mesmo jeito que em produção. O que
sobrou é uma escolha das duas bancadas — as referências foram calibradas sem o
recorte, e religá-lo recalibra tudo. **Para medir o modo entregue rode
`prodsweep.mjs`**, que monta o recortador e chama o `buildLayoutFaces` real.

Leva **~29 s** nas 467 faces dos 260 arquivos (eram 100 a 125 s antes de o teste
de contorno prunar por caixa de trecho; o preço de não decidir nada pela caixa
do item continua sendo um teste de contorno por par candidato). É determinístico
— duas passadas no mesmo bundle dão o mesmo número até a última casa
(verificado: `metrics` e `perFace` idênticos byte a byte em duas passadas).
**Reempacote antes de rodar**, senão você mede o bundle velho.

| flag | efeito |
|---|---|
| `--save` | grava como nova referência (`grouping.baseline.json`) |
| `--baseline <arq>` | compara contra outra referência |
| `--out <arq>` | grava o json desta passada sem tocar na referência |
| `--only <trecho>` | roda só nos arquivos cujo nome contém o trecho |
| `--top <n>` | quantas faces piores listar (padrão 20) |
| `--quiet` | só grava o json |
| `GROUPING=` / `DOCTRINE=` | sobrescreve parâmetros, como em `bench.mjs` |

Esta bancada **não toca** em `bench.baseline.json`. As duas referências são
independentes e as duas contam: apertar a solda melhora o agrupamento e pode
piorar a cotagem. Rode as duas.

## As duas fontes de verdade

### 1. As cotas do projetista

A ponta de cada linha de extensão azul encosta numa peça REAL — o projetista
sabia o que era um adesivo quando desenhou. A ponta é lida como em
`evidence.mjs`: a extremidade da extensão mais LONGE da linha de cota (o outro
lado é a sobra de 2,5 cm que passa da linha).

| métrica | direção | o que é |
|---|---|---|
| **grande demais** | ↓ | ponta que cai a mais de 10 cm de TODA borda da caixa de um item nosso. O item cobre a peça apontada e mais um pedaço: a cota fica sem dono. Denominador: pontas que caem em algum item |
| **picado** | ↓ | o projetista cotou a mesma peça pelos dois lados (uma cota nasce na borda mínima da face, outra morre na máxima) e entre as duas pontas o motor tem uma FILA de itens em vez de um. Denominador pequeno — o par esquerda/direita é raro |
| **âncora em fragmento** | ↓ | ponta que encosta na borda de um item que é elo de uma fila. Mesma pergunta do `picado`, com denominador 30× maior: toda ponta que encosta em borda de item vale uma medida |

O `picado` só emparelha duas cotas quando existe uma **cadeia contígua** de
itens entre as duas pontas — cada vão menor que a altura dos vizinhos, que é a
régua da própria doutrina para o que é uma peça só. Sem essa exigência o par
"borda esquerda → x" e "y → borda direita" casava adesivos que nada têm a ver
um com o outro (o AP RANCHARIA emparelhava 179 cm com 1.514 cm da mesma face).

### 2. A própria geometria

Oito detectores que não dependem de cota nenhuma, e por isso rodam nas 466
faces — inclusive nas ~170 que o projetista não cotou de forma legível por
máquina.

| detector | definição fechada |
|---|---|
| **palavra partida** | dois itens de mesma cor dominante, sobreposição vertical > 70%, alturas parecidas (≥ 50%) e vão horizontal menor que a altura deles. Conta pares ADJACENTES: nove pedaços dão oito pares |
| **órfão** | item de UMA subforma, com menos de metade da área do vizinho, colado nele (vão ≤ 3 cm ou metade da própria altura) e com 80% da própria altura dentro da faixa vertical dele |
| **monstro** | item que não encosta em aresta nenhuma e mesmo assim varre mais de 55% de um eixo da face; ou item que junta mais de três cores cujas formas não se encostam |
| **item mudo** | item que não recebe cota nenhuma. O operador clica e não vê número |
| **sem contorno** | item que ENCOSTA numa aresta da face e não traz `outlinePt`. Sai como retângulo, e a caixa mente sobre a silhueta. Denominador: só os itens que encostam em aresta |
| **peça picada** | dois itens cujos CONTORNOS se encostam (≤ 1,5 cm) e que mesmo assim saíram separados. Conta como defeito o par fundo/arte que a doutrina §10 manda separar — a arte é impressa SOBRE o fundo, então os contornos sempre se encostam. Subiu de 10,6% para 17,6% quando a invariante "fundo com fundo, arte com arte" entrou, e isso não é regressão |
| **empilhado** | item cujos GLIFOS formam duas fileiras horizontais sem sobreposição vertical, e a fileira estreita cobre menos de 70% da larga. Regra do dono: "raramente colamos 1 adesivo onde o componente abaixo não cubra a mesma largura" |
| **marca multicor** | dois itens de porte comparável e cores dominantes diferentes que se sobrepõem em ÁREA, ou ficam a menos da folga de solda da doutrina um do outro |

O número único no fim é **ITENS FERIDOS**: quantos itens estão em pelo menos um
defeito, sobre o total. É o que se olha primeiro.

## Por que os testes são de CONTORNO e não de caixa

Porque a caixa mente nos dois sentidos, e a doutrina já disse onde:

- **juntaria o que deve ficar separado** — "HORTIFRUTI" cai 99% dentro da caixa
  da maçã sem tocar nela, porque a maçã é um traço em C e o texto vive no vão;
- **separaria o que deve juntar** — o "Ki" branco encosta no círculo verde e é
  um logotipo só.

`peça picada` e `marca multicor` marcam o traço numa grade de 1 cm e perguntam
se as células se encostam. `empilhado` reagrupa as SUBFORMAS num histograma de
altura, e não as `partsCm`: no Clebin as duas linhas já se fundiram na solda e o
item sai com `parts = 1` — um detector que olhasse `partsCm` não veria nada.

## O que precisou mudar para os casos nomeados aparecerem

Cinco ajustes, cada um contra um arquivo concreto:

1. **A `marca multicor` não podia depender de sobreposição.** O degradê do
   CorelDRAW é uma pilha de formas chapadas, e a intuição diz que elas se
   sobrepõem. Medido, não: o coração do Amigão dá 0,03 de `insideFrac` e 0,00 cm
   de distância — as metades ENCOSTAM. A foice da FRICARNE dá 0,00 de
   sobreposição e **5,28 cm** de distância — um filete branco entre as metades.
   O critério virou "sobrepõe OU está a menos da folga que a própria doutrina
   usaria para soldar" (0,6 × altura, entre 1,5 e 12 cm).

2. **A razão de diagonais ≥ 0,5 não separa marca de texto-sobre-faixa.** O
   "FRIGORÍFICO" encaixado no rabo do "Carajás" passa por 0,507. Foi preciso
   somar a razão de ÁREAS ≥ 0,35, que o reprova por 0,08.

3. **O `empilhado` precisava de um mínimo de glifos por fileira.** Sem isso o
   acento do "é" da FRUTAMINA (uma subforma) e o til do "Amigão" (duas) viravam
   "fileira estreita". Com `rowMinAtoms = 3`, Clebin (10 e 21 glifos) e FRICARNE
   (25 e 16) continuam marcados e os acentos somem.

4. **O `picado` precisava da cadeia contígua** (acima), senão a taxa é ruído.

5. **O `monstro` por vão precisava excluir quem encosta em aresta.** Varrer a
   face é o ofício da arte de fundo, e o defeito dela já é contado em "sem
   contorno".

## O que a referência guarda

`grouping.baseline.json` tem `meta` (data, corpus, tempo, sha dos `.ts` do
motor, **os limiares de detecção** e os parâmetros usados), `metrics` e
`perFace` — uma linha por face com a contagem de cada defeito e o `detail` com
os índices dos itens envolvidos. É por `perFace` que se descobre QUAL face
regrediu.

**Mudar um limiar em `TH` muda a régua** e invalida a comparação. Por isso eles
vão gravados no `meta`: se a comparação parecer estranha, confira ali primeiro.

## O veredito

`filesFound`, `filesRead`, `faces`, `items`, `designerTips` são a **guarda**: se
mudarem, mudou o acervo ou a leitura, e a comparação não vale — `INCONCLUSIVO`.
Fora isso, `MELHOROU` (alguma taxa caiu, nenhuma subiu) · `PIOROU` · `MISTO` ·
`NEUTRO`.
