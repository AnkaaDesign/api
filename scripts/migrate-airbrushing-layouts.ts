/**
 * Airbrushing layouts → Clientes/{cliente}/Aerografias/Layouts/{PDFs|Imagens}/
 * plus draining the root-level {filesRoot}/Layouts/ stray folder.
 *
 * WHY THIS IS ONE SCRIPT (and not the usual SQL-migration + disk-mover pair):
 *
 *  1. Airbrushing layouts and task layouts are PATH-IDENTICAL today — both live in
 *     Clientes/{cliente}/Layouts/{PDFs|Imagens}/. There is no path predicate that can
 *     tell the 16 airbrushing layouts apart from the 579 task layouts, so the selector
 *     has to be relational (Layout.airbrushingId IS NOT NULL). A regex UPDATE in a
 *     .sql migration cannot express that.
 *  2. FileCleanupSchedulerService unlinks, at 03:00, any file on disk whose exact
 *     absolute path is absent from File.path (once mtime age >= 7 days — and fs.rename
 *     PRESERVES mtime, so every moved file is instantly past that threshold). Splitting
 *     the DB rewrite from the byte move opens a window in which the not-yet-moved files
 *     are already "orphaned" per the DB and eligible for deletion. Doing both per file,
 *     with a rollback of the disk move if the DB update fails, closes that window.
 *
 * Serving/download/File.url all read File.path verbatim, so the DB row and the bytes
 * must never disagree.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-airbrushing-layouts.ts            # dry-run (default)
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-airbrushing-layouts.ts --execute
 */

import { PrismaClient } from '@prisma/client';
import { existsSync, readdirSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { dirname, extname, basename, join } from 'path';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const filesRoot = process.env.FILES_ROOT || '/srv/files';
const isDryRun = !process.argv.includes('--execute');

interface Move {
  fileId: string;
  oldPath: string;
  newPath: string;
  kind: string;
  status: 'planned' | 'moved' | 'skipped' | 'error';
  reason?: string;
}

const moves: Move[] = [];

/** Mirrors FilesStorageService.sanitizeFileName — keep in sync. */
function sanitize(name: string): string {
  return name
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/** Mirrors the tasksLayouts/quote-layouts/airbrushingLayouts split in getFolderPath. */
function layoutSubfolder(mimetype: string): string {
  return mimetype === 'application/pdf' ? 'PDFs' : 'Imagens';
}

/**
 * Never overwrite an existing file: generateFilePath's uniqueness token is only a
 * second-resolution timestamp and File.path has no unique constraint, so collisions
 * are possible (the tree already contains byte-identical re-uploads).
 */
function uniqueTarget(target: string): string {
  if (!existsSync(target)) return target;
  const ext = extname(target);
  const stem = target.slice(0, target.length - ext.length);
  let candidate: string;
  do {
    candidate = `${stem}_${randomUUID().slice(0, 8)}${ext}`;
  } while (existsSync(candidate));
  return candidate;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o2775 });
}

