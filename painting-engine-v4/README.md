# Motor V4 — Análise e Precificação de Layout de Pintura

Reimplementação do zero conforme `api/PAINTING_ENGINE_V4_BRIEF.md`.
**CV puro** (numpy + OpenCV) — nenhum modelo de IA participa da análise.
O motor anterior (`painting-engine/`, `painting-vision/`) é catálogo de
armadilhas, não base: nenhuma linha foi herdada.

## Rodar

```bash
cd api/painting-engine-v4

# uma arte
PYTHONPATH=src .venv/bin/python -m motor.cli arte "../layout database/AKTL.png" --out saida

# um layout (lateral + traseira + comparação entre faces + ficha.md)
PYTHONPATH=src .venv/bin/python -m motor.cli layout "ACM" --out saida

# o acervo inteiro (sequencial, ~RAM-seguro)
PYTHONPATH=src .venv/bin/python -m motor.cli acervo --out saida

# regressão: esperado (fixtures) × obtido (saída)
.venv/bin/python tools/comparar.py --saida saida --md regressao.md

# auditoria da rodada: leitura por face + FLAGS heurísticos + overlays
.venv/bin/python tools/auditoria.py --saida saida --md saida/auditoria.md
.venv/bin/python tools/render_auditoria.py --saida saida   # → saida/auditoria/*.png

# INTERFACE (brief §5/§6) — tela do plano + tela do passo com o QUADRO
./ui/run.sh            # → http://localhost:8765
```

## A interface (`ui/`)

Servidor local sem dependências (stdlib) + página única (`ui/index.html`):

- **Tela do plano** — premissas sempre visíveis com a FONTE de cada número
  (declarada · altura-datum · editada), os dois eixos do custo, linha do
  tempo por dia com as barreiras de cura desenhadas, pendências em português
  e divergências.
- **Tela do passo** — o QUADRO: o estado real da peça no início do passo,
  desenhado VETORIALMENTE dos contornos extraídos (nunca filtro sobre a
  imagem), com camadas ligáveis (estado, atuação, contorno de corte, caixas
  de adesivo, fronteira compartilhada, cotas) e legenda com quantidades;
  as contas (`item · medida-base · consumo · qtd · preço · total · fonte`);
  a justificativa em duas camadas (frase + trilha recolhida).
- **Edição §6** — medida declarada e campo CHAPA×TINTA editáveis; Recalcular
  reprocessa a face inteira em cascata e grava `edicoes[]` com
  `proposto_pelo_motor` × `editado` (sobreposição, nunca destruição).

## O que sai por layout

- `<layout>.json` — análise completa por face (paleta-partição, campo,
  elementos, topologia/ciclos, fronteiras, traço, zonas contínuas, adesivos,
  perguntas, divergências) + plano (passos por dia) + orçamento (quantidades
  com fonte; preços vêm do ERP — sem preço = sinalizado, nunca zero) +
  comparação lateral×traseira (defeitos de arte).
- `<layout>.ficha.md` — a ficha legível, no formato da série.

## Estrutura da verdade

1. `tests/fixtures/*.yaml` com `fonte: ficha` — números verificados pelo dono
   (5 layouts). **Asserções duras.**
2. `fonte: doutrina` — casos ditados pelo dono (BURES, 2 amigos, mar e rio).
3. `fonte: assistente` — análise visual do Claude, sentinela não verificada.

Nenhuma correção entra se quebrar caso verde; toda mudança de parâmetro roda
o acervo inteiro e mostra o diff (`tools/comparar.py`).

## Parâmetros

`params/oficina.json` — famílias do brief §3.4; cada valor com
`fonte: dono | medido | chute`. Os `chute` são os primeiros suspeitos quando
um plano sair estranho, e estão sinalizados na saída.

## Decisões de projeto (por que assim)

- **Partição, nunca máscaras sobrepostas** — fronteira de uma forma consigo
  mesma já produziu 767 m fantasma (AAN).
- **Dois caminhos de semeadura** — cores exatas (render vetorial chapado,
  ≥98% de cobertura) × interiores chapados (contínuo). Um parâmetro único
  erra nos dois sentidos (ACM × BURES).
- **Resíduo → zonas × bandas** — resíduo com núcleo (erosão 2 px) é zona
  contínua (degradê/aerografia/sombra); banda fina é antialias e se propaga
  ESPACIALMENTE dos núcleos (a mistura de A+B cai em cima de C).
- **Fronteira esfumada ≠ fronteira de corte** — zona×tinta com transição
  suave não gera corte à mão (B5); contorno duro gera (caso ACM, medido
  rente à borda).
- **Sem VLM** — rótulos de elemento (TEXTO/FAIXA/MOSAICO/LOGOMARCA) são
  heurística geométrica com confiança ordinal; incerteza vira pergunta.
- **Aerografia primeiro** (regra do dono, 21/08): coberta depois com fita nas
  bordas + papel no centro.
- **Fita por trecho e por substrato** (R5): amarela 20 mm = curva leve
  horizontal (qualquer chapa) e vertical leve (só lisa); branca 45 mm
  cortada = vertical na corrugada ou curva apertada. A análise carrega os
  DOIS cenários; o substrato é premissa editável (`premissas.substrato`).
- **Folha divide por conteúdo** (R2-7 refinada): partes pequenas fora da
  banda de altura (o rabo do "g") viram folha própria quando a economia de
  filme compensa — no máximo 2 saliências por lado.
- **Aerografia exige TEXTURA fotográfica no miolo** (R5): arte vetorial de
  rampas (fita dourada, pincelada rasgada) é degradê de janela; zona com
  dois trabalhos colados separa por matiz/parte lisa.
- **Máscara 60 cm** cobre o recém-pintado entre sessões; papel TK desenhado
  com veios na direção da bobina (V=100 cm, H=50 cm).
