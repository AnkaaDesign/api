// fispq-document.service.ts
// Geradores de documento para o módulo FISPQ / FDS:
//   - generateInventoryPdf: inventário de produtos químicos (todos os itens com FDS)
//   - generateInventoryXlsx: o mesmo inventário em Excel
//   - generateItemReportPdf: ficha de referência rápida por item (identificação +
//     perigos + primeiros socorros + combate a incêndio + EPI)
//
// PDF segue o template visual do PpeDocumentService (pdfkit + design system Ankaa).
// XLSX segue o NotificationExportService.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import {
  GHS_PICTOGRAM_LABELS,
  GHS_SIGNAL_WORD_LABELS,
  FISPQ_STATUS_LABELS,
} from '@constants';

const COMPANY_INFO = {
  name: 'Ankaa Design',
  address: 'Rua Luís Carlos Zani, 2493 - Santa Paula, Ibiporã-PR',
  phone: '(43) 9 8428-3228',
  website: 'ankaadesign.com.br',
};

const COLORS = {
  primary: '#0a5c1e',
  text: '#1a1a1a',
  gray: '#666666',
  lightGray: '#e5e5e5',
  white: '#ffffff',
  tableHeader: '#0a5c1e',
  tableAlt: '#f9f9f9',
  danger: '#b91c1c',
};

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
};

const LAYOUT = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  marginTop: 24,
  marginBottom: 24,
  marginLeft: 35,
  marginRight: 35,
};

@Injectable()
export class FispqDocumentService {
  private readonly logger = new Logger(FispqDocumentService.name);
  private logoBuffer: Buffer | null = null;

  constructor(private readonly prisma: PrismaService) {
    this.loadLogo();
  }

  private loadLogo(): void {
    const logoPath = join(process.cwd(), 'assets', 'logo.png');
    if (existsSync(logoPath)) {
      this.logoBuffer = readFileSync(logoPath);
    }
  }

  private pictogramLabel(p: string): string {
    return (GHS_PICTOGRAM_LABELS as Record<string, string>)[p] || p;
  }

  private signalWordLabel(w: string | null): string {
    if (!w) return '—';
    return (GHS_SIGNAL_WORD_LABELS as Record<string, string>)[w] || w;
  }

  private statusLabel(s: string): string {
    return (FISPQ_STATUS_LABELS as Record<string, string>)[s] || s;
  }

  private fmtDate(d: Date | null | undefined): string {
    if (!d) return '—';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('pt-BR');
  }

  // =====================
  // Inventory PDF
  // =====================

