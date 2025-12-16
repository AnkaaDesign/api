import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { promises as fs, existsSync } from 'fs';
import { join, extname, basename, dirname } from 'path';

/**
 * Files storage folder mapping for different file types and contexts
 * Files are stored in /srv/files (production) and served by nginx via arquivos.ankaa.live
 * Local access is provided via Samba share
 */
export interface FilesFolderMapping {
  // Entity-specific folders - Tasks
  tasksArtworks: string;
  taskBudgets: string;
  taskInvoices: string;
  taskReceipts: string;
  taskReimbursements: string;
  taskNfeReimbursements: string;
  cutFiles: string;

  // Entity-specific folders - Orders
  orderBudgets: string;
  orderInvoices: string;
  orderReceipts: string;
  orderReimbursements: string;
  orderNfeReimbursements: string;

  // Entity-specific folders - Airbrushing
  airbrushingArtworks: string;
  airbrushingBudgets: string;
  airbrushingInvoices: string;
  airbrushingReceipts: string;
  airbrushingReimbursements: string;
  airbrushingNfeReimbursements: string;

  // Entity-specific folders - External Withdrawal
  externalWithdrawalInvoices: string;
  externalWithdrawalReceipts: string;
  externalWithdrawalReimbursements: string;
  externalWithdrawalNfeReimbursements: string;

  // Entity-specific folders - Logos
  customerLogo: string;
  supplierLogo: string;

  // Entity-specific folders - User
  userAvatar: string;

  // Entity-specific folders - Other
  observations: string;
  warning: string;
  layoutPhotos: string;
  plotterEspovo: string;
  plotterAdesivo: string;
  thumbnails: string;
  paintColor: string;

  // General folders
  general: string;
  images: string;
  documents: string;
  archives: string;
  temp: string;
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
 * Files storage service for file management
 * Production: FILES_ROOT=/srv/files served by nginx via arquivos.ankaa.live
 * Local access: Via Samba share at /srv/files
 */
@Injectable()
export class FilesStorageService {
  private readonly logger = new Logger(FilesStorageService.name);

  // Files storage root directory
  // Production: FILES_ROOT=/srv/files
  // Development: FILES_ROOT=./uploads/files
  private readonly filesRoot = process.env.FILES_ROOT || './uploads/files';

  /**
   * Folder structure mapping - matches physical folder structure in /srv/files
   */
  private readonly folderMapping: FilesFolderMapping = {
    // Task folders (organized by customer fantasyName)
    tasksArtworks: 'Projetos',
    taskBudgets: 'Orcamentos/Tarefas',
    taskInvoices: 'Notas Fiscais/Tarefas',
    taskReceipts: 'Comprovantes/Tarefas',
    taskReimbursements: 'Reembolsos/Tarefas',
    taskNfeReimbursements: 'Notas Fiscais Reembolso/Tarefas',
    cutFiles: 'Recortes',

    // Order folders
    orderBudgets: 'Orcamentos/Pedidos',
    orderInvoices: 'Notas Fiscais/Pedidos',
    orderReceipts: 'Comprovantes/Pedidos',
    orderReimbursements: 'Reembolsos/Pedidos',
    orderNfeReimbursements: 'Notas Fiscais Reembolso/Pedidos',

    // Airbrushing folders
    airbrushingArtworks: 'Aerografias',
    airbrushingBudgets: 'Orcamentos/Aerografias',
    airbrushingInvoices: 'Notas Fiscais/Aerografias',
    airbrushingReceipts: 'Comprovantes/Aerografias',
    airbrushingReimbursements: 'Reembolsos/Aerografias',
    airbrushingNfeReimbursements: 'Notas Fiscais Reembolso/Aerografias',

    // External Withdrawal folders
    externalWithdrawalInvoices: 'Notas Fiscais/RetiradasExternas',
    externalWithdrawalReceipts: 'Comprovantes/RetiradasExternas',
    externalWithdrawalReimbursements: 'Reembolsos/RetiradasExternas',
    externalWithdrawalNfeReimbursements: 'Notas Fiscais Reembolso/RetiradasExternas',

    // Logo folders
    customerLogo: 'Logos/Clientes',
    supplierLogo: 'Logos/Fornecedores',

    // User folders
    userAvatar: 'Colaboradores',

    // Other entity folders
    observations: 'Observacoes',
    warning: 'Advertencias',
    layoutPhotos: 'Auxiliares/Traseiras/Fotos',
    plotterEspovo: 'Plotter',
    plotterAdesivo: 'Plotter',
    thumbnails: 'Thumbnails',
    paintColor: 'Tintas',

    // General folders
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
    'application/postscript': FileTypeCategory.ARTWORK,
    'application/x-eps': FileTypeCategory.ARTWORK,
    'application/eps': FileTypeCategory.ARTWORK,
    'image/eps': FileTypeCategory.ARTWORK,
    'image/x-eps': FileTypeCategory.ARTWORK,
    'application/vnd.corel-draw': FileTypeCategory.ARTWORK,
    'application/x-corel-draw': FileTypeCategory.ARTWORK,
    'application/cdr': FileTypeCategory.ARTWORK,
    'application/x-cdr': FileTypeCategory.ARTWORK,
    'image/cdr': FileTypeCategory.ARTWORK,
    'image/x-cdr': FileTypeCategory.ARTWORK,
    'application/dxf': FileTypeCategory.ARTWORK,
    'application/x-dxf': FileTypeCategory.ARTWORK,
    'image/vnd.dxf': FileTypeCategory.ARTWORK,
  };

