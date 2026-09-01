/**
 * Renderizador server-side do orçamento (Playwright/Chromium).
 *
 * Substitui o `window.print()` do navegador do cliente. A troca não é estética:
 * não se pode hashear — nem, portanto, assinar — bytes que foram produzidos pelo
 * pipeline de impressão da máquina de outra pessoa, com as fontes dela, na escala
 * que ela escolheu no diálogo de impressão. A aplicação nem conseguia observar o
 * resultado.
 *
 * **Determinismo é irrelevante aqui, e isso é intencional.** Os bytes são
 * congelados uma única vez, no envio para assinatura, e nunca mais regerados —
 * exatamente o que Clicksign, ZapSign, D4Sign e Autentique fazem (todas recebem
 * upload e hasheiam o arquivo original, uma vez). Perseguir reprodutibilidade
 * byte-a-byte de um render HTML seria apostar a integridade probatória de um
 * contrato na estabilidade de um subsetter de fontes ao longo de anos de
 * atualização de dependências.
 *
 * Playwright e Chromium JÁ são dependências de runtime (`SecullumBrowserSignerService`,
 * Dockerfile:105-110), então isto não adiciona peso à imagem.
 */

import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { buildQuoteHtml, QuoteHtmlInput } from './quote-html.builder';
import { FULL_SECTIONS } from '../quote-sections';

/** O que o chamador fornece; fonte e logo são resolvidas aqui dentro. */
export type RenderInput = Omit<QuoteHtmlInput, 'fontDataUri' | 'logoDataUri'>;

/** Retângulo de um slot de assinatura, medido no navegador. */
export interface SignatureAnchor {
  /** Índice da página (0-based) contando os elementos `.page`. */
  page: number;
  /** Offsets em px CSS relativos à origem (topo-esquerda) da página. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dimensões da página em px CSS — permitem derivar a escala px→pt sem supor DPI. */
  pageWidthCss: number;
  pageHeightCss: number;
}

export type SignatureAnchorMap = Record<string, SignatureAnchor>;

/**
 * Retângulo de uma lacuna de cadastro tardio (série, placa, chassi), medido no
 * navegador junto com o resto do documento. Ver `LateSlotKey` no builder.
 */
export interface LateSlotAnchor extends SignatureAnchor {
  /** Corpo do texto do documento, em px CSS — o carimbo sai no mesmo tamanho. */
  fontSizeCss: number;
  /**
   * Distância do topo do retângulo até a LINHA DE BASE do texto, em px CSS.
   *
   * Medida, não derivada. Calcular a baseline a partir da altura da caixa exige
   * supor as métricas da fonte (ascendente, descendente, meio-vão da
   * entrelinha); com a Inter variável embutida, o erro dessa suposição ficou em
   * ~1,3pt — o suficiente para o dado carimbado flutuar visivelmente acima do
   * texto vizinho, que é justamente o que denunciaria o carimbo como remendo.
   */
  baselineCss: number;
}

export type LateSlotAnchorMap = Record<string, LateSlotAnchor>;

export interface RenderedQuoteDocument {
  pdf: Buffer;
  anchors: SignatureAnchorMap;
  /**
   * Lacunas reservadas na frase do veículo, por campo. Vazio quando o cadastro
   * já estava completo na emissão — que é o caso em que não há nada a carimbar.
   */
  lateSlots: LateSlotAnchorMap;
  /** Quantas iterações de ajuste foram necessárias (0 = coube de primeira). */
  fitIterations: number;
  /** True quando o conteúdo ainda excedia a página após o último ajuste. */
  overflowed: boolean;
  /** Quantas folhas o corpo do orçamento consumiu (a de assinaturas é a seguinte). */
  contentPages: number;
  /**
   * Altura reservada à ARTE no render aceito, em mm. `null` sem arte.
   *
   * Existe para que a decisão "cabeu numa folha" seja auditável: a folha única
   * só vale enquanto a arte continua conferível, e sem este número a única
   * forma de saber a que preço ela coubera era abrir o PDF e medir com régua.
   */
  layoutMm: number | null;
}

const MAX_FIT_ITERATIONS = 12;

