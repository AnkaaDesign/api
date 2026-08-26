# Motor V4 — Plano de implementação

> **Status:** em execução (2026-08-21). Implementação do zero, conforme
> `api/PAINTING_ENGINE_V4_BRIEF.md`. O motor anterior (`painting-engine/`,
> `painting-vision/`, `painting-teach/`) é **referência de armadilhas, nunca
> base** — nenhuma linha é herdada.
>
> **Restrição de projeto (dono, 2026-08-21):** análise **puramente CV** —
> tratamento de imagem, geometria e cálculo em Python (numpy + OpenCV).
> **Nenhum modelo de IA participa da análise.** O que antes dependia do VLM
> (nomear "faixa", "logomarca") vira heurística geométrica com confiança
> ordinal + pergunta ao revisor.

## 0. Hierarquia da verdade (inalterada)

1. As **fichas** dos 5 layouts analisados com o dono (100 Fronteiras, 137
   Pescados, A&P Foods, AAN, ACM) — cada número delas é asserção de regressão.
2. Frases do dono (doutrina do recorte, correções 2.1–2.31, G0–G5).
3. Números medidos com método registrado.
4. Documentação legada — catálogo de armadilhas, nunca especificação.

**Regra nova do dono (2026-08-21, nunca antes documentada):**
> As **aerografias são feitas primeiro**. Terminadas, começa qualquer outra
> parte da logomarca, e a aerografia é **coberta com fita nas bordas e papel
> no centro** — fita em toda a parte que será necessário cortar, papel no
> centro porque só máscara (vinil) direto ficaria muito caro.

Entra no plano como regra de sequência do Programa B e como passo próprio de
cobertura (fita em metro corrido pelo contorno + papel em metro corrido pelo
miolo).

## 1. Forma do produto desta etapa

Um pacote Python (`src/motor/`) com CLI que recebe uma arte (ou o acervo) e
emite, por face:

- `analise.json` — paleta-partição, elementos, topologia, fronteiras, traço,
  degradês/aerografias, adesivos, defeitos, divergências, perguntas — cada
  número com **fonte** e **confiança**;
- `plano.json` — passos (grupos A–D do brief §4.2) na linha do tempo por dia,
  com materiais (medida-base × consumo → quantidade), tempos (base × taxa) e
  justificativa em duas camadas;
- `ficha.md` — a ficha legível, no formato das fichas da série;
- suporte a **overrides** (`--overrides arq.json`): toda decisão pode ser
  sobreposta sem destruir a proposta (o JSON guarda `proposto` + `editado`),
  honrando o §6 do brief em modo headless. A UI vem depois, em cima deste
  contrato.

Parâmetros de oficina em `params/oficina.json` (famílias do brief §3.4), cada
valor com `fonte: dono | medido | chute`. Preços em `params/precos.json`;
material sem preço sai como **quantidade sem custo, sinalizado** — nunca zero.

## 2. Pipeline de análise (por face)

