# Simulação Anual dos Agendamentos de Pedido

Período simulado: **26/05/2026 → 26/05/2027** (365 dias)
Gerado em 26/05/2026 22:07

## Metodologia

- **Consumo modelado**: base = `monthlyConsumption` do item (estimativa do sistema; se 0, usa a média dos últimos 12 meses de saídas). A cada mês aplica-se uma **tendência** por item (entre −15% e +25% ao ano) e uma **variação mês-a-mês** (coeficiente de variação medido do histórico quando há ≥3 meses, senão por classe XYZ: X≈12%, Y≈30%, Z≈55%). Determinístico (semente por item) → reproduzível.
- **Quantidade pedida**: mesma fórmula do scheduler de produção — `alvo = consumoDiário × (coberturaDias + leadTime + ⌈cobertura×fatorSegurança⌉) − estoque − emTrânsito`, limitada ao `maxQuantity`, arredondada à caixa, e o item é ignorado se `monthlyConsumption ≤ 0` (comportamento real do sistema).
- **Chegada**: cada pedido chega `leadTime` dias após o disparo (paints/Farben ≈18d, Adere/Estopa/Dislon ≈25d, parafusos/embalagens ≈1d) e repõe o estoque na data de chegada.
- **Sazonalidade**: desligada nesta simulação (fator 1) para legibilidade.

## Resumo Executivo

- Agendamentos ativos: **12** · Itens nos agendamentos: **133** (com consumo modelado: **106**)
- Disparos no período: **93** · Linhas de pedido geradas: **444**
- **Gasto total simulado: R$ 1.258.029,63**
- Itens que zeraram estoque em algum momento (ruptura): **47**
- ⚠️ Itens consumidos mas **nunca pedidos** (mc=0 → não entram no cálculo): **29**

### Gasto por fornecedor

| Fornecedor | Linhas | Gasto no ano |
|---|---:|---:|
| Farben (Ronaldo) | 373 | R$ 1.023.239,93 |
| Adere (Alex) | 12 | R$ 129.673,00 |
| Casa dos Parafusos (Maicon) | 28 | R$ 77.004,30 |
| Brasil Sul Estopas | 12 | R$ 12.060,00 |
| Bolinha Embalagens (Ibiporã) | 10 | R$ 7.094,00 |
| Dislon | 6 | R$ 6.371,20 |
| — | 3 | R$ 2.587,20 |

## Leitura dos Resultados

As 47 rupturas se dividem em três causas distintas:

1. **Itens nunca pedidos (mc=0): 20 itens.** Têm consumo histórico mas `monthlyConsumption = 0`, então o cálculo automático os ignora — zeram e ficam zerados o ano todo. **Causa raiz: configuração de consumo**, não a lógica de pedido. Ação: recomputar/definir o consumo desses itens (ou revisar por que o histórico não gerou mc).
2. **Itens pedidos, ruptura só na PARTIDA: 15 itens.** Só faltam nos primeiros ~60 dias porque os agendamentos só disparam em jun/jul/ago e o estoque atual de itens de alto giro não chega até a 1ª entrega. **Ação: uma execução manual ("Executar agora") agora**, para a ponte até o 1º ciclo — exatamente o caso de uso do gap-coverage.
3. **Itens pedidos, ruptura em REGIME: 12 itens** (1 com >20 dias/ano). A maioria tem só 2–8 dias/ano — ruído de variabilidade (o consumo real do mês superou pontualmente a estimativa). Os relevantes são os de **ciclo longo + lead longo** (a cada 3 meses, lead 25d), como Abraçadeira Nylon Natural e Máscara: o ciclo de 90 dias com 25d de lead fica apertado sob variação. **Ação: encurtar o ciclo desses ou aumentar o fator de segurança.**

**Conclusão:** a lógica de cobertura em regime é sólida (rupturas de regime são majoritariamente ruído de poucos dias). O grosso do risco real é (1) itens com mc=0 e (2) a ponte de partida — ambos endereçáveis sem mudar a fórmula.

## Detalhe por Agendamento (ciclos e pedidos)

### Adere — Fitas — Adere (Alex) (a cada 3 mês(es))

Gasto no ano: **R$ 95.354,10** · Linhas: 4

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 13/07/26 | Fita Crepe Automotiva | 425 | 0 | 3720 | 07/08/26 (+25d) | 3720 | R$ 39.022,80 |
| 13/10/26 | Fita Crepe Automotiva | 425 | 2429.13 | 1290 | 07/11/26 (+25d) | 3159.04 | R$ 13.532,10 |
| 13/01/27 | Fita Crepe Automotiva | 425 | 1558.46 | 2160 | 07/02/27 (+25d) | 3211.69 | R$ 22.658,40 |
| 13/04/27 | Fita Crepe Automotiva | 425 | 1803.98 | 1920 | 08/05/27 (+25d) | 3133.32 | R$ 20.140,80 |

### Adere — Máscaras — Adere (Alex) (a cada 3 mês(es))

Gasto no ano: **R$ 34.318,90** · Linhas: 8

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 11/08/26 | Máscara | 328 | 61.42 | 15 | 05/09/26 (+25d) | 63.68 | R$ 3.342,75 |
| 11/08/26 | Máscara | 321 | 0 | 47 | 05/09/26 (+25d) | 47 | R$ 0,00 |
| 11/11/26 | Máscara | 328 | 30.84 | 46 | 06/12/26 (+25d) | 64.71 | R$ 10.251,10 |
| 11/11/26 | Máscara | 321 | 28.57 | 19 | 06/12/26 (+25d) | 42.13 | R$ 0,00 |
| 11/02/27 | Máscara | 328 | 28.86 | 48 | 08/03/27 (+25d) | 63.05 | R$ 10.696,80 |
| 11/02/27 | Máscara | 321 | 29.25 | 18 | 08/03/27 (+25d) | 41.14 | R$ 0,00 |
| 11/05/27 | Máscara | 328 | 31.58 | 45 | 05/06/27 (+25d) | — (após horizonte) | R$ 10.028,25 |
| 11/05/27 | Máscara | 321 | 26.04 | 21 | 05/06/27 (+25d) | — (após horizonte) | R$ 0,00 |

### Bolinha Embalagens — Geral — Bolinha Embalagens (Ibiporã) (a cada 2 mês(es))

Gasto no ano: **R$ 7.094,00** · Linhas: 10

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 20/06/26 | Caixa Luva Látex-M | Branca c/pó | 0 | 100 | 21/06/26 (+1d) | 100 | R$ 2.590,00 |
| 20/06/26 | Copo Cristal 145ml | C/500 | 0.97 | 500 | 21/06/26 (+1d) | 500.93 | R$ 1.250,00 |
| 20/06/26 | Pacote Saco de Lixo 200 lts | C/100 | 5.22 | 1 | 21/06/26 (+1d) | 6.15 | R$ 131,00 |
| 20/08/26 | Bobina Plástico Bolha | — | 0.41 | 1 | 21/08/26 (+1d) | 1.41 | R$ 55,00 |
| 20/08/26 | Pacote Saco de Lixo 200 lts | C/100 | 1.61 | 4 | 21/08/26 (+1d) | 5.53 | R$ 524,00 |
| 20/10/26 | Pacote Saco de Lixo 200 lts | C/100 | 1 | 5 | 21/10/26 (+1d) | 5.93 | R$ 655,00 |
| 20/12/26 | Pacote Saco de Lixo 200 lts | C/100 | 1.45 | 5 | 21/12/26 (+1d) | 6.37 | R$ 655,00 |
| 20/02/27 | Bobina Plástico Bolha | — | 0.14 | 1 | 21/02/27 (+1d) | 1.13 | R$ 55,00 |
| 20/02/27 | Pacote Saco de Lixo 200 lts | C/100 | 1.54 | 5 | 21/02/27 (+1d) | 6.47 | R$ 655,00 |
| 20/04/27 | Pacote Saco de Lixo 200 lts | C/100 | 1.61 | 4 | 21/04/27 (+1d) | 5.52 | R$ 524,00 |

### Casa do Soldador - Fita Amarela — — (a cada 2 mês(es))

Gasto no ano: **R$ 2.587,20** · Linhas: 3

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 20/12/26 | Fita Crepe Amarela | — | 116.09 | 192 | 03/01/27 (+14d) | 269.88 | R$ 1.034,88 |
| 20/02/27 | Fita Crepe Amarela | — | 161.49 | 96 | 06/03/27 (+14d) | 225.12 | R$ 517,44 |
| 20/04/27 | Fita Crepe Amarela | — | 112.81 | 192 | 04/05/27 (+14d) | 271.36 | R$ 1.034,88 |

### Casa dos Parafusos — Geral — Casa dos Parafusos (Maicon) (a cada 2 mês(es))

Gasto no ano: **R$ 77.004,30** · Linhas: 28

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 20/06/26 | Abraçadeira Nylon Natural | 200x4,8mm | 0 | 294 | 21/06/26 (+1d) | 294 | R$ 3.148,74 |
| 20/06/26 | Abraçadeira Nylon Preta | 200x4,6mm | 0 | 1100 | 21/06/26 (+1d) | 1100 | R$ 11.781,00 |
| 20/06/26 | Rebite de Repuxo 516 | — | 0 | 633 | 21/06/26 (+1d) | 633 | R$ 94,95 |
| 20/06/26 | Rebite de Repuxo 525 | — | 148.31 | 849 | 21/06/26 (+1d) | 984.51 | R$ 178,29 |
| 20/08/26 | Abraçadeira Nylon Natural | 200x4,8mm | 36.55 | 257 | 21/08/26 (+1d) | 289.45 | R$ 2.752,47 |
| 20/08/26 | Abraçadeira Nylon Preta | 200x4,6mm | 280.02 | 800 | 21/08/26 (+1d) | 1069.54 | R$ 8.568,00 |
| 20/08/26 | Rebite de Repuxo 516 | — | 171.23 | 462 | 21/08/26 (+1d) | 625.82 | R$ 69,30 |
| 20/08/26 | Rebite de Repuxo 525 | — | 254.95 | 743 | 21/08/26 (+1d) | 986.68 | R$ 156,03 |
| 20/10/26 | Abraçadeira Nylon Natural | 200x4,8mm | 48.27 | 246 | 21/10/26 (+1d) | 288.99 | R$ 2.634,66 |
| 20/10/26 | Abraçadeira Nylon Preta | 200x4,6mm | 448.96 | 600 | 21/10/26 (+1d) | 1034.52 | R$ 6.426,00 |
| 20/10/26 | Abraçadeira Nylon Preta | 300x7,2mm | 2.1 | 1 | 21/10/26 (+1d) | 3.07 | R$ 31,41 |
| 20/10/26 | Rebite de Repuxo 516 | — | 163.5 | 470 | 21/10/26 (+1d) | 626.01 | R$ 70,50 |
| 20/10/26 | Rebite de Repuxo 525 | — | 292.4 | 705 | 21/10/26 (+1d) | 986.73 | R$ 148,05 |
| 20/12/26 | Abraçadeira Nylon Natural | 200x4,8mm | 5.31 | 289 | 21/12/26 (+1d) | 289.74 | R$ 3.095,19 |
| 20/12/26 | Abraçadeira Nylon Preta | 200x4,6mm | 80.85 | 1000 | 21/12/26 (+1d) | 1064 | R$ 10.710,00 |
| 20/12/26 | Abraçadeira Nylon Preta | 300x7,2mm | 0.97 | 2 | 21/12/26 (+1d) | 2.93 | R$ 62,82 |
| 20/12/26 | Rebite de Repuxo 516 | — | 177.12 | 456 | 21/12/26 (+1d) | 625.66 | R$ 68,40 |
| 20/12/26 | Rebite de Repuxo 525 | — | 324.17 | 674 | 21/12/26 (+1d) | 987.05 | R$ 141,54 |
| 20/02/27 | Abraçadeira Nylon Natural | 200x4,8mm | 32.8 | 261 | 21/02/27 (+1d) | 289.41 | R$ 2.795,31 |
| 20/02/27 | Abraçadeira Nylon Preta | 200x4,6mm | 4.68 | 1100 | 21/02/27 (+1d) | 1100 | R$ 11.781,00 |
| 20/02/27 | Abraçadeira Nylon Preta | 300x7,2mm | 0.7 | 2 | 21/02/27 (+1d) | 2.66 | R$ 62,82 |
| 20/02/27 | Rebite de Repuxo 516 | — | 154.97 | 478 | 21/02/27 (+1d) | 625.14 | R$ 71,70 |
| 20/02/27 | Rebite de Repuxo 525 | — | 287.12 | 711 | 21/02/27 (+1d) | 986.45 | R$ 149,31 |
| 20/04/27 | Abraçadeira Nylon Natural | 200x4,8mm | 0 | 294 | 21/04/27 (+1d) | 294 | R$ 3.148,74 |
| 20/04/27 | Abraçadeira Nylon Preta | 200x4,6mm | 298.81 | 800 | 21/04/27 (+1d) | 1089.37 | R$ 8.568,00 |
| 20/04/27 | Abraçadeira Nylon Preta | 300x7,2mm | 0.5 | 3 | 21/04/27 (+1d) | 3.47 | R$ 94,23 |
| 20/04/27 | Rebite de Repuxo 516 | — | 166.27 | 467 | 21/04/27 (+1d) | 625.65 | R$ 70,05 |
| 20/04/27 | Rebite de Repuxo 525 | — | 398.35 | 599 | 21/04/27 (+1d) | 987.14 | R$ 125,79 |

