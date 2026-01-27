import { Injectable, Logger } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { RcloneCopyResult, RcloneDeleteResult, RcloneProgress } from './gdrive-sync.types';

const execAsync = promisify(exec);

@Injectable()
export class RcloneService {
  private readonly logger = new Logger(RcloneService.name);
  private readonly rcloneConfig = '/home/kennedy/.config/rclone/rclone.conf';
  private readonly gdriveRemote = 'gdrive';
  private readonly gdriveFolder = 'Backups';

  /**
   * Check if rclone is available and Google Drive remote is configured
   */
  async checkConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      // Check if rclone is installed
      await execAsync('which rclone');

      // Check if config exists and remote is configured
      const { stdout } = await execAsync(
        `rclone listremotes --config "${this.rcloneConfig}"`,
      );

      if (!stdout.includes(`${this.gdriveRemote}:`)) {
        return {
          connected: false,
          error: `Google Drive remote '${this.gdriveRemote}' not configured`,
        };
      }

      // Test connection by listing root
      await execAsync(
        `rclone lsd "${this.gdriveRemote}:" --config "${this.rcloneConfig}" --contimeout 30s`,
        { timeout: 60000 },
      );

      return { connected: true };
    } catch (error) {
      this.logger.error(`Rclone connection check failed: ${error.message}`);
      return { connected: false, error: error.message };
    }
  }

  /**
   * Copy a local file to Google Drive
   * Returns the Google Drive file ID on success
   */
  async copyFile(
    localPath: string,
    remotePath: string,
    onProgress?: (progress: RcloneProgress) => void,
  ): Promise<RcloneCopyResult> {
    const fullRemotePath = `${this.gdriveRemote}:${this.gdriveFolder}/${remotePath}`;

    this.logger.log(`Starting upload: ${localPath} -> ${fullRemotePath}`);

    return new Promise((resolve) => {
      const args = [
        'copy',
        localPath,
        fullRemotePath,
        '--config', this.rcloneConfig,
        '--progress',
        '--stats', '2s',
        '--stats-one-line',
        '--transfers', '1',
        '--contimeout', '120s',
        '--timeout', '0', // No timeout for large files
        '--retries', '5',
        '--low-level-retries', '20',
      ];

      const rcloneProcess = spawn('rclone', args);
      let lastProgress: RcloneProgress | null = null;
      let errorOutput = '';

      rcloneProcess.stdout.on('data', (data) => {
        const output = data.toString();
        const progress = this.parseProgress(output);
        if (progress) {
          lastProgress = progress;
          onProgress?.(progress);
        }
      });

      rcloneProcess.stderr.on('data', (data) => {
        const output = data.toString();
        // rclone outputs progress to stderr
        const progress = this.parseProgress(output);
        if (progress) {
          lastProgress = progress;
          onProgress?.(progress);
        } else if (output.includes('ERROR')) {
          errorOutput += output;
        }
      });

      rcloneProcess.on('close', async (code) => {
        if (code === 0) {
          this.logger.log(`Upload completed: ${remotePath}`);

          // Try to get the file ID from Google Drive
          const fileId = await this.getFileId(remotePath);

          resolve({
            success: true,
            fileId,
            bytesTransferred: lastProgress?.bytes,
          });
        } else {
          this.logger.error(`Upload failed with code ${code}: ${errorOutput}`);
          resolve({
            success: false,
            error: errorOutput || `rclone exited with code ${code}`,
          });
        }
      });

      rcloneProcess.on('error', (error) => {
        this.logger.error(`Rclone process error: ${error.message}`);
        resolve({
          success: false,
          error: error.message,
        });
      });
    });
  }

  /**
   * Delete a file or directory from Google Drive
   */
  async deleteFile(remotePath: string): Promise<RcloneDeleteResult> {
    const fullRemotePath = `${this.gdriveRemote}:${this.gdriveFolder}/${remotePath}`;

    this.logger.log(`Deleting from Google Drive: ${fullRemotePath}`);

    try {
      // First check if it's a directory or file
      try {
        await execAsync(
          `rclone lsd "${fullRemotePath}" --config "${this.rcloneConfig}"`,
          { timeout: 30000 },
        );
        // It's a directory, use purge
        await execAsync(
          `rclone purge "${fullRemotePath}" --config "${this.rcloneConfig}"`,
          { timeout: 300000 }, // 5 min for directories
        );
      } catch {
        // Not a directory, try delete for file
        try {
          await execAsync(
            `rclone deletefile "${fullRemotePath}" --config "${this.rcloneConfig}"`,
            { timeout: 60000 },
          );
        } catch (fileError) {
          // File might not exist, which is okay
          if (!fileError.message?.includes('not found')) {
            throw fileError;
          }
        }
      }

      this.logger.log(`Deleted from Google Drive: ${remotePath}`);
      return { success: true };
    } catch (error) {
      // If file doesn't exist, consider it a success
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        this.logger.log(`File already deleted or not found: ${remotePath}`);
        return { success: true };
      }

      this.logger.error(`Delete failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete by backup ID - searches all type directories
   */
  async deleteByBackupId(backupId: string): Promise<RcloneDeleteResult> {
    const typeDirs = ['banco-de-dados', 'arquivos', 'sistema', 'completo'];
    let deleted = false;
    let lastError: string | undefined;

    for (const typeDir of typeDirs) {
      try {
        // Search for the backup folder recursively
        const { stdout } = await execAsync(
          `rclone lsf "${this.gdriveRemote}:${this.gdriveFolder}/${typeDir}" ` +
          `--config "${this.rcloneConfig}" --recursive --dirs-only 2>/dev/null | grep "${backupId}" || true`,
          { timeout: 60000 },
        );

        if (stdout.trim()) {
          const relativePath = stdout.trim().split('\n')[0];
          const fullPath = `${typeDir}/${relativePath}`;

          const result = await this.deleteFile(fullPath);
          if (result.success) {
            deleted = true;
            this.logger.log(`Deleted backup ${backupId} from ${fullPath}`);
          } else {
            lastError = result.error;
          }
        }
      } catch (error) {
        lastError = error.message;
      }
    }

    if (deleted) {
      return { success: true };
    }

    // If nothing was found, that's okay
    this.logger.log(`Backup ${backupId} not found on Google Drive`);
    return { success: true };
  }

  /**
   * Get Google Drive file ID for a path
   */
  private async getFileId(remotePath: string): Promise<string | undefined> {
    try {
      const fullRemotePath = `${this.gdriveRemote}:${this.gdriveFolder}/${remotePath}`;

      // Use rclone lsjson to get file info including ID
      const { stdout } = await execAsync(
        `rclone lsjson "${fullRemotePath}" --config "${this.rcloneConfig}" 2>/dev/null || echo "[]"`,
        { timeout: 30000 },
      );

      const files = JSON.parse(stdout);
      if (files.length > 0 && files[0].ID) {
        return files[0].ID;
      }

      return undefined;
    } catch (error) {
      this.logger.warn(`Could not get file ID for ${remotePath}: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Parse progress from rclone output
   */
  private parseProgress(output: string): RcloneProgress | null {
    try {
      // Match patterns like: "Transferred: 1.234 GiB / 10.5 GiB, 12%, 50.0 MiB/s, ETA 2m30s"
      const transferMatch = output.match(
        /Transferred:\s*(\d+(?:\.\d+)?)\s*(\w+)\s*\/\s*(\d+(?:\.\d+)?)\s*(\w+),\s*(\d+)%(?:,\s*(\d+(?:\.\d+)?)\s*(\w+)\/s)?(?:,\s*ETA\s*(\S+))?/,
      );

      if (transferMatch) {
        const bytes = this.parseSize(transferMatch[1], transferMatch[2]);
        const totalBytes = this.parseSize(transferMatch[3], transferMatch[4]);
        const percent = parseInt(transferMatch[5], 10);
        const speed = transferMatch[6] ? `${transferMatch[6]} ${transferMatch[7]}/s` : 'calculating...';
        const eta = transferMatch[8] || 'calculating...';

        return { bytes, totalBytes, percent, speed, eta };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse size string to bytes
   */
  private parseSize(value: string, unit: string): number {
    const num = parseFloat(value);
    const multipliers: Record<string, number> = {
      B: 1,
      KiB: 1024,
      MiB: 1024 * 1024,
      GiB: 1024 * 1024 * 1024,
      TiB: 1024 * 1024 * 1024 * 1024,
      KB: 1000,
      MB: 1000 * 1000,
      GB: 1000 * 1000 * 1000,
      TB: 1000 * 1000 * 1000 * 1000,
    };
    return Math.round(num * (multipliers[unit] || 1));
  }

  /**
   * Get Google Drive storage usage
   */
  async getStorageUsage(): Promise<{
    used: string;
    total: string;
    free: string;
    usedBytes: number;
    totalBytes: number;
  } | null> {
    try {
      const { stdout } = await execAsync(
        `rclone about "${this.gdriveRemote}:" --config "${this.rcloneConfig}" --json`,
        { timeout: 30000 },
      );

      const info = JSON.parse(stdout);
      return {
        used: this.formatBytes(info.used || 0),
        total: info.total ? this.formatBytes(info.total) : 'Unlimited',
        free: info.free ? this.formatBytes(info.free) : 'N/A',
        usedBytes: info.used || 0,
        totalBytes: info.total || 0,
      };
    } catch (error) {
      this.logger.warn(`Could not get storage usage: ${error.message}`);
      return null;
    }
  }

  /**
   * Get backup folder size on Google Drive
   */
  async getBackupFolderSize(): Promise<{ count: number; size: string; sizeBytes: number } | null> {
    try {
      const { stdout } = await execAsync(
        `rclone size "${this.gdriveRemote}:${this.gdriveFolder}" --config "${this.rcloneConfig}" --json`,
        { timeout: 120000 }, // 2 minutes for large folders
      );

      const info = JSON.parse(stdout);
      return {
        count: info.count || 0,
        size: this.formatBytes(info.bytes || 0),
        sizeBytes: info.bytes || 0,
      };
    } catch (error) {
      this.logger.warn(`Could not get backup folder size: ${error.message}`);
      return null;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
