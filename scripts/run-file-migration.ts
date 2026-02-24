/**
 * Standalone script to run file migration
 * Usage: npx ts-node -r tsconfig-paths/register scripts/run-file-migration.ts [--dry-run|--execute]
 */

import { PrismaClient } from '@prisma/client';
import { existsSync, readdirSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';

const prisma = new PrismaClient();
const filesRoot = process.env.FILES_ROOT || '/srv/files';

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
  matchSource?: string;
  status: 'moved' | 'skipped' | 'error';
  reason?: string;
}

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

async function findCustomerForFile(fileId: string): Promise<{ id: string; fantasyName: string; source: string } | null> {
  // 1. Check if file is an artwork (Projetos folder)
  const artwork = await prisma.artwork.findFirst({
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
  const taskWithFile = await prisma.task.findFirst({
    where: {
      OR: [
        { baseFiles: { some: { id: fileId } } },
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
  const observation = await prisma.observation.findFirst({
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

  // 4. Check if file is a cut file
  const cut = await prisma.cut.findFirst({
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
  const customerLogo = await prisma.customer.findFirst({
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

async function scanRootFiles() {
  console.log('\n=== Scanning for misplaced files in Projetos folder ===\n');

  const projetosRootFiles = await prisma.file.findMany({
    where: {
      path: {
        contains: '/Projetos/',
      },
    },
    select: {
      id: true,
      path: true,
      filename: true,
      size: true,
    },
  });

  const misplacedFiles: Array<{
    fileId: string;
    path: string;
    filename: string;
    size: number;
    matchedCustomer?: string;
    matchSource?: string;
  }> = [];

  let processed = 0;
  for (const file of projetosRootFiles) {
    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`\rProcessed ${processed}/${projetosRootFiles.length} files...`);
    }

    const pathAfterProjetos = file.path.split('/Projetos/')[1];
    if (!pathAfterProjetos) continue;

    const pathParts = pathAfterProjetos.split('/');

    // Files should be at: Projetos/{Customer}/{Subfolder}/filename
    // So pathParts should have at least 3 elements: [Customer, Subfolder, filename]
    if (pathParts.length < 3) {
      const customerMatch = await findCustomerForFile(file.id);

      misplacedFiles.push({
        fileId: file.id,
        path: file.path,
        filename: file.filename,
        size: file.size,
        matchedCustomer: customerMatch?.fantasyName,
        matchSource: customerMatch?.source,
      });
    }
  }

  console.log(`\n\nFound ${misplacedFiles.length} misplaced files in Projetos folder\n`);

  const matched = misplacedFiles.filter(f => f.matchedCustomer);
  const unmatched = misplacedFiles.filter(f => !f.matchedCustomer);

  console.log(`  - ${matched.length} files can be matched to a customer`);
  console.log(`  - ${unmatched.length} files have no customer relationship\n`);

  return { misplacedFiles, matched, unmatched };
}

async function migrateFiles(dryRun: boolean) {
  const { misplacedFiles } = await scanRootFiles();

  const result: MigrationResult = {
    scanned: misplacedFiles.length,
    matched: 0,
    moved: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  console.log(`\n=== ${dryRun ? 'DRY RUN - ' : ''}Migrating files ===\n`);

  for (const file of misplacedFiles) {
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

    result.matched++;
    detail.matchedCustomer = file.matchedCustomer;
    detail.matchSource = file.matchSource;

    // Determine target path based on file type
    const ext = file.filename.split('.').pop()?.toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'eps', 'ai', 'svg'].includes(ext || '');
    const subfolder = isImage ? 'Imagens' : 'PDFs';

    const customerFolder = sanitizeFolderName(file.matchedCustomer);
    const targetPath = join(filesRoot, 'Projetos', customerFolder, subfolder, file.filename);
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

    console.log(`${dryRun ? '[DRY RUN] Would move' : 'Moving'}: ${file.filename}`);
    console.log(`  From: ${file.path}`);
    console.log(`  To:   ${targetPath}`);
    console.log(`  Customer: ${file.matchedCustomer} (via ${file.matchSource})\n`);

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
        await prisma.file.update({
          where: { id: file.fileId },
          data: { path: targetPath },
        });

        detail.status = 'moved';
        result.moved++;
      } catch (error: any) {
        detail.status = 'error';
        detail.reason = error.message;
        result.errors.push(`Failed to move ${file.filename}: ${error.message}`);
        console.error(`  ERROR: ${error.message}\n`);
      }
    } else {
      detail.status = 'skipped';
      detail.reason = 'Dry run - would move';
    }

    result.details.push(detail);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  if (dryRun) {
    console.log('Running in DRY RUN mode. Use --execute to actually move files.\n');
  } else {
    console.log('Running in EXECUTE mode. Files will be moved.\n');
  }

  try {
    const result = await migrateFiles(dryRun);

    console.log('\n=== Migration Summary ===\n');
    console.log(`Scanned: ${result.scanned} files`);
    console.log(`Matched to customer: ${result.matched} files`);
    console.log(`${dryRun ? 'Would move' : 'Moved'}: ${dryRun ? result.matched - result.skipped : result.moved} files`);
    console.log(`Skipped: ${result.skipped} files`);
    console.log(`Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(err => console.log(`  - ${err}`));
    }

    // Show unmatched files
    const unmatched = result.details.filter(d => d.reason === 'No customer found in database relationships');
    if (unmatched.length > 0) {
      console.log(`\nUnmatched files (${unmatched.length}):`);
      unmatched.slice(0, 20).forEach(f => console.log(`  - ${f.filename}`));
      if (unmatched.length > 20) {
        console.log(`  ... and ${unmatched.length - 20} more`);
      }
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