### Dislon - Scotch Brite — Dislon (a cada 2 mês(es))

Gasto no ano: **R$ 6.371,20** · Linhas: 6

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 20/06/26 | Scotch Brite | AMF | 260.99 | 814 | 15/07/26 (+25d) | 840.68 | R$ 1.473,34 |
| 20/08/26 | Scotch Brite | AMF | 512.04 | 563 | 14/09/26 (+25d) | 845.68 | R$ 1.019,03 |
| 20/10/26 | Scotch Brite | AMF | 519.93 | 555 | 14/11/26 (+25d) | 851.21 | R$ 1.004,55 |
| 20/12/26 | Scotch Brite | AMF | 533.57 | 541 | 14/01/27 (+25d) | 860.17 | R$ 979,21 |
| 20/02/27 | Scotch Brite | AMF | 529.82 | 545 | 17/03/27 (+25d) | 858.19 | R$ 986,45 |
| 20/04/27 | Scotch Brite | AMF | 572.88 | 502 | 15/05/27 (+25d) | 868.67 | R$ 908,62 |

### Estopa — Brasil Sul — Brasil Sul Estopas (a cada 2 mês(es))

Gasto no ano: **R$ 12.060,00** · Linhas: 12

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 20/06/26 | Estopa de Pano | 1Kg | 238.89 | 140 | 15/07/26 (+25d) | 307.61 | R$ 1.260,00 |
| 20/06/26 | Pacote Estopa | — | 3.04 | 100 | 15/07/26 (+25d) | 100 | R$ 900,00 |
| 20/08/26 | Estopa de Pano | 1Kg | 200.84 | 180 | 14/09/26 (+25d) | 307.07 | R$ 1.620,00 |
| 20/08/26 | Pacote Estopa | — | 73.76 | 40 | 14/09/26 (+25d) | 92.24 | R$ 360,00 |
| 20/10/26 | Estopa de Pano | 1Kg | 216.06 | 160 | 14/11/26 (+25d) | 298.75 | R$ 1.440,00 |
| 20/10/26 | Pacote Estopa | — | 64.47 | 40 | 14/11/26 (+25d) | 89.69 | R$ 360,00 |
| 20/12/26 | Estopa de Pano | 1Kg | 181.87 | 200 | 14/01/27 (+25d) | 306.87 | R$ 1.800,00 |
| 20/12/26 | Pacote Estopa | — | 63.25 | 40 | 14/01/27 (+25d) | 85.13 | R$ 360,00 |
| 20/02/27 | Estopa de Pano | 1Kg | 204.49 | 160 | 17/03/27 (+25d) | 289.26 | R$ 1.440,00 |
| 20/02/27 | Pacote Estopa | — | 65.61 | 40 | 17/03/27 (+25d) | 91.07 | R$ 360,00 |
| 20/04/27 | Estopa de Pano | 1Kg | 182.13 | 200 | 15/05/27 (+25d) | 311.55 | R$ 1.800,00 |
| 20/04/27 | Pacote Estopa | — | 69.9 | 40 | 15/05/27 (+25d) | 95.92 | R$ 360,00 |

### Farben — Bases — Farben (Ronaldo) (a cada 1 mês(es))

Gasto no ano: **R$ 302.280,60** · Linhas: 55

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 06/07/26 | Base Branca | ANC50 | 0 | 60 | 24/07/26 (+18d) | 60 | R$ 8.293,80 |
| 06/07/26 | Branco Acrilico Puro | 536.1080 | 11.72 | 52 | 24/07/26 (+18d) | 52.03 | R$ 8.211,32 |
| 06/07/26 | Clear Acrilico | APA85 | 8.09 | 56 | 24/07/26 (+18d) | 56 | R$ 5.903,52 |
| 06/07/26 | Clear Laca | ANC55 | 0 | 240 | 24/07/26 (+18d) | 240 | R$ 30.494,40 |
| 06/07/26 | Clear Poliester | APE75 | 27.06 | 4 | 24/07/26 (+18d) | 25.05 | R$ 445,68 |
| 06/08/26 | Base Branca | ANC50 | 44.37 | 16 | 24/08/26 (+18d) | 38.7 | R$ 2.211,68 |
| 06/08/26 | Branco Acrilico Puro | 536.1080 | 43.39 | 20 | 24/08/26 (+18d) | 50.96 | R$ 3.158,20 |
| 06/08/26 | Clear Acrilico | APA85 | 42.17 | 24 | 24/08/26 (+18d) | 43.83 | R$ 2.530,08 |
| 06/08/26 | Clear Laca | ANC55 | 203.33 | 36 | 24/08/26 (+18d) | 184.41 | R$ 4.574,16 |
| 06/08/26 | Clear Poliester | APE75 | 19.48 | 12 | 24/08/26 (+18d) | 21.08 | R$ 1.337,04 |
| 06/09/26 | Base Branca | ANC50 | 25.09 | 36 | 24/09/26 (+18d) | 46.8 | R$ 4.976,28 |
| 06/09/26 | Branco Acrilico Puro | 536.1080 | 42.63 | 20 | 24/09/26 (+18d) | 52.49 | R$ 3.158,20 |
| 06/09/26 | Clear Acrilico | APA85 | 28.41 | 36 | 24/09/26 (+18d) | 44.66 | R$ 3.795,12 |
| 06/09/26 | Clear Laca | ANC55 | 143.03 | 96 | 24/09/26 (+18d) | 177.95 | R$ 12.197,76 |
| 06/09/26 | Clear Poliester | APE75 | 13.8 | 16 | 24/09/26 (+18d) | 20.25 | R$ 1.782,72 |
| 06/10/26 | Base Branca | ANC50 | 37.42 | 24 | 24/10/26 (+18d) | 47.64 | R$ 3.317,52 |
| 06/10/26 | Branco Acrilico Puro | 536.1080 | 44.65 | 20 | 24/10/26 (+18d) | 50.63 | R$ 3.158,20 |
| 06/10/26 | Clear Acrilico | APA85 | 32.85 | 32 | 24/10/26 (+18d) | 50.02 | R$ 3.373,44 |
| 06/10/26 | Clear Laca | ANC55 | 142.45 | 96 | 24/10/26 (+18d) | 196.2 | R$ 12.197,76 |
| 06/10/26 | Clear Poliester | APE75 | 14.28 | 16 | 24/10/26 (+18d) | 22.19 | R$ 1.782,72 |
| 06/11/26 | Base Branca | ANC50 | 36.06 | 24 | 24/11/26 (+18d) | 40.46 | R$ 3.317,52 |
| 06/11/26 | Branco Acrilico Puro | 536.1080 | 40.14 | 24 | 24/11/26 (+18d) | 48.84 | R$ 3.789,84 |
| 06/11/26 | Clear Acrilico | APA85 | 40.29 | 24 | 24/11/26 (+18d) | 53.01 | R$ 2.530,08 |
| 06/11/26 | Clear Laca | ANC55 | 160.01 | 80 | 24/11/26 (+18d) | 177.37 | R$ 10.164,80 |
| 06/11/26 | Clear Poliester | APE75 | 16.29 | 16 | 24/11/26 (+18d) | 24.01 | R$ 1.782,72 |
| 06/12/26 | Base Branca | ANC50 | 27.59 | 32 | 24/12/26 (+18d) | 40.72 | R$ 4.423,36 |
| 06/12/26 | Branco Acrilico Puro | 536.1080 | 38.79 | 24 | 24/12/26 (+18d) | 48.03 | R$ 3.789,84 |
| 06/12/26 | Clear Acrilico | APA85 | 45.21 | 20 | 24/12/26 (+18d) | 52.91 | R$ 2.108,40 |
| 06/12/26 | Clear Laca | ANC55 | 132.18 | 108 | 24/12/26 (+18d) | 165.21 | R$ 13.722,48 |
| 06/12/26 | Clear Poliester | APE75 | 17.97 | 12 | 24/12/26 (+18d) | 19.83 | R$ 1.337,04 |
| 06/01/27 | Base Branca | ANC50 | 29.77 | 32 | 24/01/27 (+18d) | 52.55 | R$ 4.423,36 |
| 06/01/27 | Branco Acrilico Puro | 536.1080 | 37.69 | 24 | 24/01/27 (+18d) | 48.1 | R$ 3.789,84 |
| 06/01/27 | Clear Acrilico | APA85 | 42.35 | 24 | 24/01/27 (+18d) | 48.01 | R$ 2.530,08 |
| 06/01/27 | Clear Laca | ANC55 | 114.85 | 124 | 24/01/27 (+18d) | 177.51 | R$ 15.755,44 |
| 06/01/27 | Clear Poliester | APE75 | 13.84 | 16 | 24/01/27 (+18d) | 24.53 | R$ 1.782,72 |
| 06/02/27 | Base Branca | ANC50 | 43.78 | 16 | 24/02/27 (+18d) | 42.96 | R$ 2.211,68 |
| 06/02/27 | Branco Acrilico Puro | 536.1080 | 37.91 | 24 | 24/02/27 (+18d) | 46.98 | R$ 3.789,84 |
| 06/02/27 | Clear Acrilico | APA85 | 33.03 | 32 | 24/02/27 (+18d) | 40.42 | R$ 3.373,44 |
| 06/02/27 | Clear Laca | ANC55 | 133.78 | 104 | 24/02/27 (+18d) | 178.52 | R$ 13.214,24 |
| 06/02/27 | Clear Poliester | APE75 | 19.38 | 12 | 24/02/27 (+18d) | 21.36 | R$ 1.337,04 |
| 06/03/27 | Base Branca | ANC50 | 32.29 | 28 | 24/03/27 (+18d) | 38.71 | R$ 3.870,44 |
| 06/03/27 | Branco Acrilico Puro | 536.1080 | 38.52 | 24 | 24/03/27 (+18d) | 47.01 | R$ 3.789,84 |
| 06/03/27 | Clear Acrilico | APA85 | 27.82 | 40 | 24/03/27 (+18d) | 47.06 | R$ 4.216,80 |
| 06/03/27 | Clear Laca | ANC55 | 145.71 | 92 | 24/03/27 (+18d) | 178.87 | R$ 11.689,52 |
| 06/03/27 | Clear Poliester | APE75 | 16.22 | 16 | 24/03/27 (+18d) | 23.73 | R$ 1.782,72 |
| 06/04/27 | Base Branca | ANC50 | 22.71 | 36 | 24/04/27 (+18d) | 36 | R$ 4.976,28 |
| 06/04/27 | Branco Acrilico Puro | 536.1080 | 37.58 | 24 | 24/04/27 (+18d) | 52.47 | R$ 3.789,84 |
| 06/04/27 | Clear Acrilico | APA85 | 30.25 | 36 | 24/04/27 (+18d) | 38.92 | R$ 3.795,12 |
| 06/04/27 | Clear Laca | ANC55 | 126.45 | 112 | 24/04/27 (+18d) | 143.89 | R$ 14.230,72 |
| 06/04/27 | Clear Poliester | APE75 | 17.37 | 12 | 24/04/27 (+18d) | 20.02 | R$ 1.337,04 |
| 06/05/27 | Base Branca | ANC50 | 23.58 | 36 | 24/05/27 (+18d) | 47.19 | R$ 4.976,28 |
| 06/05/27 | Branco Acrilico Puro | 536.1080 | 45.71 | 16 | 24/05/27 (+18d) | 50.15 | R$ 2.526,56 |
| 06/05/27 | Clear Acrilico | APA85 | 23.09 | 44 | 24/05/27 (+18d) | 48.35 | R$ 4.638,48 |
| 06/05/27 | Clear Laca | ANC55 | 91.98 | 148 | 24/05/27 (+18d) | 185.52 | R$ 18.804,88 |
| 06/05/27 | Clear Poliester | APE75 | 13.76 | 16 | 24/05/27 (+18d) | 20.29 | R$ 1.782,72 |

### Farben — Diluentes — Farben (Ronaldo) (a cada 1 mês(es))

