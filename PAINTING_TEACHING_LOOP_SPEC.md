# Ensinar o motor — estação de marcação e ciclo de correção em lote

> Status: **ESPECIFICAÇÃO** (2026-08-12). Nada implementado. Este documento é o
> acordo antes de construir.
>
> Substitui a §4 ("active learning do tácito") do
> `PAINTING_ML_STRATEGY_2026-08-12.md`, que propunha correção **sequencial** —
> descartada pelo dono, com razão (§2).
>
> Fonte de cada afirmação: **decidido** (acordado nesta conversa), **verificado**
> (li no repositório), **medido** (número já registrado nos docs), **proposta**
> (minha, ainda não confirmada).

---

## 0. De onde isto veio

A pergunta original: *"o que falta para o motor entender o processo de pintura,
e devemos treinar uma IA nossa com menos de 100 artes?"*

Duas correções do dono fecharam o desenho:

1. **A entrada é sempre imagem do cliente.** Ler o vetor do plotter resolveria
   12 casos difíceis, mas não serve: o objetivo é orçar direto do que o cliente
   manda, e cliente não manda vetor. A trilha do vetor sobrevive só como
   **gabarito de teste** (§9.1), nunca como caminho de produção.
2. **Ensinar o motor, não treinar um modelo** — e ensinar **em lote**, não em
   série (§2).

O que sobrou válido do documento anterior está inventariado em §9.

---

## 1. A decisão: o motor é o modelo

Não se treina rede. **As regras são os pesos, o dono é o gradiente, e eu sou o
passo de otimização.**

Por que isto é certo para 66 artes, e não é preguiça:

| | ensinar o motor | treinar um modelo |
|---|---|---|
| exemplos por regra | **1 basta**, se a regra estiver certa | centenas do mesmo caso |
| auditabilidade | cada decisão rastreia a um caso com ID e fonte | peso opaco |
| regressão | `test_casos.py` trava o que já funciona | retreino desloca tudo |
| modo de falha | erra e você vê onde | erra **em formato perfeito** (medido) |

A infraestrutura já existe e é boa: `PAINTING_CASE_CATALOG.md` é especificação
executável, `painting-vision/tests/test_casos.py` são as asserções, e
`ERROS_E_CORRECOES.md` é o registro do que já quebrou. O ciclo abaixo é
formalizar o que esses três arquivos já vinham fazendo informalmente.

---

## 2. Por que em lote — e não uma arte de cada vez

### 2.1 O problema da correção em série

`ERROS_E_CORRECOES.md` §1, verbatim: **"a maior parte dos defeitos veio de
correções anteriores."**

| defeito | veio de |
|---|---|
| 3 azuis separados na BURES | artefato do seeder — e a fusão **compensava** o artefato |
| fusão encadeando ΔE 39,6 | union-find transitivo escrito **para consertar o item acima** |
| logomarca partida em 3 | frase de prompt posta **para consertar a BURES** |

Corrigir em série é **otimização gulosa**: cada passo satisfaz uma restrição e
quebra outra, e o sistema oscila. Não é falta de cuidado — é a mecânica do
processo.

### 2.2 O discriminante só existe no contraste

Argumento mais forte, e a evidência é do próprio motor. O §11.2 do
`CONHECIMENTO_DO_MOTOR.md` registra que **o mesmo parâmetro errou nos dois
sentidos opostos**:

- **BURES 2**: separou 3 azuis que eram **uma rampa**
- **137 PESCADOS**: fundiu **dezenas de triângulos** em 2 azuis

Nenhuma das duas artes, sozinha, contém a informação que resolve. Olhando só a
BURES você aperta o limiar; só o 137, você afrouxa. A **pureza modal** (rampa
0,10–0,12 · chapado 0,95–1,00 · banda vazia entre 0,12 e 0,65) só é achável com
as duas medidas juntas.

**Conclusão: a unidade de aprendizado é o acervo, não a arte.** Em lote o
conjunto inteiro de restrições fica visível de uma vez, e dá para procurar a
regra que satisfaz **todas** simultaneamente. É ajuste, não remendo.

---

## 3. O ciclo, em sete fases

```
F0  tornar executável no Linux            ──►  baseline conhecida
F1  rodar as 66 em lote                   ──►  saídas + renders + snapshot v0
F2  construir a estação de marcação       ──►  o app
F3  sessão de marcação (dono)             ──►  todas as dimensões, salvando
F4  submissão                             ──►  corpus de correções CONGELADO
F5  relatório de diferenças (eu)          ──►  classes, discriminantes, efeito previsto
F6  implementação em lote                 ──►  casos + testes ANTES do código
F7  verificação por diff de corpus        ──►  aprovação arte a arte
                                               └──► próximo lote
```

