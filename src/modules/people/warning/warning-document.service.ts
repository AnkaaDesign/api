/**
 * Warning Document Generator Service
 *
 * Renders the "Termo de Ciência de Advertência" PDF (pdf-lib/pdfkit) whose
 * sections mirror the canonical web layout (web/src/utils/warning-pdf-generator.ts):
 * header "Advertência", identification block, "Motivo da Advertência",
 * optional "Descrição Detalhada", and a signatures section
 * (Colaborador / Supervisor / Testemunhas).
 *
 * The signed/refused variant replaces the blank signature lines with the
 * acknowledgment state + cryptographic evidence (verification code) and a
 * Clicksign-style audit trail page.
 *
 * Legal basis: CLT Art. 2 (poder diretivo) + Lei 14.063/2020 (assinatura
 * eletrônica avançada) + MP 2.200-2/2001 (selo ICP-Brasil PAdES).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Per-signer evidence row rendered into the signatures section + audit page.
 */
export interface WarningSignerEvidence {
  name: string;
  cpf: string;
  role: 'COLLABORATOR' | 'WITNESS';
  position?: string | null;
  signed: boolean;
  refused: boolean;
  refusedReason?: string | null;
  biometricMethod?: string | null;
  serverTimestamp?: Date | null;
  deviceModel?: string | null;
  // First 16 hex chars of the HMAC — the human-facing verification code.
  verificationCode?: string | null;
}

/**
 * Audit trail event row for the audit page. Mirrors the warningSignatureEvent
 * rows recorded by WarningSignatureService.
 */
export interface WarningAuditTrailEvent {
  type: string;
  occurredAt: Date;
  actorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: any;
}

export interface WarningAuditTrailContext {
  events: WarningAuditTrailEvent[];
  documentNumber?: string;
  filename?: string;
  originalDocHash?: string | null;
}

/**
 * Internal document model.
 */
interface WarningDocumentData {
  warningId: string;
  collaboratorName: string;
  collaboratorCpf: string;
  collaboratorPosition: string;
  collaboratorSector: string;
  supervisorName: string;
  severity: string;
  category: string;
  reason: string;
  description?: string | null;
  suspensionDays?: number | null;
  followUpDate: Date;
  issueDate: Date;
  signers: WarningSignerEvidence[];
  // Acknowledgment state for the signed/refused variant.
  refused: boolean;
  refusedReason?: string | null;
  refusedAt?: Date | null;
}

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

// pt-BR severity labels matching the web generator
// (VERBAL=Advertência Verbal, WRITTEN=Advertência Escrita,
//  SUSPENSION=Suspensão, FINAL_WARNING=Advertência Final).
const SEVERITY_LABELS: Record<string, string> = {
  VERBAL: 'Advertência Verbal',
  WRITTEN: 'Advertência Escrita',
  SUSPENSION: 'Suspensão',
  FINAL_WARNING: 'Advertência Final',
};

const CATEGORY_LABELS: Record<string, string> = {
  SAFETY: 'Segurança',
  MISCONDUCT: 'Má conduta',
  INSUBORDINATION: 'Insubordinação',
  POLICY_VIOLATION: 'Violação de política',
  ATTENDANCE: 'Assiduidade',
  PERFORMANCE: 'Desempenho',
  BEHAVIOR: 'Comportamento',
  OTHER: 'Outros',
};

@Injectable()
export class WarningDocumentService {
  private readonly logger = new Logger(WarningDocumentService.name);
  private logoBuffer: Buffer | null = null;

