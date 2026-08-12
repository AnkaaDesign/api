# Qualidade da análise de layout — ML, LLM local, ou outra coisa?

> Status: **ANÁLISE E RECOMENDAÇÃO** (2026-08-12). Responde à pergunta "o que
> falta para o motor entender o processo de pintura, e devemos treinar uma IA
> nossa com menos de 100 artes?".
>
> ⚠️ **Superado em dois pontos pelo `PAINTING_TEACHING_LOOP_SPEC.md`** (mesma data):
>
> - **§2 (vetor como entrada) — descartada.** A entrada é sempre imagem do
>   cliente; o objetivo é orçar direto do que ele manda, e cliente não manda
>   vetor. O vetor sobrevive só como **gabarito de teste** onde existir o EPS
>   interno da mesma arte (ver aquele doc §9.1).
> - **§4 (active learning sequencial) — substituída** por marcação **em lote**.
>   Corrigir uma arte de cada vez é otimização gulosa e é a mecânica que produziu
>   a lista de `ERROS_E_CORRECOES.md` §1. O discriminante só existe no contraste.
>
> O resto (§3 histórico executado, §5 ML clássico, §6 UI como fábrica de dataset,
> §7 sobre LLM) segue válido — o inventário do que sobreviveu está em
> `PAINTING_TEACHING_LOOP_SPEC.md` §9.
>
> Fonte de cada afirmação, na convenção do `PAINTING_CASE_CATALOG.md`:
> **verificado** (li no repositório), **medido** (número já registrado nos docs),
> **proposta** (minha, ainda não confirmada com o dono).

---

## 0. A resposta curta

**Não treine uma IA de visão.** O gargalo da qualidade não é o modelo e não é o
tamanho do dataset — é que o motor está fazendo **engenharia reversa, por
quantização de pixel, de uma informação que existe exata no arquivo original**.

O `layout database/` tem 66 PNGs. Mas eles não são o arquivo de produção: são
**mockups de aprovação do cliente**. Os próprios docs registram isso três vezes:

- `F4`: *"a chapa nunca é `#ffffff` puro; mockups usam `#ECECEC`–`#F0F0F0`"*
- plano da BURES: *"os 5 tons do arquivo são **bandas do mockup**, não máscaras"*
- slice_4: *"o cinza-claríssimo do arquivo (~#E7E8E8) é **renderização de
  mockup**, não tinta"*

E o `Layout` do ERP aponta para um `File` cujos mimetypes aceitos incluem
`application/postscript` (.eps/.ai), `application/illustrator` e
`application/vnd.corel-draw` — classificados como `FileTypeCategory.ARTWORK`
(`files-storage.service.ts:258-268`). **O arquivo vetorial que o plotter recorta
está no banco.** O motor (`ingest.py`) abre só PIL, ou seja, só raster.

A prova mais direta de que isso custa caro está no próprio motor:
`quantize.py:132` tem uma função chamada **`_rescue_vector_zones`** — 120 linhas
tentando adivinhar, por gradiente de L\*, se uma região "é vetorial". Ela existe
para recuperar do pixel uma propriedade que o arquivo original declara.

Antes de qualquer discussão de ML: **o dataset não é pequeno, é o formato errado.**

---

## 1. O que o motor ainda não sabe — e a que família cada coisa pertence

Separar isso é a decisão inteira. Cada linha exige um instrumento diferente, e
misturá-las é o que faz parecer que "falta IA".

| # | o que falta saber | natureza | instrumento certo | precisa de ML? |
|---|---|---|---|---|
| 1 | área, perímetro, comprimento de corte, cm reais | medida exata | **ler o vetor** | não |
| 2 | chapado / degradê / mosaico / aerografia | propriedade declarada no arquivo | **ler o vetor**; classificador só no raster embutido | quase não |
| 3 | quais regiões formam **um** elemento de produção | estrutura que o designer já criou | **grupos/camadas do vetor** + scorer clássico | pouco |
| 4 | cortabilidade, verticalidade da fita, tolerância de contato | julgamento tácito do pintor | **active learning com o dono** (~60 perguntas) | não |
| 5 | quanto tempo e quanto material cada operação realmente leva | histórico já executado | **regressão sobre o ERP** | sim, mas trivial |

Note que **nenhuma linha pede um modelo de visão treinado**. A linha 5 pede um
modelo — de 10 features, sobre dados que a empresa já produz todo dia.

---

## 2. Trilha 0 — trocar a entrada: vetor em vez de mockup

