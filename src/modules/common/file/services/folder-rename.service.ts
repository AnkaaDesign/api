import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { promises as fs, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { PrismaTransaction } from '../repositories/file.repository';

/**
 * Service to handle folder renaming when customer/supplier/user names change
 * This ensures consistency between folder names and database records
 */
@Injectable()
export class FolderRenameService {
  private readonly logger = new Logger(FolderRenameService.name);
  private readonly webdavRoot = process.env.WEBDAV_ROOT || process.env.UPLOAD_DIR || './uploads/webdav';

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
        throw new InternalServerErrorException(
          `Failed to rename folder: ${error.message}`,
        );
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
      throw new InternalServerErrorException(
        `Failed to update file paths: ${error.message}`,
      );
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

    let totalFoldersRenamed = 0;
    let totalFilesUpdated = 0;

    // List of all folders that use customer fantasyName
    const foldersToRename = [
      // Projetos/{customerFantasyName} - Contains Imagens and PDFs subfolders
      { base: 'Projetos', name: oldSanitized },

      // Orcamentos/Tarefas/{customerFantasyName}
      { base: 'Orcamentos/Tarefas', name: oldSanitized },

      // Notas Fiscais/Tarefas/{customerFantasyName}
      { base: 'Notas Fiscais/Tarefas', name: oldSanitized },

      // Comprovantes/Tarefas/{customerFantasyName}
      { base: 'Comprovantes/Tarefas', name: oldSanitized },

      // Reembolsos/Tarefas/{customerFantasyName}
      { base: 'Reembolsos/Tarefas', name: oldSanitized },

      // Notas Fiscais Reembolso/Tarefas/{customerFantasyName}
      { base: 'Notas Fiscais Reembolso/Tarefas', name: oldSanitized },

      // Recortes/{customerFantasyName}
      { base: 'Recortes', name: oldSanitized },

      // Aerografias/{customerFantasyName}
      { base: 'Aerografias', name: oldSanitized },

      // Orcamentos/Aerografias/{customerFantasyName}
      { base: 'Orcamentos/Aerografias', name: oldSanitized },

      // Notas Fiscais/Aerografias/{customerFantasyName}
      { base: 'Notas Fiscais/Aerografias', name: oldSanitized },

      // Comprovantes/Aerografias/{customerFantasyName}
      { base: 'Comprovantes/Aerografias', name: oldSanitized },

      // Reembolsos/Aerografias/{customerFantasyName}
      { base: 'Reembolsos/Aerografias', name: oldSanitized },

      // Notas Fiscais Reembolso/Aerografias/{customerFantasyName}
      { base: 'Notas Fiscais Reembolso/Aerografias', name: oldSanitized },

      // Notas Fiscais/RetiradasExternas/{customerFantasyName}
      { base: 'Notas Fiscais/RetiradasExternas', name: oldSanitized },

      // Comprovantes/RetiradasExternas/{customerFantasyName}
      { base: 'Comprovantes/RetiradasExternas', name: oldSanitized },

      // Reembolsos/RetiradasExternas/{customerFantasyName}
      { base: 'Reembolsos/RetiradasExternas', name: oldSanitized },

      // Notas Fiscais Reembolso/RetiradasExternas/{customerFantasyName}
      { base: 'Notas Fiscais Reembolso/RetiradasExternas', name: oldSanitized },

      // Logos/Clientes/{customerFantasyName}
      { base: 'Logos/Clientes', name: oldSanitized },

      // Observacoes/{customerFantasyName}
      { base: 'Observacoes', name: oldSanitized },

      // Plotter/{customerFantasyName} - Contains Espovo and Adesivo subfolders
      { base: 'Plotter', name: oldSanitized },
    ];

    // Rename each folder
    for (const folder of foldersToRename) {
      const oldPath = join(this.webdavRoot, folder.base, folder.name);
      const newPath = join(this.webdavRoot, folder.base, newSanitized);

      const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);
      totalFoldersRenamed += result.foldersRenamed;
      totalFilesUpdated += result.filesUpdated;
    }

    this.logger.log(
      `Customer folder rename complete: ${totalFoldersRenamed} folders renamed, ${totalFilesUpdated} files updated`,
    );

    return { totalFoldersRenamed, totalFilesUpdated };
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

    let totalFoldersRenamed = 0;
    let totalFilesUpdated = 0;

    // List of all folders that use supplier fantasyName
    const foldersToRename = [
      // Orcamentos/Pedidos/{supplierFantasyName}
      { base: 'Orcamentos/Pedidos', name: oldSanitized },

      // Notas Fiscais/Pedidos/{supplierFantasyName}
      { base: 'Notas Fiscais/Pedidos', name: oldSanitized },

      // Comprovantes/Pedidos/{supplierFantasyName}
      { base: 'Comprovantes/Pedidos', name: oldSanitized },

      // Reembolsos/Pedidos/{supplierFantasyName}
      { base: 'Reembolsos/Pedidos', name: oldSanitized },

      // Notas Fiscais Reembolso/Pedidos/{supplierFantasyName}
      { base: 'Notas Fiscais Reembolso/Pedidos', name: oldSanitized },

      // Logos/Fornecedores/{supplierFantasyName}
      { base: 'Logos/Fornecedores', name: oldSanitized },
    ];

    // Rename each folder
    for (const folder of foldersToRename) {
      const oldPath = join(this.webdavRoot, folder.base, folder.name);
      const newPath = join(this.webdavRoot, folder.base, newSanitized);

      const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);
      totalFoldersRenamed += result.foldersRenamed;
      totalFilesUpdated += result.filesUpdated;
    }

    this.logger.log(
      `Supplier folder rename complete: ${totalFoldersRenamed} folders renamed, ${totalFilesUpdated} files updated`,
    );

    return { totalFoldersRenamed, totalFilesUpdated };
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

    let totalFoldersRenamed = 0;
    let totalFilesUpdated = 0;

    // List of all folders that use user name
    const foldersToRename = [
      // Colaboradores/{userName}
      { base: 'Colaboradores', name: oldSanitized },

      // Advertencias/{userName}
      { base: 'Advertencias', name: oldSanitized },
    ];

    // Rename each folder
    for (const folder of foldersToRename) {
      const oldPath = join(this.webdavRoot, folder.base, folder.name);
      const newPath = join(this.webdavRoot, folder.base, newSanitized);

      const result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx);
      totalFoldersRenamed += result.foldersRenamed;
      totalFilesUpdated += result.filesUpdated;
    }

    this.logger.log(
      `User folder rename complete: ${totalFoldersRenamed} folders renamed, ${totalFilesUpdated} files updated`,
    );

    return { totalFoldersRenamed, totalFilesUpdated };
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
