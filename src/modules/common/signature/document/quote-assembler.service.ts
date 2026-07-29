/**
 * Montagem do artefato final assinado.
 *
 * Ordem obrigatória — tudo que altera conteúdo acontece ANTES do selo:
 *
 *   original.pdf (bytes congelados)
 *     → selos visuais nas âncoras           [conteúdo]
 *     → rodapé de verificação em toda página [conteúdo]
 *     → páginas de trilha de auditoria       [conteúdo]
 *     → ★ UM selo PAdES + carimbo do tempo   [DEVE ser o último]
 *
 * O digest de uma assinatura PDF cobre o arquivo inteiro exceto a própria string
 * /Contents; qualquer byte escrito depois a invalida. É por isso que o pdf-lib
 * (que reescreve o arquivo inteiro no `save()`) só aparece antes do selo.
 *
 * **Um selo, no fim, e pronto.** Os signatários não possuem certificado — o ato
 * de cada um é evidência (OTP + IP + timestamp), não criptografia. É exatamente
 * o que Clicksign, ZapSign e D4Sign fazem, e evita toda a complexidade de
 * atualização incremental e de raciocínio sobre DocMDP.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, degrees, PDFFont, PDFPage } from 'pdf-lib';
// Alias obrigatorio: pdf-lib tambem exporta `PDFDocument`.
import PDFKitDocument from 'pdfkit';
import { COMPANY, BRAND_COLORS } from '@/config/company';
import { SignatureAnchorMap } from './quote-renderer.service';
import { PAGE_MARGINS_MM, PX_TO_PT, mmToPt } from './quote-html.builder';
import { formatDateTimeBR } from './quote-text';
import { maskCpf, maskPhone, formatCpf } from '../utils/identity';

export interface AssemblerSigner {
  id: string;
  name: string;
  cargo: string | null;
  companyLabel: string | null;
  cpf: string | null;
  phone: string | null;
  signedAt: Date | null;
  /** Status atual do signatário. VOIDED/REFUSED NÃO podem receber selo. */
  status: string;
  authMethodLabel: string;
  ipAddress: string | null;
  side: 'ANKAA' | 'CUSTOMER';
}

export interface AssemblerAuditEvent {
  sequence: number;
  occurredAt: Date;
  description: string;
  ipAddress: string | null;
  hash: string;
}

export interface AssembleInput {
  originalPdf: Buffer;
  anchors: SignatureAnchorMap;
  signers: AssemblerSigner[];
  events: AssemblerAuditEvent[];
  budgetNumber: number;
  envelopeId: string;
  verificationCode: string;
  verificationUrl: string;
  originalSha256: string;
  chainTip: string;
  /** Cláusula de aceitação do meio eletrônico, registrada na trilha. */
  acceptanceClause?: string;
}

const GREEN = rgb(0.039, 0.361, 0.118); // #0a5c1e
const GRAY = rgb(0.4, 0.4, 0.4);
const DARK = rgb(0.1, 0.1, 0.1);

/**
 * As fontes base do pdf-lib são WinAnsi (CP1252). Acentos do português estão
 * cobertos, mas qualquer caractere fora do CP1252 lança na hora de desenhar —
 * a mesma classe de bug que hoje quebra o PDF do Flutter, onde `formatMoney`
 * emite U+2022 e derruba o render inteiro.
 */
export function winAnsi(text: string): string {
  return (text ?? '')
    // Caracteres de controle C0/C1. O CP1252 não codifica U+0081/8D/8F/90/9D e
    // o pdf-lib LANÇA ao desenhá-los — o que travaria stampSeals para sempre,
    // derrubando finalize() e as duas rotas de PDF. Chegam por `cargo` (JSON
    // livre) e por `X-Forwarded-For`, ambos controlados pelo cliente.
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '-')
    .replace(/•/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // Qualquer resto fora de Latin-1 vira '?' em vez de derrubar o documento.
    .replace(/[^\x00-\xFF]/g, '?');
}

/** Piso de legibilidade para o encolhimento de uma linha do selo. */
const SEAL_MIN_FONT_SIZE = 5;

/**
 * Ajusta uma linha do selo à largura útil da moldura: encolhe até o piso de
 * legibilidade e, só então, corta com reticências.
 *
 * Truncar uma razão social é ruim; deixá-la atravessar a moldura e colidir com o
 * selo do signatário ao lado, num documento que alguém assinou, é pior — e era o
 * que acontecia, porque `drawText` não recorta nem quebra linha.
 */
