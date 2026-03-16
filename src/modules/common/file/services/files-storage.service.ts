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
 * Files are stored in /srv/files (production) and served by nginx via arquivos.ankaadesign.com.br
 * Local access is provided via Samba share
 */
export interface FilesFolderMapping {
  // Entity-specific folders - Tasks
  tasksArtworks: string;
  taskBudgets: string;
  taskInvoices: string;
  taskReceipts: string;
  taskBankSlips: string;
  taskReimbursements: string;
  taskNfeReimbursements: string;
  cutFiles: string;
  taskBaseFiles: string;
  taskProjectFiles: string;
  taskCheckinFiles: string;
  taskCheckoutFiles: string;
  serviceOrderCheckinFiles: string;
  serviceOrderCheckoutFiles: string;

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
  signedPpeDocuments: string;

  // Entity-specific folders - Other
  observations: string;
  warning: string;
  layoutPhotos: string;
  'quote-layouts': string;
  plotterEspovo: string;
  plotterAdesivo: string;
  thumbnails: string;
  paintColor: string;
  messageImages: string;

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
 * Production: FILES_ROOT=/srv/files served by nginx via arquivos.ankaadesign.com.br
 * Local access: Via Samba share at /srv/files
 */
@Injectable()
export class FilesStorageService {
  private readonly logger = new Logger(FilesStorageService.name);

  // Files storage root directory
  // Production: FILES_ROOT=/srv/files
  // Development: FILES_ROOT=./files
  private readonly filesRoot = process.env.FILES_ROOT || './files';

