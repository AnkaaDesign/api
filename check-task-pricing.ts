import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTask() {
  // First check if task exists at all
  const taskExists = await prisma.task.findUnique({
    where: { id: '9872a276-9211-46db-aa54-6749d81b6221' }
  });

  if (!taskExists) {
    console.log('========================================');
    console.log('TASK NOT FOUND IN DATABASE');
    console.log('ID:', '9872a276-9211-46db-aa54-6749d81b6221');
    console.log('========================================');
    await prisma.$disconnect();
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: '9872a276-9211-46db-aa54-6749d81b6221' },
    include: {
      pricing: {
        include: {
          items: true
        }
      }
    }
  });

  console.log('========================================');
  console.log('Task Found:', 'YES');
  console.log('Task ID:', task?.id);
  console.log('========================================');
  console.log('Has Pricing:', task?.pricing ? 'YES' : 'NO');

  // Also check ALL recent pricing records
  console.log('\n========================================');
  console.log('RECENT PRICING RECORDS (last 10):');
  console.log('========================================');

  const recentPricing = await prisma.taskPricing.findMany({
    take: 10,
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      task: {
        select: {
          id: true,
          name: true,
          serialNumber: true
        }
      },
      items: true
    }
  });

  if (recentPricing.length === 0) {
    console.log('NO PRICING RECORDS FOUND IN DATABASE');
  } else {
    recentPricing.forEach((pricing, index) => {
      console.log(`\n${index + 1}. Pricing ID: ${pricing.id}`);
      console.log(`   Task ID: ${pricing.taskId}`);
      console.log(`   Task Name: ${pricing.task?.name || 'N/A'}`);
      console.log(`   Serial: ${pricing.task?.serialNumber || 'N/A'}`);
      console.log(`   Total: ${pricing.total}`);
      console.log(`   Status: ${pricing.status}`);
      console.log(`   Items: ${pricing.items.length}`);
      console.log(`   Created: ${pricing.createdAt}`);
    });
  }
  console.log('========================================');

  if (task?.pricing) {
    console.log('Pricing ID:', task.pricing.id);
    console.log('Pricing Total:', task.pricing.total);
    console.log('Pricing Status:', task.pricing.status);
    console.log('Pricing Expires At:', task.pricing.expiresAt);
    console.log('Pricing Items Count:', task.pricing.items?.length || 0);
    console.log('========================================');
    console.log('Full Pricing Data:');
    console.log(JSON.stringify(task.pricing, null, 2));
  } else {
    console.log('NO PRICING DATA FOUND FOR THIS TASK');
  }
  console.log('========================================');

  await prisma.$disconnect();
}

checkTask().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
