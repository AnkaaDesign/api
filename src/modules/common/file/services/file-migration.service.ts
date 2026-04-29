import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { ChangeLogService } from '@modules/common/changelog/changelog.service';
import { FilesStorageService } from './files-storage.service';
import { existsSync, readdirSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { ENTITY_TYPE, CHANGE_ACTION, CHANGE_TRIGGERED_BY } from '../../../../constants/enums';

interface MigrationResult {
  scanned: number;
  matched: number;
  moved: number;
  skipped: number;
  errors: string[];
  details: MigrationDetail[];
}

interface MigrationDetail {
  fileId?: string;
  filename: string;
  currentPath: string;
  newPath?: string;
  matchedCustomer?: string;
  matchSource?: string; // How the customer was determined (e.g., "artwork.task.customer")
  status: 'moved' | 'skipped' | 'error';
  reason?: string;
}

interface DuplicateCustomerReport {
  groups: Array<{
    customers: Array<{
      id: string;
      fantasyName: string;
      createdAt: Date;
      taskCount: number;
      fileCount: number;
    }>;
    suggestedPrimary: string;
  }>;
}

interface RootFileInfo {
  fileId: string;
  path: string;
  filename: string;
  size: number;
  matchedCustomer?: string;
  matchSource?: string;
}

interface RootFilesReport {
  projetos: RootFileInfo[];
  arquivosClientes: RootFileInfo[];
  totals: {
    projetos: number;
    arquivosClientes: number;
    matched: number;
    unmatched: number;
  };
}

@Injectable()
export class FileMigrationService {
  private readonly logger = new Logger(FileMigrationService.name);
  private readonly filesRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly changeLogService: ChangeLogService,
    private readonly filesStorageService: FilesStorageService,
  ) {
    this.filesRoot = process.env.FILES_ROOT || './files';
  }

  /**
   * Sanitize folder name for filesystem
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
   * Find the customer for a file by tracing database relationships.
   *
   * The relationship chain depends on the file context:
   * - Artwork files (Layouts): File → Artwork → Task[] → Customer
   * - Observation files: File → Observation → Task → Customer
   * - Task files (budgets, invoices, etc.): File → Task → Customer
   * - Cut files: File → Cut → Task → Customer
   */
  async findCustomerForFile(
    fileId: string,
  ): Promise<{ id: string; fantasyName: string; source: string } | null> {
    // 1. Check if file is an artwork (Layouts folder)
    const artwork = await this.prisma.artwork.findFirst({
      where: { fileId },
      include: {
        tasks: {
          include: {
            customer: {
              select: { id: true, fantasyName: true },
            },
          },
          take: 1,
        },
      },
    });

    if (artwork?.tasks?.[0]?.customer) {
      return {
        id: artwork.tasks[0].customer.id,
        fantasyName: artwork.tasks[0].customer.fantasyName,
        source: 'artwork.task.customer',
      };
    }

    // 2. Check if file is linked to a task directly (budgets, invoices, etc.)
    const taskWithFile = await this.prisma.task.findFirst({
      where: {
        OR: [
          { baseFiles: { some: { id: fileId } } },
          { projectFiles: { some: { id: fileId } } },
          { checkinFiles: { some: { id: fileId } } },
          { checkoutFiles: { some: { id: fileId } } },
          { budgets: { some: { id: fileId } } },
          { invoices: { some: { id: fileId } } },
          { invoiceReimbursements: { some: { id: fileId } } },
          { receipts: { some: { id: fileId } } },
          { reimbursements: { some: { id: fileId } } },
          { bankSlips: { some: { id: fileId } } },
        ],
      },
      include: {
        customer: {
          select: { id: true, fantasyName: true },
        },
      },
    });

    if (taskWithFile?.customer) {
      return {
        id: taskWithFile.customer.id,
        fantasyName: taskWithFile.customer.fantasyName,
        source: 'task.customer',
      };
    }

    // 3. Check if file is an observation attachment
    const observation = await this.prisma.observation.findFirst({
      where: {
        files: { some: { id: fileId } },
      },
      include: {
        task: {
          include: {
            customer: {
              select: { id: true, fantasyName: true },
            },
          },
        },
      },
    });

    if (observation?.task?.customer) {
      return {
        id: observation.task.customer.id,
        fantasyName: observation.task.customer.fantasyName,
        source: 'observation.task.customer',
      };
    }

    // 4. Check if file is a cut file (Cut has single fileId, not array)
    const cut = await this.prisma.cut.findFirst({
      where: { fileId },
      include: {
        task: {
          include: {
            customer: {
              select: { id: true, fantasyName: true },
            },
          },
        },
      },
    });

    if (cut?.task?.customer) {
      return {
        id: cut.task.customer.id,
        fantasyName: cut.task.customer.fantasyName,
        source: 'cut.task.customer',
      };
    }

    // 5. Check if file is a customer logo
    const customerLogo = await this.prisma.customer.findFirst({
      where: { logoId: fileId },
      select: { id: true, fantasyName: true },
    });

    if (customerLogo) {
      return {
        id: customerLogo.id,
        fantasyName: customerLogo.fantasyName,
        source: 'customer.logo',
      };
    }

    return null;
  }

  /**
   * Scan files in Clientes/ subfolders that are missing proper customer subfolder structure.
   * Entity-first layout: Clientes/{customerName}/Layouts/, Clientes/{customerName}/Outros/, etc.
   */
  async scanRootFiles(): Promise<RootFilesReport> {
    const report: RootFilesReport = {
      projetos: [],
      arquivosClientes: [],
      totals: {
        projetos: 0,
        arquivosClientes: 0,
        matched: 0,
        unmatched: 0,
      },
    };

    // Find files under Clientes/*/Layouts/ that are misplaced (missing Imagens/PDFs subfolder)
    const layoutFiles = await this.prisma.file.findMany({
      where: {
        path: { contains: '/Clientes/' },
        AND: { path: { contains: '/Layouts/' } },
      },
      select: { id: true, path: true, filename: true, size: true },
    });

    for (const file of layoutFiles) {
      // Expected: Clientes/{Customer}/Layouts/Imagens|PDFs/filename
      const layoutMatch = file.path.match(/\/Clientes\/[^/]+\/Layouts\/(.+)$/);
      if (!layoutMatch) continue;

      const pathAfterLayouts = layoutMatch[1];
      const pathParts = pathAfterLayouts.split('/');

      // Should have at least 2 parts: [Imagens|PDFs, filename]
      if (pathParts.length < 2) {
        const customerMatch = await this.findCustomerForFile(file.id);
        report.projetos.push({
          fileId: file.id,
          path: file.path,
          filename: file.filename,
          size: file.size,
          matchedCustomer: customerMatch?.fantasyName,
          matchSource: customerMatch?.source,
        });
        if (customerMatch) report.totals.matched++;
        else report.totals.unmatched++;
      }
    }
    report.totals.projetos = report.projetos.length;

    // Find files under Clientes/*/Outros/ that are misplaced (missing Imagens/Documentos subfolder)
    const outrosFiles = await this.prisma.file.findMany({
      where: {
        path: { contains: '/Clientes/' },
        AND: { path: { contains: '/Outros/' } },
      },
      select: { id: true, path: true, filename: true, size: true },
    });

    for (const file of outrosFiles) {
      const outrosMatch = file.path.match(/\/Clientes\/[^/]+\/Outros\/(.+)$/);
      if (!outrosMatch) continue;

      const pathAfterOutros = outrosMatch[1];
      const pathParts = pathAfterOutros.split('/');

      // Should have at least 2 parts: [Imagens|Documentos, filename]
      if (pathParts.length < 2) {
        const customerMatch = await this.findCustomerForFile(file.id);
        report.arquivosClientes.push({
          fileId: file.id,
          path: file.path,
          filename: file.filename,
          size: file.size,
          matchedCustomer: customerMatch?.fantasyName,
          matchSource: customerMatch?.source,
        });
        if (customerMatch) report.totals.matched++;
        else report.totals.unmatched++;
      }
    }
    report.totals.arquivosClientes = report.arquivosClientes.length;

    return report;
  }

  /**
   * Find duplicate customers based on similar names
   */
  async findDuplicateCustomers(): Promise<DuplicateCustomerReport> {
    const customers = await this.prisma.customer.findMany({
      select: {
        id: true,
        fantasyName: true,
        createdAt: true,
        _count: {
          select: {
            tasks: true,
          },
        },
      },
      orderBy: { fantasyName: 'asc' },
    });

    // Group customers by normalized name prefix (first word or first N chars)
    const groups: Map<
      string,
      Array<{
        id: string;
        fantasyName: string;
        createdAt: Date;
        taskCount: number;
        fileCount: number;
      }>
    > = new Map();

    for (const customer of customers) {
      // Normalize: uppercase, remove LTDA/ME/EIRELI/SA suffixes, remove special chars
      let normalized = customer.fantasyName
        .toUpperCase()
        .replace(/\s+(LTDA|ME|EIRELI|SA|S\.A\.|EPP|LTDA\.)\.?$/i, '')
        .replace(/[^A-Z0-9\s]/g, '')
        .trim();

      // Take first two words for grouping
      const words = normalized.split(/\s+/);
      normalized = words.slice(0, 2).join(' ');

      if (normalized.length < 3) continue;

      // Count files for this customer by checking paths
      const fileCount = await this.prisma.file.count({
        where: {
          path: {
            contains: `/${this.sanitizeFolderName(customer.fantasyName)}/`,
          },
        },
      });

      const entry = {
        id: customer.id,
        fantasyName: customer.fantasyName,
        createdAt: customer.createdAt,
        taskCount: customer._count.tasks,
        fileCount,
      };

      if (groups.has(normalized)) {
        groups.get(normalized)!.push(entry);
      } else {
        groups.set(normalized, [entry]);
      }
    }

    // Filter to only groups with more than one customer
    const duplicateGroups = Array.from(groups.values())
      .filter(group => group.length > 1)
      .map(group => ({
        customers: group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        // Suggest the one with most tasks as primary
        suggestedPrimary: group.reduce((prev, curr) =>
          curr.taskCount > prev.taskCount ? curr : prev,
        ).id,
      }));

    return { groups: duplicateGroups };
  }

  /**
   * Migrate files from root to customer subfolders using database relationships
   */
  async migrateRootFiles(dryRun = true): Promise<MigrationResult> {
    const result: MigrationResult = {
      scanned: 0,
      matched: 0,
      moved: 0,
      skipped: 0,
      errors: [],
      details: [],
    };

    // Get root files report (uses database relationships)
    const rootFiles = await this.scanRootFiles();
    result.scanned = rootFiles.totals.projetos + rootFiles.totals.arquivosClientes;
    result.matched = rootFiles.totals.matched;

    // Process Layouts files
    for (const file of rootFiles.projetos) {
      const detail: MigrationDetail = {
        fileId: file.fileId,
        filename: file.filename,
        currentPath: file.path,
        status: 'skipped',
      };

      if (!file.matchedCustomer) {
        detail.reason = 'No customer found in database relationships';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      detail.matchedCustomer = file.matchedCustomer;
      detail.matchSource = file.matchSource;

      // Determine target path based on file type (entity-first layout)
      const ext = file.filename.split('.').pop()?.toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'eps', 'ai', 'svg'].includes(
        ext || '',
      );
      const subfolder = isImage ? 'Imagens' : 'PDFs';

      const customerFolder = this.sanitizeFolderName(file.matchedCustomer);
      const targetPath = join(
        this.filesRoot,
        'Clientes',
        customerFolder,
        'Layouts',
        subfolder,
        file.filename,
      );
      detail.newPath = targetPath;

      // Check if source file exists
      if (!existsSync(file.path)) {
        detail.status = 'skipped';
        detail.reason = 'Source file not found on disk';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      // Check if target exists
      if (existsSync(targetPath)) {
        detail.status = 'skipped';
        detail.reason = 'Target file already exists';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      if (!dryRun) {
        try {
          // Ensure directory exists
          const targetDir = dirname(targetPath);
          await fs.mkdir(targetDir, { recursive: true });
          await fs.chmod(targetDir, 0o2775).catch(() => {});

          // Move file
          await fs.rename(file.path, targetPath);
          await fs.chmod(targetPath, 0o664).catch(() => {});

          // Update database
          await this.prisma.file.update({
            where: { id: file.fileId },
            data: { path: targetPath },
          });

          // Log change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.FILE,
            entityId: file.fileId,
            action: CHANGE_ACTION.UPDATE,
            field: 'path',
            oldValue: file.path,
            newValue: targetPath,
            reason: `File migrated from root to customer folder (${file.matchedCustomer}) via ${file.matchSource}`,
            triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
            triggeredById: file.fileId,
            userId: null,
          });

          detail.status = 'moved';
          result.moved++;
        } catch (error: any) {
          detail.status = 'error';
          detail.reason = error.message;
          result.errors.push(`Failed to move ${file.filename}: ${error.message}`);
        }
      } else {
        detail.status = 'skipped';
        detail.reason = 'Dry run - would move';
      }

      result.details.push(detail);
    }

    // Process Arquivos Clientes files
    for (const file of rootFiles.arquivosClientes) {
      const detail: MigrationDetail = {
        fileId: file.fileId,
        filename: file.filename,
        currentPath: file.path,
        status: 'skipped',
      };

      if (!file.matchedCustomer) {
        detail.reason = 'No customer found in database relationships';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      detail.matchedCustomer = file.matchedCustomer;
      detail.matchSource = file.matchSource;

      const customerFolder = this.sanitizeFolderName(file.matchedCustomer);
      const targetPath = join(this.filesRoot, 'Clientes', customerFolder, 'Outros', file.filename);
      detail.newPath = targetPath;

      // Check if source file exists
      if (!existsSync(file.path)) {
        detail.status = 'skipped';
        detail.reason = 'Source file not found on disk';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      // Check if target exists
      if (existsSync(targetPath)) {
        detail.status = 'skipped';
        detail.reason = 'Target file already exists';
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      if (!dryRun) {
        try {
          // Ensure directory exists
          const targetDir = dirname(targetPath);
          await fs.mkdir(targetDir, { recursive: true });
          await fs.chmod(targetDir, 0o2775).catch(() => {});

          // Move file
          await fs.rename(file.path, targetPath);
          await fs.chmod(targetPath, 0o664).catch(() => {});

          // Update database
          await this.prisma.file.update({
            where: { id: file.fileId },
            data: { path: targetPath },
          });

          // Log change
          await this.changeLogService.logChange({
            entityType: ENTITY_TYPE.FILE,
            entityId: file.fileId,
            action: CHANGE_ACTION.UPDATE,
            field: 'path',
            oldValue: file.path,
            newValue: targetPath,
            reason: `File migrated from root to customer folder (${file.matchedCustomer}) via ${file.matchSource}`,
            triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
            triggeredById: file.fileId,
            userId: null,
          });

          detail.status = 'moved';
          result.moved++;
        } catch (error: any) {
          detail.status = 'error';
          detail.reason = error.message;
          result.errors.push(`Failed to move ${file.filename}: ${error.message}`);
        }
      } else {
        detail.status = 'skipped';
        detail.reason = 'Dry run - would move';
      }

      result.details.push(detail);
    }

    this.logger.log(
      `Migration ${dryRun ? '(dry run)' : ''} complete: ` +
        `${result.scanned} scanned, ${result.matched} matched, ` +
        `${result.moved} moved, ${result.skipped} skipped, ${result.errors.length} errors`,
    );

    return result;
  }

  /**
   * Get comprehensive storage analysis report
   */
  async getStorageAnalysisReport(): Promise<{
    rootFiles: RootFilesReport;
    duplicateCustomers: DuplicateCustomerReport;
    databaseStats: {
      totalFiles: number;
      filesInRootFolders: number;
      filesInCustomerFolders: number;
      orphanedFiles: number;
    };
  }> {
    const rootFiles = await this.scanRootFiles();
    const duplicateCustomers = await this.findDuplicateCustomers();

    // Database stats
    const totalFiles = await this.prisma.file.count();

    // Calculate files in proper customer folders by examining entity-first path structure
    const allFilesWithPath = await this.prisma.file.findMany({
      where: {
        OR: [{ path: { contains: '/Clientes/' } }, { path: { contains: '/Fornecedores/' } }],
      },
      select: { path: true },
    });

    let filesInCustomerFolders = 0;
    let filesInRootFolders = 0;

    for (const file of allFilesWithPath) {
      // Entity-first: Clientes/{name}/{context}/... or Fornecedores/{name}/{context}/...
      const entityMatch = file.path.match(/\/(Clientes|Fornecedores)\/[^/]+\/[^/]+\//);

      if (entityMatch) {
        filesInCustomerFolders++;
      } else {
        filesInRootFolders++;
      }
    }

    // Check for orphaned files (files in DB but not on disk)
    const allFiles = await this.prisma.file.findMany({
      select: { id: true, path: true },
    });

    let orphanedFiles = 0;
    for (const file of allFiles) {
      if (!existsSync(file.path)) {
        orphanedFiles++;
      }
    }

    return {
      rootFiles,
      duplicateCustomers,
      databaseStats: {
        totalFiles,
        filesInRootFolders,
        filesInCustomerFolders,
        orphanedFiles,
      },
    };
  }

  /**
   * Consolidate duplicate customer folders
   * Moves all files from secondary customer folders to the primary customer folder
   */
  async consolidateCustomerFolders(
    primaryCustomerId: string,
    secondaryCustomerIds: string[],
    dryRun = true,
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      scanned: 0,
      matched: 0,
      moved: 0,
      skipped: 0,
      errors: [],
      details: [],
    };

    // Get primary customer
    const primaryCustomer = await this.prisma.customer.findUnique({
      where: { id: primaryCustomerId },
      select: { id: true, fantasyName: true },
    });

    if (!primaryCustomer) {
      result.errors.push(`Primary customer ${primaryCustomerId} not found`);
      return result;
    }

    const primaryFolder = this.sanitizeFolderName(primaryCustomer.fantasyName);

    // Process each secondary customer
    for (const secondaryId of secondaryCustomerIds) {
      const secondaryCustomer = await this.prisma.customer.findUnique({
        where: { id: secondaryId },
        select: { id: true, fantasyName: true },
      });

      if (!secondaryCustomer) {
        result.errors.push(`Secondary customer ${secondaryId} not found`);
        continue;
      }

      const secondaryFolder = this.sanitizeFolderName(secondaryCustomer.fantasyName);

      // Entity-first layout: merge entire Clientes/{secondaryName}/ into Clientes/{primaryName}/
      const folderBases = ['Clientes'];

      for (const base of folderBases) {
        const secondaryPath = join(this.filesRoot, base, secondaryFolder);
        const primaryPath = join(this.filesRoot, base, primaryFolder);

        if (!existsSync(secondaryPath)) continue;

        // Get all files in secondary folder recursively
        const files = this.getAllFilesRecursively(secondaryPath);
        result.scanned += files.length;

        for (const filePath of files) {
          const relativePath = filePath.replace(secondaryPath, '');
          const targetPath = join(primaryPath, relativePath);

          const detail: MigrationDetail = {
            filename: basename(filePath),
            currentPath: filePath,
            newPath: targetPath,
            matchedCustomer: primaryCustomer.fantasyName,
            status: 'skipped',
          };

          if (existsSync(targetPath)) {
            detail.reason = 'Target file already exists';
            result.skipped++;
            result.details.push(detail);
            continue;
          }

          if (!dryRun) {
            try {
              await fs.mkdir(dirname(targetPath), { recursive: true });
              await fs.rename(filePath, targetPath);
              await fs.chmod(targetPath, 0o664).catch(() => {});

              // Update database
              const dbFile = await this.prisma.file.findFirst({
                where: { path: filePath },
              });

              if (dbFile) {
                await this.prisma.file.update({
                  where: { id: dbFile.id },
                  data: { path: targetPath },
                });

                // Log change
                await this.changeLogService.logChange({
                  entityType: ENTITY_TYPE.FILE,
                  entityId: dbFile.id,
                  action: CHANGE_ACTION.UPDATE,
                  field: 'path',
                  oldValue: filePath,
                  newValue: targetPath,
                  reason: `File consolidated from ${secondaryCustomer.fantasyName} to ${primaryCustomer.fantasyName}`,
                  triggeredBy: CHANGE_TRIGGERED_BY.SCHEDULED_JOB,
                  triggeredById: dbFile.id,
                  userId: null,
                });
              }

              detail.status = 'moved';
              result.moved++;
            } catch (error: any) {
              detail.status = 'error';
              detail.reason = error.message;
              result.errors.push(`Failed to move ${filePath}: ${error.message}`);
            }
          } else {
            result.matched++;
            detail.reason = 'Dry run - would move';
          }

          result.details.push(detail);
        }

        // Remove empty secondary folder if not dry run
        if (!dryRun) {
          try {
            await this.removeEmptyDirectories(secondaryPath);
          } catch (error: any) {
            this.logger.warn(`Could not remove empty directory ${secondaryPath}: ${error.message}`);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all files recursively from a directory
   */
  private getAllFilesRecursively(dir: string): string[] {
    const files: string[] = [];

    if (!existsSync(dir)) return files;

    const items = readdirSync(dir);
    for (const item of items) {
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
   * Remove empty directories recursively
   */
  private async removeEmptyDirectories(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    const items = readdirSync(dir);

    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        await this.removeEmptyDirectories(fullPath);
      }
    }

    // Check again after processing subdirectories
    const remainingItems = readdirSync(dir);
    if (remainingItems.length === 0) {
      await fs.rmdir(dir);
      this.logger.log(`Removed empty directory: ${dir}`);
    }
  }
}
