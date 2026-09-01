# Bancada do cotador

Scripts de medição, não de produção. Rodam em Node sobre uma pasta de PDFs de
layout reais (baixe de `/srv/files/Clientes/*/Layouts/PDFs`).

Antes de rodar, empacote o módulo — os scripts importam um bundle ESM:

```sh
cd api
npx esbuild src/modules/production/layout-dimensions/engine/index.ts \
  --bundle --format=esm --platform=node \
  --external:@napi-rs/canvas --external:pdf-lib --outfile=/tmp/ldim/core.js
node src/modules/production/layout-dimensions/engine/harness/run.mjs ~/layouts
```

⚠️ O bundle deixa `@napi-rs/canvas` e `pdf-lib` de FORA (são nativo e pesado),
então a pasta de saída precisa enxergar o `node_modules` da API — o mais simples
é `ln -s <api>/node_modules /tmp/ldim/node_modules` uma vez. Sem isso o recorte
de tinta falha em SILÊNCIO: `createPageInkTrimmer` devolve `undefined`, o
agrupamento passa a decidir pela moldura declarada da imagem, e a diferença
aparece como cota ancorada no vazio, não como erro.

`LIB` (padrão `/tmp/ldim`) e `PDFJS` são variáveis de ambiente.

| script | o que responde |
|---|---|
| `study.mjs <pasta>` | a que geometria o projetista ancora cada cota |
| `run.mjs <pasta>` | recall/precisão do cotador e cobertura das âncoras |
| `snaptest2.mjs <pasta> <mira_cm> <raio_cm>` | acerto do ímã da medição manual |
| `demo.mjs <pdf> <saída> <lado> <altura> <seções> [título]` | gera uma face cotada |
| `bench.mjs <pasta> [--save]` | portão de regressão: mede tudo, compara com `bench.baseline.json` e dá o veredito (ver `BENCH.md`) |
| `grouping-bench.mjs <pasta> [--save]` | portão do AGRUPAMENTO: taxas de palavra partida, órfão, monstro, item mudo, sem contorno, peça picada, empilhado e marca multicor, mais o que as cotas do projetista dizem sobre item grande demais e picado (ver `GROUPING.md`) |
| `prodsweep.mjs <pasta> [--out arq]` | o MOTOR ENTREGUE: rasteriza com `@napi-rs/canvas` e monta o `trimToInk` que só existe no DOM, então mede o que a tela faz — custo por arquivo, faces que devolvem a face inteira num clique, faces declaradas inutilizáveis |

`DUMP=<trecho do nome>` em `run.mjs` imprime o diff cota a cota de um arquivo.
