# Motor V4 — Relatório de implementação (2026-08-21)

> Reimplementação do zero conforme `api/PAINTING_ENGINE_V4_BRIEF.md`.
> **CV puro** (numpy + OpenCV), nenhum modelo de IA na análise.
> O motor anterior ficou intocado como catálogo de armadilhas.

## O que foi entregue

- **`src/motor/`** — pipeline completo por face: moldura (2 passes) → escala
  (declarada→datum com portão) → paleta-partição (2 caminhos de semeadura) →
  antialias (zonas × bandas) → campo (chapa × tinta) → fronteiras (Crofton,
  filete-aware) → famílias (degrau pixel-a-pixel) → elementos/topologia →
  degradê/aerografia/sombra → traço → adesivos (bobinas) → comparação entre
  faces → plano (passos por dia) → orçamento (quantidades com fonte) →
  perguntas e divergências como saída de primeira classe.
- **`tests/fixtures/`** — corpus de regressão com 46 layouts: 5 fichas do
  dono (asserções duras), casos de doutrina (BURES, 2 amigos, mar e rio) e
  36 sentinelas de análise visual (12 subagentes, formato padronizado).
- **`tools/comparar.py`** — esperado × obtido, arte a arte, PASS/FAIL.
- **`tools/panorama.py`** — uma linha por face com os números que pagam a
  conta.
- **Saída por layout**: `<layout>.json` (contrato completo, tudo com fonte)
  e `<layout>.ficha.md` (a ficha legível, no formato da série).
- **Overrides** (`--overrides arq.json`): edição headless — sobreposição sem
  destruição, com `proposto_pelo_motor` preservado (§6 do brief).

## Estado da regressão

- **Layouts-âncora (5 fichas do dono + doutrina): 142/142 asserções verdes.**
  Escala, painel, campo, nº de tintas, m² por tinta (ΔE ≤ 0,9 do hex da
  ficha), demão de fundo, fronteira compartilhada, ilhas de graça, degradês,
  adesivos (contagens do dono: 2 · 6 · 4 · 3 · 3+3) e transferibilidade de
  hex entre faces.
- **Acervo completo (65 artes): resultado final na seção abaixo.**
- Testes de unidade: 6/6 (filete, Crofton, fusão sem cadeia, portão de
  escala, parse de medida, moldura+antialias).

## Divergências DELIBERADAS com as fichas (anotadas nas fixtures)

1. **AAN n_tintas**: a ficha reporta 4 famílias (preto/cinza/vinho/oliva) —
   agrupamento semântico por marca, com classes a ΔE ~6 entre grupos,
   indivisível por cor pura. O motor entrega famílias cromáticas + pergunta
   de fusão ao revisor.
2. **AAN fronteira 16,9 m**: a ficha mediu na partição de 12 classes; o
   motor esfuma os contatos de rampa e chega a ~8 m de corte à mão puro +
   ~22 m esfumados. A soma física é equivalente — **pendência para o dono:
   qual é a régua de custo da hora ali?**
3. **Fronteira de zona contínua** (rampa/aerografia × tinta): classificada
   como **borda de aerografia** (fita na cobertura, regra de 21/08), não
   corte à mão de mascaramento. Muda BURES 1/2 e as artes contínuas.

## A interface (2ª rodada de 21/08 — brief §5/§6)

`./ui/run.sh` → **http://localhost:8765**. Servidor stdlib (zero dependências)
+ página única. O que implementa:

- **Tela do plano (§5.1)**: premissas sempre visíveis com a FONTE de cada
  número; os dois eixos do custo; linha do tempo por dia com as barreiras de
  cura; pendências em português; divergências.
- **Tela do passo (§5.2)**: o QUADRO — estado real da peça no início do
  passo, desenhado VETORIALMENTE dos contornos extraídos (`motor/quadro.py`
  exporta polígonos por classe com furos + polilinhas de fronteira por par,
  em mm; cada passo do plano carrega `estado_familias` e `atuacao`).
  Camadas ligáveis com legenda de quantidades; as contas com fonte por
  linha; justificativa em duas camadas.
- **Edição (§6)**: medida declarada e campo CHAPA×TINTA → Recalcular
  reprocessa em cascata (campo TINTA faz nascer o Programa A inteiro) e
  grava `edicoes[]` com proposto × editado.
