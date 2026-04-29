import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FilesStorageService, type FilesFolderMapping } from './files-storage.service';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../../constants/enums';

interface MisplacedFile {
  id: string;
  filename: string;
  currentPath: string;
  expectedPath: string;
  entityType: 'customer' | 'supplier' | 'user';
  entityName: string;
  fileContext: string;
}

interface OrganizationStats {
  filesScanned: number;
  misplacedFilesFound: number;
  filesMoved: number;
  filesSkipped: number;
  errors: string[];
}

interface OrganizationReport {
  misplacedFiles: MisplacedFile[];
  summary: {
    totalMisplaced: number;
    byEntityType: Record<string, number>;
    byContext: Record<string, number>;
  };
}

/**
 * Context-to-entity mapping for determining which entity name is required for each context
 */
const CONTEXT_ENTITY_MAP: Record<string, 'customer' | 'supplier' | 'user' | null> = {
  // Customer-based contexts
  tasksArtworks: 'customer',
  taskBudgets: 'customer',
  taskInvoices: 'customer',
  taskReceipts: 'customer',
  taskBankSlips: 'customer',
  taskReimbursements: 'customer',
  taskNfeReimbursements: 'customer',
  cutFiles: 'customer',
  taskBaseFiles: 'customer',
  taskProjectFiles: 'customer',
  taskCheckinFiles: 'customer',
  taskCheckoutFiles: 'customer',
  customerLogo: 'customer',
  observations: 'customer',
  layoutPhotos: 'customer',
  'quote-layouts': 'customer',
  plotterEspovo: 'customer',
  plotterAdesivo: 'customer',
  airbrushingArtworks: 'customer',
  airbrushingBudgets: 'customer',
  airbrushingInvoices: 'customer',
  airbrushingReceipts: 'customer',
  airbrushingReimbursements: 'customer',
  airbrushingNfeReimbursements: 'customer',

  // Supplier-based contexts
  supplierLogo: 'supplier',
  orderBudgets: 'supplier',
  orderInvoices: 'supplier',
  orderReceipts: 'supplier',
  orderReimbursements: 'supplier',
  orderNfeReimbursements: 'supplier',

  // User-based contexts
  userAvatar: 'user',
  warning: 'user',
  signedPpeDocuments: 'user',

  // No entity name required (root-level or non-entity)
  externalWithdrawalInvoices: null,
  externalWithdrawalReceipts: null,
  externalWithdrawalReimbursements: null,
  externalWithdrawalNfeReimbursements: null,
  thumbnails: null,
  paintColor: null,
  messageImages: null,
  general: null,
  images: null,
  documents: null,
  archives: null,
  temp: null,
};

/**
 * File context detection mapping - maps folder patterns to file contexts.
 * Order matters: more specific patterns must come before more general ones.
 * Entity-first paths: Clientes/{name}/{suffix}/ and Fornecedores/{name}/{suffix}/
 */