Gasto no ano: **R$ 118.058,73** · Linhas: 22

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 06/07/26 | Desengraxante | 559.500 | 177.12 | 564 | 24/07/26 (+18d) | 607.76 | R$ 8.634,84 |
| 06/07/26 | Diluente | 558.400 | 0 | 156 | 24/07/26 (+18d) | 156 | R$ 15.077,21 |
| 06/08/26 | Desengraxante | 559.500 | 509.22 | 228 | 24/08/26 (+18d) | 595.88 | R$ 3.490,68 |
| 06/08/26 | Diluente | 558.400 | 134.57 | 24 | 24/08/26 (+18d) | 123.58 | R$ 2.319,57 |
| 06/09/26 | Desengraxante | 559.500 | 504.98 | 240 | 24/09/26 (+18d) | 643.89 | R$ 3.674,40 |
| 06/09/26 | Diluente | 558.400 | 97.7 | 60 | 24/09/26 (+18d) | 120.52 | R$ 5.798,93 |
| 06/10/26 | Desengraxante | 559.500 | 561.11 | 180 | 24/10/26 (+18d) | 584.64 | R$ 2.755,80 |
| 06/10/26 | Diluente | 558.400 | 95.66 | 60 | 24/10/26 (+18d) | 118.23 | R$ 5.798,93 |
| 06/11/26 | Desengraxante | 559.500 | 492.3 | 252 | 24/11/26 (+18d) | 662.21 | R$ 3.858,12 |
| 06/11/26 | Diluente | 558.400 | 89.58 | 68 | 24/11/26 (+18d) | 114.32 | R$ 6.572,12 |
| 06/12/26 | Desengraxante | 559.500 | 590.14 | 156 | 24/12/26 (+18d) | 601.61 | R$ 2.388,36 |
| 06/12/26 | Diluente | 558.400 | 84.49 | 72 | 24/12/26 (+18d) | 109.66 | R$ 6.958,71 |
| 06/01/27 | Desengraxante | 559.500 | 484.86 | 252 | 24/01/27 (+18d) | 547.81 | R$ 3.858,12 |
| 06/01/27 | Diluente | 558.400 | 79.24 | 80 | 24/01/27 (+18d) | 124.68 | R$ 7.731,90 |
| 06/02/27 | Desengraxante | 559.500 | 430.89 | 312 | 24/02/27 (+18d) | 624.44 | R$ 4.776,72 |
| 06/02/27 | Diluente | 558.400 | 97.44 | 60 | 24/02/27 (+18d) | 114.65 | R$ 5.798,93 |
| 06/03/27 | Desengraxante | 559.500 | 547.64 | 192 | 24/03/27 (+18d) | 581.58 | R$ 2.939,52 |
| 06/03/27 | Diluente | 558.400 | 95.3 | 64 | 24/03/27 (+18d) | 132.41 | R$ 6.185,52 |
| 06/04/27 | Desengraxante | 559.500 | 459.62 | 288 | 24/04/27 (+18d) | 561.46 | R$ 4.409,28 |
| 06/04/27 | Diluente | 558.400 | 110.73 | 48 | 24/04/27 (+18d) | 123.69 | R$ 4.639,14 |
| 06/05/27 | Desengraxante | 559.500 | 441.55 | 300 | 24/05/27 (+18d) | 570.5 | R$ 4.593,00 |
| 06/05/27 | Diluente | 558.400 | 97.39 | 60 | 24/05/27 (+18d) | 111.75 | R$ 5.798,93 |

### Farben — Endurecedores + Vernizes — Farben (Ronaldo) (a cada 1 mês(es))

Gasto no ano: **R$ 378.704,27** · Linhas: 43

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 13/07/26 | Endurecedor Pu | 573.950 | 0 | 792 | 31/07/26 (+18d) | 792 | R$ 48.247,05 |
| 13/07/26 | Endurecedor Pu | 573.009 | 2.81 | 18 | 31/07/26 (+18d) | 18 | R$ 1.028,52 |
| 13/07/26 | Verniz | 543.850 | 14.96 | 56 | 31/07/26 (+18d) | 57.02 | R$ 12.031,90 |
| 13/07/26 | Verniz Pu Acrilico | 543.950 | 0 | 128 | 31/07/26 (+18d) | 128 | R$ 20.203,29 |
| 13/08/26 | Endurecedor Pu | 573.950 | 665.46 | 126 | 31/08/26 (+18d) | 617.07 | R$ 7.675,67 |
| 13/08/26 | Endurecedor Pu | 573.009 | 15.71 | 6 | 31/08/26 (+18d) | 18.53 | R$ 342,84 |
| 13/08/26 | Verniz | 543.850 | 50 | 20 | 31/08/26 (+18d) | 60.64 | R$ 4.297,11 |
| 13/08/26 | Verniz Pu Acrilico | 543.950 | 108.21 | 20 | 31/08/26 (+18d) | 101.44 | R$ 3.156,76 |
| 13/09/26 | Endurecedor Pu | 573.950 | 492.22 | 300 | 01/10/26 (+18d) | 619.47 | R$ 18.275,40 |
| 13/09/26 | Endurecedor Pu | 573.009 | 16.4 | 6 | 01/10/26 (+18d) | 19.46 | R$ 342,84 |
| 13/09/26 | Verniz | 543.850 | 52.59 | 20 | 01/10/26 (+18d) | 61.29 | R$ 4.297,11 |
| 13/09/26 | Verniz Pu Acrilico | 543.950 | 76.2 | 52 | 01/10/26 (+18d) | 92.56 | R$ 8.207,59 |
| 13/10/26 | Endurecedor Pu | 573.950 | 530.72 | 264 | 31/10/26 (+18d) | 661.6 | R$ 16.082,35 |
| 13/10/26 | Endurecedor Pu | 573.009 | 17.47 | 6 | 31/10/26 (+18d) | 20.5 | R$ 342,84 |
| 13/10/26 | Verniz | 543.850 | 54.76 | 16 | 31/10/26 (+18d) | 60.98 | R$ 3.437,68 |
| 13/10/26 | Verniz Pu Acrilico | 543.950 | 75.88 | 52 | 31/10/26 (+18d) | 102.85 | R$ 8.207,59 |
| 13/11/26 | Endurecedor Pu | 573.950 | 535.76 | 258 | 01/12/26 (+18d) | 616.09 | R$ 15.716,84 |
| 13/11/26 | Endurecedor Pu | 573.009 | 17.89 | 6 | 01/12/26 (+18d) | 20.22 | R$ 342,84 |
| 13/11/26 | Verniz | 543.850 | 53.52 | 16 | 01/12/26 (+18d) | 59.14 | R$ 3.437,68 |
| 13/11/26 | Verniz Pu Acrilico | 543.950 | 80.82 | 48 | 01/12/26 (+18d) | 97.86 | R$ 7.576,23 |
| 13/12/26 | Endurecedor Pu | 573.950 | 462.46 | 330 | 31/12/26 (+18d) | 562.02 | R$ 20.102,94 |
| 13/12/26 | Endurecedor Pu | 573.009 | 17.69 | 6 | 31/12/26 (+18d) | 19.9 | R$ 342,84 |
| 13/12/26 | Verniz | 543.850 | 52.02 | 20 | 31/12/26 (+18d) | 61.34 | R$ 4.297,11 |
| 13/12/26 | Verniz Pu Acrilico | 543.950 | 78.86 | 48 | 31/12/26 (+18d) | 98.35 | R$ 7.576,23 |
| 13/01/27 | Endurecedor Pu | 573.950 | 446.46 | 348 | 31/01/27 (+18d) | 640.34 | R$ 21.199,46 |
| 13/01/27 | Endurecedor Pu | 573.009 | 17.84 | 6 | 31/01/27 (+18d) | 21.07 | R$ 342,84 |
| 13/01/27 | Verniz | 543.850 | 47.5 | 24 | 31/01/27 (+18d) | 51.64 | R$ 5.156,53 |
| 13/01/27 | Verniz Pu Acrilico | 543.950 | 77.93 | 48 | 31/01/27 (+18d) | 97.68 | R$ 7.576,23 |
| 13/02/27 | Endurecedor Pu | 573.950 | 559.55 | 234 | 03/03/27 (+18d) | 677.36 | R$ 14.254,81 |
| 13/02/27 | Verniz | 543.850 | 37.05 | 36 | 03/03/27 (+18d) | 53.27 | R$ 7.734,79 |
| 13/02/27 | Verniz Pu Acrilico | 543.950 | 74.81 | 52 | 03/03/27 (+18d) | 95.1 | R$ 8.207,59 |
| 13/03/27 | Endurecedor Pu | 573.950 | 577.95 | 216 | 31/03/27 (+18d) | 615 | R$ 13.158,29 |
| 13/03/27 | Endurecedor Pu | 573.009 | 15.1 | 6 | 31/03/27 (+18d) | 17.97 | R$ 342,84 |
| 13/03/27 | Verniz | 543.850 | 44.33 | 28 | 31/03/27 (+18d) | 56.25 | R$ 6.015,95 |
| 13/03/27 | Verniz Pu Acrilico | 543.950 | 78.52 | 48 | 31/03/27 (+18d) | 96.68 | R$ 7.576,23 |
| 13/04/27 | Endurecedor Pu | 573.950 | 464.48 | 330 | 01/05/27 (+18d) | 583.6 | R$ 20.102,94 |
| 13/04/27 | Endurecedor Pu | 573.009 | 14.76 | 6 | 01/05/27 (+18d) | 16.21 | R$ 342,84 |
| 13/04/27 | Verniz | 543.850 | 45.85 | 24 | 01/05/27 (+18d) | 55.6 | R$ 5.156,53 |
| 13/04/27 | Verniz Pu Acrilico | 543.950 | 74.04 | 52 | 01/05/27 (+18d) | 94.57 | R$ 8.207,59 |
| 13/05/27 | Endurecedor Pu | 573.950 | 433.3 | 360 | 31/05/27 (+18d) | — (após horizonte) | R$ 21.930,48 |
| 13/05/27 | Endurecedor Pu | 573.009 | 14.6 | 6 | 31/05/27 (+18d) | — (após horizonte) | R$ 342,84 |
| 13/05/27 | Verniz | 543.850 | 43.76 | 28 | 31/05/27 (+18d) | — (após horizonte) | R$ 6.015,95 |
| 13/05/27 | Verniz Pu Acrilico | 543.950 | 69.42 | 60 | 31/05/27 (+18d) | — (após horizonte) | R$ 9.470,29 |

### Farben — Outros — Farben (Ronaldo) (a cada 1 mês(es))

