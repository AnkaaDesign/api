/**
 * Termination Document Generator Service (Part G)
 *
 * Generates real PDF documents for the rescisão flow, reusing the shared
 * Ankaa Design PDF template established by the order/quote and PPE delivery
 * generators (PDFKit + the company header/footer + green design system).
 *
 * Documents:
 *   - TRCT (Termo de Rescisão do Contrato de Trabalho) — verbas breakdown
 *   - WARNING_LETTER (carta de aviso prévio)
 *   - TERM_484A (termo de rescisão por acordo mútuo, CLT 484-A)
 *   - HOMOLOGATION_TERM (termo de homologação / quitação)
 *
 * The generated buffer is persisted into a File row and linked to the matching
 * TerminationDocument (status → GENERATED). No eSocial emission.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { PrismaTransaction } from '@modules/common/base/base.repository';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { TERMINATION_DOCUMENT_TYPE, TERMINATION_TYPE } from '../../../constants';

const COMPANY_INFO = {
  name: 'Ankaa Design',
  cnpj: '00.000.000/0001-00',
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
  discount: '#9b1c1c',
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

const SPACING = {
  SECTION_GAP: 24,
  SUBSECTION_GAP: 16,
  LINE_HEIGHT: 14,
  PARAGRAPH_GAP: 10,
};

const TERMINATION_TYPE_LABELS: Record<string, string> = {
  [TERMINATION_TYPE.WITHOUT_CAUSE]: 'Dispensa sem justa causa',
  [TERMINATION_TYPE.WITH_CAUSE]: 'Dispensa por justa causa',
  [TERMINATION_TYPE.RESIGNATION]: 'Pedido de demissão',
  [TERMINATION_TYPE.MUTUAL_AGREEMENT]: 'Acordo mútuo (CLT 484-A)',
  [TERMINATION_TYPE.EXPERIENCE_END]: 'Término do contrato de experiência',
  [TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYER]: 'Rescisão antecipada da experiência pelo empregador',
  [TERMINATION_TYPE.EXPERIENCE_EARLY_EMPLOYEE]: 'Rescisão antecipada da experiência pelo empregado',
  [TERMINATION_TYPE.INDIRECT]: 'Rescisão indireta (CLT 483)',
  [TERMINATION_TYPE.DEATH]: 'Falecimento do colaborador',
  [TERMINATION_TYPE.FIXED_TERM_EARLY_EMPLOYEE]: 'Rescisão antecipada de contrato a prazo pelo empregado (CLT 480)',
  [TERMINATION_TYPE.INTERMITTENT_END]: 'Encerramento de contrato intermitente',
};

interface TerminationDocData {
  terminationId: string;
  employeeName: string;
  employeeCpf: string;
  employeePosition: string;
  employeeSector: string;
  admissionDate: Date | null;
  terminationDate: Date | null;
  projectedEndDate: Date | null;
  noticeDays: number | null;
  type: TERMINATION_TYPE;
  reason: string | null;
  items: Array<{ description: string; amount: number }>;
  earnings: number;
  discounts: number;
  net: number;
}

@Injectable()
export class TerminationDocumentService {
  private readonly logger = new Logger(TerminationDocumentService.name);
  private readonly filesRoot: string;
  private logoBuffer: Buffer | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.filesRoot = this.configService.get<string>('FILES_ROOT') || './files';
    this.loadLogo();
  }

  private loadLogo(): void {
    const logoPath = join(process.cwd(), 'assets', 'logo.png');
    if (existsSync(logoPath)) {
      this.logoBuffer = readFileSync(logoPath);
    } else {
      this.logger.warn(`Logo not found at ${logoPath}`);
    }
  }

  /**
   * Generate and persist a termination document of the given type, linking the
   * resulting File to the matching TerminationDocument (status → GENERATED).
   * Returns the persisted File id, or null when generation/persistence failed.
   * Only the four real-PDF types are supported here; other checklist entries
   * remain upload-only.
   */
  async generateAndPersist(
    tx: PrismaTransaction,
    terminationId: string,
    docType: TERMINATION_DOCUMENT_TYPE,
  ): Promise<string | null> {
    const data = await this.loadData(tx, terminationId);
    const buffer = await this.render(docType, data);
    if (!buffer) return null;

    const fileId = await this.savePdf(tx, buffer, data, docType);
    if (!fileId) return null;

    const existing = await tx.terminationDocument.findFirst({
      where: { terminationId, type: docType as any },
    });
    if (existing) {
      await tx.terminationDocument.update({
        where: { id: existing.id },
        data: { fileId, status: 'GENERATED' as any },
      });
    } else {
      await tx.terminationDocument.create({
        data: { terminationId, type: docType as any, fileId, status: 'GENERATED' as any },
      });
    }
    return fileId;
  }

  /** Real-PDF document types this service knows how to render. */
  static readonly GENERATABLE_TYPES: TERMINATION_DOCUMENT_TYPE[] = [
    TERMINATION_DOCUMENT_TYPE.TRCT,
    TERMINATION_DOCUMENT_TYPE.WARNING_LETTER,
    TERMINATION_DOCUMENT_TYPE.TERM_484A,
    TERMINATION_DOCUMENT_TYPE.HOMOLOGATION_TERM,
  ];

  private async loadData(
    tx: PrismaTransaction,
    terminationId: string,
  ): Promise<TerminationDocData> {
    const termination = await tx.termination.findUnique({
      where: { id: terminationId },
      include: {
        items: { orderBy: [{ isCustom: 'asc' }, { createdAt: 'asc' }] },
        user: { include: { position: true, sector: true } },
        contract: { select: { admissionDate: true } },
      },
    });
    if (!termination) {
      throw new NotFoundException('Rescisão não encontrada.');
    }

    const round2 = (v: number) => Math.round(v * 100) / 100;
    const items = (termination as any).items as Array<{ description: string | null; amount: number }>;
    const earnings = round2(
      items.filter(i => i.amount > 0).reduce((s, i) => s + i.amount, 0),
    );
    const discounts = round2(
      items.filter(i => i.amount < 0).reduce((s, i) => s + Math.abs(i.amount), 0),
    );

    const user = (termination as any).user;
    return {
      terminationId,
      employeeName: user?.name || 'Nome não informado',
      employeeCpf: user?.cpf || 'CPF não informado',
      employeePosition: user?.position?.name || 'Cargo não informado',
      employeeSector: user?.sector?.name || 'Setor não informado',
      admissionDate: (termination as any).contract?.admissionDate ?? null,
      terminationDate: termination.terminationDate,
      projectedEndDate: termination.projectedEndDate,
      noticeDays: termination.noticeDays,
      type: termination.type as TERMINATION_TYPE,
      reason: termination.reason,
      items: items.map(i => ({ description: i.description || '—', amount: i.amount })),
      earnings,
      discounts,
      net: round2(earnings - discounts),
    };
  }

  private render(
    docType: TERMINATION_DOCUMENT_TYPE,
    data: TerminationDocData,
  ): Promise<Buffer | null> {
    switch (docType) {
      case TERMINATION_DOCUMENT_TYPE.TRCT:
        return this.createPdf('TRCT — TERMO DE RESCISÃO DO CONTRATO DE TRABALHO', data, 'trct');
      case TERMINATION_DOCUMENT_TYPE.WARNING_LETTER:
        return this.createPdf('CARTA DE AVISO PRÉVIO', data, 'notice');
      case TERMINATION_DOCUMENT_TYPE.TERM_484A:
        return this.createPdf('TERMO DE RESCISÃO POR ACORDO MÚTUO (CLT ART. 484-A)', data, 'term484a');
      case TERMINATION_DOCUMENT_TYPE.HOMOLOGATION_TERM:
        return this.createPdf('TERMO DE HOMOLOGAÇÃO E QUITAÇÃO', data, 'homologation');
      default:
        return Promise.resolve(null);
    }
  }

  private fmtCurrency(value: number): string {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });
  }

  private fmtDate(date: Date | null): string {
    if (!date) return '—';
    return (date instanceof Date ? date : new Date(date)).toLocaleDateString('pt-BR');
  }

  private maskCpf(cpf: string): string {
    const digits = (cpf || '').replace(/\D/g, '');
    if (digits.length < 11) return '***.***.***-**';
    return `***.${digits.substring(3, 6)}.${digits.substring(6, 9)}-**`;
  }

  /**
   * Body paragraph per document variant — the legally meaningful text.
   */
  private bodyText(variant: string, data: TerminationDocData): string {
    const typeLabel = TERMINATION_TYPE_LABELS[data.type] || data.type;
    switch (variant) {
      case 'notice':
        return `${COMPANY_INFO.name} comunica a ${data.employeeName} o aviso prévio de ${
          data.noticeDays ?? 30
        } dias, com efeitos a partir de ${this.fmtDate(
          data.terminationDate,
        )}, projetando o término do contrato de trabalho para ${this.fmtDate(
          data.projectedEndDate ?? data.terminationDate,
        )} (CLT arts. 487 e 488; Lei 12.506/2011). Modalidade: ${typeLabel}.`;
      case 'term484a':
        return `As partes, ${COMPANY_INFO.name} e ${data.employeeName}, de comum acordo e nos termos do art. 484-A da CLT, rescindem o contrato de trabalho na data de ${this.fmtDate(
          data.terminationDate,
        )}, com aviso prévio indenizado reduzido à metade e multa do FGTS de 20%, autorizada a movimentação de até 80% do saldo do FGTS, sem direito ao seguro-desemprego.`;
      case 'homologation':
        return `Pela presente, ${data.employeeName} e ${COMPANY_INFO.name} declaram homologada a rescisão do contrato de trabalho (modalidade: ${typeLabel}) ocorrida em ${this.fmtDate(
          data.terminationDate,
        )}, dando o colaborador plena e geral quitação das verbas rescisórias discriminadas neste termo, no valor líquido de ${this.fmtCurrency(
          data.net,
        )}, para nada mais reclamar a qualquer título decorrente do extinto contrato de trabalho, ressalvadas as parcelas eventualmente devidas e não quitadas.`;
      case 'trct':
      default:
        return `Termo de rescisão do contrato de trabalho de ${data.employeeName} (modalidade: ${typeLabel}), admitido em ${this.fmtDate(
          data.admissionDate,
        )} e desligado em ${this.fmtDate(
          data.terminationDate,
        )}. Demonstrativo das verbas rescisórias abaixo (CLT art. 477).`;
    }
  }

  private createPdf(
    title: string,
    data: TerminationDocData,
    variant: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
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

        doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.text);
        doc.text(title, LAYOUT.marginLeft + 150, y + 8, {
          width: contentWidth - 150,
          align: 'right',
        });
        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
        doc.text(`Data: ${this.fmtDate(data.terminationDate)}`, LAYOUT.marginLeft + 150, y + 34, {
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

        const labelWidth = 70;
        const rows: Array<[string, string]> = [
          ['Nome:', data.employeeName],
          ['CPF:', this.maskCpf(data.employeeCpf)],
          ['Cargo:', data.employeePosition],
          ['Setor:', data.employeeSector],
          ['Admissão:', this.fmtDate(data.admissionDate)],
          ['Desligamento:', this.fmtDate(data.terminationDate)],
        ];
        for (const [label, value] of rows) {
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
          doc.text(label, LAYOUT.marginLeft, y);
          doc.font(FONTS.regular).fillColor(COLORS.text);
          doc.text(value, LAYOUT.marginLeft + labelWidth, y);
          y += SPACING.LINE_HEIGHT;
        }
        y += SPACING.SECTION_GAP - SPACING.LINE_HEIGHT;

        // ========== BODY TEXT ==========
        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.text);
        const body = this.bodyText(variant, data);
        const bodyHeight = doc.heightOfString(body, { width: contentWidth, align: 'justify' });
        doc.text(body, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += bodyHeight + SPACING.SECTION_GAP;

        // ========== VERBAS TABLE (TRCT / homologação) ==========
        const showTable =
          variant === 'trct' || variant === 'homologation' || variant === 'term484a';
        if (showTable && data.items.length > 0) {
          doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
          doc.text('Verbas Rescisórias', LAYOUT.marginLeft, y);
          y += SPACING.SUBSECTION_GAP;

          const colDesc = contentWidth * 0.72;
          const colValue = contentWidth * 0.28;
          const headerHeight = 22;

          doc.rect(LAYOUT.marginLeft, y, contentWidth, headerHeight).fill(COLORS.tableHeader);
          doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.white);
          doc.text('Descrição', LAYOUT.marginLeft + 8, y + 6, { width: colDesc - 16 });
          doc.text('Valor', LAYOUT.marginLeft + colDesc, y + 6, {
            width: colValue - 8,
            align: 'right',
          });
          y += headerHeight;

          const rowHeight = 18;
          data.items.forEach((item, index) => {
            // Page-break safety
            if (y + rowHeight > LAYOUT.pageHeight - LAYOUT.marginBottom - 120) {
              doc.addPage();
              y = LAYOUT.marginTop;
            }
            if (index % 2 === 1) {
              doc.rect(LAYOUT.marginLeft, y, contentWidth, rowHeight).fill(COLORS.tableAlt);
            }
            const isDiscount = item.amount < 0;
            doc.font(FONTS.regular).fontSize(8).fillColor(isDiscount ? COLORS.discount : COLORS.text);
            doc.text(item.description, LAYOUT.marginLeft + 8, y + 5, { width: colDesc - 16 });
            doc.text(this.fmtCurrency(item.amount), LAYOUT.marginLeft + colDesc, y + 5, {
              width: colValue - 8,
              align: 'right',
            });
            y += rowHeight;
          });

          // Totals
          y += 4;
          const totalsRows: Array<[string, number, string]> = [
            ['Total de proventos', data.earnings, COLORS.text],
            ['Total de descontos', -data.discounts, COLORS.discount],
            ['Líquido a receber', data.net, COLORS.primary],
          ];
          for (const [label, value, color] of totalsRows) {
            doc.font(FONTS.bold).fontSize(9).fillColor(color);
            doc.text(label, LAYOUT.marginLeft + 8, y, { width: colDesc - 16, align: 'right' });
            doc.text(this.fmtCurrency(value), LAYOUT.marginLeft + colDesc, y, {
              width: colValue - 8,
              align: 'right',
            });
            y += SPACING.LINE_HEIGHT;
          }
          y += SPACING.SECTION_GAP;
        }

        // ========== SIGNATURES ==========
        const footerY = LAYOUT.pageHeight - LAYOUT.marginBottom - 60;
        const sigY = Math.max(y + 50, footerY - 90);
        const half = contentWidth / 2;
        const sigWidth = half - 30;

        const drawSig = (x: number, name: string, caption: string) => {
          doc
            .moveTo(x, sigY)
            .lineTo(x + sigWidth, sigY)
            .strokeColor(COLORS.text)
            .lineWidth(0.5)
            .stroke();
          doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.text);
          doc.text(name, x, sigY + 6, { width: sigWidth, align: 'center' });
          doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
          doc.text(caption, x, sigY + 18, { width: sigWidth, align: 'center' });
        };
        drawSig(LAYOUT.marginLeft, data.employeeName, 'Colaborador');
        drawSig(LAYOUT.marginLeft + half + 15, COMPANY_INFO.name, 'Empregador');

        // ========== FOOTER ==========
        const footerGradient = doc.linearGradient(
          LAYOUT.marginLeft,
          footerY,
          LAYOUT.marginLeft + contentWidth,
          footerY,
        );
        footerGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
        doc.rect(LAYOUT.marginLeft, footerY, contentWidth, 1).fill(footerGradient);

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

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private async savePdf(
    tx: PrismaTransaction,
    pdfBuffer: Buffer,
    data: TerminationDocData,
    docType: TERMINATION_DOCUMENT_TYPE,
  ): Promise<string | null> {
    try {
      const sanitizedName = (data.employeeName || 'Desconhecido')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const dirPath = join(
        this.filesRoot,
        'Colaboradores',
        sanitizedName,
        'Rescisao',
        year,
        month,
      );
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const filename = `${docType.toLowerCase()}_${data.terminationId.substring(0, 8)}_${Date.now()}.pdf`;
      const filePath = join(dirPath, filename);
      writeFileSync(filePath, pdfBuffer);

      const file = await tx.file.create({
        data: {
          filename,
          originalName: `${docType} - ${data.employeeName}.pdf`,
          mimetype: 'application/pdf',
          path: filePath,
          size: pdfBuffer.length,
        },
      });
      return file.id;
    } catch (error) {
      this.logger.error('Falha ao salvar PDF da rescisão:', error);
      return null;
    }
  }
}
