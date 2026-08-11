/**
 * Dossiê do orçamento — orçamento assinado + notas fiscais + boletos num PDF só.
 *
 * ORDEM DAS DECISÕES, porque elas não são intercambiáveis:
 *
 * 1. **O documento assinado NÃO é remontado.** Uma assinatura PDF cobre os bytes
 *    do arquivo; o pdf-lib reescreve o arquivo inteiro no `save()`, de modo que
 *    *qualquer* merge feito com ele destrói o selo A1 — não é questão de
 *    cuidado, é garantido. Por isso os bytes assinados entram aqui como ANEXO
 *    (`/EmbeddedFiles`), idênticos ao original, e continuam validando sozinhos.
 *
 * 2. **Boleto e NFS-e NÃO recebem o selo da Ankaa.** Selar documento de terceiro
 *    com o nosso certificado afirmaria algo que não é verdade: o A1 atesta que a
 *    Ankaa emitiu aquele documento. Boleto se valida pelo código de barras e
 *    NFS-e pelo portal da prefeitura e pelo XML — nunca pela assinatura do PDF.
 *    Logo o dossiê inteiro NÃO é selado: ele é um invólucro de transmissão, e o
 *    instrumento jurídico é o anexo do item 1.
 *
 * 3. **As páginas do orçamento aparecem como cópia legível.** Um anexo não é
 *    exibido ao abrir o PDF na maioria dos visualizadores — menos ainda no
 *    celular, que é onde o cliente abre o que chega por WhatsApp. Um dossiê em
 *    que o orçamento só existe como anexo seria, na prática, um dossiê sem
 *    orçamento. As páginas copiadas são idênticas às assinadas (mesmos selos
 *    visuais, mesmo rodapé com hash e código de verificação), e a capa diz, sem
 *    rodeios, que a cópia não carrega a assinatura digital e onde ela está.
 *
 * 4. **Sem capa e sem trilha de auditoria.** O que o cliente recebe é orçamento,
 *    fotos, nota e boleto. A trilha é instrumento de disputa judicial, não de
 *    comunicação comercial: ela permanece no artefato assinado que fica no
 *    servidor — e, quando o anexo é incluído, viaja dentro dele de qualquer
 *    forma, porque remover um byte do assinado quebraria o A1. Só existe a
 *    partir do selo: o `original.pdf` congelado nunca a teve. O manifesto é
 *    calculado e volta na resposta HTTP, mas não vira página.
 *
 * 5. **Ordem: orçamento, dossiê fotográfico, notas, boletos.** É a ordem da
 *    conversa com o cliente — o que foi combinado, o que foi feito, o que se
 *    cobra e como pagar.
 *
 * 6. **Sem envelope concluído, o dossiê existe assim mesmo.** O orçamento é
 *    renderizado sob demanda, com as linhas de assinatura em branco, e o
 *    componente é rotulado "SEM assinatura eletrônica". Recusar nesse caso
 *    deixaria sem documento justamente as tarefas antigas — que nunca passaram
 *    pela assinatura e são a maioria hoje. Nesse modo não há anexo: não existe
 *    artefato assinado para preservar.
 *
 * 7. **Faturamento com mais de um cliente: `customerId` recorta o dossiê.**
 *    Entram só a NFS-e e o boleto da fatura DAQUELE cliente — mandar ao cliente
 *    A a nota e o título de cobrança do cliente B é vazar documento fiscal
 *    alheio. E o ORÇAMENTO também é recortado (serviços, subtotal, desconto,
 *    total e condição de pagamento daquela configuração), porém SOMENTE no
 *    caminho não assinado, onde o documento é montado agora a partir dos dados.
 *
 *    Onde existe artefato assinado o orçamento sai inteiro, e isso não é
 *    inconsistência: um PDF assinado não se recorta — remover uma página quebra
 *    o A1 —, e re-renderizá-lo recortado seria entregar uma reconstrução no
 *    lugar do documento que o cliente assinou, exatamente o que a decisão 1
 *    proíbe. O que foi assinado é um contrato só, com o escopo inteiro e uma
 *    linha de assinatura por cliente. A fatia de cada um continua visível na
 *    tela do dossiê, que filtra por configuração.
 */

