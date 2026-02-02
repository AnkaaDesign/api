import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugTaskSync() {
  const taskId = '8c0cbf49-5ffa-43c4-a868-7cf4d266a9a2';

  console.log('\n=== TASK SYNC DIAGNOSTIC ===\n');

  // Get task with all service orders
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      serviceOrders: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!task) {
    console.error(`❌ Task ${taskId} not found`);
    return;
  }

  console.log(`📋 Task: ${task.code}`);
  console.log(`📊 Current Status: ${task.status}`);
  console.log(`📅 Created: ${task.createdAt}`);
  console.log(`\n--- Service Orders ---\n`);

  const artworkSOs = task.serviceOrders.filter(so => so.type === 'ARTWORK');
  const productionSOs = task.serviceOrders.filter(so => so.type === 'PRODUCTION');

  console.log(`🎨 ARTWORK Service Orders (${artworkSOs.length}):`);
  artworkSOs.forEach(so => {
    console.log(`  - ${so.description}: ${so.status} (ID: ${so.id})`);
  });

  console.log(`\n🏭 PRODUCTION Service Orders (${productionSOs.length}):`);
  productionSOs.forEach(so => {
    console.log(`  - ${so.description}: ${so.status} (ID: ${so.id})`);
  });

  // Check what SHOULD happen
  console.log(`\n--- SYNC ANALYSIS ---\n`);

  const allArtworkCompleted = artworkSOs.length > 0 && artworkSOs.every(so => so.status === 'COMPLETED');
  const anyProductionInProgress = productionSOs.some(so => so.status === 'IN_PROGRESS');
  const allProductionCompleted = productionSOs.length > 0 && productionSOs.every(so => so.status === 'COMPLETED');

  console.log(`✓ All ARTWORK completed: ${allArtworkCompleted}`);
  console.log(`✓ Any PRODUCTION in progress: ${anyProductionInProgress}`);
  console.log(`✓ All PRODUCTION completed: ${allProductionCompleted}`);

  console.log(`\n--- EXPECTED BEHAVIOR ---\n`);

  if (task.status === 'PREPARATION' && allArtworkCompleted) {
    console.log(`⚠️  Task should be: WAITING_PRODUCTION`);
    console.log(`   Reason: All artwork service orders are COMPLETED`);
  } else if (task.status === 'WAITING_PRODUCTION' && anyProductionInProgress) {
    console.log(`⚠️  Task should be: IN_PRODUCTION`);
    console.log(`   Reason: At least one production service order is IN_PROGRESS`);
  } else if ((task.status === 'IN_PRODUCTION' || task.status === 'WAITING_PRODUCTION') && allProductionCompleted) {
    console.log(`⚠️  Task should be: COMPLETED`);
    console.log(`   Reason: All production service orders are COMPLETED`);
  } else {
    console.log(`✅ Task status appears correct for current service order states`);
  }

  // Check changelog for automatic updates
  console.log(`\n--- RECENT CHANGELOG ENTRIES ---\n`);

  const recentChanges = await prisma.changeLog.findMany({
    where: {
      entityType: 'TASK',
      entityId: taskId,
      field: 'status',
    },
    orderBy: { timestamp: 'desc' },
    take: 5,
    include: {
      user: {
        select: { name: true, email: true },
      },
    },
  });

  if (recentChanges.length === 0) {
    console.log('❌ No status changes found in changelog');
  } else {
    recentChanges.forEach(change => {
      console.log(`📝 ${change.timestamp.toISOString()}`);
      console.log(`   ${change.oldValue} → ${change.newValue}`);
      console.log(`   Triggered by: ${change.triggeredBy}`);
      console.log(`   Reason: ${change.reason || 'N/A'}`);
      console.log(`   User: ${change.user?.name || 'Unknown'}`);
      console.log('');
    });
  }

  // Check service order changelog
  console.log(`--- RECENT SERVICE ORDER CHANGES ---\n`);

  const soChanges = await prisma.changeLog.findMany({
    where: {
      entityType: 'SERVICE_ORDER',
      entityId: { in: task.serviceOrders.map(so => so.id) },
      field: 'status',
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
    include: {
      user: {
        select: { name: true, email: true },
      },
    },
  });

  if (soChanges.length === 0) {
    console.log('❌ No service order status changes found');
  } else {
    for (const change of soChanges) {
      const so = task.serviceOrders.find(s => s.id === change.entityId);
      console.log(`📝 ${change.timestamp.toISOString()}`);
      console.log(`   SO: ${so?.description || change.entityId}`);
      console.log(`   ${change.oldValue} → ${change.newValue}`);
      console.log(`   User: ${change.user?.name || 'Unknown'}`);
      console.log('');
    }
  }

  console.log('=== END DIAGNOSTIC ===\n');
}

debugTaskSync()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
