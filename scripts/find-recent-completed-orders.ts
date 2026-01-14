import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findRecentCompletedOrders() {
  try {
    console.log('\n🔍 Finding recently completed service orders...\n');

    const serviceOrders = await prisma.serviceOrder.findMany({
      where: {
        status: 'COMPLETED',
        updatedAt: {
          gte: new Date('2026-01-14T00:00:00Z'), // Today
        },
      },
      include: {
        task: {
          select: {
            serialNumber: true,
          },
        },
        createdBy: {
          select: {
            name: true,
          },
        },
        startedBy: {
          select: {
            name: true,
          },
        },
        completedBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 10,
    });

    console.log(`✅ Found ${serviceOrders.length} completed service orders today:\n`);

    for (const so of serviceOrders) {
      console.log(`📋 ${so.description}`);
      console.log(`   ID: ${so.id}`);
      console.log(`   Task: ${so.task.serialNumber}`);
      console.log(`   Status: ${so.status}`);
      console.log(`   Updated: ${so.updatedAt}`);
      console.log(`   startedAt: ${so.startedAt || 'NULL ⚠️'}`);
      console.log(`   finishedAt: ${so.finishedAt || 'NULL ⚠️'}`);
      console.log(`   startedBy: ${so.startedBy?.name || 'NULL ⚠️'}`);
      console.log(`   completedBy: ${so.completedBy?.name || 'NULL ⚠️'}`);

      // Check for issues
      const issues = [];
      if (!so.startedAt) issues.push('startedAt is NULL');
      if (!so.finishedAt) issues.push('finishedAt is NULL');
      if (!so.startedById) issues.push('startedById is NULL');
      if (!so.completedById) issues.push('completedById is NULL');

      if (issues.length > 0) {
        console.log(`   ⚠️  ISSUES: ${issues.join(', ')}`);
      } else {
        console.log(`   ✅ All timestamps set correctly`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

findRecentCompletedOrders();