- **Conferência de textos entre faces**: o motor casa os textos por perfil
  de tinta e a tela mostra os pares LADO A LADO em recortes da arte — é a
  revisão humana que pega "us seja sempre louvado" e PRODUTROS; divergência
  gritante (>45% sem par) vira alerta automático. (Medido: o ruído de render
  entre faces chega a ~30% em pares idênticos — detecção automática de 2
  letras faltando não é confiável, e fingir que é seria pior.)

## A regra nova do dono (21/08) — já no brief §9

Aerografias são o PRIMEIRO trabalho de arte; terminadas, são cobertas com
**fita nas bordas + papel no centro** (fita em toda parte que será cortada;
só máscara sairia caro). O plano emite exatamente esses passos.

## Limites honestos

- Erro de texto igual nas duas faces (PRODUTROS) é indetectável sem leitura
  de texto; os elementos de texto saem listados para revisão humana.
- 2×3 tons de degradê sem limiar calibrado (não há caso de 3 tons no
  acervo) — sai proposta + pergunta.
- Tempos e preços: taxas `chute` sinalizadas; preços `SEM PREÇO` até vincular
  o catálogo do ERP (nunca zero silencioso).
- Substrato e cor de chegada: sempre premissa editável + pergunta.

## Resultado do acervo completo (rodada final, 21/08)

- **65 artes · 46 layouts processados, zero falhas de execução.**
- **Regressão: 451 asserções PASS · 0 FAIL** (`saida/regressao.md`) —
  inclui as 5 fichas do dono com asserções duras e as 41 sentinelas.
- **Panorama** (`saida/panorama.md`): **394,7 m² de tinta · 587 m de corte à
  mão · 410 perguntas emitidas · 8 suspeitas de defeito entre faces** (137
  truncado, ACM elipse/sombra, astutilog campo preto×vermelho, CARLOTTI bloco
  espelhado, Agrícola marca d'água — as conhecidas, mais as novas).
- Saída completa em `saida/`: um `.json` (contrato) + uma `.ficha.md`
  (legível) por layout.

### Onde a triagem mexeu nas sentinelas (documentado nos YAML)

- `zero_tt` de palpite visual removido onde o motor mede contato real
  (ATACADÃO 10,3 m — par escalonado; AVGLOG 5,4 m; AP RANCHARIA ~1 m…) ou
  onde o contato é borda de aerografia (bismark, AGROMINA, 3 IRMÃOS).
- Hex de tinta chutado de preview: limiar sentinela ΔE 20; micro-elementos
  abaixo do piso de semente (selo SISBI, ícone WhatsApp) deixam de ser
  asserção de tinta — aparecem como risco de traço fino.
- Hex da lateral aplicado à traseira (3 IRMÃOS): cada face tem exposição
  própria — regra do 137.

## Rodada 4 (21/08, tarde) — validação manual dos 46 e os 4 defeitos sistêmicos

A pedido do dono, TODOS os layouts do acervo foram validados por análise
manual minha (arte por arte, caderno em `VALIDACAO_MANUAL.md`) — não por
teste. O confronto expôs 4 defeitos sistêmicos que as fixtures não viam,
todos corrigidos em lote com o corpus protegendo os casos exatos
(A&P 0,35 m e 100F 4,05 m seguem EXATOS):

1. **Ciclos/fronteiras fantasma ao redor do branco** → a tese "branco =
   chapa exposta" foi TESTADA E DERRUBADA pela ficha do A&P (3,2 m² de tinta
   INCLUINDO o branco — o passo zero pinta o painel todo). O que ficou:
   aninhado da FAMÍLIA DO CAMPO nunca é ciclo (matou os 21 ciclos falsos do
   Aquarela); branco ≥1,5 m² em campo pintado vira PERGUNTA (pintar ×
   preservar por máscara), default pintar.
2. **Borda aninhada contada como corte à mão** → medida por componente no
   aninhamento e DESCONTADA da fronteira quando a rota é R2/máscara (plotter
   corta); a depilação progressiva CONTINUA pagando (o 4,05 m do 100F é
   isso). banana: 76,7 → 15,6 m; folly lateral: 10,3 → ~0.
