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

export interface RenderedQuoteDocument {
  pdf: Buffer;
  anchors: SignatureAnchorMap;
  /** Quantas iterações de ajuste foram necessárias (0 = coube de primeira). */
  fitIterations: number;
  /** True quando o conteúdo ainda excedia a página após o último ajuste. */
  overflowed: boolean;
  /** Quantas folhas o corpo do orçamento consumiu (a de assinaturas é a seguinte). */
  contentPages: number;
}

const MAX_FIT_ITERATIONS = 12;

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

const JS_FONTS_READY = `(() => (document.fonts ? document.fonts.ready.then(() => true) : true))()`;

@Injectable()
export class QuoteRendererService {
  private readonly logger = new Logger(QuoteRendererService.name);

  private fontDataUri: string | null | undefined;
  private logoDataUri: string | null | undefined;

  async render(input: Omit<QuoteHtmlInput, 'fontDataUri' | 'logoDataUri'>): Promise<RenderedQuoteDocument> {
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
    const hasLayout = htmlInput.layoutImages.length > 0;

    // Lançamento por render. Renders são raros (um por envelope + um por
    // montagem final) e uma instância de longa duração acumula estado e morre em
    // silêncio; ~500ms de startup é um preço barato por previsibilidade.
    const browser = await this.launchBrowser();

    try {
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
      // Só quando NÃO há imagem de layout. Com layout, a arte e as assinaturas
      // dividem a última folha — que é o arranjo desejado: a arte é o que o
      // cliente está aprovando e fica à vista de quem assina, no tamanho em que
      // dá para conferi-la. Espremê-la para caber junto do contrato (o piso é
      // 30mm, tamanho de selo postal) trocaria a folha a mais por uma miniatura.
      //
      // Sem layout não existe esse dilema: cabendo, tudo vai para uma folha só, e
      // é o que o `compactContent(page, true)` de `tryFusedRender` persegue —
      // antes ele mirava o número de folhas da altura NATURAL e chegava a CRESCER
      // a tipografia para preencher duas.
      if (!hasLayout) {
        const fusedAttempt = await this.tryFusedRender(browser, html.fused);
        if (fusedAttempt) {
          return fusedAttempt;
        }
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

      return { pdf, anchors: resolved, fitIterations: iterations, overflowed, contentPages };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Renderiza conteúdo + assinaturas juntos e só aceita se couber em uma folha.
   * Devolve null quando não couber — o chamador então usa o caminho de 2 partes.
   */
  private async tryFusedRender(
    browser: Browser,
    fusedHtml: string,
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
      const pdf = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true }));

      const { PDFDocument } = await import('pdf-lib');
      const pageCount = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();

      if (pageCount !== 1 || Object.keys(anchors).length === 0) return null;

      const resolved: SignatureAnchorMap = {};
      for (const [id, a] of Object.entries(anchors)) resolved[id] = { ...a, page: 0 };

      this.logger.log(
        `Orçamento e assinaturas couberam em uma folha (layout fundido, ${fuseIterations} passo(s) de sacrifício).`,
      );
      return { pdf, anchors: resolved, fitIterations: fuseIterations, overflowed: false, contentPages: 1 };
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
