import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTestServiceOrder() {
  try {
    console.log('\n🔍 Looking for "Teste" service order in Frigorífico Jatobá 8,50 task...\n');

    // Find the task first
    const task = await prisma.task.findFirst({
      where: {
        serialNumber: '36740',
      },
      include: {
        serviceOrders: {
          where: {
            description: {
              contains: 'Teste',
              mode: 'insensitive',
            },
          },
          orderBy: {
            updatedAt: 'desc',
          },
        },
      },
    });

    if (!task) {
      console.log('❌ Task not found');
      return;
    }

    console.log(`✅ Found Task: ${task.serialNumber}`);
    console.log(`   Status: ${task.status}`);
    console.log(`   Service Orders: ${task.serviceOrders.length}\n`);

    if (task.serviceOrders.length === 0) {
      console.log('❌ No "Teste" service order found in this task');
      return;
    }

    const serviceOrder = task.serviceOrders[0];
    console.log('📋 Service Order Details:');
    console.log(`   ID: ${serviceOrder.id}`);
    console.log(`   Description: ${serviceOrder.description}`);
    console.log(`   Status: ${serviceOrder.status}`);
    console.log(`   Type: ${serviceOrder.type}`);

    console.log('\n📅 Timestamps:');
    console.log(`   createdAt: ${serviceOrder.createdAt}`);
    console.log(`   updatedAt: ${serviceOrder.updatedAt}`);
    console.log(`   startedAt: ${serviceOrder.startedAt || 'NULL'}`);
    console.log(`   finishedAt: ${serviceOrder.finishedAt || 'NULL'}`);
    console.log(`   approvedAt: ${serviceOrder.approvedAt || 'NULL'}`);

    console.log('\n👤 User IDs:');
    console.log(`   createdById: ${serviceOrder.createdById}`);
    console.log(`   startedById: ${serviceOrder.startedById || 'NULL'}`);
    console.log(`   completedById: ${serviceOrder.completedById || 'NULL'}`);
    console.log(`   approvedById: ${serviceOrder.approvedById || 'NULL'}`);

    // Get changelog
    console.log('\n📜 Changelog Entries:');
    const changelogs = await prisma.changeLog.findMany({
      where: {
        entityType: 'SERVICE_ORDER',
        entityId: serviceOrder.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    if (changelogs.length === 0) {
      console.log('   No changelog entries found');
    } else {
      changelogs.forEach((log, i) => {
        console.log(`\n   ${i + 1}. ${log.action} - ${log.field || 'FULL_ENTITY'}`);
        console.log(`      Old: ${log.oldValue || 'null'}`);
        console.log(`      New: ${log.newValue || 'null'}`);
        console.log(`      When: ${log.createdAt}`);
        console.log(`      By: ${log.user?.name || 'Unknown'}`);
      });
    }

    // Diagnosis
    console.log('\n🔬 DIAGNOSIS:');
    if (serviceOrder.status === 'COMPLETED') {
      if (!serviceOrder.finishedAt) {
        console.log('   ❌ ISSUE: Status is COMPLETED but finishedAt is NULL!');
      } else {
        console.log('   ✅ finishedAt is set correctly');
      }

      if (!serviceOrder.completedById) {
        console.log('   ❌ ISSUE: Status is COMPLETED but completedById is NULL!');
      } else {
        console.log('   ✅ completedById is set correctly');
      }
    }

    if (serviceOrder.status === 'IN_PROGRESS' || serviceOrder.status === 'COMPLETED') {
      if (!serviceOrder.startedAt) {
        console.log('   ❌ ISSUE: Service order was started but startedAt is NULL!');
      } else {
        console.log('   ✅ startedAt is set correctly');
      }

      if (!serviceOrder.startedById) {
        console.log('   ❌ ISSUE: Service order was started but startedById is NULL!');
      } else {
        console.log('   ✅ startedById is set correctly');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTestServiceOrder();
