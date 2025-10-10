import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { promises as fs, existsSync, statSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { environmentConfig } from '../../../../common/config/environment.config';

/**
 * WebDAV folder mapping for different file types and contexts
 */
export interface WebDAVFolderMapping {
  // Entity-specific folders - Tasks
  tasksArtworks: string; // Artwork files for tasks
  taskBudgets: string; // Budget documents for tasks
  taskNfes: string; // Invoice files for tasks
  taskReceipts: string; // Receipt files for tasks
  taskReimbursements: string; // Reimbursement receipts for tasks
  taskNfeReimbursements: string; // Reimbursement NFEs for tasks

  // Entity-specific folders - Orders
  orderBudgets: string; // Budget documents for orders
  orderNfes: string; // Invoice files for orders
  orderReceipts: string; // Receipt files for orders
  orderReimbursements: string; // Reimbursement receipts for orders
  orderNfeReimbursements: string; // Reimbursement NFEs for orders

  // Entity-specific folders - Airbrushing
  airbrushingArtworks: string; // Artwork files for airbrushing
  airbrushingBudgets: string; // Budget documents for airbrushing
  airbrushingNfes: string; // Invoice files for airbrushing
  airbrushingReceipts: string; // Receipt files for airbrushing
  airbrushingReimbursements: string; // Reimbursement receipts for airbrushing
  airbrushingNfeReimbursements: string; // Reimbursement NFEs for airbrushing

  // Entity-specific folders - External Withdrawal
  externalWithdrawalNfes: string; // External withdrawal invoices
  externalWithdrawalReceipts: string; // External withdrawal receipts
  externalWithdrawalReimbursements: string; // External withdrawal reimbursement receipts
  externalWithdrawalNfeReimbursements: string; // External withdrawal reimbursement NFEs

  // Entity-specific folders - Logos
  customerLogo: string; // Customer logo files
  supplierLogo: string; // Supplier logo files

  // Entity-specific folders - Other
  observations: string; // Observation files
  warning: string; // Warning files
  layoutPhotos: string; // Layout photo files
  plotterEspovo: string; // Stencil (Espovo) plotter files
  plotterAdesivo: string; // Vinyl (Adesivo) plotter files
  thumbnails: string; // Thumbnail files

  // General folders
  general: string; // General files
  images: string; // General images
  documents: string; // General documents
  archives: string; // Archive files
  temp: string; // Temporary files
}

/**
 * File type categories for routing
 */
export enum FileTypeCategory {
  IMAGE = 'image',
  DOCUMENT = 'document',
  ARCHIVE = 'archive',
  ARTWORK = 'artwork',
  BUDGET = 'budget',
  INVOICE = 'invoice',
  RECEIPT = 'receipt',
  LOGO = 'logo',
  OTHER = 'other',
}

/**
 * WebDAV integration service for file management
 */
@Injectable()
export class WebDAVService {
  private readonly logger = new Logger(WebDAVService.name);
  private readonly webdavRoot = process.env.WEBDAV_ROOT || process.env.UPLOAD_DIR || './uploads/webdav';

  /**
   * WebDAV folder structure mapping - matches physical folder structure
   * Customer/supplier name-based organization is added dynamically in getWebDAVFolderPath
   */
  private readonly folderMapping: WebDAVFolderMapping = {
    // Task folders (organized by customer fantasyName)
    tasksArtworks: 'Projetos', // Task artworks -> Projetos/{customerFantasyName}/Imagens or /PDFs
    taskBudgets: 'Orcamentos/Tarefas',
    taskNfes: 'NFs/Tarefas',
    taskReceipts: 'Comprovantes/Tarefas/Comprovantes',
    taskReimbursements: 'Comprovantes/Tarefas/Reembolsos',
    taskNfeReimbursements: 'NFs/Tarefas/Reembolsos',

    // Order folders (organized by supplier fantasyName for some)
    orderBudgets: 'Orcamentos/Pedidos',
    orderNfes: 'NFs/Pedidos',
    orderReceipts: 'Comprovantes/Pedidos/Comprovantes',
    orderReimbursements: 'Comprovantes/Pedidos/Reembolsos',
    orderNfeReimbursements: 'NFs/Pedidos/Reembolsos',

    // Airbrushing folders
    airbrushingArtworks: 'Auxiliares/Aerografia/Artes',
    airbrushingBudgets: 'Orcamentos/Aerografia',
    airbrushingNfes: 'NFs/Aerografia',
    airbrushingReceipts: 'Comprovantes/Aerografia/Comprovantes',
    airbrushingReimbursements: 'Comprovantes/Aerografia/Reembolsos',
    airbrushingNfeReimbursements: 'NFs/Aerografia/Reembolsos',

    // External Withdrawal folders
    externalWithdrawalNfes: 'NFs/Retiradas',
    externalWithdrawalReceipts: 'Comprovantes/Retiradas/Comprovantes',
    externalWithdrawalReimbursements: 'Comprovantes/Retiradas/Reembolsos',
    externalWithdrawalNfeReimbursements: 'NFs/Retiradas/Reembolsos',

    // Logo folders (organized by customer/supplier fantasyName)
    customerLogo: 'Logos/Clientes', // Will add customer folder: Logos/Clientes/{customerFantasyName}/
    supplierLogo: 'Logos/Fornecedores', // Will add supplier folder: Logos/Fornecedores/{supplierFantasyName}/

    // Other entity folders
    observations: 'Observacoes', // Will add customer folder: Observacoes/{customerFantasyName}/
    warning: 'Advertencias', // Will add user folder: Advertencias/{userName}/
    layoutPhotos: 'Auxiliares/Traseiras/Fotos', // NEW
    plotterEspovo: 'Plotter', // Will add customer folder + Espovo: Plotter/{customerFantasyName}/Espovo/
    plotterAdesivo: 'Plotter', // Will add customer folder + Adesivo: Plotter/{customerFantasyName}/Adesivo/
    thumbnails: 'Thumbnails', // NEW - Will add size folder: Thumbnails/{size}/

    // General folders (WebDAV exclusive - will NOT be served via API)
    general: 'Auxiliares',
    images: 'Fotos',
    documents: 'Auxiliares',
    archives: 'Auxiliares',
    temp: 'Uploads',
  };

  /**
   * MIME type to category mapping
   */
  private readonly mimeToCategory: Record<string, FileTypeCategory> = {
    // Images
    'image/jpeg': FileTypeCategory.IMAGE,
    'image/jpg': FileTypeCategory.IMAGE,
    'image/png': FileTypeCategory.IMAGE,
    'image/gif': FileTypeCategory.IMAGE,
    'image/webp': FileTypeCategory.IMAGE,
    'image/svg+xml': FileTypeCategory.IMAGE,
    'image/bmp': FileTypeCategory.IMAGE,
    'image/tiff': FileTypeCategory.IMAGE,

    // Documents
    'application/pdf': FileTypeCategory.DOCUMENT,
    'application/msword': FileTypeCategory.DOCUMENT,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      FileTypeCategory.DOCUMENT,
    'application/vnd.ms-excel': FileTypeCategory.DOCUMENT,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileTypeCategory.DOCUMENT,
    'application/vnd.ms-powerpoint': FileTypeCategory.DOCUMENT,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      FileTypeCategory.DOCUMENT,
    'text/plain': FileTypeCategory.DOCUMENT,
    'text/csv': FileTypeCategory.DOCUMENT,
    'application/rtf': FileTypeCategory.DOCUMENT,

    // Archives
    'application/zip': FileTypeCategory.ARCHIVE,
    'application/x-zip-compressed': FileTypeCategory.ARCHIVE,
    'application/x-rar-compressed': FileTypeCategory.ARCHIVE,
    'application/x-7z-compressed': FileTypeCategory.ARCHIVE,
    'application/gzip': FileTypeCategory.ARCHIVE,

    // Artwork/Design files
    'application/postscript': FileTypeCategory.ARTWORK, // EPS files
    'application/x-eps': FileTypeCategory.ARTWORK,
    'application/eps': FileTypeCategory.ARTWORK,
    'image/eps': FileTypeCategory.ARTWORK,
    'image/x-eps': FileTypeCategory.ARTWORK,
    'application/vnd.corel-draw': FileTypeCategory.ARTWORK, // CDR files
    'application/x-corel-draw': FileTypeCategory.ARTWORK,
    'application/cdr': FileTypeCategory.ARTWORK,
    'application/x-cdr': FileTypeCategory.ARTWORK,
    'image/cdr': FileTypeCategory.ARTWORK,
    'image/x-cdr': FileTypeCategory.ARTWORK,
    'application/dxf': FileTypeCategory.ARTWORK, // CAD files
    'application/x-dxf': FileTypeCategory.ARTWORK,
    'image/vnd.dxf': FileTypeCategory.ARTWORK,
  };

  /**
   * Get WebDAV folder path based on file context with customer/supplier/user name-based organization
   */
  getWebDAVFolderPath(
    fileContext: keyof WebDAVFolderMapping | null,
    mimetype: string,
    entityId?: string,
    entityType?: string,
    projectId?: string,
    projectName?: string,
    customerName?: string, // Customer fantasy name for organization
    supplierName?: string, // Supplier fantasy name for organization
    userName?: string, // User name for warnings
    cutType?: string, // Cut type: 'STENCIL' or 'VINYL'
    thumbnailSize?: string, // Thumbnail size e.g., '300x300'
  ): string {
    let folderPath: string;

    // Priority 1: Specific entity context
    if (fileContext && this.folderMapping[fileContext]) {
      folderPath = this.folderMapping[fileContext];
    }
    // Priority 2: File type-based routing
    else {
      const category = this.mimeToCategory[mimetype] || FileTypeCategory.OTHER;

      switch (category) {
        case FileTypeCategory.IMAGE:
          folderPath = this.folderMapping.images;
          break;
        case FileTypeCategory.DOCUMENT:
          folderPath = this.folderMapping.documents;
          break;
        case FileTypeCategory.ARCHIVE:
          folderPath = this.folderMapping.archives;
          break;
        case FileTypeCategory.ARTWORK:
          folderPath = this.folderMapping.tasksArtworks; // Default to artwork folder
          break;
        default:
          folderPath = this.folderMapping.general;
      }
    }

    // Handle specific contexts with custom logic
    if (fileContext) {
      // PLOTTER: Add customer folder + cut type (Espovo/Adesivo)
      if (fileContext === 'plotterEspovo' || fileContext === 'plotterAdesivo') {
        if (customerName) {
          const sanitizedCustomerName = this.sanitizeFileName(customerName);
          const cutSubfolder = cutType === 'STENCIL' ? 'Espovo' : 'Adesivo';
          folderPath = join(folderPath, sanitizedCustomerName, cutSubfolder);
        }
      }
      // PROJETOS: Add customer folder for task artworks, then separate by file type (PDFs/Imagens)
      else if (fileContext === 'tasksArtworks') {
        if (customerName) {
          const sanitizedCustomerName = this.sanitizeFileName(customerName);
          // Determine subfolder based on file type
          const isPdf = mimetype === 'application/pdf';
          const subfolder = isPdf ? 'PDFs' : 'Imagens';
          folderPath = join(folderPath, sanitizedCustomerName, subfolder);
        }
      }
      // LOGOS: Add customer or supplier folder
      else if (fileContext === 'customerLogo' && customerName) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      } else if (fileContext === 'supplierLogo' && supplierName) {
        const sanitizedSupplierName = this.sanitizeFileName(supplierName);
        folderPath = join(folderPath, sanitizedSupplierName);
      }
      // OBSERVACOES: Add customer folder (via task)
      else if (fileContext === 'observations' && customerName) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // ADVERTENCIAS: Add user folder
      else if (fileContext === 'warning' && userName) {
        const sanitizedUserName = this.sanitizeFileName(userName);
        folderPath = join(folderPath, sanitizedUserName);
      }
      // THUMBNAILS: Add size folder
      else if (fileContext === 'thumbnails' && thumbnailSize) {
        folderPath = join(folderPath, thumbnailSize);
      }
    }

    // Add project-specific subfolder if provided (for artwork organization)
    if (projectId && projectName && fileContext === 'tasksArtworks') {
      const sanitizedProjectName = this.sanitizeFileName(projectName);
      folderPath = join(folderPath, sanitizedProjectName);
    }

    return join(this.webdavRoot, folderPath);
  }

  /**
   * Ensure WebDAV directory exists
   */
  async ensureWebDAVDirectory(folderPath: string): Promise<void> {
    try {
      if (!existsSync(folderPath)) {
        this.logger.log(`Creating WebDAV directory: ${folderPath}`);
        await fs.mkdir(folderPath, { recursive: true });

        // Set proper permissions for WebDAV
        try {
          await fs.chmod(folderPath, 0o2775); // rwxrwsr-x
        } catch (chmodError: any) {
          this.logger.warn(`Could not set permissions for ${folderPath}: ${chmodError.message}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to create WebDAV directory ${folderPath}:`, error);
      throw new InternalServerErrorException(`Failed to create WebDAV directory: ${error.message}`);
    }
  }

  /**
   * Generate WebDAV file path with unique filename and customer/supplier/user support
   */
  generateWebDAVFilePath(
    originalFilename: string,
    fileContext: keyof WebDAVFolderMapping | null,
    mimetype: string,
    entityId?: string,
    entityType?: string,
    projectId?: string,
    projectName?: string,
    customerName?: string,
    supplierName?: string,
    userName?: string,
    cutType?: string,
    thumbnailSize?: string,
  ): string {
    const folderPath = this.getWebDAVFolderPath(
      fileContext,
      mimetype,
      entityId,
      entityType,
      projectId,
      projectName,
      customerName,
      supplierName,
      userName,
      cutType,
      thumbnailSize,
    );

    // Generate unique filename while preserving extension
    const ext = extname(originalFilename);
    const baseName = basename(originalFilename, ext);
    const sanitizedBaseName = this.sanitizeFileName(baseName);

    // Add timestamp to ensure uniqueness
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const uniqueFilename = `${sanitizedBaseName}_${timestamp}${ext}`;

    return join(folderPath, uniqueFilename);
  }

  /**
   * Move file to WebDAV folder
   */
  async moveToWebDAV(sourcePath: string, targetPath: string): Promise<void> {
    try {
      // Ensure target directory exists
      const targetDir = dirname(targetPath);
      await this.ensureWebDAVDirectory(targetDir);

      // Check if source file exists
      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`Source file does not exist: ${sourcePath}`);
      }

      // Move the file
      await fs.rename(sourcePath, targetPath);

      // Set proper file permissions
      try {
        await fs.chmod(targetPath, 0o664); // rw-rw-r--
      } catch (chmodError: any) {
        this.logger.warn(`Could not set permissions for ${targetPath}: ${chmodError.message}`);
      }

      this.logger.log(`File moved to WebDAV: ${sourcePath} → ${targetPath}`);
    } catch (error: any) {
      this.logger.error(`Failed to move file to WebDAV:`, error);
      throw new InternalServerErrorException(`Failed to move file to WebDAV: ${error.message}`);
    }
  }

  /**
   * Copy file to WebDAV folder (keeps original)
   */
  async copyToWebDAV(sourcePath: string, targetPath: string): Promise<void> {
    try {
      // Ensure target directory exists
      const targetDir = dirname(targetPath);
      await this.ensureWebDAVDirectory(targetDir);

      // Check if source file exists
      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`Source file does not exist: ${sourcePath}`);
      }

      // Copy the file
      await fs.copyFile(sourcePath, targetPath);

      // Set proper file permissions
      try {
        await fs.chmod(targetPath, 0o664); // rw-rw-r--
      } catch (chmodError: any) {
        this.logger.warn(`Could not set permissions for ${targetPath}: ${chmodError.message}`);
      }

      this.logger.log(`File copied to WebDAV: ${sourcePath} → ${targetPath}`);
    } catch (error: any) {
      this.logger.error(`Failed to copy file to WebDAV:`, error);
      throw new InternalServerErrorException(`Failed to copy file to WebDAV: ${error.message}`);
    }
  }

  /**
   * Delete file from WebDAV
   */
  async deleteFromWebDAV(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        this.logger.log(`File deleted from WebDAV: ${filePath}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to delete file from WebDAV: ${filePath}`, error);
      // Don't throw - deletion should be non-blocking
    }
  }

  /**
   * Get WebDAV URL for file access
   */
  getWebDAVUrl(filePath: string): string {
    const baseUrl = process.env.WEBDAV_BASE_URL || 'https://arquivos.ankaa.live';
    const relativePath = filePath.replace(this.webdavRoot, '').replace(/\\/g, '/');
    const cleanPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

    return `${baseUrl}${cleanPath}`;
  }

  /**
   * Get file type category from MIME type
   */
  getFileCategory(mimetype: string): FileTypeCategory {
    return this.mimeToCategory[mimetype] || FileTypeCategory.OTHER;
  }

  /**
   * Sanitize filename for safe filesystem usage
   */
  private sanitizeFileName(filename: string): string {
    return filename
      .replace(/[<>:"|?*\x00-\x1f]/g, '_') // Replace invalid chars
      .replace(/\.\./g, '_') // Remove directory traversal
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Remove duplicate underscores
      .substring(0, 100); // Limit length
  }

  /**
   * Validate WebDAV connection and permissions
   */
  async validateWebDAVAccess(): Promise<boolean> {
    try {
      const testDir = join(this.webdavRoot, 'Auxiliares', 'test_access');

      // Test directory creation
      if (!existsSync(testDir)) {
        await fs.mkdir(testDir, { recursive: true });
      }

      // Test file write
      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'WebDAV access test');

      // Test file read
      const content = await fs.readFile(testFile, 'utf-8');

      // Cleanup
      await fs.unlink(testFile);
      await fs.rmdir(testDir);

      this.logger.log('WebDAV access validated successfully');
      return true;
    } catch (error: any) {
      this.logger.error('WebDAV access validation failed:', error);
      return false;
    }
  }

  /**
   * Get folder mapping configuration
   */
  getFolderMapping(): WebDAVFolderMapping {
    return { ...this.folderMapping };
  }

  /**
   * Get available file contexts for a given entity type
   */
  getAvailableContextsForEntity(entityType?: string): Array<keyof WebDAVFolderMapping> {
    if (!entityType) {
      return Object.keys(this.folderMapping) as Array<keyof WebDAVFolderMapping>;
    }

    const entityContextMap: Record<string, Array<keyof WebDAVFolderMapping>> = {
      task: [
        'tasksArtworks',
        'taskBudgets',
        'taskNfes',
        'taskReceipts',
        'taskReimbursements',
        'taskNfeReimbursements',
      ],
      order: [
        'orderBudgets',
        'orderNfes',
        'orderReceipts',
        'orderReimbursements',
        'orderNfeReimbursements',
      ],
      customer: ['customerLogo'],
      supplier: ['supplierLogo'],
      observation: ['observations'],
      warning: ['warning'],
      layout: ['layoutPhotos'],
      airbrushing: [
        'airbrushingArtworks',
        'airbrushingBudgets',
        'airbrushingNfes',
        'airbrushingReceipts',
        'airbrushingReimbursements',
        'airbrushingNfeReimbursements',
      ],
      externalWithdrawal: [
        'externalWithdrawalNfes',
        'externalWithdrawalReceipts',
        'externalWithdrawalReimbursements',
        'externalWithdrawalNfeReimbursements',
      ],
      cut: ['plotterEspovo', 'plotterAdesivo'],
      thumbnail: ['thumbnails'],
    };

    return entityContextMap[entityType.toLowerCase()] || ['general'];
  }

  /**
   * Get the best default context for a file based on its type and entity
   */
  getBestDefaultContext(
    mimetype: string,
    entityType?: string,
    entityId?: string,
  ): keyof WebDAVFolderMapping | null {
    const category = this.getFileCategory(mimetype);

    // If entity type is provided, try to match appropriate context
    if (entityType) {
      const availableContexts = this.getAvailableContextsForEntity(entityType);

      // For tasks, try to match file type to appropriate context
      if (entityType.toLowerCase() === 'task') {
        switch (category) {
          case FileTypeCategory.ARTWORK:
            return 'tasksArtworks';
          case FileTypeCategory.DOCUMENT:
            // Could be budget or receipt, default to budget
            return 'taskBudgets';
          default:
            return availableContexts[0] as keyof WebDAVFolderMapping;
        }
      }

      // For orders
      if (entityType.toLowerCase() === 'order') {
        switch (category) {
          case FileTypeCategory.DOCUMENT:
            return 'orderBudgets';
          default:
            return availableContexts[0] as keyof WebDAVFolderMapping;
        }
      }

      // Return first available context for other entity types
      return availableContexts[0] as keyof WebDAVFolderMapping;
    }

    // No entity type, use file category
    switch (category) {
      case FileTypeCategory.ARTWORK:
        return 'tasksArtworks';
      case FileTypeCategory.IMAGE:
        return 'images';
      case FileTypeCategory.DOCUMENT:
        return 'documents';
      case FileTypeCategory.ARCHIVE:
        return 'archives';
      default:
        return 'general';
    }
  }
}