  /**
   * Folder structure mapping — suffix after entity root (Clientes/{name}/ or Fornecedores/{name}/)
   * For non-entity contexts (user, root-level), these are full paths from filesRoot.
   */
  private readonly folderMapping: FilesFolderMapping = {
    // Task folders (under Clientes/{customerName}/)
    tasksArtworks: 'Layouts',
    taskBudgets: 'Orcamentos',
    taskInvoices: 'Notas Fiscais',
    taskReceipts: 'Comprovantes',
    taskBankSlips: 'Boletos',
    taskReimbursements: 'Reembolsos',
    taskNfeReimbursements: 'Notas Fiscais Reembolso',
    cutFiles: 'Plotter',
    taskBaseFiles: 'Outros',
    taskProjectFiles: 'Projetos',
    taskCheckinFiles: 'Checkin',
    taskCheckoutFiles: 'Checkout',
    serviceOrderCheckinFiles: 'Checkin',
    serviceOrderCheckoutFiles: 'Checkout',

    // Order folders (under Fornecedores/{supplierName}/)
    orderBudgets: 'Orcamentos',
    orderInvoices: 'Notas Fiscais',
    orderReceipts: 'Comprovantes',
    orderReimbursements: 'Reembolsos',
    orderNfeReimbursements: 'Notas Fiscais Reembolso',

    // Airbrushing folders (under Clientes/{customerName}/)
    airbrushingArtworks: 'Aerografias',
    airbrushingBudgets: 'Aerografias/Orcamentos',
    airbrushingInvoices: 'Aerografias/Notas Fiscais',
    airbrushingReceipts: 'Aerografias/Comprovantes',
    airbrushingReimbursements: 'Aerografias/Reembolsos',
    airbrushingNfeReimbursements: 'Aerografias/Notas Fiscais Reembolso',

    // External Withdrawal folders (root-level, not entity-based)
    externalWithdrawalInvoices: 'Notas Fiscais/RetiradasExternas',
    externalWithdrawalReceipts: 'Comprovantes/RetiradasExternas',
    externalWithdrawalReimbursements: 'Reembolsos/RetiradasExternas',
    externalWithdrawalNfeReimbursements: 'Notas Fiscais Reembolso/RetiradasExternas',

    // Logo folders (under respective entity root)
    customerLogo: 'Logo',
    supplierLogo: 'Logo',

    // User folders (under Colaboradores/{userName}/)
    userAvatar: 'Fotos',
    signedPpeDocuments: 'EPIs',

    // Other entity folders
    observations: 'Observacoes',
    warning: 'Advertencias',
    layoutPhotos: 'Traseiras',
    'quote-layouts': 'Layouts',
    plotterEspovo: 'Plotter',
    plotterAdesivo: 'Plotter',
    thumbnails: 'Thumbnails',
    paintColor: 'Tintas',
    messageImages: 'Mensagens',

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
   * Contexts that belong under Clientes/{customerName}/
   */
  private readonly customerContexts: ReadonlySet<keyof FilesFolderMapping> = new Set([
    'tasksArtworks',
    'taskBudgets',
    'taskInvoices',
    'taskReceipts',
    'taskBankSlips',
    'taskReimbursements',
    'taskNfeReimbursements',
    'cutFiles',
    'taskBaseFiles',
    'taskProjectFiles',
    'taskCheckinFiles',
    'taskCheckoutFiles',
    'serviceOrderCheckinFiles',
    'serviceOrderCheckoutFiles',
    'airbrushingArtworks',
    'airbrushingBudgets',
    'airbrushingInvoices',
    'airbrushingReceipts',
    'airbrushingReimbursements',
    'airbrushingNfeReimbursements',
    'customerLogo',
    'observations',
    'layoutPhotos',
    'quote-layouts',
    'plotterEspovo',
    'plotterAdesivo',
  ]);

  /**
   * Contexts that belong under Fornecedores/{supplierName}/
   */
  private readonly supplierContexts: ReadonlySet<keyof FilesFolderMapping> = new Set([
    'orderBudgets',
    'orderInvoices',
    'orderReceipts',
    'orderReimbursements',
    'orderNfeReimbursements',
    'supplierLogo',
  ]);

  /**
   * Contexts that belong under Colaboradores/{userName}/
   */
  private readonly userContexts: ReadonlySet<keyof FilesFolderMapping> = new Set([
    'userAvatar',
    'signedPpeDocuments',
    'warning',
  ]);

  /**
   * Determine entity root and entity name for a given context.
   * Returns null for non-entity contexts (root-level).
   */
  private getEntityRoot(
    fileContext: keyof FilesFolderMapping,
    customerName?: string,
    supplierName?: string,
    userName?: string,
  ): { root: string; entityName: string } | null {
    if (this.customerContexts.has(fileContext) && customerName) {
      return { root: 'Clientes', entityName: this.sanitizeFileName(customerName) };
    }
    if (this.supplierContexts.has(fileContext) && supplierName) {
      return { root: 'Fornecedores', entityName: this.sanitizeFileName(supplierName) };
    }
    if (this.userContexts.has(fileContext) && userName) {
      return { root: 'Colaboradores', entityName: this.sanitizeFileName(userName) };
    }
    return null;
  }

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
    paintName?: string,
  ): string {
    let contextSuffix: string;

    // Priority 1: Specific entity context
    if (fileContext && this.folderMapping[fileContext]) {
      contextSuffix = this.folderMapping[fileContext];
    }
    // Priority 2: File type-based routing
    else {
      const category = this.mimeToCategory[mimetype] || FileTypeCategory.OTHER;

      switch (category) {
        case FileTypeCategory.IMAGE:
          contextSuffix = this.folderMapping.images;
          break;
        case FileTypeCategory.DOCUMENT:
          contextSuffix = this.folderMapping.documents;
          break;
        case FileTypeCategory.ARCHIVE:
          contextSuffix = this.folderMapping.archives;
          break;
        case FileTypeCategory.ARTWORK:
          contextSuffix = this.folderMapping.tasksArtworks;
          break;
        default:
          contextSuffix = this.folderMapping.general;
      }
    }

    // Build entity-first path if applicable
    let folderPath: string;

    if (fileContext) {
      const entityRoot = this.getEntityRoot(fileContext, customerName, supplierName, userName);

      if (entityRoot) {
        // Entity-first: {root}/{entityName}/{contextSuffix}
        folderPath = join(entityRoot.root, entityRoot.entityName, contextSuffix);
      } else if (this.customerContexts.has(fileContext)) {
        // Customer context but no customer name — catch-all folder
        this.logger.warn(
          `[getFolderPath] Missing customerName for customer context "${fileContext}" — file will be placed in Clientes/Outros/. Ensure customerName is passed from the upload flow.`,
        );
        folderPath = join('Clientes', 'Outros', contextSuffix);
      } else if (this.supplierContexts.has(fileContext)) {
        // Supplier context but no supplier name — catch-all folder
        this.logger.warn(
          `[getFolderPath] Missing supplierName for supplier context "${fileContext}" — file will be placed in Fornecedores/Outros/.`,
        );
        folderPath = join('Fornecedores', 'Outros', contextSuffix);
      } else if (this.userContexts.has(fileContext)) {
        // User context but no user name — catch-all folder
        this.logger.warn(
          `[getFolderPath] Missing userName for user context "${fileContext}" — file will be placed in Colaboradores/Outros/.`,
        );
        folderPath = join('Colaboradores', 'Outros', contextSuffix);
      } else {
        // Non-entity context: direct path from root
        folderPath = contextSuffix;
      }

      // Apply sub-folder logic for specific contexts
      if (fileContext === 'plotterEspovo' || fileContext === 'plotterAdesivo') {
        const cutSubfolder = cutType === 'STENCIL' ? 'Espovo' : 'Adesivo';
        folderPath = join(folderPath, cutSubfolder);
      } else if (fileContext === 'tasksArtworks' || fileContext === 'quote-layouts') {
        const isPdf = mimetype === 'application/pdf';
        folderPath = join(folderPath, isPdf ? 'PDFs' : 'Imagens');
      } else if (fileContext === 'taskBaseFiles') {
        const isImage = mimetype.startsWith('image/');
        folderPath = join(folderPath, isImage ? 'Imagens' : 'Documentos');
      } else if (fileContext === 'taskProjectFiles') {
        const isPdf = mimetype === 'application/pdf';
        folderPath = join(folderPath, isPdf ? 'PDFs' : 'Imagens');
      } else if (fileContext === 'thumbnails' && thumbnailSize) {
        folderPath = join(folderPath, thumbnailSize);
      } else if (fileContext === 'paintColor' && paintName) {
        folderPath = join(folderPath, this.sanitizeFileName(paintName));
      }
    } else {
      folderPath = contextSuffix;
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
    paintName?: string,
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
      paintName,
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
   * Uses copy + unlink to handle cross-filesystem moves (EXDEV error)
   */
  async moveToStorage(sourcePath: string, targetPath: string): Promise<void> {
    try {
      const targetDir = dirname(targetPath);
      await this.ensureDirectory(targetDir);

      if (!existsSync(sourcePath)) {
        throw new BadRequestException(`Source file does not exist: ${sourcePath}`);
      }

      // Use copy + unlink instead of rename to handle cross-filesystem moves
      await fs.copyFile(sourcePath, targetPath);
      await fs.unlink(sourcePath);

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
   * Move file within storage (for file organization)
   * Handles cross-filesystem moves by copying then deleting
   */
  async moveWithinStorage(sourcePath: string, targetPath: string): Promise<void> {
    const targetDir = dirname(targetPath);
    await this.ensureDirectory(targetDir);

    try {
      await fs.rename(sourcePath, targetPath);
    } catch (error: any) {
      if (error.code === 'EXDEV') {
        // Cross-filesystem: copy then delete
        await fs.copyFile(sourcePath, targetPath);
        await fs.unlink(sourcePath);
      } else {
        throw error;
      }
    }

    try {
      await fs.chmod(targetPath, 0o664);
    } catch (chmodError: any) {
      this.logger.warn(`Could not set permissions for ${targetPath}: ${chmodError.message}`);
    }

    this.logger.log(`File moved within storage: ${sourcePath} -> ${targetPath}`);
  }

  /**
   * Get public URL for file access (served by nginx via arquivos.ankaadesign.com.br)
   */
  getFileUrl(filePath: string): string {
    const baseUrl = process.env.FILES_BASE_URL || 'https://arquivos.ankaadesign.com.br';

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
  sanitizeFileName(filename: string): string {
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
        'taskBankSlips',
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
      message: ['messageImages'],
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
