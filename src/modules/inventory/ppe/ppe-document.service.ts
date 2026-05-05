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
 * Signature evidence data for signed PDF generation
 */
export interface SignatureEvidenceData {
  signerName: string;
  signerCpf: string;
  biometricMethod: string;
  deviceModel: string | null;
  clientTimestamp: Date;
  serverTimestamp: Date;
  latitude: number | null;
  longitude: number | null;
  hmacSignature: string;
}

/**
 * Audit trail event row for the second page of the signed PDF.
 * Mirrors the shape returned by PpeSignatureAuditService.getAuditTrail().
 */
export interface AuditTrailEvent {
  type: string;
  occurredAt: Date;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: any;
}

/**
 * Optional context for the audit trail page.
 * documentNumber defaults to the delivery id, originalDocHash is the
 * SHA-256 of the unsealed PDF computed by the caller.
 */
export interface AuditTrailContext {
  events: AuditTrailEvent[];
  documentNumber?: string;
  filename?: string;
  originalDocHash?: string | null;
}

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
  primary: '#0a5c1e', // Deep forest green
  text: '#1a1a1a', // Dark text
  gray: '#666666', // Secondary text
  lightGray: '#e5e5e5', // Borders
  white: '#ffffff', // Background
  tableHeader: '#0a5c1e', // Table header background
  tableAlt: '#f9f9f9', // Alternating row
};

// Typography
const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
};

