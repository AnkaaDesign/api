import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function queryServiceOrder() {
  const serviceOrderId = '8332cb8b-0f1a-416f-ab72-a5eedcf10ccd';

  try {
    console.log(`\n🔍 Querying Service Order: ${serviceOrderId}\n`);

    // Query the service order with all relations
    const serviceOrder = await prisma.serviceOrder.findUnique({
      where: {
        id: serviceOrderId,
      },
      include: {
        task: {
          select: {
            id: true,
            serialNumber: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        startedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        completedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!serviceOrder) {
      console.log('❌ Service Order not found!');
      return;
    }

    console.log('✅ Service Order Found:\n');
    console.log('📋 Basic Information:');
    console.log(`   ID: ${serviceOrder.id}`);
    console.log(`   Description: ${serviceOrder.description}`);
    console.log(`   Type: ${serviceOrder.type}`);
    console.log(`   Status: ${serviceOrder.status}`);
    console.log(`   Status Order: ${serviceOrder.statusOrder}`);
    console.log(`   Observation: ${serviceOrder.observation || 'N/A'}`);

    console.log('\n📅 Timestamp Fields:');
    console.log(`   createdAt: ${serviceOrder.createdAt}`);
    console.log(`   updatedAt: ${serviceOrder.updatedAt}`);
    console.log(`   startedAt: ${serviceOrder.startedAt}`);
    console.log(`   approvedAt: ${serviceOrder.approvedAt}`);
    console.log(`   finishedAt: ${serviceOrder.finishedAt}`);

    console.log('\n👤 User Relations:');
    console.log(`   Created By: ${serviceOrder.createdBy?.name || 'N/A'} (${serviceOrder.createdBy?.email || 'N/A'})`);
    console.log(`   Started By: ${serviceOrder.startedBy?.name || 'N/A'} (${serviceOrder.startedBy?.email || 'N/A'})`);
    console.log(`   Approved By: ${serviceOrder.approvedBy?.name || 'N/A'} (${serviceOrder.approvedBy?.email || 'N/A'})`);
    console.log(`   Completed By: ${serviceOrder.completedBy?.name || 'N/A'} (${serviceOrder.completedBy?.email || 'N/A'})`);
    console.log(`   Assigned To: ${serviceOrder.assignedTo?.name || 'N/A'} (${serviceOrder.assignedTo?.email || 'N/A'})`);

    console.log('\n📦 Related Task:');
    console.log(`   Task ID: ${serviceOrder.task.id}`);
    console.log(`   Serial Number: ${serviceOrder.task.serialNumber}`);
    console.log(`   Status: ${serviceOrder.task.status}`);

    // Raw timestamp inspection
    console.log('\n🔬 Raw Timestamp Analysis:');
    console.log('   startedAt type:', typeof serviceOrder.startedAt);
    console.log('   startedAt value:', serviceOrder.startedAt);
    console.log('   startedAt is null:', serviceOrder.startedAt === null);
    console.log('   startedAt is undefined:', serviceOrder.startedAt === undefined);

    if (serviceOrder.startedAt) {
      console.log('   startedAt ISO string:', serviceOrder.startedAt.toISOString());
      console.log('   startedAt timestamp:', serviceOrder.startedAt.getTime());
      console.log('   startedAt is valid:', !isNaN(serviceOrder.startedAt.getTime()));
    }

    // Check changelog for this service order
    console.log('\n📜 Recent Changelog Entries:');
    const changelogs = await prisma.changeLog.findMany({
      where: {
        entityType: 'SERVICE_ORDER',
        entityId: serviceOrderId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (changelogs.length === 0) {
      console.log('   No changelog entries found.');
    } else {
      changelogs.forEach((log, index) => {
        console.log(`\n   ${index + 1}. ${log.action} - ${log.field || 'N/A'}`);
        console.log(`      Old Value: ${log.oldValue || 'null'}`);
        console.log(`      New Value: ${log.newValue || 'null'}`);
        console.log(`      Changed At: ${log.createdAt}`);
        console.log(`      Changed By: ${log.user?.name || 'System'} (${log.user?.email || 'N/A'})`);
      });
    }

  } catch (error) {
    console.error('❌ Error querying service order:', error);
  } finally {
    await prisma.$disconnect();
  }
}

queryServiceOrder();