function fitToWidth(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): { text: string; size: number } {
  let fontSize = size;
  while (fontSize > SEAL_MIN_FONT_SIZE && font.widthOfTextAtSize(text, fontSize) > maxWidth) {
    fontSize = Math.max(fontSize - 0.25, SEAL_MIN_FONT_SIZE);
  }
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return { text, size: fontSize };

  let clipped = text;
  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, fontSize) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return { text: `${clipped.trimEnd()}...`, size: fontSize };
}

@Injectable()
export class QuoteAssemblerService {
  private readonly logger = new Logger(QuoteAssemblerService.name);

  /**
   * Aplica os selos visuais e o rodapé de verificação sobre os bytes congelados.
   *
   * Usado tanto na montagem final quanto na visualização "ao vivo" do documento
   * (com os slots já assinados marcados e os pendentes ainda em branco), que é o
   * que o cliente vê enquanto a cerimônia corre.
   */
  /**
   * Marca d'água diagonal em TODAS as páginas.
   *
   * Desenhada ANTES dos selos: assim ela fica sob a assinatura, que continua
   * legível — a marca diz que o documento não vale, não apaga o que foi
   * colhido. A opacidade é o equilíbrio entre as duas coisas: alta o bastante
   * para ninguém confundir o artefato com um válido ao abri-lo fora de
   * contexto, baixa o bastante para o orçamento continuar legível por baixo.
   *
   * O tamanho deriva da diagonal da página, então funciona em A4 retrato,
   * paisagem ou qualquer formato que o orçamento venha a usar, sem constante
   * mágica que quebra no primeiro documento fora do padrão.
   */
  private drawVoidWatermark(pages: PDFPage[], font: PDFFont, label: string): void {
    const text = label.toUpperCase();
    for (const page of pages) {
      const { width, height } = page.getSize();
      const diagonal = Math.sqrt(width * width + height * height);
      // Ocupa ~78% da diagonal; o resto é respiro nas bordas.
      const target = diagonal * 0.78;
      let size = 72;
      const measured = font.widthOfTextAtSize(text, size);
      if (measured > 0) size = (size * target) / measured;
      // Teto para um rótulo curto ("RECUSADO") não virar uma letra por página.
      size = Math.min(size, height * 0.18);

      const w = font.widthOfTextAtSize(text, size);
      const h = font.heightAtSize(size);
      const angle = (Math.atan2(height, width) * 180) / Math.PI;
      const rad = (angle * Math.PI) / 180;

      // Centraliza a caixa girada: recua metade do texto ao longo do próprio
      // eixo e meia altura na perpendicular.
      const x = width / 2 - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad);
      const y = height / 2 - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad);

      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: rgb(0.78, 0.09, 0.09),
        opacity: 0.22,
        rotate: degrees(angle),
      });
    }
  }

  async stampSeals(input: {
    originalPdf: Buffer;
    anchors: SignatureAnchorMap;
    signers: AssemblerSigner[];
    budgetNumber: number;
    verificationCode: string;
    verificationUrl: string;
    originalSha256: string;
    /**
     * Marca d'água diagonal vermelha, quando o envelope não vale mais.
     *
     * O histórico de versões continua acessível de propósito — é ele que mostra
     * o que foi colhido e quando. Mas um PDF antigo aberto fora de contexto é
     * indistinguível de um válido: ele tem os mesmos selos "ASSINADO
     * ELETRONICAMENTE" nas mesmas posições. A marca resolve isso no próprio
     * artefato, e não só na tela que o listou.
     */
    voidedLabel?: string | null;
  }): Promise<Buffer> {
    const doc = await PDFDocument.load(input.originalPdf, { updateMetadata: false });
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();

    if (input.voidedLabel) {
      this.drawVoidWatermark(pages, helvBold, input.voidedLabel);
    }

    for (const signer of input.signers) {
      // Gate por STATUS, não só por signedAt: a invalidação por alteração
      // material marca o signatário como VOIDED mas preserva `signedAt` como
      // fato histórico. Só olhar signedAt estampava "ASSINADO ELETRONICAMENTE"
      // sobre uma assinatura anulada.
      if (!signer.signedAt) continue; // slot pendente permanece em branco
      if (signer.status !== 'SIGNED') continue;
      const anchor = input.anchors[signer.id];
      if (!anchor) {
        this.logger.warn(`Signatário ${signer.id} sem âncora — selo não desenhado.`);
        continue;
      }
      const page = pages[anchor.page];
      if (!page) {
        this.logger.warn(`Âncora do signatário ${signer.id} aponta para página inexistente.`);
        continue;
      }
      try {
        this.drawSeal(page, anchor, signer, helv, helvBold, input.verificationCode);
      } catch (error) {
        // Nunca deixe um selo individual inviabilizar o documento inteiro.
        this.logger.error(
          `Falha ao desenhar o selo de ${signer.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    // Rodapé de verificação em TODAS as páginas — o padrão que Clicksign e
    // ZapSign adotam, e evidência barata e de alto sinal.
    const footer = winAnsi(
      `Orcamento no ${input.budgetNumber} · Envelope ${input.verificationCode} · ` +
        `SHA-256 ${input.originalSha256.slice(0, 16)}... · Verifique em ${input.verificationUrl}`,
    );
    pages.forEach((page, index) => {
      const { width } = page.getSize();
      const size = 6;
      const text = `${footer} · pag. ${index + 1}/${pages.length}`;
      const w = helv.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: Math.max((width - w) / 2, 8),
        y: 12,
        size,
        font: helv,
        color: GRAY,
      });
    });

    const bytes = await doc.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  }

  private drawSeal(
    page: PDFPage,
    anchor: SignatureAnchorMap[string],
    signer: AssemblerSigner,
    helv: PDFFont,
    helvBold: PDFFont,
    verificationCode: string,
  ): void {
    const { height: pageHeightPt } = page.getSize();

    // As âncoras são medidas dentro de `.page-signatures`, que é a CAIXA DE
    // CONTEÚDO — ou seja, já descontadas as margens da @page. Logo a conversão é
    // a razão fixa px→pt, e as margens entram como deslocamento. Usar
    // `pageWidthPt / pageWidthCss` estaria errado duas vezes: daria escala 0,984
    // em vez de 0,75 e ignoraria o deslocamento de 25mm, jogando os selos para
    // fora da margem esquerda.
    const scale = PX_TO_PT;
    const offsetX = mmToPt(PAGE_MARGINS_MM.left);
    const offsetY = mmToPt(PAGE_MARGINS_MM.top);

    const x = offsetX + anchor.x * scale;
    const w = anchor.width * scale;
    const hRaw = anchor.height * scale;
    // Recuo inferior para o selo não encostar na linha de assinatura logo abaixo.
    const bottomInset = 4;
    const h = Math.max(hRaw - bottomInset, 10);
    // pdf-lib tem origem no canto inferior-esquerdo; o DOM, no superior-esquerdo.
    const y = pageHeightPt - offsetY - (anchor.y + anchor.height) * scale + bottomInset;

    const pad = 4;
    // Moldura PRETA sobre o papel, sem fundo: o selo é uma marca aposta ao
    // documento, não um elemento da identidade visual da Ankaa. A moldura verde
    // com fundo esverdeado o fazia parecer parte do layout do orçamento — e, num
    // documento assinado, o carimbo precisa se distinguir do impresso.
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: DARK,
      borderWidth: 0.8,
      borderOpacity: 1,
    });

    const lines: Array<{ text: string; bold?: boolean; size: number; color?: typeof DARK }> = [
      { text: 'ASSINADO ELETRONICAMENTE', bold: true, size: 6.5, color: DARK },
      { text: winAnsi(signer.name), bold: true, size: 8 },
    ];

    if (signer.cargo) lines.push({ text: winAnsi(signer.cargo), size: 6.5, color: GRAY });
    if (signer.companyLabel)
      lines.push({ text: winAnsi(signer.companyLabel), size: 6.5, color: GRAY });

    const idParts: string[] = [];
    if (signer.cpf) idParts.push(`CPF ${maskCpf(signer.cpf)}`);
    if (signer.phone) idParts.push(maskPhone(signer.phone));
    if (idParts.length) lines.push({ text: winAnsi(idParts.join('  ')), size: 6.5, color: GRAY });

    if (signer.signedAt)
      lines.push({ text: winAnsi(formatDateTimeBR(signer.signedAt)), size: 6.5, color: GRAY });

    lines.push({ text: winAnsi(signer.authMethodLabel), size: 6, color: GRAY });
    // winAnsi() aqui também: era a única linha do arquivo que escapava dele.
    if (signer.ipAddress)
      lines.push({ text: winAnsi(`IP ${signer.ipAddress}`), size: 6, color: GRAY });
    lines.push({ text: winAnsi(`Envelope ${verificationCode}`), size: 6, color: GRAY });

    // Espaçamento entre linhas DERIVADO da altura disponível, não fixo em 1,8pt.
    //
    // Com o valor fixo, um selo na altura padrão (`--seal-height: 26mm`, que dá
    // 69,7pt úteis) comportava 7 das 9 linhas: as duas últimas — o IP e o CÓDIGO
    // DO ENVELOPE, que a §5.8 exige dentro do selo — desapareciam sem qualquer
    // sinal. Medido: percurso útil de 55,7pt contra 74,7pt necessários.
    // Derivando o espaçamento, as nove linhas cabem e o selo passa a dizer o que
    // deveria dizer. O piso de 0,4pt e o teto de 1,8pt preservam o ritmo quando
    // há folga (poucas linhas) e impedem que os glifos se toquem quando não há.
    const travel = h - pad * 2 - 6;
    const sizesBeforeLast = lines.slice(0, -1).reduce((acc, l) => acc + l.size, 0);
    const leading =
      lines.length > 1
        ? Math.min(Math.max((travel - sizesBeforeLast) / (lines.length - 1), 0.4), 1.8)
        : 1.8;

    const innerWidth = Math.max(w - pad * 2, 1);

    // Tolerância de meio ponto no teste de corte. Quando o espaçamento é
    // derivado, a última linha aterrissa EXATAMENTE em `y + pad` em aritmética
    // real — e o ruído de ponto flutuante decidia, a cada documento, se ela
    // aparecia ou não. Meio ponto abaixo do respiro a baseline ainda deixa o
    // descendente de uma linha de 6pt a ~2,3pt da moldura, então nada encosta na
    // borda; o que se ganha é determinismo.
    const cutoff = y + pad - 0.5;

    // Distribui de cima para baixo dentro do retângulo, cortando o que não couber
    // em vez de vazar para fora da moldura.
    let cursor = y + h - pad - 6;
    for (const line of lines) {
      if (cursor < cutoff) break;
      const font = line.bold ? helvBold : helv;
      // Cada linha é ajustada à largura ÚTIL da moldura. Sem isso, um `cargo` ou
      // uma razão social longa escapava do retângulo pelos dois lados: na grade
      // de 3 colunas (4+ signatários) a caixa tem 154,9pt e "TRANSPORTES ...
      // RODOVIARIOS LTDA" mede 200,6pt a 6,5pt, ou seja 26,8pt para fora de cada
      // lado — mais que os 22,7pt de vão entre caixas. O texto de um signatário
      // invadia literalmente o selo do signatário vizinho.
      const fitted = fitToWidth(font, line.text, line.size, innerWidth);
      const tw = font.widthOfTextAtSize(fitted.text, fitted.size);
      const tx = x + Math.max((w - tw) / 2, pad);
      page.drawText(fitted.text, {
        x: tx,
        y: cursor,
        size: fitted.size,
        font,
        color: line.color ?? DARK,
      });
      // Avança pelo tamanho ORIGINAL: encolher uma linha não pode desalinhar as
      // demais nem desfazer o cálculo de entrelinha feito acima.
      cursor -= line.size + leading;
    }
  }

  /**
   * Páginas de "Trilha de Auditoria", no formato que Clicksign e Autentique
   * consagraram e que peritos e magistrados já reconhecem.
   *
   * Aqui o CPF vai COMPLETO: esta é a peça probatória, entregue apenas às partes.
   * O selo visual e o portal público mostram a forma mascarada. Mascare a
   * exibição, nunca o registro.
   */
  async buildAuditPages(input: AssembleInput): Promise<Buffer> {
    const doc = new PDFKitDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 50, right: 50 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>(resolve =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const green = BRAND_COLORS.primaryGreen;
    const gray = BRAND_COLORS.textGray;

    doc.font('Helvetica-Bold').fontSize(14).fillColor(green).text('Trilha de Auditoria');
    doc.moveDown(0.2);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(gray)
      .text('Datas e horarios em GMT-03:00 (Brasilia).');
    doc.moveDown(0.8);

    doc.fontSize(9).fillColor('#1a1a1a');
    doc.text(winAnsi(`Orcamento no ${input.budgetNumber}`));
    doc.text(winAnsi(`Documento numero ${input.envelopeId}`));
    doc.text(winAnsi(`Codigo de verificacao: ${input.verificationCode}`));
    doc.font('Helvetica').fontSize(7.5).fillColor(gray);
    doc.text(winAnsi(`Hash SHA-256 do documento original: ${input.originalSha256}`));
    doc.text(winAnsi(`Hash final da cadeia de auditoria: ${input.chainTip}`));
    doc.moveDown(1);

    // ---- Signatários ----
    doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text('Signatarios');
    doc.moveDown(0.4);

    for (const s of input.signers) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a');
      doc.text(winAnsi(`${s.signedAt ? '[ASSINADO] ' : '[PENDENTE] '}${s.name}`));
      doc.font('Helvetica').fontSize(8).fillColor(gray);
      const details: string[] = [];
      if (s.cpf) details.push(`CPF: ${formatCpf(s.cpf)}`);
      if (s.cargo) details.push(`Cargo: ${s.cargo}`);
      if (s.companyLabel) details.push(s.companyLabel);
      if (details.length) doc.text(winAnsi(details.join('  |  ')), { indent: 10 });
      const meta: string[] = [];
      if (s.phone) meta.push(`Telefone: ${maskPhone(s.phone)}`);
      meta.push(`Autenticacao: ${s.authMethodLabel}`);
      if (s.ipAddress) meta.push(`IP: ${s.ipAddress}`);
      doc.text(winAnsi(meta.join('  |  ')), { indent: 10 });
      if (s.signedAt) doc.text(winAnsi(`Assinou em ${formatDateTimeBR(s.signedAt)}`), { indent: 10 });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);

    // ---- Log encadeado ----
    doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text('Log de eventos');
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(gray)
      .text(
        winAnsi(
          'Cada evento carrega o hash do anterior. Remover, reordenar ou editar qualquer ' +
            'linha quebra todos os elos seguintes, e a quebra e verificavel de forma independente.',
        ),
      );
    doc.moveDown(0.5);

    for (const e of input.events) {
      if (doc.y > 760) doc.addPage();
      doc.font('Helvetica').fontSize(7.5).fillColor('#1a1a1a');
      const when = formatDateTimeBR(e.occurredAt);
      const ip = e.ipAddress ? `  IP ${e.ipAddress}` : '';
      doc.text(winAnsi(`${String(e.sequence).padStart(3, '0')}  ${when}  ${e.description}${ip}`));
      doc.fillColor(gray).fontSize(6).text(winAnsi(`      hash ${e.hash}`));
      doc.moveDown(0.15);
    }

    // ---- Cláusula de aceitação ----
    // Sai do corpo do orçamento (a pedido) mas permanece AQUI: é o gancho do
    // art. 10, §2º da MP 2.200-2/2001 ("admitido pelas partes como válido"), e a
    // trilha de auditoria é justamente a peça probatória entregue às partes.
    if (input.acceptanceClause) {
      if (doc.y > 660) doc.addPage();
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(green).text('Aceitacao do meio eletronico');
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(7.5).fillColor(gray);
      doc.text(winAnsi(input.acceptanceClause), { align: 'justify' });
      doc.moveDown(0.3);
      doc.text(
        winAnsi(
          'Aceita por cada signatario no ato da assinatura, com registro de data, hora e IP no log acima.',
        ),
      );
    }

    // ---- Rodapé jurídico ----
    if (doc.y > 690) doc.addPage();
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(7).fillColor(gray);
    doc.text(
      winAnsi(
        'Documento assinado eletronicamente. As assinaturas eletronicas tem validade juridica nos ' +
          'termos da Medida Provisoria no 2.200-2/2001, art. 10, § 2o. Verifique a autenticidade em ' +
          `${input.verificationUrl} ou, quanto ao selo ICP-Brasil, em https://validar.iti.gov.br/.`,
        ),
      { align: 'justify' },
    );
    doc.moveDown(0.5);
    doc.text(winAnsi(`${COMPANY.corporateName} — CNPJ ${COMPANY.cnpjFormatted}`));

    doc.end();
    return done;
  }

  /** Une o documento carimbado com as páginas de auditoria. */
  async mergeWithAudit(stamped: Buffer, auditPages: Buffer): Promise<Buffer> {
    const out = await PDFDocument.load(stamped, { updateMetadata: false });
    const audit = await PDFDocument.load(auditPages, { updateMetadata: false });
    const copied = await out.copyPages(audit, audit.getPageIndices());
    copied.forEach(p => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  }
}
