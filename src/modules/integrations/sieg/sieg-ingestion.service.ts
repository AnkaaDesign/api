import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalDocumentSource } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ParsedFiscalDocument } from './types/sieg.types';

export interface IngestedFiscalDocument {
  id: string;
  accessKey: string;
  created: boolean;
}

@Injectable()
export class SiegIngestionService {
  private readonly logger = new Logger(SiegIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Persists a parsed fiscal document, skipping duplicates by accessKey.
   * Writes the raw XML to disk under `uploads/fiscal-documents/` and registers a File row.
   */
  async upsert(
    parsed: ParsedFiscalDocument,
    source: FiscalDocumentSource = FiscalDocumentSource.SIEG_API,
    siegId?: string,
  ): Promise<IngestedFiscalDocument> {
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { accessKey: parsed.accessKey },
      select: { id: true, accessKey: true },
    });
    if (existing) {
      // Refresh items on re-import — the parser may have improved between runs,
      // and items are a derived projection of the XML. Cascade FK ensures
      // delete is safe; items are not referenced by other tables.
      if (parsed.items && parsed.items.length > 0) {
        await this.prisma.$transaction([
          this.prisma.fiscalDocumentItem.deleteMany({
            where: { fiscalDocumentId: existing.id },
          }),
          this.prisma.fiscalDocumentItem.createMany({
            data: parsed.items.map((it) => ({
              fiscalDocumentId: existing.id,
              code: it.code,
              description: it.description,
              quantity: it.quantity,
              unit: it.unit,
              unitValue: it.unitValue,
              totalValue: it.totalValue,
            })),
          }),
        ]);
      }
      return { id: existing.id, accessKey: existing.accessKey, created: false };
    }

    let rawXmlFileId: string | null = null;
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'fiscal-documents');
      await fs.mkdir(uploadDir, { recursive: true });
      const filename = `${parsed.accessKey}.xml`;
      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, parsed.rawXml, 'utf8');
      const fileRecord = await this.prisma.file.create({
        data: {
          filename,
          originalName: filename,
          path: filePath,
          mimetype: 'application/xml',
          size: Buffer.byteLength(parsed.rawXml, 'utf8'),
        },
      });
      rawXmlFileId = fileRecord.id;
    } catch (err) {
      this.logger.warn(`Failed to persist raw XML for ${parsed.accessKey}: ${err}`);
    }

    const created = await this.prisma.fiscalDocument.create({
      data: {
        accessKey: parsed.accessKey,
        docType: parsed.docType,
        operationType: parsed.operationType,
        status: parsed.status,
        source,
        issueDate: parsed.issueDate,
        totalValue: parsed.totalValue,
        emitCnpj: parsed.emitCnpj,
        emitName: parsed.emitName,
        destCnpj: parsed.destCnpj,
        destCpf: parsed.destCpf,
        destName: parsed.destName,
        nfNumber: parsed.nfNumber,
        paymentMethods: parsed.paymentMethods as any,
        siegId: siegId ?? null,
        rawXmlFileId,
        items:
          parsed.items && parsed.items.length > 0
            ? {
                create: parsed.items.map((it) => ({
                  code: it.code,
                  description: it.description,
                  quantity: it.quantity,
                  unit: it.unit,
                  unitValue: it.unitValue,
                  totalValue: it.totalValue,
                })),
              }
            : undefined,
      },
    });

    this.events.emit('fiscal-document.created', {
      id: created.id,
      accessKey: created.accessKey,
    });

    return { id: created.id, accessKey: created.accessKey, created: true };
  }
}