/** rename, with EXDEV (cross-filesystem) fallback to copy+unlink. */
async function moveOnDisk(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

/**
 * Move the bytes, then point the DB row at them. If the DB write fails, put the bytes
 * back — a File row whose path does not exist on disk 404s on every download, and a
 * file on disk with no matching File row gets reaped at 03:00.
 */
async function relocate(move: Move): Promise<void> {
  if (move.oldPath === move.newPath) {
    move.status = 'skipped';
    move.reason = 'already at target';
    return;
  }
  if (!existsSync(move.oldPath)) {
    move.status = 'error';
    move.reason = 'source missing on disk';
    return;
  }
  if (isDryRun) {
    move.status = 'planned';
    return;
  }

  await ensureDir(dirname(move.newPath));
  await moveOnDisk(move.oldPath, move.newPath);
  try {
    await prisma.file.update({ where: { id: move.fileId }, data: { path: move.newPath } });
    await fs.chmod(move.newPath, 0o664).catch(() => undefined);
    move.status = 'moved';
  } catch (error: any) {
    await moveOnDisk(move.newPath, move.oldPath).catch(() => undefined);
    move.status = 'error';
    move.reason = `DB update failed, disk move rolled back: ${error.message}`;
  }
}

/**
 * PHASE A — airbrushing layouts.
 * Relation-selected: Layout.airbrushingId IS NOT NULL. Covers both the files sitting in
 * the shared Clientes/{c}/Layouts/ folder and the ones dropped flat into Aerografias/.
 */
async function phaseAirbrushingLayouts(): Promise<void> {
  const layouts = await prisma.layout.findMany({
    where: { airbrushingId: { not: null } },
    include: {
      file: true,
      airbrushing: {
        include: { task: { include: { customer: { select: { fantasyName: true } } } } },
      },
    },
  });

  console.log(`\n[A] Airbrushing layouts: ${layouts.length} Layout row(s)`);

  for (const layout of layouts) {
    if (!layout.file?.path) continue;
    // No customer → the same Clientes/Outros/ catch-all getFolderPath would have used.
    const customer = layout.airbrushing?.task?.customer?.fantasyName;
    const folder = join(
      filesRoot,
      'Clientes',
      customer ? sanitize(customer) : 'Outros',
      'Aerografias',
      'Layouts',
      layoutSubfolder(layout.file.mimetype),
    );
    const move: Move = {
      fileId: layout.file.id,
      oldPath: layout.file.path,
      newPath: join(folder, basename(layout.file.path)),
      kind: customer ? 'airbrushing-layout' : 'airbrushing-layout (no customer)',
      status: 'planned',
    };
    if (move.oldPath !== move.newPath && !isDryRun) {
      move.newPath = uniqueTarget(move.newPath);
    }
    await relocate(move);
    moves.push(move);
  }
}

/**
 * PHASE B — drain the root-level {filesRoot}/Layouts/ folder.
 *
 * This folder was fed by uploads carrying an unrecognised fileContext: getFolderPath
 * fell back to MIME routing (.eps → ARTWORK → 'Layouts') AND skipped the entity-root
 * prefix, so files landed at the root with no Clientes/{cliente}/ segment. Most are cut
 * files (fileContext 'cut', which is not a mapping key — the key is 'cutFiles').
 *
 *   cut file with a resolvable customer → Clientes/{cliente}/Plotter/   (cutFiles)
 *   anything else                       → Clientes/Outros/Layouts/{PDFs|Imagens}/
 */
async function phaseRootLayouts(): Promise<void> {
  const rootLayoutsDir = join(filesRoot, 'Layouts');
  const files = await prisma.file.findMany({
    where: { path: { startsWith: `${rootLayoutsDir}/` } },
    include: {
      taskCuts: { include: { task: { include: { customer: { select: { fantasyName: true } } } } } },
    },
  });

  console.log(`\n[B] Root ${rootLayoutsDir}/: ${files.length} File row(s)`);

  for (const file of files) {
    const cutCustomer = file.taskCuts
      ?.map(c => c.task?.customer?.fantasyName)
      .find((n): n is string => !!n);

    const folder = cutCustomer
      ? join(filesRoot, 'Clientes', sanitize(cutCustomer), 'Plotter')
      : join(filesRoot, 'Clientes', 'Outros', 'Layouts', layoutSubfolder(file.mimetype));

    const move: Move = {
      fileId: file.id,
      oldPath: file.path,
      newPath: join(folder, basename(file.path)),
      kind: cutCustomer ? 'root-stray cut → Plotter' : 'root-stray orphan → Outros/Layouts',
      status: 'planned',
    };
    if (move.oldPath !== move.newPath && !isDryRun) {
      move.newPath = uniqueTarget(move.newPath);
    }
    await relocate(move);
    moves.push(move);
  }

  // Anything on disk here with no File row is NOT touched: it is already invisible to
  // the app and deleting it is the orphan cleaner's job, not this migration's.
  if (existsSync(rootLayoutsDir)) {
    const leftovers = getAllFiles(rootLayoutsDir);
    if (leftovers.length > 0) {
      console.log(
        `    ${leftovers.length} file(s) remain on disk with no File row — left in place:`,
      );
      leftovers.slice(0, 20).forEach(f => console.log(`      ${f}`));
    }
  }
}

function getAllFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) out.push(...getAllFiles(full));
    else out.push(full);
  }
  return out;
}

/** Remove directories left empty by the moves (bottom-up). */
async function removeEmptyDirs(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) await removeEmptyDirs(full);
  }
  if (readdirSync(dir).length === 0) {
    await fs.rmdir(dir);
    console.log(`  [cleanup] removed empty dir: ${dir}`);
  }
}

async function main() {
  console.log('='.repeat(78));
  console.log(`Airbrushing layout storage migration — ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`filesRoot: ${filesRoot}`);
  console.log('='.repeat(78));

  await phaseAirbrushingLayouts();
  await phaseRootLayouts();

  console.log('\n' + '='.repeat(78));
  for (const m of moves) {
    const mark =
      m.status === 'error' ? 'ERROR ' : m.status === 'skipped' ? 'skip  ' : isDryRun ? 'plan  ' : 'moved ';
    console.log(`${mark} [${m.kind}]`);
    console.log(`        ${m.oldPath}`);
    console.log(`     -> ${m.newPath}${m.reason ? `   (${m.reason})` : ''}`);
  }

  const counts = moves.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {});
  console.log('\nSummary:', counts);

  if (!isDryRun) {
    // Prune folders vacated by the moves. Restricted to the two trees this script
    // touches so an unrelated empty folder elsewhere is never removed.
    await removeEmptyDirs(join(filesRoot, 'Layouts'));
    for (const customerDir of existsSync(join(filesRoot, 'Clientes'))
      ? readdirSync(join(filesRoot, 'Clientes'))
      : []) {
      const layoutsDir = join(filesRoot, 'Clientes', customerDir, 'Layouts');
      if (existsSync(layoutsDir)) await removeEmptyDirs(layoutsDir);
    }
  } else {
    console.log('\nDry run — nothing was moved. Re-run with --execute to apply.');
  }

  const errors = moves.filter(m => m.status === 'error');
  if (errors.length > 0) {
    console.error(`\n${errors.length} file(s) failed. Review before restarting the API.`);
    process.exitCode = 1;
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
