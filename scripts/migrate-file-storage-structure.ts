/**
 * Physical file migration script: Type-First → Entity-First layout
 *
 * Moves files on disk to match the new entity-first folder structure.
 * Run AFTER the Prisma migration (which updates DB paths).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-file-storage-structure.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-file-storage-structure.ts --execute
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { join, relative } from 'path';

const filesRoot = process.env.FILES_ROOT || '/srv/files';
const isDryRun = !process.argv.includes('--execute');

interface MoveOperation {
  oldPath: string;
  newPath: string;
  status: 'pending' | 'moved' | 'skipped' | 'error';
  reason?: string;
}

/**
 * Mapping of old root-level type directories to entity-first structure.
 * Each entry: { oldBase, entityRoot, newSuffix }
 *
 * Example: { oldBase: 'Orcamentos/Tarefas', entityRoot: 'Clientes', newSuffix: 'Orcamentos' }
 * Transforms: Orcamentos/Tarefas/{customer}/file → Clientes/{customer}/Orcamentos/file
 */
const MIGRATION_MAP = [
  // Airbrushing financial (nested under Clientes/{customer}/Aerografias/)
  { oldBase: 'Notas Fiscais Reembolso/Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias/Notas Fiscais Reembolso' },
  { oldBase: 'Notas Fiscais/Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias/Notas Fiscais' },
  { oldBase: 'Orcamentos/Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias/Orcamentos' },
  { oldBase: 'Comprovantes/Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias/Comprovantes' },
  { oldBase: 'Reembolsos/Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias/Reembolsos' },

  // Task financial
  { oldBase: 'Notas Fiscais Reembolso/Tarefas', entityRoot: 'Clientes', newSuffix: 'Notas Fiscais Reembolso' },
  { oldBase: 'Notas Fiscais/Tarefas', entityRoot: 'Clientes', newSuffix: 'Notas Fiscais' },
  { oldBase: 'Orcamentos/Tarefas', entityRoot: 'Clientes', newSuffix: 'Orcamentos' },
  { oldBase: 'Comprovantes/Tarefas', entityRoot: 'Clientes', newSuffix: 'Comprovantes' },
  { oldBase: 'Reembolsos/Tarefas', entityRoot: 'Clientes', newSuffix: 'Reembolsos' },
  { oldBase: 'Boletos/Tarefas', entityRoot: 'Clientes', newSuffix: 'Boletos' },

  // Order financial
  { oldBase: 'Notas Fiscais Reembolso/Pedidos', entityRoot: 'Fornecedores', newSuffix: 'Notas Fiscais Reembolso' },
  { oldBase: 'Notas Fiscais/Pedidos', entityRoot: 'Fornecedores', newSuffix: 'Notas Fiscais' },
  { oldBase: 'Orcamentos/Pedidos', entityRoot: 'Fornecedores', newSuffix: 'Orcamentos' },
  { oldBase: 'Comprovantes/Pedidos', entityRoot: 'Fornecedores', newSuffix: 'Comprovantes' },
  { oldBase: 'Reembolsos/Pedidos', entityRoot: 'Fornecedores', newSuffix: 'Reembolsos' },

  // Simple customer paths (folder/{customer}/ → Clientes/{customer}/{folder}/)
  // NOTE: Projetos on disk → Clientes/{customer}/Layouts/ in DB (migration 1 renames Projetos→Layouts)
  { oldBase: 'Projetos', entityRoot: 'Clientes', newSuffix: 'Layouts' },
  { oldBase: 'Checkin', entityRoot: 'Clientes', newSuffix: 'Checkin' },
  { oldBase: 'Checkout', entityRoot: 'Clientes', newSuffix: 'Checkout' },
  { oldBase: 'Aerografias', entityRoot: 'Clientes', newSuffix: 'Aerografias' },
  { oldBase: 'Traseiras', entityRoot: 'Clientes', newSuffix: 'Traseiras' },
  { oldBase: 'Plotter', entityRoot: 'Clientes', newSuffix: 'Plotter' },
  { oldBase: 'Observacoes', entityRoot: 'Clientes', newSuffix: 'Observacoes' },

  // Logos
  { oldBase: 'Logos/Clientes', entityRoot: 'Clientes', newSuffix: 'Logo' },
  { oldBase: 'Logos/Fornecedores', entityRoot: 'Fornecedores', newSuffix: 'Logo' },

  // Base files rename
  { oldBase: 'Arquivos Clientes', entityRoot: 'Clientes', newSuffix: 'Outros' },

  // User folders
  { oldBase: 'Colaboradores/Documentos', entityRoot: 'Colaboradores', newSuffix: 'EPIs' },
  { oldBase: 'Advertencias', entityRoot: 'Colaboradores', newSuffix: 'Advertencias' },
];