/**
 * Quanto de ARTE a folha fundida precisa preservar, em mm.
 *
 * O layout e as assinaturas na mesma folha só valem a pena enquanto a arte
 * continua CONFERÍVEL — é ela que o cliente está aprovando. O laço de sacrifício
 * desce `--layout-max-h` até 30mm (tamanho de selo postal); aceitar uma folha só
 * a esse preço entregaria um contrato com uma miniatura no lugar do objeto dele.
 *
 * O ORÇAMENTO É TOTAL, não por imagem, e a diferença foi medida. `--layout-max-h`
 * é um teto POR IMAGEM: com duas artes, um piso de 90mm por imagem exigiria
 * 180mm de altura só de arte, e nenhuma folha fecha assim — o recorte do
 * marketing com duas artes voltaria a paginar. Olhando o total, duas artes a
 * 45mm ocupam os mesmos 90mm que uma a 90mm, e as duas folhas são igualmente
 * legíveis.
 *
 * 90mm sai da FORMA da arte, não de um palpite: um lettering de baú é largo e
 * baixo (a proporção medida fica perto de 1600×600) e a caixa de conteúdo tem
 * 180mm, então a altura NATURAL de uma arte é ~67mm. Um teto de 90mm não a
 * constrange — ela sai do mesmo tamanho que sairia na folha própria do caminho
 * de duas partes. É essa paridade que faz o documento inteiro continuar
 * paginando como sempre paginou, em vez de espremer a arte para economizar uma
 * folha.
 *
 * O piso POR IMAGEM existe além do total para o caso de muitas artes: seis a
 * 15mm somam 90mm e nenhuma é conferível.
 */
const FUSED_MIN_LAYOUT_TOTAL_MM = 90;
const FUSED_MIN_LAYOUT_EACH_MM = 40;

/** Lê a altura corrente reservada à arte, em mm. */
const JS_LAYOUT_HEIGHT = `(() => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--layout-max-h').trim();
  const n = parseFloat(raw);
  return isFinite(n) ? n : 105;
})()`;

/**
 * Os callbacks de browser são passados como STRING, não como função.
 *
 * Motivo concreto: transpiladores que preservam nomes de função (esbuild/tsx com
 * `keepNames`, e swc em algumas configurações) injetam um helper `__name` em
 * volta de funções. Ao serializar a função para o contexto da página, o helper
 * não existe lá e o `page.evaluate` estoura com `ReferenceError: __name is not
 * defined` — falha que aparece só em runtime e depende da ferramenta de build.
 * O build de produção usa `nest build` (tsc puro) e não sofreria disso, mas
 * amarrar a geração de um documento assinado à escolha de transpilador é risco
 * gratuito. String é imune a qualquer um deles.
 *
 * A página de assinaturas é a ÚNICA com altura fixa, e é a única que não pode
 * transbordar: perder uma linha de assinatura por clipping seria perder um
 * signatário do documento sem qualquer sinal. O conteúdo do orçamento, ao
 * contrário, é livre para paginar.
 */
const JS_SIGNATURES_OVERFLOW = `(() => {
  const el = document.getElementById('signatures-content');
  return el ? el.scrollHeight > el.clientHeight + 1 : false;
})()`;

/**
 * Reduz o que é sacrificável: altura da imagem de layout e do selo. Serve às DUAS
 * folhas — a de assinaturas (onde transbordar clipa um signatário) e a fundida
 * (onde é o que decide se as assinaturas ficam na primeira página).
 *
 * Devolve `false` quando as duas já estão no piso, para o chamador parar de girar.
 */
const JS_SHRINK_SIGNATURES = `(() => {
  const root = document.documentElement;
  const read = (name, fallback) => {
    const raw = getComputedStyle(root).getPropertyValue(name).trim();
    const n = parseFloat(raw);
    return isFinite(n) ? n : fallback;
  };
  const layout = read('--layout-max-h', 105);
  const seal = read('--seal-height', 26);
  const nextLayout = Math.max(layout - 10, 30);
  const nextSeal = Math.max(seal - 1.5, 17);
  root.style.setProperty('--layout-max-h', nextLayout + 'mm');
  root.style.setProperty('--seal-height', nextSeal + 'mm');
  return Math.abs(nextLayout - layout) > 1e-6 || Math.abs(nextSeal - seal) > 1e-6;
})()`;

/** Altura do conteúdo do orçamento vs. uma folha útil (270mm), em px. */
const JS_CONTENT_PAGES = `(() => {
  const el = document.getElementById('page-1-content');
  const page = document.getElementById('page-1');
  if (!el || !page) return { height: 0, sheet: 1 };
  // 270mm em px CSS: 1mm = 96/25.4 px
  const sheet = 275 * (96 / 25.4);
  return { height: page.getBoundingClientRect().height, sheet: sheet };
})()`;

/**
 * Ajuste BIDIRECIONAL da tipografia.
 *
 * O ajustador anterior só encolhia, e nunca crescia. Consequências medidas: um
 * orçamento de 8 serviços saía a 8,2pt (espremido) enquanto um de 3 saía a 10pt
 * — dois documentos da mesma empresa com aparência diferente; e um de 12
 * serviços gastava todas as iterações, batia no piso E paginava assim mesmo,
 * produzindo uma folha contendo só o rodapé.
 *
 * `dir` = -1 encolhe, +1 cresce. Devolve false quando não há mais folga.
 */
