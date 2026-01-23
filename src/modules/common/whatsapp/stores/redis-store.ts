import { Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { promises as fs } from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import * as unzipper from 'unzipper';
import { Readable } from 'stream';

/**
 * Redis Store for whatsapp-web.js RemoteAuth
 *
 * This store persists WhatsApp session data in Redis, allowing the session
 * to survive application restarts, deployments, and container recreations.
 *
 * The session data is compressed and stored as a base64-encoded string in Redis.
 */
export class RedisStore {
  private readonly logger = new Logger(RedisStore.name);
  private readonly STORE_KEY_PREFIX = 'whatsapp:session:';
  private readonly SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

  constructor(private readonly cacheService: CacheService) {
    this.logger.log('Redis Store initialized for WhatsApp session persistence');
  }

  /**
   * Check if a session exists in Redis
   * @param options - Session options containing session name
   * @returns Promise<boolean>
   */
  async sessionExists(options: { session: string }): Promise<boolean> {
    const key = this.getSessionKey(options.session);
    const exists = await this.cacheService.exists(key);
    this.logger.log(`Session exists check for ${options.session}: ${exists}`);
    return exists;
  }

  /**
   * Save session data to Redis
   * The session folder is compressed into a zip and stored as base64
   * @param options - Session options containing session name
   */
  async save(options: { session: string }): Promise<void> {
    const sessionPath = this.getSessionPath(options.session);
    const key = this.getSessionKey(options.session);

    this.logger.log(`Saving session ${options.session} to Redis...`);

    try {
      // Check if session folder exists
      try {
        await fs.access(sessionPath);
      } catch {
        this.logger.warn(`Session folder does not exist: ${sessionPath}`);
        return;
      }

      // Compress the session folder into a buffer
      const zipBuffer = await this.compressFolder(sessionPath);

      // Store as base64 in Redis with TTL
      const base64Data = zipBuffer.toString('base64');
      await this.cacheService.set(key, base64Data, this.SESSION_TTL_SECONDS);

      this.logger.log(
        `Session ${options.session} saved to Redis (${Math.round(base64Data.length / 1024)} KB)`,
      );
    } catch (error) {
      this.logger.error(`Failed to save session ${options.session}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Extract/restore session data from Redis
   * Decompresses the stored zip and extracts to the session folder
   * @param options - Session options containing session name
   */
  async extract(options: { session: string }): Promise<void> {
    const sessionPath = this.getSessionPath(options.session);
    const key = this.getSessionKey(options.session);

    this.logger.log(`Extracting session ${options.session} from Redis...`);

    try {
      // Get base64 data from Redis
      const base64Data = await this.cacheService.get<string>(key);

      if (!base64Data) {
        this.logger.warn(`No session data found in Redis for ${options.session}`);
        return;
      }

      // Convert base64 to buffer
      const zipBuffer = Buffer.from(base64Data, 'base64');

      // Create session directory if it doesn't exist
      await this.ensureDirectory(sessionPath);

      // Extract zip to session folder
      await this.extractZip(zipBuffer, sessionPath);

      this.logger.log(`Session ${options.session} extracted from Redis to ${sessionPath}`);
    } catch (error) {
      this.logger.error(
        `Failed to extract session ${options.session}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Delete session data from Redis
   * @param options - Session options containing session name
   */
  async delete(options: { session: string }): Promise<void> {
    const key = this.getSessionKey(options.session);

    this.logger.log(`Deleting session ${options.session} from Redis...`);

    try {
      await this.cacheService.del(key);
      this.logger.log(`Session ${options.session} deleted from Redis`);
    } catch (error) {
      this.logger.error(
        `Failed to delete session ${options.session}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get the Redis key for a session
   */
  private getSessionKey(session: string): string {
    return `${this.STORE_KEY_PREFIX}${session}`;
  }

  /**
   * Get the local file path for a session
   */
  private getSessionPath(session: string): string {
    const basePath = process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth';
    return path.join(basePath, `session-${session}`);
  }

  /**
   * Compress a folder into a zip buffer
   */
  private async compressFolder(folderPath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      archive.directory(folderPath, false);
      archive.finalize();
    });
  }

  /**
   * Extract a zip buffer to a folder
   */
  private async extractZip(zipBuffer: Buffer, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readable = Readable.from(zipBuffer);

      readable
        .pipe(unzipper.Extract({ path: targetPath }))
        .on('close', resolve)
        .on('error', reject);
    });
  }

  /**
   * Ensure a directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
