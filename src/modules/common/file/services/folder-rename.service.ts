import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { promises as fs, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import type { PrismaTransaction } from '../repositories/file.repository';

/**
 * Service to handle folder renaming when customer/supplier/user names change
 * This ensures consistency between folder names and database records
 */
@Injectable()
export class FolderRenameService {
  private readonly logger = new Logger(FolderRenameService.name);
  private readonly filesRoot = process.env.FILES_ROOT || './files';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sanitize folder name for safe filesystem usage
   */
  private sanitizeFolderName(name: string): string {
    return name
      .replace(/[<>:"|?*\x00-\x1f]/g, '_') // Replace invalid chars
      .replace(/\.\./g, '_') // Remove directory traversal
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim() // Remove leading/trailing spaces
      .substring(0, 100); // Limit length
  }

  /**
   * Rename a single folder and update all file paths in database
   */
  private async renameFolderAndUpdatePaths(
    oldFolderPath: string,
    newFolderPath: string,
    tx: PrismaTransaction,
  ): Promise<{ foldersRenamed: number; filesUpdated: number }> {
    let foldersRenamed = 0;
    let filesUpdated = 0;

    // Check if old folder exists
    if (!existsSync(oldFolderPath)) {
      this.logger.warn(`Folder does not exist, skipping: ${oldFolderPath}`);
      return { foldersRenamed, filesUpdated };
    }

    // Check if new folder already exists
    if (existsSync(newFolderPath)) {
      this.logger.warn(`Target folder already exists: ${newFolderPath}`);
      // In this case, we might want to merge or skip
      // For now, we'll skip the rename but still update database paths
    } else {
      try {
        // Ensure parent directory exists
        const parentDir = dirname(newFolderPath);
        if (!existsSync(parentDir)) {
          await fs.mkdir(parentDir, { recursive: true });
        }

        // Rename the folder
        await fs.rename(oldFolderPath, newFolderPath);
        foldersRenamed++;
        this.logger.log(`Renamed folder: ${oldFolderPath} → ${newFolderPath}`);

        // Set proper permissions
        try {
          await fs.chmod(newFolderPath, 0o2775); // rwxrwsr-x
        } catch (chmodError: any) {
          this.logger.warn(`Could not set permissions for ${newFolderPath}: ${chmodError.message}`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to rename folder ${oldFolderPath} → ${newFolderPath}:`, error);
        throw new InternalServerErrorException(`Failed to rename folder: ${error.message}`);
      }
    }

    // Update all file paths in database
    try {
      // Find all files that reference the old folder path
      const filesToUpdate = await tx.file.findMany({
        where: {
          path: {
            startsWith: oldFolderPath,
          },
        },
      });

      this.logger.log(`Found ${filesToUpdate.length} files to update in ${oldFolderPath}`);

      // Update each file's path
      for (const file of filesToUpdate) {
        const newPath = file.path.replace(oldFolderPath, newFolderPath);
        await tx.file.update({
          where: { id: file.id },
          data: { path: newPath },
        });
        filesUpdated++;
      }

      this.logger.log(`Updated ${filesUpdated} file paths in database`);
    } catch (error: any) {
      this.logger.error(`Failed to update file paths in database:`, error);
      throw new InternalServerErrorException(`Failed to update file paths: ${error.message}`);
    }

    return { foldersRenamed, filesUpdated };
  }

  /**
   * Rename folders when customer fantasyName changes
   */
  async renameCustomerFolders(
    oldFantasyName: string,
    newFantasyName: string,
    tx: PrismaTransaction,
  ): Promise<{ totalFoldersRenamed: number; totalFilesUpdated: number }> {
    this.logger.log(`Renaming customer folders: "${oldFantasyName}" → "${newFantasyName}"`);

    const oldSanitized = this.sanitizeFolderName(oldFantasyName);
    const newSanitized = this.sanitizeFolderName(newFantasyName);

    // Skip if names are the same after sanitization
    if (oldSanitized === newSanitized) {
      this.logger.log('Folder names are identical after sanitization, skipping rename');
      return { totalFoldersRenamed: 0, totalFilesUpdated: 0 };
    }

    // Entity-first layout: single rename of Clientes/{customerName}
    const oldPath = join(this.filesRoot, 'Clientes', oldSanitized);
    const newPath = join(this.filesRoot, 'Clientes', newSanitized);

    const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);

    this.logger.log(
      `Customer folder rename complete: ${result.foldersRenamed} folders renamed, ${result.filesUpdated} files updated`,
    );

    return { totalFoldersRenamed: result.foldersRenamed, totalFilesUpdated: result.filesUpdated };
  }

  /**
   * Rename folders when supplier fantasyName changes
   */
  async renameSupplierFolders(
    oldFantasyName: string,
    newFantasyName: string,
    tx: PrismaTransaction,
  ): Promise<{ totalFoldersRenamed: number; totalFilesUpdated: number }> {
    this.logger.log(`Renaming supplier folders: "${oldFantasyName}" → "${newFantasyName}"`);

    const oldSanitized = this.sanitizeFolderName(oldFantasyName);
    const newSanitized = this.sanitizeFolderName(newFantasyName);

    // Skip if names are the same after sanitization
    if (oldSanitized === newSanitized) {
      this.logger.log('Folder names are identical after sanitization, skipping rename');
      return { totalFoldersRenamed: 0, totalFilesUpdated: 0 };
    }

    // Entity-first layout: single rename of Fornecedores/{supplierName}
    const oldPath = join(this.filesRoot, 'Fornecedores', oldSanitized);
    const newPath = join(this.filesRoot, 'Fornecedores', newSanitized);

    const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);

    this.logger.log(
      `Supplier folder rename complete: ${result.foldersRenamed} folders renamed, ${result.filesUpdated} files updated`,
    );

    return { totalFoldersRenamed: result.foldersRenamed, totalFilesUpdated: result.filesUpdated };
  }

  /**
   * Rename folders when user name changes
   */
  async renameUserFolders(
    oldName: string,
    newName: string,
    tx: PrismaTransaction,
  ): Promise<{ totalFoldersRenamed: number; totalFilesUpdated: number }> {
    this.logger.log(`Renaming user folders: "${oldName}" → "${newName}"`);

    const oldSanitized = this.sanitizeFolderName(oldName);
    const newSanitized = this.sanitizeFolderName(newName);

    // Skip if names are the same after sanitization
    if (oldSanitized === newSanitized) {
      this.logger.log('Folder names are identical after sanitization, skipping rename');
      return { totalFoldersRenamed: 0, totalFilesUpdated: 0 };
    }

    // Entity-first layout: single rename of Colaboradores/{userName}
    const oldPath = join(this.filesRoot, 'Colaboradores', oldSanitized);
    const newPath = join(this.filesRoot, 'Colaboradores', newSanitized);

    const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);

    this.logger.log(
      `User folder rename complete: ${result.foldersRenamed} folders renamed, ${result.filesUpdated} files updated`,
    );

    return { totalFoldersRenamed: result.foldersRenamed, totalFilesUpdated: result.filesUpdated };
  }

  /**
   * Merge multiple source entity folders into a target entity folder.
   * Moves all physical files and updates DB paths within the transaction.
   * Used during entity merge operations (e.g. merging duplicate customers).
   */
  async mergeEntityFolders(
    entityRoot: 'Clientes' | 'Fornecedores' | 'Colaboradores',
    sourceNames: string[],
    targetName: string,
    tx: PrismaTransaction,
  ): Promise<{ totalFilesMoved: number; totalFilesUpdated: number; errors: string[] }> {
    let totalFilesMoved = 0;
    let totalFilesUpdated = 0;
    const errors: string[] = [];

    const targetSanitized = this.sanitizeFolderName(targetName);
    const targetFolder = join(this.filesRoot, entityRoot, targetSanitized);

    for (const sourceName of sourceNames) {
      const sourceSanitized = this.sanitizeFolderName(sourceName);

      if (sourceSanitized === targetSanitized) {
        this.logger.log(`Source "${sourceName}" same as target after sanitization, skipping`);
        continue;
      }

      const sourceFolder = join(this.filesRoot, entityRoot, sourceSanitized);

      if (!existsSync(sourceFolder)) {
        this.logger.log(`Source folder does not exist, skipping: ${sourceFolder}`);
        continue;
      }

      this.logger.log(`Merging entity folder: ${sourceFolder} → ${targetFolder}`);

      // Get all files recursively from source
      const files = this.getAllFilesRecursively(sourceFolder);
      this.logger.log(`Found ${files.length} files to merge from "${sourceName}"`);

      for (const filePath of files) {
        const relativePath = relative(sourceFolder, filePath);
        const targetPath = join(targetFolder, relativePath);

        // Skip if target already exists (don't overwrite)
        if (existsSync(targetPath)) {
          this.logger.warn(`Target already exists, skipping: ${targetPath}`);
          continue;
        }

        try {
          // Create target directory
          await fs.mkdir(dirname(targetPath), { recursive: true });

          // Move file
          try {
            await fs.rename(filePath, targetPath);
          } catch (err: any) {
            if (err.code === 'EXDEV') {
              await fs.copyFile(filePath, targetPath);
              await fs.unlink(filePath);
            } else {
              throw err;
            }
          }

          await fs.chmod(targetPath, 0o664).catch(() => {});
          totalFilesMoved++;
        } catch (error: any) {
          const msg = `Failed to move ${filePath} → ${targetPath}: ${error.message}`;
          this.logger.error(msg);
          errors.push(msg);
          continue;
        }

        // Update DB path
        const dbFiles = await tx.file.findMany({
          where: { path: filePath },
          select: { id: true },
        });

        for (const dbFile of dbFiles) {
          await tx.file.update({
            where: { id: dbFile.id },
            data: { path: targetPath },
          });
          totalFilesUpdated++;
        }
      }

      // Clean up empty source directory
      try {
        await this.removeEmptyDirectories(sourceFolder);
      } catch (error: any) {
        this.logger.warn(`Could not clean up ${sourceFolder}: ${error.message}`);
      }
    }

    this.logger.log(
      `Entity folder merge complete: ${totalFilesMoved} files moved, ${totalFilesUpdated} DB paths updated, ${errors.length} errors`,
    );

    return { totalFilesMoved, totalFilesUpdated, errors };
  }

  /**
   * Get all files recursively from a directory
   */
  private getAllFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) return files;

    for (const item of readdirSync(dir)) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.getAllFilesRecursively(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * Remove empty directories bottom-up
   */
  private async removeEmptyDirectories(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        await this.removeEmptyDirectories(fullPath);
      }
    }

    // Re-check after cleaning subdirs
    if (readdirSync(dir).length === 0) {
      await fs.rmdir(dir);
    }
  }

  /**
   * Validate that all file paths in database match their physical files
   * Useful for debugging and verification
   */
  async validateFilePaths(tx?: PrismaTransaction): Promise<{
    total: number;
    valid: number;
    invalid: Array<{ id: string; path: string; reason: string }>;
  }> {
    const transaction = tx || this.prisma;

    const files = await transaction.file.findMany({
      select: { id: true, path: true },
    });

    const invalid: Array<{ id: string; path: string; reason: string }> = [];
    let valid = 0;

    for (const file of files) {
      if (!existsSync(file.path)) {
        invalid.push({
          id: file.id,
          path: file.path,
          reason: 'File does not exist on filesystem',
        });
      } else {
        valid++;
      }
    }

    return {
      total: files.length,
      valid,
      invalid,
    };
  }
}
