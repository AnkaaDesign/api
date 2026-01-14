import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkChangelog() {
  try {
    console.log('\n🔍 Finding recent service order with "Em Andamento" status change...\n');

    // Find recent IN_PROGRESS status changes
    const statusChanges = await prisma.changeLog.findMany({
      where: {
        entityType: 'SERVICE_ORDER',
        field: 'status',
        createdAt: {
          gte: new Date('2026-01-14T00:00:00Z'),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    // Filter for IN_PROGRESS changes (since newValue is Json)
    const inProgressChanges = statusChanges.filter(c => c.newValue === 'IN_PROGRESS');

    console.log(`Found ${inProgressChanges.length} recent status changes to IN_PROGRESS\n`);

    for (const change of inProgressChanges) {
      console.log(`📋 Service Order: ${change.entityId}`);
      console.log(`   Status Change: ${change.oldValue} → ${change.newValue}`);
      console.log(`   Changed At: ${change.createdAt}`);
      console.log(`   Changed By: ${change.user?.name || 'Unknown'}`);

      // Get the service order details
      const serviceOrder = await prisma.serviceOrder.findUnique({
        where: { id: change.entityId },
        select: {
          description: true,
          status: true,
          startedAt: true,
          startedById: true,
          startedBy: {
            select: {
              name: true,
            },
          },
        },
      });

      if (serviceOrder) {
        console.log(`   Description: ${serviceOrder.description}`);
        console.log(`   Current startedAt: ${serviceOrder.startedAt || 'NULL ⚠️'}`);
        console.log(`   Current startedById: ${serviceOrder.startedById || 'NULL ⚠️'}`);
        console.log(`   Current startedBy: ${serviceOrder.startedBy?.name || 'NULL ⚠️'}`);
      }

      // Check if there's a corresponding startedAt changelog entry
      const startedAtChange = await prisma.changeLog.findFirst({
        where: {
          entityType: 'SERVICE_ORDER',
          entityId: change.entityId,
          field: 'startedAt',
          // Within 1 second of the status change
          createdAt: {
            gte: new Date(change.createdAt.getTime() - 1000),
            lte: new Date(change.createdAt.getTime() + 1000),
          },
        },
      });

      if (startedAtChange) {
        console.log(`   ✅ startedAt changelog entry EXISTS`);
        console.log(`      Old: ${startedAtChange.oldValue || 'null'}`);
        console.log(`      New: ${startedAtChange.newValue || 'null'}`);
      } else {
        console.log(`   ❌ startedAt changelog entry MISSING`);
        console.log(`   This is why the changelog shows "Data inválida"!`);
      }

      // Check for startedById
      const startedByIdChange = await prisma.changeLog.findFirst({
        where: {
          entityType: 'SERVICE_ORDER',
          entityId: change.entityId,
          field: 'startedById',
          createdAt: {
            gte: new Date(change.createdAt.getTime() - 1000),
            lte: new Date(change.createdAt.getTime() + 1000),
          },
        },
      });

      if (startedByIdChange) {
        console.log(`   ✅ startedById changelog entry EXISTS`);
        console.log(`      Old: ${startedByIdChange.oldValue || 'null'}`);
        console.log(`      New: ${startedByIdChange.newValue || 'null'}`);
      } else {
        console.log(`   ❌ startedById changelog entry MISSING`);
      }

      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkChangelog();