Nada de F5–F7 começa antes de F4 fechar. **Não se corrige nada durante a
marcação** — é essa separação que impede a esteira de regressão.

---

## 4. A estação de marcação

### 4.1 A inversão: revisar por dimensão, não por arte

66 artes × ~8 estágios ≈ **500 telas** se for arte a arte. Inviável — e pior:
arte a arte **esconde o contraste**, que é justamente o que se quer ver.

Então cada tela é uma **dimensão**, com as 66 artes juntas:

| tela | o que mostra | verbos disponíveis |
|---|---|---|
| **Cores** | as 66 paletas quantizadas | `FUNDIR` · `SEPARAR` · `FALTOU_COR` · `E_RAMPA` · `E_CHAPA_FUNDO` · `E_RUIDO` |
| **Fundo/reserva** | as 66 máscaras de branco | `TAMBEM_E_CHAPA` · `NAO_E_CHAPA` · `MODO_ERRADO` |
| **Regiões** | contornos | `REGIAO_ESPURIA` · `FALTOU_REGIAO` · `CONTORNO_ERRADO` |
| **Elementos** | as 66 decomposições em caixas | `FUNDIR` · `SEPARAR` · `MOVER_REGIAO` · `E_FAIXA` · `E_AEROGRAFIA` · `FALTOU_ELEMENTO` |
| **Fronteiras T-T** | mapas vermelho/verde | `NAO_E_TT` (+motivo: filete · mesma tinta · pintura geral · rampa) · `E_TT_E_NAO_VIU` |
| **Classificação** | rótulo por região | `CHAPADO` · `DEGRADE` · `MOSAICO` · `AEROGRAFIA` |
| **Cortabilidade** | silhuetas **ordenadas pelo sinal medido** | `RISCO_0..5` (ordinal, §4.4) |
| **Rota / fita** | tabela das 66 decisões | as rotas do enum |
| **Sessões** | agrupamentos por arte | `VAO_JUNTAS` · `NAO_PODEM_JUNTAS` |
| **Plano** | passos gerados | `FALTA_PASSO` · `PASSO_NAO_EXISTE` · `ORDEM_ERRADA` · `TEMPO_IRREAL` |

Fluxo de uso: você varre o contact sheet, clica **só nos errados**, e só neles
entra fundo. A maioria estará certa. E numa tela dessas a BURES e o 137
aparecem **lado a lado** — a única condição em que dá para ver o que os separa.

Ordenação dos contact sheets: por **sinal medido** quando houver um (cortabilidade
por traço mínimo, cores por ΔE mínimo entre sementes), senão por confiança
crescente do motor. Pôr os casos-limite vizinhos é o que torna a fronteira
visível.

### 4.2 O registro de uma observação

Verbo fechado (processável) **+** explicação livre (é onde o mecanismo se
esconde — as frases do dono *"corto pois é simples"* / *"esse é muito difícil"*
foram a origem da cortabilidade de dois eixos).

```jsonc
{
  "id": "obs-0042",
  "dimension": "ELEMENTOS",
  "art": "BURES 2 8.40.png",
  "target": { "kind": "ELEMENT", "ids": ["el-3", "el-4"] },
  "verdict": "FUNDIR",
  "payload": {},
  "scope": "SEMPRE_QUE",              // SO_ESTA_ARTE | SEMPRE_QUE | SEMPRE
  "scopeCondition": "quando o símbolo está dentro da mesma placa branca do texto",
  "explanation": "isso é uma logomarca só, sai num adesivo só",
  "similarTo": ["obs-0031"],
  "confidence": "CERTO",              // CERTO | ACHO
  "markedAt": "2026-08-13T10:22:00Z"
}
```

Quatro campos que carregam peso desproporcional:

- **`scope`** — declarado por você **na hora**. Sem ele eu generalizo demais, que
  é a origem literal dos três defeitos da §2.1.
- **`scopeCondition`** — quando `SEMPRE_QUE`, é a condição na sua língua. Vira o
  candidato a regra.
- **`similarTo`** — só existe em lote: você ligando dois casos é você me
  entregando a hipótese de discriminante de graça.
- **`confidence`** — marcação `ACHO` **nunca** vira caso duro. As rodadas 1–3 de
  calibração morreram em parte por tratar marcação incerta como verdade.