É o maior ganho de qualidade por unidade de esforço, e não envolve IA nenhuma.

### 2.1 O que se resolve de graça

| caso do catálogo | hoje (raster) | com o vetor |
|---|---|---|
| `F3`/`F4` branco é chapa | elege **um** índice de fundo; um 2º tom de branco vira tinta (`regions.py:247`) | branco é `#FFFFFF` ou "sem preenchimento" — não há 2º tom |
| `B7` dois tons da mesma tinta | quantizador parte a cor, precisa de `merge_delta_e` | um `fill` é um `fill`. Zero ambiguidade |
| `D1` degradê = N tintas | inferido por **pureza modal** (0,10–0,12 vs 0,95–1,00) | o objeto é `linearGradient` com **N stops explícitos** |
| `D4` não fundir A→B→C | união transitiva a ΔE 39,6 já quebrou uma vez | cores nomeadas/spot; não há o que fundir |
| §11.2 a contradição central | mesmo parâmetro erra nos **dois sentidos** (BURES separa 3 azuis que são 1 rampa; 137 funde dezenas de triângulos) | **desaparece**. Não é uma questão de calibração melhor — a questão deixa de existir |
| `G6` escala jamais presumir | **56 de 66** artes têm escala presumida | o arquivo do plotter tem dimensão real, 1:1 |
| `G8` comprimento de corte | perímetro de contorno rasterizado + simplificação | o **path** é literalmente o que o plotter percorre |
| `S1` lock-up é um elemento | inferido por proximidade/alinhamento | é um `<g>` que o designer agrupou |
| `A1` zona fotográfica = aerografia | entropia local > 4,2 | é um `<image>` embutido. Binário |
| `TEXT_MIRRORED` | julgamento do VLM (32B acertou 4/4, 8B 2/4) | matriz de transformação com determinante negativo. **Exato** |
| `vertices_per_m` (retilineidade) | conta vértices depois de simplificar a 0,5 cm no bitmap | conta segmentos do path. Sem simplificação, sem perda |

Doze casos difíceis, dos quais pelo menos cinco eram **fontes reconhecidas de
erro**, viram leitura de arquivo.

### 2.2 O que continua sendo necessário

Ser honesto sobre o que o vetor **não** resolve:

- **Artes sem fonte vetorial.** Cliente que manda JPEG existe. O caminho raster
  atual continua vivo como fallback, e é bom que ele exista — só deixa de ser o
  caminho principal.
- **Raster embutido.** A foto do morango do 2 Amigos continua sendo pixel. Mas
  agora ela vem **delimitada** pelo próprio arquivo, em vez de precisar ser
  achada por entropia.
- **A doutrina.** Vetor dá geometria, não processo. Nada no arquivo diz "fita
  amarela", "menor área primeiro" ou "adesivo é máscara". Toda a regra de
  produção — que é a parte valiosa e já está escrita — continua igual.
- **`.cdr` é proprietário.** `.eps`/`.ai`/`.pdf` convertem hoje com o pipeline
  que já existe no repo (gs → pdftocairo, `thumbnail.service.ts:568`). Para CDR,
  ou Inkscape em batch, ou pedir ao setor de arte o export EPS — que eles já
  fazem, porque é o que vai para o plotter.

### 2.3 Esforço

Um estágio `ingest_vector` que devolve a mesma estrutura que `regions.py` produz
hoje (região, contorno, furos, cor, contido-em) lendo SVG. O resto do motor —
`boundaries.py`, `classify.py`, `masks.py`, toda a doutrina — **não muda**, porque
consome a estrutura, não o pixel. É o encaixe mais barato possível.

---

## 3. Trilha 1 — fechar o laço com a realidade (o dataset que você já tem)

Aqui está a resposta direta para *"não consigo fornecer um dataset enorme"*.

Você não precisa fornecer. **A empresa já produz um, todo dia, e ninguém está
lendo.**

### 3.1 O que já existe no schema — verificado

| campo | o que é | por que importa |
|---|---|---|
| `ServiceOrder.totalActiveTimeSeconds` | **tempo ativo real** de cada OS, por tarefa, com `assignedToId` | é o rótulo de mão de obra. Medido, não estimado |
| `ServiceOrder.startedAt / finishedAt / pausedAt` | cronologia real, com pausas | separa tempo de trabalho de tempo de cura |
| `Airbrushing.startedAt / finishedAt / price / painterId` | duração e **preço pago** de cada aerografia | é o custo real da linha mais incerta do orçamento |
| `Task.startedAt / finishedAt` + `sectorId` | ciclo por setor | número de sessões real vs previsto |
| `Task.generalPainting` (`paintId`) + fórmulas | tinta efetivamente usada | rendimento real m²/L, contra o `coverageM2PerL` estimado |
| `Layout` ↔ `Task` (`TaskLayouts`) | **liga a arte ao job executado** | é a chave do join. Sem ela nada disso seria pareável |

