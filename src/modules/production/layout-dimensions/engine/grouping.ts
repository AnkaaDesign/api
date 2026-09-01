/**
 * Dos caminhos para os ADESIVOS.
 *
 * O projetista não cota traço, cota adesivo: o logotipo com a assinatura embaixo
 * é UMA peça a ser colada, e é dela que sai a cota. Aqui os caminhos viram
 * peças (folga curta, solda glifo com glifo) e as peças viram conjuntos (folga
 * longa, solda logotipo com tagline).
 *
 * Duas classes ficam de fora do agrupamento e são tratadas à parte:
 *  - o CONTORNO da face, que é desenho de referência e não adesivo;
 *  - o ENVELOPAMENTO, que sangra pelas bordas e não tem bbox útil — dele
 *    interessa apenas ONDE cruza a aresta.
 */

import { rectArea } from "./geometry";
import { panelWidthCm, rectToCm } from "./panel";
import type {
  BleedAxes,
  BorderCrossing,
  PanelEdge,
  RGB,
  PageGeometry,
  Panel,
  AlignedEdge,
  PartEdges,
  Pt,
  Rect,
  Scale,
  Sticker,
  VectorObject,
} from "./types";

export interface GroupingParams {
  /** folga mínima que solda glifos de uma mesma peça (cm reais) */
  partGapCm: number;
  /**
   * A folga entre letras cresce com o corpo do texto.
   *
   * Uma folga fixa ou parte a palavra num logotipo grande ou solda duas linhas
   * de um bloco de contato. Medir a folga como fração da ALTURA da peça resolve
   * as duas pontas: num logotipo de 1 m as letras se juntam, e num bloco de
   * texto de 11 cm as duas linhas continuam separadas.
   */
  textGapFactor: number;
  /**
   * Teto da folga adaptativa.
   *
   * Sem teto, uma maçã de 2,5 m de altura pede 1,5 m de folga e engole o
   * logotipo que está 60 cm ao lado. O teto é o que separa "juntar as letras de
   * uma palavra" de "juntar tudo que estiver na mesma metade da carreta".
   */
  maxPartGapCm: number;
  /**
   * Espessura da faixa que reúne subformas na mesma altura, em fração do tamanho.
   *
   * Com os 7% de antes o ápice de um círculo reúne 51% das colunas e se
   * disfarça de reta; com 3,5%, reúne 37% e não passa. É a diferença entre
   * aparar a roda do logotipo Ki e deixá-la em paz.
   */
  alignmentBandFrac: number;
  /** quantas colunas a varredura do perfil usa */
  profileSamples: number;
  /** Subformas distintas que precisam parar na mesma altura. */
  alignmentMinShapes: number;
  /** Escape para fonte de poucas peças: tantas subformas, se cobrirem largura. */
  alignmentWideShapes: number;
  alignmentWideCoverFrac: number;
  /**
   * Fração das colunas do perfil que precisa terminar na faixa.
   *
   * É o teste mais seletivo isolado: com 0,3 passam 70,7% dos níveis
   * verdadeiros e 7,8% dos proibidos; com 0,5, passam 54,7% e 2,1%.
   */
  alignmentMinProfileFrac: number;
  /**
   * Teto da ÁREA de tinta que pode sobrar além da linha.
   *
   * É o freio que corta 75% dos níveis proibidos antes de qualquer outro teste,
   * e é a definição operacional de descendente: a perna do "p" é fina, então
   * mesmo descendo 25% da altura ela carrega pouca tinta. Uma linha que deixa
   * de fora um oitavo da tinta não está aparando exceção, está cortando letra.
   */
  alignmentMaxInkBeyond: number;
  /** Recuo máximo admitido, em fração da altura da peça. */
  alignmentMaxRetractFrac: number;
  /** Peça mais baixa que isto não tem linha a inferir (cm reais). */
  alignmentMinSizeCm: number;
  /** Peça com menos subformas que isto é desenho, não texto. */
  alignmentMinSubShapes: number;
  /** Recuo menor que isto não muda cota nenhuma — o valor é inteiro em cm. */
  alignmentMinRetractCm: number;
  /**
   * Recuo mínimo em FRAÇÃO da altura da peça.
   *
   * O piso absoluto de 1 cm não protege peça grande. No logotipo TRANSGENIO,
   * de 24,7 cm de altura, a linha recuava 1,05 cm — 4% — e o que ficava de
   * fora não era descendente nenhum: é o *overshoot* das letras redondas, que
   * em qualquer tipografia decente ultrapassam um pouco a linha das retas para
   * parecerem do mesmo tamanho. O quadro descia um fio abaixo do topo das
   * letras e o desenho parecia desalinhado.
   *
   * Descendente de verdade é outra ordem de grandeza: mediana de 20,3% da
   * altura, p90 27,9%. Oito por cento cai no vazio entre os dois — apara a
   * perna do "g" e o "t" alto, ignora o arredondamento do "O".
   */
  alignmentMinRetractFrac: number;
  /**
   * Recuar a cota até a LINHA DE ALINHAMENTO, em vez do extremo da tinta.
   *
   * Em "Supermercado" o "p" desce sozinho abaixo de todas as outras letras.
   * Cotar até ele dá um número certo e inútil: naquela altura não há nada para
   * alinhar. A referência do aplicador é a base onde S, u, e, r, m, c, a, d, o
   * se apoiam.
   *
   * Ficou desligado por quatro tentativas, e a razão era honesta: calibrar
   * QUANDO a reta existe derrotava todo limiar — o ápice de um círculo se
   * disfarça de planalto, a capitular escapa do quantil, a cursiva não faz
   * planalto por subforma. O que faltava não era um limiar melhor, era a
   * pergunta certa: não "isto parece reto?" mas "quanta TINTA sobra além
   * daqui?". Descendente é fino por definição — a perna do "p" desce 25% da
   * altura e leva 3% da tinta. Com esse freio somado à contagem de subformas e
   * ao perfil, o acerto vai de 30,0% para 41,1% e a preservação do extremo,
   * quando ele é que vale, de 73,4% para 98,9% — três falsos positivos em 358
   * âncoras, contra setenta antes.
   */
  alignEdges: boolean;
  /**
   * Alcance da solda AO LONGO da linha, em múltiplos da altura do texto.
   *
   * A folga entre letras não é constante: na assinatura do FRUTAMINA ela vai de
   * 10,8 a 16,1 cm (mediana 13,8) para uma altura de x de 22 cm, porque a linha
   * é espaçada de propósito. O motor alcançava 14 cm fixos e cortava a palavra
   * em `Fru|ta|é|Vita|m|in|a|P|ura`. No acervo, 11,9% das folgas DENTRO de um
   * run passam de 14 cm.
   */
  lineGapFactor: number;
  /**
   * Alcance ao longo de uma LINHA DE BASE compartilhada, em alturas de texto.
   *
   * Um vão maior que a altura da letra não separa palavras quando as duas
   * assentam na mesma reta: em "Alimentando  Saúde" o projetista pôs espaço
   * duplo — 23 cm para 21 de altura, 1,12 × —, e o alcance de uma altura
   * cortava a frase no meio. Quem não divide a base não ganha nada disto, e o
   * teto de `maxLineGapCm` continua valendo, então só o texto MIÚDO (abaixo de
   * 20 cm de altura) sente a diferença — que é onde a entreletra larga mora.
   */
  textLineGapFactor: number;
  /**
   * Quanto duas bases podem divergir e ainda serem a mesma reta, em fração da
   * altura da menor. A base do "S" redondo transborda a do "a" um fio, pelo
   * mesmo arredondamento óptico que a linha de alinhamento já conhece.
   */
  textBaselineTolFrac: number;
  /** teto do alcance ao longo da linha (cm reais) */
  maxLineGapCm: number;
  /**
   * Alcance da solda ENTRE linhas — muito menor, e é esse o ponto.
   *
   * A folga era a mesma nas duas direções, então a palavra soldava com a linha
   * de baixo antes de existir o conceito de linha. Separando os dois alcances,
   * o texto vira LINHA primeiro e só depois as linhas se juntam num conjunto,
   * onde a regra de largura pode falar.
   */
  lineStackFactor: number;
  /** teto do alcance entre linhas (cm reais) */
  maxLineStackCm: number;
  /**
   * Razão de alturas para duas caixas contarem como da MESMA linha.
   *
   * É o que autoriza o alcance largo: ele vale entre glifos de um mesmo texto,
   * não entre um glifo e o desenho ao lado.
   */
  weldHeightRatio: number;
  /**
   * Cobertura de largura para duas linhas EMPILHADAS formarem um adesivo só.
   *
   * Regra do dono, textual: "raramente colamos 1 adesivo onde o componente
   * abaixo não cubra a mesma largura". Medido nos casos que ele mostrou:
   * GRUPO/ALVORADA 100% (junta, e junta certo), amigão/SUPERMERCADOS 64%,
   * Carajás/FRIGORÍFICO 53%, clebin/distribuidora 60% — os três últimos são
   * peças separadas. O limiar cai limpo entre 64% e 100%.
   */
  stackWidthCoverFrac: number;
  /**
   * Marca multicor: razão de ÁREAS para duas formas serem a mesma peça.
   *
   * Razão de DIAGONAIS não serve de porteiro — o "FRIGORÍFICO" do Carajás passa
   * por 0,507 num limiar de 0,5, e a regra que devia separá-lo o aprova por um
   * triz. Por área ele é reprovado com folga: 0,08.
   */
  overlapMergeAreaRatio: number;
  /**
   * Distância entre contornos para a marca multicor.
   *
   * O degradê desses arquivos é feito de formas chapadas de cores diferentes, e
   * elas NÃO se sobrepõem: ou se encostam (o coração do Amigão dá 0,00 cm) ou
   * correm com um filete branco (a foice da FRICARNE, 5,28 cm). Um teste de
   * área sobreposta não pega nenhum dos dois — o critério é proximidade de
   * contorno com porte comparável.
   */
  overlapMergeGapCm: number;
  /**
   * Boundary-share gate for the multicolour rule: minimum fraction of the
   * SMALLER shape's contour that must run within reach of the other shape.
   *
   * Applies only to the reach EXTENSION band (past overlapMergeGapCm): within
   * the classic reach any proximity merges, as before. Calibrated on the band
   * pairs of the corpus: true gradient halves 8-12 cm apart score 0.022-0.084
   * (ADRI FRUTAS 0.022, ROBARIO 0.033); the one merge the designer's own dims
   * reject (Marins Frutas, +7 deep tips) scores 0.000-0.011.
   */
  overlapMergeShareFrac: number;
  /**
   * Quanto duas caixas precisam se ALINHAR para a solda valer.
   *
   * Proximidade sozinha solda o que não é uma peça só. No TRANSGENIO três
   * blocos escuros invisíveis no desenho (sobra de recorte) faziam ponte entre
   * a onda da porta e o endereço do rodapé, e saía um item de 3,9 m. Letras de
   * uma palavra compartilham a LINHA; duas linhas de um bloco compartilham a
   * COLUNA. O que não compartilha nem uma nem outra e só se toca pela quina não
   * é a mesma peça, por mais perto que esteja.
   */
  weldAlignFrac: number;
  /**
   * Separar TODO caminho com subformas distantes, e não só os que sangram.
   *
   * Separa a marca d'água de dois blocos que o CorelDRAW exporta como um
   * caminho só. O risco é o oposto: um logotipo cujas subformas estão mais
   * longe que a folga de solda se despedaça e some no piso de área.
   */
  splitPlainPaths: boolean;
  /** folga que solda peças de um mesmo conjunto (cm reais) */
  lockupGapCm: number;
  /**
   * Cannot-link span for the lockup fixpoint: a candidate union that touches
   * no face edge yet sweeps more than this fraction of a panel axis is refused
   * before any merge rule votes. 0.55 is the monster detector's own threshold
   * — the guard and the metric it protects agree by construction.
   */
  monsterSpanFrac: number;
  /**
   * Ink-containment threshold for nested different-colour pairs: the fraction
   * of the smaller piece's sampled outline points that must sit INSIDE the
   * larger's filled outline. 0.9 keeps an emblem floating in a seal disc while
   * a C-shaped host (text in a concavity) scores near 0 and stays separate.
   */
  inkContainInsideFrac: number;
  /**
   * Sampling cap for the ink-containment test: at most this many outline
   * points are point-in-polygon tested per pair, so a dense aggregate outline
   * cannot turn the fixpoint quadratic. 200 keeps the estimate stable to a few
   * percent — far finer than the 0.9 threshold needs.
   */
  inkContainSampleCap: number;
  /** adesivo menor que isto não recebe cota */
  minAreaCm2: number;
  /**
   * Piso de ruído por OBJETO, não por adesivo.
   *
   * Filtrar objeto pequeno antes de agrupar despedaça texto: o "I" e o "1" de
   * uma frase têm poucos cm² e sumiam, sobrando cacos de palavra como se
   * fossem adesivos soltos. O tamanho só decide depois que as peças estão
   * juntas — aqui passa tudo que não é poeira de vetor.
   */
  minObjectCm2: number;
  /** objeto que cobre mais que isto da face é envelopamento, não adesivo */
  bleedAreaFrac: number;
  /**
   * Margem para considerar que o objeto encosta na aresta.
   *
   * Era 1,5 cm — 0,4 mm no papel a 1:10. A onda do TRANSGENIO fecha 3,1 cm
   * acima do piso (0,3 mm no papel) e por isso "não encostava": o desenhista
   * fecha a curva rente ao chão, não em cima dele. No acervo o segundo menor
   * afastamento de um elemento até uma aresta tem p01 de 7 cm — entre 1,5 e 7
   * praticamente não existe nada, e 4 cai no meio desse vazio.
   */
  bleedTouchCm: number;
  /**
   * Fração do menor item que precisa estar DENTRO do maior para que cores
   * diferentes ainda contem como um adesivo só.
   *
   * O "Ki" branco vive dentro do círculo verde: é um logotipo, sai numa peça.
   * Já "HORTIFRUTI" verde só cai dentro da CAIXA da maçã vermelha por acaso —
   * cobre 64% dela e fica de fora; são duas peças, coladas uma de cada vez.
   */
  nestedMergeFrac: number;
  /** trecho mínimo de aresta que vira cota de travessia */
  crossingMinRunCm: number;
  /**
   * A que distância da aresta a travessia é lida.
   *
   * Tem de ser quase zero. A faixa chega à quina quase tangente, então cada
   * centímetro que se entra na face desloca o cruzamento dezenas de centímetros
   * na horizontal — a cota acabava bem antes do fim real da faixa. Lê-se num
   * feixe de amostras coladas na aresta e toma-se a UNIÃO: assim a medida nunca
   * corta a faixa antes da hora.
   */
  crossingInsetsCm: number[];
  /** une travessias picadas por vãos curtos */
  crossingMergeCm: number;
  /**
   * Folga máxima entre os CONTORNOS de duas peças que correm juntas.
   *
   * A onda preta do TRANSGENIO não encosta na faixa vermelha e não a sobrepõe:
   * elas correm paralelas, com um friso branco de folga praticamente constante
   * (4,0 cm, mediana 6,2). Nenhuma regra do motor enxergava isso — a de cor
   * separa, a de aninhamento exige 85% de caixa dentro de caixa (o par dá 0,63)
   * e a de toque usa a folga de um glifo, 1,5 cm, num ornamento de 2,6 m.
   */
  companionGapCm: number;
  /** quanto do contorno da peça menor precisa correr dentro dessa folga */
  companionRunFrac: number;
  /**
   * Razão mínima entre as diagonais: peça companheira tem PORTE comparável.
   *
   * É o que separa o ornamento composto de "GRESPAN vermelho + Pães preto",
   * que são duas peças de tamanhos muito diferentes, uma embaixo da outra.
   */
  companionSizeRatio: number;
  /**
   * Acima disto a peça menor está DENTRO da maior: é arte sobre fundo, e não
   * companheira. É o que impede fundir texto com a faixa que lhe serve de
   * base — de longe o padrão mais comum do acervo (1.449 pares).
   */
  companionInsideFrac: number;
  /**
   * A cor da cota da casa. O desenho do projetista NÃO é arte a cotar.
   *
   * 201 dos 259 arquivos do acervo já vêm com as cotas desenhadas, e o motor as
   * lia como adesivo. Uma linha de cota é um traço de 4 m de comprimento e
   * 0,22 pt de espessura atravessando a face: ela encosta em duas arestas, entra
   * no agrupamento e SOLDA tudo o que cruza. Era daí que saía o "adesivo" de
   * 5,5 m do TRANSGENIO, e é por isso que a mesma arte dava agrupamentos
   * diferentes nas duas faces — o projetista só cotou a de cima.
   */
  dimensionInkColor: RGB;
  /** tolerância de cor para reconhecer o traço de cota */
  dimensionInkTolerance: number;
  /** acima desta espessura (pt) o traço azul é arte, não cota */
  dimensionInkMaxStrokePt: number;
  /** área máxima (pt²) de uma forma cheia azul para valer como seta de cota */
  dimensionInkMaxArrowPt2: number;
  /**
   * Quantas alturas de linha pode ter o lado maior de um ícone satélite.
   *
   * Um selo redondo abraça a linha por fora: ele é mais alto que a maiúscula
   * porque tem de caber ascendente, descendente e a folga do círculo. Duas
   * alturas cobrem o selo do WhatsApp de 26 cm ao lado de uma linha de 15 e
   * ainda recusam a régua deitada, que é o que essa porta existe para barrar.
   */
  iconSatelliteSizeRatio: number;
  /**
   * Teto de trabalho de contorno por face, em pares de segmento.
   *
   * Nenhum limiar do motor é este: é o freio de mão. Um desenho pode ser
   * arbitrariamente pesado — o fundo d'água do MAR & RIO chega com 25 mil
   * pontos em 299 polígonos — e o teste de contorno é O(n·m) por PAR de itens.
   * Quando isso escapa, não escapa devagar: a aba trava, e trava junto a régua
   * manual, que corre na mesma thread e é o que o operador usaria para
   * contornar o problema. Cotar mal é um defeito; impedir de medir é outro, e
   * bem pior.
   *
   * Medido no acervo em modo navegador (641 faces): mediana 0,05 M, p99
   * 3,0 M, e o pior caso — a face de emoticons, 358 peças — 4,2 M. Sessenta
   * milhões é catorze vezes o pior arquivo que existe aqui: quem estourar não
   * é uma arte difícil, é uma arte que este motor não sabe ler, e aí a resposta
   * certa é dizer isso e sair da frente. Zero desliga o freio.
   */
  contourWorkBudget: number;
  /**
   * Distância de cor (RGB) abaixo da qual duas peças ainda são o mesmo adesivo.
   *
   * Vinil é cortado por cor: "GRESPAN" vermelho e "Pães congelados" preto são
   * duas peças que o aplicador cola separado, mesmo coladas uma na outra no
   * desenho. Peças que se SOBREPÕEM continuam juntas — aí é um logotipo
   * multicor, impresso de uma vez.
   */
  colorMergeDelta: number;
}

