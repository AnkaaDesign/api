# painting-teach — estação de marcação

O app onde o dono corrige o motor. Roda o estado atual do motor nas 66 artes do
acervo, mostra **o processo de produção passo a passo com as contas de cada
passo**, e abre um campo de observação em cada ponto onde a análise pode estar
errada — elemento, decisão de rota, sessão, passo, e cada linha de cálculo.

É a fase **F2** do `../PAINTING_TEACHING_LOOP_SPEC.md`. As marcações que saem
daqui são o insumo do relatório de diferenças (F5) e da correção **em lote**
(F6) — nunca arte a arte, que é o que produziu a esteira de regressões
registrada em `layout database/ERROS_E_CORRECOES.md` §1.

```bash
cd ../painting-engine && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ../painting-teach
../painting-engine/.venv/bin/python batch.py     # ~25 min nas 66 artes, 4 processos
./run.sh                                         # http://localhost:8790
```

## O que roda

```
arte PNG
  │
  ├─ painting_engine.pipeline           quantize → regions → classify → boundaries → layout
  │        (import direto, motor intocado)
  │
  ├─ grouping.py     ← NOVO             regiões → elementos de produção, sem IA
  │
  ├─ plan.py         ← NOVO             rotas (doutrina §3/§4) · sessões · passos · CONTAS
  │        (as imagens de cada passo vêm de painting-vision/probe/production.py)
  │
  └─ runs/<versão>/<arte>/{analysis.json, plan.json, img/*.jpg}
                                            │
                              server.py + static/  →  marks/lote-01/<arte>.json
```

## Por que existe um agrupador novo

O passe semântico do motor (`production.py:semantic`) chama o Qwen3-VL, e esta
máquina não tem `OPENROUTER_API_KEY` nem Ollama. Sem elementos não há plano.

`grouping.py` cobre esse buraco pelo caminho que o
`../PAINTING_ELEMENTS_WITHOUT_AI_ARCHITECTURE.md` já recomendava: agrupar por
**contenção, contato, distância entre as formas relativa à altura do caractere,
alinhamento de linha de base e cor comum**, com barreiras de escala e de faixa.

**É v0 de propósito.** O §11 da spec diz que o agrupador definitivo nasce
*depois* da marcação, porque as 66 decisões de fundir/separar do dono é que são
a especificação dele. O que existe aqui serve para haver algo em cima de que
marcar — e por isso cada elemento carrega a **evidência** de cada fusão, que o
app mostra na tela.

Uma coisa esse v0 já ensinou: na BURES, a região `r105` é um fio de antialias de
0,029 m² com a caixa da face inteira (0,14% de ocupação), quantizado na mesma
cor do texto "TRANSPORTE & LOGÍSTICA". Como é conexo e atravessa tudo, ele
sozinho colava a arte inteira num único elemento. Filamentos assim agora saem
como item próprio, listados em "o que o motor jogou fora".

## O que o app mostra em cada arte

| seção | o que pode estar errado ali |
|---|---|
| Escala e premissas | a escala vem de `HEIGHT 245 cm` (não há medida na imagem); substrato e sistema são assumidos |
| Elementos | agrupamento, tipo, rota, traço mínimo, verticalidade, toca-tinta — com a evidência de cada fusão e a trilha da decisão de rota |
| O que o motor jogou fora | descartes por ruído e filamento: se um deles for peça de verdade, o plano está incompleto |
| Sessões de pintura | quem pode entrar na mesma demão (número cromático), e em que ordem |
| Passo a passo | a imagem do estado da peça + a tabela de contas do passo (quantidade, fórmula, parâmetro, fonte) |
| Fechamento | tempo, custo-hora e materiais somados |

Cada bloco de observação registra **verbo fechado + escopo + confiança + texto
livre** (spec §4.2). O escopo (`só esta arte` / `sempre que…` / `sempre`) é o
campo que impede a generalização indevida — a origem literal dos três defeitos
da §2.1 da spec.

## Cuidados

- **Materiais não têm preço.** O preço vem do estoque do ERP e esta máquina não
  fala com o banco de produção. O app mostra a *quantidade*, que é o que o motor
  decide; o custo-hora de R$ 21,30 é o default do seed.
- **`runs/` é gerado e não vai para o git; `marks/` vai.** As marcações são o
  dataset e precisam ser versionadas junto com a mudança do motor que as
  consumiu (spec §4.3).
- **Nada é corrigido durante a marcação.** É essa separação que impede a esteira
  de regressão. Só depois de fechar o lote (F4) é que sai o relatório de
  diferenças.

## Arquivos

| arquivo | o que é |
|---|---|
| `batch.py` | F1 — roda motor + plano nas 66, em processos paralelos; escreve `index.json` (o snapshot de corpus da spec §8.1) |
| `grouping.py` | agrupador determinístico v0 |
| `plan.py` | rotas, sessões, passos e as contas de cada passo |
| `params.py` | todo número que entra na conta, **com a fonte declarada** |
| `server.py` | servidor local (stdlib), sem auth, sem deploy |
| `static/` | o SPA |
| `marks/lote-01/` | as marcações, uma por arte |