const FOLDER_TO_CONTEXT_MAP: Array<{ pattern: RegExp; context: keyof FilesFolderMapping }> = [
  // Airbrushing (more specific — must come before generic Aerografias)
  {
    pattern: /\/Clientes\/[^/]+\/Aerografias\/Notas Fiscais Reembolso\//,
    context: 'airbrushingNfeReimbursements',
  },
  { pattern: /\/Clientes\/[^/]+\/Aerografias\/Notas Fiscais\//, context: 'airbrushingInvoices' },
  { pattern: /\/Clientes\/[^/]+\/Aerografias\/Orcamentos\//, context: 'airbrushingBudgets' },
  { pattern: /\/Clientes\/[^/]+\/Aerografias\/Comprovantes\//, context: 'airbrushingReceipts' },
  { pattern: /\/Clientes\/[^/]+\/Aerografias\/Reembolsos\//, context: 'airbrushingReimbursements' },
  { pattern: /\/Clientes\/[^/]+\/Aerografias\//, context: 'airbrushingArtworks' },

  // Customer contexts
  { pattern: /\/Clientes\/[^/]+\/Layouts\//, context: 'tasksArtworks' },
  { pattern: /\/Clientes\/[^/]+\/Projetos\//, context: 'taskProjectFiles' },
  { pattern: /\/Clientes\/[^/]+\/Checkin\//, context: 'taskCheckinFiles' },
  { pattern: /\/Clientes\/[^/]+\/Checkout\//, context: 'taskCheckoutFiles' },
  { pattern: /\/Clientes\/[^/]+\/Traseiras\//, context: 'layoutPhotos' },
  { pattern: /\/Clientes\/[^/]+\/Notas Fiscais Reembolso\//, context: 'taskNfeReimbursements' },
  { pattern: /\/Clientes\/[^/]+\/Notas Fiscais\//, context: 'taskInvoices' },
  { pattern: /\/Clientes\/[^/]+\/Orcamentos\//, context: 'taskBudgets' },
  { pattern: /\/Clientes\/[^/]+\/Comprovantes\//, context: 'taskReceipts' },
  { pattern: /\/Clientes\/[^/]+\/Boletos\//, context: 'taskBankSlips' },
  { pattern: /\/Clientes\/[^/]+\/Reembolsos\//, context: 'taskReimbursements' },
  { pattern: /\/Clientes\/[^/]+\/Plotter\//, context: 'cutFiles' },
  { pattern: /\/Clientes\/[^/]+\/Outros\//, context: 'taskBaseFiles' },
  { pattern: /\/Clientes\/[^/]+\/Observacoes\//, context: 'observations' },
  { pattern: /\/Clientes\/[^/]+\/Logo\//, context: 'customerLogo' },

  // Supplier contexts
  {
    pattern: /\/Fornecedores\/[^/]+\/Notas Fiscais Reembolso\//,
    context: 'orderNfeReimbursements',
  },
  { pattern: /\/Fornecedores\/[^/]+\/Notas Fiscais\//, context: 'orderInvoices' },
  { pattern: /\/Fornecedores\/[^/]+\/Orcamentos\//, context: 'orderBudgets' },
  { pattern: /\/Fornecedores\/[^/]+\/Comprovantes\//, context: 'orderReceipts' },
  { pattern: /\/Fornecedores\/[^/]+\/Reembolsos\//, context: 'orderReimbursements' },
  { pattern: /\/Fornecedores\/[^/]+\/Logo\//, context: 'supplierLogo' },

  // External withdrawal (root-level, not entity-based)
  {
    pattern: /\/Notas Fiscais Reembolso\/RetiradasExternas\//,
    context: 'externalWithdrawalNfeReimbursements',
  },
  { pattern: /\/Notas Fiscais\/RetiradasExternas\//, context: 'externalWithdrawalInvoices' },
  { pattern: /\/Comprovantes\/RetiradasExternas\//, context: 'externalWithdrawalReceipts' },
  { pattern: /\/Reembolsos\/RetiradasExternas\//, context: 'externalWithdrawalReimbursements' },

  // User contexts (entity-first: Colaboradores/{userName}/{subfolder}/)
  { pattern: /\/Colaboradores\/[^/]+\/EPIs\//, context: 'signedPpeDocuments' },
  { pattern: /\/Colaboradores\/[^/]+\/Advertencias\//, context: 'warning' },
  { pattern: /\/Colaboradores\/[^/]+\/Fotos\//, context: 'userAvatar' },
];

@Injectable()
export class FileOrganizationSchedulerService {
  private readonly logger = new Logger(FileOrganizationSchedulerService.name);
  private readonly filesRoot: string;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly filesStorageService: FilesStorageService,
  ) {
    this.filesRoot = process.env.FILES_ROOT || './files';
  }

  /**
   * Initialize scheduled file organization tasks
   */
  onModuleInit() {
    this.scheduleFileOrganization();
    this.logger.log('File organization scheduler initialized');
  }

  /**
   * Schedule file organization job
   * Runs daily at 4 AM (after temp and orphaned cleanup)
   */
  private scheduleFileOrganization(): void {
    try {
      const organizationJob = new CronJob(
        '0 4 * * *', // Run at 4:00 AM every day
        async () => {
          await this.performFileOrganization();
        },
        null,
        true,
        'America/Sao_Paulo',
      );

      this.schedulerRegistry.addCronJob('file-organization', organizationJob);
      this.logger.log('Scheduled file organization at 4:00 AM daily');
    } catch (error: any) {
      this.logger.error(`Failed to schedule file organization: ${error.message}`);
    }
  }

  /**
   * Sanitize folder name for safe filesystem usage
   */
  private sanitizeFolderName(name: string): string {
    return name
      .replace(/[<>:"|?*\x00-\x1f]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  /**
   * Detect file context from path
   */
  private detectContextFromPath(path: string): keyof FilesFolderMapping | null {
    for (const { pattern, context } of FOLDER_TO_CONTEXT_MAP) {
      if (pattern.test(path)) {
        return context;
      }
    }
    return null;
  }

  /**
   * Check if a file path contains the expected entity name in the entity-first structure.
   * Entity-first paths: /Clientes/{name}/... or /Fornecedores/{name}/...
   */
  private pathContainsEntityName(
    path: string,
    entityName: string,
    _context: keyof FilesFolderMapping,
  ): boolean {
    const sanitizedName = this.sanitizeFolderName(entityName);
    const pathAfterRoot = path.replace(this.filesRoot, '');

    // Check for Clientes/{entityName}/, Fornecedores/{entityName}/, or Colaboradores/{entityName}/
    return (
      pathAfterRoot.includes(`/Clientes/${sanitizedName}/`) ||
      pathAfterRoot.includes(`/Fornecedores/${sanitizedName}/`) ||
      pathAfterRoot.includes(`/Colaboradores/${sanitizedName}/`)
    );
  }

  /**
   * Get customer name for a file by checking various relationships
   */
  private async getCustomerNameForFile(fileId: string): Promise<string | null> {
    try {
      // Check artwork relationship (file -> artwork -> tasks -> customer)
      const artwork = await this.prisma.artwork.findFirst({
        where: { fileId },
        include: {
          tasks: {
            include: {
              customer: { select: { fantasyName: true } },
            },
            take: 1,
          },
        },
      });
      if (artwork?.tasks?.[0]?.customer?.fantasyName) {
        return artwork.tasks[0].customer.fantasyName;
      }

      // Check customer logo (Customer.logoId = fileId)
      const customerWithLogo = await this.prisma.customer.findFirst({
        where: { logoId: fileId },
        select: { fantasyName: true },
      });
      if (customerWithLogo?.fantasyName) {
        return customerWithLogo.fantasyName;
      }

      // Check task budgets (File in Task.budgets)
      const taskWithBudget = await this.prisma.task.findFirst({
        where: {
          budgets: { some: { id: fileId } },
        },
        include: { customer: { select: { fantasyName: true } } },
      });
      if (taskWithBudget?.customer?.fantasyName) {
        return taskWithBudget.customer.fantasyName;
      }

      // Check task invoices
      const taskWithInvoice = await this.prisma.task.findFirst({
        where: {
          invoices: { some: { id: fileId } },
        },
        include: { customer: { select: { fantasyName: true } } },
      });
      if (taskWithInvoice?.customer?.fantasyName) {
        return taskWithInvoice.customer.fantasyName;
      }

      // Check task receipts
      const taskWithReceipt = await this.prisma.task.findFirst({
        where: {
          receipts: { some: { id: fileId } },
        },
        include: { customer: { select: { fantasyName: true } } },
      });
      if (taskWithReceipt?.customer?.fantasyName) {
        return taskWithReceipt.customer.fantasyName;
      }

      // Check task base files
      const taskWithBaseFile = await this.prisma.task.findFirst({
        where: {
          baseFiles: { some: { id: fileId } },
        },
        include: { customer: { select: { fantasyName: true } } },
      });
      if (taskWithBaseFile?.customer?.fantasyName) {
        return taskWithBaseFile.customer.fantasyName;
      }

      // Check observations (observation -> task -> customer)
      const observation = await this.prisma.observation.findFirst({
        where: {
          files: { some: { id: fileId } },
        },
        include: {
          task: {
            include: {
              customer: { select: { fantasyName: true } },
            },
          },
        },
      });
      if (observation?.task?.customer?.fantasyName) {
        return observation.task.customer.fantasyName;
      }

      // Check airbrushing (airbrushing -> task -> customer)
      const airbrushing = await this.prisma.airbrushing.findFirst({
        where: {
          OR: [
            { receipts: { some: { id: fileId } } },
            { invoices: { some: { id: fileId } } },
            { budgets: { some: { id: fileId } } },
          ],
        },
        include: {
          task: {
            include: {
              customer: { select: { fantasyName: true } },
            },
          },
        },
      });
      if (airbrushing?.task?.customer?.fantasyName) {
        return airbrushing.task.customer.fantasyName;
      }

      return null;
    } catch (error: any) {
      this.logger.error(`Error getting customer name for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get supplier name for a file by checking various relationships
   */
  private async getSupplierNameForFile(fileId: string): Promise<string | null> {
    try {
      // Check supplier logo (Supplier.logoId = fileId)
      const supplierWithLogo = await this.prisma.supplier.findFirst({
        where: { logoId: fileId },
        select: { fantasyName: true },
      });
      if (supplierWithLogo?.fantasyName) {
        return supplierWithLogo.fantasyName;
      }

      // Check order relationships
      const order = await this.prisma.order.findFirst({
        where: {
          OR: [
            { budgets: { some: { id: fileId } } },
            { invoices: { some: { id: fileId } } },
            { receipts: { some: { id: fileId } } },
          ],
        },
        include: { supplier: { select: { fantasyName: true } } },
      });
      if (order?.supplier?.fantasyName) {
        return order.supplier.fantasyName;
      }

      return null;
    } catch (error: any) {
      this.logger.error(`Error getting supplier name for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get user name for a file by checking various relationships
   */
  private async getUserNameForFile(fileId: string): Promise<string | null> {
    try {
      // Check user avatar (User.avatarId = fileId)
      const userWithAvatar = await this.prisma.user.findFirst({
        where: { avatarId: fileId },
        select: { name: true },
      });
      if (userWithAvatar?.name) {
        return userWithAvatar.name;
      }

      // Check warning attachments (warning -> collaborator)
      const warning = await this.prisma.warning.findFirst({
        where: {
          attachments: { some: { id: fileId } },
        },
        include: { collaborator: { select: { name: true } } },
      });
      if (warning?.collaborator?.name) {
        return warning.collaborator.name;
      }

      return null;
    } catch (error: any) {
      this.logger.error(`Error getting user name for file ${fileId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get entity name for a file based on its relationships
   */
  private async getEntityNameForFile(
    fileId: string,
    entityType: 'customer' | 'supplier' | 'user',
  ): Promise<string | null> {
    switch (entityType) {
      case 'customer':
        return this.getCustomerNameForFile(fileId);
      case 'supplier':
        return this.getSupplierNameForFile(fileId);
      case 'user':
        return this.getUserNameForFile(fileId);
      default:
        return null;
    }
  }

  /**
   * Scan for misplaced files
   */
  async scanForMisplacedFiles(): Promise<MisplacedFile[]> {
    const misplacedFiles: MisplacedFile[] = [];

    try {
      // Get all files that are in the files storage
      const files = await this.prisma.file.findMany({
        where: {
          path: {
            startsWith: this.filesRoot,
          },
        },
        select: {
          id: true,
          filename: true,
          path: true,
          mimetype: true,
        },
      });

      this.logger.log(`Scanning ${files.length} files for misplacement...`);

      for (const file of files) {
        // Detect context from path
        const context = this.detectContextFromPath(file.path);
        if (!context) continue;

        // Get expected entity type for this context
        const entityType = CONTEXT_ENTITY_MAP[context];
        if (!entityType) continue; // No entity required for this context

        // Get actual entity name from relationships
        const entityName = await this.getEntityNameForFile(file.id, entityType);
        if (!entityName) continue; // No relationship found, can't determine correct location

        // Check if file is in correct location
        if (!this.pathContainsEntityName(file.path, entityName, context)) {
          // Calculate expected path
          const expectedPath = this.filesStorageService.generateFilePath(
            file.filename,
            context,
            file.mimetype,
            undefined,
            undefined,
            undefined,
            undefined,
            entityType === 'customer' ? entityName : undefined,
            entityType === 'supplier' ? entityName : undefined,
            entityType === 'user' ? entityName : undefined,
          );

          misplacedFiles.push({
            id: file.id,
            filename: file.filename,
            currentPath: file.path,
            expectedPath,
            entityType,
            entityName,
            fileContext: context,
          });
        }
      }

      this.logger.log(`Found ${misplacedFiles.length} misplaced files`);
      return misplacedFiles;
    } catch (error: any) {
      this.logger.error(`Error scanning for misplaced files: ${error.message}`);
      return misplacedFiles;
    }
  }

  /**
   * Perform file organization - detect and fix misplaced files
   */
  async performFileOrganization(): Promise<OrganizationStats> {
    const stats: OrganizationStats = {
      filesScanned: 0,
      misplacedFilesFound: 0,
      filesMoved: 0,
      filesSkipped: 0,
      errors: [],
    };

    this.logger.log('Starting file organization...');

    try {
      // Scan for misplaced files
      const misplacedFiles = await this.scanForMisplacedFiles();
      stats.misplacedFilesFound = misplacedFiles.length;

      // Process each misplaced file
      for (const file of misplacedFiles) {
        try {
          await this.moveFileToCorrectLocation(file);
          stats.filesMoved++;
        } catch (error: any) {
          stats.filesSkipped++;
          stats.errors.push(`Failed to move ${file.filename}: ${error.message}`);
          this.logger.error(`Failed to move file ${file.id}: ${error.message}`);
        }
      }

      this.logger.log(
        `File organization completed: ${stats.filesMoved}/${stats.misplacedFilesFound} files moved`,
      );

      return stats;
    } catch (error: any) {
      this.logger.error(`File organization failed: ${error.message}`, error.stack);
      stats.errors.push(error.message);
      return stats;
    }
  }

  /**
   * Move a single file to its correct location
   */
  private async moveFileToCorrectLocation(file: MisplacedFile): Promise<void> {
    const { id, currentPath, expectedPath, filename } = file;

    // Check if source file exists
    if (!existsSync(currentPath)) {
      this.logger.warn(`Source file not found, skipping: ${currentPath}`);
      throw new Error('Source file not found');
    }

    // Check if target path already exists (avoid overwrite)
    if (existsSync(expectedPath)) {
      this.logger.warn(`Target path already exists, skipping: ${expectedPath}`);
      throw new Error('Target path already exists');
    }

    // Use transaction to ensure atomicity
    await this.prisma.$transaction(async tx => {
      // Move physical file
      await this.filesStorageService.moveWithinStorage(currentPath, expectedPath);

      // Update database
      await tx.file.update({
        where: { id },
        data: { path: expectedPath },
      });

      // Log to ChangeLog
      await this.changeLogService.logChange({
        entityType: ENTITY_TYPE.FILE,
        entityId: id,
        action: CHANGE_ACTION.UPDATE,
        field: 'path',
        oldValue: currentPath,
        newValue: expectedPath,
        reason: `File reorganized: moved from root folder to ${file.entityType} subfolder (${file.entityName})`,
        triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
        triggeredById: id,
        userId: null,
        transaction: tx,
      });
    });

    this.logger.log(`Moved file "${filename}" to ${dirname(expectedPath)}`);
  }

  /**
   * Manual trigger for file organization
   */
  async triggerManualOrganization(): Promise<{
    success: boolean;
    message: string;
    stats: OrganizationStats;
  }> {
    try {
      this.logger.log('Manual file organization triggered');
      const stats = await this.performFileOrganization();

      return {
        success: true,
        message: `File organization completed: ${stats.filesMoved} files moved`,
        stats,
      };
    } catch (error: any) {
      this.logger.error(`Manual organization failed: ${error.message}`);
      return {
        success: false,
        message: `Organization failed: ${error.message}`,
        stats: {
          filesScanned: 0,
          misplacedFilesFound: 0,
          filesMoved: 0,
          filesSkipped: 0,
          errors: [error.message],
        },
      };
    }
  }

  /**
   * Get organization report without making changes
   */
  async getOrganizationReport(): Promise<OrganizationReport> {
    const misplacedFiles = await this.scanForMisplacedFiles();

    // Build summary
    const byEntityType: Record<string, number> = {};
    const byContext: Record<string, number> = {};

    for (const file of misplacedFiles) {
      byEntityType[file.entityType] = (byEntityType[file.entityType] || 0) + 1;
      byContext[file.fileContext] = (byContext[file.fileContext] || 0) + 1;
    }

    return {
      misplacedFiles,
      summary: {
        totalMisplaced: misplacedFiles.length,
        byEntityType,
        byContext,
      },
    };
  }

  /**
   * Detect and fix missed entity name changes by checking ChangeLog
   */
  async detectAndFixMissedNameChanges(): Promise<{
    detected: number;
    fixed: number;
    errors: string[];
  }> {
    const result = {
      detected: 0,
      fixed: 0,
      errors: [] as string[],
    };

    try {
      // Query recent fantasyName/name changes from ChangeLog (last 7 days)
      const recentChanges = await this.prisma.changeLog.findMany({
        where: {
          field: {
            in: ['fantasyName', 'name'],
          },
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
          entityType: {
            in: ['CUSTOMER', 'SUPPLIER', 'USER'],
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      this.logger.log(`Found ${recentChanges.length} recent name changes to verify`);

      for (const change of recentChanges) {
        if (!change.oldValue || !change.newValue) continue;

        const oldName = String(change.oldValue);
        const newName = String(change.newValue);
        const oldSanitized = this.sanitizeFolderName(oldName);
        const newSanitized = this.sanitizeFolderName(newName);

        if (oldSanitized === newSanitized) continue;

        // Check if there are still files with the old folder name
        const filesWithOldPath = await this.prisma.file.findMany({
          where: {
            path: {
              contains: `/${oldSanitized}/`,
            },
          },
        });

        if (filesWithOldPath.length > 0) {
          result.detected += filesWithOldPath.length;
          this.logger.warn(
            `Found ${filesWithOldPath.length} files still referencing old name "${oldName}"`,
          );

          // The regular organization job will handle moving these files
          // Just log for now
        }
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Error detecting missed name changes: ${error.message}`);
      result.errors.push(error.message);
      return result;
    }
  }
}
