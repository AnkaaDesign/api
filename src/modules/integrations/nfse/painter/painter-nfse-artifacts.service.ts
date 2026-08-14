/**
 * Persistência dos artefatos de uma NFS-e autorizada do aerografista:
 * o XML, o DANFSe e o documento fiscal.
 *
 * Três destinos, cada um por um motivo diferente:
 *
 *   1. **XML → "Notas Fiscais/XML"** (contexto `fiscalDocumentXml`), junto dos
 *      demais XMLs do sistema. É o documento fiscal de guarda obrigatória.
 *
 *   2. **XML → FiscalDocument**, pelo MESMO ingestor do SIEG. Não reimplementamos
 *      nada: `SiegXmlParserService.parse()` já entende o layout nacional
 *      (`parseSefinNFSe`) e `SiegIngestionService.upsert()` já deduplica por
 *      chave, reconstrói itens e preserva categorizações. Como o emitente é o
 *      pintor e não a Ankaa, o parser classifica sozinho como **ENTRADA** — que
 *      é o correto: para nós é uma nota de serviço tomada.
 *      Consequência boa: se o SIEG importar essa mesma nota depois, cai no mesmo
 *      `upsert` e atualiza a linha existente em vez de duplicar.
 *
 *   3. **DANFSe → "Notas Fiscais" da aerografia** (relação `AIRBRUSHING_INVOICES`),
 *      que é o campo de arquivo que o usuário já usa para as notas do pintor.
 *      O PDF é gerado aqui porque a API nacional de DANFSe **não existe mais** —
 *      verificado em 14/08/2026: 404 em todas as rotas do ADN e 501 Not
 *      Implemented na SEFIN.
 *
 * ─── Regra de ouro deste serviço ───
 * Nada aqui pode derrubar a emissão. Quando este código roda, a nota JÁ foi
 * autorizada pela SEFIN e é irreversível; falhar ao gerar um PDF não pode
 * transformar isso em erro. Por isso cada etapa é isolada e best-effort, e o que
 * falhar pode ser refeito depois — o método é idempotente.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { FileService } from '@modules/common/file/file.service';
import { SiegXmlParserService } from '@modules/integrations/sieg/sieg-xml-parser.service';
import { SiegIngestionService } from '@modules/integrations/sieg/sieg-ingestion.service';
import { FiscalDocumentSource, NfseStatus } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateDanfsePdf } from './danfse.generator';

export interface ArtifactsResult {
  xmlFileId: string | null;
  pdfFileId: string | null;
  fiscalDocumentId: string | null;
  errors: string[];
}

@Injectable()
export class PainterNfseArtifactsService {
  private readonly logger = new Logger(PainterNfseArtifactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly xmlParser: SiegXmlParserService,
    private readonly ingestion: SiegIngestionService,
  ) {}

  /**
   * Gera e vincula os artefatos. Idempotente: o que já existe não é refeito.
   * Nunca lança — devolve o que conseguiu fazer e a lista do que falhou.
   */
  async persist(nfseId: string, options: { regenerateDanfse?: boolean } = {}): Promise<ArtifactsResult> {
    const result: ArtifactsResult = {
      xmlFileId: null,
      pdfFileId: null,
      fiscalDocumentId: null,
      errors: [],
    };

    const nfse = await this.prisma.airbrushingNfse.findUnique({
      where: { id: nfseId },
      select: {
        id: true,
        airbrushingId: true,
        accessKey: true,
        nfseNumber: true,
        nfseXml: true,
        status: true,
        environment: true,
        xmlFileId: true,
        pdfFileId: true,
        fiscalDocumentId: true,
        painter: { select: { name: true } },
      },
    });

    if (!nfse) {
      result.errors.push('NFS-e não encontrada.');
      return result;
    }
    if (!nfse.nfseXml) {
      result.errors.push('NFS-e sem XML autorizado — nada a arquivar.');
      return result;
    }

    result.xmlFileId = nfse.xmlFileId;
    // `regenerateDanfse` existe para o caso de o LAYOUT do PDF mudar: o XML e o
    // documento fiscal continuam válidos, só o desenho precisa ser refeito.
    result.pdfFileId = options.regenerateDanfse ? null : nfse.pdfFileId;
    result.fiscalDocumentId = nfse.fiscalDocumentId;

    const baseName = this.buildBaseName(nfse.accessKey, nfse.nfseNumber, nfse.painter?.name);

    // ── 1. XML em "Notas Fiscais/XML" ────────────────────────────────────────
    if (!result.xmlFileId) {
      try {
        result.xmlFileId = await this.storeFile({
          content: Buffer.from(nfse.nfseXml, 'utf-8'),
          filename: `${baseName}.xml`,
          mimetype: 'application/xml',
          fileContext: 'fiscalDocumentXml',
          entityId: nfse.id,
          entityType: 'fiscal_document_xml',
        });
        await this.prisma.airbrushingNfse.update({
          where: { id: nfse.id },
          data: { xmlFileId: result.xmlFileId },
        });
      } catch (error) {
        result.errors.push(`XML: ${this.msg(error)}`);
      }
    }

    // ── 2. FiscalDocument pelo ingestor do SIEG ──────────────────────────────
    if (!result.fiscalDocumentId) {
      try {
        const parsed = this.xmlParser.parse(nfse.nfseXml);
        if (!parsed) {
          result.errors.push(
            'XML não reconhecido pelo parser fiscal — o documento não foi criado.',
          );
        } else {
          const ingested = await this.ingestion.upsert(parsed, FiscalDocumentSource.MANUAL_UPLOAD);
          result.fiscalDocumentId = ingested.id;

          await this.prisma.airbrushingNfse.update({
            where: { id: nfse.id },
            data: { fiscalDocumentId: ingested.id },
          });

          // Liga o XML ao documento fiscal, como as importações do SIEG fazem.
          if (result.xmlFileId) {
            await this.prisma.fiscalDocument.update({
              where: { id: ingested.id },
              data: { rawXmlFileId: result.xmlFileId },
            });
          }

          this.logger.log(
            `[PAINTER_NFSE_ARTIFACTS] Documento fiscal ${ingested.created ? 'criado' : 'atualizado'} ` +
              `(${ingested.accessKey}) a partir da NFS-e ${nfse.accessKey ?? nfse.id}.`,
          );
        }
      } catch (error) {
        result.errors.push(`Documento fiscal: ${this.msg(error)}`);
      }
    }

    // ── 3. DANFSe nas "Notas Fiscais" da aerografia ──────────────────────────
    if (!result.pdfFileId) {
      try {
        // O estado de cancelamento vem da NOSSA linha, não do XML: a SEFIN não
        // altera a nota ao cancelar (cStat continua 107), o cancelamento é um
        // evento separado. Sem isto a marca d'água exigida pela NT nunca sairia.
        const pdf = await generateDanfsePdf(nfse.nfseXml, {
          cancelada: nfse.status === NfseStatus.CANCELLED,
        });
        result.pdfFileId = await this.storeFile({
          content: pdf,
          filename: `${baseName}.pdf`,
          mimetype: 'application/pdf',
          fileContext: 'airbrushingInvoices',
          entityId: nfse.airbrushingId,
          entityType: 'airbrushing_invoice',
          // Conecta na relação AIRBRUSHING_INVOICES: é o campo "Notas Fiscais"
          // da aerografia. Usa connect (append), NUNCA set — set reescreveria a
          // relação e apagaria os anexos que o usuário subiu à mão.
          connectAirbrushingInvoiceId: nfse.airbrushingId,
        });
        await this.prisma.airbrushingNfse.update({
          where: { id: nfse.id },
          data: { pdfFileId: result.pdfFileId },
        });
      } catch (error) {
        result.errors.push(`DANFSe: ${this.msg(error)}`);
      }
    }

    if (result.errors.length > 0) {
      this.logger.warn(
        `[PAINTER_NFSE_ARTIFACTS] NFS-e ${nfse.id} arquivada parcialmente: ${result.errors.join(' | ')}`,
      );
    }

    return result;
  }

  /**
   * Grava um buffer como File no contexto indicado.
   *
   * `FileService.createFromUploadWithTransaction` espera um arquivo de disco
   * (lê `file.path`), então o conteúdo passa por um temporário antes de ser
   * movido para o armazenamento definitivo.
   */
  private async storeFile(params: {
    content: Buffer;
    filename: string;
    mimetype: string;
    fileContext: string;
    entityId: string;
    entityType: string;
    connectAirbrushingInvoiceId?: string;
  }): Promise<string> {
    const tempPath = path.join(os.tmpdir(), `${randomUUID()}-${params.filename}`);
    await fs.writeFile(tempPath, params.content);

    try {
      return await this.prisma.$transaction(async tx => {
        const record = await this.fileService.createFromUploadWithTransaction(
          tx,
          {
            fieldname: 'file',
            originalname: params.filename,
            encoding: '7bit',
            mimetype: params.mimetype,
            size: params.content.length,
            destination: path.dirname(tempPath),
            filename: path.basename(tempPath),
            path: tempPath,
            buffer: params.content,
            stream: undefined as never,
          },
          params.fileContext as never,
          undefined,
          { entityId: params.entityId, entityType: params.entityType },
        );

        if (params.connectAirbrushingInvoiceId) {
          await tx.file.update({
            where: { id: record.id },
            data: {
              airbrushingInvoices: { connect: { id: params.connectAirbrushingInvoiceId } },
            },
          });
        }

        return record.id;
      });
    } finally {
      // createFromUploadWithTransaction MOVE o arquivo; se ainda existir, foi
      // porque a transação abortou e o temporário ficou órfão.
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }

  /** Nome estável e legível: identifica a nota sem precisar abrir o arquivo. */
  private buildBaseName(
    accessKey: string | null,
    nfseNumber: string | null,
    painterName?: string | null,
  ): string {
    const painter = (painterName ?? 'aerografista')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // remove acentos combinantes
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const numero = nfseNumber ? `-n${nfseNumber}` : '';
    const chave = accessKey ? `-${accessKey}` : '';
    return `nfse-${painter}${numero}${chave}`.slice(0, 180);
  }

  private msg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
