/**
 * PPE Delivery Document Generator Service
 *
 * Generates PDF documents for PPE (Personal Protective Equipment) delivery confirmations.
 * Design matches the Ankaa Design budget PDF template.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import {
  PPE_SIZE_LABELS,
  SHIRT_SIZE_LABELS,
  PANTS_SIZE_LABELS,
  BOOT_SIZE_LABELS,
  SLEEVES_SIZE_LABELS,
  MASK_SIZE_LABELS,
  GLOVES_SIZE_LABELS,
  RAIN_BOOTS_SIZE_LABELS,
} from '@constants';

/**
 * Internal document data structure for PDF generation
 */
interface PpeDocumentData {
  deliveryId: string;
  employeeName: string;
  employeeCpf: string;
  employeePosition: string;
  employeeSector: string;
  itemName: string;
  itemDescription?: string;
  quantity: number;
  caNumber?: string;
  size?: string;
  deliveryDate: Date;
  companyName: string;
  companyCnpj: string;
  isBatch?: boolean;
  batchItems?: Array<{
    name: string;
    description?: string;
    quantity: number;
    caNumber?: string;
    size?: string;
  }>;
}

// Company information
const COMPANY_INFO = {
  name: 'Ankaa Design',
  cnpj: '00.000.000/0001-00',
  address: 'Rua Luís Carlos Zani, 2493 - Santa Paula, Ibiporã-PR',
  phone: '(43) 9 8428-3228',
  website: 'ankaadesign.com.br',
};

// Design system colors (matching budget PDF)
const COLORS = {
  primary: '#0a5c1e',      // Deep forest green
  text: '#1a1a1a',         // Dark text
  gray: '#666666',         // Secondary text
  lightGray: '#e5e5e5',    // Borders
  white: '#ffffff',        // Background
  tableHeader: '#0a5c1e',  // Table header background
  tableAlt: '#f9f9f9',     // Alternating row
};

// Typography
const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
};

// Page layout (A4)
const LAYOUT = {
  pageWidth: 595.28,       // A4 width in points
  pageHeight: 841.89,      // A4 height in points
  marginTop: 40,
  marginBottom: 50,
  marginLeft: 35,          // Decreased from 50
  marginRight: 35,         // Decreased from 50
};

@Injectable()
export class PpeDocumentService {
  private readonly logger = new Logger(PpeDocumentService.name);
  private logoBuffer: Buffer | null = null;

  constructor(private readonly prisma: PrismaService) {
    // Load logo on initialization
    this.loadLogo();
  }

  private loadLogo(): void {
    const logoPath = join(process.cwd(), 'assets', 'logo.png');
    if (existsSync(logoPath)) {
      this.logoBuffer = readFileSync(logoPath);
      this.logger.log('Company logo loaded successfully');
    } else {
      this.logger.warn(`Logo not found at ${logoPath}`);
    }
  }

