import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { chromium } from 'playwright';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { IppClient, IppError, type IppOutValue } from './ipp-client';
import { TaskLabelSheetStore } from './task-label-sheet.store';
import {
  LABEL_SLOTS,
  taskLabelCaption,
  taskLabelSheetHtml,
  taskLabelSheetSvg,
  type PlacedLabel,
} from './task-label-sheet';

const execFileAsync = promisify(execFile);

// Truck-body label sheets go straight from the server to the office Epson (L3250) over IPP, with
// the settings validated on the real printer: glossy photo paper, high quality, 100% scale, colour.
// The printer is driverless-only on the network: it takes PWG raster (not PDF) at 360 dpi, so the
// sheet is rendered to PDF with Chromium and rasterised with Ghostscript before it is sent.

/** ipps://<printer>/ipp/print — the printer only answers IPP over TLS. Give it a DHCP reservation. */
const PRINTER_URI = process.env.LABEL_PRINTER_URI || 'ipps://192.168.10.121:631/ipp/print';
const GHOSTSCRIPT = process.env.GHOSTSCRIPT_PATH || 'gs';
const RASTER_DPI = 360; // the only pwg-raster-document-resolution the L3250 accepts

const JOB_STATE = {
  3: 'pending',
  4: 'held',
  5: 'processing',
  6: 'stopped',
  7: 'canceled',
  8: 'aborted',
  9: 'completed',
} as const;
type JobState = (typeof JOB_STATE)[keyof typeof JOB_STATE] | 'unknown';

// printer-state-reasons → what to tell the person at the printer; `blocking` stops a new print
const REASONS: { match: RegExp; message: string; blocking: boolean }[] = [
  { match: /^(media-empty|media-needed)/, message: 'Sem papel na bandeja.', blocking: true },
  { match: /^media-jam/, message: 'Papel atolado.', blocking: true },
  {
    match: /^(door-open|cover-open|interlock-open)/,
    message: 'Tampa da impressora aberta.',
    blocking: true,
  },
  { match: /^marker-supply-empty/, message: 'Acabou a tinta.', blocking: true },
  {
    match: /^marker-waste-full/,
    message: 'Almofada de tinta cheia — precisa de manutenção.',
    blocking: true,
  },
  {
    match: /^(offline|shutdown|connecting-to-device)/,
    message: 'Impressora desligada ou desconectada.',
    blocking: true,
  },
  { match: /^(paused|moving-to-paused)/, message: 'Impressora pausada.', blocking: true },
  { match: /^spool-area-full/, message: 'Fila da impressora cheia.', blocking: true },
  { match: /^marker-supply-low/, message: 'Tinta baixa.', blocking: false },
  {
    match: /^marker-waste-almost-full/,
    message: 'Almofada de tinta quase cheia.',
    blocking: false,
  },
  { match: /^media-low/, message: 'Pouco papel na bandeja.', blocking: false },
];

export interface LabelPrinterStatus {
  /** reachable and able to take a sheet right now */
  ready: boolean;
  state: 'idle' | 'processing' | 'stopped' | 'unreachable';
  model: string | null;
  /** pt-BR, already translated from the printer's reasons */
  messages: string[];
}

export interface LabelPrintJobStatus {
  jobId: number;
  state: JobState;
  done: boolean;
  success: boolean;
  messages: string[];
}

const PRINT_SETTINGS: Record<string, IppOutValue | IppOutValue[]> = {
  'media-col': {
    tag: 'collection',
    value: {
      'media-size': {
        tag: 'collection',
        value: {
          'x-dimension': { tag: 'integer', value: 21000 },
          'y-dimension': { tag: 'integer', value: 29700 },
        },
      },
      'media-type': { tag: 'keyword', value: 'photographic-glossy' },
      'media-source': { tag: 'keyword', value: 'main' },
      // the sheet keeps ≥ 6 mm clear of every edge, so the standard 3 mm margins never clip it
      'media-top-margin': { tag: 'integer', value: 300 },
      'media-bottom-margin': { tag: 'integer', value: 300 },
      'media-left-margin': { tag: 'integer', value: 300 },
      'media-right-margin': { tag: 'integer', value: 300 },
    },
  },
  'print-quality': { tag: 'enum', value: 5 }, // high — the printer only allows it on photo media
  'print-scaling': { tag: 'keyword', value: 'none' }, // 100%: the ScanNCut needs true millimetres
  'print-color-mode': { tag: 'keyword', value: 'color' },
};

