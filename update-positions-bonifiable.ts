#!/usr/bin/env node

/**
 * Script to update bonifiable flag for positions based on their level
 * Junior, Pleno, and Senior positions with levels 1-4 will be set as bonifiable
 *
 * Usage: npx ts-node update-positions-bonifiable.ts
 * Or: DATABASE_URL="postgresql://..." npx ts-node update-positions-bonifiable.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function calculateLevel(remuneration: number): number {
  if (remuneration <= 0) return 0;
  if (remuneration < 2500) return 1;
  if (remuneration < 3000) return 2;
  if (remuneration < 4000) return 3;
  if (remuneration < 5000) return 4;
  return 5;
}

async function updatePositionsBonifiable() {
  console.log('🔄 Updating bonifiable flag for existing positions...\n');

  try {
    // Get all positions with their remuneration
    const positions = await prisma.position.findMany({
      include: {
        remunerations: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    });

    console.log(`Found ${positions.length} positions to check\n`);

    let updatedCount = 0;
    let alreadyCorrectCount = 0;

    for (const position of positions) {
      const remuneration = position.remunerations[0]?.value || 0;
      const level = calculateLevel(remuneration);

      // Check if position should be bonifiable
      // Junior, Pleno, or Senior positions with levels 1-4 are bonifiable
      const shouldBeBonifiable = level >= 1 && level <= 4 &&
        /junior|pleno|senior/i.test(position.name);

      // Update if the bonifiable flag is different
      if (position.bonifiable !== shouldBeBonifiable) {
        await prisma.position.update({
          where: { id: position.id },
          data: { bonifiable: shouldBeBonifiable }
        });

        console.log(`✅ Updated: ${position.name}`);
        console.log(`   Level: ${level}, Remuneration: R$ ${remuneration.toFixed(2)}`);
        console.log(`   Bonifiable: ${position.bonifiable} → ${shouldBeBonifiable}\n`);
        updatedCount++;
      } else if (shouldBeBonifiable) {
        alreadyCorrectCount++;
        console.log(`✓ Already correct: ${position.name} (bonifiable: ${shouldBeBonifiable}, level: ${level})`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Summary:');
    console.log(`- Total positions checked: ${positions.length}`);
    console.log(`- Positions updated: ${updatedCount}`);
    console.log(`- Already correct bonifiable positions: ${alreadyCorrectCount}`);
    console.log(`- Non-bonifiable positions: ${positions.length - updatedCount - alreadyCorrectCount}`);
    console.log('='.repeat(50));

    console.log('\n✅ Update completed successfully!');
  } catch (error) {
    console.error('❌ Failed to update positions:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update
updatePositionsBonifiable().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});