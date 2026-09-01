/**
 * O cotador de layout, do lado do servidor.
 *
 * Ele vivia no navegador, e por isso existia duas vezes: o motor que a bancada
 * media (Node, sem recorte de tinta) e o motor que o operador usava (DOM, com
 * ele). Portar para o celular multiplicaria o problema por três — e a terceira
 * cópia seria em Dart, sem bancada de regressão, com os ~40 limiares da
 * doutrina calibrados de novo no braço.
 *
 * Aqui há UM motor. A web e o celular recebem os mesmos números porque são
 * literalmente os mesmos números: a mesma leitura do vetor, a mesma
 * rasterização (Skia via `@napi-rs/canvas`, o mesmo motor gráfico do Chrome), o
 * mesmo agrupamento, a mesma doutrina. A pergunta "por que o celular mostrou
 * outra medida?" deixa de ter onde nascer.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';

import { PrismaService } from '@modules/common/prisma/prisma.service';

import { buildLayoutFaces } from './engine/faces';
import { createPageInkTrimmer } from './engine/ink-probe';
import { readPageGeometry } from './engine/geometry';
import { panelWidthCm } from './engine/panel';
import type { PageGeometry, Panel, Pt } from './engine/types';
import type {
  LayoutDimensionsDto,
  LayoutFaceDto,
  LayoutItemDto,
  LayoutSnapDto,
} from './layout-dimensions.types';

/**
 * `pdfjs-dist` 5.x só publica ESM, e a API compila para CommonJS — o
 * TypeScript reescreveria um `await import(...)` como `require(...)` e o Node
 * recusaria o módulo. Passar pelo `Function` esconde o import do compilador e
 * preserva o `import()` de verdade.
 */
const esmImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

/** A MESMA versão que a bancada mediu. Ver `engine/DOUTRINA.md`. */
const PDFJS_ENTRY = 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Orçamento de pontos do contorno que viaja para o cliente.
 *
 * O mesmo número que o visualizador da web já usava para desenhar: acima disso
 * o traçado não fica mais fiel, só mais pesado — e a tolerância de dedo do
 * clique cobre com folga a diferença que a dizimação introduz.
 */
const OUTLINE_BUDGET = 3000;

/**
 * Teto de segmentos do ímã, e o critério de quem fica quando ele estoura.
 *
 * O pior arquivo do acervo tem 248 mil segmentos — 3,9 MB no fio para um
 * recurso que a maioria não toca. Mas cortar pelos PRIMEIROS 60 mil descarta a
 * arte pela ordem em que ela foi desenhada, que é arbitrária: o operador podia
 * abrir a régua justamente sobre o logotipo que ficou de fora.
 *
 * Quem fica são os MAIORES. Uma curva achatada vira dezenas de segmentos de
 * fração de milímetro — ruído para um dedo com 32 px de alcance —, enquanto a
 * borda do baú, a divisa de seção e o contorno do adesivo são longos. Ordenar
 * por comprimento e cortar embaixo tira exatamente o que não se consegue mirar.
 */
const SNAP_SEGMENT_CAP = 60000;

/**
 * O que este serviço custa ao processo, medido — para quem for investigar
 * latência não começar pelo lugar errado.
 *
 * Ler o arquivo, abrir o PDF, rasterizar a página e agrupar é tudo trabalho de
 * CPU, e o Node tem uma thread só: enquanto uma face é cotada, nenhuma outra
 * requisição anda. Medido de ponta a ponta com o processo quente:
 *
 * | arquivo                    | por requisição |
 * |----------------------------|----------------|
 * | GRESPAN 840 (típico)       | 181 ms         |
 * | MACHADÃO 790 (3 faces)     | 556 ms         |
 * | MAR & RIO 768 (o pior)     | 927 ms         |
 *
 * O agrupamento sozinho é a menor parte disso (62 ms de mediana no acervo); o
 * grosso é abrir e rasterizar. É custo de relatório, não de consulta — e o
 * `contourWorkBudget` do agrupamento é o que impede um desenho patológico de
 * passar do pior caso acima.
 *
 * Não há cache de propósito: o plano depende do arquivo E das medidas do
 * implemento, e uma medida corrigida tem de aparecer na hora. Guardar o
 * resultado trocaria segundos por um problema de invalidação — e é uma troca a
 * fazer com número de concorrência na mão, não por precaução.
 */