export const DEFAULT_GROUPING: GroupingParams = {
  partGapCm: 1.5,
  textGapFactor: 0.6,
  maxPartGapCm: 12,
  profileSamples: 160,
  // Preset CONSERVADOR. O preset "padrão" (minShapes 6, profileFrac 0,30,
  // inkBeyond 0,12) dá 0,6 ponto a mais de recall triplicando os falsos
  // positivos — e uma linha errada corta letra, que é pior que não ter linha.
  alignmentBandFrac: 0.035,
  alignmentMinShapes: 8,
  alignmentWideShapes: 2,
  alignmentWideCoverFrac: 0.55,
  alignmentMinProfileFrac: 0.45,
  alignmentMaxInkBeyond: 0.08,
  alignmentMaxRetractFrac: 0.4,
  alignmentMinSizeCm: 8,
  alignmentMinSubShapes: 6,
  alignmentMinRetractCm: 1,
  alignmentMinRetractFrac: 0.08,
  alignEdges: true,
  splitPlainPaths: true,
  lineGapFactor: 1,
  textLineGapFactor: 1.5,
  textBaselineTolFrac: 0.15,
  maxLineGapCm: 30,
  lineStackFactor: 0.25,
  maxLineStackCm: 8,
  weldHeightRatio: 0.5,
  stackWidthCoverFrac: 0.8,
  overlapMergeAreaRatio: 0.4,
  overlapMergeGapCm: 8,
  overlapMergeShareFrac: 0.02,
  weldAlignFrac: 0.4,
  lockupGapCm: 14,
  monsterSpanFrac: 0.55,
  inkContainInsideFrac: 0.9,
  inkContainSampleCap: 200,
  minAreaCm2: 90,
  minObjectCm2: 1.5,
  bleedAreaFrac: 0.35,
  bleedTouchCm: 4,
  nestedMergeFrac: 0.85,
  crossingMinRunCm: 12,
  crossingInsetsCm: [0.15, 0.4, 1],
  crossingMergeCm: 20,
  companionGapCm: 8,
  companionRunFrac: 0.5,
  companionSizeRatio: 0.6,
  companionInsideFrac: 0.5,
  dimensionInkColor: [0x33, 0x74, 0xa9],
  dimensionInkTolerance: 26,
  dimensionInkMaxStrokePt: 1,
  dimensionInkMaxArrowPt2: 300,
  colorMergeDelta: 60,
  iconSatelliteSizeRatio: 2,
  contourWorkBudget: 60_000_000,
};

function inflate(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/** Quanto do menor retângulo está dentro do maior, de 0 a 1. */
function nestedFraction(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(rectArea(a), rectArea(b));
  return smaller > 0 ? (w * h) / smaller : 0;
}

function union(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * União de retângulos por proximidade — o mesmo que dilatar e rotular, sem
 * raster. `compatible` deixa a chamada vetar uma junção que a distância
 * permitiria (é por ali que a cor entra).
 */
function cluster(
  boxes: Rect[],
  gapPt: number | ((i: number) => number),
  compatible?: (a: number, b: number) => boolean,
): number[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const gapOf = typeof gapPt === "function" ? gapPt : () => gapPt;
  const grown = boxes.map((b, i) => inflate(b, gapOf(i) / 2));
  const order = boxes.map((_, i) => i).sort((a, b) => grown[a].x0 - grown[b].x0);
  for (let i = 0; i < order.length; i += 1) {
    const a = order[i];
    for (let j = i + 1; j < order.length; j += 1) {
      const b = order[j];
      if (grown[b].x0 > grown[a].x1) break;
      if (!overlaps(grown[a], grown[b])) continue;
      if (compatible && !compatible(a, b)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i += 1) {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  }
  return [...groups.values()];
}

/**
 * Por quais arestas o objeto sangra, e — o que decide tudo — por quais EIXOS.
 *
 * Contar arestas soltas confunde duas coisas diferentes. Uma faixa colada na
 * quina esquerda encosta na esquerda, no teto e no piso: três arestas, e a
 * conta antiga dizia "envelopamento, não tem posição a cotar". Ela tem posição
 * horizontal — falta só a vertical, porque varre a altura inteira. Contando
 * PARES OPOSTOS a distinção aparece sozinha, e ela vale muito: dos 420
 * envelopamentos do acervo, só 11,7% sangram pelos DOIS eixos. Os outros 88,3%
 * tinham uma posição a cotar e a perdiam por causa dessa conta.
 */
function bleedAxesOf(r: Rect, panelPt: Rect, tolPt: number): BleedAxes {
  const edges: PanelEdge[] = [];
  const left = r.x0 <= panelPt.x0 + tolPt;
  const right = r.x1 >= panelPt.x1 - tolPt;
  const top = r.y0 <= panelPt.y0 + tolPt;
  const bottom = r.y1 >= panelPt.y1 - tolPt;
  if (left) edges.push("left");
  if (right) edges.push("right");
  if (top) edges.push("top");
  if (bottom) edges.push("bottom");
  return { edges, horizontal: left && right, vertical: top && bottom };
}

function unionAxes(list: BleedAxes[]): BleedAxes {
  const edges = new Set<PanelEdge>();
  for (const a of list) for (const e of a.edges) edges.add(e);
  return {
    edges: [...edges],
    horizontal: edges.has("left") && edges.has("right"),
    vertical: edges.has("top") && edges.has("bottom"),
  };
}

/** Distância ponto-segmento, o tijolo de `contourDistance`. */
function pointToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * Caixa de cada polilinha, guardada pelo próprio vetor de pontos.
 *
 * Os polígonos são os MESMOS objetos a cada rodada — o que muda é o array que
 * os reúne — então a caixa se calcula uma vez por polígono no arquivo inteiro.
 */
const polyBoxes = new WeakMap<Pt[], Rect>();

function polyBox(poly: Pt[]): Rect {
  const hit = polyBoxes.get(poly);
  if (hit) return hit;
  const box: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of poly) {
    if (p.x < box.x0) box.x0 = p.x;
    if (p.y < box.y0) box.y0 = p.y;
    if (p.x > box.x1) box.x1 = p.x;
    if (p.y > box.y1) box.y1 = p.y;
  }
  polyBoxes.set(poly, box);
  return box;
}

/** Um trecho de polilinha com a caixa dele: o tijolo da poda. */
interface SegmentChunk {
  poly: Pt[];
  /** primeiro e último VÉRTICE do trecho; os segmentos são [i0, i1) */
  i0: number;
  i1: number;
  box: Rect;
}

/** Quantos segmentos cabem num trecho antes de a caixa deixar de podar. */
const CHUNK_SEGMENTS = 32;

const chunkCache = new WeakMap<Pt[], SegmentChunk[]>();

function chunksOf(polys: Pt[][]): SegmentChunk[] {
  const out: SegmentChunk[] = [];
  for (const poly of polys) {
    if (poly.length < 2) continue;
    const cached = chunkCache.get(poly);
    if (cached) {
      for (const c of cached) out.push(c);
      continue;
    }
    const own: SegmentChunk[] = [];
    for (let i = 0; i + 1 < poly.length; i += CHUNK_SEGMENTS) {
      const i1 = Math.min(i + CHUNK_SEGMENTS, poly.length - 1);
      const box: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let k = i; k <= i1; k += 1) {
        const p = poly[k];
        if (p.x < box.x0) box.x0 = p.x;
        if (p.y < box.y0) box.y0 = p.y;
        if (p.x > box.x1) box.x1 = p.x;
        if (p.y > box.y1) box.y1 = p.y;
      }
      own.push({ poly, i0: i, i1, box });
    }
    chunkCache.set(poly, own);
    for (const c of own) out.push(c);
  }
  return out;
}

/** Distância entre duas caixas: piso da distância entre o que há dentro delas. */
function boxGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  return dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy);
}

/**
 * Os dois CONTORNOS se aproximam a menos de `limitPt`?
 *
 * O valor devolvido é a distância REAL quando ela cabe em `limitPt`; acima
 * disso é só um número maior que o limite, e nenhum chamador pode lê-lo como
 * medida. Todos perguntam a mesma coisa — "encosta?" —, e é essa promessa mais
 * fraca que torna a poda possível.
 *
 * A poda é o que separa o motor de travar. O teste é segmento contra segmento,
 * O(n·m), e roda por PAR de itens: no MAR & RIO, onde o fundo d'água e o
 * logotipo somam 18 mil pontos, eram 193 milhões de pares de segmentos e SEIS
 * SEGUNDOS de aba congelada — com a régua manual junto, porque tudo isso corre
 * na mesma thread. Agora cada contorno vira trechos de 32 segmentos com a caixa
 * de cada um; dois trechos cujas caixas estão mais longe que o limite não têm
 * como ter segmentos mais perto que ele, e o par inteiro cai fora por UMA
 * comparação de retângulo em vez de mil de segmento.
 *
 * A comparação vértice a vértice, que veio antes, dava falso negativo quando
 * dois contornos se cruzam ENTRE dois vértices amostrados — por isso o teste de
 * cruzamento continua aqui, dentro do trecho.
 */
