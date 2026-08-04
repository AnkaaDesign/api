/**
 * Traz para /srv/files os arquivos que ficaram em `api/uploads/`.
 *
 * DRY-RUN POR PADRÃO. Só escreve com `--apply`.
 *
 *   npx tsx scripts/migrate-uploads-to-storage.ts            # só relata
 *   npx tsx scripts/migrate-uploads-to-storage.ts --apply    # move de verdade
 *
 * Por que existe
 * -------------
 * `process.cwd()/uploads` fica fora do FILES_ROOT: não entrava no espelho do HD (o
 * files-sync.sh só espelhava /srv/files/), logo não chegava no Google Drive, e está no
 * .gitignore da API — um `git clean -xfd` apagava. Eram 1.453 linhas File, 19% do total.
 *
 * O que ESTE script cobre
 * -----------------------
 * Só as categorias cujo gravador já foi corrigido para escrever direto em /srv/files:
 *   · BankTransaction.rawFileId  (extrato OFX)  -> Financeiro/Extratos
 *   · BankSlip.pdfFileId         (boleto PDF)   -> Clientes/{cliente}/Boletos
 *
 * O que ele DELIBERADAMENTE não cobre
 * -----------------------------------
 * Os XMLs de documento fiscal (`uploads/fiscal-documents/`, 968 referenciados). O código
 * que os grava NÃO foi localizado — não está em src/, nem em dist/, nem em scripts/, e
 * mesmo assim linhas novas apareceram em 2026-08-04 11:19. Mover os arquivos enquanto um
 * gravador desconhecido continua escrevendo no lugar antigo recria exatamente a divisão
 * que estamos eliminando. Eles já estão protegidos pelo espelho (files-sync.sh passou a
 * cobrir uploads/); a migração espera a identificação do gravador.
 *
 * Segurança
 * ---------
 * Ordem copiar -> conferir tamanho -> atualizar File.path -> só então apagar a origem.
 * Uma falha em qualquer ponto deixa o arquivo íntegro em pelo menos um dos dois lugares,
 * nunca em nenhum. Cada movimento grava ChangeLog, então dá para reverter pelo histórico.
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, statSync, copyFileSync, unlinkSync, mkdirSync } from 'fs';
import { dirname, basename, join } from 'path';

const prisma = new PrismaClient();
const FILES_ROOT = process.env.FILES_ROOT || '/srv/files';
const APPLY = process.argv.includes('--apply');

function sanitize(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/** Nome livre no destino, com sufixo incremental — nunca sobrescreve. */
function freeTarget(dir: string, filename: string): string {
  let candidate = join(dir, filename);
  if (!existsSync(candidate)) return candidate;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`sem nome livre para ${filename} em ${dir}`);
}

async function main() {
  const plan: Array<{ id: string; from: string; to: string; kind: string }> = [];

  // 1) Extratos bancários — raiz, sem entidade dona.
  const statements = await prisma.file.findMany({
    where: {
      path: { not: { startsWith: FILES_ROOT } },
      bankTransactionImports: { some: {} },
    },
    select: { id: true, path: true, filename: true },
  });
  for (const f of statements) {
    plan.push({
      id: f.id,
      from: f.path,
      to: join(FILES_ROOT, 'Financeiro', 'Extratos', f.filename),
      kind: 'extrato',
    });
  }

  // 2) Boletos — pasta do cliente quando resolvível.
  const slips = await prisma.bankSlip.findMany({
    where: { pdfFile: { path: { not: { startsWith: FILES_ROOT } } } },
    select: {
      pdfFile: { select: { id: true, path: true, filename: true } },
      installment: {
        select: { customerConfig: { select: { customer: { select: { fantasyName: true } } } } },
      },
    },
  });
  for (const s of slips) {
    if (!s.pdfFile) continue;
    const owner = s.installment?.customerConfig?.customer?.fantasyName;
    const dir = owner
      ? join(FILES_ROOT, 'Clientes', sanitize(owner), 'Boletos')
      : join(FILES_ROOT, 'Clientes', 'Outros', 'Boletos');
    plan.push({ id: s.pdfFile.id, from: s.pdfFile.path, to: join(dir, s.pdfFile.filename), kind: 'boleto' });
  }

  console.log(`${APPLY ? 'APLICANDO' : 'DRY-RUN'} — ${plan.length} arquivo(s) a migrar\n`);
  const byKind = new Map<string, number>();
  plan.forEach(p => byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1));
  byKind.forEach((v, k) => console.log(`  ${String(v).padStart(4)}  ${k}`));

  let moved = 0;
  let skipped = 0;
  for (const item of plan) {
    if (!existsSync(item.from)) {
      console.log(`  PULADO (origem sumiu): ${item.from}`);
      skipped++;
      continue;
    }
    if (!APPLY) {
      console.log(`  ${item.from}\n      -> ${dirname(item.to)}/`);
      continue;
    }
    try {
      mkdirSync(dirname(item.to), { recursive: true });
      const target = freeTarget(dirname(item.to), basename(item.to));
      const sourceSize = statSync(item.from).size;

      // copiar -> conferir -> atualizar -> só então apagar
      copyFileSync(item.from, target);
      if (statSync(target).size !== sourceSize) {
        unlinkSync(target);
        throw new Error(`tamanho divergente após cópia (${item.from})`);
      }

      await prisma.$transaction(async tx => {
        await tx.file.update({
          where: { id: item.id },
          data: { path: target, filename: basename(target) },
        });
        await tx.changeLog.create({
          data: {
            entityType: 'FILE',
            entityId: item.id,
            action: 'UPDATE',
            field: 'path',
            oldValue: item.from,
            newValue: target,
            reason: 'Migrado de uploads/ para o storage (/srv/files)',
            triggeredBy: 'SYSTEM',
          } as any,
        });
      });

      unlinkSync(item.from);
      moved++;
      console.log(`  OK  ${basename(item.from)} -> ${dirname(target)}/`);
    } catch (err: any) {
      skipped++;
      console.error(`  ERRO ${item.from}: ${err.message}`);
    }
  }

  console.log(`\nmovidos=${moved} pulados=${skipped}`);
  if (!APPLY) console.log('\nNada foi alterado. Rode com --apply para executar.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
