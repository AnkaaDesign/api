/**
 * Reconciliation category cleanup + supplier alias seeding — June 2026
 *
 * 1. Deactivate: Comunicação Visual, Transferência, Pintura e Colorimetria,
 *    Saúde e Medicina do Trabalho, TI e Cloud
 * 2. Create: Aerografia, Impressão de Adesivo, Prestação de Serviços
 * 3. Assign BankTransactionCategory (MANUAL) for known supplier transactions
 * 4. Create ItemCategoryAlias (ADMIN_SEEDED) from all their NF line fingerprints
 * 5. Stamp FiscalDocumentItem.categoryId on previously-unclassified NF lines
 *
 * Safe to re-run — upserts everywhere, never deletes data.
 */

import { PrismaClient } from '@prisma/client';
import { descriptionFingerprint } from '../../src/modules/financial/reconciliation/text-normalization';

const prisma = new PrismaClient();

// ─── Supplier registry ───────────────────────────────────────────────────────
const SUPPLIERS: Array<{
  cnpj: string;
  label: string;
  categorySlug: string;
}> = [
  { cnpj: '62179778000167', label: 'Paulo Batista da Silva',       categorySlug: 'aerografia'           },
  { cnpj: '51115818000190', label: 'Marcos Aurélio Lima de Souza', categorySlug: 'aerografia'           },
  { cnpj: '62626218000103', label: 'Claudemir Ribeiro Sobral',     categorySlug: 'aerografia'           },
  { cnpj: '53842320000155', label: 'Kennedy de Campos Teixeira',   categorySlug: 'prestacao-de-servicos'},
  { cnpj: '04727300000128', label: 'Aderi / RT Comunicação Visual',categorySlug: 'impressao-de-adesivo' },
];

// ─── New categories ──────────────────────────────────────────────────────────
const NEW_CATEGORIES = [
  {
    slug: 'aerografia',
    name: 'Aerografia',
    kind: 'SERVICE',
    isResolving: true,
    isRecurring: false,
    isActive: true,
    sortOrder: 100,
    color: '#6366f1',
  },
  {
    slug: 'impressao-de-adesivo',
    name: 'Impressão de Adesivo',
    kind: 'SERVICE',
    isResolving: true,
    isRecurring: false,
    isActive: true,
    sortOrder: 101,
    color: '#f59e0b',
  },
  {
    slug: 'prestacao-de-servicos',
    name: 'Prestação de Serviços',
    kind: 'TRANSACTION_ONLY',
    isResolving: true,
    isRecurring: false,
    isActive: true,
    sortOrder: 102,
    color: '#10b981',
  },
];

// ─── Categories to deactivate ────────────────────────────────────────────────
const DEACTIVATE_SLUGS = [
  'comunicacao-visual',
  'transferencia',
  'pintura',
  'saude',
  'ti',
];

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  SEED: Reconciliation Categories — June 2026');
  console.log('══════════════════════════════════════════════════════════');

  // ── 1. Deactivate unwanted categories ──────────────────────────────────────
  const { count: deactivatedCount } = await prisma.transactionCategory.updateMany({
    where: { slug: { in: DEACTIVATE_SLUGS } },
    data: { isActive: false },
  });
  console.log(`\n  Desativadas ${deactivatedCount} categorias: ${DEACTIVATE_SLUGS.join(', ')}`);

  // ── 2. Create new categories ───────────────────────────────────────────────
  console.log('\n  Categorias:');
  for (const cat of NEW_CATEGORIES) {
    const existing = await prisma.transactionCategory.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      if (!existing.isActive) {
        await prisma.transactionCategory.update({ where: { slug: cat.slug }, data: { isActive: true } });
        console.log(`  ↺ ${cat.name} — reativado`);
      } else {
        console.log(`  ⤳ ${cat.name} — já existe`);
      }
    } else {
      await prisma.transactionCategory.create({ data: cat as any });
      console.log(`  ＋ ${cat.name} — criado`);
    }
  }

  // ── 3. Assign BankTransactionCategory ─────────────────────────────────────
  console.log('\n  Atribuindo categorias a transações...');

  for (const { cnpj, label, categorySlug } of SUPPLIERS) {
    const category = await prisma.transactionCategory.findUnique({ where: { slug: categorySlug } });
    if (!category) { console.log(`  ✗ Categoria não encontrada: ${categorySlug}`); continue; }

    // Find all transactions for this counterparty
    const transactions = await prisma.bankTransaction.findMany({
      where: { counterpartyCnpjCpf: cnpj },
      select: { id: true },
    });

    let assigned = 0;
    for (const tx of transactions) {
      await prisma.bankTransactionCategory.upsert({
        where: { transactionId_categoryId: { transactionId: tx.id, categoryId: category.id } },
        create: {
          transactionId: tx.id,
          categoryId: category.id,
          source: 'MANUAL',
        },
        update: {
          source: 'MANUAL', // ensure manual overwrites any AUTO assignment
        },
      });
      assigned++;
    }
    console.log(`  ${label}: ${assigned} transações → ${category.name}`);
  }

  // ── 4. Create ItemCategoryAlias from NF line fingerprints ──────────────────
  console.log('\n  Criando aliases de descrição NF...');
  let aliasTotal = 0;

  for (const { cnpj, label, categorySlug } of SUPPLIERS) {
    const category = await prisma.transactionCategory.findUnique({ where: { slug: categorySlug } });
    if (!category) continue;

    const items = await prisma.fiscalDocumentItem.findMany({
      where: { fiscalDocument: { emitCnpj: cnpj } },
      select: { description: true },
    });

    const seen = new Set<string>();
    for (const item of items) {
      const fp = descriptionFingerprint(item.description);
      if (!fp || seen.has(fp)) continue;
      seen.add(fp);

      await prisma.itemCategoryAlias.upsert({
        where: {
          descriptionFingerprint_categoryId: {
            descriptionFingerprint: fp,
            categoryId: category.id,
          },
        },
        create: {
          descriptionFingerprint: fp,
          categoryId: category.id,
          source: 'ADMIN_SEEDED',
          confirmedCount: 3,
          rejectedCount: 0,
        },
        update: {
          confirmedCount: { increment: 1 },
          lastConfirmedAt: new Date(),
          disabledAt: null, // re-enable if previously soft-disabled
        },
      });
      aliasTotal++;
    }
    console.log(`  ${label}: ${seen.size} fingerprints → ${category.name}`);
  }
  console.log(`  Total aliases upserted: ${aliasTotal}`);

  // ── 5. Stamp FiscalDocumentItem.categoryId on unclassified NF lines ────────
  console.log('\n  Atualizando itens NF não classificados...');

  for (const { cnpj, label, categorySlug } of SUPPLIERS) {
    const category = await prisma.transactionCategory.findUnique({ where: { slug: categorySlug } });
    if (!category) continue;

    const { count } = await prisma.fiscalDocumentItem.updateMany({
      where: {
        fiscalDocument: { emitCnpj: cnpj },
        categoryId: null,
      },
      data: {
        categoryId: category.id,
        categoryConfidence: 97,
        categorySource: 'MANUAL',
      },
    });
    console.log(`  ${label}: ${count} itens NF classificados → ${category.name}`);
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Concluído com sucesso.');
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