Gasto no ano: **R$ 24.716,61** · Linhas: 44

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 13/07/26 | Catalisador Wash Primer | 577.000 | 17.51 | 41 | 31/07/26 (+18d) | 51.41 | R$ 1.220,88 |
| 13/07/26 | Massa Poliester Fibras | 508.800 | 10.72 | 1 | 31/07/26 (+18d) | 9.1 | R$ 0,00 |
| 13/07/26 | Primer Pu Fast Dry | 513.540 | 0 | 13 | 31/07/26 (+18d) | 13 | R$ 1.903,33 |
| 13/07/26 | Wash Primer | 517.600 | 0 | 18 | 31/07/26 (+18d) | 18 | R$ 2.532,60 |
| 13/08/26 | Catalisador Wash Primer | 577.000 | 43.59 | 15 | 31/08/26 (+18d) | 47.46 | R$ 446,66 |
| 13/08/26 | Massa Poliester Fibras | 508.800 | 6.19 | 6 | 31/08/26 (+18d) | 8.03 | R$ 0,00 |
| 13/08/26 | Primer Pu Fast Dry | 513.540 | 11.53 | 2 | 31/08/26 (+18d) | 11.5 | R$ 292,82 |
| 13/08/26 | Wash Primer | 517.600 | 15.32 | 3 | 31/08/26 (+18d) | 14.66 | R$ 422,10 |
| 13/09/26 | Catalisador Wash Primer | 577.000 | 36.34 | 23 | 01/10/26 (+18d) | 43.6 | R$ 684,88 |
| 13/09/26 | Massa Poliester Fibras | 508.800 | 6.6 | 5 | 01/10/26 (+18d) | 9.81 | R$ 0,00 |
| 13/09/26 | Primer Pu Fast Dry | 513.540 | 9.91 | 3 | 01/10/26 (+18d) | 10.7 | R$ 439,23 |
| 13/09/26 | Wash Primer | 517.600 | 12.75 | 6 | 01/10/26 (+18d) | 16.19 | R$ 844,20 |
| 13/10/26 | Catalisador Wash Primer | 577.000 | 35.76 | 23 | 31/10/26 (+18d) | 47.01 | R$ 684,88 |
| 13/10/26 | Massa Poliester Fibras | 508.800 | 7.17 | 5 | 31/10/26 (+18d) | 8.23 | R$ 0,00 |
| 13/10/26 | Primer Pu Fast Dry | 513.540 | 9.38 | 4 | 31/10/26 (+18d) | 11.41 | R$ 585,64 |
| 13/10/26 | Wash Primer | 517.600 | 14.08 | 4 | 31/10/26 (+18d) | 14.9 | R$ 562,80 |
| 13/11/26 | Catalisador Wash Primer | 577.000 | 39.18 | 20 | 01/12/26 (+18d) | 48.42 | R$ 595,55 |
| 13/11/26 | Massa Poliester Fibras | 508.800 | 5.38 | 7 | 01/12/26 (+18d) | 8.44 | R$ 0,00 |
| 13/11/26 | Primer Pu Fast Dry | 513.540 | 9.46 | 4 | 01/12/26 (+18d) | 10.69 | R$ 585,64 |
| 13/11/26 | Wash Primer | 517.600 | 13.37 | 5 | 01/12/26 (+18d) | 16.33 | R$ 703,50 |
| 13/12/26 | Catalisador Wash Primer | 577.000 | 40.24 | 19 | 31/12/26 (+18d) | 46.97 | R$ 565,77 |
| 13/12/26 | Massa Poliester Fibras | 508.800 | 6.29 | 6 | 31/12/26 (+18d) | 9.05 | R$ 0,00 |
| 13/12/26 | Primer Pu Fast Dry | 513.540 | 8.38 | 5 | 31/12/26 (+18d) | 9.91 | R$ 732,05 |
| 13/12/26 | Wash Primer | 517.600 | 13.95 | 5 | 31/12/26 (+18d) | 15.38 | R$ 703,50 |
| 13/01/27 | Catalisador Wash Primer | 577.000 | 35.17 | 24 | 31/01/27 (+18d) | 42.48 | R$ 714,66 |
| 13/01/27 | Massa Poliester Fibras | 508.800 | 7.11 | 5 | 31/01/27 (+18d) | 9.47 | R$ 0,00 |
| 13/01/27 | Primer Pu Fast Dry | 513.540 | 8.68 | 4 | 31/01/27 (+18d) | 11.13 | R$ 585,64 |
| 13/01/27 | Wash Primer | 517.600 | 12.8 | 6 | 31/01/27 (+18d) | 15.23 | R$ 844,20 |
| 13/02/27 | Catalisador Wash Primer | 577.000 | 33.81 | 25 | 03/03/27 (+18d) | 47.34 | R$ 744,44 |
| 13/02/27 | Massa Poliester Fibras | 508.800 | 6.41 | 6 | 03/03/27 (+18d) | 8.08 | R$ 0,00 |
| 13/02/27 | Primer Pu Fast Dry | 513.540 | 10.17 | 3 | 03/03/27 (+18d) | 11.71 | R$ 439,23 |
| 13/02/27 | Wash Primer | 517.600 | 13.09 | 5 | 03/03/27 (+18d) | 15.04 | R$ 703,50 |
| 13/03/27 | Catalisador Wash Primer | 577.000 | 41.6 | 17 | 31/03/27 (+18d) | 48.27 | R$ 506,22 |
| 13/03/27 | Massa Poliester Fibras | 508.800 | 5.89 | 6 | 31/03/27 (+18d) | 7.94 | R$ 0,00 |
| 13/03/27 | Primer Pu Fast Dry | 513.540 | 10.13 | 3 | 31/03/27 (+18d) | 10.3 | R$ 439,23 |
| 13/03/27 | Wash Primer | 517.600 | 12.7 | 6 | 31/03/27 (+18d) | 14.51 | R$ 844,20 |
| 13/04/27 | Catalisador Wash Primer | 577.000 | 40.11 | 19 | 01/05/27 (+18d) | 47.73 | R$ 565,77 |
| 13/04/27 | Massa Poliester Fibras | 508.800 | 5.34 | 7 | 01/05/27 (+18d) | 8.78 | R$ 0,00 |
| 13/04/27 | Primer Pu Fast Dry | 513.540 | 8.46 | 5 | 01/05/27 (+18d) | 10.94 | R$ 732,05 |
| 13/04/27 | Wash Primer | 517.600 | 11.35 | 7 | 01/05/27 (+18d) | 13.97 | R$ 984,90 |
| 13/05/27 | Catalisador Wash Primer | 577.000 | 40.92 | 18 | 31/05/27 (+18d) | — (após horizonte) | R$ 536,00 |
| 13/05/27 | Massa Poliester Fibras | 508.800 | 6.75 | 5 | 31/05/27 (+18d) | — (após horizonte) | R$ 0,00 |
| 13/05/27 | Primer Pu Fast Dry | 513.540 | 9.39 | 4 | 31/05/27 (+18d) | — (após horizonte) | R$ 585,64 |
| 13/05/27 | Wash Primer | 517.600 | 11.55 | 7 | 31/05/27 (+18d) | — (após horizonte) | R$ 984,90 |

### Farben — Pigmentos — Farben (Ronaldo) (a cada 1 mês(es))

Gasto no ano: **R$ 199.479,72** · Linhas: 209