const JS_STEP_CONTENT = (dir) => `(() => {
  const root = document.documentElement;
  const d = ${dir};
  const read = (n, f) => { const v = parseFloat(getComputedStyle(root).getPropertyValue(n)); return isFinite(v) ? v : f; };
  const vars = [
    ['--service-size', 10,  8.5, 11.5, 0.25, 'pt'],
    ['--block-gap',     5,    2,   10,  0.4,  'mm'],
    // Teto igual ao padrao (14mm): o logo so ENCOLHE, ate o mesmo piso de 10mm do
    // gerador de referencia. Entra no orcamento de reducao para que um orcamento
    // longo gaste milimetros do cabecalho antes de abrir uma folha nova.
    ['--logo-height',  14,   10,   14,  0.5,  'mm'],
  ];
  let moved = false;
  for (const [name, def, min, max, step, unit] of vars) {
    const cur = read(name, def);
    const next = Math.min(Math.max(cur + d * step, min), max);
    if (Math.abs(next - cur) > 1e-6) { root.style.setProperty(name, next + unit); moved = true; }
  }
  return moved;
})()`;

/** Fixa a altura da folha para que as sobras virem ritmo (só em documento de 1 folha). */
const JS_SET_SHEET_FILL = (mm) =>
  `(() => { document.documentElement.style.setProperty('--sheet-fill', '${mm}mm'); })()`;

const JS_MEASURE_ANCHORS = `(() => {
  const out = {};
  document.querySelectorAll('[data-signature-slot]').forEach(el => {
    const id = el.getAttribute('data-signature-slot');
    if (!id) return;
    // Todos os slots vivem na pagina de assinaturas, que e a ultima do PDF.
    const pageEl = el.closest('.page-signatures') || el.closest('.page');
    if (!pageEl) return;
    const r = el.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();
    out[id] = {
      page: -1,
      x: r.left - pr.left,
      y: r.top - pr.top,
      width: r.width,
      height: r.height,
      pageWidthCss: pr.width,
      pageHeightCss: pr.height,
    };
  });
  return out;
})()`;

/**
 * Mede as lacunas de cadastro tardio (`[data-late-slot]`) na frase do veículo.
 *
 * Mesma geometria das âncoras de assinatura — offsets relativos à `.page`, que é
 * a caixa de conteúdo — para que o montador use a MESMA conversão px→pt e o
 * mesmo deslocamento de margem. O que muda é o corpo do texto, que viaja junto:
 * o ajustador de tipografia altera `--service-size` e o corpo do parágrafo com
 * ele, então o carimbo só sai no tamanho certo se o tamanho for medido, e não
 * suposto.
 */
const JS_MEASURE_LATE_SLOTS = `(() => {
  const out = {};
  document.querySelectorAll('[data-late-slot]').forEach(el => {
    const key = el.getAttribute('data-late-slot');
    if (!key) return;
    const pageEl = el.closest('.page') || el.closest('.page-signatures');
    if (!pageEl) return;
    const r = el.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();
    // Uma lacuna partida em duas linhas nao tem UM retangulo onde carimbar. O
    // inline-block impede isso, e a verificacao transforma a premissa em fato:
    // getClientRects() traz um retangulo por linha ocupada.
    if (el.getClientRects().length !== 1) return;
    // Sonda de linha de base: um inline-block de altura zero alinhado pela
    // baseline tem topo e base EM CIMA dela. E sai do DOM antes do pdf().
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.appendChild(probe);
    const baselineCss = probe.getBoundingClientRect().top - r.top;
    probe.remove();
    out[key] = {
      page: -1,
      x: r.left - pr.left,
      y: r.top - pr.top,
      width: r.width,
      height: r.height,
      pageWidthCss: pr.width,
      pageHeightCss: pr.height,
      fontSizeCss: parseFloat(getComputedStyle(el).fontSize) || 0,
      baselineCss: baselineCss,
    };
  });
  return out;
})()`;

const JS_FONTS_READY = `(() => (document.fonts ? document.fonts.ready.then(() => true) : true))()`;

@Injectable()
export class QuoteRendererService {
  private readonly logger = new Logger(QuoteRendererService.name);

  private fontDataUri: string | null | undefined;
  private logoDataUri: string | null | undefined;

