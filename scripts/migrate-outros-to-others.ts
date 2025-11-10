import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting OUTROS → OTHERS migration...\n');

  try {
    // Step 1: Check current state
    console.log('📊 Checking current database state...');
    const outrosCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item"
      WHERE "ppeType" = 'OUTROS'
    `;
    console.log(`Found ${outrosCount[0].count} items with ppeType = 'OUTROS'\n`);

    // Step 2: Add new enum value OTHERS first
    console.log('🔄 Adding OTHERS to enum...');
    try {
      await prisma.$executeRaw`
        ALTER TYPE "PpeType" ADD VALUE 'OTHERS'
      `;
      console.log('✅ Added OTHERS to enum\n');
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log('ℹ️  OTHERS already exists in enum\n');
      } else {
        throw error;
      }
    }

    // Step 3: Update existing data from OUTROS to OTHERS
    console.log('🔄 Updating existing Item records...');
    const updateResult = await prisma.$executeRaw`
      UPDATE "Item"
      SET "ppeType" = 'OTHERS'
      WHERE "ppeType" = 'OUTROS'
    `;
    console.log(`✅ Updated ${updateResult} items\n`);

    // Note: We cannot remove OUTROS if any data still references it
    // Since we've updated all data, we can safely proceed
    // PostgreSQL doesn't allow removing enum values that might be referenced
    // So we'll leave OUTROS in the enum definition (it won't be used)

    console.log('⚠️  Note: OUTROS remains in database enum definition (PostgreSQL limitation)');
    console.log('   but all data now uses OTHERS and application code will use OTHERS\n');

    // Step 4: Verify migration
    console.log('✅ Verifying migration...');
    const othersCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item"
      WHERE "ppeType" = 'OTHERS'
    `;
    const remainingOutros = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "Item"
      WHERE "ppeType" = 'OUTROS'
    `;

    console.log(`✅ Items with ppeType = 'OTHERS': ${othersCount[0].count}`);
    console.log(`✅ Items with ppeType = 'OUTROS': ${remainingOutros[0].count}`);

    if (remainingOutros[0].count === BigInt(0) && othersCount[0].count > BigInt(0)) {
      console.log('\n✅ Migration completed successfully!');
      console.log('📋 Summary:');
      console.log(`   - ${othersCount[0].count} items now use OTHERS`);
      console.log('   - 0 items still use OUTROS');
      console.log('   - Database enum updated');
    } else {
      console.log('\n⚠️  Migration completed with warnings');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
