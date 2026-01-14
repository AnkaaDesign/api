import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeServiceOrder() {
  const serviceOrderId = '80701eef-59b4-4625-9feb-e2a53c383b69';

  try {
    console.log(`\n🔍 Analyzing Service Order: ${serviceOrderId}\n`);

    // Query the service order
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

    console.log('\n📅 Timestamp Fields (DATABASE VALUES):');
    console.log(`   createdAt: ${serviceOrder.createdAt}`);
    console.log(`   updatedAt: ${serviceOrder.updatedAt}`);
    console.log(`   startedAt: ${serviceOrder.startedAt} ${serviceOrder.startedAt === null ? '⚠️  NULL' : ''}`);
    console.log(`   approvedAt: ${serviceOrder.approvedAt} ${serviceOrder.approvedAt === null ? '(NULL)' : ''}`);
    console.log(`   finishedAt: ${serviceOrder.finishedAt} ${serviceOrder.finishedAt === null ? '(NULL)' : ''}`);

    console.log('\n👤 User IDs:');
    console.log(`   createdById: ${serviceOrder.createdById}`);
    console.log(`   startedById: ${serviceOrder.startedById} ${serviceOrder.startedById === null ? '⚠️  NULL' : ''}`);
    console.log(`   approvedById: ${serviceOrder.approvedById} ${serviceOrder.approvedById === null ? '(NULL)' : ''}`);
    console.log(`   completedById: ${serviceOrder.completedById} ${serviceOrder.completedById === null ? '(NULL)' : ''}`);

    console.log('\n🔬 PROBLEM DIAGNOSIS:');
    if (serviceOrder.status === 'IN_PROGRESS' && serviceOrder.startedAt === null) {
      console.log('   ❌ ISSUE FOUND: Status is IN_PROGRESS but startedAt is NULL!');
      console.log('   This is why the frontend shows "Data inválida"');
    }

    // Check changelog for this service order
    console.log('\n📜 Complete Changelog History:');
    const changelogs = await prisma.changeLog.findMany({
      where: {
        entityType: 'SERVICE_ORDER',
        entityId: serviceOrderId,
      },
      orderBy: {
        createdAt: 'desc',
      },
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
      console.log(`   Found ${changelogs.length} changelog entries:\n`);
      changelogs.forEach((log, index) => {
        console.log(`   ${index + 1}. ${log.action} - ${log.field || 'FULL_ENTITY'}`);
        console.log(`      Old Value: ${log.oldValue || 'null'}`);
        console.log(`      New Value: ${log.newValue || 'null'}`);
        console.log(`      Changed At: ${log.createdAt}`);
        console.log(`      Changed By: ${log.user?.name || 'System'}`);
        console.log(`      Triggered By: ${log.triggeredBy}`);
        console.log('');
      });
    }

    // Check if there's a status change without corresponding timestamp update
    console.log('\n🔍 Analyzing Status Change Logic:');
    const statusChanges = changelogs.filter(log => log.field === 'status');
    const startedAtChanges = changelogs.filter(log => log.field === 'startedAt');

    console.log(`   Status changes: ${statusChanges.length}`);
    console.log(`   startedAt changes: ${startedAtChanges.length}`);

    if (statusChanges.length > 0 && startedAtChanges.length === 0) {
      console.log('   ⚠️  WARNING: Status was changed but startedAt was never set!');
      console.log('   This indicates a bug in the update logic.');
    }

    statusChanges.forEach((change, index) => {
      console.log(`\n   Status Change #${index + 1}:`);
      console.log(`      From: ${change.oldValue} → To: ${change.newValue}`);
      console.log(`      When: ${change.createdAt}`);
      console.log(`      By: ${change.user?.name || 'System'}`);
    });

    // Raw database query to double-check
    console.log('\n🗃️  Raw Database Query Result:');
    const raw = await prisma.$queryRaw`
      SELECT
        id,
        status,
        "startedAt",
        "startedById",
        "createdAt",
        "updatedAt"
      FROM "ServiceOrder"
      WHERE id = ${serviceOrderId}::uuid
    `;
    console.log(JSON.stringify(raw, null, 2));

  } catch (error) {
    console.error('❌ Error analyzing service order:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeServiceOrder();