### 4.3 Armazenamento

Arquivos JSON no repo (`api/painting-teach/marks/`), **não** banco. Motivo: as
marcações *são* o dataset e precisam ser versionadas **junto com a mudança do
motor que as consumiu**. É a mesma auditabilidade que o projeto já pratica.

Salvar/retomar é requisito — isto não se faz numa sentada.

### 4.4 Cortabilidade: ordinal, não booleano

`cortavel_a_mao: bool` é a modelagem errada do que o pintor sente. Ele não pensa
"cortável / não cortável" — pensa **"quanto risco de rasgar a camada de baixo"**.

Escala 0–5 carrega muito mais informação por marcação e **dissolve `P2`**: deixa
de ser preciso achar o piso exato e passa a bastar uma **curva monótona de
risco** (regressão isotônica), que ~30 marcações já produzem. A escolha de rota
vira comparação de custo esperado —
`custo_corte + P(rasgo) × custo_retrabalho` vs `custo_verniz + espera` — que é o
cálculo que o pintor faz de cabeça.

Restrição de amostragem, aprendida das rodadas que falharam: **só marcar
elementos em cor sobre cor**. Sobre chapa o adesivo vai inteiro e a pergunta não
existe — foi o que invalidou as rodadas 1 e 2. E a vizinhança tem de respeitar
`B6`/`B7` (filete de chapa, tons da mesma tinta), que foi o que invalidou a 3.

---

## 5. Três coisas que só existem em lote

### 5.1 Detecção de contradição na própria marcação

Se você marcar risco 0 no elemento A e risco 5 no B, e A e B forem **idênticos
em todos os eixos que o motor mede**, então:

- ou existe um eixo que ninguém está medindo,
- ou uma das duas marcações escorregou.

O app avisa **na hora**, mostrando os dois lado a lado. É exatamente o que teria
matado as rodadas 1–3 no primeiro minuto, e é como a cortabilidade de dois eixos
(espessura × retilineidade) foi descoberta — só que de propósito.

### 5.2 Efeito previsto antes de implementar

Com o conjunto completo eu consigo afirmar, **antes de escrever a linha**:
*"esta mudança conserta 4 artes, muda 1 e quebra 0 — e são estas."* Em série isso
é impossível: você só descobre depois.

### 5.3 Cobertura — o que eu **não** posso generalizar

Depois de agrupar as observações, classes com **um exemplo só** não viram regra.
Um exemplo é anedota; três é regra. O app devolve a lista: *"marcou isto 1 vez —
preciso de mais 2 ou 3 do mesmo tipo antes de virar mecanismo"*. É aprendizado
ativo dirigido pelo lote, e evita o overfit de regra escrita para uma arte.

---

## 6. A triangulação: motor / eu / você

Eu refazendo a análise sozinho produziria resposta **melhor** que o motor — e
não se aprenderia nada sobre por que o motor falha. O valor está em corrigir a
saída **do motor**.

Mas o meu palpite independente, dado **depois da submissão e só sobre os casos
marcados** (não custa nada nos ~70% que o motor acerta), vira diagnóstico:

| motor | eu | você | significado | onde fica a correção |
|---|---|---|---|---|
| ✗ | ✓ | ✓ | a informação **está** na imagem; o algoritmo não extrai | código do estágio |
| ✗ | ✗ | ✓ | a informação **não está** na imagem — é conhecimento do ofício | vira regra/parâmetro, **nunca** inferência |
| ✓ | ✗ | ✓ | motor certo, eu errado | não mexer |
| ✓ | ✓ | ✗ | o que *parece* certo não é o que a produção faz | **doutrina nova — o caso mais valioso** |

A segunda linha evita o erro já documentado na doutrina §7.1: escrever detector
para um sinal (`sobre CHAPA|TINTA`) que depois se **mediu indistinguível** nas
66 artes (medianas 28,7 × 25,6 mm; 4,5 × 4,0; n=422). Se eu também não consigo
ver, é porque não dá para ver — vira regra declarada, não detector.

---

## 7. O relatório de diferenças (F5) — o que eu entrego

Não é "um patch por observação". É, **por classe de erro**:

```
CLASSE: rampa partida em tintas separadas
  errou em .................. BURES 2, Aquarela lateral, …
  ACERTOU em casos parecidos . 137 PESCADOS, ACM lateral      ← a parte que importa
  medidas nos dois grupos .... pureza modal, |∇LAB|, nº de matizes, ΔE mín. entre sementes
  discriminante .............. pureza modal — rampa 0,10–0,12 | chapado 0,95–1,00
  correção ................... parâmetro `flat_modal_min` (não é código)
  efeito previsto ............ conserta 4 · muda 1 (Aquarela 5→3 cores) · quebra 0
  caso novo .................. D5
```

Quando **nenhuma medida separa os dois grupos**, o relatório diz isso na cara, e
há só três saídas honestas:

1. medir algo que ainda não se mede (e dizer o quê),
2. virar **regra declarada** ou entrada do formulário,
3. assumir que o caso fica ambíguo e vai para confirmação humana na UI.

Inventar detector para o que não é separável é o erro do §7.1 se repetindo.

---

## 8. As cinco regras duras da implementação (F6/F7)

1. **Caso antes de código.** Cada correção aceita vira entrada no
   `PAINTING_CASE_CATALOG.md` (ID, condição, comportamento, fonte) e asserção em
   `test_casos.py` **antes** de o motor ser tocado.
2. **Corrigir no estágio que errou, nunca a jusante.** O app atribui o erro a um
   estágio (`quantize` → `regions` → `classify` → `boundaries` → `elements` →
   `layout` → plano). A fusão da BURES foi bug de `quantize` consertado em
   `merge` — e por isso reapareceu.
3. **Parâmetro antes de código.** Se um limiar em `params.py` resolve, não se
   escreve mecanismo novo. Mecanismo só para caso genuinamente desconhecido.
4. **Diff de corpus é o portão de aceitação.** Toda mudança roda nas 66 e mostra
   o delta arte a arte; você aprova uma a uma. É isso que transforma "conserto da
   BURES" em **regra**.
5. **Nenhum caso verde pode ficar vermelho.** Regra que já existe e já provou
   valor — aqui ela vale para o lote inteiro, não por correção.

### 8.1 O snapshot de corpus

```jsonc
{
  "engineVersion": "0.2.0",
  "paramsHash": "…",
  "arts": {
    "BURES 2 8.40.png": {
      "ok": true,
      "background": { "mode": "WHITE_PLATE", "coveragePct": 0.68 },
      "colors": 4, "gradientColors": 2,
      "regions": 37,
      "boundariesTT": 2, "boundariesTTLengthCm": 412.0,
      "elements": 5, "sessions": 3, "steps": 15,
      "routes": { "el-1": "FITA_AMARELA", "…": "…" },
      "alerts": ["EDGE_CROPPED_CONTENT", "…"]
    }
  }
}
```

~200 linhas de código, e é o mecanismo de maior valor do ciclo inteiro.

---

## 9. O que sobrou do `PAINTING_ML_STRATEGY_2026-08-12.md`

| trilha | destino |
|---|---|
| **Vetor como entrada** | **descartada** como produção. Sobrevive como **gabarito** (§9.1) |
| **Histórico executado** (`ServiceOrder.totalActiveTimeSeconds`, `Airbrushing.price`) | **válida e ortogonal** — calibra *tempo e dinheiro*, não a *análise*. Trilha independente |
| **Não treinar modelo de visão** | **mantida** |
| **LLM como acelerador de rotulagem / QA / nomes na UI** | **mantida**, fora do caminho de custo |
| **Active learning sequencial** | **substituída** por este documento |
| **Hipóteses físicas** (friso, altura de trabalho, curva de aprendizado, risco ordinal) | **abertas.** O risco ordinal vira o verbo de Cortabilidade (§4.4); as outras seguem como perguntas ao dono |

### 9.1 O vetor como gabarito

Quando existir o EPS/AI interno **da mesma arte** que está no acervo em PNG, ele
dá a verdade exata — quantas cores, quais grupos, contorno real, escala real —
**sem ninguém marcar nada à mão**. Vira teste automático de quanto o caminho
raster errou, e é gratuito onde os arquivos existirem. Nunca entra em produção.

---

## 10. Bloqueios verificados

