import { Injectable, Logger } from '@nestjs/common';
import { FiscalDocumentSource } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import unzipper from 'unzipper';
import { SiegXmlParserService } from '@modules/integrations/sieg/sieg-xml-parser.service';
import { SiegIngestionService } from '@modules/integrations/sieg/sieg-ingestion.service';

export interface XmlImportResult {
  created: number;
  skipped: number;
  failed: number;
  failedFiles: string[];
}

@Injectable()
export class ManualXmlImportService {
  private readonly logger = new Logger(ManualXmlImportService.name);

  constructor(
    private readonly parser: SiegXmlParserService,
    private readonly ingestion: SiegIngestionService,
  ) {}

  /**
   * Accepts an array of multer-uploaded files. Each file is either a single XML
   * or a ZIP containing many XMLs.
   */
  async importFiles(files: Express.Multer.File[]): Promise<XmlImportResult> {
    const result: XmlImportResult = { created: 0, skipped: 0, failed: 0, failedFiles: [] };

    for (const file of files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.zip') {
          await this.processZip(file.path, file.originalname, result);
        } else {
          await this.processXml(file.path, file.originalname, result);
        }
      } catch (err) {
        this.logger.error(`Failed to process ${file.originalname}: ${err}`);
        result.failed += 1;
        result.failedFiles.push(file.originalname);
      } finally {
        // Clean up multer temp file
        await fs.unlink(file.path).catch(() => undefined);
      }
    }

    return result;
  }

  private async processXml(filePath: string, originalName: string, result: XmlImportResult) {
    const xml = await fs.readFile(filePath, 'utf8');
    await this.ingestSingle(xml, originalName, result);
  }

  private async processZip(filePath: string, _originalName: string, result: XmlImportResult) {
    const directory = await unzipper.Open.file(filePath);
    for (const entry of directory.files) {
      if (entry.type !== 'File') continue;
      if (!entry.path.toLowerCase().endsWith('.xml')) continue;
      try {
        const buffer = await entry.buffer();
        await this.ingestSingle(buffer.toString('utf8'), entry.path, result);
      } catch (err) {
        this.logger.warn(`Failed to process zip entry ${entry.path}: ${err}`);
        result.failed += 1;
        result.failedFiles.push(entry.path);
      }
    }
  }

  private async ingestSingle(xml: string, sourceName: string, result: XmlImportResult) {
    const parsed = this.parser.parse(xml);
    if (!parsed) {
      result.failed += 1;
      result.failedFiles.push(sourceName);
      return;
    }
    const ingestion = await this.ingestion.upsert(parsed, FiscalDocumentSource.MANUAL_UPLOAD);
    if (ingestion.created) result.created += 1;
    else result.skipped += 1;
  }
}
