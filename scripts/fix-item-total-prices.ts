#!/usr/bin/env tsx

/**
 * Script to recalculate and fix all Item totalPrice values
 *
 * This script:
 * 1. Fetches all items with their current prices
 * 2. Recalculates totalPrice = quantity × currentPrice
 * 3. Updates items where totalPrice is incorrect
 *
 * Usage:
 *   tsx scripts/fix-item-total-prices.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ItemWithPrice {
  id: string;
  name: string;
  quantity: number;
  totalPrice: number | null;
  prices: Array<{
    value: number;
    current: boolean;
  }>;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('==========================================');
  console.log('Fix Item Total Prices Script');
  console.log('==========================================');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE UPDATE'}`);
  console.log('');

  try {
    // Step 1: Fetch all items with their current prices
    console.log('[1/4] Fetching all items with prices...');

    const items = await prisma.item.findMany({
      select: {
        id: true,
        name: true,
        quantity: true,
        totalPrice: true,
        prices: {
          where: {
            current: true,
          },
          select: {
            value: true,
            current: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 1,
        },
      },
    });

    console.log(`✓ Found ${items.length} items`);
    console.log('');

    // Step 2: Calculate what totalPrice should be
    console.log('[2/4] Analyzing items and calculating correct totalPrice...');

    const itemsToUpdate: Array<{
      id: string;
      name: string;
      currentTotal: number | null;
      correctTotal: number;
      currentPrice: number;
      quantity: number;
    }> = [];

    let itemsWithNoPrice = 0;
    let itemsAlreadyCorrect = 0;

    for (const item of items) {
      const currentPrice = item.prices[0]?.value ?? 0;
      const correctTotal = item.quantity * currentPrice;

      // Round to avoid floating point comparison issues
      const roundedCorrectTotal = Math.round(correctTotal * 100) / 100;
      const roundedCurrentTotal = item.totalPrice !== null
        ? Math.round(item.totalPrice * 100) / 100
        : null;

      if (item.prices.length === 0) {
        itemsWithNoPrice++;
        // Items with no price should have totalPrice = 0
        if (item.totalPrice !== 0) {
          itemsToUpdate.push({
            id: item.id,
            name: item.name,
            currentTotal: item.totalPrice,
            correctTotal: 0,
            currentPrice: 0,
            quantity: item.quantity,
          });
        }
      } else if (roundedCurrentTotal !== roundedCorrectTotal) {
        itemsToUpdate.push({
          id: item.id,
          name: item.name,
          currentTotal: item.totalPrice,
          correctTotal: roundedCorrectTotal,
          currentPrice,
          quantity: item.quantity,
        });
      } else {
        itemsAlreadyCorrect++;
      }
    }

    console.log(`✓ Analysis complete:`);
    console.log(`  - Items with correct totalPrice: ${itemsAlreadyCorrect}`);
    console.log(`  - Items needing update: ${itemsToUpdate.length}`);
    console.log(`  - Items with no price: ${itemsWithNoPrice}`);
    console.log('');

    if (itemsToUpdate.length === 0) {
      console.log('✓ All items already have correct totalPrice values!');
      return;
    }

    // Step 3: Show sample of changes
    console.log('[3/4] Sample of changes (first 10):');
    console.log('');

    const sampleSize = Math.min(10, itemsToUpdate.length);
    for (let i = 0; i < sampleSize; i++) {
      const item = itemsToUpdate[i];
      console.log(`  ${i + 1}. ${item.name}`);
      console.log(`     Quantity: ${item.quantity} × Price: ${item.currentPrice}`);
      console.log(`     Current: ${item.currentTotal ?? 'null'} → Correct: ${item.correctTotal}`);
      console.log('');
    }

    if (itemsToUpdate.length > sampleSize) {
      console.log(`  ... and ${itemsToUpdate.length - sampleSize} more items`);
      console.log('');
    }

    // Step 4: Update items
    if (isDryRun) {
      console.log('[4/4] DRY RUN - No changes made');
      console.log('');
      console.log('Run without --dry-run to apply changes:');
      console.log('  tsx scripts/fix-item-total-prices.ts');
    } else {
      console.log('[4/4] Updating items...');

      let updated = 0;
      let failed = 0;

      // Update in batches using transactions
      const batchSize = 100;
      for (let i = 0; i < itemsToUpdate.length; i += batchSize) {
        const batch = itemsToUpdate.slice(i, i + batchSize);

        try {
          await prisma.$transaction(
            batch.map(item =>
              prisma.item.update({
                where: { id: item.id },
                data: { totalPrice: item.correctTotal },
              })
            )
          );

          updated += batch.length;

          // Progress indicator
          const progress = Math.round((updated / itemsToUpdate.length) * 100);
          process.stdout.write(`\r  Progress: ${updated}/${itemsToUpdate.length} (${progress}%)`);
        } catch (error) {
          console.error(`\n  ✗ Error updating batch starting at index ${i}:`, error);
          failed += batch.length;
        }
      }

      console.log('\n');
      console.log('✓ Update complete!');
      console.log(`  - Successfully updated: ${updated} items`);
      if (failed > 0) {
        console.log(`  - Failed: ${failed} items`);
      }
    }

    console.log('');
    console.log('==========================================');
    console.log('Summary');
    console.log('==========================================');
    console.log(`Total items analyzed: ${items.length}`);
    console.log(`Items already correct: ${itemsAlreadyCorrect}`);
    console.log(`Items ${isDryRun ? 'that would be' : ''} updated: ${itemsToUpdate.length}`);
    console.log('==========================================');

  } catch (error) {
    console.error('');
    console.error('✗ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