Ou seja: para cada tarefa já concluída existe o par **(arte, tempo real gasto)**.
Isso é exatamente o que um modelo de custo precisa aprender, e é a única espécie
de rótulo que não depende de ninguém opinar.

### 3.2 O modelo certo aqui é banal

Features do motor (área pintada, nº de elementos, nº de cores, metros de T-T,
nº de sessões, m² de adesivo, m de corte, substrato, tem pintura geral) →
minutos observados por tipo de OS. Dez a quinze features, algumas centenas de
jobs históricos. **Regressão ridge ou gradient boosting.** Interpretável,
auditável, e re-treinável em segundos.

O ganho não é "precisão de IA". É que os números hoje **inventados** no
`painting-compute.service.ts` — `perimetro × 0,3`, `pricePerLiter × 0,7`,
`LIQUID_MASK_DEFAULT_M2 = 8`, `área / 8` (todos catalogados no
`PAINTING_V3_WORKFLOW_SPEC.md` §1.2) — passam a sair de observação.

### 3.3 Duas coisas que esse join deve revelar — proposta

**a) Curva de aprendizado da frota repetida.** O acervo tem `BURES 1` e
`BURES 2`, `2 amigos` e `2 amigos 15`. Uma transportadora adesiva 20 carretas
com a mesma arte. A 2ª unidade é muito mais barata que a 1ª: o arquivo do plotter
já existe, a estratégia de máscara já foi decidida, a equipe já pegou o jeito.
**O motor hoje trata todo job como se fosse o primeiro.**

Isso é a lei de Wright, é medível com um `GROUP BY customerId, layoutId ORDER BY
startedAt`, e não precisa de ML nenhum. Se o efeito existir, é dinheiro sendo
cobrado errado nos dois sentidos: caro demais na repetição, barato demais na
estreia.

**b) Altura de trabalho.** Um implemento tem 2,45 m. O que está a 2,20 m do chão
exige andaime ou escada; o que está a 30 cm exige agachar. Nenhum dos dois rende
como o que está na altura do peito. **O motor já sabe o `y` de cada elemento na
face e joga essa informação fora.** É um multiplicador de tempo grátis, e a
hipótese é testável contra `totalActiveTimeSeconds`.

---

## 4. Trilha 2 — extrair o tácito do dono, com o instrumento certo

Sobram as decisões que **só existem na cabeça do pintor**: `P2` (piso de
cortabilidade), `P3` (o que é "muito vertical"), a tolerância de contato para
agrupar sessões (§7.2, em aberto), e os 6 números não calibrados
(55°, 16 ΔE, 1,6×, 0,10 m², 1,5 cm, 5 cm).

Três rodadas de calibração já falharam. Vale entender por quê, porque a quarta
falha pelo mesmo motivo se o método não mudar:

| rodada | por que não serviu |
|---|---|
| 1–2 | amostrou **cor sobre chapa**, onde a pergunta não existe — sobre chapa o adesivo vai inteiro |
| 3 | invalidada por `B6`/`B7`: o único "não corto" tinha **branco entre as cores**, ou seja, nem era cor sobre cor |

Resultado: **9 marcações, todas "corto"**, de 14 a 61 mm. Um limiar com só um
lado da fronteira não é um limiar.

### 4.1 Três mudanças de método — proposta

**a) Pergunta comparativa, não absoluta.** *"Qual destes dois você corta com
mais folga?"* rende muito mais informação por pergunta que *"você corta este?"*,
e é muito mais estável — o julgamento absoluto de uma pessoa oscila com o dia,
o comparativo não. Trinta pares bem escolhidos dão uma **ordenação completa**
(Bradley-Terry), e a ordenação dá o limiar.

**b) Amostrar na fronteira, não na média.** O valor de uma pergunta é máximo
onde o modelo está mais incerto. Depois de cada resposta, a próxima pergunta é
a que mais reduz a incerteza. É por isso que ~60 perguntas bem escolhidas valem
mais que 600 aleatórias — e é literalmente o oposto do que as rodadas 1–3
fizeram.

