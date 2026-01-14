import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function compareEntries() {
  try {
    console.log('\n🔍 Comparing old and new changelog entries...\n');

    // Get the problematic old entry
    const oldEntry = await prisma.changeLog.findUnique({
      where: { id: '35e3494c-f086-4db8-a104-dc0f0d179e83' }, // ADESIVO CABINE startedAt
    });

    console.log('📜 OLD Entry (ADESIVO CABINE):');
    console.log(`   ID: ${oldEntry?.id}`);
    console.log(`   Field: ${oldEntry?.field}`);
    console.log(`   newValue type: ${typeof oldEntry?.newValue}`);
    console.log(`   newValue: ${JSON.stringify(oldEntry?.newValue)}`);
    console.log(`   Raw newValue: ${oldEntry?.newValue}`);

    // Create a new test entry using current code
    console.log('\n📝 Creating NEW test entry with current code...');

    const serviceOrder = await prisma.serviceOrder.findFirst({
      where: {
        status: 'PENDING',
      },
    });

    if (!serviceOrder) {
      console.log('No pending service order found for testing');
      return;
    }

    // Update it to IN_PROGRESS (this will trigger automatic timestamp)
    const updated = await prisma.serviceOrder.update({
      where: { id: serviceOrder.id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        startedById: '345cd001-37de-469b-a184-fb0e729d4401',
      },
    });

    console.log(`   Updated service order: ${updated.id}`);
    console.log(`   New startedAt: ${updated.startedAt}`);

    // Get the changelog entry that was just created
    const newEntry = await prisma.changeLog.findFirst({
      where: {
        entityType: 'SERVICE_ORDER',
        entityId: updated.id,
        field: 'startedAt',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (newEntry) {
      console.log('\n📜 NEW Entry (just created):');
      console.log(`   ID: ${newEntry.id}`);
      console.log(`   Field: ${newEntry.field}`);
      console.log(`   newValue type: ${typeof newEntry.newValue}`);
      console.log(`   newValue: ${JSON.stringify(newEntry.newValue)}`);
      console.log(`   Raw newValue: ${newEntry.newValue}`);

      // Test parsing
      console.log('\n🧪 Parsing test:');
      try {
        const oldDate = new Date(String(oldEntry?.newValue));
        console.log(`   OLD: ${oldDate} - Valid: ${!isNaN(oldDate.getTime())}`);
      } catch (e) {
        console.log(`   OLD: Failed to parse`);
      }

      try {
        const newDate = new Date(String(newEntry.newValue));
        console.log(`   NEW: ${newDate} - Valid: ${!isNaN(newDate.getTime())}`);
      } catch (e) {
        console.log(`   NEW: Failed to parse`);
      }
    } else {
      console.log('\n❌ No new changelog entry was created!');
      console.log('   This means the update bypassed the automatic timestamp logic.');
    }

    // Revert the test change
    if (updated && serviceOrder.status === 'PENDING') {
      await prisma.serviceOrder.update({
        where: { id: updated.id },
        data: {
          status: 'PENDING',
          startedAt: null,
          startedById: null,
        },
      });
      console.log('\n✅ Reverted test changes');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

compareEntries();