@Injectable()
export class LayoutDimensionsService implements OnModuleInit {
  private readonly logger = new Logger(LayoutDimensionsService.name);
  private pdfjs: any = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carrega o pdf.js no boot, e não no primeiro pedido.
   *
   * Ele só publica ESM e entra por import dinâmico; pago na primeira requisição,
   * o custo aparece como um layout que demorou a abrir logo depois do deploy —
   * exatamente quando alguém está olhando. Aqui ele some no tempo de subida.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.lib();
    } catch (error) {
      this.logger.warn(`pdf.js não carregou no boot: ${(error as Error)?.message}`);
    }
  }

  private async lib(): Promise<any> {
    if (!this.pdfjs) this.pdfjs = await esmImport(PDFJS_ENTRY);
    return this.pdfjs;
  }

  /**
   * As medidas do implemento, uma por face, na ORDEM das faces na página.
   *
   * De cima para baixo: motorista, sapo, traseira. As duas laterais têm o mesmo
   * tamanho em 92% dos arquivos, então é a ordem — não a geometria — que diz
   * qual é qual, e é por isso que a lista sai ordenada e não indexada por lado.
   *
   * ⚠️ `ImplementMeasure` guarda METRO. Todo o resto do cotador trabalha em
   * CENTÍMETRO real, e a conversão é aqui, uma vez só — era o ponto em que a
   * web e o celular podiam divergir sem que nada acusasse.
   */
  private async panelsForTruck(truckId: string): Promise<Panel[]> {
    const sections = { orderBy: { position: 'asc' as const } };
    const truck = await this.prisma.truck.findUnique({
      where: { id: truckId },
      select: {
        leftSideMeasure: { select: { height: true, sections } },
        rightSideMeasure: { select: { height: true, sections } },
        backSideMeasure: { select: { height: true, sections } },
      },
    });
    if (!truck) throw new NotFoundException('Caminhão não encontrado.');

    type Measure = {
      height: number;
      sections: { width: number; isDoor: boolean; doorHeight: number | null }[];
    };
    const toPanel = (side: Panel['side'], m: Measure | null): Panel | null => {
      if (!m?.sections?.length || !m.height) return null;
      return {
        side,
        heightCm: m.height * 100,
        sections: m.sections.map(s => ({
          widthCm: s.width * 100,
          isDoor: Boolean(s.isDoor),
          doorHeightCm: s.doorHeight ? s.doorHeight * 100 : null,
        })),
      };
    };
    return [
      toPanel('MOTORISTA', truck.leftSideMeasure as Measure | null),
      toPanel('SAPO', truck.rightSideMeasure as Measure | null),
      toPanel('TRASEIRA', truck.backSideMeasure as Measure | null),
    ].filter((p): p is Panel => p !== null);
  }

  /** O caminho do PDF em disco, já conferido. */
  private async pdfPath(fileId: string): Promise<string> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { path: true, mimetype: true, filename: true },
    });
    if (!file) throw new NotFoundException('Arquivo não encontrado.');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('O cotador só lê PDF vetorial.');
    }
    if (!file.path || !existsSync(file.path)) {
      throw new NotFoundException('O arquivo não está no armazenamento.');
    }
    return file.path;
  }

  private async openPage(path: string, pageNumber: number): Promise<{ doc: any; page: any }> {
    const pdfjs = await this.lib();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(path)),
      verbosity: 0,
    }).promise;
    if (pageNumber < 1 || pageNumber > doc.numPages) {
      await doc.destroy();
      throw new BadRequestException(`O arquivo tem ${doc.numPages} página(s).`);
    }
    return { doc, page: await doc.getPage(pageNumber) };
  }

  /**
   * Contorno enxuto para desenhar e clicar.
   *
   * Mesma dizimação que o visualizador fazia: acima do orçamento os polígonos
   * perdem pontos em passo constante, e as pontas ficam.
   */
  private decimate(polys: Pt[][]): Pt[][] {
    const total = polys.reduce((n, p) => n + p.length, 0);
    if (total <= OUTLINE_BUDGET) return polys;
    const stride = Math.ceil(total / OUTLINE_BUDGET);
    return polys.map(poly => {
      if (poly.length <= 8) return poly;
      const out: Pt[] = [];
      for (let i = 0; i < poly.length; i += stride) out.push(poly[i]);
      const last = poly[poly.length - 1];
      if (out[out.length - 1] !== last) out.push(last);
      return out;
    });
  }

  /** O plano de cotas do arquivo, pronto para desenhar. */
  async dimensions(
    fileId: string,
    options: { truckId: string; pageNumber?: number; rotation?: number },
  ): Promise<LayoutDimensionsDto> {
    const pageNumber = options.pageNumber ?? 1;
    const rotation = options.rotation ?? 0;
    const [panels, path] = await Promise.all([
      this.panelsForTruck(options.truckId),
      this.pdfPath(fileId),
    ]);

    const { doc, page } = await this.openPage(path, pageNumber);
    try {
      const trimToInk = await createPageInkTrimmer(page, 0.5, rotation);
      if (!trimToInk) {
        // O recorte falha em SILÊNCIO por desenho: `createPageInkTrimmer`
        // engole a exceção e devolve `undefined`, e o agrupamento simplesmente
        // volta a decidir pela moldura declarada da imagem. Ninguém vê erro —
        // o que se vê é cota ancorada na folga transparente, meses depois,
        // sem ninguém saber por quê. Se esta linha aparecer no log, o canvas
        // nativo não subiu, e é ISSO que tem de ser consertado.
        this.logger.warn(
          `Recorte de tinta indisponível para o arquivo ${fileId}: o agrupamento vai decidir pela moldura declarada das imagens.`,
        );
      }
      const result = await buildLayoutFaces(page, panels, { rotation, trimToInk });

      const faces: LayoutFaceDto[] = result.faces.map(f => ({
        index: f.index,
        side: f.side,
        widthCm: panelWidthCm(f.panel),
        heightCm: f.panel.heightCm,
        ptPerCm: f.scale.ptPerCm,
        panelPt: f.scale.panelPt,
        aspectErrorPct: f.aspectErrorPct,
        unusable: f.unusable,
      }));
      const items: LayoutItemDto[] = result.items.map(i => ({
        index: i.index,
        faceIndex: i.faceIndex,
        kind: i.kind,
        side: i.side,
        bbox: i.bbox,
        alignedBoxPt: i.alignedBoxPt,
        outlinePt: i.outlinePt ? this.decimate(i.outlinePt) : undefined,
        widthCm: i.widthCm,
        heightCm: i.heightCm,
      }));

      return {
        pageWidthPt: result.geometry.width,
        pageHeightPt: result.geometry.height,
        pageNumber,
        rotation,
        detectedScale: result.detectedScale,
        faces,
        items,
        dimensions: result.dimensions,
        warnings: result.warnings,
      };
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  }

  /**
   * As retas do desenho, para o ímã da medição manual.
   *
   * Sai num pedido próprio: é o pedaço grande, e só quem pega a régua precisa
   * dele. Vão as arestas de todo caminho mais a moldura de cada objeto — as
   * mesmas que o `SnapIndex` indexava no navegador —, achatadas em quatro
   * números por segmento.
   */
  async snapSegments(
    fileId: string,
    options: { pageNumber?: number; rotation?: number } = {},
  ): Promise<LayoutSnapDto> {
    const pageNumber = options.pageNumber ?? 1;
    const rotation = options.rotation ?? 0;
    const path = await this.pdfPath(fileId);
    const { doc, page } = await this.openPage(path, pageNumber);
    try {
      const geometry: PageGeometry = await readPageGeometry(page, { rotation });
      const raw: { a: number; b: number; c: number; d: number; len: number }[] = [];
      const push = (ax: number, ay: number, bx: number, by: number) => {
        raw.push({
          a: ax,
          b: ay,
          c: bx,
          d: by,
          len: Math.hypot(bx - ax, by - ay),
        });
      };
      const pushRect = (r: { x0: number; y0: number; x1: number; y1: number }) => {
        push(r.x0, r.y0, r.x1, r.y0);
        push(r.x1, r.y0, r.x1, r.y1);
        push(r.x1, r.y1, r.x0, r.y1);
        push(r.x0, r.y1, r.x0, r.y0);
      };
      for (const obj of geometry.objects) {
        if (obj.op === 'clip') continue;
        if (obj.op === 'image') {
          pushRect(obj.bbox);
          continue;
        }
        for (const poly of obj.outline) {
          for (let i = 0; i + 1 < poly.length; i += 1) {
            push(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y);
          }
        }
        pushRect(obj.bbox);
      }
      const total = raw.length;
      if (total > SNAP_SEGMENT_CAP) {
        raw.sort((p, q) => q.len - p.len);
        raw.length = SNAP_SEGMENT_CAP;
      }
      const segments: number[] = [];
      for (const s of raw) {
        // 0,01 pt é 3,5 µm no papel: a quantização some no ruído do dedo e
        // corta pela metade os bytes que atravessam a rede.
        segments.push(
          Math.round(s.a * 100) / 100,
          Math.round(s.b * 100) / 100,
          Math.round(s.c * 100) / 100,
          Math.round(s.d * 100) / 100,
        );
      }
      return {
        pageWidthPt: geometry.width,
        pageHeightPt: geometry.height,
        segments,
        totalSegments: total,
      };
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  }
}