/**
 * Quanto trabalho de contorno já se gastou, em pares de segmento.
 *
 * É o relógio HONESTO do agrupamento: cresce com o que custa de verdade e não
 * com o que o processador da vez é capaz de fazer por segundo, então a mesma
 * arte gasta o mesmo orçamento na máquina do escritório e na do aplicador — e
 * o resultado não muda conforme a máquina, que é o que um relógio de parede
 * faria. `buildItems` zera a leitura no começo de cada face.
 */
let contourWork = 0;

function contourDistance(a: Pt[][], b: Pt[][], limitPt: number): number {
  if (!a.length || !b.length) return Infinity;
  // Orientation sign of the triangle (p, q, r) — the brick of the segment
  // crossing test. Two segments properly cross when each straddles the line
  // of the other; between sparse Bézier samples the old vertex-only test read
  // such a pair as tens of cm apart (true distance: zero).
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const ca = chunksOf(a);
  const cb = chunksOf(b);
  let best = Infinity;
  contourWork += ca.length * cb.length;
  for (const ka of ca) {
    for (const kb of cb) {
      if (boxGap(ka.box, kb.box) > limitPt) continue;
      contourWork += (ka.i1 - ka.i0) * (kb.i1 - kb.i0);
      for (let i = ka.i0; i < ka.i1; i += 1) {
        const p1 = ka.poly[i];
        const p2 = ka.poly[i + 1];
        for (let j = kb.i0; j < kb.i1; j += 1) {
          const q1 = kb.poly[j];
          const q2 = kb.poly[j + 1];
          const o1 = orient(p1.x, p1.y, p2.x, p2.y, q1.x, q1.y);
          const o2 = orient(p1.x, p1.y, p2.x, p2.y, q2.x, q2.y);
          if (o1 !== o2) {
            const o3 = orient(q1.x, q1.y, q2.x, q2.y, p1.x, p1.y);
            const o4 = orient(q1.x, q1.y, q2.x, q2.y, p2.x, p2.y);
            if (o3 !== o4) return 0;
          }
          // Full segment-to-segment distance for non-crossing segments: all
          // four endpoints against the opposite segment, so a polyline's final
          // vertex participates too (the old loop never tested it as a point).
          const d = Math.min(
            pointToSegment(p1.x, p1.y, q1, q2),
            pointToSegment(p2.x, p2.y, q1, q2),
            pointToSegment(q1.x, q1.y, p1, p2),
            pointToSegment(q2.x, q2.y, p1, p2),
          );
          if (d < best) best = d;
          if (best <= limitPt) return best;
        }
      }
    }
  }
  return best;
}

/**
 * Como duas formas convivem ao longo do percurso.
 *
 * `runFrac` é quanto do contorno da menor corre a menos de `gapPt` da maior —
 * é o que separa "acompanha" de "encosta num ponto". `insideFrac` é quanto do
 * contorno da menor cai DENTRO da maior — é o que separa ornamento composto de
 * arte sobre fundo, que é o padrão mais comum do acervo e não pode fundir.
 */
function companionProfile(
  inner: Pt[][],
  outer: Pt[][],
  gapPt: number,
): { runFrac: number; insideFrac: number } {
  const samples: Pt[] = [];
  const total = inner.reduce((n, poly) => n + poly.length, 0);
  const stride = Math.max(1, Math.ceil(total / 200));
  for (const poly of inner) for (let i = 0; i < poly.length; i += stride) samples.push(poly[i]);
  if (!samples.length) return { runFrac: 0, insideFrac: 0 };
  let near = 0;
  let inside = 0;
  const chunks = chunksOf(outer);
  for (const p of samples) {
    let best = Infinity;
    for (const k of chunks) {
      // a caixa do trecho é o piso da distância até os segmentos dele
      if (
        Math.max(0, Math.max(k.box.x0 - p.x, p.x - k.box.x1)) > gapPt ||
        Math.max(0, Math.max(k.box.y0 - p.y, p.y - k.box.y1)) > gapPt
      ) {
        continue;
      }
      for (let i = k.i0; i < k.i1; i += 1) {
        const d = pointToSegment(p.x, p.y, k.poly[i], k.poly[i + 1]);
        if (d < best) best = d;
        if (best <= gapPt) break;
      }
      if (best <= gapPt) break;
    }
    if (best <= gapPt) near += 1;
    if (pointInsidePolys(outer, p)) inside += 1;
  }
  return { runFrac: near / samples.length, insideFrac: inside / samples.length };
}

/**
 * Regra par-ímpar: o ponto está dentro do contorno?
 *
 * O polígono só é percorrido quando pode contribuir. Não cruza a horizontal do
 * ponto (a caixa não alcança `p.y`), nenhuma aresta troca de lado e a paridade
 * fica igual; termina à ESQUERDA do ponto, e o raio vai para a direita, então
 * também não conta. São 299 polígonos no MAR & RIO, e quase todos caem por um
 * destes dois testes.
 */
function pointInsidePolys(polys: Pt[][], p: Pt): boolean {
  let inside = false;
  for (const poly of polys) {
    if (poly.length < 2) continue;
    const box = polyBox(poly);
    if (p.y < box.y0 || p.y > box.y1 || box.x1 <= p.x) continue;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const diagonal = (r: Rect) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0);

/**
 * As duas caixas se alinham o bastante para valer uma solda?
 *
 * Basta um eixo: as letras de uma palavra dividem a faixa horizontal, as duas
 * linhas de um bloco de contato dividem a coluna. Encostar pela quina não conta.
 */
function alignedEnough(a: Rect, b: Rect, frac: number): boolean {
  const overlap = (a0: number, a1: number, b0: number, b1: number) => {
    const span = Math.min(a1, b1) - Math.max(a0, b0);
    const smaller = Math.min(a1 - a0, b1 - b0);
    return smaller > 0 ? span / smaller : 0;
  };
  return (
    overlap(a.x0, a.x1, b.x0, b.x1) >= frac || overlap(a.y0, a.y1, b.y0, b.y1) >= frac
  );
}

/**
 * Isto é cota que o projetista já desenhou, e não arte do layout?
 *
 * A cor sozinha não decide — um cliente pode ter azul no logotipo. O que decide
 * é a ASSINATURA do desenho de cota, medida no acervo: traço de 0,22 pt (4.361
 * de 4.383 segmentos) e seta cheia de 10,6 × 5,7 pt (2.178 setas). Um logotipo
 * azul é preenchimento largo, não fio de cabelo de metros de comprimento.
 *
 * O rótulo não aparece aqui: ele é texto, e a leitura de geometria não emite
 * objeto de texto (0 de 174.625 no acervo).
 */
function isDimensionInk(obj: VectorObject, params: GroupingParams): boolean {
  const color = obj.stroke ?? obj.fill;
  if (!color) return false;
  if (colorDistance(color, params.dimensionInkColor) > params.dimensionInkTolerance) return false;
  if (obj.stroke && obj.lineWidth <= params.dimensionInkMaxStrokePt) return true;
  return !!obj.fill && rectArea(obj.bbox) <= params.dimensionInkMaxArrowPt2;
}

const rectW = (r: Rect) => r.x1 - r.x0;
const rectH = (r: Rect) => r.y1 - r.y0;

/** Folga livre entre duas caixas em cada eixo (zero quando se sobrepõem). */
function gapsBetween(a: Rect, b: Rect): { x: number; y: number } {
  return {
    x: Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)),
    y: Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)),
  };
}

/** As duas caixas são glifos da MESMA linha de texto? */
function onSameLine(a: Rect, b: Rect, params: GroupingParams): boolean {
  const ha = rectH(a);
  const hb = rectH(b);
  if (ha <= 0 || hb <= 0) return false;
  if (Math.min(ha, hb) / Math.max(ha, hb) < params.weldHeightRatio) return false;
  return gapsBetween(a, b).y <= 0;
}

/**
 * Quanto a mais estreita cobre da mais larga, para duas caixas EMPILHADAS.
 *
 * É a régua da regra do dono: "raramente colamos 1 adesivo onde o componente
 * abaixo não cubra a mesma largura".
 */
function stackWidthCover(a: Rect, b: Rect): number {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const widest = Math.max(rectW(a), rectW(b));
  return widest > 0 ? overlap / widest : 0;
}

/**
 * As duas formas são a MESMA PEÇA multicor?
 *
 * O degradê destes arquivos é feito de formas chapadas de cores diferentes que
 * não se sobrepõem: ou se encostam (o coração do Amigão dá 0,00 cm entre
 * contornos) ou correm com um filete branco (a foice da FRICARNE, 5,28 cm).
 * O que as identifica é proximidade de contorno com PORTE comparável — e o
 * porte se mede por área, não por diagonal, senão o "FRIGORÍFICO" do Carajás
 * passa por 0,507 num limiar de 0,5.
 *
 * É por causa do porte que texto sobre faixa continua separado: 20 cm de texto
 * dentro de uma faixa de 800 cm dá razão de áreas 0,03.
 */
function isSamePieceMulticolour(
  a: { outline: Pt[][]; bbox: Rect },
  b: { outline: Pt[][]; bbox: Rect },
  params: GroupingParams,
  ptPerCm: number,
  wrapLikeHost?: (piece: { outline: Pt[][]; bbox: Rect }) => boolean,
): boolean {
  const areaA = rectArea(a.bbox);
  const areaB = rectArea(b.bbox);
  if (areaA <= 0 || areaB <= 0) return false;
  if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < params.overlapMergeAreaRatio) return false;
  if (!a.outline.length || !b.outline.length) return false;
  // Doctrine-adaptive reach: the flat 8 cm reach stays as the floor (shrinking
  // it below 8 broke merges corpus-wide), but tall shapes earn the doctrine
  // weld — textGapFactor × the smaller height, capped at maxPartGapCm. The old
  // flat reach missed gradient halves sitting in the (8, 12] band (ADRI FRUTAS
  // missed by 0.14 cm).
  const hA = rectH(a.bbox) / ptPerCm;
  const hB = rectH(b.bbox) / ptPerCm;
  const reachCm = Math.min(
    params.maxPartGapCm,
    Math.max(params.overlapMergeGapCm, params.textGapFactor * Math.min(hA, hB)),
  );
  const flatReach = params.overlapMergeGapCm * ptPerCm;
  const reach = reachCm * ptPerCm;
  // Within the classic reach the old rule stands: any contour proximity merges.
  // Gating these pairs — at ANY share threshold — broke legitimate merges
  // corpus-wide (gradient 2.3 -> 8.8pct at a 0.1 gate).
  // Duas perguntas, duas chamadas: `contourDistance` só promete a distância
  // REAL até o limite que recebe, então a faixa estendida precisa perguntar
  // por ela mesma em vez de reler um número medido contra o alcance curto.
  if (contourDistance(a.outline, b.outline, flatReach) <= flatReach) return true;
  if (reach <= flatReach) return false;
  if (contourDistance(a.outline, b.outline, reach) > reach) return false;
  // The extended (flat, doctrine] band is earned, not free: a meaningful
  // fraction of the SMALLER shape's boundary must run within reach of the
  // other. Gradient halves run parallel for their whole length; a mark that
  // merely drifts near a distant stripe does not.
  const [inner, outer] = areaA <= areaB ? [a, b] : [b, a];
  const profile = companionProfile(inner.outline, outer.outline, reach);
  // A comparable-size core living entirely INSIDE the other outline (a
  // gradient centre ring) has zero boundary companionship by construction —
  // containment is its own proof (RIBEIRANIA: insideFrac 1.0, runFrac 0).
  // EXCEPT when the host is wrap-like — mirroring inkContained's own rule:
  // sitting inside a BLEEDING band proves burial, not membership (DiCasa:
  // the outer grey swoosh bleeds top and bottom, insideFrac 1.0).
  if (profile.insideFrac >= 0.9 && !(wrapLikeHost && wrapLikeHost(outer))) return true;
  return profile.runFrac >= params.overlapMergeShareFrac;
}

/**
 * As duas peças são o mesmo ORNAMENTO COMPOSTO?
 *
 * Vale para cores diferentes, que a regra do vinil separaria. Não é
 * sobreposição — a onda do TRANSGENIO sobrepõe ZERO cm² da faixa vermelha — nem
 * toque num ponto: é ACOMPANHAR, com porte parecido e folga aproximadamente
 * constante ao longo do percurso.
 *
 * Calibrado nos 5.323 pares de cores diferentes do acervo: dispara em 24 pares
 * de 13 arquivos (0,45%), e a distribuição de fundo tem `runFrac` p50 = 0 e
 * p90 = 0,066 — não há zona cinzenta perto do limiar.
 */
function isCompanionPiece(
  a: { outline: Pt[][]; bbox: Rect },
  b: { outline: Pt[][]; bbox: Rect },
  params: GroupingParams,
  ptPerCm: number,
): boolean {
  if (!a.outline.length || !b.outline.length) return false;
  const da = diagonal(a.bbox);
  const db = diagonal(b.bbox);
  if (da <= 0 || db <= 0) return false;
  if (Math.min(da, db) / Math.max(da, db) < params.companionSizeRatio) return false;
  const [inner, outer] = da <= db ? [a, b] : [b, a];
  const profile = companionProfile(inner.outline, outer.outline, params.companionGapCm * ptPerCm);
  if (profile.insideFrac > params.companionInsideFrac) return false;
  return profile.runFrac >= params.companionRunFrac;
}