3. **Sombra sem teto de área + aero×degradê sem quadrática** → sombra exige
   ≤1,0 m²; o teste do polvo tenta a superfície quadrática antes de declarar
   aerografia. argus ganhou a aerografia do lockup (2,88 m², dia próprio);
   SGT voltou a 1 dia (estrada = degradê de janela, não "5 aerografias").
4. **Campo fatiado pela vinheta perde a eleição** → dominância por agregado
   de rampa (FOLLY: campo verde TINTA, pintura geral) e vinheta-zona funde
   no campo (Aquarela).

Pontuais: verniz de aerografia com dia próprio entra no FIM do dia da aero
(cura de noite — mar e rio 4→3 dias); "sider" no nome + fundo neutro = lona
de fábrica (astutilog lateral, com divergência); campo quase-preto vira
pergunta ("o baú já chega preto?" — BIAVA); filete em feixe de fios
(preench≤0,2, esp≤150) vira FITA mesmo fatiado pelo z-order (elipses do
BALALAC, fio de 15 m do BAHIA SUL); passos de esfumar agrupados por elemento.

_Números finais do RUN10 + comparador: ver `saida/regressao.md` e a tabela
de vereditos em `VALIDACAO_MANUAL.md`._

## Rodada 5 (21–22/08) — fita por trecho/substrato, folha por conteúdo, UI coesa

Mandato do dono: cobrir todos os casos; **maximizar o uso do adesivo** (o
rabo do "g" divide a folha quando economiza); **degradê de texto é UM
degradê na janela** (nunca letra a letra); **fita por substrato** (A&P:
lisa ⇒ amarela 20 mm; corrugada ⇒ branca 45 mm + corte — asserção dura);
UI sem toggles com materiais em largura/veio reais; analisar cada layout
individualmente por rodada até convergir.

Entregue (detalhe em `VALIDACAO_MANUAL.md`, rodada 5):

- **`motor/fita.py`** — técnica por TRECHO do traçado (ângulo + giro/m,
  calibrado na onda do A&P) e por SUBSTRATO, com os DOIS cenários em toda
  análise; `premissas.substrato` editável com recálculo em cascata.
- **Folha por conteúdo** (R2-7 refinada) — perfil de linhas acha a parte
  pequena fora da banda; ≤2 saliências por lado; economia mínima; envelopes
  sobrepostos fundem (≥35%); aproveitamento % por adesivo.
- **Aerografia = textura fotográfica no miolo erodido**; zona com dois
  trabalhos colados separa por MATIZ/parte lisa (a fita dourada do 2 amigos
  → o dia 4 do texto sobre o banner envernizado voltou, tol 0).
- **Vinheta de render em campo CHAPA funde** (3 IRMÃOS, astutilog);
  mosaico nunca é ciclo (137/ACM restaurados); filete atravessador depena
  do mega-elemento (BAHIA/SGT) com guardas anti-letra e anti-contorno;
  stencil com gate de fragmentação (CAVALCANTE); campo secundário MACIÇO
  (≤2 classes) = fita no contorno + papel, não vinil (AURIZ) — com o 100F
  protegido ("sobre chapa, gigante segue de vinil", dono).
- **Plano**: limpeza localizada (C12), um passo POR adesivo, cobertura com
  MÁSCARA 60 cm, degradês antes dos ciclos, materiais de fita por cenário.
- **UI refeita**: sem toggles; papel kraft com veios NA direção da bobina
  (50 cm horizontal = linhas horizontais), máscara/fitas em largura real
  levemente amareladas, folhas divididas desenhadas, degradê como UMA rampa
  na janela, tabela "cores que se tocam" com o tratamento de cada metro.
- **Ferramentas de rodada**: `tools/auditoria.py` (FLAGS heurísticos) e
  `tools/render_auditoria.py` (overlays das decisões sobre a arte).

**Estado final: 466 PASS · 0 FAIL · 9/9 unidade.** Acervo: 382 m² de tinta
de arte (632 com demãos de fundo) · 431 m de corte à mão · 972 m² de vinil
(41 folhas divididas, −17 m² de filme) · fita lisa 296 m amarela/30 m
branca · corrugada 252 m/74 m · máscara 4 106 m · papel 1 880 m · dias:
26×1 · 11×2 · 4×3 · 5×4 · 362 perguntas · 18 flags, todos julgados.
