# O portão de regressão

`bench.mjs` roda o cotador nas 325 faces do acervo e responde uma pergunta só:
**a mudança que você acabou de fazer melhorou ou piorou?**

```sh
cd api
npx esbuild src/modules/production/layout-dimensions/engine/index.ts \
  --bundle --format=esm --platform=node \
  --external:@napi-rs/canvas --external:pdf-lib --outfile=/tmp/ldim/core.js
node src/modules/production/layout-dimensions/engine/harness/bench.mjs ~/layouts
```

Leva ~23 s e é determinístico: duas passadas no mesmo código dão o mesmo número
até a última casa (verificado — `metrics`, `breakdown` e `perFace` idênticos).
**Reempacote antes de rodar**, senão você mede o bundle velho.

| flag | efeito |
|---|---|
| `--save` | grava o resultado como nova referência (`bench.baseline.json`) |
| `--baseline <arq>` | compara contra outra referência |
| `--out <arq>` | grava o json desta passada sem tocar na referência |
| `--top <n>` | quantas faces piores listar (padrão 8) |
| `--quiet` | só grava o json, não imprime |
| `GROUPING=` / `DOCTRINE=` | sobrescreve parâmetros, como em `run.mjs` |

O fluxo de quem mexe no motor: rode uma vez antes (a referência já está
gravada), mexa, rode de novo e leia o veredito. **Só regrave a referência
(`--save`) quando a mudança for aceita.**

## Como ler a saída

### O portão

Nove métricas, cada uma com direção conhecida. Elas contam para o veredito.

| métrica | direção | o que é |
|---|---|---|
| recall editorial | ↑ | quantas das cotas que o projetista desenhou o motor reproduz (mesmo eixo, âncoras a ≤ 4 cm, valor a ≤ 3 cm) |
| valor certo c/ 2 âncoras | ↑ | das cotas cujas DUAS âncoras o motor enxerga, quantas têm o número certo. **Está em 100% e é para continuar.** Cair daqui é bug de medida, não escolha editorial |
| cobertura das 2 âncoras | ↑ | fração das cotas do projetista cujas duas pontas existem na geometria que o motor lê. É o teto do recall |
| faces 100% reproduzidas | ↑ | faces em que o motor acertou TODAS as cotas do projetista |
| pares de cota cruzados/face | ↓ | quantos pares de cota se cruzam no desenho (linha ou extensão). É o alvo direto do roteamento |
| linhas de cota cruzadas/face | ↓ | idem, só linha contra linha, ignorando extensão. Cruzar com extensão é tolerável (fio de cabelo); cruzar linha põe número em cima de número |
| pontas no vazio | ↓ | pontas de extensão que não caem em traço nenhum |
| cotas geradas ÷ do projetista | ↓ | o excesso. O dono reclama de "muitas medidas desnecessárias"; é aqui que isso aparece |

### O informativo

`precisão bruta`, `cobertura com pool ampliado`, `cotas por face`,
`pontas na tinta`, `pontas na moldura de imagem`. Não contam no veredito porque
não têm direção honesta. Precisão cai por escolha editorial, não por erro. E
`pontas na moldura` mede uma condição da bancada, não da produção: a bancada não
rasteriza a página, então a caixa da imagem entra crua — em produção
`inline-pdf-viewer.tsx` passa `createPageInkTrimmer` e a moldura já vem
encolhida até a tinta. Serve como sinal de deriva, não como defeito.

### A guarda

`filesFound`, `filesRead`, `faces`, `designerDims`. **Têm de ficar iguais.**
Se mudarem, mudou o acervo ou a leitura das cotas do projetista — e aí a
comparação com a referência não vale nada. O veredito vira `INCONCLUSIVO`.

### O veredito

`MELHOROU` (subiu algo, não caiu nada) · `PIOROU` · `MISTO` (lista os dois
lados, a troca é sua) · `NEUTRO` · `INCONCLUSIVO` (a guarda quebrou).

## Como as três métricas novas são calculadas

Elas não existiam em `run.mjs`; foram feitas para quem vai mexer no roteamento.

**Cruzamento.** Cada cota vira três segmentos: a linha (de `aCm` a `bCm`, na
altura `offsetCm`) e as duas extensões, que saem de `tieCm` e passam 2,5 cm da
linha — a sobra medida no material do projetista. Dois segmentos perpendiculares
se cruzam quando a interseção cai a mais de 0,5 cm de ambas as pontas; a margem
existe para não contar como sujeira o encosto em T de duas cotas que
compartilham a mesma âncora, que é convergência e não bagunça.

**Ponta no vazio.** A tinta da face vira uma grade de 2 cm marcada ao longo de
cada contorno vetorial (os PDFs vêm do CorelDRAW e o letreiro chega como curva,
não como texto — a grade é o glifo de verdade, não a caixa dele). Cada ponta é
classificada em quatro:

- `edge` — na borda da face. Referência legítima, é de onde a cota parte.
- `ink` — em traço desenhado. A cota se explica sozinha.
- `frame` — dentro da caixa de uma IMAGEM, sem traço embaixo. É a "moldura, não
  contorno" da doutrina: o raster carrega a folga transparente e a seta aponta
  para ela. Some ligando `trimToInk` em `buildStickers`.
- `void` — nem borda, nem traço, nem moldura.

Testar contra a CAIXA da peça daria zero por construção — a caixa sempre contém
a ponta — e não diria nada. Por isso o teste é contra o traço.

**Excesso.** `generatedDims ÷ designerDims` no mesmo conjunto de faces, mais a
mediana de `gen − ref` por face. Serve de contrapeso: apertar o filtro melhora o
excesso e piora o recall, e as duas métricas juntas mostram a troca.

## O que a referência guarda hoje

`bench.baseline.json` tem `meta` (data, corpus, sha dos `.ts` do motor, os
parâmetros usados), `metrics`, `breakdown` (cobertura, por que cada cota do
projetista escapou, que tipo de cota sobrou) e `perFace` — uma linha por face,
com cruzamentos e pontas no vazio. É por `perFace` que se descobre QUAL face
regrediu, não só que o total piorou.

---

## O outro portão: AGRUPAMENTO

Esta bancada mede COTAGEM. Os defeitos que o dono está vendo agora — palavra
partida ao meio, ícone separado do texto, faixa picada em três — são de
AGRUPAMENTO, e aqui eles quase não aparecem: uma cota pode bater com o
projetista enquanto o item que ela mede está picado em nove pedaços.

`grouping-bench.mjs` é o portão desses defeitos, com referência própria em
`grouping.baseline.json`. Leia `GROUPING.md`.

```sh
node src/modules/production/layout-dimensions/engine/harness/grouping-bench.mjs ~/layouts
```

**Rode os dois.** Apertar a solda melhora o agrupamento e pode piorar a
cotagem; só as duas referências juntas mostram a troca.