// Page layout (A4)
const LAYOUT = {
  pageWidth: 595.28, // A4 width in points
  pageHeight: 841.89, // A4 height in points
  marginTop: 24,
  marginBottom: 24,
  marginLeft: 35,
  marginRight: 35,
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
    const items = deliveries.map(d => ({
      name: d.item?.name || 'Item não informado',
      quantity: d.quantity || 1,
      caNumber: d.item?.ppeCA || 'N/A',
      size: this.getSizeForDelivery(d),
    }));

    const batchData: PpeDocumentData = {
      deliveryId: deliveries.map(d => d.id).join(','),
      employeeName: firstDelivery.user?.name || 'Nome não informado',
      employeeCpf: firstDelivery.user?.cpf || 'CPF não informado',
      employeePosition: firstDelivery.user?.position?.name || 'Cargo não informado',
      employeeSector: firstDelivery.user?.sector?.name || 'Setor não informado',
      itemName: items.map(i => i.name).join(', '),
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
          SECTION_GAP: 24, // Between major sections
          SUBSECTION_GAP: 16, // Section title to content
          LINE_HEIGHT: 14, // Between text lines
          PARAGRAPH_GAP: 10, // Between paragraphs
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
        const dateStr =
          data.deliveryDate instanceof Date
            ? data.deliveryDate.toLocaleDateString('pt-BR')
            : new Date(data.deliveryDate).toLocaleDateString('pt-BR');
        doc.text(`Data: ${dateStr}`, LAYOUT.marginLeft + 150, y + 28, {
          width: contentWidth - 150,
          align: 'right',
        });

        // Move past the logo with proper clearance
        y += logoHeight + 12;

        // Header gradient line
        const gradientLine = doc.linearGradient(
          LAYOUT.marginLeft,
          y,
          LAYOUT.marginLeft + contentWidth,
          y,
        );
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

        // CPF (masked for LGPD compliance)
        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('CPF:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(this.maskCpfForPdf(data.employeeCpf), infoX + labelWidth, y);
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
        const colWidths = [
          contentWidth * 0.45,
          contentWidth * 0.15,
          contentWidth * 0.15,
          contentWidth * 0.25,
        ];
        const tableHeaders = ['Descrição', 'Qtd', 'Tamanho', 'C.A.'];
        const headerHeight = 22;

        doc.rect(LAYOUT.marginLeft, y, contentWidth, headerHeight).fill(COLORS.tableHeader);

        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.white);
        let colX = LAYOUT.marginLeft + 8;
        tableHeaders.forEach((header, i) => {
          doc.text(header, colX, y + 6, { width: colWidths[i] - 16 });
          colX += colWidths[i];
        });

        y += headerHeight;

        // Table rows
        const items = data.batchItems || [
          {
            name: data.itemName,
            quantity: data.quantity,
            size: data.size || 'N/A',
            caNumber: data.caNumber || 'N/A',
          },
        ];

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
          doc.text(String(item.quantity || data.quantity), colX, y + 6, {
            width: colWidths[1] - 16,
          });
          colX += colWidths[1];
          doc.text(item.size || data.size || 'N/A', colX, y + 6, { width: colWidths[2] - 16 });
          colX += colWidths[2];
          doc.text(item.caNumber || data.caNumber || 'N/A', colX, y + 6, {
            width: colWidths[3] - 16,
          });

          y += rowHeight;
        });

        // Table border
        const tableHeight = headerHeight + items.length * rowHeight;
        doc
          .rect(LAYOUT.marginLeft, y - tableHeight + headerHeight, contentWidth, tableHeight)
          .strokeColor(COLORS.lightGray)
          .lineWidth(0.5)
          .stroke();

        // Extra spacing between table and declaration
        y += SPACING.SECTION_GAP + 20;

        // ========== DECLARATION ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Declaração', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
        const declaration = `Eu, ${data.employeeName}, declaro ter recebido gratuitamente os Equipamentos de Proteção Individual (EPIs) acima relacionados, comprometendo-me a: usar exclusivamente para a finalidade destinada; responsabilizar-me pela guarda, conservação e higienização; comunicar ao empregador qualquer alteração que torne os EPIs impróprios para uso; cumprir as determinações sobre o uso adequado.`;

        // Calculate actual text height for proper spacing
        const declarationHeight = doc.heightOfString(declaration, {
          width: contentWidth,
          align: 'justify',
        });
        doc.text(declaration, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += declarationHeight + SPACING.PARAGRAPH_GAP;

        const warningText =
          'Estou ciente de que o não cumprimento das normas de uso dos EPIs poderá resultar em sanções disciplinares previstas na legislação trabalhista.';
        const warningHeight = doc.heightOfString(warningText, {
          width: contentWidth,
          align: 'justify',
        });
        doc.text(warningText, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });

        // ========== FOOTER (fixed at bottom of page) ==========
        const footerY = LAYOUT.pageHeight - LAYOUT.marginBottom - 60;

        // ========== SIGNATURE AREA (positioned above footer) ==========
        // Place signature 100pt above the footer line
        const sigY = footerY - 100;

        // Signature line
        const sigLineWidth = 280;
        const sigLineX = (LAYOUT.pageWidth - sigLineWidth) / 2;

        doc
          .moveTo(sigLineX, sigY)
          .lineTo(sigLineX + sigLineWidth, sigY)
          .strokeColor(COLORS.text)
          .lineWidth(0.5)
          .stroke();

        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.text);
        doc.text(data.employeeName, sigLineX, sigY + 8, { width: sigLineWidth, align: 'center' });

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
        doc.text('Assinatura do Colaborador', sigLineX, sigY + 22, {
          width: sigLineWidth,
          align: 'center',
        });

        // Footer line
        const footerGradient = doc.linearGradient(
          LAYOUT.marginLeft,
          footerY,
          LAYOUT.marginLeft + contentWidth,
          footerY,
        );
        footerGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, footerY, contentWidth, 1).fill(footerGradient);

        // 10pt gap below the gradient before the company name; then each
        // contact field on its own line.
        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
        doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, footerY + 12, {
          width: contentWidth,
          lineBreak: false,
        });

        doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
        doc.text(COMPANY_INFO.address, LAYOUT.marginLeft, footerY + 25, {
          width: contentWidth,
          lineBreak: false,
        });
        doc.text(COMPANY_INFO.phone, LAYOUT.marginLeft, footerY + 35, {
          width: contentWidth,
          lineBreak: false,
        });
        doc.text(COMPANY_INFO.website, LAYOUT.marginLeft, footerY + 45, {
          width: contentWidth,
          lineBreak: false,
        });

        // End document
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Mask CPF for PDF display: 12345678901 → ***.456.789-**
   */
  private maskCpfForPdf(cpf: string): string {
    if (!cpf) return '***.***.***-**';
    const digits = cpf.replace(/\D/g, '');
    if (digits.length < 11) return '***.***.***-**';
    return `***.${digits.substring(3, 6)}.${digits.substring(6, 9)}-**`;
  }

  /**
   * Map biometric method to Portuguese label
   */
  private getBiometricLabel(method: string): string {
    const labels: Record<string, string> = {
      FINGERPRINT: 'Impressão Digital',
      FACE_ID: 'Reconhecimento Facial',
      IRIS: 'Reconhecimento de Íris',
      DEVICE_PIN: 'PIN do Dispositivo',
      NONE: 'Nenhuma',
    };
    return labels[method] || method;
  }

  /**
   * Generate a signed PDF document for PPE delivery with digital signature evidence block
   * Replaces the blank signature line with a digital signature block containing
   * all evidence data required for Lei 14.063/2020 compliance.
   */
  async generateSignedDeliveryDocument(
    deliveryId: string,
    signatureEvidence: SignatureEvidenceData,
    audit?: AuditTrailContext,
  ): Promise<Buffer> {
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

    return this.createSignedPdf(documentData, signatureEvidence, audit);
  }

  /**
   * Create a signed PDF — same as createPdf but with digital signature block
   * instead of blank signature line
   */
  private createSignedPdf(
    data: PpeDocumentData,
    sig: SignatureEvidenceData,
    audit?: AuditTrailContext,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;

        const SPACING = {
          SECTION_GAP: 24,
          SUBSECTION_GAP: 16,
          LINE_HEIGHT: 14,
          PARAGRAPH_GAP: 10,
        };

        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: LAYOUT.marginTop,
            bottom: LAYOUT.marginBottom,
            left: LAYOUT.marginLeft,
            right: LAYOUT.marginRight,
          },
        });

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        let y = LAYOUT.marginTop;

        // ========== HEADER ==========
        const logoHeight = 50;
        if (this.logoBuffer) {
          doc.image(this.logoBuffer, LAYOUT.marginLeft, y, { height: logoHeight });
        } else {
          doc.font(FONTS.bold).fontSize(18).fillColor(COLORS.primary);
          doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, y + 15);
        }

        doc.font(FONTS.bold).fontSize(12).fillColor(COLORS.text);
        doc.text('TERMO DE ENTREGA DE EPI', LAYOUT.marginLeft + 150, y + 10, {
          width: contentWidth - 150,
          align: 'right',
        });

        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
        const dateStr =
          data.deliveryDate instanceof Date
            ? data.deliveryDate.toLocaleDateString('pt-BR')
            : new Date(data.deliveryDate).toLocaleDateString('pt-BR');
        doc.text(`Data: ${dateStr}`, LAYOUT.marginLeft + 150, y + 28, {
          width: contentWidth - 150,
          align: 'right',
        });

        y += logoHeight + 12;

        const gradientLine = doc.linearGradient(
          LAYOUT.marginLeft,
          y,
          LAYOUT.marginLeft + contentWidth,
          y,
        );
        gradientLine.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, y, contentWidth, 1.5).fill(gradientLine);

        y += SPACING.SECTION_GAP;

        // ========== EMPLOYEE INFO ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Dados do Colaborador', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        const infoX = LAYOUT.marginLeft;
        const labelWidth = 50;

        doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
        doc.text('Nome:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeeName, infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('CPF:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(this.maskCpfForPdf(data.employeeCpf), infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('Cargo:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeePosition, infoX + labelWidth, y);
        y += SPACING.LINE_HEIGHT;

        doc.font(FONTS.bold).fillColor(COLORS.gray);
        doc.text('Setor:', infoX, y);
        doc.font(FONTS.regular).fillColor(COLORS.text);
        doc.text(data.employeeSector, infoX + labelWidth, y);
        y += SPACING.SECTION_GAP;

        // ========== EQUIPMENT TABLE ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Equipamentos Entregues', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        const colWidths = [
          contentWidth * 0.45,
          contentWidth * 0.15,
          contentWidth * 0.15,
          contentWidth * 0.25,
        ];
        const tableHeaders = ['Descrição', 'Qtd', 'Tamanho', 'C.A.'];
        const headerHeight = 22;

        doc.rect(LAYOUT.marginLeft, y, contentWidth, headerHeight).fill(COLORS.tableHeader);
        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.white);
        let colX = LAYOUT.marginLeft + 8;
        tableHeaders.forEach((header, i) => {
          doc.text(header, colX, y + 6, { width: colWidths[i] - 16 });
          colX += colWidths[i];
        });
        y += headerHeight;

        const items = data.batchItems || [
          {
            name: data.itemName,
            quantity: data.quantity,
            size: data.size || 'N/A',
            caNumber: data.caNumber || 'N/A',
          },
        ];

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
          doc.text(String(item.quantity || data.quantity), colX, y + 6, {
            width: colWidths[1] - 16,
          });
          colX += colWidths[1];
          doc.text(item.size || data.size || 'N/A', colX, y + 6, { width: colWidths[2] - 16 });
          colX += colWidths[2];
          doc.text(item.caNumber || data.caNumber || 'N/A', colX, y + 6, {
            width: colWidths[3] - 16,
          });
          y += rowHeight;
        });

        const tableHeight = headerHeight + items.length * rowHeight;
        doc
          .rect(LAYOUT.marginLeft, y - tableHeight + headerHeight, contentWidth, tableHeight)
          .strokeColor(COLORS.lightGray)
          .lineWidth(0.5)
          .stroke();

        y += SPACING.SECTION_GAP + 20;

        // ========== DECLARATION ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Declaração', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
        const declaration = `Eu, ${data.employeeName}, declaro ter recebido gratuitamente os Equipamentos de Proteção Individual (EPIs) acima relacionados, comprometendo-me a: usar exclusivamente para a finalidade destinada; responsabilizar-me pela guarda, conservação e higienização; comunicar ao empregador qualquer alteração que torne os EPIs impróprios para uso; cumprir as determinações sobre o uso adequado.`;

        const declarationHeight = doc.heightOfString(declaration, {
          width: contentWidth,
          align: 'justify',
        });
        doc.text(declaration, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += declarationHeight + SPACING.PARAGRAPH_GAP;

        const warningText =
          'Estou ciente de que o não cumprimento das normas de uso dos EPIs poderá resultar em sanções disciplinares previstas na legislação trabalhista.';
        const warningHeight = doc.heightOfString(warningText, {
          width: contentWidth,
          align: 'justify',
        });
        doc.text(warningText, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += warningHeight + SPACING.SECTION_GAP;

        // ========== SIGNATURE LINE ==========
        // Positioned between declaration and footer, biased toward the footer
        // so the page reads paper-form-style. Full evidence is on page 2.
        const footerY = LAYOUT.pageHeight - LAYOUT.marginBottom - 60;
        const sigLineWidth = 280;
        const sigLineX = (LAYOUT.pageWidth - sigLineWidth) / 2;
        // 110pt above the footer, but never closer than 60pt below the
        // declaration text (page-1 always has plenty of room).
        const sigLineY = Math.max(y + 60, footerY - 110);

        doc
          .moveTo(sigLineX, sigLineY)
          .lineTo(sigLineX + sigLineWidth, sigLineY)
          .strokeColor(COLORS.text)
          .lineWidth(0.5)
          .stroke();

        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.text);
        doc.text(sig.signerName, sigLineX, sigLineY + 8, {
          width: sigLineWidth,
          align: 'center',
        });

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
        doc.text('Assinatura do Colaborador', sigLineX, sigLineY + 22, {
          width: sigLineWidth,
          align: 'center',
        });

        const serverTs =
          sig.serverTimestamp instanceof Date ? sig.serverTimestamp : new Date(sig.serverTimestamp);
        doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
        doc.text(
          `Assinado eletronicamente em ${serverTs.toLocaleString('pt-BR')} · Detalhes da assinatura na página 2 (Trilha de Auditoria).`,
          LAYOUT.marginLeft,
          sigLineY + 42,
          { width: contentWidth, align: 'center' },
        );

        // ========== FOOTER ==========
        // All text uses width + lineBreak:false to prevent PDFKit from
        // auto-paginating when content lands close to the bottom margin.
        const footerGradient = doc.linearGradient(
          LAYOUT.marginLeft,
          footerY,
          LAYOUT.marginLeft + contentWidth,
          footerY,
        );
        footerGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, footerY, contentWidth, 1).fill(footerGradient);

        // 10pt gap below the gradient before the company name; then each
        // contact field on its own line.
        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
        doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, footerY + 12, {
          width: contentWidth,
          lineBreak: false,
        });

        doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
        doc.text(COMPANY_INFO.address, LAYOUT.marginLeft, footerY + 25, {
          width: contentWidth,
          lineBreak: false,
        });
        doc.text(COMPANY_INFO.phone, LAYOUT.marginLeft, footerY + 35, {
          width: contentWidth,
          lineBreak: false,
        });
        doc.text(COMPANY_INFO.website, LAYOUT.marginLeft, footerY + 45, {
          width: contentWidth,
          lineBreak: false,
        });

        if (audit) {
          this.renderAuditTrailPage(doc, data, sig, audit);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Render a Clicksign-style audit trail page with the full lifecycle log.
   * Adds a new page to the existing document.
   */
  private renderAuditTrailPage(
    doc: PDFKit.PDFDocument,
    data: PpeDocumentData,
    sig: SignatureEvidenceData,
    audit: AuditTrailContext,
  ): void {
    const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
    const SPACING = { SECTION_GAP: 24, SUBSECTION_GAP: 16, LINE_HEIGHT: 14, PARAGRAPH_GAP: 10 };

    doc.addPage();
    let y = LAYOUT.marginTop;

    // ========== TOP HEADER (logo only — address moves to bottom of page) ==========
    const logoH = 42;
    if (this.logoBuffer) {
      doc.image(this.logoBuffer, LAYOUT.marginLeft, y, { height: logoH });
      const logoW = logoH * (875 / 379);
      doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.primary);
      doc.text(COMPANY_INFO.name, LAYOUT.marginLeft + logoW + 14, y + 14);
    } else {
      doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.primary);
      doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, y + 14);
    }

    y += logoH + 8;

    const stripGradient = doc.linearGradient(
      LAYOUT.marginLeft,
      y,
      LAYOUT.marginLeft + contentWidth,
      y,
    );
    stripGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
    doc.rect(LAYOUT.marginLeft, y, contentWidth, 1.5).fill(stripGradient);
    y += SPACING.SECTION_GAP;

    // ========== HEADER (Trilha de Auditoria + timezone meta) ==========
    const tzMetaY = y;
    doc.font(FONTS.bold).fontSize(20).fillColor(COLORS.primary);
    doc.text('Trilha de Auditoria', LAYOUT.marginLeft, y);

    doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
    doc.text('Datas e horários em GMT -03:00 Brasília', LAYOUT.marginLeft, tzMetaY + 4, {
      width: contentWidth,
      align: 'right',
    });
    doc.text(
      `Log gerado em ${new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })}`,
      LAYOUT.marginLeft,
      tzMetaY + 16,
      { width: contentWidth, align: 'right' },
    );
    y += 36;

    // ========== DOCUMENT INFO ==========
    const filename = audit.filename || `termo_epi_${data.deliveryId.substring(0, 8)}.pdf`;
    doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.text);
    doc.text(filename, LAYOUT.marginLeft, y);
    y += 14;

    doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
    doc.text(`Documento número #${audit.documentNumber || data.deliveryId}`, LAYOUT.marginLeft, y);
    y += 11;

    if (audit.originalDocHash) {
      doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
      doc.text('Hash do documento (SHA256): ', LAYOUT.marginLeft, y, { continued: true });
      doc.font(FONTS.regular).fillColor(COLORS.text);
      doc.text(audit.originalDocHash, { width: contentWidth - 160 });
    }
    y += 14;

    // separator
    doc
      .moveTo(LAYOUT.marginLeft, y)
      .lineTo(LAYOUT.marginLeft + contentWidth, y)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();
    y += SPACING.SECTION_GAP;

    // ========== ASSINATURAS ==========
    doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.text);
    doc.text('Assinaturas', LAYOUT.marginLeft, y);
    y += 22;

    // Green check + signer
    const checkX = LAYOUT.marginLeft;
    const checkY = y;
    doc.circle(checkX + 8, checkY + 8, 8).fillAndStroke(COLORS.primary, COLORS.primary);
    doc.font(FONTS.bold).fontSize(11).fillColor('#ffffff');
    doc.text('✓', checkX + 4.5, checkY + 2.5);

    doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.text);
    doc.text(sig.signerName, checkX + 24, checkY);
    doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
    const signedAtFmt = (sig.serverTimestamp instanceof Date
      ? sig.serverTimestamp
      : new Date(sig.serverTimestamp)
    ).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    doc.text(`Assinou em ${signedAtFmt}`, checkX + 24, checkY + 14);
    y += 40;

    // separator
    doc
      .moveTo(LAYOUT.marginLeft, y)
      .lineTo(LAYOUT.marginLeft + contentWidth, y)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();
    y += SPACING.SECTION_GAP;

    // ========== LOG ==========
    doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.text);
    doc.text('Log', LAYOUT.marginLeft, y);
    y += 22;

    const tsColumnWidth = 120;
    const descX = LAYOUT.marginLeft + tsColumnWidth + 12;
    const descWidth = contentWidth - tsColumnWidth - 12;
    // Footer block reserves ≈110pt: separator (10) + seal/legal (43) + gap
    // (16) + gradient (1) + address (28) + bottom pad (14)
    const FOOTER_RESERVED = 130;

    const events = audit.events.length
      ? audit.events
      : [
          {
            type: 'SIGNATURE_COMPLETED',
            occurredAt: sig.serverTimestamp,
            actorName: sig.signerName,
            ipAddress: null,
            userAgent: null,
            metadata: { verificationCode: sig.hmacSignature.substring(0, 16).toUpperCase() },
          } as AuditTrailEvent,
        ];

    for (const event of events) {
      // Page-break check
      if (y + 50 > LAYOUT.pageHeight - LAYOUT.marginBottom - FOOTER_RESERVED) {
        this.renderAuditFooter(doc);
        doc.addPage();
        y = LAYOUT.marginTop;
      }

      const tsFormatted = (event.occurredAt instanceof Date
        ? event.occurredAt
        : new Date(event.occurredAt)
      ).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
      doc.text(tsFormatted, LAYOUT.marginLeft, y, { width: tsColumnWidth });

      const description = this.formatAuditEventDescription(event, sig);
      doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
      const descHeight = doc.heightOfString(description, { width: descWidth, align: 'left' });
      doc.text(description, descX, y, { width: descWidth, align: 'left' });

      y += Math.max(descHeight, 18) + 12;
    }

    this.renderAuditFooter(doc);
  }

  /**
   * Footer for the audit trail page.
   *
   * Layout is computed BOTTOM-UP from the page's safe area so PDFKit can
   * never auto-paginate by considering text "too close" to the bottom margin.
   *
   * Stack (top → bottom of the footer block):
   *   - Separator line
   *   - ICP-Brasil seal + 4 lines of tightly stacked legal text
   *   - Empty gap
   *   - Address-strip gradient line + company name + address line
   */
  private renderAuditFooter(doc: PDFKit.PDFDocument): void {
    const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;

    // ── Bottom-up positioning ──
    // Address strip = 4 stacked lines (name + address + phone + website)
    // separated from the gradient line by a clear 10pt gap.
    const SAFE_BOTTOM = LAYOUT.pageHeight - LAYOUT.marginBottom;
    const FINAL_PAD = 8;
    const websiteY = SAFE_BOTTOM - FINAL_PAD - 7;
    const phoneY = websiteY - 10;
    const addressTextY = phoneY - 10;
    const nameY = addressTextY - 11;
    const gradientGap = 10;
    const gradientY = nameY - gradientGap;
    const legalBottomGap = 14;
    const sealBottomY = gradientY - legalBottomGap;

    // Tight 4-line legal block; seal matches its height.
    const LEGAL_LINE_GAP = 11;
    const LEGAL_LINES = 4;
    const legalBlockH = (LEGAL_LINES - 1) * LEGAL_LINE_GAP + 10; // ≈ 43
    const sealSize = legalBlockH;
    const sealY = sealBottomY - sealSize; // 697
    const separatorY = sealY - 10; // 687

    // ── Separator ──
    doc
      .moveTo(LAYOUT.marginLeft, separatorY)
      .lineTo(LAYOUT.marginLeft + contentWidth, separatorY)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();

    // ── ICP-Brasil seal ──
    const sealX = LAYOUT.marginLeft;
    this.drawIcpBrasilSeal(doc, sealX, sealY, sealSize);

    // ── Legal text block, tight line spacing ──
    const textX = sealX + sealSize + 12;
    const textWidth = contentWidth - sealSize - 12;
    let lineY = sealY;

    doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.text);
    doc.text('Documento assinado com validade jurídica.', textX, lineY, {
      width: textWidth,
      lineBreak: false,
    });
    lineY += LEGAL_LINE_GAP;

    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
    doc.text(
      'As assinaturas digitais e eletrônicas têm validade jurídica prevista na Medida Provisória nº 2.200-2 / 2001 e na Lei nº 14.063/2020.',
      textX,
      lineY,
      { width: textWidth, lineBreak: false },
    );
    lineY += LEGAL_LINE_GAP;

    doc.text(
      `Selo PAdES aplicado pelo certificado ICP-Brasil ${COMPANY_INFO.name} (CNPJ).`,
      textX,
      lineY,
      { width: textWidth, lineBreak: false },
    );
    lineY += LEGAL_LINE_GAP;

    // ITI validator link (clickable). Two-call chain with explicit
    // continued: false on the second call to terminate the chain so PDFKit
    // doesn't carry state into later draws.
    const linkUrl = 'https://validar.iti.gov.br/';
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
    doc.text(
      'Para conferir validade do documento, acesse o validador oficial do ITI: ',
      textX,
      lineY,
      { width: textWidth, continued: true, lineBreak: false },
    );
    doc.font(FONTS.bold).fontSize(7).fillColor(COLORS.primary);
    doc.text(linkUrl, {
      link: linkUrl,
      underline: true,
      continued: false,
      lineBreak: false,
    });
    doc.fillColor(COLORS.gray).font(FONTS.regular);

    // ── Address strip ──
    const addressGradient = doc.linearGradient(
      LAYOUT.marginLeft,
      gradientY,
      LAYOUT.marginLeft + contentWidth,
      gradientY,
    );
    addressGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
    doc.rect(LAYOUT.marginLeft, gradientY, contentWidth, 1).fill(addressGradient);

    doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
    doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, nameY, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
    doc.text(COMPANY_INFO.address, LAYOUT.marginLeft, addressTextY, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.text(COMPANY_INFO.phone, LAYOUT.marginLeft, phoneY, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.text(COMPANY_INFO.website, LAYOUT.marginLeft, websiteY, {
      width: contentWidth,
      lineBreak: false,
    });
  }

  /**
   * ICP-Brasil seal — rounded square in the brand primary green with white
   * "ICP / Brasil" wordmark and a stylized key glyph below.
   *
   * Layout follows the ICP-Brasil brand manual v3.0/2022 (square shape + ICP
   * stacked over Brasil + key glyph) recolored to the Ankaa primary so the
   * mark integrates cleanly with the rest of the document.
   */
  private drawIcpBrasilSeal(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    size: number,
  ): void {
    const fg = '#ffffff';
    const bg = COLORS.primary;

    doc.roundedRect(x, y, size, size, size * 0.12).fill(bg);

    const icpFontSize = size * 0.28;
    doc.font(FONTS.bold).fontSize(icpFontSize).fillColor(fg);
    doc.text('ICP', x, y + size * 0.12, {
      width: size,
      align: 'center',
      lineBreak: false,
    });

    const brasilFontSize = size * 0.2;
    doc.font(FONTS.bold).fontSize(brasilFontSize).fillColor(fg);
    doc.text('Brasil', x, y + size * 0.42, {
      width: size,
      align: 'center',
      lineBreak: false,
    });

    // Stylized key glyph: circular bow + horizontal shaft + two teeth
    const keyY = y + size * 0.78;
    const keyShaftLen = size * 0.5;
    const keyShaftThickness = Math.max(1.5, size * 0.05);
    const keyShaftX = x + (size - keyShaftLen) / 2;
    const bowR = size * 0.08;

    // shaft
    doc
      .rect(
        keyShaftX + bowR * 1.5,
        keyY - keyShaftThickness / 2,
        keyShaftLen - bowR * 1.5,
        keyShaftThickness,
      )
      .fill(fg);
    // bow (circle, drawn as stroked ring)
    doc
      .circle(keyShaftX + bowR, keyY, bowR)
      .lineWidth(keyShaftThickness)
      .strokeColor(fg)
      .stroke();
    // teeth
    const tooth1X = keyShaftX + keyShaftLen - size * 0.12;
    const tooth2X = keyShaftX + keyShaftLen - size * 0.04;
    doc.rect(tooth1X, keyY + keyShaftThickness / 2, keyShaftThickness, size * 0.07).fill(fg);
    doc.rect(tooth2X, keyY + keyShaftThickness / 2, keyShaftThickness, size * 0.05).fill(fg);
  }

  /**
   * Human-readable Portuguese description for each audit event type.
   */
  private formatAuditEventDescription(event: AuditTrailEvent, sig: SignatureEvidenceData): string {
    const meta = (event.metadata && typeof event.metadata === 'object' ? event.metadata : {}) as any;
    const actor = event.actorName || 'Sistema';
    const ipSuffix = event.ipAddress ? ` IP: ${event.ipAddress}.` : '';

    switch (event.type) {
      case 'DELIVERY_CREATED':
        return `Entrega de EPI criada por ${actor}.${
          meta.itemName ? ` Item: "${meta.itemName}"` : ''
        }${meta.quantity ? `, quantidade: ${meta.quantity}.` : '.'}`;
      case 'DELIVERY_APPROVED':
        return `Entrega aprovada por ${actor}.${
          meta.itemName ? ` Item: "${meta.itemName}".` : ''
        }`;
      case 'DELIVERY_REJECTED':
        return `Entrega reprovada por ${actor}.${
          meta.reason ? ` Motivo: ${meta.reason}.` : ''
        }`;
      case 'NOTIFICATION_SENT':
        return `Notificação enviada${
          meta.recipientName ? ` para ${meta.recipientName}` : ''
        } via ${meta.channel || 'app'}. Aguardando confirmação do colaborador.`;
      case 'NOTIFICATION_FAILED':
        return `Falha ao enviar notificação${
          meta.recipientName ? ` para ${meta.recipientName}` : ''
        }. ${meta.error || ''}`;
      case 'DOCUMENT_VIEWED':
        return `${actor} abriu o documento de entrega no aplicativo.${ipSuffix}`;
      case 'BIOMETRIC_PROMPTED':
        return `${actor} iniciou a autenticação biométrica.${ipSuffix}`;
      case 'BIOMETRIC_SUCCEEDED':
        return `Autenticação biométrica validada com sucesso (${
          meta.method || sig.biometricMethod
        }).${ipSuffix}`;
      case 'BIOMETRIC_FAILED':
        return `Autenticação biométrica falhou. ${meta.reason || ''}${ipSuffix}`;
      case 'SIGNATURE_SUBMITTED':
        return `${actor} enviou a assinatura. Pontos de autenticação: biometria (${
          meta.biometricMethod
        }), dispositivo${meta.deviceModel ? ` ${meta.deviceModel}` : ''}, app v${
          meta.appVersion || '?'
        }.${ipSuffix}`;
      case 'HMAC_VALIDATED':
        return `Servidor validou a integridade da evidência (HMAC SHA-256). Hash de evidência: ${
          (meta.evidenceHash || '').substring(0, 16)
        }…`;
      case 'HMAC_REJECTED':
        return `Servidor rejeitou a assinatura — hash de evidência não confere. Possível adulteração.`;
      case 'PADES_SEALED':
        return `Selo PAdES aplicado pelo certificado ICP-Brasil ${
          meta.certCnpj ? `(CNPJ ${meta.certCnpj})` : ''
        } emitido por ${meta.certIssuer || 'AC ICP-Brasil'}. Serial: ${meta.certSerial || '—'}.`;
      case 'PADES_FAILED':
        return `Tentativa de selo PAdES falhou: ${meta.error || 'erro desconhecido'}.`;
      case 'SIGNATURE_COMPLETED':
        return `Assinatura concluída.${
          meta.verificationCode ? ` Código de verificação: ${meta.verificationCode}.` : ''
        }${ipSuffix}`;
      case 'SIGNATURE_FAILED':
        return `Assinatura falhou: ${meta.error || 'erro desconhecido'}.`;
      case 'PDF_DOWNLOADED':
        return `${actor} baixou o termo assinado.${ipSuffix}`;
      default:
        return `Evento: ${event.type}.`;
    }
  }
}
