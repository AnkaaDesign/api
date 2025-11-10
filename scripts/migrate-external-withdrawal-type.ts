#!/usr/bin/env ts-node

/**
 * Migration script to update existing ExternalWithdrawal records
 * Maps the old willReturn boolean to the new type field
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateExternalWithdrawals() {
  console.log('Starting migration of ExternalWithdrawal types...');

  try {
    // Get all existing records
    const withdrawals = await prisma.$queryRaw<Array<{ id: string; willreturn?: boolean }>>`
      SELECT id, willreturn FROM "ExternalWithdrawal"
    `;

    console.log(`Found ${withdrawals.length} withdrawal records to migrate`);

    // Update each record based on the old willReturn value
    for (const withdrawal of withdrawals) {
      // Determine the type based on the old willReturn field
      // If willReturn was true, it's RETURNABLE
      // If willReturn was false and status is CHARGED, it's CHARGEABLE
      // Otherwise default to RETURNABLE
      let type: 'RETURNABLE' | 'CHARGEABLE' | 'COMPLIMENTARY' = 'RETURNABLE';

      if (withdrawal.willreturn === false) {
        // Check if it has a CHARGED status to determine if it's CHARGEABLE
        const statusCheck = await prisma.$queryRaw<Array<{ status: string }>>`
          SELECT status FROM "ExternalWithdrawal" WHERE id = ${withdrawal.id}
        `;

        if (statusCheck[0]?.status === 'CHARGED') {
          type = 'CHARGEABLE';
        } else {
          // If not charged but won't return, treat as COMPLIMENTARY
          type = 'COMPLIMENTARY';
        }
      }

      // Update the record with the new type
      await prisma.$executeRaw`
        UPDATE "ExternalWithdrawal"
        SET type = ${type}::"ExternalWithdrawalType"
        WHERE id = ${withdrawal.id}
      `;

      console.log(`Updated withdrawal ${withdrawal.id} to type: ${type}`);
    }

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateExternalWithdrawals().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});