| Disparo | Item | Cód. | Estoque antes | Qtd pedida | Chegada (lead) | Estoque após chegada | Custo |
|---|---|---|---:|---:|---|---:|---:|
| 06/07/26 | Aluminio Médio | UC655 | 0.89 | 8 | 24/07/26 (+18d) | 8 | R$ 1.304,00 |
| 06/07/26 | Aluminio Medio Brilhante | UC643 | 8.07 | 2 | 24/07/26 (+18d) | 7.99 | R$ 627,38 |
| 06/07/26 | Amarelo Limão | AC173 | 0 | 4 | 24/07/26 (+18d) | 4 | R$ 1.351,52 |
| 06/07/26 | Amarelo Ouro | AC172 | 0 | 8 | 24/07/26 (+18d) | 8 | R$ 2.488,64 |
| 06/07/26 | Azul | AC177 | 0 | 16 | 24/07/26 (+18d) | 16 | R$ 2.319,68 |
| 06/07/26 | Azul Esverdeado | UC297 | 0 | 6 | 24/07/26 (+18d) | 6 | R$ 515,16 |
| 06/07/26 | Branco | AC171 | 0 | 20 | 24/07/26 (+18d) | 20 | R$ 4.645,20 |
| 06/07/26 | Branco | UC281 | 1.25 | 8 | 24/07/26 (+18d) | 8 | R$ 2.708,80 |
| 06/07/26 | Laranja | AC175 | 2.06 | 8 | 24/07/26 (+18d) | 8.28 | R$ 2.940,88 |
| 06/07/26 | Perolizado Vermelho Fino | UC608 | 4.16 | 4 | 24/07/26 (+18d) | 5.64 | R$ 1.185,24 |
| 06/07/26 | Preto | AC180 | 0 | 12 | 24/07/26 (+18d) | 12 | R$ 1.320,60 |
| 06/07/26 | Rosa | AC189 | 0.76 | 4 | 24/07/26 (+18d) | 4.41 | R$ 2.097,20 |
| 06/07/26 | Verde | AC178 | 0 | 12 | 24/07/26 (+18d) | 12 | R$ 1.743,96 |
| 06/07/26 | Vermelho Vivo | AC135 | 0 | 12 | 24/07/26 (+18d) | 12 | R$ 2.944,56 |
| 06/08/26 | Aluminio Médio | UC655 | 6.37 | 2 | 24/08/26 (+18d) | 5.83 | R$ 326,00 |
| 06/08/26 | Aluminio Medio Brilhante | UC643 | 6.56 | 4 | 24/08/26 (+18d) | 8.76 | R$ 1.254,76 |
| 06/08/26 | Amarelo Limão | AC173 | 3.36 | 4 | 24/08/26 (+18d) | 6.21 | R$ 1.351,52 |
| 06/08/26 | Amarelo Ouro | UC282 | 1.39 | 4 | 24/08/26 (+18d) | 4.62 | R$ 2.257,36 |
| 06/08/26 | Branco | AC171 | 16.44 | 4 | 24/08/26 (+18d) | 15.77 | R$ 929,04 |
| 06/08/26 | Branco | UC281 | 6.44 | 4 | 24/08/26 (+18d) | 7.79 | R$ 1.354,40 |
| 06/08/26 | Laranja | UC285 | 0.99 | 4 | 24/08/26 (+18d) | 4.62 | R$ 929,36 |
| 06/08/26 | Perolizado Vermelho Fino | UC608 | 4.02 | 4 | 24/08/26 (+18d) | 6.25 | R$ 1.185,24 |
| 06/08/26 | Violeta | AC121 | 1.49 | 1 | 24/08/26 (+18d) | 1.8 | R$ 541,18 |
| 06/09/26 | Aluminio Médio | UC655 | 4.09 | 4 | 24/09/26 (+18d) | 5.86 | R$ 652,00 |
| 06/09/26 | Aluminio Medio Brilhante | UC643 | 7.4 | 2 | 24/09/26 (+18d) | 7.4 | R$ 627,38 |
| 06/09/26 | Amarelo Ouro | AC172 | 3.76 | 4 | 24/09/26 (+18d) | 5.73 | R$ 1.244,32 |
| 06/09/26 | Azul | AC177 | 7.58 | 8 | 24/09/26 (+18d) | 12.33 | R$ 1.159,84 |
| 06/09/26 | Azul Avermelhado | UC277 | 4.13 | 2 | 24/09/26 (+18d) | 4.85 | R$ 440,82 |
| 06/09/26 | Azul Esverdeado | UC297 | 3.44 | 2 | 24/09/26 (+18d) | 4.58 | R$ 171,72 |
| 06/09/26 | Branco | AC171 | 12.11 | 8 | 24/09/26 (+18d) | 14.42 | R$ 1.858,08 |
| 06/09/26 | Branco | UC281 | 6.08 | 4 | 24/09/26 (+18d) | 8.13 | R$ 1.354,40 |
| 06/09/26 | Laranja | AC175 | 4.11 | 4 | 24/09/26 (+18d) | 5.85 | R$ 1.470,44 |
| 06/09/26 | Perolizado Vermelho Fino | UC608 | 4.76 | 4 | 24/09/26 (+18d) | 6.23 | R$ 1.185,24 |
| 06/09/26 | Preto | AC180 | 6.14 | 4 | 24/09/26 (+18d) | 7.99 | R$ 440,20 |
| 06/09/26 | Verde | AC178 | 6.11 | 4 | 24/09/26 (+18d) | 7.91 | R$ 581,32 |
| 06/09/26 | Vermelho Azulado | UC274 | 2.04 | 2 | 24/09/26 (+18d) | 3.05 | R$ 775,92 |
| 06/09/26 | Vermelho Vivo | AC135 | 5.54 | 4 | 24/09/26 (+18d) | 6.38 | R$ 981,52 |
| 06/09/26 | Violeta | AC121 | 1.3 | 1 | 24/09/26 (+18d) | 1.62 | R$ 541,18 |
| 06/10/26 | Aluminio Médio | UC655 | 4.48 | 4 | 24/10/26 (+18d) | 6.62 | R$ 652,00 |
| 06/10/26 | Aluminio Medio Brilhante | UC643 | 5.96 | 4 | 24/10/26 (+18d) | 7.55 | R$ 1.254,76 |
| 06/10/26 | Amarelo Ouro | AC172 | 4.65 | 4 | 24/10/26 (+18d) | 7.57 | R$ 1.244,32 |
| 06/10/26 | Azul | AC177 | 10.05 | 4 | 24/10/26 (+18d) | 10.4 | R$ 579,92 |
| 06/10/26 | Azul Avermelhado | UC277 | 3.95 | 2 | 24/10/26 (+18d) | 4.52 | R$ 440,82 |
| 06/10/26 | Azul Esverdeado | UC297 | 3.8 | 2 | 24/10/26 (+18d) | 4.22 | R$ 171,72 |
| 06/10/26 | Branco | AC171 | 10.79 | 8 | 24/10/26 (+18d) | 13.67 | R$ 1.858,08 |
| 06/10/26 | Branco | UC281 | 6.97 | 4 | 24/10/26 (+18d) | 9.51 | R$ 1.354,40 |
| 06/10/26 | Laranja | AC175 | 4.5 | 4 | 24/10/26 (+18d) | 6.82 | R$ 1.470,44 |
| 06/10/26 | Perolizado Amarelo | UC606 | 3.25 | 2 | 24/10/26 (+18d) | 3.33 | R$ 396,60 |
| 06/10/26 | Perolizado Dourado | UC605 | 1.95 | 2 | 24/10/26 (+18d) | 3.15 | R$ 527,20 |
| 06/10/26 | Perolizado Vermelho Fino | UC608 | 4.63 | 4 | 24/10/26 (+18d) | 6.4 | R$ 1.185,24 |
| 06/10/26 | Preto | AC180 | 6.59 | 4 | 24/10/26 (+18d) | 8.57 | R$ 440,20 |
| 06/10/26 | Verde | AC178 | 6.37 | 4 | 24/10/26 (+18d) | 7.93 | R$ 581,32 |
| 06/10/26 | Vermelho Azulado | UC274 | 2.4 | 2 | 24/10/26 (+18d) | 3.42 | R$ 775,92 |
| 06/10/26 | Vermelho Vivo | AC135 | 4.26 | 8 | 24/10/26 (+18d) | 9.07 | R$ 1.963,04 |
| 06/10/26 | Violeta | AC121 | 1.19 | 1 | 24/10/26 (+18d) | 1.57 | R$ 541,18 |
| 06/11/26 | Aluminio Graudo | UC645 | 2.77 | 4 | 24/11/26 (+18d) | 5.52 | R$ 549,96 |
| 06/11/26 | Aluminio Médio | UC655 | 5.03 | 4 | 24/11/26 (+18d) | 6.27 | R$ 652,00 |
| 06/11/26 | Aluminio Medio Brilhante | UC643 | 5.67 | 4 | 24/11/26 (+18d) | 6.71 | R$ 1.254,76 |
| 06/11/26 | Amarelo Limão | AC173 | 2.11 | 4 | 24/11/26 (+18d) | 4.91 | R$ 1.351,52 |
| 06/11/26 | Amarelo Ouro | UC282 | 1.53 | 4 | 24/11/26 (+18d) | 4.75 | R$ 2.257,36 |
| 06/11/26 | Amarelo Oxido | AC174 | 0.86 | 4 | 24/11/26 (+18d) | 4.62 | R$ 672,00 |
| 06/11/26 | Azul | AC177 | 7.82 | 8 | 24/11/26 (+18d) | 12.39 | R$ 1.159,84 |
| 06/11/26 | Azul Avermelhado | UC277 | 3.5 | 2 | 24/11/26 (+18d) | 4.16 | R$ 440,82 |
| 06/11/26 | Azul Esverdeado | UC297 | 3.15 | 2 | 24/11/26 (+18d) | 3.81 | R$ 171,72 |
| 06/11/26 | Branco | AC171 | 9.24 | 12 | 24/11/26 (+18d) | 13.47 | R$ 2.787,12 |
| 06/11/26 | Laranja | AC175 | 5.55 | 4 | 24/11/26 (+18d) | 7.65 | R$ 1.470,44 |
| 06/11/26 | Marrom Transparente | UC276 | 1.53 | 2 | 24/11/26 (+18d) | 3.03 | R$ 158,44 |
| 06/11/26 | Perolizado Amarelo | UC606 | 2.08 | 4 | 24/11/26 (+18d) | 4.64 | R$ 793,20 |
| 06/11/26 | Perolizado Dourado | UC605 | 2.56 | 2 | 24/11/26 (+18d) | 3.73 | R$ 527,20 |
| 06/11/26 | Perolizado Vermelho Fino | UC608 | 4.74 | 4 | 24/11/26 (+18d) | 6.34 | R$ 1.185,24 |
| 06/11/26 | Preto | AC180 | 7.12 | 4 | 24/11/26 (+18d) | 9.12 | R$ 440,20 |
| 06/11/26 | Solução Ajuste Metalico | UC580 | 4.21 | 2 | 24/11/26 (+18d) | 4.82 | R$ 134,04 |
| 06/11/26 | Verde | AC178 | 6.05 | 4 | 24/11/26 (+18d) | 7.22 | R$ 581,32 |
| 06/11/26 | Verde | UC288 | 1.95 | 2 | 24/11/26 (+18d) | 3.17 | R$ 188,44 |
| 06/11/26 | Vermelho Azulado | UC274 | 2.68 | 2 | 24/11/26 (+18d) | 3.56 | R$ 775,92 |
| 06/11/26 | Vermelho Vivo | AC135 | 6.95 | 4 | 24/11/26 (+18d) | 8.46 | R$ 981,52 |
| 06/11/26 | Violeta | AC121 | 1.15 | 1 | 24/11/26 (+18d) | 1.63 | R$ 541,18 |
| 06/12/26 | Aluminio Fino Brilhante | UC642 | 3.4 | 2 | 24/12/26 (+18d) | 4.36 | R$ 345,20 |
| 06/12/26 | Aluminio Graudo | UC645 | 4.63 | 2 | 24/12/26 (+18d) | 5.14 | R$ 274,98 |
| 06/12/26 | Aluminio Médio | UC655 | 4.48 | 4 | 24/12/26 (+18d) | 5.9 | R$ 652,00 |
| 06/12/26 | Aluminio Medio Brilhante | UC643 | 4.57 | 6 | 24/12/26 (+18d) | 6.98 | R$ 1.882,14 |
| 06/12/26 | Amarelo Ouro | AC172 | 4.3 | 4 | 24/12/26 (+18d) | 7.21 | R$ 1.244,32 |
| 06/12/26 | Azul | AC177 | 9.98 | 4 | 24/12/26 (+18d) | 10.13 | R$ 579,92 |
| 06/12/26 | Azul Avermelhado | UC277 | 3.19 | 4 | 24/12/26 (+18d) | 5.58 | R$ 881,64 |
| 06/12/26 | Azul Esverdeado | UC297 | 2.91 | 4 | 24/12/26 (+18d) | 5.54 | R$ 343,44 |
| 06/12/26 | Branco | AC171 | 9.35 | 12 | 24/12/26 (+18d) | 17.37 | R$ 2.787,12 |
| 06/12/26 | Branco | UC281 | 3.42 | 8 | 24/12/26 (+18d) | 9.11 | R$ 2.708,80 |
| 06/12/26 | Laranja | AC175 | 6.44 | 4 | 24/12/26 (+18d) | 8.73 | R$ 1.470,44 |
| 06/12/26 | Perolizado Amarelo | UC606 | 3.82 | 2 | 24/12/26 (+18d) | 4.89 | R$ 396,60 |
| 06/12/26 | Perolizado Vermelho Fino | UC608 | 4.61 | 4 | 24/12/26 (+18d) | 5.78 | R$ 1.185,24 |
| 06/12/26 | Preto | AC180 | 7.77 | 4 | 24/12/26 (+18d) | 9.72 | R$ 440,20 |
| 06/12/26 | Rosa | AC189 | 1.61 | 4 | 24/12/26 (+18d) | 5.24 | R$ 2.097,20 |
| 06/12/26 | Solução Ajuste Metalico | UC580 | 3.95 | 2 | 24/12/26 (+18d) | 4.79 | R$ 134,04 |
| 06/12/26 | Verde | AC178 | 5.57 | 4 | 24/12/26 (+18d) | 7.6 | R$ 581,32 |
| 06/12/26 | Vermelho Azulado | UC274 | 2.92 | 2 | 24/12/26 (+18d) | 4.18 | R$ 775,92 |
| 06/12/26 | Vermelho Vivo | AC135 | 6.53 | 4 | 24/12/26 (+18d) | 7.09 | R$ 981,52 |
| 06/12/26 | Violeta | AC121 | 1.22 | 1 | 24/12/26 (+18d) | 1.49 | R$ 541,18 |
| 06/01/27 | Aluminio Fino Brilhante | UC642 | 3.61 | 2 | 24/01/27 (+18d) | 4.56 | R$ 345,20 |
| 06/01/27 | Aluminio Graudo | UC645 | 3.97 | 2 | 24/01/27 (+18d) | 4.13 | R$ 274,98 |
| 06/01/27 | Aluminio Médio | UC655 | 4.29 | 4 | 24/01/27 (+18d) | 6.62 | R$ 652,00 |
| 06/01/27 | Aluminio Medio Brilhante | UC643 | 4.85 | 6 | 24/01/27 (+18d) | 8.93 | R$ 1.882,14 |
| 06/01/27 | Amarelo Limão | AC173 | 2.35 | 4 | 24/01/27 (+18d) | 5.4 | R$ 1.351,52 |
| 06/01/27 | Azul | AC177 | 7.55 | 8 | 24/01/27 (+18d) | 12.41 | R$ 1.159,84 |
| 06/01/27 | Azul Avermelhado | UC277 | 4.43 | 2 | 24/01/27 (+18d) | 4.89 | R$ 440,82 |
| 06/01/27 | Azul Esverdeado | UC297 | 4.45 | 2 | 24/01/27 (+18d) | 4.71 | R$ 171,72 |
| 06/01/27 | Branco | AC171 | 13.8 | 8 | 24/01/27 (+18d) | 15.28 | R$ 1.858,08 |
| 06/01/27 | Branco | UC281 | 7.42 | 4 | 24/01/27 (+18d) | 9.04 | R$ 1.354,40 |
| 06/01/27 | Laranja | UC285 | 1.5 | 4 | 24/01/27 (+18d) | 5.18 | R$ 929,36 |
| 06/01/27 | Marrom Transparente | UC276 | 1.5 | 2 | 24/01/27 (+18d) | 3.04 | R$ 158,44 |
| 06/01/27 | Perolizado Amarelo | UC606 | 4.1 | 2 | 24/01/27 (+18d) | 4.75 | R$ 396,60 |
| 06/01/27 | Perolizado Dourado | UC605 | 2.34 | 2 | 24/01/27 (+18d) | 3.55 | R$ 527,20 |
| 06/01/27 | Perolizado Vermelho Fino | UC608 | 3.87 | 4 | 24/01/27 (+18d) | 5.54 | R$ 1.185,24 |
| 06/01/27 | Preto Azulado | UC280 | 1.86 | 4 | 24/01/27 (+18d) | 5.05 | R$ 1.182,32 |
| 06/01/27 | Preto Fosco Chassi | 113.8780e | 6.45 | 4 | 24/01/27 (+18d) | 8.41 | R$ 501,64 |
| 06/01/27 | Solução Ajuste Metalico | UC580 | 3.9 | 2 | 24/01/27 (+18d) | 4.59 | R$ 134,04 |
| 06/01/27 | Verde | AC178 | 5.97 | 4 | 24/01/27 (+18d) | 7.26 | R$ 581,32 |
| 06/01/27 | Verde | UC288 | 1.12 | 2 | 24/01/27 (+18d) | 2.41 | R$ 188,44 |
| 06/01/27 | Vermelho Vivo | AC135 | 4.72 | 8 | 24/01/27 (+18d) | 9.7 | R$ 1.963,04 |
| 06/01/27 | Violeta | AC121 | 0.96 | 2 | 24/01/27 (+18d) | 2.2 | R$ 1.082,36 |
| 06/02/27 | Aluminio Fino Brilhante | UC642 | 3.74 | 2 | 24/02/27 (+18d) | 4.45 | R$ 345,20 |
| 06/02/27 | Aluminio Graudo | UC645 | 2.63 | 4 | 24/02/27 (+18d) | 4.17 | R$ 549,96 |
| 06/02/27 | Aluminio Médio | UC655 | 5.24 | 4 | 24/02/27 (+18d) | 6.94 | R$ 652,00 |
| 06/02/27 | Aluminio Medio Brilhante | UC643 | 7.36 | 2 | 24/02/27 (+18d) | 6.75 | R$ 627,38 |
| 06/02/27 | Amarelo Ouro | AC172 | 4.37 | 4 | 24/02/27 (+18d) | 6.76 | R$ 1.244,32 |
| 06/02/27 | Amarelo Ouro | UC282 | 1.99 | 4 | 24/02/27 (+18d) | 5.45 | R$ 2.257,36 |
| 06/02/27 | Amarelo Transparente | UC294 | 1.04 | 2 | 24/02/27 (+18d) | 2.39 | R$ 207,58 |
| 06/02/27 | Azul | AC177 | 10.16 | 4 | 24/02/27 (+18d) | 11.08 | R$ 579,92 |
| 06/02/27 | Azul Avermelhado | UC277 | 3.71 | 2 | 24/02/27 (+18d) | 3.96 | R$ 440,82 |
| 06/02/27 | Azul Esverdeado | UC297 | 3.65 | 2 | 24/02/27 (+18d) | 4.61 | R$ 171,72 |
| 06/02/27 | Branco | AC171 | 10.17 | 12 | 24/02/27 (+18d) | 14.21 | R$ 2.787,12 |
| 06/02/27 | Branco | UC281 | 7.19 | 4 | 24/02/27 (+18d) | 8.3 | R$ 1.354,40 |
| 06/02/27 | Laranja | AC175 | 3.58 | 4 | 24/02/27 (+18d) | 5.44 | R$ 1.470,44 |
| 06/02/27 | Perolizado Amarelo | UC606 | 3.78 | 2 | 24/02/27 (+18d) | 4.46 | R$ 396,60 |
| 06/02/27 | Perolizado Vermelho Fino | UC608 | 3.67 | 4 | 24/02/27 (+18d) | 4.65 | R$ 1.185,24 |
| 06/02/27 | Preto | AC180 | 4.59 | 4 | 24/02/27 (+18d) | 6.43 | R$ 440,20 |
| 06/02/27 | Preto Fosco Chassi | 113.8780e | 6.97 | 4 | 24/02/27 (+18d) | 9.03 | R$ 501,64 |
| 06/02/27 | Solução Ajuste Metalico | UC580 | 3.52 | 2 | 24/02/27 (+18d) | 3.77 | R$ 134,04 |
| 06/02/27 | Verde | AC178 | 5.63 | 4 | 24/02/27 (+18d) | 8.11 | R$ 581,32 |
| 06/02/27 | Verde | UC288 | 1.87 | 2 | 24/02/27 (+18d) | 3.07 | R$ 188,44 |
| 06/02/27 | Vermelho Azulado | UC274 | 1.78 | 2 | 24/02/27 (+18d) | 2.4 | R$ 775,92 |
| 06/02/27 | Vermelho Vivo | AC135 | 7.29 | 4 | 24/02/27 (+18d) | 7.48 | R$ 981,52 |
| 06/02/27 | Violeta | AC121 | 1.67 | 1 | 24/02/27 (+18d) | 1.94 | R$ 541,18 |
| 06/03/27 | Aluminio Graudo | UC645 | 3.01 | 4 | 24/03/27 (+18d) | 5.31 | R$ 549,96 |
| 06/03/27 | Aluminio Médio | UC655 | 5.48 | 2 | 24/03/27 (+18d) | 4.54 | R$ 326,00 |
| 06/03/27 | Aluminio Medio Brilhante | UC643 | 5.11 | 4 | 24/03/27 (+18d) | 5.81 | R$ 1.254,76 |
| 06/03/27 | Amarelo Limão | AC173 | 3.11 | 4 | 24/03/27 (+18d) | 6.04 | R$ 1.351,52 |
| 06/03/27 | Amarelo Limpo | UC273 | 1.29 | 2 | 24/03/27 (+18d) | 2.72 | R$ 1.200,22 |
| 06/03/27 | Amarelo Ouro | AC172 | 5.97 | 4 | 24/03/27 (+18d) | 8.75 | R$ 1.244,32 |
| 06/03/27 | Azul | AC177 | 9.43 | 4 | 24/03/27 (+18d) | 10.57 | R$ 579,92 |
| 06/03/27 | Azul Avermelhado | UC277 | 3.08 | 4 | 24/03/27 (+18d) | 5.66 | R$ 881,64 |
| 06/03/27 | Azul Esverdeado | UC297 | 3.91 | 2 | 24/03/27 (+18d) | 4.43 | R$ 171,72 |
| 06/03/27 | Branco | AC171 | 10.68 | 8 | 24/03/27 (+18d) | 13.91 | R$ 1.858,08 |
| 06/03/27 | Branco | UC281 | 6.92 | 4 | 24/03/27 (+18d) | 8.86 | R$ 1.354,40 |
| 06/03/27 | Laranja | AC175 | 4.29 | 4 | 24/03/27 (+18d) | 6.31 | R$ 1.470,44 |
| 06/03/27 | Perolizado Amarelo | UC606 | 3.73 | 2 | 24/03/27 (+18d) | 4.42 | R$ 396,60 |
| 06/03/27 | Perolizado Dourado | UC605 | 1.83 | 2 | 24/03/27 (+18d) | 3.35 | R$ 527,20 |
| 06/03/27 | Perolizado Vermelho Fino | UC608 | 3.5 | 4 | 24/03/27 (+18d) | 6.37 | R$ 1.185,24 |
| 06/03/27 | Preto | AC180 | 5.29 | 4 | 24/03/27 (+18d) | 7.31 | R$ 440,20 |
| 06/03/27 | Preto Azulado | UC280 | 2.53 | 4 | 24/03/27 (+18d) | 5.56 | R$ 1.182,32 |
| 06/03/27 | Solução Ajuste Metalico | UC580 | 2.95 | 2 | 24/03/27 (+18d) | 3.75 | R$ 134,04 |
| 06/03/27 | Verde | AC178 | 6.93 | 4 | 24/03/27 (+18d) | 8.2 | R$ 581,32 |
| 06/03/27 | Vermelho Azulado | UC274 | 1.74 | 2 | 24/03/27 (+18d) | 2.71 | R$ 775,92 |
| 06/03/27 | Vermelho Vivo | AC135 | 5.8 | 4 | 24/03/27 (+18d) | 7.57 | R$ 981,52 |
| 06/03/27 | Violeta | AC121 | 1.55 | 1 | 24/03/27 (+18d) | 1.88 | R$ 541,18 |
| 06/04/27 | Aluminio Fino Brilhante | UC642 | 1.95 | 2 | 24/04/27 (+18d) | 3.11 | R$ 345,20 |
| 06/04/27 | Aluminio Graudo | UC645 | 4.11 | 2 | 24/04/27 (+18d) | 4.51 | R$ 274,98 |
| 06/04/27 | Aluminio Médio | UC655 | 2.43 | 6 | 24/04/27 (+18d) | 6 | R$ 978,00 |
| 06/04/27 | Aluminio Medio Brilhante | UC643 | 3.07 | 6 | 24/04/27 (+18d) | 6 | R$ 1.882,14 |
| 06/04/27 | Amarelo Transparente | UC294 | 1.44 | 2 | 24/04/27 (+18d) | 2.81 | R$ 207,58 |
| 06/04/27 | Azul | AC177 | 8.44 | 8 | 24/04/27 (+18d) | 13.32 | R$ 1.159,84 |
| 06/04/27 | Azul Avermelhado | UC277 | 4.61 | 2 | 24/04/27 (+18d) | 5.07 | R$ 440,82 |
| 06/04/27 | Azul Esverdeado | UC297 | 3.42 | 2 | 24/04/27 (+18d) | 4.16 | R$ 171,72 |
| 06/04/27 | Branco | AC171 | 9.62 | 12 | 24/04/27 (+18d) | 13.79 | R$ 2.787,12 |
| 06/04/27 | Branco | UC281 | 7.27 | 4 | 24/04/27 (+18d) | 8.81 | R$ 1.354,40 |
| 06/04/27 | Laranja | AC175 | 4.85 | 4 | 24/04/27 (+18d) | 6.79 | R$ 1.470,44 |
| 06/04/27 | Marrom Transparente | UC276 | 1.02 | 2 | 24/04/27 (+18d) | 2.65 | R$ 158,44 |
| 06/04/27 | Perolizado Amarelo | UC606 | 3.39 | 2 | 24/04/27 (+18d) | 3.78 | R$ 396,60 |
| 06/04/27 | Perolizado Vermelho Fino | UC608 | 5.06 | 4 | 24/04/27 (+18d) | 6.16 | R$ 1.185,24 |
| 06/04/27 | Preto | AC180 | 5.86 | 4 | 24/04/27 (+18d) | 7.78 | R$ 440,20 |
| 06/04/27 | Preto Fosco Chassi | 113.8780e | 5.46 | 4 | 24/04/27 (+18d) | 7.68 | R$ 501,64 |
| 06/04/27 | Solução Ajuste Metalico | UC580 | 2.91 | 2 | 24/04/27 (+18d) | 3.79 | R$ 134,04 |
| 06/04/27 | Verde | AC178 | 6.5 | 4 | 24/04/27 (+18d) | 8.71 | R$ 581,32 |
| 06/04/27 | Verde | UC288 | 1.71 | 2 | 24/04/27 (+18d) | 3.24 | R$ 188,44 |
| 06/04/27 | Vermelho Azulado | UC274 | 1.85 | 2 | 24/04/27 (+18d) | 2.37 | R$ 775,92 |
| 06/04/27 | Vermelho Vivo | AC135 | 5.74 | 4 | 24/04/27 (+18d) | 6.71 | R$ 981,52 |
| 06/04/27 | Violeta | AC121 | 1.47 | 1 | 24/04/27 (+18d) | 2.09 | R$ 541,18 |
| 06/05/27 | Aluminio Fino Brilhante | UC642 | 2.52 | 2 | 24/05/27 (+18d) | 3.57 | R$ 345,20 |
| 06/05/27 | Aluminio Graudo | UC645 | 3.36 | 2 | 24/05/27 (+18d) | 3.46 | R$ 274,98 |
| 06/05/27 | Aluminio Médio | UC655 | 4.29 | 4 | 24/05/27 (+18d) | 6.16 | R$ 652,00 |
| 06/05/27 | Aluminio Medio Brilhante | UC643 | 3.44 | 6 | 24/05/27 (+18d) | 6.59 | R$ 1.882,14 |
| 06/05/27 | Amarelo Limão | AC173 | 3.23 | 4 | 24/05/27 (+18d) | 6.1 | R$ 1.351,52 |
| 06/05/27 | Amarelo Ouro | AC172 | 4.52 | 4 | 24/05/27 (+18d) | 6.74 | R$ 1.244,32 |
| 06/05/27 | Azul | AC177 | 11.11 | 4 | 24/05/27 (+18d) | 11.5 | R$ 579,92 |
| 06/05/27 | Azul Avermelhado | UC277 | 4.07 | 2 | 24/05/27 (+18d) | 4.61 | R$ 440,82 |
| 06/05/27 | Azul Esverdeado | UC297 | 3.14 | 2 | 24/05/27 (+18d) | 3.25 | R$ 171,72 |
| 06/05/27 | Branco | AC171 | 9.67 | 12 | 24/05/27 (+18d) | 17.82 | R$ 2.787,12 |
| 06/05/27 | Branco | UC281 | 7.35 | 4 | 24/05/27 (+18d) | 9.52 | R$ 1.354,40 |
| 06/05/27 | Laranja | AC175 | 5.52 | 4 | 24/05/27 (+18d) | 7.86 | R$ 1.470,44 |
| 06/05/27 | Perolizado Amarelo | UC606 | 2.72 | 4 | 24/05/27 (+18d) | 5.18 | R$ 793,20 |
| 06/05/27 | Perolizado Dourado | UC605 | 1.54 | 2 | 24/05/27 (+18d) | 3.05 | R$ 527,20 |
| 06/05/27 | Perolizado Vermelho Fino | UC608 | 4.43 | 4 | 24/05/27 (+18d) | 6.25 | R$ 1.185,24 |
| 06/05/27 | Preto | AC180 | 6.43 | 4 | 24/05/27 (+18d) | 8.5 | R$ 440,20 |
| 06/05/27 | Preto Fosco Chassi | 113.8780e | 6.38 | 4 | 24/05/27 (+18d) | 8.23 | R$ 501,64 |
| 06/05/27 | Solução Ajuste Metalico | UC580 | 2.97 | 2 | 24/05/27 (+18d) | 3.57 | R$ 134,04 |
| 06/05/27 | Verde | AC178 | 7.3 | 4 | 24/05/27 (+18d) | 8.75 | R$ 581,32 |
| 06/05/27 | Vermelho Avioletado | UC279 | 0.26 | 1 | 24/05/27 (+18d) | 1.05 | R$ 181,16 |
| 06/05/27 | Vermelho Azulado | UC274 | 1.53 | 2 | 24/05/27 (+18d) | 2.59 | R$ 775,92 |
| 06/05/27 | Vermelho Vivo | AC135 | 5.01 | 8 | 24/05/27 (+18d) | 11.12 | R$ 1.963,04 |
| 06/05/27 | Violeta | AC121 | 1.8 | 1 | 24/05/27 (+18d) | 2.26 | R$ 541,18 |