/**
 * Um caminho com subformas distantes vira vários objetos.
 *
 * O CorelDRAW exporta uma marca d'água de dois blocos como UM caminho de 24
 * subformas: a caixa dele cobre os dois e o vão no meio, e o operador vê um
 * item só onde há dois adesivos. Separar por proximidade das subformas devolve
 * cada bloco ao seu lugar. Cor e traço são herdados do original.
 */
export function splitDisjoint(objects: VectorObject[], gapPt: number): VectorObject[] {
  const out: VectorObject[] = [];
  for (const obj of objects) {
    if (obj.outline.length < 2) {
      out.push(obj);
      continue;
    }
    const boxes = obj.outline.map((poly) => {
      const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const p of poly) {
        if (p.x < r.x0) r.x0 = p.x;
        if (p.y < r.y0) r.y0 = p.y;
        if (p.x > r.x1) r.x1 = p.x;
        if (p.y > r.y1) r.y1 = p.y;
      }
      return r;
    });
    const groups = cluster(boxes, gapPt);
    if (groups.length < 2) {
      out.push(obj);
      continue;
    }
    for (const idx of groups) {
      const bbox = idx.map((i) => boxes[i]).reduce((a, b) => union(a, b));
      out.push({ ...obj, index: out.length, bbox, outline: idx.map((i) => obj.outline[i]) });
    }
  }
  return out;
}

/** Uma peça do desenho, etiquetada com o que ela tem de posição. */
export interface ClassifiedPiece {
  obj: VectorObject;
  bleedAxes: BleedAxes;
  /** fração da face que a caixa da peça cobre */
  coversFrac: number;
}

export interface Classified {
  /** caminhos que são arte posicionável — mantido por compatibilidade */
  elements: VectorObject[];
  /** caminhos que sangram pelos dois eixos — mantido por compatibilidade */
  bleeds: VectorObject[];
  /** o pool inteiro, etiquetado: é daqui que o agrupamento trabalha */
  pieces: ClassifiedPiece[];
}

/**
 * Etiqueta cada caminho da face com os eixos por que ele sangra.
 *
 * Antes esta função GARFAVA: quem encostasse em duas arestas ia para um balde,
 * o resto para outro, e os dois baldes eram consumidos por funções que nunca se
 * falavam. Nenhum caminho do motor conseguia juntar uma peça de um com uma peça
 * do outro — foi por isso que a faixa vermelha do TRANSGENIO (3 arestas) e a
 * onda preta que corre colada nela (1 aresta) nunca puderam ser o mesmo item, e
 * a cota saiu medindo a barriga da onda sozinha.
 *
 * Agora ela só etiqueta. Quem é envelopamento e quem é adesivo se decide depois
 * do agrupamento, por GRUPO — que é onde a pergunta faz sentido. De quebra some
 * a incoerência antiga de exigir 2 arestas para promover e aceitar 1 para
 * rebaixar, que mandava 15% do balde de envelopamentos para lá pelo caminho
 * errado.
 */
export function classify(
  geometry: PageGeometry,
  scale: Scale,
  params: GroupingParams,
): Classified {
  const panelAreaPt = rectArea(scale.panelPt);
  const tolPt = params.bleedTouchCm * scale.ptPerCm;
  const noiseAreaPt = params.minObjectCm2 * scale.ptPerCm * scale.ptPerCm;
  const splitGapPt = params.lockupGapCm * scale.ptPerCm;
  const pieces: ClassifiedPiece[] = [];
  const candidates: VectorObject[] = [];
  const plain: VectorObject[] = [];

  /**
   * Template strokes are drawing FURNITURE, not sticker art. The truck
   * template draws the face frame and its doors with the same hairline pen
   * (a 5-point rectangle, stroke only); a door rectangle that survives into
   * the pool becomes phantom touch evidence — it spans the full face height,
   * so it "touches" every piece it crosses and welds them into the wrap.
   * The face frame itself is already skipped below (covers > 0.97, 4 edges);
   * this catches its siblings: the door rects drawn with the same pen, and
   * the frame of a NEIGHBOURING face leaking into this panel's bounds.
   */
  const nearRectPoly = (obj: VectorObject): boolean => {
    if (obj.outline.length !== 1) return false;
    const poly = obj.outline[0];
    if (poly.length < 4 || poly.length > 6) return false;
    const b = obj.bbox;
    const tol = Math.max(0.02 * Math.hypot(b.x1 - b.x0, b.y1 - b.y0), 1);
    const corners = [
      { x: b.x0, y: b.y0 },
      { x: b.x1, y: b.y0 },
      { x: b.x1, y: b.y1 },
      { x: b.x0, y: b.y1 },
    ];
    return poly.every((p) => corners.some((c) => Math.hypot(p.x - c.x, p.y - c.y) <= tol));
  };
  const framePens: { stroke: RGB; lineWidth: number }[] = [];
  for (const obj of geometry.objects) {
    if (obj.op === "clip" || obj.op === "image" || obj.fromShading) continue;
    if (obj.fill !== null || !obj.stroke) continue;
    if (rectArea(obj.bbox) / panelAreaPt <= 0.97) continue;
    if (bleedAxesOf(obj.bbox, scale.panelPt, tolPt).edges.length !== 4) continue;
    if (!nearRectPoly(obj)) continue;
    framePens.push({ stroke: obj.stroke, lineWidth: obj.lineWidth });
  }
  const panelHPt = scale.panelPt.y1 - scale.panelPt.y0;
  const isTemplateStroke = (obj: VectorObject): boolean => {
    if (obj.op === "image" || obj.fromShading) return false;
    if (obj.fill !== null || !obj.stroke) return false;
    if (!nearRectPoly(obj)) return false;
    const h = obj.bbox.y1 - obj.bbox.y0;
    const penMatch = framePens.some(
      (pen) =>
        colorDistance(pen.stroke, obj.stroke) <= 8 &&
        Math.abs(pen.lineWidth - obj.lineWidth) <= 0.25,
    );
    // A door shares the frame's pen and spans at least half the face height.
    if (penMatch && h >= 0.5 * panelHPt) return true;
    // Frame pen unreadable (the panel border came from a fill rect): a
    // stroke-only hairline rectangle spanning the face height is still the
    // template — at truck scale a 1 pt line is under a millimetre of print.
    return obj.lineWidth <= 1 && h >= 0.8 * panelHPt;
  };

  for (const obj of geometry.objects) {
    if (obj.op === "clip") continue;
    if (isDimensionInk(obj, params)) continue;
    const b = obj.bbox;
    // Caminho corrompido não é arte. No `bergamini 840-268` há um objeto de
    // 150.358 × 41.574 cm com dez pontos de contorno: ele toma a primeira vaga
    // do orçamento de itens, não gera cota nenhuma e desenha fora da tela.
    // São 11 objetos em 171.042, todos deste tipo.
    if (b.x1 - b.x0 > geometry.width * 1.5 || b.y1 - b.y0 > geometry.height * 1.5) continue;
    const inside =
      b.x1 > scale.panelPt.x0 + 1 &&
      b.x0 < scale.panelPt.x1 - 1 &&
      b.y1 > scale.panelPt.y0 + 1 &&
      b.y0 < scale.panelPt.y1 - 1;
    if (!inside) continue;
    if (isTemplateStroke(obj)) continue;
    const covers = rectArea(b) / panelAreaPt;
    const axes = bleedAxesOf(b, scale.panelPt, tolPt);
    // o próprio contorno da face
    if (covers > 0.97 && axes.edges.length === 4) continue;
    if (covers >= params.bleedAreaFrac || axes.edges.length >= 2) {
      candidates.push(obj);
      continue;
    }
    plain.push(obj);
  }

  // Um caminho de marca d'água costuma trazer blocos distantes; separados, nem
  // todos sangram. O bloco que fica INTEIRO dentro da face tem posição, logo
  // tem cota — devolvê-lo ao pool é o que evita o item mudo.
  //
  // A separação vale para os DOIS grupos, e não só para os candidatos. Um
  // caminho que encosta em uma aresta só nunca era separado, e no TRANSGENIO
  // isso produzia um "adesivo" de 5,5 m: a onda da porta e o rastro do meio da
  // carreta saem do CorelDRAW como um caminho só, e a caixa deles cobria meia
  // face — exatamente o erro que a doutrina diz ser o pior de todos, o item
  // grande demais que engole o vizinho e deixa a cota sem dono.
  const split = params.splitPlainPaths ? splitDisjoint(plain, splitGapPt) : plain;
  for (const piece of [...splitDisjoint(candidates, splitGapPt), ...split]) {
    const covers = rectArea(piece.bbox) / panelAreaPt;
    const axes = bleedAxesOf(piece.bbox, scale.panelPt, tolPt);
    if (covers < params.bleedAreaFrac && !axes.edges.length && rectArea(piece.bbox) < noiseAreaPt) {
      continue;
    }
    pieces.push({ obj: piece, bleedAxes: axes, coversFrac: covers });
  }

  const wrapLike = (p: ClassifiedPiece) =>
    (p.bleedAxes.horizontal && p.bleedAxes.vertical) || p.coversFrac >= params.bleedAreaFrac;
  return {
    elements: pieces.filter((p) => !wrapLike(p)).map((p) => p.obj),
    bleeds: pieces.filter(wrapLike).map((p) => p.obj),
    pieces,
  };
}

/**
 * A LINHA DE ALINHAMENTO de um lado — ou nada, que é o resultado mais comum.
 *
 * A pergunta que o dono faz é: qual altura reúne o apoio da palavra? Em
 * "Supermercado" a base é a linha dos "o", e o "p" desce sozinho abaixo dela.
 * Cotar até a ponta do "p" dá um número certo e inútil, porque naquela altura
 * não existe nada para alinhar.
 *
 * Quatro tentativas anteriores morreram procurando "existe uma RETA aqui?" —
 * pergunta que não tem resposta estável, porque o ápice de uma roda de 2,3 m é
 * plano dentro de qualquer tolerância que a cursiva também precise. A pergunta
 * que funciona é outra e é física: **quanta TINTA sobra além deste nível?**
 * Descendente é fino por definição. A perna do "p" desce um quarto da altura e
 * leva 3% da tinta; o rabo do "G" do GRESPAN, 4%. Já cortar a barriga de uma
 * maçã ou o topo de uma roda deixa de fora um quinto da tinta, e o freio
 * segura. Medido nível a nível: 75 níveis verdadeiros contra 1.715 proibidos.
 *
 * Três testes independentes, todos obrigatórios, mais dois portões antes:
 *  - PORTÃO: peça de texto tem porte e muitas subformas (senão é desenho);
 *  - TINTA: sobra no máximo 8% da área além do nível;
 *  - SUBFORMAS: pelo menos 8 peças distintas param ali (ou 2 que cubram 55%
 *    da largura, que é o escape da cursiva e do logotipo de duas peças);
 *  - PERFIL: pelo menos 45% das colunas terminam na faixa.
 *
 * Falhou uma, devolve `null` e a cota volta ao extremo real da tinta — que é,
 * afinal, o que o adesivo recortado tem. Recusar é o caso comum: o motor recusa
 * 88,5% dos lados do acervo.
 */
interface EdgeScan {
  /** onde a tinta termina em cada coluna */
  profile: number[];
  /** a coordenada de cada coluna, no eixo perpendicular */
  along: number[];
  /** pares [entra, sai] de tinta por coluna */
  ink: number[][];
  inkTotal: number;
  extreme: number;
  /** extensão da peça no eixo MEDIDO */
  size: number;
  sweepFrom: number;
  sweepTo: number;
}

function scanEdge(
  segments: [number, number, number, number][],
  bounds: { x0: number; y0: number; x1: number; y1: number },
  side: "top" | "bottom" | "left" | "right",
  samples: number,
): EdgeScan | null {
  const vertical = side === "top" || side === "bottom";
  const wantMin = side === "top" || side === "left";
  const sweepFrom = vertical ? bounds.x0 : bounds.y0;
  const sweepTo = vertical ? bounds.x1 : bounds.y1;
  const size = vertical ? bounds.y1 - bounds.y0 : bounds.x1 - bounds.x0;
  if (sweepTo <= sweepFrom || size <= 0) return null;
  const count = Math.max(24, Math.min(samples, Math.round(sweepTo - sweepFrom)));
  const step = (sweepTo - sweepFrom) / count;

  const profile: number[] = [];
  const along: number[] = [];
  const ink: number[][] = [];
  let inkTotal = 0;
  for (let i = 0; i < count; i += 1) {
    const cut = sweepFrom + (i + 0.5) * step;
    const hits: number[] = [];
    for (const [ax, ay, bx, by] of segments) {
      const p = vertical ? ax : ay;
      const q = vertical ? bx : by;
      if ((p - cut) * (q - cut) > 0 || p === q) continue;
      const t = (cut - p) / (q - p);
      hits.push(vertical ? ay + t * (by - ay) : ax + t * (bx - ax));
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a - b);
    const pairs: number[] = [];
    for (let k = 0; k + 1 < hits.length; k += 2) {
      pairs.push(hits[k], hits[k + 1]);
      inkTotal += hits[k + 1] - hits[k];
    }
    profile.push(wantMin ? hits[0] : hits[hits.length - 1]);
    along.push(cut);
    ink.push(pairs);
  }
  if (profile.length < 6 || inkTotal <= 0) return null;
  return {
    profile,
    along,
    ink,
    inkTotal,
    extreme: wantMin ? Math.min(...profile) : Math.max(...profile),
    size,
    sweepFrom,
    sweepTo,
  };
}

/** Quanta tinta sobra ALÉM do nível, do lado do extremo. */
function inkBeyond(scan: EdgeScan, level: number, wantMin: boolean): number {
  let total = 0;
  for (const pairs of scan.ink) {
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      const lo = pairs[k];
      const hi = pairs[k + 1];
      total += wantMin ? Math.max(0, Math.min(hi, level) - lo) : Math.max(0, hi - Math.max(lo, level));
    }
  }
  return total;
}