import { Injectable, Logger, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts, rgb } from 'pdf-lib';
import PDFKitDocument from 'pdfkit';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { COMPANY, BRAND_COLORS } from '@/config/company';
import { winAnsi } from '../document/quote-assembler.service';
import { dossierPdfFilename } from '../document/document-filename';
import { formatDateBR } from '../document/quote-text';
import { SignatureEnvelopeService } from '../services/signature-envelope.service';
import { ElotechOxyNfseService } from '@modules/integrations/nfse/elotech-oxy-nfse.service';
import { SicrediService } from '@modules/integrations/sicredi/sicredi.service';

export type DossierComponentKind = 'ORCAMENTO' | 'FOTOS' | 'NFSE' | 'BOLETO';

export interface DossierComponent {
  kind: DossierComponentKind;
  label: string;
  /** SHA-256 do arquivo de ORIGEM, não das páginas copiadas. */
  sha256: string | null;
  pages: number;
  included: boolean;
  /** Por que não entrou. Impresso na capa. */
  note?: string;
}

export interface DossierResult {
  pdf: Buffer;
  filename: string;
  components: DossierComponent[];
  /** Nome do anexo que carrega o orçamento assinado; null quando omitido. */
  attachmentName: string | null;
  /** Null quando o orçamento ainda não foi assinado. */
  verificationCode: string | null;
  budgetNumber: number;
}

@Injectable()
export class DossierAssemblerService {
  private readonly logger = new Logger(DossierAssemblerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // forwardRef dos DOIS lados: o SignatureEnvelopeService passou a injetar este
    // serviço para congelar o dossiê no selamento, então o par virou cíclico. Marcar
    // só um lado não basta — o Nest falha ao resolver o outro.
    @Inject(forwardRef(() => SignatureEnvelopeService))
    private readonly envelopes: SignatureEnvelopeService,
    private readonly elotech: ElotechOxyNfseService,
    private readonly sicredi: SicrediService,
  ) {}