  /**
   * Inventário de produtos químicos (todos os itens com FDS): nome, CAS, ONU,
   * pictogramas, palavra de advertência, EPI requerido, status da FDS, validade.
   */
  async generateInventoryPdf(where: any = {}): Promise<Buffer> {
    const fispqs = await this.prisma.fispq.findMany({
      where,
      include: { item: true, requiredPpeItems: { select: { name: true } } },
      orderBy: { item: { name: 'asc' } },
    });

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margins: {
            top: LAYOUT.marginTop,
            bottom: LAYOUT.marginBottom,
            left: LAYOUT.marginLeft,
            right: LAYOUT.marginRight,
          },
        });

        // In landscape, swap content width to the longer dimension.
        const landscapeWidth = LAYOUT.pageHeight - LAYOUT.marginLeft - LAYOUT.marginRight;

        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let y = LAYOUT.marginTop;

        // Header
        const logoHeight = 40;
        if (this.logoBuffer) {
          doc.image(this.logoBuffer, LAYOUT.marginLeft, y, { height: logoHeight });
        } else {
          doc.font(FONTS.bold).fontSize(16).fillColor(COLORS.primary);
          doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, y + 12);
        }
        doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.text);
        doc.text('INVENTÁRIO DE PRODUTOS QUÍMICOS (FISPQ/FDS)', LAYOUT.marginLeft + 150, y + 8, {
          width: landscapeWidth - 150,
          align: 'right',
        });
        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
        doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, LAYOUT.marginLeft + 150, y + 26, {
          width: landscapeWidth - 150,
          align: 'right',
        });

        y += logoHeight + 10;
        const grad = doc.linearGradient(LAYOUT.marginLeft, y, LAYOUT.marginLeft + landscapeWidth, y);
        grad.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, y, landscapeWidth, 1.5).fill(grad);
        y += 18;

        // Table
        const headers = ['Produto', 'CAS', 'ONU', 'Advertência', 'EPI requerido', 'Status', 'Validade'];
        const colWidths = [
          landscapeWidth * 0.26,
          landscapeWidth * 0.12,
          landscapeWidth * 0.08,
          landscapeWidth * 0.13,
          landscapeWidth * 0.21,
          landscapeWidth * 0.1,
          landscapeWidth * 0.1,
        ];
        const headerHeight = 20;

        const drawHeader = () => {
          doc.rect(LAYOUT.marginLeft, y, landscapeWidth, headerHeight).fill(COLORS.tableHeader);
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.white);
          let cx = LAYOUT.marginLeft + 6;
          headers.forEach((h, i) => {
            doc.text(h, cx, y + 6, { width: colWidths[i] - 10 });
            cx += colWidths[i];
          });
          y += headerHeight;
        };

        drawHeader();

        if (fispqs.length === 0) {
          doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
          doc.text('Nenhum produto químico com FDS cadastrado.', LAYOUT.marginLeft + 6, y + 8);
        }

        const rowHeight = 22;
        fispqs.forEach((f, index) => {
          if (y + rowHeight > LAYOUT.pageWidth - LAYOUT.marginBottom - 10) {
            doc.addPage({ layout: 'landscape' });
            y = LAYOUT.marginTop;
            drawHeader();
          }
          if (index % 2 === 1) {
            doc.rect(LAYOUT.marginLeft, y, landscapeWidth, rowHeight).fill(COLORS.tableAlt);
          }
          const ppe = (f.requiredPpeItems || []).map(p => p.name).join(', ') || (f.requiredPpeText || '—');
          const cells = [
            f.item?.name || f.productName || '—',
            f.casNumber || '—',
            f.onuNumber || '—',
            this.signalWordLabel(f.signalWord),
            ppe,
            this.statusLabel(f.status),
            this.fmtDate(f.validUntil),
          ];
          doc.font(FONTS.regular).fontSize(7.5);
          let cx = LAYOUT.marginLeft + 6;
          cells.forEach((c, i) => {
            const isStatus = i === 5;
            const expired = f.status === 'EXPIRED' || f.status === 'DRAFT';
            doc.fillColor(isStatus && expired ? COLORS.danger : COLORS.text);
            doc.text(String(c), cx, y + 6, { width: colWidths[i] - 10, height: rowHeight - 8, ellipsis: true });
            cx += colWidths[i];
          });
          y += rowHeight;
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // =====================
  // Inventory XLSX
  // =====================

  async generateInventoryXlsx(where: any = {}): Promise<Buffer> {
    const fispqs = await this.prisma.fispq.findMany({
      where,
      include: { item: true, requiredPpeItems: { select: { name: true } } },
      orderBy: { item: { name: 'asc' } },
    });

    const rows = fispqs.map(f => ({
      Produto: f.item?.name || f.productName || '',
      Fabricante: f.manufacturer || '',
      CAS: f.casNumber || '',
      ONU: f.onuNumber || '',
      'Classe de risco': f.unRiskClass || '',
      'Grupo embalagem': f.packingGroup || '',
      Pictogramas: (f.ghsPictograms || []).map(p => this.pictogramLabel(p)).join('; '),
      Advertência: this.signalWordLabel(f.signalWord),
      'Frases H': (f.hazardStatements || []).join('; '),
      'Frases P': (f.precautionStatements || []).join('; '),
      'EPI requerido':
        (f.requiredPpeItems || []).map(p => p.name).join('; ') || f.requiredPpeText || '',
      Status: this.statusLabel(f.status),
      Revisão: f.revisionNumber || '',
      Emissão: f.issueDate ? this.fmtDate(f.issueDate) : '',
      'Última revisão': f.revisionDate ? this.fmtDate(f.revisionDate) : '',
      Validade: f.validUntil ? this.fmtDate(f.validUntil) : '',
      'Possui PDF': f.pdfFileId ? 'Sim' : 'Não',
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 30 },
      { wch: 22 },
      { wch: 14 },
      { wch: 10 },
      { wch: 16 },
      { wch: 14 },
      { wch: 30 },
      { wch: 12 },
      { wch: 40 },
      { wch: 40 },
      { wch: 30 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'FISPQ');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
  }

  // =====================
  // Per-item report PDF
  // =====================

  /**
   * Ficha de referência rápida da FDS de um item: identificação + perigos +
   * primeiros socorros + combate a incêndio + EPI.
   */
  async generateItemReportPdf(fispqId: string): Promise<Buffer> {
    const fispq = await this.prisma.fispq.findUnique({
      where: { id: fispqId },
      include: { item: true, requiredPpeItems: { select: { name: true, ppeCA: true } } },
    });

    if (!fispq) {
      throw new NotFoundException('FISPQ não encontrada.');
    }

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: LAYOUT.marginTop,
            bottom: LAYOUT.marginBottom,
            left: LAYOUT.marginLeft,
            right: LAYOUT.marginRight,
          },
        });

        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let y = LAYOUT.marginTop;

        // Header
        const logoHeight = 46;
        if (this.logoBuffer) {
          doc.image(this.logoBuffer, LAYOUT.marginLeft, y, { height: logoHeight });
        } else {
          doc.font(FONTS.bold).fontSize(16).fillColor(COLORS.primary);
          doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, y + 12);
        }
        doc.font(FONTS.bold).fontSize(12).fillColor(COLORS.text);
        doc.text('FICHA DE DADOS DE SEGURANÇA (FDS)', LAYOUT.marginLeft + 150, y + 8, {
          width: contentWidth - 150,
          align: 'right',
        });
        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
        doc.text(
          `Status: ${this.statusLabel(fispq.status)} · Validade: ${this.fmtDate(fispq.validUntil)}`,
          LAYOUT.marginLeft + 150,
          y + 24,
          { width: contentWidth - 150, align: 'right' },
        );

        y += logoHeight + 10;
        const grad = doc.linearGradient(LAYOUT.marginLeft, y, LAYOUT.marginLeft + contentWidth, y);
        grad.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, y, contentWidth, 1.5).fill(grad);
        y += 20;

        const sectionTitle = (title: string) => {
          if (y > LAYOUT.pageHeight - LAYOUT.marginBottom - 60) {
            doc.addPage();
            y = LAYOUT.marginTop;
          }
          doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
          doc.text(title, LAYOUT.marginLeft, y);
          y += 16;
        };

        const kv = (label: string, value: string | null | undefined) => {
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
          doc.text(label, LAYOUT.marginLeft, y, { width: 130, continued: false });
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          doc.text(value || '—', LAYOUT.marginLeft + 130, y, { width: contentWidth - 130 });
          y += Math.max(
            14,
            doc.heightOfString(value || '—', { width: contentWidth - 130 }) + 2,
          );
        };

        const paragraph = (text: string | null | undefined) => {
          const body = text && text.trim() ? text : 'Não informado.';
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          const h = doc.heightOfString(body, { width: contentWidth, align: 'justify' });
          if (y + h > LAYOUT.pageHeight - LAYOUT.marginBottom - 20) {
            doc.addPage();
            y = LAYOUT.marginTop;
          }
          doc.text(body, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
          y += h + 10;
        };

        // Section 1 — identificação
        sectionTitle('1. Identificação');
        kv('Produto:', fispq.item?.name || fispq.productName);
        kv('Fabricante:', fispq.manufacturer);
        kv('Fornecedor:', fispq.supplierName);
        kv('Uso recomendado:', fispq.recommendedUse);
        kv('Telefone de emergência:', fispq.emergencyPhone);
        kv('Nº CAS:', fispq.casNumber);
        kv('Nº ONU:', fispq.onuNumber);
        kv('Classe de risco (transporte):', fispq.unRiskClass);
        kv('Grupo de embalagem:', fispq.packingGroup);
        y += 6;

        // Section 2 — perigos
        sectionTitle('2. Identificação de perigos (GHS)');
        kv('Palavra de advertência:', this.signalWordLabel(fispq.signalWord));
        kv(
          'Pictogramas:',
          (fispq.ghsPictograms || []).map(p => this.pictogramLabel(p)).join(', ') || null,
        );
        if (fispq.hazardStatements && fispq.hazardStatements.length) {
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
          doc.text('Frases de perigo (H):', LAYOUT.marginLeft, y);
          y += 12;
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          for (const h of fispq.hazardStatements) {
            doc.text(`• ${h}`, LAYOUT.marginLeft + 8, y, { width: contentWidth - 8 });
            y += doc.heightOfString(`• ${h}`, { width: contentWidth - 8 }) + 2;
          }
        }
        if (fispq.precautionStatements && fispq.precautionStatements.length) {
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
          doc.text('Frases de precaução (P):', LAYOUT.marginLeft, y);
          y += 12;
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          for (const p of fispq.precautionStatements) {
            doc.text(`• ${p}`, LAYOUT.marginLeft + 8, y, { width: contentWidth - 8 });
            y += doc.heightOfString(`• ${p}`, { width: contentWidth - 8 }) + 2;
          }
        }
        y += 6;

        // Section 4 — primeiros socorros
        sectionTitle('4. Medidas de primeiros socorros');
        paragraph(fispq.firstAidMeasures);

        // Section 5 — combate a incêndio
        sectionTitle('5. Medidas de combate a incêndio');
        paragraph(fispq.fireFightingMeasures);

        // Section 6 — derramamento acidental
        sectionTitle('6. Medidas em caso de derramamento acidental');
        paragraph(fispq.accidentalRelease);

        // Section 7 — manuseio e armazenamento
        sectionTitle('7. Manuseio e armazenamento');
        paragraph(fispq.handlingStorage);

        // Section 8 — EPI
        sectionTitle('8. Controle de exposição / EPI');
        const ppeItems = (fispq.requiredPpeItems || []).map(p =>
          p.ppeCA ? `${p.name} (C.A. ${p.ppeCA})` : p.name,
        );
        if (ppeItems.length) {
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          for (const p of ppeItems) {
            doc.text(`• ${p}`, LAYOUT.marginLeft + 8, y, { width: contentWidth - 8 });
            y += doc.heightOfString(`• ${p}`, { width: contentWidth - 8 }) + 2;
          }
          y += 4;
        }
        paragraph(fispq.requiredPpeText);

        // Section 9 — propriedades físico-químicas
        sectionTitle('9. Propriedades físicas e químicas');
        kv('Estado físico:', fispq.physicalState);
        kv('Cor:', fispq.color);
        kv('Odor:', fispq.odor);
        kv('Ponto de fulgor:', fispq.flashPoint);
        kv('pH:', fispq.phValue);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