| # | bloqueio | consequência |
|---|---|---|
| **B1** | **O motor nunca rodou nesta máquina.** Não existem `painting-engine/.venv` nem `painting-vision/.venv`; `calib_sheet.py` tem `/Users/kennedycampos/…` cravado (`ARTS_DIR`). A pilha foi desenvolvida no Mac | nada acontece antes de F0 |
| **B2** | **O estágio `elements` não existe no motor.** `ALL_STAGES = ("quantize","regions","classify","boundaries","layout")`. O agrupamento vive em `painting-vision/probe/production.py:253 build_elements(analysis, sem, …)` e `sem` é **a saída do Qwen** | orçar da imagem do cliente exigiria chamada de nuvem por orçamento. Resolvido em §11 |
| **B3** | **Não se sabe em quantas das 66 o motor completa o pipeline** | F1 responde. É o primeiro número real da baseline |
| **B4** | **As 66 artes são mockups internos limpos** — o cliente manda JPEG comprimido, screenshot, ou foto de prova impressa | o acervo não cobre a robustez que o objetivo exige. §12 |

---

## 11. O estágio `elements`: construir **depois** da marcação

Decisão tomada e vale registrar o porquê, porque a intuição diz o contrário.

O `PAINTING_V3_WORKFLOW_SPEC.md` §5 e o
`PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §8 já especificam um agrupador
determinístico (conexão, contenção, proximidade relativa, alinhamento, estilo
compartilhado). Construí-lo **antes** da marcação seria construir no escuro:
seus parâmetros de agrupamento são exatamente o que as marcações vão revelar.

Então:

1. Na rodada de marcação, a tela **Elementos** mostra o agrupamento **atual**
   (via Qwen), mesmo imperfeito — o que importa é você ter em cima de que marcar.
2. Suas 66 decisões de fundir/separar **são a especificação** do agrupador.
3. O estágio determinístico é construído em F6 **contra elas**, e o Qwen sai do
   caminho crítico.

Ou seja: o agrupador nasce ajustado, não ajustado depois.

---

## 12. Robustez: o lote 2, e por que ele importa

Todo o acervo é mockup de aprovação — plano, limpo, sem perspectiva. O que o
cliente manda é outra coisa: JPEG recomprimido, redimensionado, print de tela,
ou foto de uma prova impressa com sombra e reflexo.

O **lote 2** deve ser as **mesmas 66 artes degradadas de propósito**:
recompressão, redução, rotação de 1–2°, ruído, sombra. As marcações do lote 1
continuam valendo como verdade — o que se mede é **se a saída do motor muda**.
É literalmente o "metamorphic tests" do
`PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` §12, e não custa marcação nova
nenhuma.

Se a arte degradada mudar de plano, o orçamento do cliente é instável — e isso é
pior que erro constante, porque erro constante se calibra.

---

## 13. Estrutura proposta

```
api/painting-teach/
├── README.md
├── run.sh                    # sobe o servidor local
├── server.py                 # importa painting_engine e probe/ direto, zero duplicação
├── batch.py                  # F1: roda as 66, salva saídas + renders
├── corpus.py                 # snapshot + diff (§8.1)
├── contradict.py             # §5.1
├── static/                   # SPA: contact sheets por dimensão + canvas de correção
├── runs/<engineVersion>/     # saídas e renders do lote (gerado, não versionado)
└── marks/                    # ⭐ as marcações — versionadas no git
    └── lote-01/*.json
```

Servidor Python local, sem auth, sem deploy, offline. Importa o motor
diretamente — nenhuma lógica de análise é reimplementada no app.

---

## 14. Perguntas em aberto

| # | pergunta | por que trava |
|---|---|---|
| 1 | O que o cliente manda **exatamente** — export da arte (JPEG/PNG plano) ou foto de implemento/prova? | muda o pré-processamento inteiro e define o lote 2 (§12) |
| 2 | A sessão de marcação pode ser fatiada por dimensão ao longo de dias, ou tem que fechar de uma vez? | define se F4 congela por dimensão ou só no fim |
| 3 | Numa chapa **lisa, sem friso**, um traçado vertical ainda exigiria fita branca? | se não, `P3` fecha sem calibração — a variável seria **cruzar friso**, não o ângulo |
| 4 | A segunda carreta da mesma frota, mesma arte, leva menos tempo? Quanto? | curva de aprendizado; trilha de custo, não de análise |
| 5 | Pintar a 2,20 m de altura é mais lento que na altura do peito? | multiplicador de ergonomia; o motor já sabe o `y` e joga fora |

---

## 15. Próximo passo

**F0**, e é mecânico:

1. Subir os dois ambientes Python no Linux e destravar os caminhos cravados do Mac
2. Rodar `pytest` nos dois (24 do motor + o catálogo) → baseline conhecida
3. Rodar as 66 em lote com renders por estágio → responde **B3**
4. Só então construir a estação

O passo 3 já entrega um número que hoje não existe: em quantas das 66 o motor
sequer completa o pipeline.
