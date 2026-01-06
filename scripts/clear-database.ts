import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('🗑️  Starting database cleanup...\n');
  }

  try {
    // Delete data in the correct order to respect foreign key constraints
    const tables = [
      // File-related tables first (they reference many others)
      'File',

      // Task-related tables
      'Observation',
      'Truck',
      'Layout',
      'ServiceOrder',
      'Airbrushing',
      'Cut',
      'PaintApplication',
      'Task',

      // Inventory/Production
      'Paint',
      'PaintType',
      'PaintBrand',
      'Catalog',
      'CatalogColor',
      'CatalogCollectionColor',
      'CatalogCollection',

      // Maintenance
      'MaintenanceItem',
      'Maintenance',
      'MaintenanceSchedule',

      // PPE
      'PpeDeliveryItem',
      'PpeDelivery',
      'PpeDeliverySchedule',
      'PpeSize',
      'PpeItem',

      // Inventory
      'ActivityItem',
      'Activity',
      'BorrowedItem',
      'Borrow',
      'OrderItem',
      'Order',
      'OrderSchedule',
      'ExternalWithdrawal',
      'Item',
      'Brand',
      'Category',
      'Supplier',

      // HR
      'Vacation',
      'Warning',
      'Holiday',
      'Bonus',
      'BonusDiscount',
      'Payroll',
      'PayrollItem',

      // Budget
      'Budget',
      'CuttingPlan',

      // Base entities
      'Employee',
      'Position',
      'Garage',
      'Customer',
      'Sector',
      'Changelog',
      'Notification',
      'User',
    ];

    for (const table of tables) {
      try {
        // Use raw query to delete all records
        const result = await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`✅ Cleared ${table} (${result} records deleted)`);
        }
      } catch (error: any) {
        // Some tables might not exist or might already be empty
        if (error.code === 'P2010') {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`⏭️  Skipped ${table} (table doesn't exist)`);
          }
        } else if (error.message.includes('does not exist')) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`⏭️  Skipped ${table} (table doesn't exist)`);
          }
        } else {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`⚠️  Warning clearing ${table}: ${error.message}`);
          }
        }
      }
    }

    // Reset sequences (PostgreSQL specific)
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n🔄 Resetting sequences...');
    }
    try {
      const sequences = await prisma.$queryRaw`
        SELECT sequence_name
        FROM information_schema.sequences
        WHERE sequence_schema = 'public'
      ` as any[];

      for (const seq of sequences) {
        await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${seq.sequence_name}" RESTART WITH 1`);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`  ✅ Reset sequence: ${seq.sequence_name}`);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('  ⚠️  Could not reset sequences (this is okay)');
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n✨ Database cleared successfully!');
      console.log('\n📝 You can now run the seed script:');
      console.log('   npm run seed');
    }

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('❌ Error clearing database:', error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
clearDatabase();