**c) Trocar o booleano por risco.** `cortavel_a_mao: bool` é a modelagem errada
do que o pintor sente. Ele não pensa "cortável / não cortável"; ele pensa
**"quanto risco de rasgar a camada de baixo"**. Uma escala ordinal de 0–5
carrega muito mais informação que um sim/não, e dissolve `P2`: você deixa de
precisar do piso exato e passa a precisar de uma **curva monótona de risco** —
que 30 respostas ordinais já produzem (regressão isotônica).

Com risco em vez de booleano, a escolha de rota vira comparação de custo
esperado (`custo_corte + P(rasgo) × custo_retrabalho` vs `custo_verniz + espera`),
que é o cálculo que o pintor faz de cabeça.

### 4.2 Uma hipótese física sobre `P3` que pode matar a pergunta — proposta

O `T3` diz "traçado muito vertical → fita branca", e os 55° estão marcados como
chute meu. Mas *por que* vertical importaria? Fita não sabe o que é vertical.

O substrato padrão do schema é **`CHAPA_FRISOS`** — chapa com frisos, e frisos
correm **na horizontal**. Uma fita que sobe cruzando os frisos **não veda**: ela
não assenta no vale do friso e a tinta sangra por baixo. Uma fita que corre
junto com o friso assenta.

Isso explica `T1` pelo mesmo mecanismo, em vez de como regra separada:
isoplastic e lona são **lisos**, e por isso qualquer curva passa lá.

Se a hipótese estiver certa, a variável não é o ângulo — é **cruzar friso**, e
`T1`/`T2`/`T3` colapsam numa regra física só, com uma medida que o motor já tem
(orientação do traçado) mais uma que ele pode ter (passo do friso, que é
constante por tipo de implemento). **Custa uma pergunta ao dono**: *"numa chapa
lisa, sem friso, um traçado vertical ainda exigiria fita branca?"*

Se a resposta for "não", `P3` fecha sem calibração nenhuma.

---

## 5. Trilha 3 — onde ML clássico realmente ajuda

Depois das trilhas 0–2, sobram dois lugares onde um limiar não basta e um modelo
pequeno cabe bem.

### 5.1 Scorer de junta/separação de elementos

Mesmo com os grupos do vetor, o designer agrupa por conveniência de desenho, não
por unidade de fabricação. Vai sobrar decisão de fundir/separar.

- **Unidade de rótulo**: o **par** de componentes, não a arte. 66 artes × ~6
  elementos × pares vizinhos ≈ **400–800 exemplos**. Isso é folgado para
  regressão logística ou gradient boosting.
- **Features**: as do `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §5 —
  distância normalizada por altura de caractere, compatibilidade de baseline,
  razão de escala, família de cor, estrutura envolvente compartilhada,
  contenção.
- **Por que não rede neural**: o modelo precisa **explicar** por que juntou
  (`§8.3: "Keep the evidence and score so the UI can explain why"`), precisa ser
  determinístico entre execuções, e precisa passar nos testes metamórficos do §12.
  Um GBM de 8 features faz as três coisas; uma rede não faz nenhuma bem.

### 5.2 Classificador de aparência no raster embutido

Só para os pedaços que forem `<image>` dentro do vetor, ou para artes sem fonte
vetorial. As features já estão medidas (pureza modal, resíduo do ajuste de L\*,
razão de borda dura). ~300 rótulos de região — que saem das 66 artes sem
esforço, porque cada arte tem 5 a 20 regiões.

---

## 6. Trilha 4 — a UI de revisão é a fábrica de dataset

Esta é a peça que fecha o problema do "não tenho dataset grande".

O `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §11 já prevê os controles de
revisão: fundir elementos, separar, marcar reserva, escolher técnica, corrigir a
rota. **Cada uma dessas correções é um rótulo.**

Se cada correção gravar `(features do motor, o que ele previu, o que o humano
mudou, arte, data)`, então:

- em 6 meses de orçamentos normais você tem **milhares** de decisões rotuladas;
- os rótulos vêm de quem realmente decide, no contexto real, sem sessão de
  marcação;
- e você ganha uma métrica que hoje não existe: **taxa de correção por tipo de
  decisão**. Se 40% dos planos precisam corrigir a rota da fita, você sabe onde
  investir — sem adivinhar.

Isso é mais valioso que qualquer modelo, porque é a única forma de o sistema
melhorar sem alguém parar para ensiná-lo.

---

## 7. Sobre LLM — a pergunta direta