| # | estágio | o que faz | armadilhas que ele carrega |
|---|---|---|---|
| 1 | **moldura** | remove só a moldura de 1–6 px de cor diferente da dominante | nunca cortar "linha uniforme" (comeu 4 308 colunas do 100F) |
| 2 | **escala** | largura declarada no nome > altura-datum 2 450 mm; portão 2,10–2,70 m; prior 0,85 mm/px só como alerta | divergência entre métodos = saída, não erro |
| 3 | **paleta** | censo de cores exatas → discriminante: N cores cobrem ≥98 % ⇒ **vetorial chapado** (semear pelas exatas ≥0,05 %); senão ⇒ **contínuo** (interiores chapados `|∇Lab|<1`, bins Lab 2,0, exclusão gulosa) | fusão a ΔE<4 **sem cadeia transitiva**; partição: cada pixel UMA vez |
| 4 | **antialias** | resíduo (~1 %) propagado espacialmente dos núcleos; classe cujo núcleo some na erosão 2 px = banda; casca por componente (envolve + ΔE<6 dissolve; solto sobrevive) | a mistura de A+B cai em cima de C; fio de antialias funde a arte inteira |
| 5 | **campo** | cor dominante = campo do desenho; neutro L*∈[91,100] ⇒ chapa; abaixo do vazio ⇒ tinta (demão de fundo no painel inteiro) | decisão por GRUPO (o vazio L* 70–91 do acervo), não por linha fina; por face |
| 6 | **componentes/ilhas** | CCL por classe; ilhas da cor do campo dentro de tinta = **de graça** (não se depila) | o que é de graça é a cor do CAMPO DO DESENHO, não da chapa |
| 7 | **elementos** | agrupar componentes por distância de **forma** (dilatação relativa à altura), nunca por caixa; caixa semântica com descarte de região espalhada (>1,6×); rótulo heurístico (TEXTO/FAIXA/MOSAICO/LOGOMARCA) com confiança | lockup = UM elemento; sem VLM o rótulo incerto vira pergunta |
| 8 | **topologia** | aninhado (hierarquia de contornos) / adjacente / isolado; profundidade → **ciclos de adesivo** | mesma tinta em profundidades ≠ = duas demãos; adjacência não tem "dentro" |
| 9 | **fronteira** | transições entre tintas na partição final × π/4 × escala; campo não conta; UM número (G3b — sem ponderar por ΔE); intra-família de rampa separada como artefato | jamais dilatar por cima de filete do campo; metro absoluto E m/m² |
| 10 | **traço** | abertura morfológica (fração <X mm), largura por corrida perpendicular (esqueleto + TD), vértices/m a 5 mm, compacidade | risco de depilação/aplicação, NUNCA "não corta" (G0) |
| 11 | **degradê/aerografia** | pureza modal (chapada ≥0,65 · rampa ≤0,12); rampa: 2 tons (mesma cor clareando) × 3 (atravessa cor) — flag "não calibrado"; tom contínuo/fotográfico = aerografia; split interno (chapado-então-rampa) = máscara dentro da máscara | SEMPRE reportar degradê; achatar é edição humana; aerografia leva adesivo só do contorno EXTERNO |
| 12 | **adesivos** | envelope + folga 80 mm; bobinas 50 (≤460 mm) e 120 (≤1 160 mm); emenda não é custo; agrupa comprimento parecido com vão ≤0,6× altura; ≥2× separa; meio = pergunta; quase-alinhamento trava junto | não inferir escala pela bobina |
| 13 | **faces** | hexes chapados idênticos entre faces ⇒ transferível e cor divergente = DEFEITO; senão mapa afim por canal = exposição; comparação estrutural de elementos (aspecto/nº componentes) ⇒ suspeita de truncamento | traseira é recomposição, nunca escala da lateral |

## 3. Geração do plano (passos)

Dois programas que se intercalam (§3.3 do brief):

- **Programa A — implemento** (só com pintura geral): lavagem → secagem →
  desengraxe → preparação mecânica → desmontagem → empapelamento estrutural
  (tabela por tipo de implemento, extensão pelas medidas do implemento, nunca
  da arte) → demão de fundo (cor de campo, painel inteiro, esquema de demãos)
  → **cura = quebra de dia**.
- **Programa B — arte** (por face), nesta ordem:
  1. **aerografias primeiro** (adesivo do contorno externo → aerografia →
     **cobrir: fita nas bordas + papel no centro**, fita onde haverá corte);
  2. preparação localizada (cinta) quando não há pintura geral;
  3. plotagem + depilação de bancada; aplicação dos adesivos (**inteiros**);
     empapelamento ao redor (peças de papel orientadas pelo lado que protegem,
     metro corrido);
  4. **sessões** = coloração gulosa do grafo "tintas que se tocam" (nº
     cromático, não nº de cores); dentro da sessão, menor área primeiro;
  5. ciclo por sessão: depila → pinta → cobre (caixa se nada mais falta no
     bounding; só a forma se falta) → **corte à mão** nas fronteiras
     compartilhadas (metro × taxa);
  6. elemento aninhado em outra tinta = **ciclo novo**: verniz intermediário →
     cura (dia) → reaplicar adesivo → pintar — com a rota alternativa R2 (sem
     verniz: pinta → seca → reaplica) exposta como opção editável;
  7. faixa orgânica grande = **fita** (amarela × branca pela verticalidade,
     limiar 55° `chute`; substrato = pergunta);
  8. remoção, verniz final (boundings fundidos ≤5 cm, seguindo o adesivo),
     remontagem, inspeção, limpeza.