/**
 * Flat file mappings for directories that DON'T have entity subdirectories.
 * These move files directly from oldDir to newDir (no entity name extraction).
 *
 * DB migration 1 renames:
 *   /Layouts/Orcamentos/file → /Layouts/file (removes Orcamentos segment)
 *   /Auxiliares/Traseiras/Fotos/file → /Traseiras/file
 *
 * DB migration 2 won't touch these (no entity/{name}/ pattern), so final DB path is the same.
 * Physical script must move disk files to match.
 */
const FLAT_MIGRATIONS = [
  { oldDir: 'Layouts/Orcamentos', newDir: 'Layouts' },
  { oldDir: 'Auxiliares/Traseiras/Fotos', newDir: 'Traseiras' },
];

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const item of readdirSync(dir)) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Get immediate subdirectories (entity name folders)
 */
function getSubdirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(item => {
    const fullPath = join(dir, item);
    return statSync(fullPath).isDirectory();
  });
}

/**
 * Remove empty directories recursively (bottom-up)
 */
async function removeEmptyDirs(dir: string): Promise<void> {
  if (!existsSync(dir)) return;

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    if (statSync(fullPath).isDirectory()) {
      await removeEmptyDirs(fullPath);
    }
  }

  // Re-check after processing subdirectories
  if (readdirSync(dir).length === 0) {
    await fs.rmdir(dir);
    console.log(`  [cleanup] Removed empty dir: ${dir}`);
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log(`File Storage Restructuring: Entity-First Layout`);
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will move files!)'}`);
  console.log(`Files root: ${filesRoot}`);
  console.log('='.repeat(70));
  console.log();

  if (!existsSync(filesRoot)) {
    console.error(`ERROR: Files root does not exist: ${filesRoot}`);
    process.exit(1);
  }

  const operations: MoveOperation[] = [];
  let totalFiles = 0;
  let totalMoved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Ensure target root directories exist
  if (!isDryRun) {
    for (const dir of ['Clientes', 'Fornecedores']) {
      const targetDir = join(filesRoot, dir);
      if (!existsSync(targetDir)) {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.chmod(targetDir, 0o2775).catch(() => {});
        console.log(`Created root directory: ${targetDir}`);
      }
    }
  }

  // ---- Phase 1: Flat file migrations (no entity subdirs) ----
  for (const flat of FLAT_MIGRATIONS) {
    const oldDir = join(filesRoot, flat.oldDir);
    const newDir = join(filesRoot, flat.newDir);
    if (!existsSync(oldDir)) {
      continue;
    }

    console.log(`\n[FLAT] Processing: ${flat.oldDir} → ${flat.newDir}`);

    const files = getAllFiles(oldDir);
    totalFiles += files.length;
    console.log(`  Found ${files.length} files`);

    for (const oldFilePath of files) {
      const relativePath = relative(oldDir, oldFilePath);
      const newFilePath = join(newDir, relativePath);

      const op: MoveOperation = {
        oldPath: oldFilePath,
        newPath: newFilePath,
        status: 'pending',
      };

      if (existsSync(newFilePath)) {
        op.status = 'skipped';
        op.reason = 'Target already exists';
        totalSkipped++;
      } else if (!isDryRun) {
        try {
          const targetDir = join(newFilePath, '..');
          await fs.mkdir(targetDir, { recursive: true });
          await fs.chmod(targetDir, 0o2775).catch(() => {});

          try {
            await fs.rename(oldFilePath, newFilePath);
          } catch (err: any) {
            if (err.code === 'EXDEV') {
              await fs.copyFile(oldFilePath, newFilePath);
              await fs.unlink(oldFilePath);
            } else {
              throw err;
            }
          }

          await fs.chmod(newFilePath, 0o664).catch(() => {});
          op.status = 'moved';
          totalMoved++;
        } catch (err: any) {
          op.status = 'error';
          op.reason = err.message;
          totalErrors++;
          console.error(`  ERROR moving ${oldFilePath}: ${err.message}`);
        }
      } else {
        op.status = 'moved';
        totalMoved++;
      }

      operations.push(op);
    }

    // Clean up empty old directories after moving files
    if (!isDryRun && existsSync(oldDir)) {
      await removeEmptyDirs(oldDir);
    }
  }

  // ---- Phase 2: Entity-based migrations ----
  // Process each mapping
  for (const mapping of MIGRATION_MAP) {
    const oldBaseDir = join(filesRoot, mapping.oldBase);
    if (!existsSync(oldBaseDir)) {
      continue;
    }

    console.log(`\nProcessing: ${mapping.oldBase} → ${mapping.entityRoot}/{entity}/${mapping.newSuffix}`);

    // Get entity name folders (customer/supplier names)
    const entityFolders = getSubdirectories(oldBaseDir);
    console.log(`  Found ${entityFolders.length} entity folders`);

    for (const entityName of entityFolders) {
      const oldEntityDir = join(oldBaseDir, entityName);
      const newEntityDir = join(filesRoot, mapping.entityRoot, entityName, mapping.newSuffix);

      // Get all files recursively
      const files = getAllFiles(oldEntityDir);
      totalFiles += files.length;

      for (const oldFilePath of files) {
        const relativePath = relative(oldEntityDir, oldFilePath);
        const newFilePath = join(newEntityDir, relativePath);

        const op: MoveOperation = {
          oldPath: oldFilePath,
          newPath: newFilePath,
          status: 'pending',
        };

        if (existsSync(newFilePath)) {
          op.status = 'skipped';
          op.reason = 'Target already exists';
          totalSkipped++;
        } else if (!isDryRun) {
          try {
            // Create target directory
            const targetDir = join(newFilePath, '..');
            await fs.mkdir(targetDir, { recursive: true });
            await fs.chmod(targetDir, 0o2775).catch(() => {});

            // Move file (try rename first, fall back to copy+unlink)
            try {
              await fs.rename(oldFilePath, newFilePath);
            } catch (err: any) {
              if (err.code === 'EXDEV') {
                await fs.copyFile(oldFilePath, newFilePath);
                await fs.unlink(oldFilePath);
              } else {
                throw err;
              }
            }

            await fs.chmod(newFilePath, 0o664).catch(() => {});
            op.status = 'moved';
            totalMoved++;
          } catch (err: any) {
            op.status = 'error';
            op.reason = err.message;
            totalErrors++;
            console.error(`  ERROR moving ${oldFilePath}: ${err.message}`);
          }
        } else {
          // Dry run
          op.status = 'moved';
          totalMoved++;
        }

        operations.push(op);
      }
    }

    // Clean up empty old directories after moving files
    if (!isDryRun && existsSync(oldBaseDir)) {
      await removeEmptyDirs(oldBaseDir);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total files found:  ${totalFiles}`);
  console.log(`Files moved:        ${totalMoved}`);
  console.log(`Files skipped:      ${totalSkipped}`);
  console.log(`Errors:             ${totalErrors}`);
  console.log(`Mode:               ${isDryRun ? 'DRY RUN' : 'EXECUTED'}`);

  if (isDryRun && totalMoved > 0) {
    console.log('\nTo execute the migration, run with --execute flag:');
    console.log('  npx ts-node -r tsconfig-paths/register scripts/migrate-file-storage-structure.ts --execute');
  }

  // Write detailed log
  const logPath = join(filesRoot, `migration-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  if (!isDryRun) {
    await fs.writeFile(logPath, JSON.stringify({ operations, summary: { totalFiles, totalMoved, totalSkipped, totalErrors } }, null, 2));
    console.log(`\nDetailed log written to: ${logPath}`);
  }

  if (totalErrors > 0) {
    console.error(`\nWARNING: ${totalErrors} errors occurred during migration!`);
    process.exit(1);
  }
}

main()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