  /**
   * Get files storage folder path based on file context
   */
  getFolderPath(
    fileContext: keyof FilesFolderMapping | null,
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
          folderPath = this.folderMapping.tasksArtworks;
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
      // PROJETOS: Add customer folder for task artworks
      else if (fileContext === 'tasksArtworks') {
        if (customerName) {
          const sanitizedCustomerName = this.sanitizeFileName(customerName);
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
      // OBSERVACOES: Add customer folder
      else if (fileContext === 'observations' && customerName) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // ADVERTENCIAS: Add user folder
      else if (fileContext === 'warning' && userName) {
        const sanitizedUserName = this.sanitizeFileName(userName);
        folderPath = join(folderPath, sanitizedUserName);
      }
      // TASKS: Add customer folder for task-related files
      else if (
        (fileContext === 'taskBudgets' ||
          fileContext === 'taskInvoices' ||
          fileContext === 'taskReceipts' ||
          fileContext === 'taskReimbursements' ||
          fileContext === 'taskNfeReimbursements') &&
        customerName
      ) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // CUT FILES: Add customer folder
      else if (fileContext === 'cutFiles' && customerName) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // AIRBRUSHING: Add customer folder
      else if (
        (fileContext === 'airbrushingArtworks' ||
          fileContext === 'airbrushingBudgets' ||
          fileContext === 'airbrushingInvoices' ||
          fileContext === 'airbrushingReceipts' ||
          fileContext === 'airbrushingReimbursements' ||
          fileContext === 'airbrushingNfeReimbursements') &&
        customerName
      ) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // EXTERNAL WITHDRAWALS: Add customer folder
      else if (
        (fileContext === 'externalWithdrawalInvoices' ||
          fileContext === 'externalWithdrawalReceipts' ||
          fileContext === 'externalWithdrawalReimbursements' ||
          fileContext === 'externalWithdrawalNfeReimbursements') &&
        customerName
      ) {
        const sanitizedCustomerName = this.sanitizeFileName(customerName);
        folderPath = join(folderPath, sanitizedCustomerName);
      }
      // ORDERS: Add supplier folder
      else if (
        (fileContext === 'orderBudgets' ||
          fileContext === 'orderInvoices' ||
          fileContext === 'orderReceipts' ||
          fileContext === 'orderReimbursements' ||
          fileContext === 'orderNfeReimbursements') &&
        supplierName
      ) {
        const sanitizedSupplierName = this.sanitizeFileName(supplierName);
        folderPath = join(folderPath, sanitizedSupplierName);
      }
      // USER AVATAR: Add user folder
      else if (fileContext === 'userAvatar' && userName) {
        const sanitizedUserName = this.sanitizeFileName(userName);
        folderPath = join(folderPath, sanitizedUserName);
      }
      // THUMBNAILS: Add size folder
      else if (fileContext === 'thumbnails' && thumbnailSize) {
        folderPath = join(folderPath, thumbnailSize);
      }
    }

    // Add project-specific subfolder if provided
    if (projectId && projectName && fileContext === 'tasksArtworks') {
      const sanitizedProjectName = this.sanitizeFileName(projectName);
      folderPath = join(folderPath, sanitizedProjectName);
    }

    return join(this.filesRoot, folderPath);
  }

  /**
   * Ensure directory exists with proper permissions
   */
  async ensureDirectory(folderPath: string): Promise<void> {
    try {
      if (!existsSync(folderPath)) {
        this.logger.log(`Creating directory: ${folderPath}`);
        await fs.mkdir(folderPath, { recursive: true });

        try {
          await fs.chmod(folderPath, 0o2775);
        } catch (chmodError: any) {
          this.logger.warn(`Could not set permissions for ${folderPath}: ${chmodError.message}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to create directory ${folderPath}:`, error);
      throw new InternalServerErrorException(`Failed to create directory: ${error.message}`);
    }
  }

  /**
   * Generate file path with unique filename
   */
  generateFilePath(
    originalFilename: string,
    fileContext: keyof FilesFolderMapping | null,
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
    const folderPath = this.getFolderPath(
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

    const ext = extname(originalFilename);
    const baseName = basename(originalFilename, ext);
    const sanitizedBaseName = this.sanitizeFileName(baseName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const uniqueFilename = `${sanitizedBaseName}_${timestamp}${ext}`;

    return join(folderPath, uniqueFilename);
  }

  /**
   * Move file to storage
   */
  async moveToStorage(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const targetDir = dirname(targetPath);
      await this.ensureDirectory(targetDir);

      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`Source file does not exist: ${sourcePath}`);
      }

      await fs.rename(sourcePath, targetPath);

      try {
        await fs.chmod(targetPath, 0o664);
      } catch (chmodError: any) {
        this.logger.warn(`Could not set permissions for ${targetPath}: ${chmodError.message}`);
      }

      this.logger.log(`File moved to storage: ${sourcePath} -> ${targetPath}`);
    } catch (error: any) {
      this.logger.error(`Failed to move file to storage:`, error);
      throw new InternalServerErrorException(`Failed to move file to storage: ${error.message}`);
    }
  }

  /**
   * Copy file to storage (keeps original)
   */
  async copyToStorage(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const targetDir = dirname(targetPath);
      await this.ensureDirectory(targetDir);

      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`Source file does not exist: ${sourcePath}`);
      }

      await fs.copyFile(sourcePath, targetPath);

      try {
        await fs.chmod(targetPath, 0o664);
      } catch (chmodError: any) {
        this.logger.warn(`Could not set permissions for ${targetPath}: ${chmodError.message}`);
      }

      this.logger.log(`File copied to storage: ${sourcePath} -> ${targetPath}`);
    } catch (error: any) {
      this.logger.error(`Failed to copy file to storage:`, error);
      throw new InternalServerErrorException(`Failed to copy file to storage: ${error.message}`);
    }
  }