## Consolidado Anual por Item (itens com consumo)

| Item | Cód. | Fornecedor | mc/mês | Consumo ano | Pedido ano | Nº pedidos | Estoque mín. | Ruptura | Estoque final |
|---|---|---|---:|---:|---:|---:|---:|:--:|---:|
| Endurecedor Pu | 573.950 | Farben (Ronaldo) | 290.8 | 3580.22 | 3558 | 11 | 0 | ⚠️ 49d | 257.96 |
| Clear Laca | ANC55 | Farben (Ronaldo) | 114.06 | 1253.09 | 1236 | 11 | 0 | ⚠️ 42d | 176.44 |
| Verniz Pu Acrilico | 543.950 | Farben (Ronaldo) | 51.9 | 621.71 | 608 | 11 | 0 | ⚠️ 38d | 40.07 |
| Fita Crepe Automotiva | 425 | Adere (Alex) | 700.44 | 8274.09 | 9090 | 4 | 0 | ⚠️ 60d | 2618.23 |
| Diluente | 558.400 | Farben (Ronaldo) | 61.48 | 749.84 | 752 | 11 | 0 | ⚠️ 32d | 104.14 |
| Verniz | 543.850 | Farben (Ronaldo) | 21.63 | 278.05 | 288 | 11 | 1.02 | não | 29.95 |
| Abraçadeira Nylon Preta | 200x4,6mm | Casa dos Parafusos (Maicon) | 387.67 | 5138.4 | 5400 | 6 | 0 | ⚠️ 27d | 670.03 |
| Base Branca | ANC50 | Farben (Ronaldo) | 28 | 360.89 | 340 | 11 | 0 | ⚠️ 25d | 45.12 |
| Desengraxante | 559.500 | Farben (Ronaldo) | 238.76 | 2849.01 | 2964 | 11 | 43.76 | não | 541.99 |
| Branco Acrilico Puro | 536.1080 | Farben (Ronaldo) | 19.89 | 257.78 | 272 | 11 | 0.03 | não | 48.22 |
| Clear Acrilico | APA85 | Farben (Ronaldo) | 30.77 | 381.09 | 368 | 11 | 0 | ⚠️ 10d | 45.23 |
| Máscara | 328 | Adere (Alex) | 14.16 | 186.66 | 154 | 4 | 15.05 | não | 24.59 |
| Branco | AC171 | Farben (Ronaldo) | 8.87 | 117.39 | 116 | 11 | 0 | ⚠️ 55d | 17.18 |
| Abraçadeira Nylon Natural | 200x4,8mm | Casa dos Parafusos (Maicon) | 111.05 | 1608 | 1641 | 6 | 0 | ⚠️ 28d | 123.59 |
| Clear Poliester | APE75 | Farben (Ronaldo) | 13.66 | 177.23 | 148 | 11 | 4.25 | não | 18.71 |
| Branco | UC281 | Farben (Ronaldo) | 3.71 | 45.55 | 48 | 10 | 0 | ⚠️ 6d | 9.21 |
| Vermelho Vivo | AC135 | Farben (Ronaldo) | 4.48 | 58.02 | 60 | 10 | 0 | ⚠️ 40d | 10.81 |
| Laranja | AC175 | Farben (Ronaldo) | 3.22 | 37.95 | 40 | 9 | 0.28 | não | 7.58 |
| Aluminio Medio Brilhante | UC643 | Farben (Ronaldo) | 4.3 | 55.42 | 46 | 11 | 0 | ⚠️ 6d | 6.11 |
| Perolizado Vermelho Fino | UC608 | Farben (Ronaldo) | 3.44 | 46.46 | 44 | 11 | 0.65 | não | 5.88 |
| Wash Primer | 517.600 | Farben (Ronaldo) | 5.62 | 72.86 | 72 | 11 | 0 | ⚠️ 39d | 8.71 |
| Amarelo Ouro | AC172 | Farben (Ronaldo) | 3.08 | 30.55 | 32 | 7 | 0 | ⚠️ 20d | 6.44 |
| Azul | AC177 | Farben (Ronaldo) | 6.28 | 68.93 | 68 | 10 | 0 | ⚠️ 37d | 10.9 |
| Estopa de Pano | 1Kg | Brasil Sul Estopas | 98.62 | 1084.38 | 1040 | 6 | 106.87 | não | 280.62 |
| Amarelo Limão | AC173 | Farben (Ronaldo) | 1.85 | 21.65 | 24 | 6 | 0 | ⚠️ 19d | 5.91 |
| Aluminio Médio | UC655 | Farben (Ronaldo) | 3.52 | 47.68 | 46 | 11 | 0 | ⚠️ 14d | 5.81 |
| Primer Pu Fast Dry | 513.540 | Farben (Ronaldo) | 4.56 | 47.19 | 50 | 11 | 0 | ⚠️ 66d | 7.58 |
| Catalisador Wash Primer | 577.000 | Farben (Ronaldo) | 18.54 | 237.03 | 244 | 11 | 10.41 | não | 32.97 |
| Verde | AC178 | Farben (Ronaldo) | 3.9 | 47.05 | 48 | 10 | 0 | ⚠️ 31d | 8.32 |
| Amarelo Ouro | UC282 | Farben (Ronaldo) | 0.97 | 13.17 | 12 | 3 | 0.62 | não | 2.57 |
| Scotch Brite | AMF | Dislon | 291.68 | 3248.28 | 3520 | 6 | 26.68 | não | 771.72 |
| Vermelho Azulado | UC274 | Farben (Ronaldo) | 1.44 | 20.41 | 16 | 8 | 0.37 | não | 2.43 |
| Violeta | AC121 | Farben (Ronaldo) | 0.97 | 12.6 | 11 | 10 | 0.2 | não | 2.16 |
| Azul Avermelhado | UC277 | Farben (Ronaldo) | 2.53 | 29.83 | 22 | 9 | 1.58 | não | 4.37 |
| Preto | AC180 | Farben (Ronaldo) | 3.89 | 42.38 | 44 | 9 | 0 | ⚠️ 22d | 8.18 |
| Rosa | AC189 | Farben (Ronaldo) | 0.8 | 8.7 | 8 | 2 | 0.41 | não | 1.21 |
| Endurecedor Pu | 573.009 | Farben (Ronaldo) | 5.86 | 64.45 | 72 | 10 | 0 | ⚠️ 2d | 12.72 |
| Perolizado Amarelo | UC606 | Farben (Ronaldo) | 2.3 | 28.07 | 20 | 8 | 0.64 | não | 4.93 |
| Pacote Saco de Lixo 200 lts | C/100 | Bolinha Embalagens (Ibiporã) | 2.12 | 28.43 | 24 | 6 | 0.93 | não | 2.57 |
| Aluminio Graudo | UC645 | Farben (Ronaldo) | 2.54 | 33.7 | 20 | 7 | 0.17 | não | 3.15 |
| Pacote Estopa | — | Brasil Sul Estopas | 20.43 | 247.29 | 300 | 6 | 0 | ⚠️ 22d | 89.58 |
| Perolizado Dourado | UC605 | Farben (Ronaldo) | 1.25 | 15.03 | 10 | 5 | 1.05 | não | 2.97 |
| Caixa Luva Látex-M | Branca c/pó | Bolinha Embalagens (Ibiporã) | 5.13 | 69.89 | 100 | 1 | 0 | ⚠️ 20d | 34.12 |
| Fita Crepe Amarela | — | Casa do Soldador (Ronan) | 62.31 | 831.34 | 480 | 3 | 77.88 | não | 222.66 |
| Preto Azulado | UC280 | Farben (Ronaldo) | 1.34 | 17.1 | 8 | 2 | 1.05 | não | 2.59 |
| Azul Esverdeado | UC297 | Farben (Ronaldo) | 2.45 | 28.17 | 26 | 10 | 0 | ⚠️ 36d | 2.94 |
| Preto Fosco Chassi | 113.8780e | Farben (Ronaldo) | 2.49 | 33.13 | 16 | 4 | 3.68 | não | 7.87 |
| Laranja | UC285 | Farben (Ronaldo) | 0.76 | 8.67 | 8 | 2 | 0.62 | não | 2.12 |
| Aluminio Fino Brilhante | UC642 | Farben (Ronaldo) | 1.82 | 20.38 | 10 | 5 | 1.11 | não | 3.41 |
| Copo Cristal 145ml | C/500 | Bolinha Embalagens (Ibiporã) | 1.28 | 15.95 | 500 | 1 | 0.93 | não | 486.05 |
| Amarelo Limpo | UC273 | Farben (Ronaldo) | 0.68 | 8.96 | 2 | 1 | 0.72 | não | 0.82 |
| Solução Ajuste Metalico | UC580 | Farben (Ronaldo) | 2.22 | 26.97 | 14 | 7 | 1.57 | não | 3.34 |
| Rebite de Repuxo 525 | — | Casa dos Parafusos (Maicon) | 377.26 | 4139.66 | 4281 | 6 | 135.51 | não | 598.34 |
| Verde | UC288 | Farben (Ronaldo) | 1.1 | 13.56 | 8 | 4 | 0.41 | não | 2.34 |
| Amarelo Oxido | AC174 | Farben (Ronaldo) | 0.44 | 4.95 | 4 | 1 | 0.62 | não | 1.98 |
| Marrom Transparente | UC276 | Farben (Ronaldo) | 0.79 | 10.43 | 6 | 3 | 0.65 | não | 1.85 |
| Rebite de Repuxo 516 | — | Casa dos Parafusos (Maicon) | 239.37 | 2807.88 | 2966 | 6 | 0 | ⚠️ 8d | 361.38 |
| Amarelo Transparente | UC294 | Farben (Ronaldo) | 0.7 | 9.02 | 4 | 2 | 0.39 | não | 1.98 |
| Abraçadeira Nylon Preta | 300x7,2mm | Casa dos Parafusos (Maicon) | 0.98 | 12.88 | 8 | 4 | 0.47 | não | 2.12 |
| Vermelho Avioletado | UC279 | Farben (Ronaldo) | 0.29 | 3.71 | 1 | 1 | 0.05 | não | 1.02 |
| Bobina Plástico Bolha | — | Bolinha Embalagens (Ibiporã) | 0.2 | 2.56 | 2 | 2 | 0.13 | não | 0.44 |
| Clear Epoxi | IEP340 | Farben (Ronaldo) | 0 | 83.28 | 0 | 0 | 0 | ⚠️ 282d | 0 |
| Amarelo Limão | UC283 | Farben (Ronaldo) | 0 | 65.69 | 0 | 0 | 0 | ⚠️ 254d | 0 |
| Massa Poliester Fibras | 508.800 | Farben (Ronaldo) | 5.52 | 67.61 | 59 | 11 | 1.44 | não | 4.39 |
| Espatula Inox/12cm Cab Pvc | — | Casa dos Parafusos (Maicon) | 0 | 48.43 | 0 | 0 | 0 | ⚠️ 351d | 0 |
|  Acrilico Preto Cadillac | 536.8540 | Farben (Ronaldo) | 1.38 | 17.93 | 0 | 0 | 4.07 | não | 4.07 |
| Perolizado Verde Luminoso | UC622 | Farben (Ronaldo) | 0 | 6.67 | 0 | 0 | 0 | ⚠️ 185d | 0 |
| Vermelho Oxido | AC176 | Farben (Ronaldo) | 0.14 | 1.6 | 0 | 0 | 2.23 | não | 2.23 |
| Vermelho Scarlat Transparente | UC268 | Farben (Ronaldo) | 0.04 | 0.51 | 0 | 0 | 4.48 | não | 4.48 |
| Perolizado Vermelho Graudo | UC609 | Farben (Ronaldo) | 1.21 | 13.77 | 0 | 0 | 2.1 | não | 2.1 |
| Amarelo Esverdeado Transparente | UC278 | Farben (Ronaldo) | 0 | 0.78 | 0 | 0 | 15.22 | não | 15.22 |
| Preto Chassis | 113.042 | Farben (Ronaldo) | 0 | 38.83 | 0 | 0 | 0 | ⚠️ 245d | 0 |
| Vermelho Oxido | UC286 | Farben (Ronaldo) | 0.15 | 1.78 | 0 | 0 | 8.49 | não | 8.49 |
| Prime PU P/plas 1k (3,6L) | 513.030 | Farben (Ronaldo) | 0 | 26.66 | 0 | 0 | 0 | ⚠️ 223d | 0 |
| Amarelo Alaranjado | UC272 | Farben (Ronaldo) | 0 | 9.54 | 0 | 0 | 0 | ⚠️ 38d | 0 |
| Primer Pu Preto Rodo | 9042 | Farben (Ronaldo) | 0 | 11.12 | 0 | 0 | 0 | ⚠️ 136d | 0 |
| Amarelo Oxido | UC284 | Farben (Ronaldo) | 0.4 | 5.44 | 0 | 0 | 0.61 | não | 0.61 |
| Azul | UC287 | Farben (Ronaldo) | 0.22 | 2.7 | 0 | 0 | 3.3 | não | 3.3 |
| Verniz Pu Auto S/FO (3,6L) | 543.010 | Farben (Ronaldo) | 0 | 17.19 | 0 | 0 | 0 | ⚠️ 117d | 0 |
| Castanho Transparente | UC266 | Farben (Ronaldo) | 0 | 11.57 | 0 | 0 | 0 | ⚠️ 150d | 0 |
| Preto Intenso | UC270 | Farben (Ronaldo) | 0.09 | 1.19 | 0 | 0 | 11.78 | não | 11.78 |
| Violeta | UC221 | Farben (Ronaldo) | 0 | 6.18 | 0 | 0 | 0 | ⚠️ 65d | 0 |
| Rosa | UC275 | Farben (Ronaldo) | 0 | 11.01 | 0 | 0 | 0.25 | não | 0.25 |
| Aluminio Super Graúdo | UC675 | Farben (Ronaldo) | 0 | 5.77 | 0 | 0 | 1.19 | não | 1.19 |
| Vermelho Intenso | UC269 | Farben (Ronaldo) | 0 | 5.52 | 0 | 0 | 0 | ⚠️ 90d | 0 |
| Perolizado Lilas | UC619 | Farben (Ronaldo) | 0 | 3.47 | 0 | 0 | 4.23 | não | 4.23 |
| Perolizado Azul Graudo | UC625 | Farben (Ronaldo) | 0 | 51.7 | 0 | 0 | 0 | ⚠️ 209d | 0 |
| Aluminio Ouro | UC690 | Farben (Ronaldo) | 0 | 25.3 | 0 | 0 | 0 | ⚠️ 310d | 0 |
| Garrafa Quadrada | 001 | Bolinha Embalagens (Ibiporã) | 0 | 495.99 | 0 | 0 | 0 | ⚠️ 345d | 0 |
| Vermelho Limpo | UC291 | Farben (Ronaldo) | 0.44 | 5.67 | 0 | 0 | 2.18 | não | 2.18 |
| Papel Toalha Interfolha Branco | — | Bolinha Embalagens (Ibiporã) | 0 | 11.22 | 0 | 0 | 0 | ⚠️ 266d | 0 |
| Máscara | 321 | Adere (Alex) | 8.11 | 90.5 | 105 | 4 | 0 | ⚠️ 97d | 21.04 |
| Líq. de Mascaramento | 506.000 | Farben (Ronaldo) | 1.93 | 26.61 | 0 | 0 | 72.39 | não | 72.39 |
| Copo Cristal 770ml | c/25 | Bolinha Embalagens (Ibiporã) | 3.61 | 41.94 | 0 | 0 | 50.06 | não | 50.06 |
| Vermelho Transparente | UC296 | Farben (Ronaldo) | 0 | 0.15 | 0 | 0 | 6.83 | não | 6.83 |
| Vinho Oxido | AC186 | Farben (Ronaldo) | 0 | 0.5 | 0 | 0 | 6.5 | não | 6.5 |
| Perolizado Red Violet | UC617 | Farben (Ronaldo) | 0 | 0.34 | 0 | 0 | 6.6 | não | 6.6 |
| Aluminio Brilhante | UC680 | Farben (Ronaldo) | 1.53 | 17.67 | 0 | 0 | 14.69 | não | 14.69 |
| Perolizado Azul Fino | UC626 | Farben (Ronaldo) | 0 | 12.27 | 0 | 0 | 0 | ⚠️ 155d | 0 |
| Rebite de Repuxo 640 | — | Casa dos Parafusos (Maicon) | 0 | 487.66 | 0 | 0 | 0 | ⚠️ 53d | 0 |
| Preto | UC290 | Farben (Ronaldo) | 0.11 | 1.5 | 0 | 0 | 8.87 | não | 8.87 |
| Aluminio Medio Limpo | UC685 | Farben (Ronaldo) | 0 | 5.11 | 0 | 0 | 8.14 | não | 8.14 |
| Pacote Papel Higiênico c/ 8 unidades | — | Bolinha Embalagens (Ibiporã) | 0 | 58.77 | 0 | 0 | 0 | ⚠️ 319d | 0 |
| Azul Escuro | UC298 | Farben (Ronaldo) | 0 | 4.81 | 0 | 0 | 3.38 | não | 3.38 |
| Abraçadeira Nylon Preta | 200x2,5mm | Casa dos Parafusos (Maicon) | 0 | 13.04 | 0 | 0 | 0 | ⚠️ 167d | 0 |
| Branco Transparente | UC271 | Farben (Ronaldo) | 0.02 | 0.24 | 0 | 0 | 5.66 | não | 5.66 |