  /**
   * @param options.attachSigned  Anexar o PDF assinado (padrão: sim).
   *
   *   ESCOLHA EXCLUSIVA, sem meio-termo possível: a trilha de auditoria foi
   *   selada JUNTO do orçamento, então o anexo que preserva o A1 carrega a
   *   trilha por construção — remover qualquer byte dela quebraria a assinatura.
   *   Com anexo, o cliente recebe a prova completa (e a trilha junto). Sem
   *   anexo, o dossiê vira um pacote apenas legível, sem nenhuma assinatura
   *   digital, e a prova fica só no servidor.
   *
   * @param options.customerId  Segmenta nota e boleto por cliente do faturamento
   *   (ver decisão 7). Omitido = dossiê completo, que é o que o congelamento no
   *   selo e a tela da tarefa pedem.
   */
  async build(
    quoteId: string,
    options: { attachSigned?: boolean; dropAuditTrail?: boolean; customerId?: string | null } = {},
  ): Promise<DossierResult> {
    const attachSigned = options.attachSigned !== false;
    // `''` chega da query string quando o front manda o parâmetro vazio, e
    // tratá-lo como id faria a validação abaixo recusar um pedido que é, na
    // verdade, "dossiê completo".
    const customerId = options.customerId?.trim() || null;
    // Padrão: SEM trilha. O que o cliente recebe é orçamento, fotos, nota e
    // boleto; a trilha é instrumento de disputa e vive no artefato assinado que
    // fica no servidor (e no anexo, que a carrega por construção).
    const dropAuditTrail = options.dropAuditTrail !== false;
    const quote = await this.prisma.taskQuote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        budgetNumber: true,
        customerConfigs: {
          orderBy: { createdAt: 'asc' },
          select: {
            customerId: true,
            customer: { select: { corporateName: true, fantasyName: true } },
          },
        },
        task: {
          select: {
            id: true,
            serialNumber: true,
            customer: { select: { corporateName: true, fantasyName: true, cnpj: true, cpf: true } },
            truck: { select: { plate: true } },
          },
        },
      },
    });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');

    // Cliente que não está no faturamento é RECUSADO, não ignorado. Cair no
    // dossiê completo em silêncio é justamente o defeito que a segmentação
    // corrige: quem pediu a fatia de um cliente receberia os documentos de
    // todos sem nenhum sinal de que o filtro não valeu.
    const selectedConfig = customerId
      ? (quote.customerConfigs.find(c => c.customerId === customerId) ?? null)
      : null;
    if (customerId && !selectedConfig) {
      throw new BadRequestException('Este cliente não faz parte do faturamento deste orçamento.');
    }

    // A chave é `finalFileId`, NÃO `status: COMPLETED`. O que o dossiê precisa
    // saber é "existe artefato assinado", e só o `finalize()` grava esse campo —
    // junto do selo PAdES, do `finalSha256` e do `sealedAt`. O status é uma
    // dimensão à parte que continua se movendo depois: um envelope selado passa a
    // `SUPERSEDED` quando uma reemissão é aberta, e chavear por `COMPLETED` faria
    // o dossiê perder o orçamento assinado EM SILÊNCIO, caindo no render não
    // assinado e entregando ao cliente um "SEM assinatura eletrônica" de um
    // documento que foi assinado e selado.
    const envelope = await this.prisma.signatureEnvelope.findFirst({
      where: { quoteId, finalFileId: { not: null } },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        verificationCode: true,
        finalSha256: true,
        sealedAt: true,
        padesLevel: true,
        finalFile: { select: { path: true, filename: true } },
        originalFile: { select: { path: true } },
      },
    });
    // SEM envelope concluído o dossiê continua existindo, com o orçamento
    // renderizado sob demanda e as linhas de assinatura em branco. Recusar aqui
    // deixaria sem documento justamente as tarefas antigas, que nunca passaram
    // pela assinatura eletrônica — e são a maioria. O rótulo do componente diz
    // que não está assinado, e não há anexo a preservar.
    const assinado = Boolean(envelope?.finalFile);
    // O recorte por cliente alcança o ORÇAMENTO só quando ele é renderizado sob
    // demanda. Havendo artefato assinado, o que entra são os bytes selados,
    // inteiros: não há como recortar um PDF assinado, e re-renderizá-lo
    // recortado entregaria uma reconstrução no lugar do documento que o cliente
    // assinou (decisão 1 no cabeçalho). Ver a decisão 7.
    const signedPdf = assinado
      ? this.readSignedDocument(envelope!.finalFile!.path, envelope!.finalSha256)
      : await this.envelopes.renderUnsignedQuoteDocument(quoteId, customerId);

    // Régua para cortar a trilha, quando pedido: o montador acrescenta as páginas
    // de trilha ao fim do original, então `original.pdf` marca onde o orçamento
    // termina. Sem a régua (arquivo sumiu do disco), copiam-se todas — melhor um
    // dossiê com trilha do que um truncado no lugar errado.
    const contentPageCount =
      assinado && dropAuditTrail ? await this.countPages(envelope!.originalFile?.path) : undefined;

    const components: DossierComponent[] = [];
    const bodies: Array<{ bytes: Buffer; component: DossierComponent; maxPages?: number }> = [];

    // ---- 1. Orçamento assinado (cópia legível) ----
    const budgetComponent: DossierComponent = {
      kind: 'ORCAMENTO',
      label: assinado
        ? `Orçamento nº ${quote.budgetNumber} — assinado eletronicamente`
        : `Orçamento nº ${quote.budgetNumber} — SEM assinatura eletrônica`,
      sha256: assinado ? envelope!.finalSha256 : sha256(signedPdf),
      pages: 0,
      included: true,
    };
    bodies.push({ bytes: signedPdf, component: budgetComponent, maxPages: contentPageCount });
    components.push(budgetComponent);

    // ---- 2. Dossiê fotográfico ----
    const fotos = await this.renderPhotoDossier(quote.task?.id, quote.budgetNumber);
    if (fotos) {
      const component: DossierComponent = {
        kind: 'FOTOS',
        label: 'Dossiê fotográfico — antes e depois por ordem de serviço',
        sha256: sha256(fotos),
        pages: 0,
        included: true,
      };
      components.push(component);
      bodies.push({ bytes: fotos, component });
    }

    // ---- 3. Notas fiscais ----
    for (const nfse of await this.listNfse(quote.task?.id, customerId)) {
      const component: DossierComponent = {
        kind: 'NFSE',
        label: `NFS-e nº ${nfse.nfseNumber ?? nfse.elotechNfseId}`,
        sha256: null,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = await this.elotech.getNfsePdf(nfse.elotechNfseId!);
        component.sha256 = sha256(bytes);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        // A NFS-e vive na Elotech, não em disco: uma indisponibilidade do
        // provedor não pode impedir o envio do dossiê, mas tem de aparecer.
        component.note = `não foi possível obter o PDF junto à prefeitura (${msg(error)})`;
        this.logger.warn(`NFS-e ${nfse.elotechNfseId} fora do dossiê: ${msg(error)}`);
      }
    }

    // ---- 4. Boletos ----
    for (const slip of await this.listBankSlips(quote.task?.id, customerId)) {
      const n = slip.installment?.number;
      const component: DossierComponent = {
        kind: 'BOLETO',
        label:
          // `toLocaleDateString` lê a data gravada pelo fuso do PROCESSO — o
          // vencimento é data de calendário (meio-dia UTC) e não pode depender
          // de onde o serviço roda. `formatDateBR` é a mesma formatação do
          // corpo do orçamento, então rótulo e cláusula nunca divergem.
          `Boleto${n ? ` ${n}` : ''} — vencimento ` +
          `${formatDateBR(slip.dueDate)} — ${formatBRL(Number(slip.amount))}`,
        sha256: null,
        pages: 0,
        included: false,
      };
      components.push(component);
      try {
        const bytes = await this.loadBankSlipPdf(slip);
        component.sha256 = sha256(bytes);
        component.included = true;
        bodies.push({ bytes, component });
      } catch (error) {
        component.note = `PDF indisponível (${msg(error)})`;
        this.logger.warn(`Boleto ${slip.id} fora do dossiê: ${msg(error)}`);
      }
    }

    // ---- 5. Montagem ----
    const attachmentName = `orcamento-${quote.budgetNumber}-assinado.pdf`;
    const container = await PDFDocument.create();
    container.setTitle(`Dossiê do Orçamento nº ${quote.budgetNumber}`);
    container.setProducer(COMPANY.name);
    container.setCreator(COMPANY.name);

    // Capa depois dos corpos? Não: ela precisa contar as páginas de cada
    // componente, então os corpos entram primeiro numa lista e a capa é
    // prependida ao final.
    for (const body of bodies) {
      const pageCount = await this.appendPdf(container, body.bytes, body.component, body.maxPages);
      body.component.pages = pageCount;
    }

    // Sem capa: ver a decisão 4 no cabeçalho deste arquivo.

    // ---- 6. O documento assinado, byte a byte ----
    // DEPOIS das páginas e ANTES do save: o anexo é um objeto do documento, e é
    // ele que preserva a assinatura A1 e a cadeia de auditoria intactas.
    if (attachSigned && assinado) {
      await container.attach(new Uint8Array(signedPdf), attachmentName, {
        mimeType: 'application/pdf',
        description:
          `Orçamento nº ${quote.budgetNumber} assinado eletronicamente — ` +
          `envelope ${envelope!.verificationCode}. Este é o documento com validade ` +
          `jurídica: extraia-o para validar a assinatura ICP-Brasil.`,
        creationDate: envelope!.sealedAt ?? undefined,
        modificationDate: envelope!.sealedAt ?? undefined,
      });
    }

    const pdf = Buffer.from(await container.save({ useObjectStreams: false }));

    return {
      pdf,
      // Razão social + "Dossiê" + número: ver `document-filename.ts`. O número é
      // o `budgetNumber` porque não existe sequência separada para o dossiê. No
      // modo segmentado quem nomeia é o cliente do RECORTE, não o da tarefa:
      // baixar os dois dossiês de um faturamento com dois clientes gravava dois
      // arquivos de mesmo nome, e o segundo sobrescrevia o primeiro.
      filename: dossierPdfFilename(
        selectedConfig?.customer ?? quote.task?.customer,
        quote.budgetNumber,
      ),
      components,
      attachmentName: attachSigned && assinado ? attachmentName : null,
      verificationCode: envelope?.verificationCode ?? null,
      budgetNumber: quote.budgetNumber,
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Lê os bytes assinados e CONFERE o hash contra o que o envelope registrou.
   *
   * O arquivo em disco é mutável; `finalSha256` foi gravado no momento do selo.
   * Divergir significa que o artefato não é mais aquele que foi assinado — e
   * seguir montando o dossiê distribuiria um documento que a trilha não cobre.
   */
  private readSignedDocument(path: string, expectedSha256: string | null): Buffer {
    if (!existsSync(path)) {
      throw new BadRequestException(
        'O PDF assinado deste orçamento não está mais disponível no servidor.',
      );
    }
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    if (expectedSha256 && actual !== expectedSha256) {
      throw new BadRequestException(
        'O arquivo assinado em disco não confere com o hash registrado no envelope. ' +
          'O dossiê não será gerado.',
      );
    }
    return bytes;
  }


  /**
   * Dossiê fotográfico: uma página por ordem de serviço, "ANTES" (check-in) e
   * "DEPOIS" (check-out).
   *
   * Porte FIEL de `web/src/utils/dossie-pdf-generator.ts` — mesmas margens
   * (62/28/50), mesmo cabeçalho com logo e régua verde, mesmo rodapé da empresa,
   * mesmo cartão de canto arredondado com barra verde, e a mesma regra de
   * encaixe da foto: largura da célula primeiro, altura só se estourar. As fotos
   * ficam ancoradas no topo-esquerda da célula, NÃO centralizadas — centralizar
   * abria vãos enormes em foto larga, que é o formato de quase toda foto de
   * implemento.
   *
   * A diferença real em relação ao gerador do browser é a fonte das imagens:
   * aqui saem do disco pelo `File.path`, sem requisição autenticada — é o que
   * permite servir o dossiê a quem não tem sessão.
   */
  private async renderPhotoDossier(
    taskId: string | undefined,
    budgetNumber: number,
  ): Promise<Buffer | null> {
    if (!taskId) return null;

    const orders = await this.prisma.serviceOrder.findMany({
      where: { taskId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        description: true,
        observation: true,
        checkinFiles: { select: { path: true, mimetype: true } },
        checkoutFiles: { select: { path: true, mimetype: true } },
      },
    });
    const comFotos = orders.filter(o => o.checkinFiles.length > 0 || o.checkoutFiles.length > 0);
    if (!comFotos.length) return null;

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const GREEN = hexToRgb(BRAND_COLORS.primaryGreen);
    const GRAY = rgb(0.33, 0.33, 0.33);
    const DARK = rgb(0.2, 0.2, 0.2);
    const WHITE = rgb(1, 1, 1);
    const ANTES = rgb(0.15, 0.39, 0.92);
    const DEPOIS = rgb(0.09, 0.64, 0.26);

    const W = 595.28;
    const H = 841.89;
    const ML = 62;
    const MR = 62;
    const MT = 28;
    const MB = 50;
    const CW = W - ML - MR;
    const CARD_RADIUS = 6;
    const FOOTER_TOP_Y = MB + 38;

    const logo = await this.embedLogo(doc);

    for (const [soIndex, so] of comFotos.entries()) {
      const page = doc.addPage([W, H]);

      // ---- cabeçalho ----
      let y = H - MT;
      if (logo) {
        const logoH = 42;
        page.drawImage(logo, {
          x: ML,
          y: y - logoH,
          width: logoH * (logo.width / logo.height),
          height: logoH,
        });
      }
      const titulo = winAnsi(`Dossie No ${budgetNumber}`);
      page.drawText(titulo, {
        x: W - MR - bold.widthOfTextAtSize(titulo, 16),
        y: y - 14,
        size: 16,
        font: bold,
        color: DARK,
      });
      const data = winAnsi(`Emissao: ${new Date().toLocaleDateString('pt-BR')}`);
      page.drawText(data, {
        x: W - MR - font.widthOfTextAtSize(data, 9),
        y: y - 28,
        size: 9,
        font,
        color: GRAY,
      });
      y -= 46;
      page.drawRectangle({ x: ML, y, width: CW, height: 1, color: GREEN });
      y -= 22;

      // ---- rodapé ----
      const lineY = MB + 26;
      page.drawRectangle({ x: ML, y: lineY, width: CW, height: 1, color: GREEN });
      page.drawText(winAnsi(COMPANY.name), { x: ML, y: lineY - 14, size: 10, font: bold, color: GREEN });
      page.drawText(winAnsi(COMPANY.address ?? ''), { x: ML, y: lineY - 26, size: 8, font, color: GRAY });
      page.drawText(winAnsi(COMPANY.phone ?? ''), { x: ML, y: lineY - 38, size: 8, font, color: GREEN });
      page.drawText(winAnsi(COMPANY.websiteUrl ?? ''), { x: ML, y: lineY - 50, size: 8, font, color: GREEN });

      if (soIndex === 0) {
        page.drawText(winAnsi('Dossie Fotografico'), { x: ML, y, size: 12, font: bold, color: GREEN });
        y -= 20;
      }

      // ---- cartão: verde arredondado + corpo branco por cima ----
      const base =
        so.description?.trim().toLowerCase() === 'outros' && so.observation
          ? so.observation
          : so.description || 'Servico';
      const desc =
        so.observation && so.description?.trim().toLowerCase() !== 'outros'
          ? `${base} ${so.observation}`
          : base;

      const cardPad = 8;
      const contentW = CW - cardPad * 2;
      const cardTop = y;
      const barH = 20;
      const cardH = cardTop - FOOTER_TOP_Y;

      page.drawSvgPath(roundedRectAllPath(CW, cardH, CARD_RADIUS), {
        x: ML,
        y: cardTop,
        color: GREEN,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.75,
      });
      page.drawSvgPath(roundedRectBottomPath(CW, cardH - barH, CARD_RADIUS), {
        x: ML,
        y: cardTop - barH,
        color: WHITE,
        borderWidth: 0,
      });
      page.drawText(winAnsi(desc), {
        x: ML + 10,
        y: cardTop - barH + 6,
        size: 10,
        font: bold,
        color: WHITE,
      });
      y = cardTop - barH - 10;

      // ---- fatiamento vertical entre ANTES e DEPOIS ----
      const secoes = [
        { rotulo: 'ANTES', cor: ANTES, arquivos: so.checkinFiles },
        { rotulo: 'DEPOIS', cor: DEPOIS, arquivos: so.checkoutFiles },
      ].filter(s => s.arquivos.length > 0);

      const labelH = 12;
      const postLabelGap = 6;
      const interSectionGap = 14;
      const interTotal = Math.max(0, secoes.length - 1) * interSectionGap;
      const alturaFotos =
        y - FOOTER_TOP_Y - secoes.length * (labelH + postLabelGap) - interTotal - 4;
      const slotH = secoes.length > 0 ? alturaFotos / secoes.length : 0;

      for (const [i, secao] of secoes.entries()) {
        if (slotH <= 20) break;
        page.drawText(winAnsi(secao.rotulo), {
          x: ML + cardPad,
          y,
          size: 8.5,
          font: bold,
          color: secao.cor,
        });
        y -= labelH;

        const cols = secao.arquivos.length === 1 ? 1 : 2;
        const gap = 6;
        const cellW = (contentW - (cols - 1) * gap) / cols;
        const rows = Math.ceil(secao.arquivos.length / cols);
        const cellH = (slotH - (rows - 1) * gap) / rows;

        for (let k = 0; k < secao.arquivos.length; k += cols) {
          for (const [c, file] of secao.arquivos.slice(k, k + cols).entries()) {
            const img = await this.embedImage(doc, file);
            if (!img) continue;
            const ratio = img.width / img.height;
            let w = cellW;
            let h = cellW / ratio;
            if (h > cellH) {
              h = cellH;
              w = cellH * ratio;
            }
            page.drawImage(img, {
              x: ML + cardPad + c * (cellW + gap),
              y: y - h,
              width: w,
              height: h,
            });
          }
          y -= cellH + gap;
        }
        y -= postLabelGap;
        if (i < secoes.length - 1) y -= interSectionGap;
      }
    }

    return Buffer.from(await doc.save({ useObjectStreams: false }));
  }

  /** Logo da empresa em `assets/logo.png`, a mesma que o orçamento usa. */
  private async embedLogo(doc: PDFDocument) {
    try {
      const p = resolve(process.cwd(), 'assets', 'logo.png');
      if (!existsSync(p)) return null;
      return await doc.embedPng(readFileSync(p));
    } catch {
      return null;
    }
  }

  /** JPEG/PNG por magic bytes. Qualquer outro formato é ignorado em silêncio. */
  private async embedImage(doc: PDFDocument, file: { path: string; mimetype: string }) {
    try {
      if (!existsSync(file.path)) return null;
      const bytes = readFileSync(file.path);
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
      return null;
    } catch (error) {
      this.logger.warn(`Foto ignorada (${file.path}): ${msg(error)}`);
      return null;
    }
  }

  /**
   * Páginas de um PDF em disco, ou null quando ele não existe.
   *
   * Serve de régua para cortar a trilha de auditoria do artefato assinado: o
   * montador acrescenta as páginas de trilha DEPOIS das do original, então
   * `original.pdf` diz exatamente onde o orçamento termina.
   */
  private async countPages(path: string | undefined): Promise<number | undefined> {
    if (!path || !existsSync(path)) return undefined;
    try {
      const doc = await PDFDocument.load(readFileSync(path), {
        updateMetadata: false,
        ignoreEncryption: true,
      });
      return doc.getPageCount() || undefined;
    } catch {
      // Sem a régua, copiam-se todas as páginas: melhor um dossiê com trilha do
      // que um dossiê truncado no lugar errado.
      return undefined;
    }
  }

  /**
   * Notas AUTORIZADAS da tarefa — e só as do cliente pedido, quando há um.
   *
   * No modo segmentado a nota SEM fatura sai fora, mesmo estando ligada à
   * tarefa: é por `Invoice.customerId` que uma NFS-e se atribui a um cliente
   * (o `NfseDocument` não guarda cliente nenhum), e nota órfã — o histórico
   * religado pelo id da tarefa — não tem a quem pertencer. Mandá-la no dossiê
   * de um dos clientes seria atribuí-la a ele por omissão. No modo completo ela
   * continua entrando, como sempre entrou.
   */
  private async listNfse(taskId: string | undefined, customerId: string | null) {
    if (!taskId) return [];
    return this.prisma.nfseDocument.findMany({
      where: {
        status: 'AUTHORIZED',
        elotechNfseId: { not: null },
        ...(customerId
          ? { invoice: { taskId, customerId } }
          : { OR: [{ taskId }, { invoice: { taskId } }] }),
      },
      select: { id: true, elotechNfseId: true, nfseNumber: true },
      orderBy: { nfseNumber: 'asc' },
    });
  }

  /**
   * Boletos vivos da tarefa — e só os do cliente pedido, quando há um.
   *
   * O corte é por `Invoice.customerId` e não por `customerConfigId` da parcela:
   * a fatura é quem carrega o pagador de forma obrigatória (coluna NOT NULL),
   * enquanto o vínculo da parcela com a configuração é opcional e some numa
   * reversão de faturamento — e um boleto sem lastro de configuração cairia no
   * dossiê de todo mundo.
   */
  private async listBankSlips(taskId: string | undefined, customerId: string | null) {
    if (!taskId) return [];
    return this.prisma.bankSlip.findMany({
      where: {
        installment: { invoice: customerId ? { taskId, customerId } : { taskId } },
        // CANCELLED/REJECTED não são cobrança viva: mandá-los ao cliente junto
        // do orçamento assinado seria pedir pagamento de um título morto.
        status: { in: ['ACTIVE', 'OVERDUE', 'PAID', 'REGISTERING'] },
      },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        digitableLine: true,
        pdfFile: { select: { path: true } },
        installment: { select: { number: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /** Disco primeiro (o agendador já baixa e guarda), Sicredi como recurso. */
  private async loadBankSlipPdf(slip: {
    digitableLine: string | null;
    pdfFile: { path: string } | null;
  }): Promise<Buffer> {
    if (slip.pdfFile?.path && existsSync(slip.pdfFile.path)) {
      return readFileSync(slip.pdfFile.path);
    }
    if (!slip.digitableLine) {
      throw new Error('sem arquivo local e sem linha digitável');
    }
    return this.sicredi.downloadBoletoPdf(slip.digitableLine);
  }

  /**
   * Copia as páginas de um PDF para o container.
   *
   * Remove widgets de ASSINATURA das páginas copiadas: o `copyPages` arrasta as
   * anotações junto, e um campo /Sig órfão faria o visualizador anunciar uma
   * assinatura que não existe neste arquivo — exatamente a confusão que este
   * desenho quer evitar.
   */
  private async appendPdf(
    container: PDFDocument,
    bytes: Buffer,
    component: DossierComponent,
    maxPages?: number,
  ): Promise<number> {
    try {
      const src = await PDFDocument.load(bytes, {
        updateMetadata: false,
        // Boletos e NFS-e de terceiros às vezes vêm com criptografia de dono
        // (sem senha de abertura). Sem isto o pdf-lib recusa o arquivo inteiro.
        ignoreEncryption: true,
      });
      const indices = src.getPageIndices();
      const wanted = maxPages && maxPages > 0 ? indices.slice(0, maxPages) : indices;
      const pages = await container.copyPages(src, wanted);
      for (const page of pages) {
        stripSignatureWidgets(page.node);
        container.addPage(page);
      }
      return pages.length;
    } catch (error) {
      component.included = false;
      component.note = `arquivo não pôde ser lido (${msg(error)})`;
      this.logger.warn(`Componente "${component.label}" fora do dossiê: ${msg(error)}`);
      return 0;
    }
  }


  /**
   * MESMA fonte do `webBase()` do SignatureEnvelopeService, e na mesma ordem.
   * O rodapé impresso em cada página do orçamento assinado já aponta para esta
   * base; a capa apontando para outra faria o mesmo envelope ter dois endereços
   * de verificação no mesmo PDF.
   */
  private publicBaseUrl(): string {
    const base =
      this.config.get<string>('SIGNATURE_WEB_URL') ||
      this.config.get<string>('WEB_APP_URL') ||
      COMPANY.websiteUrl;
    return base.replace(/\/+$/, '');
  }
}

// -----------------------------------------------------------------------------

/** Retângulo com os QUATRO cantos arredondados (SVG usa Y para baixo). */
function roundedRectAllPath(w: number, h: number, r: number): string {
  return [
    `M ${r} 0`, `L ${w - r} 0`, `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`, `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`, `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`, `A ${r} ${r} 0 0 1 ${r} 0`, 'Z',
  ].join(' ');
}

/** Só os cantos de BAIXO arredondados — o corpo branco sob a barra verde. */
function roundedRectBottomPath(w: number, h: number, r: number): string {
  return [
    `M 0 0`, `L ${w} 0`, `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`, `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`, 'Z',
  ].join(' ');
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Remove anotações de campo de assinatura de uma página copiada. */
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
    // Uma anotação exótica não pode derrubar o dossiê inteiro.
  }
}