function alignedEdgeOf(
  polys: Pt[][],
  shapes: Rect[],
  side: "top" | "bottom" | "left" | "right",
  params: GroupingParams,
  ptPerCm: number,
): AlignedEdge | null {
  const segments: [number, number, number, number][] = [];
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const poly of polys) {
    for (let i = 0; i + 1 < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[i + 1];
      segments.push([a.x, a.y, b.x, b.y]);
      bounds.x0 = Math.min(bounds.x0, a.x, b.x);
      bounds.y0 = Math.min(bounds.y0, a.y, b.y);
      bounds.x1 = Math.max(bounds.x1, a.x, b.x);
      bounds.y1 = Math.max(bounds.y1, a.y, b.y);
    }
  }
  if (!segments.length) return null;

  const scan = scanEdge(segments, bounds, side, params.profileSamples);
  if (!scan) return null;
  const wantMin = side === "top" || side === "left";
  const extremeEdge = (): AlignedEdge => {
    const band = Math.max(0.4, scan.size * params.alignmentBandFrac);
    const on = scan.along.filter((_, i) => Math.abs(scan.profile[i] - scan.extreme) <= band);
    return {
      at: scan.extreme,
      from: on.length ? Math.min(...on) : scan.sweepFrom,
      to: on.length ? Math.max(...on) : scan.sweepTo,
      support: on.length / scan.profile.length,
      extreme: scan.extreme,
      origin: "extreme",
    };
  };

  // PORTÃO: isto é texto, ou é desenho? Uma maçã e uma seta não têm linha a
  // inferir, e checá-lo antes da varredura poupa o trabalho e o risco.
  if (!params.alignEdges) return extremeEdge();
  if (scan.size < params.alignmentMinSizeCm * ptPerCm) return extremeEdge();
  if (shapes.length < params.alignmentMinSubShapes) return extremeEdge();

  const band = Math.max(0.4, scan.size * params.alignmentBandFrac);
  const minRetract = Math.max(
    params.alignmentMinRetractCm * ptPerCm,
    scan.size * params.alignmentMinRetractFrac,
    band * 0.5,
  );
  const maxRetract = scan.size * params.alignmentMaxRetractFrac;
  const shapeKey = (r: Rect) =>
    side === "top" ? r.y0 : side === "bottom" ? r.y1 : side === "left" ? r.x0 : r.x1;
  const sweepSpan = scan.sweepTo - scan.sweepFrom;

  // Caminha do extremo para DENTRO, nível a nível, e para no primeiro que
  // sirva. O primeiro é o certo: a linha é a mais externa que reúne apoio.
  const levels = [...new Set(scan.profile)].sort((a, b) => (wantMin ? a - b : b - a));
  for (const level of levels) {
    const retract = Math.abs(level - scan.extreme);
    if (retract < minRetract) continue;
    if (retract > maxRetract) break;
    // O freio de tinta também encerra a varredura: passou daqui, todo nível
    // mais para dentro deixa ainda mais tinta de fora.
    if (inkBeyond(scan, level, wantMin) / scan.inkTotal > params.alignmentMaxInkBeyond) break;

    const onLevel = scan.along.filter((_, i) => Math.abs(scan.profile[i] - level) <= band);
    if (onLevel.length / scan.profile.length < params.alignmentMinProfileFrac) continue;

    const sharing = shapes.filter((r) => Math.abs(shapeKey(r) - level) <= band).length;
    const cover = onLevel.length ? (Math.max(...onLevel) - Math.min(...onLevel)) / sweepSpan : 0;
    const enough =
      sharing >= params.alignmentMinShapes ||
      (sharing >= params.alignmentWideShapes && cover >= params.alignmentWideCoverFrac);
    if (!enough) continue;

    return {
      at: level,
      from: Math.min(...onLevel),
      to: Math.max(...onLevel),
      support: onLevel.length / scan.profile.length,
      extreme: scan.extreme,
      origin: "aligned",
    };
  }
  return extremeEdge();
}

/**
 * Recurso para quem não tem contorno (imagem): o extremo da caixa.
 */
function boxEdge(r: Rect, side: "top" | "bottom" | "left" | "right"): AlignedEdge {
  const map = {
    top: { at: r.y0, from: r.x0, to: r.x1 },
    bottom: { at: r.y1, from: r.x0, to: r.x1 },
    left: { at: r.x0, from: r.y0, to: r.y1 },
    right: { at: r.x1, from: r.y0, to: r.y1 },
  }[side];
  return { ...map, support: 1, extreme: map.at };
}

/** Subformas de um conjunto de objetos: cada contorno fechado é uma. */
function subShapes(objects: VectorObject[], boxes?: Rect[]): Rect[] {
  const out: Rect[] = [];
  objects.forEach((obj, i) => {
    if (obj.op === "image" || obj.outline.length === 0) {
      out.push(boxes?.[i] ?? obj.bbox);
      return;
    }
    for (const poly of obj.outline) {
      const r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const p of poly) {
        if (p.x < r.x0) r.x0 = p.x;
        if (p.y < r.y0) r.y0 = p.y;
        if (p.x > r.x1) r.x1 = p.x;
        if (p.y > r.y1) r.y1 = p.y;
      }
      if (r.x1 > r.x0 || r.y1 > r.y0) out.push(r);
    }
  });
  return out;
}

