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
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  PDFFont,
  PDFPage,
  PDFDict,
  PDFName,
  PDFArray,
} from 'pdf-lib';
// Alias obrigatorio: pdf-lib tambem exporta `PDFDocument`.
import PDFKitDocument from 'pdfkit';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { COMPANY, BRAND_COLORS } from '@/config/company';
import { LateSlotAnchor, LateSlotAnchorMap, SignatureAnchorMap } from './quote-renderer.service';
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
  /**
   * Segunda linha, indentada, com o CONTEÚDO do evento.
   *
   * Existe por causa do cadastro tardio do veículo. Implemento 0 km é orçado sem
   * placa e sem chassi — eles chegam semanas depois — então o documento
   * congelado, que é o que foi assinado, não pode tê-los. Sem esta linha o dado
   * não existia em lugar nenhum do artefato: nem no corpo (congelado, e com
   * razão), nem na trilha (que só imprimia o rótulo do evento). O leitor via
   * "Cadastro alterado após o congelamento" sem saber o quê.
   *
   * A trilha é o lugar CERTO para isso: é encadeada por hash, então a linha
   * carrega data, ordem e integridade próprias, e fica explícito que o dado veio
   * DEPOIS — que é exatamente a verdade que um anexo no corpo esconderia.
   */
  detail?: string | null;
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
  /**
   * O RECORTE que este artefato reproduz ("Documento completo", "Layout", …).
   *
   * Só vem preenchido quando a coleta congelou mais de um recorte, e é impresso
   * na trilha porque sem ele o artefato mente por omissão: um PDF que traz só a
   * arte, com selo PAdES e trilha completa, se apresenta como "o orçamento
   * assinado" para quem o abrir fora de contexto. Dizer qual pedaço ele é — no
   * lugar do documento onde a integridade é atestada — é o que impede que a
   * ausência de uma cláusula seja lida como inexistência dela.
   */
  variantLabel?: string | null;
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
    /**
     * Lacunas medidas na emissão (série, placa, chassi) e os valores que o
     * cadastro já tem AGORA. O que chegou depois do congelamento é carimbado no
     * lugar reservado para ele; o que ainda não chegou mantém "a registrar".
     *
     * Só preenche lacuna VAZIA. Carimbar por cima de um valor impresso taparia
     * o que o signatário leu, e isso não é acréscimo — é reescrita, e continua
     * exigindo ressalva datada na trilha.
     */
    lateSlots?: LateSlotAnchorMap | null;
    lateValues?: Record<string, string | null | undefined> | null;
  }): Promise<Buffer> {
    const doc = await PDFDocument.load(input.originalPdf, { updateMetadata: false });
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();

    if (input.voidedLabel) {
      this.drawVoidWatermark(pages, helvBold, input.voidedLabel);
    }

    // Um documento JÁ marcado como sem validade pode — e deve — mostrar quem
    // havia assinado antes da invalidação.
    //
    // O gate por status existe para não estampar "ASSINADO ELETRONICAMENTE"
    // sobre uma assinatura anulada num documento que, fora de contexto, passaria
    // por válido. A marca d'água remove esse risco: ela já diz, no próprio
    // artefato e em todas as páginas, que aquilo não vale. Continuar escondendo
    // o selo aqui apagaria o fato histórico que o histórico de versões existe
    // para preservar — quem assinou, quando, por qual canal —, e essa é
    // exatamente a pergunta que se faz ao abrir uma versão anterior.
    //
    // Sem marca d'água o gate segue estrito: num envelope ainda vivo, um
    // signatário VOIDED individualmente não pode aparecer como assinado.
    const documentIsVoided = !!input.voidedLabel;

    for (const signer of input.signers) {
      if (!signer.signedAt) continue; // slot pendente permanece em branco
      if (signer.status !== 'SIGNED' && !documentIsVoided) continue;
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

    this.stampLateValues(pages, input.lateSlots, input.lateValues, helvBold);

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

  /**
   * Rodapé de página do orçamento renderizado SOB DEMANDA (sem envelope).
   *
   * O artefato assinado leva, em TODAS as páginas, a faixa
   * `Orcamento no N · Envelope … · SHA-256 … · Verifique em … · pag. i/n`
   * (ver o fim de `stampSeals`). O orçamento sob demanda sai do MESMO template,
   * com a mesma folha de assinaturas, e ainda assim saía sem faixa nenhuma —
   * nem o número da página. Num orçamento de duas folhas entregue solto, ou
   * dentro de um dossiê de vinte, isso é a diferença entre um documento
   * paginado e um maço de folhas.
   *
   * Vai aqui só o que EXISTE sem coleta: número do orçamento e paginação. Não há
   * código de verificação nem hash congelado, e imprimir qualquer um dos dois
   * convidaria o cliente a conferir uma prova que não foi produzida. Posição,
   * corpo e cor são os mesmos da faixa assinada, de modo que as duas versões do
   * documento se sobrepõem.
   */
  async stampPlainFooter(originalPdf: Buffer, budgetNumber: number): Promise<Buffer> {
    const doc = await PDFDocument.load(originalPdf, { updateMetadata: false });
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const prefix = winAnsi(`Orcamento no ${budgetNumber}`);

    pages.forEach((page, index) => {
      const { width } = page.getSize();
      const size = 6;
      const text = `${prefix} · pag. ${index + 1}/${pages.length}`;
      const w = helv.widthOfTextAtSize(text, size);
      page.drawText(text, {
        x: Math.max((width - w) / 2, 8),
        y: 12,
        size,
        font: helv,
        color: GRAY,
      });
    });

    return Buffer.from(await doc.save({ useObjectStreams: false }));
  }

  /**
   * Carimba, na frase do veículo, a identidade que chegou DEPOIS do
   * congelamento — série, placa, chassi.
   *
   * O documento não é re-renderizado: os bytes originais continuam sendo os que
   * foram assinados, e é sobre eles que o valor é desenhado, no retângulo que o
   * navegador mediu na emissão. É a mesma mecânica do selo de assinatura, e pela
   * mesma razão: reescrever a frase reflui o parágrafo, desloca as âncoras dos
   * selos e muda o hash que amarra a trilha ao documento.
   *
   * Só preenche o que estava em branco. Preencher lacuna anunciada é acréscimo —
   * quem assinou viu que faltava aquele dado, como vê uma linha de assinatura
   * ainda vazia. Trocar um valor já impresso é outra coisa, e não passa por aqui.
   */
  private stampLateValues(
    pages: PDFPage[],
    slots: LateSlotAnchorMap | null | undefined,
    values: Record<string, string | null | undefined> | null | undefined,
    fontBold: PDFFont,
  ): void {
    if (!slots || !values) return;
    for (const [key, slot] of Object.entries(slots)) {
      const value = (values[key] ?? '').trim();
      if (!value) continue;
      const page = pages[slot.page];
      if (!page) {
        this.logger.warn(`Lacuna "${key}" aponta para página inexistente — não carimbada.`);
        continue;
      }
      try {
        this.drawLateValue(page, slot, value, fontBold);
      } catch (error) {
        // Mesma regra do selo: um carimbo não inviabiliza o documento inteiro.
        this.logger.error(
          `Falha ao carimbar "${key}": ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private drawLateValue(
    page: PDFPage,
    slot: LateSlotAnchor,
    value: string,
    fontBold: PDFFont,
  ): void {
    const { height: pageHeightPt } = page.getSize();
    // Mesma conversão do selo: as medidas são relativas à caixa de conteúdo, e
    // as margens da @page entram como deslocamento.
    const scale = PX_TO_PT;
    const offsetX = mmToPt(PAGE_MARGINS_MM.left);
    const offsetY = mmToPt(PAGE_MARGINS_MM.top);

    const x = offsetX + slot.x * scale;
    const w = slot.width * scale;
    const h = slot.height * scale;
    const top = pageHeightPt - offsetY - slot.y * scale;
    const bottom = top - h;

    // 1. Apaga o "a registrar" com papel branco. A caixa é exatamente a do
    //    marcador, então nada em volta é tocado.
    page.drawRectangle({ x, y: bottom, width: w, height: h, color: rgb(1, 1, 1) });

    // 2. O valor, no corpo e na linha de base do texto ao redor — a largura já
    //    foi reservada para ele, então `fitToWidth` só age no caso extremo de um
    //    número de série maior que o previsto.
    const size = slot.fontSizeCss * scale;
    const stampText = winAnsi(value);
    const fitted = fitToWidth(fontBold, stampText, size, w);
    if (fitted.text !== stampText) {
      // Só acontece com um valor maior que o previsto para o campo (ver
      // LATE_SLOT_WIDTH_CH). O documento não mente — a trilha guarda o valor
      // inteiro —, mas a lacuna precisa crescer.
      this.logger.warn(
        `Valor tardio não coube na lacuna e foi ajustado: "${value}" -> "${fitted.text}".`,
      );
    }
    const textWidth = fontBold.widthOfTextAtSize(fitted.text, fitted.size);
    const baseline = pageHeightPt - offsetY - (slot.y + slot.baselineCss) * scale;
    page.drawText(fitted.text, {
      x: x + Math.max((w - textWidth) / 2, 0),
      y: baseline,
      size: fitted.size,
      font: fontBold,
      color: DARK,
    });

    // 3. O filete de volta, com a mesma espessura e cor do que o navegador
    //    desenhou nos campos já preenchidos (`border-bottom: 1px` = 0,75pt), de
    //    modo que a linha carimbada e a impressa sejam a MESMA linha.
    page.drawLine({
      start: { x, y: bottom + 0.375 },
      end: { x: x + w, y: bottom + 0.375 },
      thickness: 0.75,
      color: GRAY,
    });
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
    if (input.variantLabel) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a');
      doc.text(winAnsi(`Recorte deste documento: ${input.variantLabel}`));
      doc.font('Helvetica').fontSize(8).fillColor(gray);
      doc.text(
        winAnsi(
          'Este arquivo reproduz as secoes do orcamento pertinentes a funcao dos signatarios ' +
            'listados abaixo. O orcamento completo foi assinado integralmente pela contratada e ' +
            'pode ser conferido no codigo de verificacao acima.',
        ),
      );
      doc.moveDown(0.4);
    }
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
      if (e.detail) {
        doc
          .fillColor('#1a1a1a')
          .fontSize(6.5)
          .text(winAnsi(`      ${e.detail}`), { indent: 0 });
      }
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
  /**
   * Junta os RECORTES de uma coleta num arquivo só, para leitura interna.
   *
   * É uma VISUALIZAÇÃO, e o comentário precisa dizer isso porque a distinção é a
   * única coisa que impede este método de destruir prova: o `save()` do pdf-lib
   * reescreve o arquivo inteiro, então qualquer merge apaga a assinatura PAdES
   * das partes — é garantido, não é questão de cuidado. Por isso:
   *
   *  · os artefatos selados continuam intocados no disco e no `finalFileId` de
   *    cada `EnvelopeDocument`, que seguem sendo O instrumento;
   *  · cada um entra AQUI TAMBÉM como anexo (`/EmbeddedFiles`), byte a byte, de
   *    modo que quem receber o arquivo junto tenha como validar cada recorte;
   *  · os widgets de assinatura são removidos das páginas copiadas — sem isso o
   *    visualizador anunciaria uma assinatura digital que este arquivo não tem,
   *    que é exatamente a confusão que a decisão acima existe para evitar.
   *
   * @param parts   Os PDFs a copiar, na ordem de leitura (completo primeiro).
   * @param attachments  Os bytes SELADOS a anexar, com nome e descrição.
   */
  async mergeDocuments(
    parts: readonly Buffer[],
    attachments: ReadonlyArray<{ name: string; bytes: Buffer; description: string }> = [],
    title?: string,
  ): Promise<Buffer> {
    const out = await PDFDocument.create();
    if (title) out.setTitle(title);
    out.setProducer(COMPANY.name);
    out.setCreator(COMPANY.name);

    for (const part of parts) {
      const src = await PDFDocument.load(part, {
        updateMetadata: false,
        ignoreEncryption: true,
      });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const page of pages) {
        stripSignatureWidgets(page.node);
        out.addPage(page);
      }
    }

    for (const attachment of attachments) {
      await out.attach(new Uint8Array(attachment.bytes), attachment.name, {
        mimeType: 'application/pdf',
        description: attachment.description,
      });
    }

    return Buffer.from(await out.save({ useObjectStreams: false }));
  }

  /**
   * ADITIVO DE IDENTIFICAÇÃO DO VEÍCULO — uma folha, selada à parte.
   *
   * POR QUE ELE EXISTE, E POR QUE NÃO É UM REMENDO NO DOCUMENTO ASSINADO
   *   O orçamento de um implemento 0 km é assinado — e selado — semanas antes de
   *   o veículo existir. A ordem é do negócio, não do software: a assinatura É a
   *   aprovação, o caminhão só vem para a empresa depois de aprovado, e o chassi
   *   só se lê com ele no pátio. O documento reserva o espaço com "a registrar" e
   *   o selo PAdES congela os bytes ali.
   *
   *   Consertar por dentro é impossível: um byte alterado quebra o A1. Então o
   *   aditivo resolve por ACRÉSCIMO — cita o hash do documento assinado, nomeia
   *   quem o assinou e quando, e declara o que faltava com a data em que chegou.
   *   O assinado continua intocado; passa a viajar acompanhado.
   *
   * SEM SELO VISUAL DE ASSINATURA e sem trilha: isto não é assinado por ninguém.
   * É uma declaração da CONTRATADA, e o que a atesta é o selo PAdES aplicado
   * depois, pelo mesmo certificado do documento a que ela se refere.
   */
  async buildVehicleAddendum(input: {
    budgetNumber: number;
    verificationCode: string;
    verificationUrl: string;
    /** SHA-256 do artefato SELADO a que este aditivo se refere. */
    signedSha256: string | null;
    sealedAt: Date | null;
    customerLabel: string | null;
    /** Quem assinou o orçamento, para o aditivo nomear as partes. */
    signers: Array<{ name: string; cargo: string | null; signedAt: Date | null }>;
    /** Os campos que estavam reservados, com o valor de hoje e quando chegou. */
    fields: Array<{ label: string; value: string | null; registeredAt: Date | null }>;
  }): Promise<Buffer> {
    const doc = new PDFKitDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>(resolve =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const green = BRAND_COLORS.primaryGreen;
    const gray = BRAND_COLORS.textGray;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ---- Cabeçalho da empresa ----
    //
    // O aditivo VIAJA SOZINHO: ele é anexado ao dossiê com nome próprio e o
    // cliente pode abri-lo sem o orçamento ao lado. As páginas de trilha podem
    // ser sóbrias porque estão encadernadas DENTRO do documento assinado, que já
    // tem cabeçalho; esta folha não tem essa moldura, e sem logo nem rodapé
    // chegaria ao cliente parecendo um rascunho.
    const logoPath = resolve(process.cwd(), 'assets', 'logo.png');
    const headerTop = doc.y;
    if (existsSync(logoPath)) {
      try {
        doc.image(logoPath, doc.page.margins.left, headerTop, { fit: [110, 34] });
      } catch {
        // Logo ilegível não pode derrubar a emissão do aditivo.
      }
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(green);
    doc.text(winAnsi(COMPANY.name), doc.page.margins.left, headerTop + 6, {
      width,
      align: 'right',
    });
    doc.y = headerTop + 40;
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(2)
      .strokeColor(green)
      .stroke();
    doc.y += 14;

    doc.font('Helvetica-Bold').fontSize(14).fillColor(green);
    doc.text(winAnsi('Aditivo de Identificação do Veículo'), doc.page.margins.left, doc.y, {
      width,
    });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8).fillColor(gray);
    doc.text(winAnsi('Datas e horários em GMT-03:00 (Brasília).'));
    doc.moveDown(0.9);

    // ---- A que documento isto se refere ----
    doc.font('Helvetica').fontSize(9.5).fillColor('#1a1a1a');
    doc.text(
      winAnsi(
        `Este aditivo integra o orçamento nº ${input.budgetNumber}` +
          `${input.customerLabel ? `, emitido para ${input.customerLabel}` : ''}, assinado ` +
          `eletronicamente${input.sealedAt ? ` e selado em ${formatDateTimeBR(input.sealedAt)}` : ''}.`,
      ),
      { align: 'justify' },
    );
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(8).fillColor(gray);
    doc.text(winAnsi(`Código de verificação: ${input.verificationCode}`));
    if (input.signedSha256) {
      doc.text(winAnsi(`Hash SHA-256 do documento assinado: ${input.signedSha256}`));
    }
    doc.moveDown(1);

    // ---- Quem assinou ----
    if (input.signers.length) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text(winAnsi('Signatários do orçamento'));
      doc.moveDown(0.35);
      for (const s of input.signers) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a');
        doc.text(winAnsi(s.name));
        const meta: string[] = [];
        if (s.cargo) meta.push(s.cargo);
        if (s.signedAt) meta.push(`assinou em ${formatDateTimeBR(s.signedAt)}`);
        if (meta.length) {
          doc.font('Helvetica').fontSize(8).fillColor(gray);
          doc.text(winAnsi(meta.join('  |  ')), { indent: 10 });
        }
      }
      doc.moveDown(1);
    }

    // ---- O que faltava, e o que chegou ----
    doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text(winAnsi('Identificação registrada'));
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(gray);
    doc.text(
      winAnsi(
        'No momento da assinatura os campos abaixo ainda não existiam, e o documento ' +
          'reservou o espaço deles com a marcação "a registrar". Eles foram registrados nas ' +
          'datas indicadas e ficam declarados aqui.',
      ),
      { align: 'justify' },
    );
    doc.moveDown(0.6);

    for (const field of input.fields) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a1a1a');
      doc.text(winAnsi(`${field.label}: ${field.value ?? 'não registrado'}`));
      doc.font('Helvetica').fontSize(8).fillColor(gray);
      doc.text(
        winAnsi(
          field.registeredAt
            ? `registrado em ${formatDateTimeBR(field.registeredAt)}`
            : 'ainda não registrado no cadastro',
        ),
        { indent: 10 },
      );
      doc.moveDown(0.35);
    }

    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(8).fillColor(gray);
    doc.text(
      winAnsi(
        'Este aditivo NÃO altera o orçamento assinado, que permanece íntegro e verificável ' +
          'pelo código acima. Ele acrescenta a identificação do veículo a que aquele documento ' +
          'se refere, obtida após a assinatura por ser esse o momento em que o veículo passou a ' +
          'existir. A autenticidade desta folha é atestada pelo selo ICP-Brasil aplicado a ela.',
      ),
      { align: 'justify' },
    );
    doc.moveDown(0.6);
    doc.fontSize(7.5).text(winAnsi(input.verificationUrl));

    // ---- Rodapé ----
    // Espelha o do orçamento (régua verde + razão social + contato), para que as
    // duas folhas se leiam como o mesmo documento. Ancorado ao PÉ da página, não
    // ao fluxo: o aditivo é curto e o rodapé flutuaria no meio da folha.
    const footerY = doc.page.height - doc.page.margins.bottom - 34;
    doc
      .moveTo(doc.page.margins.left, footerY)
      .lineTo(doc.page.width - doc.page.margins.right, footerY)
      .lineWidth(2)
      .strokeColor(green)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(green);
    doc.text(winAnsi(COMPANY.name), doc.page.margins.left, footerY + 6, { width });
    doc.font('Helvetica').fontSize(7.5).fillColor(gray);
    doc.text(winAnsi(`${COMPANY.address} · ${COMPANY.phone} · ${COMPANY.websiteUrl}`), {
      width,
    });

    doc.end();
    return done;
  }

  async mergeWithAudit(stamped: Buffer, auditPages: Buffer): Promise<Buffer> {
    const out = await PDFDocument.load(stamped, { updateMetadata: false });
    const audit = await PDFDocument.load(auditPages, { updateMetadata: false });
    const copied = await out.copyPages(audit, audit.getPageIndices());
    copied.forEach(p => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: false });
    return Buffer.from(bytes);
  }
}

/**
 * Tira das páginas copiadas o campo /Sig que o `copyPages` arrasta junto.
 *
 * Um widget de assinatura órfão faz o visualizador anunciar uma assinatura que
 * o arquivo não carrega. Gêmeo do helper do dossiê, pelo mesmo motivo.
 */
function stripSignatureWidgets(pageNode: PDFDict): void {
  try {
    const annots = pageNode.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = pageNode.context.lookupMaybe(annots.get(i), PDFDict);
      if (!annot) continue;
      const ft = annot.lookup(PDFName.of('FT'));
      const subtype = annot.lookup(PDFName.of('Subtype'));
      const isSigWidget =
        ft === PDFName.of('Sig') ||
        (subtype === PDFName.of('Widget') && String(ft) === '/Sig');
      if (isSigWidget) annots.remove(i);
    }
  } catch {
    // Uma anotação exótica não pode derrubar a visualização inteira.
  }
}