## ⚠️ Rupturas (itens que zeraram estoque)

Separamos rupturas de **início** (primeiros 60 dias — efeito de partida: os agendamentos só começam a disparar em jun/jul/ago e o estoque atual de itens de alto giro não cobre até a 1ª entrega) das de **regime** (após o dia 60 — indicam cobertura insuficiente do ciclo).

- Só no início (resolvido com uma execução manual agora p/ ponte): **15** itens
- Em regime (cobertura do ciclo a revisar): **32** itens

| Item | Fornecedor | mc/mês | Lead | Ruptura início (≤60d) | Ruptura regime (>60d) | Nº pedidos |
|---|---|---:|---:|---:|---:|---:|
| Espatula Inox/12cm Cab Pvc | Casa dos Parafusos (Maicon) | 0 | 1d | 46 | 305 | 0 |
| Garrafa Quadrada | Bolinha Embalagens (Ibiporã) | 0 | 1d | 40 | 305 | 0 |
| Pacote Papel Higiênico c/ 8 unidades | Bolinha Embalagens (Ibiporã) | 0 | 1d | 14 | 305 | 0 |
| Aluminio Ouro | Farben (Ronaldo) | 0 | 18d | 5 | 305 | 0 |
| Clear Epoxi | Farben (Ronaldo) | 0 | 18d | 0 | 282 | 0 |
| Papel Toalha Interfolha Branco | Bolinha Embalagens (Ibiporã) | 0 | 1d | 0 | 266 | 0 |
| Amarelo Limão | Farben (Ronaldo) | 0 | 18d | 0 | 254 | 0 |
| Preto Chassis | Farben (Ronaldo) | 0 | 18d | 0 | 245 | 0 |
| Prime PU P/plas 1k (3,6L) | Farben (Ronaldo) | 0 | 18d | 0 | 223 | 0 |
| Perolizado Azul Graudo | Farben (Ronaldo) | 0 | 18d | 0 | 209 | 0 |
| Perolizado Verde Luminoso | Farben (Ronaldo) | 0 | 18d | 0 | 185 | 0 |
| Abraçadeira Nylon Preta | Casa dos Parafusos (Maicon) | 0 | 1d | 0 | 167 | 0 |
| Perolizado Azul Fino | Farben (Ronaldo) | 0 | 18d | 0 | 155 | 0 |
| Castanho Transparente | Farben (Ronaldo) | 0 | 18d | 0 | 150 | 0 |
| Primer Pu Preto Rodo | Farben (Ronaldo) | 0 | 18d | 0 | 136 | 0 |
| Verniz Pu Auto S/FO (3,6L) | Farben (Ronaldo) | 0 | 18d | 0 | 117 | 0 |
| Vermelho Intenso | Farben (Ronaldo) | 0 | 18d | 0 | 90 | 0 |
| Violeta | Farben (Ronaldo) | 0 | 18d | 0 | 65 | 0 |
| Rebite de Repuxo 640 | Casa dos Parafusos (Maicon) | 0 | 1d | 0 | 53 | 0 |
| Máscara | Adere (Alex) | 8.11 | 25d | 56 | 41 | 4 |
| Amarelo Alaranjado | Farben (Ronaldo) | 0 | 18d | 0 | 38 | 0 |
| Fita Crepe Automotiva | Adere (Alex) | 700.44 | 25d | 48 | 12 | 4 |
| Aluminio Medio Brilhante | Farben (Ronaldo) | 4.3 | 18d | 0 | 6 | 11 |
| Primer Pu Fast Dry | Farben (Ronaldo) | 4.56 | 18d | 61 | 5 | 11 |
| Endurecedor Pu | Farben (Ronaldo) | 290.8 | 18d | 44 | 5 | 11 |
| Wash Primer | Farben (Ronaldo) | 5.62 | 18d | 34 | 5 | 11 |
| Verniz Pu Acrilico | Farben (Ronaldo) | 51.9 | 18d | 33 | 5 | 11 |
| Aluminio Médio | Farben (Ronaldo) | 3.52 | 18d | 11 | 3 | 11 |
| Abraçadeira Nylon Natural | Casa dos Parafusos (Maicon) | 111.05 | 1d | 26 | 2 | 6 |
| Endurecedor Pu | Farben (Ronaldo) | 5.86 | 18d | 0 | 2 | 10 |
| Abraçadeira Nylon Preta | Casa dos Parafusos (Maicon) | 387.67 | 1d | 26 | 1 | 6 |
| Base Branca | Farben (Ronaldo) | 28 | 18d | 24 | 1 | 11 |
| Branco | Farben (Ronaldo) | 8.87 | 18d | 55 | 0 | 11 |
| Clear Laca | Farben (Ronaldo) | 114.06 | 18d | 42 | 0 | 11 |
| Vermelho Vivo | Farben (Ronaldo) | 4.48 | 18d | 40 | 0 | 10 |
| Azul | Farben (Ronaldo) | 6.28 | 18d | 37 | 0 | 10 |
| Azul Esverdeado | Farben (Ronaldo) | 2.45 | 18d | 36 | 0 | 10 |
| Diluente | Farben (Ronaldo) | 61.48 | 18d | 32 | 0 | 11 |
| Verde | Farben (Ronaldo) | 3.9 | 18d | 31 | 0 | 10 |
| Pacote Estopa | Brasil Sul Estopas | 20.43 | 25d | 22 | 0 | 6 |
| Preto | Farben (Ronaldo) | 3.89 | 18d | 22 | 0 | 9 |
| Amarelo Ouro | Farben (Ronaldo) | 3.08 | 18d | 20 | 0 | 7 |
| Caixa Luva Látex-M | Bolinha Embalagens (Ibiporã) | 5.13 | 1d | 20 | 0 | 1 |
| Amarelo Limão | Farben (Ronaldo) | 1.85 | 18d | 19 | 0 | 6 |
| Clear Acrilico | Farben (Ronaldo) | 30.77 | 18d | 10 | 0 | 11 |
| Rebite de Repuxo 516 | Casa dos Parafusos (Maicon) | 239.37 | 1d | 8 | 0 | 6 |
| Branco | Farben (Ronaldo) | 3.71 | 18d | 6 | 0 | 10 |