function edgesOf(
  objects: VectorObject[],
  params: GroupingParams,
  ptPerCm: number,
  boxes?: Rect[],
): PartEdges {
  const polys = objects.flatMap((o) => (o.op === "image" ? [] : o.outline));
  const box = (boxes ?? objects.map((o) => o.bbox)).reduce(
    (a, b) => ({
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  if (!params.alignEdges) {
    return {
      top: boxEdge(box, "top"),
      bottom: boxEdge(box, "bottom"),
      left: boxEdge(box, "left"),
      right: boxEdge(box, "right"),
    };
  }
  // A reta de alinhamento só existe na horizontal. Nos lados a palavra termina
  // numa letra só — aparar ali tira o "N" de GRESPAN e a cota deixa de bater
  // com o extremo que o projetista usa (175, medido no arquivo dele).
  const shapes = subShapes(objects, boxes);
  const vertical = (s: "top" | "bottom") =>
    alignedEdgeOf(polys, shapes, s, params, ptPerCm) ?? boxEdge(box, s);
  return {
    top: vertical("top"),
    bottom: vertical("bottom"),
    left: boxEdge(box, "left"),
    right: boxEdge(box, "right"),
  };
}

function edgesToCm(e: PartEdges, scale: Scale): PartEdges {
  const x = (v: number) => (v - scale.panelPt.x0) / scale.ptPerCm;
  const y = (v: number) => (v - scale.panelPt.y0) / scale.ptPerCm;
  return {
    top: { at: y(e.top.at), from: x(e.top.from), to: x(e.top.to), support: e.top.support, extreme: y(e.top.extreme), origin: e.top.origin },
    bottom: { at: y(e.bottom.at), from: x(e.bottom.from), to: x(e.bottom.to), support: e.bottom.support, extreme: y(e.bottom.extreme), origin: e.bottom.origin },
    left: { at: x(e.left.at), from: y(e.left.from), to: y(e.left.to), support: e.left.support, extreme: x(e.left.extreme), origin: e.left.origin },
    right: { at: x(e.right.at), from: y(e.right.from), to: y(e.right.to), support: e.right.support, extreme: x(e.right.extreme), origin: e.right.origin },
  };
}

/**
 * A caixa das LINHAS DE ALINHAMENTO do conjunto.
 *
 * Cada lado vem da peça que manda naquele lado — a mesma escolha que a cota
 * faz. O resultado é uma caixa que assenta onde a cota assenta, com as caudas e
 * os acentos por fora dela. É isso que diz ao operador, sem legenda, a que
 * altura o número se refere.
 */
function alignedBoxOf(edges: PartEdges[], fallback: Rect): Rect {
  if (!edges.length) return fallback;
  return {
    x0: Math.min(...edges.map((e) => e.left.at)),
    y0: Math.min(...edges.map((e) => e.top.at)),
    x1: Math.max(...edges.map((e) => e.right.at)),
    y1: Math.max(...edges.map((e) => e.bottom.at)),
  };
}

function cmToRect(scale: Scale, r: Rect): Rect {
  return {
    x0: scale.panelPt.x0 + r.x0 * scale.ptPerCm,
    y0: scale.panelPt.y0 + r.y0 * scale.ptPerCm,
    x1: scale.panelPt.x0 + r.x1 * scale.ptPerCm,
    y1: scale.panelPt.y0 + r.y1 * scale.ptPerCm,
  };
}

/**
 * Cor dominante da peça: a do maior objeto que tem cor. Imagem não tem.
 *
 * A gradient does not count either: its color is the AVERAGE of the stops — a
 * guess. Letting the guess become the cluster's identity color-welded pieces
 * 13 cm apart (SANTA CLARA: the gradient word swallowed the logo).
 */
function dominantColor(objects: VectorObject[]): RGB | null {
  let best: { area: number; color: RGB } | null = null;
  for (const o of objects) {
    if (o.fromShading) continue;
    const color = o.fill ?? o.stroke;
    if (!color) continue;
    const area = rectArea(o.bbox);
    if (!best || area > best.area) best = { area, color };
  }
  return best?.color ?? null;
}

function colorDistance(a: RGB | null, b: RGB | null): number {
  if (!a || !b) return Infinity;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface GroupingOptions {
  /**
   * Encolhe a moldura de uma IMAGEM até a tinta real. Sem isso a cota ancora
   * na folga transparente que o arquivo de imagem carrega.
   */
  trimToInk?: (rect: Rect) => Rect | null;
}

/**
 * O resultado do agrupamento: UMA lista de itens, do maior para o menor.
 *
 * Adesivo e envelopamento deixaram de ser duas espécies e viraram o mesmo tipo
 * com `bleedAxes` diferentes. `stickers` e `wraps` seguem como recortes dessa
 * lista, para quem só quer uma delas.
 */
export interface BuiltItems {
  /** todos os itens da face, ordenados por área */
  items: Sticker[];
  /** os objetos de origem de cada item, na mesma ordem */
  objects: VectorObject[][];
  stickers: Sticker[];
  wraps: Sticker[];
  /**
   * A face estourou o orçamento de trabalho e o agrupamento parou no meio.
   *
   * O que sai daqui não é para mostrar: metade das soldas aconteceu e a outra
   * metade não, então os "itens" são um retrato de meio caminho. Serve para
   * quem chamou dizer ao operador que naquela face não dá para escolher peça, e
   * mandá-lo para a régua — que é o que ele faria de qualquer jeito, e agora
   * sem esperar a aba descongelar.
   */
  truncated: boolean;
  /** pares de segmento gastos nos testes de contorno desta face */
  contourWork: number;
}

/**
 * Do pool etiquetado para os ITENS: adesivos e envelopamentos, de uma vez só.
 *
 * Antes eram dois caminhos paralelos que nunca se falavam, e é isso que impedia
 * a faixa vermelha e a onda preta do TRANSGENIO de serem a mesma peça. Aqui o
 * pool é um só, o agrupamento roda uma vez, e a pergunta "isto é envelopamento?"
 * é feita ao GRUPO — que é onde ela tem resposta.
 */
export function buildItems(
  pool: ClassifiedPiece[],
  scale: Scale,
  params: GroupingParams,
  options: GroupingOptions = {},
): BuiltItems {
  /**
   * An image's outline is its transparent-pixel bounding RECTANGLE, not ink:
   * the frame "touches" art that sits a metre from any visible pixel, and at
   * contour precision that phantom contact welds neighbours into the image's
   * group. So a bleed-sized image contributes NO contour evidence at all — its
   * box still exists, so every bbox-based rule is untouched, but
   * touch/companion/multicolour tests stop seeing a frame that is mostly air.
   *
   * APARAR NA TINTA NÃO SALVA A MOLDURA, e essa era a brecha: o recorte
   * encolhe o retângulo até a primeira linha de tinta, mas o que sobra ainda é
   * um RETÂNGULO, e o de uma onda que atravessa a face continua sendo quase
   * todo vazio. No DiCasa a onda vermelha vem como bitmap: aparada, a moldura
   * ia de 0 a 263 cm e a aresta direita dela cruzava o logotipo, que começa em
   * 203. Contato de contorno ZERO, porte parecido (razão de áreas 0,42) — e a
   * regra da marca multicor soldava o envelopamento ao logotipo. A face saía
   * com DOIS itens, um deles de 407 × 199 cm, e clicar na marca não devolvia
   * marca nenhuma.
   *
   * Pior: só acontecia no NAVEGADOR. O recortador de tinta é do DOM, e a
   * bancada roda em Node sem ele — então o motor medido e o motor entregue
   * discordavam justamente neste ponto.
   *
   * O recorte continua valendo para a MEDIDA (é ele que tira a folga
   * transparente de onde a cota ancora); o que ele não pode é virar prova de
   * toque. Quem decide se a moldura é grande demais para servir de contorno é
   * a caixa APARADA, que é a extensão real da arte.
   */
  const rectOutline = (r: Rect): Pt[][] => [
    [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
      { x: r.x0, y: r.y0 },
    ],
  ];
  const trimmedRects = pool.map((p) =>
    p.obj.op === "image" && options.trimToInk ? options.trimToInk(p.obj.bbox) : null,
  );
  const elements = pool.map((p, i) => {
    const o = p.obj;
    if (o.op !== "image") return o;
    const trimmed = trimmedRects[i];
    const frame = trimmed ?? o.bbox;
    const axes = bleedAxesOf(frame, scale.panelPt, params.bleedTouchCm * scale.ptPerCm);
    const bleedSized =
      rectArea(frame) / rectArea(scale.panelPt) >= params.bleedAreaFrac ||
      axes.horizontal ||
      axes.vertical;
    if (bleedSized) return { ...o, outline: [] };
    return trimmed ? { ...o, outline: rectOutline(trimmed) } : o;
  });
  const boxes = pool.map((p, i) => trimmedRects[i] ?? p.obj.bbox);
  const objColors = elements.map((o) => o.fill ?? o.stroke ?? null);
  const touchTol = params.partGapCm * scale.ptPerCm;
  const lineReach = params.maxLineGapCm * scale.ptPerCm;
  const workAtStart = contourWork;
  /**
   * Acabou o orçamento desta face.
   *
   * Consultado nos dois predicados de solda: estourado, todo par passa a ser
   * incompatível e as rodadas do ponto fixo se esgotam sem mais trabalho. Não
   * é para salvar o resultado — ele já não presta — é para a aba voltar.
   */
  const overBudget = (): boolean =>
    params.contourWorkBudget > 0 && contourWork - workAtStart > params.contourWorkBudget;
  const panelAreaPt = rectArea(scale.panelPt);
  const edgeTolPt = params.bleedTouchCm * scale.ptPerCm;

  /**
   * FUNDO É O QUE SANGRA — e a ÁREA sozinha não prova sangria.
   *
   * A pergunta "isto é fundo?" era feita em quatro lugares com a mesma conta
   * (varre um eixo OU cobre 35% da face) e respondida no fim, em `isWrap`, com
   * outra: lá a cláusula de área EXIGE encostar numa aresta, pela razão que a
   * FRICARNE ensinou — um logotipo de 463 × 176 cm cobre 40% da face e não é
   * envelopamento nenhum, é só um logotipo grande.
   *
   * A divergência custava a face inteira. No MAR & RIO o estágio de peça solda
   * o letreiro branco ao logotipo e sai uma peça de 447 × 163 cm: 39% da face,
   * nenhuma aresta encostada. Pela conta antiga ela virava "fundo", a
   * invariante `fundo com fundo, arte com arte` já não separava nada, e o fundo
   * d'água a engolia por continência — 156 peças num item só, a face inteira
   * devolvida a cada clique. Com a mesma régua de `isWrap` a arte continua
   * arte, por maior que seja, e só o que encosta na borda pode ser fundo.
   */
  const wrapLikeRect = (r: Rect, axes: BleedAxes): boolean =>
    axes.horizontal ||
    axes.vertical ||
    (rectArea(r) / panelAreaPt >= params.bleedAreaFrac && axes.edges.length > 0);

  /**
   * Word gaps scale with glyph height while every reach above is capped in
   * absolute cm: measured on the corpus, true word gaps stay at or below
   * 0.31 x height while false bridges start at 0.50 x height (PITAIA 0.50,
   * BATATA 0.55). A 0.35 x height floor on the same-line reach lets giant
   * lettering (TRANS DALDEGAN, gap 45.5 cm at h 169-214; DA NATA, 35 cm at
   * h 114) keep its word gaps. The floor is capped at 50 cm so Norte Minas'
   * designer-separated 60.8 cm word gap (h 190-252) does NOT weld.
   */
  const wordGapFloorPt = (h: number): number => Math.min(0.35 * h, 50 * scale.ptPerCm);
  const sameLineReachPt = (h: number): number =>
    Math.max(Math.min(lineReach, params.lineGapFactor * h), wordGapFloorPt(h));

  /**
   * Duas caixas assentam na MESMA LINHA DE BASE?
   *
   * É o que uma pessoa vê antes de qualquer medida: "Alimentando" e "Saúde" são
   * uma frase só porque pousam na mesma reta. Nenhuma outra prova serve — a cor
   * é a mesma da faixa que passa atrás, a altura é a mesma de meia dúzia de
   * blocos, e o VÃO não separa nada (medido no acervo: o vão interno de uma
   * linha e a separação intencional entre peças se sobrepõem, mediana 8 contra
   * 23 cm). A base compartilhada, não.
   *
   * A tolerância é fração da altura porque a base do "S" com serifa arredondada
   * ultrapassa a do "a" um fio — o mesmo transbordo óptico que a linha de
   * alinhamento já conhece.
   */
  const sharesBaseline = (ra: Rect, rb: Rect): boolean =>
    Math.abs(ra.y1 - rb.y1) <= params.textBaselineTolFrac * Math.min(rectH(ra), rectH(rb));

  /**
   * O alcance da solda AO LONGO da linha, para um PAR — e não para a caixa mais
   * alta do par, que era o erro.
   *
   * O piso proporcional (0,35 × altura) existe para o letreiro gigante, onde a
   * entreletra vale meio metro. Tomando-o da caixa MAIOR ele vazava para fora
   * do letreiro: no MAR & RIO o logotipo tem 134 cm de altura e emprestava 47 cm
   * de alcance ao bloco de texto que está a 40 cm dele — o letreiro branco
   * soldava no logotipo, a peça resultante cobria 39% da face e a partir daí a
   * face inteira virava um item só. O piso é da MENOR: quem espaça as letras é
   * o texto, e é a altura DELE que diz quanto.
   *
   * Quando as duas assentam na mesma base, o alcance sobe para uma altura e
   * meia. É o que reúne "Alimentando  Saúde" (vão de 23 cm para 21 de altura,
   * espaço duplo de propósito) sem tocar em nada que não divida a base.
   */
  const sameLineReachPairPt = (ra: Rect, rb: Rect): number => {
    const hi = Math.max(rectH(ra), rectH(rb));
    const lo = Math.min(rectH(ra), rectH(rb));
    const base = Math.max(Math.min(lineReach, params.lineGapFactor * hi), wordGapFloorPt(lo));
    if (!sharesBaseline(ra, rb)) return base;
    return Math.max(base, Math.min(lineReach, params.textLineGapFactor * hi));
  };

  /**
   * A solda é ANISOTRÓPICA, e é essa a correção que faltava.
   *
   * A folga era a mesma para o lado e para cima. Pior: o teto da folga
   * adaptativa (12 cm) era MENOR que a folga do conjunto (14 cm) que roda
   * depois, então a folga que acompanha a altura nunca decidia nada e o alcance
   * efetivo do motor era 14 cm FIXOS — exatamente o que a doutrina §10 proíbe,
   * e o motivo de `Fruta é Vitamina Pura` sair como `Fru|ta|é|Vita|m|in|a|P|ura`.
   *
   * Agora são dois alcances. AO LONGO da linha ele é largo (uma altura de
   * texto, teto de 30 cm), porque entreletra espaçada é comum e não separa
   * nada. ENTRE linhas ele é curto (um quarto da altura, teto de 8 cm), porque
   * duas linhas só viram um adesivo quando o conjunto manda — e quem decide
   * isso é a regra de largura, no estágio seguinte.
   */
  /**
   * A piece that itself sweeps a face axis (or covers wrap-sized area while
   * touching an edge) is BACKGROUND, not positionable art.
   */
  const backdropPiece = (i: number): boolean =>
    wrapLikeRect(pool[i].obj.bbox, pool[i].bleedAxes);

  const weldable = (a: number, b: number): boolean => {
    if (overBudget()) return false;
    const ra = boxes[a];
    const rb = boxes[b];
    const gap = gapsBetween(ra, rb);

    // An evidence-less image (bleed-sized, frame withheld from contour tests)
    // still merges with OVERLAPPING background art: backdrop-to-backdrop is
    // the one weld the raw frame used to do correctly — the swoosh bitmap and
    // the vector band it sits on are printed as one wrap. Positionable art
    // (text, logos, phones) is never backdrop, so it stays free.
    const evidencelessImage = (i: number): boolean =>
      elements[i].op === "image" && elements[i].outline.length === 0;
    if (
      gap.x === 0 &&
      gap.y === 0 &&
      (evidencelessImage(a) || evidencelessImage(b)) &&
      backdropPiece(a) &&
      backdropPiece(b)
    ) {
      return true;
    }
    // A gradient's color is a guess (average of its stops). Between two
    // gradients the guess is consistent — the letters of a gradient word share
    // the same stops and weld like normal text. The dangerous pair is the
    // MIXED one, guess against real color: that welds only when the contours
    // actually TOUCH, never across a gap (SANTA CLARA: the gradient word
    // swallowed the green logo 13 cm away).
    const guessedColor = !!elements[a].fromShading !== !!elements[b].fromShading;
    const sameColour =
      colorDistance(objColors[a], objColors[b]) <= params.colorMergeDelta &&
      (!guessedColor ||
        contourDistance(elements[a].outline, elements[b].outline, touchTol) <= touchTol);

    // marca multicor: formas de cores diferentes que se encostam e têm porte
    // comparável são a mesma peça, impressa de uma vez. The bypass sits behind
    // a loose proximity sanity gate (bbox gap is a lower bound on contour
    // distance) sized to the ADAPTIVE multicolour reach — the same formula
    // isSamePieceMulticolour itself uses — so far-apart pairs never pay the
    // contour test, yet the earned (8, 12] band is not cut off at the flat 8 cm.
    if (!sameColour) {
      const loosePt =
        Math.min(
          params.maxPartGapCm,
          Math.max(
            params.overlapMergeGapCm,
            (params.textGapFactor * Math.min(rectH(ra), rectH(rb))) / scale.ptPerCm,
          ),
        ) * scale.ptPerCm;
      // Wrap-likeness for the containment bypass, from the raw box: a piece
      // that bleeds an axis, or covers the panel WHILE touching an edge, is a
      // background host (see `wrapLikeRect`).
      const wrapLikeBox = (p: { bbox: Rect }): boolean =>
        wrapLikeRect(p.bbox, bleedAxesOf(p.bbox, scale.panelPt, edgeTolPt));
      if (
        gap.x <= loosePt &&
        gap.y <= loosePt &&
        isSamePieceMulticolour(elements[a], elements[b], params, scale.ptPerCm, wrapLikeBox)
      ) {
        return true;
      }
      // EXP-C(3) — same-line SMALL-gap weld: glyph runs of different colours on
      // one text line ("www." beside its own domain at 1.2-2.2 cm, the
      // FRUTAMINA site line) are one printed piece even when the multicolour
      // rule's area-ratio gate strands them. Ink must confirm the bbox gap.
      // Designer separations on the corpus start at p10 = 8 cm, so 3.5 cm keeps
      // a >2x margin (the PITAIA/BATATA false bridges sit at 5-9 cm). Guards:
      // the gap must be REAL (gap.x > 0 — overlapping-bbox pairs have their own
      // rules, and art overlapping a backdrop always has contour distance 0)
      // and neither side may be wrap-like (DA NATA / RKO: the lockup was
      // swallowed by the wrap through this clause unguarded).
      const smallGapPt = 3.5 * scale.ptPerCm;
      const wrapishPart = (i: number): boolean => wrapLikeRect(boxes[i], pool[i].bleedAxes);
      if (
        gap.x > 0 &&
        gap.x <= smallGapPt &&
        onSameLine(ra, rb, params) &&
        !wrapishPart(a) &&
        !wrapishPart(b) &&
        contourDistance(elements[a].outline, elements[b].outline, smallGapPt) <= smallGapPt
      ) {
        return true;
      }
    }

    if (onSameLine(ra, rb, params)) {
      if (gap.x > sameLineReachPairPt(ra, rb)) return false;
    } else {
      // empilhadas ou soltas: alcance curto, e nada de soldar aqui o que é
      // conjunto — isso é trabalho do estágio de baixo
      const height = Math.max(rectH(ra), rectH(rb));
      const reach = Math.min(params.maxLineStackCm * scale.ptPerCm, params.lineStackFactor * height);
      if (gap.x > reach || gap.y > reach) return false;
      if (!alignedEnough(ra, rb, params.weldAlignFrac)) return false;
    }

    /**
     * O FUNDO NÃO ENGOLE A ARTE IMPRESSA SOBRE ELE — agora também no estágio
     * de peça, e não só no dos conjuntos.
     *
     * Lá embaixo isto é uma invariante, dita de uma vez; aqui, onde a faixa
     * ainda está sendo montada, a recusa é por RAMO. No Ki Distribuidora a
     * chapa verde sangra três arestas e a assinatura verde ("O melhor do
     * mercado") é desenhada em cima dela: as caixas se sobrepõem, a cor é a
     * mesma a menos de 1,7 e o ramo de
     * mesma cor soldava as duas sem mais pergunta. A assinatura entrava na
     * chapa, esticava a caixa do fundo de 553 para 631 cm, e o vão até o
     * logotipo caía de 103 para 21 cm — dentro do alcance de palavra. O ponto
     * fixo então fundia fundo e logotipo, e a face inteira virava UM item: o
     * aplicador clicava na marca e recebia 1538 × 246 cm.
     *
     * Cor igual entre fundo e arte é coincidência de paleta, não prova de que
     * saiu do mesmo recorte — a chapa e a assinatura são dois vinis. E o toque
     * também não prova nada aqui: a borda de um fundo varre a face e cruza
     * tudo que passa por cima dela (a chapa esquerda termina em 553 cm, no
     * meio da assinatura, dando distância de contorno ZERO). Por isso os dois
     * ramos que decidem por cor ou por toque ficam fechados quando um lado é
     * fundo e o outro não; multicor, acompanhamento e continência de tinta
     * continuam votando, porque carregam prova de porte e de percurso.
     */
    const oneSideIsBackdrop = backdropPiece(a) !== backdropPiece(b);
    if (sameColour && !oneSideIsBackdrop) return true;
    // logotipo multicor com uma peça DENTRO da outra, encostando (o caso "Ki")
    if (
      nestedFraction(ra, rb) >= params.nestedMergeFrac &&
      contourDistance(elements[a].outline, elements[b].outline, touchTol) <= touchTol
    ) {
      // ... a menos que a de fora seja o fundo: estar DENTRO de uma faixa que
      // sangra é prova de soterramento, não de pertencer à peça.
      const outerIsBackdrop = backdropPiece(rectArea(ra) >= rectArea(rb) ? a : b);
      if (!(oneSideIsBackdrop && outerIsBackdrop)) return true;
    }
    return isCompanionPiece(elements[a], elements[b], params, scale.ptPerCm);
  };

  const partClusters = cluster(
    boxes,
    (i) => Math.max(lineReach, wordGapFloorPt(rectH(boxes[i]))),
    weldable,
  );
  const parts: Rect[] = partClusters.map((idx) =>
    idx.map((i) => boxes[i]).reduce((a, b) => union(a, b)),
  );
  const partEdges = partClusters.map((idx) =>
    edgesOf(idx.map((i) => elements[i]), params, scale.ptPerCm, idx.map((i) => boxes[i])),
  );
  const partColors = partClusters.map((idx) => dominantColor(idx.map((i) => elements[i])));
  const partOutlines = partClusters.map((idx) => idx.flatMap((i) => elements[i].outline));
  const partAxes = partClusters.map((idx) => unionAxes(idx.map((i) => pool[i].bleedAxes)));
  /** Part made ONLY of evidence-less background images (see `elements` above). */
  const partImageBackdrop = partClusters.map((idx) =>
    idx.every((i) => elements[i].op === "image" && elements[i].outline.length === 0),
  );
  /**
   * Segundo estágio: as LINHAS viram conjunto — e aqui vale a regra da largura.
   *
   * "Raramente colamos 1 adesivo onde o componente abaixo não cubra a mesma
   * largura." Medido nos casos reais: GRUPO sobre ALVORADA cobre 100% e é um
   * adesivo só; `clebin` sobre `distribuidora` cobre 60%, `amigão` sobre
   * `SUPERMERCADOS` 64% e `Carajás` sobre `FRIGORÍFICO` 53% — os três são peças
   * separadas, coladas uma de cada vez. O Carajás só saía certo por acaso,
   * porque as cores diferem; com a regra, sai certo por mérito.
   *
   * A escapatória é o contato: peças que se ENCOSTAM são um logotipo só,
   * tenham a largura que tiverem.
   */
  const minAreaPt = params.minAreaCm2 * scale.ptPerCm * scale.ptPerCm;
  const lockupGapPt = params.lockupGapCm * scale.ptPerCm;

  /** One candidate group at lockup granularity, frozen for a predicate call. */
  interface LockupAgg {
    bbox: Rect;
    outline: Pt[][];
    color: RGB | null;
    axes: BleedAxes;
    /** Aggregate made only of evidence-less background images. */
    imageBackdrop: boolean;
  }

  /** Background/wrap-like hosts never swallow the art drawn over them. */
  const wrapLikeAgg = (g: LockupAgg): boolean => wrapLikeRect(g.bbox, g.axes);

  /**
   * Cannot-link guard: the monster detector's own rule. A union that touches no
   * face edge yet sweeps more than `monsterSpanFrac` of an axis is not one
   * sticker — refuse before any merge rule gets a vote, so the fixpoint cannot
   * drift there.
   */
  const monsterUnion = (r: Rect): boolean => {
    const ax = bleedAxesOf(r, scale.panelPt, edgeTolPt);
    if (ax.edges.length) return false;
    return (
      rectW(r) / rectW(scale.panelPt) > params.monsterSpanFrac ||
      rectH(r) / rectH(scale.panelPt) > params.monsterSpanFrac
    );
  };

  /**
   * Ink-containment for nested different-colour pairs: the bbox nests, the
   * contours never touch (emblem floating inside a seal disc), but the smaller
   * piece's outline points actually sit INSIDE the larger's filled outline.
   * A C-shaped host (the apple around "HORTIFRUTI") fails this test because the
   * text lives in the concavity — outside the filled region.
   */
  const inkContained = (a: LockupAgg, b: LockupAgg): boolean => {
    const areaA = rectArea(a.bbox);
    const areaB = rectArea(b.bbox);
    if (areaA <= 0 || areaB <= 0) return false;
    if (Math.min(areaA, areaB) / Math.max(areaA, areaB) < params.overlapMergeAreaRatio) {
      return false;
    }
    const [inner, outer] = areaA <= areaB ? [a, b] : [b, a];
    if (wrapLikeAgg(outer)) return false;
    if (!inner.outline.length || !outer.outline.length) return false;
    const samples: Pt[] = [];
    const total = inner.outline.reduce((n, poly) => n + poly.length, 0);
    const stride = Math.max(1, Math.ceil(total / params.inkContainSampleCap));
    for (const poly of inner.outline) {
      for (let i = 0; i < poly.length; i += stride) samples.push(poly[i]);
    }
    if (!samples.length) return false;
    let inside = 0;
    for (const p of samples) if (pointInsidePolys(outer.outline, p)) inside += 1;
    return inside / samples.length >= params.inkContainInsideFrac;
  };

  /**
   * Word-gap rejoin gate: beyond the classic lockup reach only the
   * height-proportional WORD weld may bridge, and only along the line. The
   * wider pretest radius below exists to rejoin what splitDisjoint separated
   * (TRANS DALDEGAN: 45.5 cm word gap at h ~200), not to let same-colour
   * pieces far apart in any direction become one monster. Applied inside the
   * predicate so it holds at EVERY granularity, aggregate fixpoint included.
   */
  const withinLockupReach = (ra: Rect, rb: Rect): boolean => {
    const g = gapsBetween(ra, rb);
    if (g.x <= lockupGapPt && g.y <= lockupGapPt) return true;
    return onSameLine(ra, rb, params) && g.x <= Math.max(lockupGapPt, sameLineReachPairPt(ra, rb));
  };

  /** Pretest cluster radius, widened to keep splitDisjoint parts rejoinable. */
  const lockupRadius = (r: Rect): number => {
    const h = rectH(r);
    return Math.max(lockupGapPt, Math.min(0.35 * h, sameLineReachPt(h)));
  };

  /**
   * EXP-C(2) — icon satellite: an icon-sized mark (often a raster image with
   * no colour at all, so colorDistance is Infinity) sitting ON the text line it
   * belongs to. Every different-colour rule demands comparable size, so a small
   * icon beside a text run can never merge; this is the orphan class the
   * grouping bench counts (Norte Minas: apple icon 5.58 cm from its text line,
   * designer's H=107 anchors the piece at the ICON edge). Gates: satellite
   * icon-sized in absolute cm AND relative to the line height; host is a
   * text-line-like run (height-capped, wide, multi-subform); same line (band
   * overlap); gap within the doctrine weld reach computed from the HOST line
   * height. Colour is deliberately NOT consulted.
   */
  const iconSatellite = (a: LockupAgg, b: LockupAgg): boolean => {
    const [s, h] = rectArea(a.bbox) <= rectArea(b.bbox) ? [a, b] : [b, a];
    // Same-colour pairs already have the word/line weld — this rule exists only
    // for the pairs the colour doctrine locks out (icons, raster marks).
    if (colorDistance(s.color, h.color) <= params.colorMergeDelta) return false;
    if (s.axes.edges.length || h.axes.edges.length) return false;
    if (wrapLikeAgg(h) || wrapLikeAgg(s)) return false;
    if (rectArea(s.bbox) > 0.3 * rectArea(h.bbox)) return false;
    const cm = scale.ptPerCm;
    const sW = rectW(s.bbox) / cm;
    const sH = rectH(s.bbox) / cm;
    const hH = rectH(h.bbox) / cm;
    const hW = rectW(h.bbox) / cm;
    /**
     * O SELO É MAIS ALTO QUE A LETRA, e medi-lo pela altura da linha era pedir
     * o impossível.
     *
     * A caixa de uma linha de texto é a altura de MAIÚSCULA — 15 cm no bloco de
     * contato do Adel Coco. O selo redondo do WhatsApp ao lado dela tem 26 cm,
     * porque um selo abraça a linha inteira, ascendente e descendente, e ainda
     * sobra. Pela diagonal contra uma altura e meia (22,5 cm) ele era grande
     * demais e o ícone ficava órfão: 62 pares do acervo, o padrão isolado mais
     * comum de falha desta regra. No Norte Minas o mesmo desenho junta, e junta
     * só porque ali o ícone é menor que a linha — a diferença entre "junta" e
     * "não junta" era o desenho do selo, não a relação entre as duas peças.
     *
     * O limite passa a ser por LADO, não pela diagonal: nenhum dos dois lados
     * do selo pode passar de duas alturas da linha. Bloqueia a régua deitada de
     * 60 × 5 cm, que a diagonal deixava passar, e aceita o selo quadrado.
     */
    if (Math.max(sW, sH) > 60 || Math.max(sW, sH) > params.iconSatelliteSizeRatio * hH) {
      return false;
    }
    if (hH > 50 || hW < 2 * hH) return false;
    if (h.outline.length < 6) return false;
    /**
     * "Está na linha" mede-se pela MENOR das duas alturas. Contra a altura do
     * satélite, um selo que abraça a linha por fora se reprovava sozinho — a
     * sobreposição é a linha inteira (15 de 15), mas dividida pelos 26 cm do
     * selo dava 0,58. Pela menor, um selo que engole a linha dá 1,0 e um ícone
     * numa fileira acima ou abaixo continua dando 0.
     */
    const bandOv =
      Math.max(0, Math.min(s.bbox.y1, h.bbox.y1) - Math.max(s.bbox.y0, h.bbox.y0)) /
      Math.max(1e-6, Math.min(rectH(s.bbox), rectH(h.bbox)));
    if (bandOv < 0.8) return false;
    const g = gapsBetween(s.bbox, h.bbox);
    const reachPt =
      Math.min(params.maxPartGapCm, Math.max(params.partGapCm, params.textGapFactor * hH)) * cm;
    return Math.max(g.x, g.y) <= reachPt;
  };

  /**
   * The ONE lockup-granularity predicate, used both for the initial part
   * clustering and for the aggregate fixpoint rounds. Ordering matters: the
   * stack-width veto lives INSIDE the same-colour branch, so a different-colour
   * pair the veto used to pre-empt still gets the multicolour / nested /
   * companion rules consulted.
   */
  const lockupCompatible = (a: LockupAgg, b: LockupAgg, guarded: boolean): boolean => {
    if (overBudget()) return false;
    if (!withinLockupReach(a.bbox, b.bbox)) return false;
    // The bbox gap is a lower bound on contour distance: only pay the O(n*m)
    // contour test when the boxes are already within the touch tolerance.
    const boxGap = gapsBetween(a.bbox, b.bbox);
    // Backdrop-to-backdrop, aggregate edition: an aggregate that is ONLY an
    // evidence-less background image merges into an OVERLAPPING wrap-like
    // aggregate — the bitmap and the vector background it sits on print as
    // one wrap. It never gets to swallow positionable art: the other side
    // must itself be wrap-like.
    if (
      boxGap.x === 0 &&
      boxGap.y === 0 &&
      ((a.imageBackdrop && wrapLikeAgg(b)) || (b.imageBackdrop && wrapLikeAgg(a)))
    ) {
      return true;
    }
    /**
     * FUNDO COM FUNDO, ARTE COM ARTE — a invariante, dita uma vez só.
     *
     * Todas as regras abaixo já vinham tentando dizer isto cada uma do seu
     * jeito, e cada remendo deixava uma fresta: a continência de tinta recusava
     * o hospedeiro que sangra, a guarda de continência recusava a faixa que
     * engole a caixa, a marca multicor confiava na razão de áreas. Bastava
     * fechar uma para o par cair na seguinte e passar — no Ki era o ramo de
     * mesma cor, no TRANSGENIO a marca multicor, e o remendo de uma quebrava
     * a outra.
     *
     * O que separa envelopamento de adesivo não é cor, nem porte, nem toque: é
     * que o envelopamento SANGRA e o adesivo tem posição. Duas naturezas
     * diferentes não são a mesma peça de vinil, e nenhuma evidência de
     * vizinhança deveria poder dizer que são — a borda de um fundo varre a
     * face e encosta em tudo que passa por cima dele.
     *
     * Vale só na granularidade de CONJUNTO. No estágio de PEÇA a faixa ainda
     * está sendo montada, e um pedaço dela pode não sangrar sozinho (o brilho
     * branco da onda do DiCasa, que o projetista endossa dentro do
     * envelopamento) — lá as guardas continuam por ramo.
     */
    if (wrapLikeAgg(a) !== wrapLikeAgg(b)) return false;
    const touching =
      Math.hypot(boxGap.x, boxGap.y) <= touchTol &&
      contourDistance(a.outline, b.outline, touchTol) <= touchTol;
    // Cannot-link guard, FIXPOINT rounds only: the aggregate re-testing is the
    // new loosening, and this holds it. In the initial pass it would dismember
    // linkage the engine already had (splitting one monster into two), and
    // physically connected art is one piece regardless — so it only vetoes
    // non-touching aggregate unions.
    if (guarded && !touching && monsterUnion(union(a.bbox, b.bbox))) return false;
    if (colorDistance(a.color, b.color) <= params.colorMergeDelta) {
      if (
        boxGap.y > 0 &&
        !touching &&
        stackWidthCover(a.bbox, b.bbox) < params.stackWidthCoverFrac
      ) {
        return false;
      }
      // EXP-C(1) — ink-distance gate: the bbox gap is only a LOWER bound on ink
      // distance. A pair whose boxes overlap on empty corner space (FRICARNE
      // 840: the phone block tucked into the lockup bbox corner, real ink
      // 78 cm away) sails through withinLockupReach with gap (0,0). Demand the
      // INK be within the same reach the bbox test granted.
      if (
        !touching &&
        boxGap.x === 0 &&
        boxGap.y === 0 &&
        Math.min(rectArea(a.bbox), rectArea(b.bbox)) >= minAreaPt &&
        contourDistance(a.outline, b.outline, lockupGapPt) > lockupGapPt
      ) {
        return false;
      }
      return true;
    }
    if (
      isSamePieceMulticolour(
        { outline: a.outline, bbox: a.bbox },
        { outline: b.outline, bbox: b.bbox },
        params,
        scale.ptPerCm,
        (p) => wrapLikeAgg(p.bbox === a.bbox ? a : b),
      )
    ) {
      return true;
    }
    // EXP-C(3) mirror — same-line SMALL-gap weld at lockup granularity, so the
    // fixpoint cannot strand a fragment its own part-level weld would take.
    // Same guards as the part-level clause: a REAL gap (boxGap.x > 0) and no
    // wrap-like side, or the wrap swallows the lockup drawn over it.
    {
      const smallGapPt = 3.5 * scale.ptPerCm;
      if (
        boxGap.x > 0 &&
        boxGap.x <= smallGapPt &&
        onSameLine(a.bbox, b.bbox, params) &&
        !wrapLikeAgg(a) &&
        !wrapLikeAgg(b) &&
        contourDistance(a.outline, b.outline, smallGapPt) <= smallGapPt
      ) {
        return true;
      }
    }
    if (nestedFraction(a.bbox, b.bbox) >= params.nestedMergeFrac) {
      if (touching) return true;
      if (inkContained(a, b)) return true;
    }
    if (iconSatellite(a, b)) return true;
    return isCompanionPiece(
      { outline: a.outline, bbox: a.bbox },
      { outline: b.outline, bbox: b.bbox },
      params,
      scale.ptPerCm,
    );
  };

  const partAggs: LockupAgg[] = partClusters.map((_, i) => ({
    bbox: parts[i],
    outline: partOutlines[i],
    color: partColors[i],
    axes: partAxes[i],
    imageBackdrop: partImageBackdrop[i],
  }));
  let lockups = cluster(
    parts,
    (i) => lockupRadius(parts[i]),
    (a, b) => lockupCompatible(partAggs[a], partAggs[b], false),
  );

  /**
   * Merge to FIXPOINT at lockup granularity. Every rule above only ever ran on
   * frozen part boxes; a pair that fails part-vs-part can pass once each side
   * is the aggregate the rule was written about (the Norte Minas seal passes
   * the multicolour gates at aggregate level while every pairwise test fails).
   * Merging is monotone, so this converges — 2-3 rounds in practice.
   */
  for (let round = 0; round < 5 && lockups.length > 1; round += 1) {
    const aggs: LockupAgg[] = lockups.map((idx) => {
      const bbox = idx.map((i) => parts[i]).reduce((p, q) => union(p, q));
      let color: RGB | null = null;
      let bestArea = -1;
      for (const i of idx) {
        const area = rectArea(parts[i]);
        if (partColors[i] && area > bestArea) {
          bestArea = area;
          color = partColors[i];
        }
      }
      return {
        bbox,
        outline: idx.flatMap((i) => partOutlines[i]),
        color,
        axes: unionAxes(idx.map((i) => partAxes[i])),
        imageBackdrop: idx.every((i) => partImageBackdrop[i]),
      };
    });
    const merged = cluster(
      aggs.map((g) => g.bbox),
      (i) => lockupRadius(aggs[i].bbox),
      (a, b) => lockupCompatible(aggs[a], aggs[b], true),
    );
    if (merged.length === lockups.length) break;
    lockups = merged.map((gi) => gi.flatMap((g) => lockups[g]));
  }

  const built: { item: Sticker; objects: VectorObject[] }[] = [];
  for (const group of lockups) {
    const ordered = [...group].sort(
      (a, b) => parts[a].y0 - parts[b].y0 || parts[a].x0 - parts[b].x0,
    );
    const own = ordered.map((i) => parts[i]);
    const bbox = own.reduce((a, b) => union(a, b));
    const bleedAxes = unionAxes(ordered.map((i) => partAxes[i]));
    const covers = rectArea(bbox) / panelAreaPt;
    // Envelopamento é quem sangra pelos DOIS eixos, ou quem cobre a face quase
    // inteira SANGRANDO. Sangrando por um eixo só, sobra uma posição a cotar.
    //
    // A cláusula de área exige encostar em alguma aresta, e a razão está na
    // FRICARNE: o logotipo mede 463 × 176 cm e a caixa dele cobre 40% da face,
    // acima do piso de 35% — sem essa exigência ele era declarado envelopamento
    // sem encostar em aresta nenhuma. Envelopamento é o que SANGRA; um logotipo
    // grande no meio da face é só um logotipo grande.
    const isWrap =
      (bleedAxes.horizontal && bleedAxes.vertical) ||
      (covers >= params.bleedAreaFrac && bleedAxes.edges.length > 0);
    if (!isWrap && rectArea(bbox) < minAreaPt) continue;
    const edgesCm = ordered.map((i) => edgesToCm(partEdges[i], scale));
    const alignedBoxCm = isWrap
      ? rectToCm(scale, bbox)
      : alignedBoxOf(edgesCm, rectToCm(scale, bbox));
    const item: Sticker = {
      bbox,
      boxCm: rectToCm(scale, bbox),
      alignedBox: isWrap ? bbox : cmToRect(scale, alignedBoxCm),
      alignedBoxCm,
      parts: own,
      partsCm: own.map((r) => rectToCm(scale, r)),
      partEdgesCm: edgesCm,
      areaCm2: rectArea(bbox) / (scale.ptPerCm * scale.ptPerCm),
      bleeds: isWrap,
      bleedAxes,
    };
    // O envelopamento aparece pelo CONTORNO real: a forma é côncava e o
    // retângulo cobre metade de vazio.
    /**
     * O contorno acompanha todo item que ENCOSTA numa aresta, não só o
     * envelopamento pleno.
     *
     * A foice de fundo do FRICARNE sangra pelo topo e pelo piso, cobre 23% da
     * face e não é envelopamento pleno — então ficava sem contorno e a tela
     * desenhava a CAIXA dela: 198 × 240 cm, a altura inteira do caminhão, para
     * uma fita de trinta centímetros. Dois dos quatro lados caíam exatamente em
     * cima do contorno que o próprio PDF já desenha, e o preenchimento é 8% de
     * azul sobre arte escura. O quadro existia e era invisível.
     *
     * Fica restrito a quem sangra de propósito: um bloco de texto desenhado
     * pelo contorno viraria o traçado de cada letra, que é ruído. Para ele a
     * caixa é a figura certa.
     */
    // Um wrap feito só de imagem sem evidência tem partOutlines vazio — sem
    // contorno real, a caixa alinhada continua sendo a figura certa (deixar
    // outlinePt = [] apagaria o quadro inteiro).
    if (bleedAxes.edges.length) {
      const outlinePt = ordered.flatMap((i) => partOutlines[i]);
      if (outlinePt.length) item.outlinePt = outlinePt;
    }
    built.push({
      item,
      // A travessia da aresta se lê no CAMINHO, não na caixa. Guardar os
      // objetos de origem é o que permite cortar o contorno rente à quina.
      objects: ordered.flatMap((i) => partClusters[i]).map((i) => elements[i]),
    });
  }
  built.sort((a, b) => b.item.areaCm2 - a.item.areaCm2);
  return {
    items: built.map((b) => b.item),
    objects: built.map((b) => b.objects),
    stickers: built.filter((b) => !b.item.bleeds).map((b) => b.item),
    wraps: built.filter((b) => b.item.bleeds).map((b) => b.item),
    truncated: overBudget(),
    contourWork: contourWork - workAtStart,
  };
}

/** Converte objetos crus em pool etiquetado — ponte para quem já chamava assim. */
function toPool(objects: VectorObject[], scale: Scale, params: GroupingParams): ClassifiedPiece[] {
  const tolPt = params.bleedTouchCm * scale.ptPerCm;
  const panelAreaPt = rectArea(scale.panelPt);
  return objects.map((obj) => ({
    obj,
    bleedAxes: bleedAxesOf(obj.bbox, scale.panelPt, tolPt),
    coversFrac: rectArea(obj.bbox) / panelAreaPt,
  }));
}

export function buildStickers(
  elements: VectorObject[],
  scale: Scale,
  params: GroupingParams,
  options: GroupingOptions = {},
): Sticker[] {
  return buildItems(toPool(elements, scale, params), scale, params, options).stickers;
}

export function buildWraps(
  bleeds: VectorObject[],
  scale: Scale,
  params: GroupingParams,
): Sticker[] {
  return buildItems(toPool(bleeds, scale, params), scale, params).wraps;
}

export type { BuiltItems as GroupedItems };

/**
 * Onde o envelopamento cruza as arestas da face.
 *
 * Com a geometria vetorial isso é exato: corta-se o contorno pela reta da
 * aresta e ficam os intervalos cobertos. É a cota que GRESPAN, Ki e Norte Minas
 * desenham — o aplicador precisa saber em que ponto da quina o adesivo começa.
 *
 * As QUATRO arestas, e não só as duas horizontais. O motor lia topo e piso; mas
 * 55% das faces do acervo têm sangria cruzando uma lateral, e o projetista cota
 * lateral tanto quanto horizontal (12 de 13 contra 13 de 14). O Adel Coco tem
 * seis cotas de travessia e duas delas descem as quinas.
 *
 * E é pela travessia que se cota faixa, não pela caixa: em 78% das faixas
 * laterais a caixa erra a silhueta, com mediana de 26% da largura. Na FRICARNE a
 * caixa dá 275 e o projetista escreveu 183, que é a travessia no topo.
 */
export function borderCrossings(
  objectsByItem: VectorObject[][],
  panel: Panel,
  scale: Scale,
  params: GroupingParams,
): BorderCrossing[] {
  const widthCm = panelWidthCm(panel);
  const out: BorderCrossing[] = [];
  // Cada objeto sabe de que item veio: a travessia nasce já com dono, e não
  // precisa ser adivinhada por proximidade depois.
  const owner = new Map<VectorObject, number>();
  const bleeds: VectorObject[] = [];
  objectsByItem.forEach((objects, index) => {
    for (const obj of objects) {
      owner.set(obj, index);
      bleeds.push(obj);
    }
  });

  for (const edge of ["top", "bottom", "left", "right"] as const) {
    const vertical = edge === "left" || edge === "right";
    // o comprimento da aresta, em cm: a lateral mede a ALTURA da face
    const lengthCm = vertical ? panel.heightCm : widthCm;
    const originPt = vertical ? scale.panelPt.y0 : scale.panelPt.x0;
    const at = (inset: number) => {
      const d = inset * scale.ptPerCm;
      if (edge === "top") return scale.panelPt.y0 + d;
      if (edge === "bottom") return scale.panelPt.y1 - d;
      if (edge === "left") return scale.panelPt.x0 + d;
      return scale.panelPt.x1 - d;
    };
    const spans: Span[] = [];
    /**
     * A leitura é COLADA na aresta, e o feixe é a razão.
     *
     * A faixa chega à quina quase tangente, então cada centímetro que se entra
     * na face desloca o cruzamento dezenas de centímetros ao longo dela — a
     * cota acabava bem antes do fim real da faixa. Lê-se num feixe de amostras
     * rentes e vale a primeira que encontrar material.
     */
    for (const inset of params.crossingInsetsCm) {
      const line = at(inset);
      for (const obj of bleeds) {
        const box = obj.bbox;
        const outside = vertical
          ? box.x0 > line || box.x1 < line
          : box.y0 > line || box.y1 < line;
        if (outside) continue;
        const hits = crossingsAt(obj, line, vertical);
        for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i], hits[i + 1], obj]);
      }
      if (spans.length) break;
    }
    // sem nada na aresta, tenta um pouco mais para dentro
    if (!spans.length) {
      const line = at(params.bleedTouchCm);
      for (const obj of bleeds) {
        const box = obj.bbox;
        const outside = vertical
          ? box.x0 > line || box.x1 < line
          : box.y0 > line || box.y1 < line;
        if (outside) continue;
        const hits = crossingsAt(obj, line, vertical);
        for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i], hits[i + 1], obj]);
      }
    }

    for (const span of mergeSpans(spans, params.crossingMergeCm * scale.ptPerCm)) {
      const startCm = (span[0] - originPt) / scale.ptPerCm;
      const endCm = (span[1] - originPt) / scale.ptPerCm;
      if (endCm - startCm < params.crossingMinRunCm) continue;
      if (startCm <= 0.5 && endCm >= lengthCm - 0.5) continue; // cobre a aresta inteira
      out.push({
        edge,
        startCm: Math.max(0, startCm),
        endCm: Math.min(lengthCm, endCm),
        wrapIndex: owner.get(span[2]) ?? 0,
      });
    }
  }
  return out;
}