  /**
   * Delete file from storage
   */
  async deleteFromStorage(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        await fs.unlink(filePath);
        this.logger.log(`File deleted from storage: ${filePath}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to delete file from storage: ${filePath}`, error);
    }
  }

  /**
   * Get public URL for file access (served by nginx via arquivos.ankaa.live)
   */
  getFileUrl(filePath: string): string {
    const baseUrl = process.env.FILES_BASE_URL || 'https://arquivos.ankaa.live';

    const normalizedFilePath = filePath.replace(/^\.\//, '');
    const normalizedRoot = this.filesRoot.replace(/^\.\//, '');

    const relativePath = normalizedFilePath.replace(normalizedRoot, '').replace(/\\/g, '/');
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
      .replace(/[<>:"|?*\x00-\x1f]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  /**
   * Validate storage access and permissions
   */
  async validateStorageAccess(): Promise<boolean> {
    try {
      const testDir = join(this.filesRoot, 'Auxiliares', 'test_access');

      if (!existsSync(testDir)) {
        await fs.mkdir(testDir, { recursive: true });
      }

      const testFile = join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'Storage access test');
      await fs.readFile(testFile, 'utf-8');

      await fs.unlink(testFile);
      await fs.rmdir(testDir);

      this.logger.log('Storage access validated successfully');
      return true;
    } catch (error: any) {
      this.logger.error('Storage access validation failed:', error);
      return false;
    }
  }

  /**
   * Get folder mapping configuration
   */
  getFolderMapping(): FilesFolderMapping {
    return { ...this.folderMapping };
  }

  /**
   * Get files root path
   */
  getFilesRoot(): string {
    return this.filesRoot;
  }

  /**
   * Get available file contexts for a given entity type
   */
  getAvailableContextsForEntity(entityType?: string): Array<keyof FilesFolderMapping> {
    if (!entityType) {
      return Object.keys(this.folderMapping) as Array<keyof FilesFolderMapping>;
    }

    const entityContextMap: Record<string, Array<keyof FilesFolderMapping>> = {
      task: [
        'tasksArtworks',
        'taskBudgets',
        'taskInvoices',
        'taskReceipts',
        'taskReimbursements',
        'taskNfeReimbursements',
      ],
      order: [
        'orderBudgets',
        'orderInvoices',
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
        'airbrushingInvoices',
        'airbrushingReceipts',
        'airbrushingReimbursements',
        'airbrushingNfeReimbursements',
      ],
      externalWithdrawal: [
        'externalWithdrawalInvoices',
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
  ): keyof FilesFolderMapping | null {
    const category = this.getFileCategory(mimetype);

    if (entityType) {
      const availableContexts = this.getAvailableContextsForEntity(entityType);

      if (entityType.toLowerCase() === 'task') {
        switch (category) {
          case FileTypeCategory.ARTWORK:
            return 'tasksArtworks';
          case FileTypeCategory.DOCUMENT:
            return 'taskBudgets';
          default:
            return availableContexts[0] as keyof FilesFolderMapping;
        }
      }

      if (entityType.toLowerCase() === 'order') {
        switch (category) {
          case FileTypeCategory.DOCUMENT:
            return 'orderBudgets';
          default:
            return availableContexts[0] as keyof FilesFolderMapping;
        }
      }

      return availableContexts[0] as keyof FilesFolderMapping;
    }

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