## ⚠️ Consumidos mas nunca pedidos (mc=0 — risco de ruptura silenciosa)

Estes itens tiveram saídas no histórico mas têm `monthlyConsumption = 0`, então o cálculo automático NÃO os pede. Reveja a configuração de consumo/estoque.

| Item | Cód. | Fornecedor | Consumo modelado (ano) | Estoque atual | Estoque final |
|---|---|---|---:|---:|---:|
| Garrafa Quadrada | 001 | Bolinha Embalagens (Ibiporã) | 495.99 | 495.99 | 0 |
| Rebite de Repuxo 640 | — | Casa dos Parafusos (Maicon) | 487.66 | 487.66 | 0 |
| Clear Epoxi | IEP340 | Farben (Ronaldo) | 83.28 | 83.28 | 0 |
| Amarelo Limão | UC283 | Farben (Ronaldo) | 65.69 | 65.69 | 0 |
| Pacote Papel Higiênico c/ 8 unidades | — | Bolinha Embalagens (Ibiporã) | 58.77 | 58.77 | 0 |
| Perolizado Azul Graudo | UC625 | Farben (Ronaldo) | 51.7 | 51.7 | 0 |
| Espatula Inox/12cm Cab Pvc | — | Casa dos Parafusos (Maicon) | 48.43 | 48.43 | 0 |
| Preto Chassis | 113.042 | Farben (Ronaldo) | 38.83 | 38.83 | 0 |
| Prime PU P/plas 1k (3,6L) | 513.030 | Farben (Ronaldo) | 26.66 | 26.66 | 0 |
| Aluminio Ouro | UC690 | Farben (Ronaldo) | 25.3 | 25.3 | 0 |
| Verniz Pu Auto S/FO (3,6L) | 543.010 | Farben (Ronaldo) | 17.19 | 17.19 | 0 |
| Abraçadeira Nylon Preta | 200x2,5mm | Casa dos Parafusos (Maicon) | 13.04 | 13.04 | 0 |
| Perolizado Azul Fino | UC626 | Farben (Ronaldo) | 12.27 | 12.27 | 0 |
| Castanho Transparente | UC266 | Farben (Ronaldo) | 11.57 | 11.57 | 0 |
| Papel Toalha Interfolha Branco | — | Bolinha Embalagens (Ibiporã) | 11.22 | 11.22 | 0 |
| Primer Pu Preto Rodo | 9042 | Farben (Ronaldo) | 11.12 | 11.12 | 0 |
| Rosa | UC275 | Farben (Ronaldo) | 11.01 | 11.26 | 0.25 |
| Amarelo Alaranjado | UC272 | Farben (Ronaldo) | 9.54 | 9.54 | 0 |
| Perolizado Verde Luminoso | UC622 | Farben (Ronaldo) | 6.67 | 6.67 | 0 |
| Violeta | UC221 | Farben (Ronaldo) | 6.18 | 6.18 | 0 |
| Aluminio Super Graúdo | UC675 | Farben (Ronaldo) | 5.77 | 6.97 | 1.19 |
| Vermelho Intenso | UC269 | Farben (Ronaldo) | 5.52 | 5.52 | 0 |
| Aluminio Medio Limpo | UC685 | Farben (Ronaldo) | 5.11 | 13.25 | 8.14 |
| Azul Escuro | UC298 | Farben (Ronaldo) | 4.81 | 8.19 | 3.38 |
| Perolizado Lilas | UC619 | Farben (Ronaldo) | 3.47 | 7.7 | 4.23 |
| Amarelo Esverdeado Transparente | UC278 | Farben (Ronaldo) | 0.78 | 16 | 15.22 |
| Vinho Oxido | AC186 | Farben (Ronaldo) | 0.5 | 7 | 6.5 |
| Perolizado Red Violet | UC617 | Farben (Ronaldo) | 0.34 | 6.94 | 6.6 |
| Vermelho Transparente | UC296 | Farben (Ronaldo) | 0.15 | 6.99 | 6.83 |