/**
 * Coordenadas em que o contorno cruza a reta de corte, aos pares.
 *
 * `vertical` diz que a reta é x = `at` e a resposta sai em y; caso contrário a
 * reta é y = `at` e a resposta sai em x.
 */
function crossingsAt(obj: VectorObject, at: number, vertical: boolean): number[] {
  const hits: number[] = [];
  for (const poly of obj.outline) {
    for (let i = 0; i + 1 < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[i + 1];
      const pa = vertical ? a.x : a.y;
      const pb = vertical ? b.x : b.y;
      if (pa === pb) continue;
      const lo = Math.min(pa, pb);
      const hi = Math.max(pa, pb);
      if (at < lo || at >= hi) continue;
      const t = (at - pa) / (pb - pa);
      hits.push(vertical ? a.y + t * (b.y - a.y) : a.x + t * (b.x - a.x));
    }
  }
  hits.sort((p, q) => p - q);
  return hits;
}

/** Um trecho da aresta coberto por um objeto: início, fim e quem o cobriu. */
type Span = [number, number, VectorObject];

/**
 * Funde trechos separados por vãos curtos, guardando o objeto do PRIMEIRO.
 *
 * Um feixe de filetes finos é um adereço só; medido filete a filete, a cota
 * para no primeiro deles e diz muito menos do que o aplicador precisa.
 */
function mergeSpans(spans: Span[], gap: number): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [[...sorted[0]] as Span];
  for (const span of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (span[0] <= last[1] + gap) last[1] = Math.max(last[1], span[1]);
    else out.push([...span] as Span);
  }
  return out;
}
