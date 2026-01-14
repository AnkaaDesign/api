import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testServiceOrderUpdate() {
  const serviceOrderId = '80701eef-59b4-4625-9feb-e2a53c383b69';

  try {
    console.log(`\n🔧 Testing Service Order Update Logic\n`);

    // Get current state
    const before = await prisma.serviceOrder.findUnique({
      where: { id: serviceOrderId },
    });

    console.log('📊 BEFORE Update:');
    console.log(`   Status: ${before?.status}`);
    console.log(`   startedAt: ${before?.startedAt}`);
    console.log(`   startedById: ${before?.startedById}`);

    // Simulate the update that should happen
    console.log('\n🔄 Performing Update (simulating status change to IN_PROGRESS)...\n');

    const updateData: any = {
      status: 'IN_PROGRESS' as any,
      statusOrder: 2,
      startedAt: new Date(),
      startedById: '6e147421-100f-4789-9e11-ec13efc55812', // Kennedy's user ID
    };

    const after = await prisma.serviceOrder.update({
      where: { id: serviceOrderId },
      data: updateData,
    });

    console.log('✅ AFTER Update:');
    console.log(`   Status: ${after.status}`);
    console.log(`   startedAt: ${after.startedAt}`);
    console.log(`   startedAt ISO: ${after.startedAt?.toISOString()}`);
    console.log(`   startedById: ${after.startedById}`);

    console.log('\n✨ Update successful! The timestamp is now set.');

  } catch (error) {
    console.error('❌ Error testing service order update:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testServiceOrderUpdate();
