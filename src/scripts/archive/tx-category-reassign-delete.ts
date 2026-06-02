/**
 * tx-category-reassign-delete.ts  (destructive — run once)
 * - Convênio (36): COPEL→Energia Elétrica, SAMAE→Água, CLARO→Internet/Telefone,
 *   anything else→untag (PENDING). Then delete Convênio.
 * - Transferência (28): all are aplicações/resgates → Aplicação Financeira. Then delete.
 * - Delete SERVICE cats (Pintura e Colorimetria, Comunicação Visual, TI e Cloud,
 *   Saúde e Medicina do Trabalho): untag transactions, null NF items, delete cat.
 * A transaction left with NO category tag AND NO active match that was RECONCILED
 * is reverted to PENDING (won't touch NF-matched ones).
 *
 * Run: npx ts-node -r tsconfig-paths/register --transpile-only src/scripts/tx-category-reassign-delete.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../modules/common/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);

  const idByName = async (name: string) => {
    const c = await prisma.transactionCategory.findFirst({ where: { name }, select: { id: true } });
    if (!c) throw new Error(`category not found: ${name}`);
    return c.id;
  };
  const [energia, agua, internet, aplicacao] = await Promise.all([
    idByName('Energia Elétrica'), idByName('Água'), idByName('Internet / Telefone'), idByName('Aplicação Financeira'),
  ]);

  // Reassign one tag to targetId, honouring the @@unique([transactionId,categoryId]).
  // targetId null => untag (delete) and mark the transaction for orphan-revert.
  const touched = new Set<string>();
  const move = async (tagId: string, transactionId: string, targetId: string | null) => {
    touched.add(transactionId);
    if (!targetId) { await prisma.bankTransactionCategory.delete({ where: { id: tagId } }); return; }
    const dup = await prisma.bankTransactionCategory.findUnique({
      where: { transactionId_categoryId: { transactionId, categoryId: targetId } }, select: { id: true },
    });
    if (dup && dup.id !== tagId) await prisma.bankTransactionCategory.delete({ where: { id: tagId } });
    else await prisma.bankTransactionCategory.update({ where: { id: tagId }, data: { categoryId: targetId, source: 'MANUAL', confidence: null } });
  };

  // --- Convênio ---
  const convenioId = await idByName('Convênio');
  const conv = await prisma.bankTransactionCategory.findMany({
    where: { categoryId: convenioId }, select: { id: true, transactionId: true, transaction: { select: { memo: true, counterpartyName: true } } },
  });
  let cCopel = 0, cAgua = 0, cClaro = 0, cOther = 0;
  for (const t of conv) {
    const hay = `${t.transaction.memo || ''} ${t.transaction.counterpartyName || ''}`.toUpperCase();
    if (hay.includes('COPEL')) { await move(t.id, t.transactionId, energia); cCopel++; }
    else if (hay.includes('SAMAE')) { await move(t.id, t.transactionId, agua); cAgua++; }
    else if (hay.includes('CLARO')) { await move(t.id, t.transactionId, internet); cClaro++; }
    else { await move(t.id, t.transactionId, null); cOther++; }
  }
  console.log(`Convênio reassigned: COPEL→Energia=${cCopel}, SAMAE→Água=${cAgua}, CLARO→Internet=${cClaro}, untagged=${cOther}`);

  // --- Transferência → Aplicação Financeira ---
  const transfId = await idByName('Transferência');
  const transf = await prisma.bankTransactionCategory.findMany({ where: { categoryId: transfId }, select: { id: true, transactionId: true } });
  for (const t of transf) await move(t.id, t.transactionId, aplicacao);
  console.log(`Transferência → Aplicação Financeira: ${transf.length}`);

  // --- SERVICE deletes (untag + null NF items) ---
  const SERVICE_DELETE = ['Pintura e Colorimetria', 'Comunicação Visual', 'TI e Cloud', 'Saúde e Medicina do Trabalho'];
  for (const name of SERVICE_DELETE) {
    const id = await idByName(name);
    const tags = await prisma.bankTransactionCategory.findMany({ where: { categoryId: id }, select: { transactionId: true } });
    tags.forEach(t => touched.add(t.transactionId));
    const delTags = await prisma.bankTransactionCategory.deleteMany({ where: { categoryId: id } });
    const nulled = await prisma.fiscalDocumentItem.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await prisma.reconciliationAlias.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    console.log(`${name}: untagged ${delTags.count} tx, nulled ${nulled.count} NF items`);
  }

  // --- Delete the now-empty doomed categories ---
  for (const name of ['Convênio', 'Transferência', ...SERVICE_DELETE]) {
    const id = await idByName(name).catch(() => null);
    if (!id) continue;
    await prisma.fiscalDocumentItem.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await prisma.reconciliationAlias.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await prisma.transactionCategory.delete({ where: { id } });
    console.log(`DELETED category: ${name}`);
  }

  // --- Revert genuinely-orphaned transactions to PENDING ---
  let reverted = 0;
  for (const txId of touched) {
    const [tagCount, matchCount, tx] = await Promise.all([
      prisma.bankTransactionCategory.count({ where: { transactionId: txId } }),
      prisma.reconciliationMatch.count({ where: { transactionId: txId, reversedAt: null } }),
      prisma.bankTransaction.findUnique({ where: { id: txId }, select: { reconciliationStatus: true } }),
    ]);
    if (tagCount === 0 && matchCount === 0 && tx?.reconciliationStatus === 'RECONCILED') {
      await prisma.bankTransaction.update({ where: { id: txId }, data: { reconciliationStatus: 'PENDING', categorySource: null, reconciliationSource: null } });
      reverted++;
    }
  }
  console.log(`Reverted to PENDING (orphaned): ${reverted} / ${touched.size} touched`);

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