function translateReasons(reasons: unknown[] | undefined): {
  messages: string[];
  blocking: boolean;
} {
  const messages: string[] = [];
  let blocking = false;
  for (const raw of reasons ?? []) {
    const reason = String(raw).replace(/-(report|warning|error)$/, '');
    if (reason === 'none') continue;
    const known = REASONS.find(r => r.match.test(reason));
    if (known) {
      if (!messages.includes(known.message)) messages.push(known.message);
      blocking ||= known.blocking;
    }
  }
  return { messages, blocking };
}

@Injectable()
export class TaskLabelPrinterService {
  private readonly logger = new Logger(TaskLabelPrinterService.name);
  private readonly client = new IppClient({ printerUri: PRINTER_URI, timeoutMs: 15_000 });
  /** one sheet at a time: two people printing at once would race for the same paper */
  private busy = false;
  /** slots each accepted job claimed, so a job the printer aborts gives them back */
  private readonly jobSlots = new Map<number, { sheetId: string; slots: number[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheet: TaskLabelSheetStore,
  ) {}

  async getStatus(): Promise<LabelPrinterStatus> {
    try {
      const res = await this.client.getPrinterAttributes([
        'printer-state',
        'printer-state-reasons',
        'printer-is-accepting-jobs',
        'printer-make-and-model',
      ]);
      const state = Number(res.printer['printer-state']?.[0]);
      const accepting = res.printer['printer-is-accepting-jobs']?.[0] !== false;
      const { messages, blocking } = translateReasons(res.printer['printer-state-reasons']);
      if (!accepting) messages.push('A impressora não está aceitando trabalhos.');
      return {
        // processing is fine (the printer queues the sheet); stopped or a blocking reason is not
        ready: accepting && state !== 5 && !blocking,
        state: state === 3 ? 'idle' : state === 4 ? 'processing' : 'stopped',
        model: (res.printer['printer-make-and-model']?.[0] as string) ?? null,
        messages,
      };
    } catch (e) {
      const message =
        e instanceof IppError ? e.message : 'Não foi possível consultar a impressora.';
      this.logger.warn(`printer status: ${(e as Error).message}`);
      return { ready: false, state: 'unreachable', model: null, messages: [message] };
    }
  }

  async print(labels: { slot: number; taskId: string }[]): Promise<{ jobId: number }> {
    const slots = new Set(labels.map(l => l.slot));
    if (slots.size !== labels.length)
      throw new BadRequestException('Há dois cartões no mesmo espaço da folha.');
    if (labels.some(l => !LABEL_SLOTS[l.slot]))
      throw new BadRequestException('Espaço da folha inválido.');

    const taskIds = [...new Set(labels.map(l => l.taskId))];
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, name: true, serialNumber: true, truck: { select: { plate: true } } },
    });
    const byId = new Map(tasks.map(t => [t.id, t]));
    const missing = taskIds.filter(id => !byId.has(id));
    if (missing.length)
      throw new NotFoundException(
        'Uma das tarefas não foi encontrada. Atualize a página e tente de novo.',
      );

    if (this.busy)
      throw new ConflictException(
        'Já há uma folha de etiquetas sendo enviada. Aguarde ela terminar.',
      );
    this.busy = true;
    try {
      const status = await this.getStatus();
      if (!status.ready) {
        throw new ServiceUnavailableException(
          status.state === 'unreachable'
            ? status.messages[0]
            : `Impressora indisponível: ${status.messages.join(' ') || 'verifique o painel da impressora.'}`,
        );
      }

      // claim the slots on the shared sheet BEFORE printing, so a second user can't pick them meanwhile
      const { state: sheet, isFreshSheet } = await this.sheet.claim(
        labels.map(l => l.slot),
        taken =>
          new ConflictException(
            `O${taken.length > 1 ? 's espaços' : ' espaço'} ${taken.map(s => s + 1).join(', ')} já ${taken.length > 1 ? 'foram impressos' : 'foi impresso'} nesta folha. Atualize e escolha outros.`,
          ),
      );
      const claimed = labels.map(l => l.slot);

      const placed: PlacedLabel[] = labels.map(l => {
        const t = byId.get(l.taskId)!;
        return {
          slot: l.slot,
          taskId: t.id,
          caption: taskLabelCaption(t.name ?? 'Tarefa', t.serialNumber || t.truck?.plate || null),
        };
      });

      let jobId: number;
      try {
        // the first print on a fresh sheet carries the "TOPO" mark: the sheet always goes back in that way
        const raster = await this.renderRaster(placed, isFreshSheet);
        const res = await this.client.printJob(
          raster,
          {
            'job-name': { tag: 'name', value: `Etiquetas (${placed.length})` },
            'document-format': { tag: 'mimeMediaType', value: 'image/pwg-raster' },
            // refuse instead of silently printing on plain paper / draft if a setting is dropped
            'ipp-attribute-fidelity': { tag: 'boolean', value: true },
          },
          PRINT_SETTINGS,
        );
        jobId = Number(res.job['job-id']?.[0]);
      } catch (e) {
        // nothing reached the paper: the slots are free again
        await this.sheet.release(claimed, sheet.sheetId);
        throw e;
      }
      if (!Number.isFinite(jobId))
        throw new ServiceUnavailableException(
          'A impressora aceitou a folha mas não devolveu o número do trabalho.',
        );
      this.jobSlots.set(jobId, { sheetId: sheet.sheetId, slots: claimed });
      this.logger.log(
        `label sheet sent: job ${jobId}, ${placed.length} labels${isFreshSheet ? ' (new sheet)' : ''}`,
      );
      return { jobId };
    } catch (e) {
      if (e instanceof IppError) {
        this.logger.warn(`print failed: ${e.message}`);
        throw new ServiceUnavailableException(e.message);
      }
      throw e;
    } finally {
      this.busy = false;
    }
  }

  async getJob(jobId: number): Promise<LabelPrintJobStatus> {
    try {
      const res = await this.client.getJobAttributes(jobId);
      const code = Number(res.job['job-state']?.[0]) as keyof typeof JOB_STATE;
      const state: JobState = JOB_STATE[code] ?? 'unknown';
      const done = state === 'completed' || state === 'canceled' || state === 'aborted';
      const messages: string[] = [];
      if (state === 'stopped' || state === 'held' || state === 'aborted') {
        // a stopped job says why through the printer's own reasons (paper, ink, cover…)
        const printer = await this.getStatus();
        messages.push(...printer.messages);
      }
      if (state === 'canceled') messages.push('O trabalho foi cancelado na impressora.');
      if (state === 'aborted' && !messages.length)
        messages.push('A impressora interrompeu o trabalho.');
      if (done) {
        const claimed = this.jobSlots.get(jobId);
        this.jobSlots.delete(jobId);
        // canceled/aborted before printing: hand the slots back to the shared sheet
        if (claimed && state !== 'completed') {
          await this.sheet.release(claimed.slots, claimed.sheetId);
          messages.push('Os espaços voltaram a ficar livres.');
        }
      }
      return { jobId, state, done, success: state === 'completed', messages };
    } catch (e) {
      if (e instanceof IppError && e.statusCode === 0x0406) {
        // the printer forgets finished jobs after a while
        throw new NotFoundException('A impressora não tem mais esse trabalho na memória.');
      }
      throw new ServiceUnavailableException(
        e instanceof IppError ? e.message : 'Não foi possível consultar o trabalho.',
      );
    }
  }

  /** Sheet → A4 PDF (Chromium) → PWG raster (Ghostscript), in a private temp dir. */
  private async renderRaster(labels: PlacedLabel[], orientationMark = false): Promise<Buffer> {
    const logo = await fs.readFile(resolve(process.cwd(), 'assets', 'logo.png'));
    const html = taskLabelSheetHtml(
      taskLabelSheetSvg(labels, `data:image/png;base64,${logo.toString('base64')}`, {
        orientationMark,
      }),
    );

    const dir = await fs.mkdtemp(join(tmpdir(), 'task-labels-'));
    const pdfPath = join(dir, 'sheet.pdf');
    const rasterPath = join(dir, 'sheet.pwg');
    try {
      const browser = await chromium
        .launch({
          headless: false,
          timeout: 60_000,
          args: [
            '--headless=new',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        })
        .catch((e: Error) => {
          this.logger.error(`chromium launch: ${e.message}`);
          throw new ServiceUnavailableException(
            'Não foi possível gerar a folha (navegador do servidor indisponível).',
          );
        });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
        // remote font: wait for it, but never hang the print on it (falls back to Helvetica)
        await page.evaluate(() =>
          Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 4000))]),
        );
        await page.pdf({
          path: pdfPath,
          width: '210mm',
          height: '297mm',
          printBackground: true,
          pageRanges: '1',
        });
      } finally {
        await browser.close().catch(() => undefined);
      }

      await execFileAsync(
        GHOSTSCRIPT,
        [
          '-q',
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-dFirstPage=1',
          '-dLastPage=1',
          '-sDEVICE=pwgraster',
          `-r${RASTER_DPI}`,
          '-dcupsColorSpace=19', // sRGB
          '-dcupsBitsPerColor=8',
          `-sOutputFile=${rasterPath}`,
          pdfPath,
        ],
        { timeout: 60_000 },
      ).catch((e: NodeJS.ErrnoException) => {
        this.logger.error(`ghostscript: ${e.message}`);
        throw new ServiceUnavailableException(
          e.code === 'ENOENT'
            ? 'Ghostscript não está instalado no servidor.'
            : 'Não foi possível converter a folha para a impressora.',
        );
      });
      return await fs.readFile(rasterPath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
