// api/src/modules/production/task-quote/task-quote-receipt.service.ts
//
// Gera o PDF do recibo de quitação (cupom) enviado ao cliente quando o
// orçamento chega a SETTLED. Renderiza com o Chromium do Playwright, no
// mesmo esquema de `quote-renderer.service.ts` (fallback pro chromium do
// Alpine em produção) — mas como um serviço próprio: aquele arquivo está em
// edição concorrente por outra sessão, e este documento não compartilha
// layout/regras com o orçamento assinado.

import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { COMPANY } from '@config/company';
import { TRUCK_CATEGORY_LABELS } from '@constants/enum-labels';
import { TASK_QUOTE_STATUS } from '@constants';
import {
  buildTaskQuoteReceiptHtml,
  formatDocument,
  TaskQuoteReceiptData,
} from './task-quote-receipt.builder';

export interface TaskQuoteReceiptResult {
  buffer: Buffer;
  filename: string;
}

const MM_PER_PX = 25.4 / 96;
const PAGE_WIDTH_MM = 80;

@Injectable()
export class TaskQuoteReceiptService {
  private readonly logger = new Logger(TaskQuoteReceiptService.name);
  private logoDataUri: string | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async generate(quoteId: string): Promise<TaskQuoteReceiptResult> {
    const quote = await this.prisma.taskQuote.findUnique({
      where: { id: quoteId },
      include: {
        task: { include: { customer: true, truck: true } },
        services: { orderBy: { position: 'asc' } },
        customerConfigs: { include: { customer: true, installments: true } },
      },
    });

    if (!quote) {
      throw new NotFoundException('Orçamento não encontrado.');
    }
    if (quote.status !== TASK_QUOTE_STATUS.SETTLED) {
      throw new BadRequestException(
        'O recibo só fica disponível depois que o orçamento é marcado como Liquidado.',
      );
    }

    const customer = quote.task?.customer ?? quote.customerConfigs[0]?.customer ?? null;
    const customerName = customer?.fantasyName ?? customer?.corporateName ?? 'Cliente';
    const customerDocument = formatDocument(customer?.cnpj ?? customer?.cpf ?? null);

    // Mesma regra de `invoice-generation.service.ts` (shouldGenerateNfse): a NFS-e só
    // sai quando `generateInvoice` não é explicitamente false na config do cliente.
    const primaryConfig =
      quote.customerConfigs.find(config => config.customerId === customer?.id) ??
      quote.customerConfigs[0] ??
      null;
    const nfseNoticeEnabled = primaryConfig ? primaryConfig.generateInvoice !== false : true;

    const truck = quote.task?.truck ?? null;
    const categoryLabel = truck?.category
      ? (TRUCK_CATEGORY_LABELS as Record<string, string>)[truck.category]
      : null;
    const vehicleParts = [quote.task?.name ?? categoryLabel, truck?.plate ?? null].filter(
      (part): part is string => Boolean(part),
    );
    const vehicleLabel = vehicleParts.length ? vehicleParts.join(' · ') : null;

    const paidDates = quote.customerConfigs
      .flatMap(config => config.installments)
      .map(installment => installment.paidAt)
      .filter((date): date is Date => date !== null);
    const settledAt = paidDates.length
      ? new Date(Math.max(...paidDates.map(d => d.getTime())))
      : quote.updatedAt;
    const settledAtLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(settledAt);

    const data: TaskQuoteReceiptData = {
      budgetNumber: quote.budgetNumber,
      settledAtLabel,
      customerName,
      customerDocument,
      vehicleLabel,
      services: quote.services.map(s => ({
        description: s.description,
        amount: Number(s.amount),
      })),
      total: Number(quote.total),
      nfseNoticeEnabled,
    };

    const html = buildTaskQuoteReceiptHtml(
      data,
      {
        name: COMPANY.name,
        corporateName: COMPANY.corporateName,
        cnpjFormatted: COMPANY.cnpjFormatted,
        addressShort: COMPANY.addressShort,
        phone: COMPANY.phone,
      },
      this.getLogoDataUri(),
    );

    const buffer = await this.renderPdf(html);
    return { buffer, filename: `recibo-orcamento-${quote.budgetNumber}.pdf` };
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.launchBrowser();
    try {
      const page = await browser.newPage({
        viewport: { width: Math.round(PAGE_WIDTH_MM / MM_PER_PX), height: 100 },
      });
      await page.setContent(html, { waitUntil: 'networkidle' });

      const contentHeightPx = await page.evaluate(() => {
        const roll = document.querySelector('.roll');
        return roll ? roll.getBoundingClientRect().height : document.body.scrollHeight;
      });
      const heightMm = Math.ceil(contentHeightPx * MM_PER_PX) + 2;

      const pdf = await page.pdf({
        width: `${PAGE_WIDTH_MM}mm`,
        height: `${heightMm}mm`,
        printBackground: true,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private async launchBrowser(): Promise<Browser> {
    // Mesma lógica do QuoteRendererService: a imagem de produção instala o
    // chromium do Alpine em /usr/bin/chromium e não roda `playwright install`.
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

  private getLogoDataUri(): string | null {
    if (this.logoDataUri !== undefined) return this.logoDataUri;
    const path = resolve(process.cwd(), 'assets', 'logo.png');
    if (!existsSync(path)) {
      this.logger.warn(`Logo não encontrada em ${path} — recibo será gerado sem logo.`);
      this.logoDataUri = null;
      return null;
    }
    this.logoDataUri = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    return this.logoDataUri;
  }
}