Linha do tempo em **dias**; cura quebra o dia. Nunca emitir passo vazio.

## 4. Orçamento

- **Área paga tinta**: janela (bounding repartido por território) × esquema de
  demãos × rendimento; tinta é **mistura** (tinta + catalisador + diluente).
- **Fronteira paga hora**: corte à mão, fita, junta de precisão em metro
  corrido; **ciclos** multiplicam custo (verniz + espera + reaplicação).
- Papel em metro corrido de bobina (kraft 100 cm); vinil em m² de caixa física.
- Toda linha: `item · medida-base · consumo/un · qtd · un · preço · total · fonte`.

## 5. Regressão — inegociável (§8.5)

- `tests/fixtures/<layout>.yaml`: esperado por arte. Fontes em 3 níveis:
  `ficha` (dono — 5 layouts), `doutrina` (casos ditados), `assistente`
  (minhas análises visuais, não verificadas pelo dono — servem de sentinela).
- `tools/rodar_acervo.py`: roda as 65 artes, gera tabela esperado × obtido ×
  diff; **nenhuma correção entra se quebrar caso verde**; toda mudança de
  parâmetro roda o acervo inteiro.
- Asserções iniciais (das fichas): escalas e dimensões dos 5; paleta (5 tintas
  100F; marinho+5 azuis 137; 2 ouros + branco único A&P; 4 famílias AAN; 14/12
  cores exatas ACM); campo (branco×cinza×roxo); fronteiras (4,0 · 38,3 · 0,35 ·
  16,9+29,5 · 69,9 m, tolerância ±10 %); 37 ilhas de graça do 100F; degradês
  detectados (AL cinza, arco vinho, sombra ACM — e a traseira do ACM chapada);
  defeito 137 (truncamento entre faces); mosaicos (122 tri/5 azuis · 117 tri/11
  verdes); adesivos (2 · 6 · 4+fita · 3+fita · 3+3).

## 6. Ordem de execução desta implementação

1. ~~Ler toda a documentação e as fichas~~ ✔
2. ~~Censo CV do acervo (65 artes)~~ ✔ (`scratchpad/census.json`)
3. Análises visuais próprias dos layouts sem ficha (eu + subagentes por
   layout, formato padronizado) → fixtures `assistente`
4. Núcleo: cor/escala/moldura/paleta/antialias/campo (com testes de unidade)
5. Geometria: componentes/elementos/topologia/fronteira/traço
6. Classificação: degradê/aerografia/faixa/mosaico
7. Adesivos + faces + perguntas/divergências
8. Plano + orçamento + ficha.md
9. Rodar o acervo inteiro → comparar → corrigir **em lote** com regressão
10. Fichas finais + relatório esperado × obtido + atualização do brief (§13)

## 7. Limites conhecidos e honestos

- **Erro de texto igual nas duas faces** (PRODUTROS) é indetectável sem leitura
  de texto; o motor lista os elementos de texto para revisão humana.
- **2×3 tons de degradê** sem limiar calibrado (não existe caso de 3 tons no
  acervo) — sai como proposta + pergunta.
- **Tempos e preços**: taxas `chute` sinalizadas até calibrar com o ERP.
- **Substrato e cor de chegada**: nunca na arte ⇒ sempre premissa editável +
  pergunta com default declarado.
