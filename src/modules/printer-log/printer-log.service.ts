import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'printer-debug.log');

/**
 * Temporary debug channel for the Niimbot label-printing feature (browser
 * Web Serial print flow — see web/src/components/common/printer). The
 * connection and the actual printing happen entirely client-side, so when
 * something goes wrong the only evidence normally lives in the user's own
 * browser console, which is why this exists: the frontend posts what it saw
 * (label format, canvas/packet details, success or error) here so it can be
 * read straight from the server instead of asking the user to screenshot
 * their console every time.
 */
@Injectable()
export class PrinterLogService {
  private readonly logger = new Logger(PrinterLogService.name);

  async append(entry: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(LOG_DIR, { recursive: true });
      const line = JSON.stringify({ receivedAt: new Date().toISOString(), ...entry });
      await appendFile(LOG_FILE, line + '\n', 'utf8');
    } catch (error) {
      this.logger.warn(`Falha ao gravar printer-debug.log: ${error}`);
    }
  }
}