### Treinar / fine-tunar um modelo de visão nosso: **não**

- 66 artes é 3 ordens de grandeza abaixo do necessário, mesmo com LoRA.
- O modo de falha é exatamente o que um motor de custo não tolera. Já está
  medido no `painting-vision/README.md`: *"uma chamada onde eu esqueci de anexar
  a arte devolveu logomarca, slogan, site e telefone inventados, **em formato
  perfeito**"*. Um modelo que erra com formato perfeito é pior que nenhum.
- Não dá número em cm, não passa em teste de regressão, e cada retreino desloca
  todos os orçamentos.

### LLM local como autoridade: **não**, e os números do repo já dizem por quê

| | medido |
|---|---|
| qwen3-vl **4B** local | 110–175 s por arte, ~3,3 GB |
| qwen3-vl **8B** | **falhou 2 de 4** na verdade conhecida — dispara todos os códigos do prompt, repete em vez de julgar |
| qwen3-vl **32B** | acertou 4/4, mas **18–19 GB em Q4 — não cabe em 16 GB** |
| 32B na nuvem | **3–6 s**, e **US$ 0,036 pelas 66 artes inteiras** |

Rodar 32B local significa comprar placa de 24 GB para substituir uma chamada de
3 centavos. (A RX 570 de 8 GB da estação não entra nessa conversa.) Só compensa
se houver exigência de operar offline — que não é o caso.

### LLM onde ele **é** útil

Três papéis, nenhum no caminho crítico do custo:

1. **Acelerador de rotulagem.** Pré-marca, o dono só corrige. Corrigir é 5× mais
   rápido que marcar do zero — e é o que torna as trilhas 2 e 3 viáveis.
2. **QA contra a doutrina.** "Este plano viola algum caso do
   `PAINTING_CASE_CATALOG.md`?" É revisão de texto contra regra escrita, que é
   onde LLM é forte de verdade.
3. **Nomes amigáveis na UI.** "Logomarca", "Telefone". Puramente cosmético — o
   `PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §1 já concluiu que produção não
   precisa desses nomes.

A regra do §10 daquele documento continua valendo e deve ser tratada como
inviolável: **IA nunca é dona de geometria, dimensão, quantidade de tinta,
comprimento de corte, sequência de produção ou custo final.**

---

## 8. Ordem recomendada

| ordem | trilha | o que destrava | risco |
|---|---|---|---|
| **1** | Vetor como entrada (§2) | 12 casos difíceis viram leitura de arquivo; a contradição da quantização **deixa de existir** | baixo — o resto do motor não muda |
| **2** | Instrumentar a UI de revisão (§6) | começa a acumular rótulo **antes** de precisar deles | baixo |
| **3** | Join com o histórico executado (§3) | tempo e custo saem de observação; testa curva de aprendizado e altura | baixo — é SQL |
| **4** | Active learning do tácito (§4) | fecha `P2`, `P3` e os 6 números não calibrados | médio — depende do tempo do dono, ~60 perguntas |
| **5** | Scorer de agrupamento + aparência (§5) | último caso genuinamente ambíguo | médio |
| **—** | Treinar modelo de visão próprio | — | **não fazer** |

Vale notar a ordem: **1 e 3 encolhem o problema que 4 e 5 teriam que resolver.**
Calibrar cortabilidade sobre contorno rasterizado de mockup, com escala presumida
em 56 de 66 artes, é calibrar contra ruído. Com o vetor, os mesmos 60 pares de
perguntas valem muito mais — porque a medida em mm finalmente é real.

---

## 9. Perguntas para o dono

Todas curtas, todas destravando trabalho:

1. **O EPS/CDR do plotter está guardado para as artes antigas, ou só o mockup?**
   Decide se a trilha 0 vale para o acervo histórico ou só daqui para frente.
2. **Numa chapa lisa, sem friso, um traçado vertical ainda exigiria fita branca?**
   Se não, `P3` fecha sem calibração (§4.2).
3. **A segunda carreta da mesma frota, com a mesma arte, leva menos tempo? Quanto,
   grosso modo?** Confirma se vale medir a curva de aprendizado (§3.3a).
4. **Pintar a 2,20 m de altura é mais lento que na altura do peito?** Confirma o
   multiplicador de ergonomia (§3.3b).
5. **Em vez de "corta / não corta", faz sentido "risco de rasgar, de 0 a 5"?**
   Se sim, `P2` vira curva em vez de limiar (§4.1c).
