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
      // Refresh both header fields AND items on re-import: the parser may have
      // improved between runs, and — critically — a late-arriving cancellation
      // (cStat 101 / cancNFe) must flip status/cancelledAt on the stored doc.
      // Cascade FK makes the item delete safe; items aren't referenced elsewhere.
      await this.prisma.$transaction([
        this.prisma.fiscalDocument.update({
          where: { id: existing.id },
          data: this.mapHeaderFields(parsed),
        }),
        ...(parsed.items && parsed.items.length > 0
          ? [
              this.prisma.fiscalDocumentItem.deleteMany({
                where: { fiscalDocumentId: existing.id },
              }),
              this.prisma.fiscalDocumentItem.createMany({
                data: parsed.items.map((it) => ({
                  fiscalDocumentId: existing.id,
                  ...this.mapItemFields(it),
                })),
              }),
            ]
          : []),
      ]);
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
        source,
        siegId: siegId ?? null,
        rawXmlFileId,
        ...this.mapHeaderFields(parsed),
        items:
          parsed.items && parsed.items.length > 0
            ? { create: parsed.items.map((it) => this.mapItemFields(it)) }
            : undefined,
      },
    });

    this.events.emit('fiscal-document.created', {
      id: created.id,
      accessKey: created.accessKey,
    });

    return { id: created.id, accessKey: created.accessKey, created: true };
  }

  /**
   * Maps the parsed header into the FiscalDocument column set shared by the
   * create and re-import paths. `source`/`siegId`/`rawXmlFileId`/`accessKey`
   * are handled by the caller (they are set only on create).
   */
  private mapHeaderFields(parsed: ParsedFiscalDocument) {
    return {
      docType: parsed.docType,
      operationType: parsed.operationType,
      status: parsed.status,
      issueDate: parsed.issueDate,
      totalValue: parsed.totalValue,
      emitCnpj: parsed.emitCnpj,
      emitName: parsed.emitName,
      destCnpj: parsed.destCnpj,
      destCpf: parsed.destCpf,
      destName: parsed.destName,
      nfNumber: parsed.nfNumber,
      paymentMethods: (parsed.paymentMethods ?? null) as any,
      cancelledAt: parsed.cancelledAt ?? null,
      // Rich XML-derived columns
      series: parsed.series ?? null,
      model: parsed.model ?? null,
      naturezaOperacao: parsed.naturezaOperacao ?? null,
      protocolNumber: parsed.protocolNumber ?? null,
      authorizationDate: parsed.authorizationDate ?? null,
      cStat: parsed.cStat ?? null,
      xMotivo: parsed.xMotivo ?? null,
      dateInferred: parsed.dateInferred ?? false,
      emitIE: parsed.emitIE ?? null,
      emitAddress: (parsed.emitAddress ?? null) as any,
      destIE: parsed.destIE ?? null,
      destEmail: parsed.destEmail ?? null,
      destAddress: (parsed.destAddress ?? null) as any,
      totals: (parsed.totals ?? null) as any,
      issValue: parsed.issValue ?? null,
      issRetained: parsed.issRetained ?? null,
      issRate: parsed.issRate ?? null,
      baseCalculo: parsed.baseCalculo ?? null,
      valorLiquido: parsed.valorLiquido ?? null,
      valorServicos: parsed.valorServicos ?? null,
      codigoTributacaoMunicipio: parsed.codigoTributacaoMunicipio ?? null,
      municipioPrestacao: parsed.municipioPrestacao ?? null,
      itemListaServico: parsed.itemListaServico ?? null,
    };
  }

  /** Maps a parsed line item into the FiscalDocumentItem column set. */
  private mapItemFields(it: ParsedFiscalDocument['items'][number]) {
    return {
      code: it.code,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitValue: it.unitValue,
      totalValue: it.totalValue,
      ncm: it.ncm ?? null,
      cfop: it.cfop ?? null,
      cest: it.cest ?? null,
      ean: it.ean ?? null,
      cst: it.cst ?? null,
      discount: it.discount ?? null,
      freight: it.freight ?? null,
      taxes: (it.taxes ?? null) as any,
    };
  }
}