  constructor(private readonly prisma: PrismaService) {
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

  private severityLabel(severity: string): string {
    return SEVERITY_LABELS[severity] || severity;
  }

  private categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] || category;
  }

  private getBiometricLabel(method: string | null | undefined): string {
    const labels: Record<string, string> = {
      FINGERPRINT: 'Impressão Digital',
      FACE_ID: 'Reconhecimento Facial',
      IRIS: 'Reconhecimento de Íris',
      DEVICE_PIN: 'PIN do Dispositivo',
      NONE: 'Nenhuma',
    };
    return labels[method || 'NONE'] || method || 'Nenhuma';
  }

  private maskCpfForPdf(cpf: string): string {
    if (!cpf) return '***.***.***-**';
    const digits = cpf.replace(/\D/g, '');
    if (digits.length < 11) return '***.***.***-**';
    return `***.${digits.substring(3, 6)}.${digits.substring(6, 9)}-**`;
  }

  /**
   * Build the internal document model from the warning row, merging per-signer
   * evidence rows (collaborator + witnesses) provided by the signature service.
   */
  async buildDocumentData(
    warningId: string,
    signers: WarningSignerEvidence[],
    state: { refused: boolean; refusedReason?: string | null; refusedAt?: Date | null },
  ): Promise<WarningDocumentData> {
    const warning = await this.prisma.warning.findUnique({
      where: { id: warningId },
      include: {
        collaborator: { include: { position: true, sector: true } },
        supervisor: { include: { position: true } },
        witness: { include: { position: true } },
      },
    });

    if (!warning) {
      throw new Error(`Warning ${warningId} not found`);
    }

    return {
      warningId: warning.id,
      collaboratorName: warning.collaborator?.name || 'Nome não informado',
      collaboratorCpf: warning.collaborator?.cpf || '',
      collaboratorPosition: warning.collaborator?.position?.name || 'Cargo não informado',
      collaboratorSector: warning.collaborator?.sector?.name || 'Setor não informado',
      supervisorName: warning.supervisor?.name || 'Supervisor não informado',
      severity: warning.severity,
      category: warning.category,
      reason: warning.reason,
      description: warning.description,
      suspensionDays: warning.suspensionDays ?? null,
      followUpDate: warning.followUpDate || new Date(),
      issueDate: warning.createdAt || new Date(),
      signers,
      refused: state.refused,
      refusedReason: state.refusedReason ?? null,
      refusedAt: state.refusedAt ?? null,
    };
  }

  /**
   * Render the warning acknowledgment PDF (with optional audit page).
   */
  async generateWarningDocument(
    warningId: string,
    signers: WarningSignerEvidence[],
    state: { refused: boolean; refusedReason?: string | null; refusedAt?: Date | null },
    audit?: WarningAuditTrailContext,
  ): Promise<Buffer> {
    const data = await this.buildDocumentData(warningId, signers, state);
    return this.createPdf(data, audit);
  }

  private createPdf(data: WarningDocumentData, audit?: WarningAuditTrailContext): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const chunks: Buffer[] = [];
        const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;

        const SPACING = {
          SECTION_GAP: 16,
          SUBSECTION_GAP: 13,
          LINE_HEIGHT: 14,
          PARAGRAPH_GAP: 8,
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
        doc.text('ADVERTÊNCIA', LAYOUT.marginLeft + 150, y + 4, {
          width: contentWidth - 150,
          align: 'right',
        });

        doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
        doc.text(this.severityLabel(data.severity), LAYOUT.marginLeft + 150, y + 20, {
          width: contentWidth - 150,
          align: 'right',
        });

        doc.font(FONTS.regular).fontSize(9).fillColor(COLORS.gray);
        const dateStr = data.issueDate.toLocaleDateString('pt-BR');
        doc.text(`Data: ${dateStr}`, LAYOUT.marginLeft + 150, y + 34, {
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

        // ========== IDENTIFICAÇÃO ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Identificação', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        const infoX = LAYOUT.marginLeft;
        const labelWidth = 165;

        const idRow = (label: string, value: string) => {
          doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
          doc.text(label, infoX, y, { width: labelWidth });
          doc.font(FONTS.regular).fillColor(COLORS.text);
          doc.text(value, infoX + labelWidth, y, { width: contentWidth - labelWidth });
          y += SPACING.LINE_HEIGHT;
        };

        idRow('Colaborador', data.collaboratorName);
        if (data.collaboratorPosition) idRow('Cargo do Colaborador', data.collaboratorPosition);
        if (data.collaboratorSector) idRow('Setor', data.collaboratorSector);
        idRow('Supervisor / Responsável', data.supervisorName);
        // Gravidade row removed — severity already shown as the badge next to the title.
        idRow('Categoria da Ocorrência', this.categoryLabel(data.category));
        idRow('Data de Emissão', data.issueDate.toLocaleDateString('pt-BR'));
        idRow('Acompanhamento até', data.followUpDate.toLocaleDateString('pt-BR'));
        if (data.severity === 'SUSPENSION') {
          idRow('Dias de Suspensão', `${data.suspensionDays ?? 1} dia(s) — CLT art. 474`);
        }

        y += SPACING.PARAGRAPH_GAP;

        // ========== MOTIVO DA ADVERTÊNCIA (the one highlighted block) ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Motivo da Advertência', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        // Highlighted block: light-gray background + green left rule (mirrors web .body-text).
        const reasonPadX = 10;
        const reasonPadY = 8;
        const reasonTextWidth = contentWidth - reasonPadX * 2;
        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
        const reasonTextHeight = doc.heightOfString(data.reason, {
          width: reasonTextWidth,
          align: 'justify',
        });
        const reasonBoxHeight = reasonTextHeight + reasonPadY * 2;
        doc.rect(LAYOUT.marginLeft, y, contentWidth, reasonBoxHeight).fill(COLORS.tableAlt);
        doc.rect(LAYOUT.marginLeft, y, 3, reasonBoxHeight).fill(COLORS.primary);
        doc.fillColor(COLORS.text);
        doc.text(data.reason, LAYOUT.marginLeft + reasonPadX, y + reasonPadY, {
          width: reasonTextWidth,
          align: 'justify',
        });
        y += reasonBoxHeight + SPACING.PARAGRAPH_GAP;

        // ========== DESCRIÇÃO DETALHADA (optional) ==========
        if (data.description) {
          doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
          doc.text('Descrição Detalhada', LAYOUT.marginLeft, y);
          y += SPACING.SUBSECTION_GAP;

          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
          const descHeight = doc.heightOfString(data.description, {
            width: contentWidth,
            align: 'justify',
          });
          doc.text(data.description, LAYOUT.marginLeft, y, {
            width: contentWidth,
            align: 'justify',
          });
          y += descHeight + SPACING.PARAGRAPH_GAP;
        }

        // ========== AVISO DE SUSPENSÃO (CLT art. 474) ==========
        if (data.severity === 'SUSPENSION') {
          const ackText =
            `Aviso de Suspensão: Em conformidade com o art. 474 da CLT, a suspensão disciplinar ` +
            `não poderá exceder 30 (trinta) dias corridos. A aplicação de suspensão por prazo ` +
            `superior implicará rescisão injustificada do contrato de trabalho. O colaborador ` +
            `ficará suspenso por ${data.suspensionDays ?? 1} dia(s), iniciando na data de emissão deste documento.`;
          doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
          const ackHeight = doc.heightOfString(ackText, { width: contentWidth, align: 'justify' });
          doc.text(ackText, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
          y += ackHeight + SPACING.PARAGRAPH_GAP;
        }

        // ========== CIÊNCIA / RECUSA ==========
        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Ciência', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP;

        const collaboratorSigner = data.signers.find(s => s.role === 'COLLABORATOR');
        const witnessSigners = data.signers.filter(s => s.role === 'WITNESS');

        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
        let acknowledgment: string;
        if (data.refused) {
          const refusedAtFmt = (data.refusedAt || new Date()).toLocaleString('pt-BR');
          acknowledgment =
            `O colaborador tomou ciência do teor desta advertência e RECUSOU-SE a assiná-la, ` +
            `na presença das testemunhas abaixo identificadas, em ${refusedAtFmt}.`;
          if (data.refusedReason) {
            acknowledgment += ` Contexto da recusa: ${data.refusedReason}`;
          }
        } else if (collaboratorSigner?.signed) {
          acknowledgment = 'Declaro ter tomado ciência do conteúdo desta advertência.';
        } else {
          acknowledgment =
            'Aguardando ciência do colaborador e das testemunhas (assinatura eletrônica no aplicativo).';
        }
        const ackH = doc.heightOfString(acknowledgment, { width: contentWidth, align: 'justify' });
        doc.text(acknowledgment, LAYOUT.marginLeft, y, { width: contentWidth, align: 'justify' });
        y += ackH + SPACING.PARAGRAPH_GAP;

        // Collaborator signature evidence (when signed)
        if (collaboratorSigner?.signed && !data.refused) {
          this.renderSignerEvidenceBlock(doc, collaboratorSigner, y, contentWidth);
          y += 50;
        }

        // ========== ASSINATURAS ==========
        y += SPACING.PARAGRAPH_GAP;

        // Push the signatures block toward the bottom of the page (mirrors the
        // web generator's flexible spacer). Compute the block's total height and
        // shift the cursor down so the block sits just above the footer, leaving
        // a small breathing gap. Never moves the cursor UP (only fills down).
        const footerTop = LAYOUT.pageHeight - LAYOUT.marginBottom - 60;
        const witnessRowCount = Math.ceil(witnessSigners.length / 2);
        const signaturesHeaderHeight = SPACING.SUBSECTION_GAP + 6 + 14;
        const signaturesBlockHeight =
          signaturesHeaderHeight +
          56 + // collaborator + supervisor row
          witnessRowCount * 56 +
          SPACING.PARAGRAPH_GAP +
          14; // place & date line
        const FOOTER_BREATHING_GAP = 16;
        const targetTop = footerTop - FOOTER_BREATHING_GAP - signaturesBlockHeight;
        if (targetTop > y) {
          y = targetTop;
        }

        doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.primary);
        doc.text('Assinaturas', LAYOUT.marginLeft, y);
        y += SPACING.SUBSECTION_GAP + 6;

        // Row 1: Collaborator + Supervisor
        const halfWidth = (contentWidth - 30) / 2;
        const col1X = LAYOUT.marginLeft;
        const col2X = LAYOUT.marginLeft + halfWidth + 30;

        this.renderSignatureBlock(
          doc,
          col1X,
          y,
          halfWidth,
          data.collaboratorName,
          data.refused
            ? 'Colaborador — Recusou-se a assinar'
            : collaboratorSigner?.signed
              ? 'Colaborador — Assinado eletronicamente'
              : 'Colaborador',
        );
        this.renderSignatureBlock(
          doc,
          col2X,
          y,
          halfWidth,
          data.supervisorName,
          'Supervisor / Responsável',
        );
        y += 56;

        // Witness rows (2 per row)
        for (let i = 0; i < witnessSigners.length; i += 2) {
          const w1 = witnessSigners[i];
          const w2 = witnessSigners[i + 1];
          this.renderSignatureBlock(
            doc,
            col1X,
            y,
            halfWidth,
            w1.name,
            `Testemunha${w1.position ? ` — ${w1.position}` : ''}${
              w1.signed ? ' (Assinado)' : ' (Pendente)'
            }`,
            w1.verificationCode,
          );
          if (w2) {
            this.renderSignatureBlock(
              doc,
              col2X,
              y,
              halfWidth,
              w2.name,
              `Testemunha${w2.position ? ` — ${w2.position}` : ''}${
                w2.signed ? ' (Assinado)' : ' (Pendente)'
              }`,
              w2.verificationCode,
            );
          }
          y += 56;
        }

        // Place & date
        y += SPACING.PARAGRAPH_GAP;
        doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
        doc.text(`Ibiporã-PR, ${data.issueDate.toLocaleDateString('pt-BR')}.`, LAYOUT.marginLeft, y, {
          width: contentWidth,
        });

        // ========== FOOTER ==========
        const footerY = LAYOUT.pageHeight - LAYOUT.marginBottom - 60;
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

        if (audit) {
          this.renderAuditTrailPage(doc, data, audit);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private renderSignatureBlock(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    name: string,
    role: string,
    verificationCode?: string | null,
  ): void {
    doc
      .moveTo(x, y + 26)
      .lineTo(x + width, y + 26)
      .strokeColor(COLORS.text)
      .lineWidth(0.5)
      .stroke();
    doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.text);
    doc.text(name, x, y + 30, { width, align: 'center' });
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
    doc.text(role, x, y + 42, { width, align: 'center' });
    if (verificationCode) {
      doc.fontSize(6).fillColor(COLORS.gray);
      doc.text(`Cód.: ${verificationCode}`, x, y + 50, { width, align: 'center' });
    }
  }

  private renderSignerEvidenceBlock(
    doc: PDFKit.PDFDocument,
    signer: WarningSignerEvidence,
    y: number,
    contentWidth: number,
  ): void {
    const ts = signer.serverTimestamp
      ? signer.serverTimestamp.toLocaleString('pt-BR')
      : '—';
    const parts = [
      `Biometria: ${this.getBiometricLabel(signer.biometricMethod)}`,
      `Data/hora: ${ts}`,
      signer.deviceModel ? `Dispositivo: ${signer.deviceModel}` : null,
      signer.verificationCode ? `Código de verificação: ${signer.verificationCode}` : null,
    ].filter(Boolean);
    doc.font(FONTS.regular).fontSize(7).fillColor(COLORS.gray);
    doc.text(parts.join(' · '), LAYOUT.marginLeft, y, { width: contentWidth });
  }

  /**
   * Clicksign-style audit trail page with the full lifecycle log.
   */
  private renderAuditTrailPage(
    doc: PDFKit.PDFDocument,
    data: WarningDocumentData,
    audit: WarningAuditTrailContext,
  ): void {
    const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;
    const SPACING = { SECTION_GAP: 24, SUBSECTION_GAP: 16, LINE_HEIGHT: 14, PARAGRAPH_GAP: 10 };

    doc.addPage();
    let y = LAYOUT.marginTop;

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

    const filename = audit.filename || `termo_advertencia_${data.warningId.substring(0, 8)}.pdf`;
    doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.text);
    doc.text(filename, LAYOUT.marginLeft, y);
    y += 14;

    doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
    doc.text(`Documento número #${audit.documentNumber || data.warningId}`, LAYOUT.marginLeft, y);
    y += 11;

    if (audit.originalDocHash) {
      doc.font(FONTS.bold).fontSize(8).fillColor(COLORS.gray);
      doc.text('Hash do documento (SHA256): ', LAYOUT.marginLeft, y, { continued: true });
      doc.font(FONTS.regular).fillColor(COLORS.text);
      doc.text(audit.originalDocHash, { width: contentWidth - 160 });
    }
    y += 14;

    doc
      .moveTo(LAYOUT.marginLeft, y)
      .lineTo(LAYOUT.marginLeft + contentWidth, y)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();
    y += SPACING.SECTION_GAP;

    // ========== ASSINATURAS / CIÊNCIAS ==========
    doc.font(FONTS.bold).fontSize(13).fillColor(COLORS.text);
    doc.text('Ciências', LAYOUT.marginLeft, y);
    y += 22;

    for (const signer of data.signers) {
      const checkX = LAYOUT.marginLeft;
      const checkY = y;
      const done = signer.signed || (signer.role === 'COLLABORATOR' && data.refused);
      const fill = signer.refused ? '#b00020' : done ? COLORS.primary : COLORS.gray;
      doc.circle(checkX + 8, checkY + 8, 8).fillAndStroke(fill, fill);
      doc.font(FONTS.bold).fontSize(11).fillColor('#ffffff');
      doc.text(signer.refused ? '×' : done ? '✓' : '?', checkX + 4.5, checkY + 2.5);

      doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.text);
      const roleLabel = signer.role === 'COLLABORATOR' ? 'Colaborador' : 'Testemunha';
      doc.text(`${signer.name} (${roleLabel})`, checkX + 24, checkY);
      doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.gray);
      let statusLine: string;
      if (signer.refused) {
        statusLine = 'Recusou-se a assinar (recusa testemunhada — CLT)';
      } else if (signer.signed && signer.serverTimestamp) {
        statusLine = `Assinou em ${signer.serverTimestamp.toLocaleString('pt-BR', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}${signer.verificationCode ? ` · Cód.: ${signer.verificationCode}` : ''}`;
      } else {
        statusLine = 'Pendente de assinatura';
      }
      doc.text(statusLine, checkX + 24, checkY + 14);
      y += 36;
    }

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
    const FOOTER_RESERVED = 130;

    const events = audit.events.length ? audit.events : [];

    for (const event of events) {
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

      const description = this.formatAuditEventDescription(event);
      doc.font(FONTS.regular).fontSize(8).fillColor(COLORS.text);
      const descHeight = doc.heightOfString(description, { width: descWidth, align: 'left' });
      doc.text(description, descX, y, { width: descWidth, align: 'left' });

      y += Math.max(descHeight, 18) + 12;
    }

    this.renderAuditFooter(doc);
  }

  private renderAuditFooter(doc: PDFKit.PDFDocument): void {
    const contentWidth = LAYOUT.pageWidth - LAYOUT.marginLeft - LAYOUT.marginRight;

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

    const LEGAL_LINE_GAP = 11;
    const LEGAL_LINES = 4;
    const legalBlockH = (LEGAL_LINES - 1) * LEGAL_LINE_GAP + 10;
    const sealSize = legalBlockH;
    const sealY = sealBottomY - sealSize;
    const separatorY = sealY - 10;

    doc
      .moveTo(LAYOUT.marginLeft, separatorY)
      .lineTo(LAYOUT.marginLeft + contentWidth, separatorY)
      .strokeColor(COLORS.lightGray)
      .lineWidth(0.5)
      .stroke();

    const sealX = LAYOUT.marginLeft;
    this.drawIcpBrasilSeal(doc, sealX, sealY, sealSize);

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

    const addressGradient = doc.linearGradient(
      LAYOUT.marginLeft,
      gradientY,
      LAYOUT.marginLeft + contentWidth,
      gradientY,
    );
    addressGradient.stop(0, '#888888').stop(0.3, COLORS.primary);
    doc.rect(LAYOUT.marginLeft, gradientY, contentWidth, 1).fill(addressGradient);

    doc.font(FONTS.bold).fontSize(9).fillColor(COLORS.primary);
    doc.text(COMPANY_INFO.name, LAYOUT.marginLeft, nameY, { width: contentWidth, lineBreak: false });
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

  private drawIcpBrasilSeal(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
    const fg = '#ffffff';
    const bg = COLORS.primary;

    doc.roundedRect(x, y, size, size, size * 0.12).fill(bg);

    const icpFontSize = size * 0.28;
    doc.font(FONTS.bold).fontSize(icpFontSize).fillColor(fg);
    doc.text('ICP', x, y + size * 0.12, { width: size, align: 'center', lineBreak: false });

    const brasilFontSize = size * 0.2;
    doc.font(FONTS.bold).fontSize(brasilFontSize).fillColor(fg);
    doc.text('Brasil', x, y + size * 0.42, { width: size, align: 'center', lineBreak: false });

    const keyY = y + size * 0.78;
    const keyShaftLen = size * 0.5;
    const keyShaftThickness = Math.max(1.5, size * 0.05);
    const keyShaftX = x + (size - keyShaftLen) / 2;
    const bowR = size * 0.08;

    doc
      .rect(
        keyShaftX + bowR * 1.5,
        keyY - keyShaftThickness / 2,
        keyShaftLen - bowR * 1.5,
        keyShaftThickness,
      )
      .fill(fg);
    doc.circle(keyShaftX + bowR, keyY, bowR).lineWidth(keyShaftThickness).strokeColor(fg).stroke();
    const tooth1X = keyShaftX + keyShaftLen - size * 0.12;
    const tooth2X = keyShaftX + keyShaftLen - size * 0.04;
    doc.rect(tooth1X, keyY + keyShaftThickness / 2, keyShaftThickness, size * 0.07).fill(fg);
    doc.rect(tooth2X, keyY + keyShaftThickness / 2, keyShaftThickness, size * 0.05).fill(fg);
  }

  private formatAuditEventDescription(event: WarningAuditTrailEvent): string {
    const meta = (event.metadata && typeof event.metadata === 'object' ? event.metadata : {}) as any;
    const actor = event.actorName || 'Sistema';
    const ipSuffix = event.ipAddress ? ` IP: ${event.ipAddress}.` : '';

    switch (event.type) {
      case 'WARNING_CREATED':
        return `Advertência criada por ${actor}.${meta.severity ? ` Gravidade: ${meta.severity}.` : ''}`;
      case 'DOCUMENT_VIEWED':
        return `${actor} abriu o documento da advertência no aplicativo.${ipSuffix}`;
      case 'BIOMETRIC_PROMPTED':
        return `${actor} iniciou a autenticação biométrica.${ipSuffix}`;
      case 'BIOMETRIC_SUCCEEDED':
        return `Autenticação biométrica validada com sucesso (${meta.method || 'biometria'}).${ipSuffix}`;
      case 'BIOMETRIC_FAILED':
        return `Autenticação biométrica falhou. ${meta.reason || ''}${ipSuffix}`;
      case 'SIGNATURE_SUBMITTED':
        return `${actor} enviou a assinatura${
          meta.signerRole ? ` (${meta.signerRole})` : ''
        }. Biometria: ${meta.biometricMethod || '—'}${
          meta.deviceModel ? `, dispositivo ${meta.deviceModel}` : ''
        }, app v${meta.appVersion || '?'}.${ipSuffix}`;
      case 'SIGNATURE_REFUSED':
        return `${actor} registrou a RECUSA de assinatura do colaborador (recusa testemunhada — CLT).${
          meta.refusedReason ? ` Contexto: ${meta.refusedReason}.` : ''
        }${ipSuffix}`;
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
        return `Ciência concluída.${
          meta.verificationCode ? ` Código de verificação: ${meta.verificationCode}.` : ''
        }${ipSuffix}`;
      case 'SIGNATURE_FAILED':
        return `Assinatura falhou: ${meta.error || 'erro desconhecido'}.`;
      case 'PDF_DOWNLOADED':
        return `${actor} baixou o termo de advertência.${ipSuffix}`;
      default:
        return `Evento: ${event.type}.`;
    }
  }
}