  async render(input: RenderInput): Promise<RenderedQuoteDocument> {
    // Lançamento por render. Renders são raros e uma instância de longa duração
    // acumula estado e morre em silêncio; ~500ms de startup é um preço barato
    // por previsibilidade.
    const browser = await this.launchBrowser();
    try {
      return await this.renderOn(browser, input);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Vários recortes do MESMO orçamento, num navegador só.
   *
   * A assinatura diversificada congela um PDF por recorte, e o custo de lançar
   * o Chromium (~500ms) é o item caro do ciclo — pagá-lo N vezes dentro de um
   * POST que já espera por N renders era transformar um recurso em timeout do
   * nginx. O estado que se temia acumular numa instância de longa duração não
   * chega a existir aqui: o navegador nasce e morre dentro desta chamada, e cada
   * recorte usa páginas próprias.
   *
   * A ordem da saída é a da entrada.
   */
  async renderAll(inputs: readonly RenderInput[]): Promise<RenderedQuoteDocument[]> {
    if (inputs.length === 0) return [];
    if (inputs.length === 1) return [await this.render(inputs[0])];

    const browser = await this.launchBrowser();
    try {
      const out: RenderedQuoteDocument[] = [];
      // Em série, não em paralelo: o ajuste de tipografia (`compactContent`) é
      // um laço de medição sobre o layout, e N páginas medindo ao mesmo tempo no
      // mesmo Chromium disputam a mesma thread de layout — o ganho de paralelizar
      // é nulo e a variância do resultado deixa de ser nula, num documento que
      // será hasheado e assinado.
      for (const input of inputs) out.push(await this.renderOn(browser, input));
      return out;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async renderOn(
    browser: Browser,
    input: RenderInput,
  ): Promise<RenderedQuoteDocument> {
    const htmlInput: QuoteHtmlInput = {
      ...input,
      fontDataUri: this.getFontDataUri(),
      logoDataUri: this.getLogoDataUri(),
    };
    const html = {
      fused: buildQuoteHtml(htmlInput, 'fused'),
      content: buildQuoteHtml(htmlInput, 'content'),
      signatures: buildQuoteHtml(htmlInput, 'signatures'),
    };
    // O recorte pode não trazer o layout — `layoutImages` sozinho não responde
    // mais a pergunta, porque é o builder que decide se a arte sai impressa.
    const hasLayout =
      htmlInput.layoutImages.length > 0 &&
      (htmlInput.sections ?? FULL_SECTIONS).includes('LAYOUT');

    {
      // ---- Tentativa FUNDIDA: assinaturas na mesma folha do orçamento ----
      //
      // Só é aceita se o resultado couber em UMA folha. Essa condição não é
      // conservadorismo: as âncoras são medidas no layout CONTÍNUO do DOM, e só
      // coincidem com o layout PAGINADO enquanto não houver quebra. Em uma única
      // folha, contínuo ≡ paginado, então `anchor.y` é exato e `page = 0`.
      // A asserção de `getPageCount() === 1` transforma essa premissa em fato
      // verificado — se falhar, cai no caminho de duas partes, que é sempre correto.
      // ---- Tentativa FUNDIDA: assinaturas na mesma folha do orçamento ----
      //
      // TENTADO SEMPRE, inclusive com arte — e essa condição mudou por causa dos
      // recortes.
      //
      // Antes o caminho fundido era pulado quando havia layout, para que a arte e
      // as assinaturas dividissem a última folha em vez de a arte ser espremida.
      // A regra estava certa para o documento inteiro, e virou defeito no
      // recorte: o do marketing é texto básico + arte + assinaturas, cabe
      // folgadamente em uma folha, e saía em DUAS — a primeira quase vazia.
      //
      // O que decide agora é a MEDIDA, não a presença: `tryFusedRender` só aceita
      // uma folha se a arte ainda couber acima de `FUSED_MIN_LAYOUT_MM` depois do
      // sacrifício. Com pouco conteúdo ela cabe grande e o documento fecha em
      // uma folha; com o orçamento inteiro ela não cabe, e cai no caminho de duas
      // — o mesmo arranjo de sempre.
      const fusedAttempt = await this.tryFusedRender(
        browser,
        html.fused,
        hasLayout ? htmlInput.layoutImages.length : 0,
      );
      if (fusedAttempt) {
        return fusedAttempt;
      }

      // ---- Parte 1: conteúdo do orçamento (1..N folhas) ----
      const contentPage = await browser.newPage();
      // O template é 100% self-contained (fonte, logo e layouts em data-URI),
      // então nada é buscado na rede — `load` basta e não há flakiness de
      // networkidle.
      await contentPage.setContent(html.content, { waitUntil: 'load' });
      await contentPage.emulateMedia({ media: 'print' });
      // Garante que a @font-face embutida foi decodificada antes de medir: medir
      // com fonte fallback produziria âncoras erradas.
      await contentPage.evaluate(JS_FONTS_READY);
      await this.compactContent(contentPage);
      // Medido DEPOIS da compactação e ANTES do pdf(): o ajustador mexe no corpo
      // do texto, e medir antes dele daria um retângulo que não é o impresso.
      const lateSlotsRaw = (await contentPage.evaluate(
        JS_MEASURE_LATE_SLOTS,
      )) as LateSlotAnchorMap;
      const contentPdf = Buffer.from(
        await contentPage.pdf({ printBackground: true, preferCSSPageSize: true }),
      );
      await contentPage.close();

      // ---- Parte 2: página de assinaturas (exatamente 1 folha) ----
      const sigPage = await browser.newPage();
      await sigPage.setContent(html.signatures, { waitUntil: 'load' });
      await sigPage.emulateMedia({ media: 'print' });
      await sigPage.evaluate(JS_FONTS_READY);
      const { iterations, overflowed } = await this.fitSignaturePage(sigPage);
      const sigLayoutMm = hasLayout ? ((await sigPage.evaluate(JS_LAYOUT_HEIGHT)) as number) : null;
      const anchors = await this.measureAnchors(sigPage);
      const sigPdf = Buffer.from(
        await sigPage.pdf({ printBackground: true, preferCSSPageSize: true }),
      );
      await sigPage.close();

      if (overflowed) {
        this.logger.error(
          'A página de assinaturas ainda transborda após o ajuste máximo — signatários demais para uma folha. ' +
            'O envelope não deve ser congelado neste estado.',
        );
      }

      // ---- União: conteúdo + assinaturas ----
      const { pdf, contentPages } = await this.mergeParts(contentPdf, sigPdf);

      // A página de assinaturas é, por construção, a última do documento.
      const resolved: SignatureAnchorMap = {};
      for (const [id, a] of Object.entries(anchors)) {
        resolved[id] = { ...a, page: contentPages };
      }

      return {
        pdf,
        anchors: resolved,
        lateSlots: this.resolveLateSlots(lateSlotsRaw),
        fitIterations: iterations,
        overflowed,
        contentPages,
        layoutMm: sigLayoutMm,
      };
    }
  }

  /**
   * Renderiza conteúdo + assinaturas juntos e só aceita se couber em uma folha.
   * Devolve null quando não couber — o chamador então usa o caminho de 2 partes.
   */
  private async tryFusedRender(
    browser: Browser,
    fusedHtml: string,
    /** Quantas artes o recorte imprime. 0 = não há arte a preservar. */
    layoutCount: number,
  ): Promise<RenderedQuoteDocument | null> {
    const page = await browser.newPage();
    try {
      await page.setContent(fusedHtml, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(JS_FONTS_READY);

      // INSISTIR ANTES DE DESISTIR.
      //
      // A compactação sozinha não bastava, e por um motivo que só apareceu quando
      // foi medido: ela decidia o alvo pelo número de folhas da altura NATURAL e,
      // mirando duas, CRESCIA a tipografia para preencher as duas (medido:
      // `--service-size` no teto de 11,5pt num documento que se queria em uma
      // folha). `compactContent(page, true)` mira uma folha; e o que sobra de
      // sacrificável — a altura do selo — cede pelos mesmos passos e pisos da
      // folha de assinaturas do caminho de 2 partes.
      //
      // O teste de caber É o portão, não uma regra sobre quantidade de
      // signatários: com 2 (1 Ankaa + 1 cliente, o caso normal) o bloco é uma
      // linha só e fecha até com 10 serviços; com mais gente ou orçamento longo
      // não fecha e o documento pagina, que é o comportamento correto.
      let fuseIterations = 0;
      for (let i = 0; i < MAX_FIT_ITERATIONS; i++) {
        await this.compactContent(page, true);
        if ((await this.sheetsUsed(page)) <= 1) break;
        if (!(await page.evaluate(JS_SHRINK_SIGNATURES))) break;
        fuseIterations = i + 1;
      }

      const anchors = (await page.evaluate(JS_MEASURE_ANCHORS)) as SignatureAnchorMap;
      const lateSlotsRaw = (await page.evaluate(JS_MEASURE_LATE_SLOTS)) as LateSlotAnchorMap;
      const pdf = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));

      const { PDFDocument } = await import('pdf-lib');
      const pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();

      if (pageCount !== 1 || Object.keys(anchors).length === 0) return null;

      // A folha única não vale a qualquer preço. Se a arte só coube porque foi
      // reduzida a uma miniatura, o documento perde a coisa que quem assina
      // precisa conferir — e duas folhas legíveis são melhores que uma ilegível.
      const layoutMm = layoutCount > 0 ? ((await page.evaluate(JS_LAYOUT_HEIGHT)) as number) : null;
      if (
        layoutMm !== null &&
        (layoutMm * layoutCount < FUSED_MIN_LAYOUT_TOTAL_MM ||
          layoutMm < FUSED_MIN_LAYOUT_EACH_MM)
      ) {
        this.logger.log(
          `Layout fundido recusado: ${layoutCount} arte(s) a ${layoutMm.toFixed(0)}mm ` +
            `(total ${(layoutMm * layoutCount).toFixed(0)}mm, mínimo ${FUSED_MIN_LAYOUT_TOTAL_MM}mm). ` +
            'Usando o caminho de duas folhas.',
        );
        return null;
      }

      const resolved: SignatureAnchorMap = {};
      for (const [id, a] of Object.entries(anchors)) resolved[id] = { ...a, page: 0 };

      this.logger.log(
        `Orçamento e assinaturas couberam em uma folha (layout fundido, ${fuseIterations} passo(s) ` +
          `de sacrifício${layoutMm !== null ? `, arte a ${layoutMm.toFixed(0)}mm` : ''}).`,
      );
      return {
        pdf,
        anchors: resolved,
        lateSlots: this.resolveLateSlots(lateSlotsRaw),
        fitIterations: fuseIterations,
        overflowed: false,
        contentPages: 1,
        layoutMm,
      };
    } catch (error) {
      this.logger.warn(
        `Layout fundido falhou, usando o de duas partes: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return null;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Quantas folhas o documento ocupa AGORA, pela mesma conta de `compactContent`.
   *
   * Medir em vez de gerar o PDF a cada passo: `page.pdf()` é a operação cara do
   * ciclo, e a altura do `#page-1` já responde a pergunta. A geração continua
   * acontecendo uma única vez, e a asserção de `getPageCount() === 1` continua
   * sendo a palavra final — a medição só decide se vale a pena tentar de novo.
   */
  private async sheetsUsed(page: import('playwright').Page): Promise<number> {
    const { height, sheet } = (await page.evaluate(JS_CONTENT_PAGES)) as {
      height: number;
      sheet: number;
    };
    return Math.max(Math.ceil((height - 0.5) / sheet), 1);
  }

  private async launchBrowser(): Promise<Browser> {
    // A imagem de produção instala o chromium do Alpine em /usr/bin/chromium e
    // NÃO roda `playwright install`, então o browser empacotado do Playwright não
    // existe lá. Sem este fallback o render falharia só em produção.
    const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const candidates = [explicit, '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(
      (p): p is string => Boolean(p),
    );
    const executablePath = candidates.find(p => existsSync(p));

    return chromium.launch({
      headless: true,
      timeout: 60_000,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
  }

  /**
   * Compactação COSMÉTICA do orçamento: tenta preservar o formato de uma folha
   * que o produto sempre teve, com piso de legibilidade (8,5pt).
   *
   * Substitui o motor `calculateAdaptiveLayout` do web (≈250 linhas de estimativa
   * de altura em mm). Aqui quem mede é o navegador, já com o layout aplicado — é
   * mais curto e é *correto*, em vez de aproximado. E, ao contrário do original,
   * não caber deixou de ser catastrófico: o documento pagina.
   */
  private async compactContent(
    page: import('playwright').Page,
    /**
     * Mira UMA folha, custe o que custar em tipografia e vãos.
     *
     * Sem isto a compactação trabalha CONTRA a fusão: ela decide o alvo pelo
     * número de folhas da altura natural e, mirando 2, **cresce** a tipografia
     * para preencher as duas (medido: `--service-size` no teto de 11,5pt num
     * documento que se queria em 1 folha). O chamador fundido é o único que sabe
     * que 1 folha é o objetivo — o caminho de 2 partes continua livre para
     * paginar, que é o comportamento certo lá.
     */
    forceSingleSheet = false,
  ): Promise<void> {
    const measure = async () =>
      (await page.evaluate(JS_CONTENT_PAGES)) as { height: number; sheet: number };

    let { height, sheet } = await measure();
    const sheetsFor = (h: number) => Math.max(Math.ceil((h - 0.5) / sheet), 1);

    // SONDA DE REDUÇÃO DE FOLHA. Sem ela o alvo ficava preso ao número de folhas
    // da altura INICIAL: um orçamento de 8 serviços mirava 2 folhas e parava,
    // mesmo cabendo em 1 depois de comprimir. Comprime até o piso, mede, e só
    // então decide o alvo — restaurando o estado padrão em seguida.
    const naturalSheets = sheetsFor(height);
    let targetSheets = forceSingleSheet ? 1 : naturalSheets;
    if (!forceSingleSheet && naturalSheets > 1) {
      for (let i = 0; i < MAX_FIT_ITERATIONS * 3; i++) {
        if (!(await page.evaluate(JS_STEP_CONTENT(-1)))) break;
      }
      const compressed = sheetsFor((await measure()).height);
      if (compressed < naturalSheets) targetSheets = compressed;
      // volta ao padrão para que o laço abaixo convirja pelo caminho normal
      for (let i = 0; i < MAX_FIT_ITERATIONS * 3; i++) {
        if (!(await page.evaluate(JS_STEP_CONTENT(1)))) break;
      }
    }

    // Alvo: encher entre 88% e 99,5% da última folha. Encolhe se passou, cresce
    // se sobrou — mas nunca ao custo de somar uma folha.
    const hi = targetSheets * sheet - 3;
    const lo = targetSheets * sheet - 0.12 * sheet;

    for (let i = 0; i < MAX_FIT_ITERATIONS * 3; i++) {
      ({ height } = await measure());
      if (height > hi) {
        if (!(await page.evaluate(JS_STEP_CONTENT(-1)))) break;
      } else if (height < lo) {
        if (!(await page.evaluate(JS_STEP_CONTENT(1)))) break;
        const after = (await measure()).height;
        if (after > hi) {
          // Cresceu demais: volta um passo e aceita.
          await page.evaluate(JS_STEP_CONTENT(-1));
          break;
        }
      } else {
        break;
      }
    }

    // Só estica a folha quando o documento cabe em UMA. Em multi-folha o
    // `break-inside: avoid` desloca o conteúdo de forma não determinística e
    // reaparecem páginas fantasma — foi medido e descartado.
    const final = await measure();
    if (sheetsFor(final.height) === 1) {
      await page.evaluate(JS_SET_SHEET_FILL(273));
    }
  }

  /**
   * Ajuste OBRIGATÓRIO da página de assinaturas — a única de altura fixa.
   *
   * Se ela transbordar, um slot de assinatura é clipado e o documento perde um
   * signatário sem qualquer sinal visível. Por isso o resultado é propagado e o
   * envelope se recusa a congelar quando `overflowed` continua verdadeiro.
   */
  private async fitSignaturePage(page: import('playwright').Page): Promise<{
    iterations: number;
    overflowed: boolean;
  }> {
    for (let i = 0; i < MAX_FIT_ITERATIONS; i++) {
      const overflow = (await page.evaluate(JS_SIGNATURES_OVERFLOW)) as boolean;
      if (!overflow) return { iterations: i, overflowed: false };
      await page.evaluate(JS_SHRINK_SIGNATURES);
    }
    const stillOverflowing = (await page.evaluate(JS_SIGNATURES_OVERFLOW)) as boolean;
    return { iterations: MAX_FIT_ITERATIONS, overflowed: stillOverflowing };
  }

  /**
   * Une as duas partes num único PDF.
   *
   * Devolve também quantas folhas o conteúdo consumiu — é o índice da página de
   * assinaturas, que passa a ser um fato conhecido em vez de uma inferência sobre
   * como o Chromium paginou.
   */
  private async mergeParts(
    contentPdf: Buffer,
    signaturesPdf: Buffer,
  ): Promise<{ pdf: Buffer; contentPages: number }> {
    const { PDFDocument } = await import('pdf-lib');

    const out = await PDFDocument.create();
    const contentDoc = await PDFDocument.load(contentPdf, { updateMetadata: false });
    const sigDoc = await PDFDocument.load(signaturesPdf, { updateMetadata: false });

    const contentPages = contentDoc.getPageCount();

    const copiedContent = await out.copyPages(contentDoc, contentDoc.getPageIndices());
    copiedContent.forEach(p => out.addPage(p));
    const copiedSig = await out.copyPages(sigDoc, sigDoc.getPageIndices());
    copiedSig.forEach(p => out.addPage(p));

    // Metadados fixos: nada de relógio dentro do artefato congelado.
    out.setProducer('ankaa-quote-renderer');
    out.setCreator('ankaa-quote-renderer');

    const bytes = await out.save({ useObjectStreams: false });
    return { pdf: Buffer.from(bytes), contentPages };
  }

  /**
   * Mede cada `[data-signature-slot]` no layout final.
   *
   * É isto que permite carimbar o selo exatamente acima da linha certa mais
   * tarde, preservando `final.pdf = original.pdf + sobreposição`. A alternativa —
   * re-renderizar o HTML com os selos já dentro — produziria um artefato final
   * que não é demonstravelmente o mesmo documento que foi assinado.
   */
  private async measureAnchors(page: import('playwright').Page): Promise<SignatureAnchorMap> {
    return (await page.evaluate(JS_MEASURE_ANCHORS)) as SignatureAnchorMap;
  }

  /**
   * Fixa as lacunas na PRIMEIRA folha, e descarta a que não couber nela.
   *
   * A frase do veículo abre o documento, então na prática toda lacuna está na
   * folha 1. Mas as medidas saem do layout CONTÍNUO do DOM e só coincidem com o
   * layout PAGINADO enquanto não houver quebra — a mesma premissa que o caminho
   * fundido verifica com `getPageCount() === 1`. Aqui a verificação é a altura:
   * passando da primeira folha útil, o retângulo medido não é o impresso, e
   * carimbar por ele acertaria o lugar errado da página errada.
   *
   * Descartar é seguro: sem lacuna registrada, o dado que chegar depois continua
   * indo para a trilha, como já vai hoje.
   */
  private resolveLateSlots(raw: LateSlotAnchorMap): LateSlotAnchorMap {
    // 275mm em px CSS — a mesma folha útil de `JS_CONTENT_PAGES`.
    const sheetHeightCss = 275 * (96 / 25.4);
    const out: LateSlotAnchorMap = {};
    for (const [key, slot] of Object.entries(raw)) {
      if (slot.y + slot.height > sheetHeightCss) {
        this.logger.warn(
          `Lacuna de cadastro tardio "${key}" caiu fora da primeira folha (y=${slot.y.toFixed(
            1,
          )}px) — não será carimbável.`,
        );
        continue;
      }
      out[key] = { ...slot, page: 0 };
    }
    return out;
  }

  private getFontDataUri(): string | null {
    if (this.fontDataUri !== undefined) return this.fontDataUri;
    const path = resolve(process.cwd(), 'assets', 'fonts', 'InterVariable.ttf');
    if (!existsSync(path)) {
      this.logger.error(
        `Fonte não encontrada em ${path} — o documento cairá numa fonte do sistema e a ` +
          'paginação deixará de ser reprodutível entre hosts.',
      );
      this.fontDataUri = null;
      return null;
    }
    this.fontDataUri = `data:font/truetype;base64,${readFileSync(path).toString('base64')}`;
    return this.fontDataUri;
  }

  private getLogoDataUri(): string | null {
    if (this.logoDataUri !== undefined) return this.logoDataUri;
    const path = resolve(process.cwd(), 'assets', 'logo.png');
    if (!existsSync(path)) {
      this.logger.warn(`Logo não encontrado em ${path} — usando fallback textual.`);
      this.logoDataUri = null;
      return null;
    }
    this.logoDataUri = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    return this.logoDataUri;
  }

  /**
   * Resolve a imagem de um arquivo de layout para data-URI.
   *
   * Layouts costumam ser EPS/PDF, que o Chromium não renderiza. Nesses casos usa-se
   * a miniatura já produzida pelo pipeline Ghostscript→pdftocairo→Sharp, escolhendo
   * a maior disponível. Ler do disco (e não via `/files/serve/:id`) evita depender
   * da própria API estar no ar durante o render e não expõe o arquivo na rede.
   */
  resolveLayoutImageDataUri(file: {
    path: string;
    mimetype: string;
    id: string;
  }): string | null {
    try {
      const isRasterImage =
        file.mimetype.startsWith('image/') &&
        !/eps|postscript|tiff/i.test(file.mimetype);

      if (isRasterImage && existsSync(file.path)) {
        return `data:${file.mimetype};base64,${readFileSync(file.path).toString('base64')}`;
      }

      const filesRoot = process.env.FILES_ROOT || './files';
      const thumbsRoot = join(resolve(process.cwd(), filesRoot), 'Thumbnails');
      if (!existsSync(thumbsRoot)) return null;

      // Diretórios são "{W}x{H}"; escolhe a maior largura disponível.
      const sizeDirs = readdirSync(thumbsRoot, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d+x\d+$/.test(d.name))
        .sort((a, b) => parseInt(b.name, 10) - parseInt(a.name, 10));

      for (const dir of sizeDirs) {
        const dirPath = join(thumbsRoot, dir.name);
        const match = readdirSync(dirPath).find(name => name.startsWith(`${file.id}_`));
        if (!match) continue;
        const ext = match.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        return `data:${mime};base64,${readFileSync(join(dirPath, match)).toString('base64')}`;
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Não foi possível resolver a imagem do layout ${file.id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return null;
    }
  }
}