  /**
   * Generate a PDF document for PPE delivery confirmation
   * @param deliveryId The PPE delivery ID
   * @returns Buffer containing the PDF document
   */
  async generateDeliveryDocument(deliveryId: string): Promise<Buffer> {
    const delivery = await this.prisma.ppeDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
            ppeSize: true,
          },
        },
        item: true,
      },
    });

    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} not found`);
    }

    // Get size from additionalInfo or from user's ppeSize based on item type
    const size = this.getSizeForDelivery(delivery);

    const documentData: PpeDocumentData = {
      deliveryId: delivery.id,
      employeeName: delivery.user?.name || 'Nome não informado',
      employeeCpf: delivery.user?.cpf || 'CPF não informado',
      employeePosition: delivery.user?.position?.name || 'Cargo não informado',
      employeeSector: delivery.user?.sector?.name || 'Setor não informado',
      itemName: delivery.item?.name || 'Item não informado',
      quantity: delivery.quantity || 1,
      caNumber: delivery.item?.ppeCA || 'N/A',
      size,
      deliveryDate: delivery.actualDeliveryDate || new Date(),
      companyName: COMPANY_INFO.name,
      companyCnpj: COMPANY_INFO.cnpj,
    };

    return this.createPdf(documentData);
  }

  /**
   * Get the appropriate size label for a delivery based on item type and user's PPE sizes
   * Returns a formatted label like "M" or "42" instead of raw enum values
   */
  private getSizeForDelivery(delivery: any): string {
    // First check if size is in additionalInfo
    if (delivery.additionalInfo) {
      return this.formatSizeLabel(delivery.additionalInfo, delivery.item?.ppeType);
    }

    // If not, try to get from user's ppeSize based on item's ppeType
    const ppeType = delivery.item?.ppeType;
    const userPpeSize = delivery.user?.ppeSize;

    if (!ppeType || !userPpeSize) {
      return 'N/A';
    }

    let rawSize: string | null = null;
    switch (ppeType) {
      case 'SHIRT':
        rawSize = userPpeSize.shirts;
        break;
      case 'PANTS':
        rawSize = userPpeSize.pants;
        break;
      case 'SHORT':
        rawSize = userPpeSize.shorts;
        break;
      case 'BOOTS':
        rawSize = userPpeSize.boots;
        break;
      case 'SLEEVES':
        rawSize = userPpeSize.sleeves;
        break;
      case 'MASK':
        rawSize = userPpeSize.mask;
        break;
      case 'GLOVES':
        rawSize = userPpeSize.gloves;
        break;
      case 'RAIN_BOOTS':
        rawSize = userPpeSize.rainBoots;
        break;
      default:
        return 'N/A';
    }

    return this.formatSizeLabel(rawSize, ppeType);
  }

  /**
   * Format size label to human-readable format
   * Converts enum values like "SIZE_42" to "42" and "GG" to "GG"
   */
  private formatSizeLabel(size: string | null, ppeType?: string): string {
    if (!size) return 'N/A';

    // If size starts with "SIZE_", extract the number
    if (size.startsWith('SIZE_')) {
      return size.replace('SIZE_', '');
    }

    // Use the label maps for specific types if available
    if (ppeType) {
      switch (ppeType) {
        case 'SHIRT':
          return SHIRT_SIZE_LABELS[size as keyof typeof SHIRT_SIZE_LABELS] || size;
        case 'PANTS':
        case 'SHORT':
          return PANTS_SIZE_LABELS[size as keyof typeof PANTS_SIZE_LABELS] || size;
        case 'BOOTS':
          return BOOT_SIZE_LABELS[size as keyof typeof BOOT_SIZE_LABELS] || size;
        case 'SLEEVES':
          return SLEEVES_SIZE_LABELS[size as keyof typeof SLEEVES_SIZE_LABELS] || size;
        case 'MASK':
          return MASK_SIZE_LABELS[size as keyof typeof MASK_SIZE_LABELS] || size;
        case 'GLOVES':
          return GLOVES_SIZE_LABELS[size as keyof typeof GLOVES_SIZE_LABELS] || size;
        case 'RAIN_BOOTS':
          return RAIN_BOOTS_SIZE_LABELS[size as keyof typeof RAIN_BOOTS_SIZE_LABELS] || size;
      }
    }

    // Try the generic PPE_SIZE_LABELS
    return PPE_SIZE_LABELS[size as keyof typeof PPE_SIZE_LABELS] || size;
  }

  /**
   * Generate a batch PDF document for multiple PPE deliveries
   * @param deliveryIds Array of PPE delivery IDs
   * @returns Buffer containing the PDF document
   */
  async generateBatchDeliveryDocument(deliveryIds: string[]): Promise<Buffer> {
    const deliveries = await this.prisma.ppeDelivery.findMany({
      where: { id: { in: deliveryIds } },
      include: {
        user: {
          include: {
            position: true,
            sector: true,
            ppeSize: true,
          },
        },
        item: true,
      },
    });

    if (deliveries.length === 0) {
      throw new Error('No deliveries found');
    }

    // All deliveries should be for the same user
    const firstDelivery = deliveries[0];
    const items = deliveries.map((d) => ({
      name: d.item?.name || 'Item não informado',
      quantity: d.quantity || 1,
      caNumber: d.item?.ppeCA || 'N/A',
      size: this.getSizeForDelivery(d),
    }));

    const batchData: PpeDocumentData = {
      deliveryId: deliveries.map((d) => d.id).join(','),
      employeeName: firstDelivery.user?.name || 'Nome não informado',
      employeeCpf: firstDelivery.user?.cpf || 'CPF não informado',
      employeePosition: firstDelivery.user?.position?.name || 'Cargo não informado',
      employeeSector: firstDelivery.user?.sector?.name || 'Setor não informado',
      itemName: items.map((i) => i.name).join(', '),
      quantity: items.reduce((sum, i) => sum + i.quantity, 0),
      caNumber: '',
      size: '',
      deliveryDate: firstDelivery.actualDeliveryDate || new Date(),
      companyName: COMPANY_INFO.name,
      companyCnpj: COMPANY_INFO.cnpj,
      isBatch: true,
      batchItems: items,
    };

    return this.createPdf(batchData);
  }

  /**
   * Create the PDF document matching the budget PDF design
   *
   * Spacing constants (in points):
   * - SECTION_GAP: 24pt - space between major sections
   * - SUBSECTION_GAP: 16pt - space between section title and content
   * - LINE_HEIGHT: 14pt - space between text lines
   * - PARAGRAPH_GAP: 12pt - space between paragraphs
   */
  private createPdf(data: PpeDocumentData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;

        // Spacing constants
        const SPACING = {
          SECTION_GAP: 24,      // Between major sections
          SUBSECTION_GAP: 16,   // Section title to content
          LINE_HEIGHT: 14,      // Between text lines
          PARAGRAPH_GAP: 10,    // Between paragraphs
        };

        // Create PDF document
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: LAYOUT.marginTop,
            bottom: LAYOUT.marginBottom,
            left: LAYOUT.marginLeft,
            right: LAYOUT.marginRight,
          },
        });

        // Collect PDF data
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let y = LAYOUT.marginTop;

        // ========== HEADER ==========
        const logoHeight = 50;

        // Logo (left side)
        if (this.logoBuffer) {
          doc.image(this.logoBuffer, LAYOUT.marginLeft, y, { height: logoHeight });
        } else {
          // Fallback: Company name as text
          doc.font(FONTS.bold).fontSize(18).fillColor(COLORS.primary);
          doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, y + 15);
        }

        // Document title and date (right side, vertically centered with logo)
        doc.font(FONTS.bold).fontSize(12).fillColor(COLORS.text);
        doc.text('TERMO DE ENTREGA DE EPI', LAYOUT.marginLeft + 150, y + 10, {
          width: contentWidth - 150,
          align: 'right',
        });

        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
        const dateStr = data.deliveryDate instanceof Date
          ? data.deliveryDate.toLocaleDateString('pt-BR')
          : new Date(data.deliveryDate).toLocaleDateString('pt-BR');
        doc.text(`Data: ${dateStr}`, LAYOUT.marginLeft + 150, y + 28, {
          width: contentWidth - 150,
          align: 'right',
        });

        // Move past the logo with proper clearance
        y += logoHeight + 12;

        // Header gradient line
        const gradientLine = doc.linearGradient(LAYOUT.marginLeft, y, LAYOUT.marginLeft + contentWidth, y);
        gradientLine.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, y, contentWidth, 1.5).fill(gradientLine);

        y += SPACING.SECTION_GAP;

        // ========== EMPLOYEE INFO SECTION ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Dados do Colaborador', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        // Employee info in single column vertical layout
        const infoX = LAYOUT.marginLeft;
        const labelWidth = 50;

        // Nome
        doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
        doc.text('Nome:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeeName, infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        // CPF
        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('CPF:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeeCpf, infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        // Cargo
        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('Cargo:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeePosition, infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        // Setor
        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('Setor:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeeSector, infoX + labelWidth, y);

        y += SPACING.SECTION_GAP;

        // ========== EQUIPMENT TABLE ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Equipamentos Entregues', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        // Table header
        const colWidths = [contentWidth * 0.45, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.25];
        const tableHeaders = ['Descrição', 'Qtd', 'Tamanho', 'C.A.'];
        const headerHeight = 22;

        doc.rect(LAYOUT.marginLeft, y, contentWidth, headerHeight)
           .fill(COLORS.tableHeader);

        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.white);
        let colX = LAYOUT.marginLeft + 8;
        tableHeaders.forEach((header, i) => {
          doc.text(header, colX, y + 6, { width: colWidths[i] - 16 });
          colX += colWidths[i];
        });

        y += headerHeight;

        // Table rows
        const items = data.batchItems || [{
          name: data.itemName,
          quantity: data.quantity,
          size: data.size || 'N/A',
          caNumber: data.caNumber || 'N/A',
        }];

        const rowHeight = 20;
        items.forEach((item, index) => {
          const isAlt = index % 2 === 1;
          if (isAlt) {
            doc.rect(LAYOUT.marginLeft, y, contentWidth, rowHeight).fill(COLORS.tableAlt);
          }

          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          colX = LAYOUT.marginLeft + 8;

          doc.text(item.name || data.itemName, colX, y + 6, { width: colWidths[0] - 16 });
          colX += colWidths[0];
          doc.text(String(item.quantity || data.quantity), colX, y + 6, { width: colWidths[1] - 16 });
          colX += colWidths[1];
          doc.text(item.size || data.size || 'N/A', colX, y + 6, { width: colWidths[2] - 16 });
          colX += colWidths[2];
          doc.text(item.caNumber || data.caNumber || 'N/A', colX, y + 6, { width: colWidths[3] - 16 });

          y += rowHeight;
        });

        // Table border
        const tableHeight = headerHeight + (items.length * rowHeight);
        doc.rect(LAYOUT.marginLeft, y - tableHeight + headerHeight, contentWidth, tableHeight)
           .strokeColor(COLORS.lightGray)
           .lineWidth(0.5)
           .stroke();

        y += SPACING.SECTION_GAP;

        // ========== DECLARATION ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Declaração', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
        const declaration = `Declaro ter recebido gratuitamente os EPIs acima relacionados, comprometendo-me a: usar exclusivamente para a finalidade destinada; responsabilizar-me pela guarda, conservação e higienização; comunicar ao empregador qualquer alteração que torne os EPIs impróprios para uso; cumprir as determinações sobre o uso adequado.`;

        // Calculate actual text height for proper spacing
        const declarationHeight = doc.heightOfString(declaration, { width: contentWidth, align: 'justify' });
        doc.text(declaration, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += declarationHeight + SPACING.PARAGRAPH_GAP;

        const warningText = 'Estou ciente de que o não cumprimento das normas de uso dos EPIs poderá resultar em sanções disciplinares previstas na legislação trabalhista.';
        const warningHeight = doc.heightOfString(warningText, { width: contentWidth, align: 'justify' });
        doc.text(warningText, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += warningHeight;

        // ========== SIGNATURE AREA ==========
        y += 50; // Generous space before signature

        // Signature line
        const sigLineWidth = 280;
        const sigLineX = (LAYOUT.pageWidth - sigLineWidth) / 2;

        doc.moveTo(sigLineX, y)
           .lineTo(sigLineX + sigLineWidth, y)
           .strokeColor(COLORS.text)
           .lineWidth(0.5)
           .stroke();

        y += 8;
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.text);
        doc.text(data.employeeName, sigLineX, y, { width: sigLineWidth, align: 'center' });

        y += 14;
        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
        doc.text('Assinatura do Colaborador', sigLineX, y, { width: sigLineWidth, align: 'center' });

        // ========== FOOTER (fixed at bottom of page) ==========
        const footerY = LAYOUT.pageHeight - LAYOUT.marginBottom - 30;

        // Footer line
        const footerGradient = doc.linearGradient(LAYOUT.marginLeft, footerY, LAYOUT.marginLeft + contentWidth, footerY);
        footerGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, footerY, contentWidth, 1).fill(footerGradient);

        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
        doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, footerY + 8);

        doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
        doc.text(`${COMPANY_INFO.address} | ${COMPANY_INFO.phone} | ${COMPANY_INFO.website}`, LAYOUT.marginLeft, footerY + 20);

        // End document
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
