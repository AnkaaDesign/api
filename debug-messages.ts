import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking Message table...\n');

  const messages = await prisma.message.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      publishedAt: true,
      startDate: true,
      endDate: true,
      targetingType: true,
      createdAt: true,
    }
  });

  console.log(`Found ${messages.length} messages:\n`);
  messages.forEach(msg => {
    console.log(`ID: ${msg.id}`);
    console.log(`Title: ${msg.title}`);
    console.log(`Status: ${msg.status}`);
    console.log(`Published At: ${msg.publishedAt}`);
    console.log(`Start Date: ${msg.startDate}`);
    console.log(`End Date: ${msg.endDate}`);
    console.log(`Targeting Type: ${msg.targetingType}`);
    console.log(`Created At: ${msg.createdAt}`);
    console.log('---\n');
  });

  console.log('\nChecking MessageView table...\n');
  const views = await prisma.messageView.findMany({
    select: {
      id: true,
      messageId: true,
      userId: true,
      viewedAt: true,
    }
  });

  console.log(`Found ${views.length} message views:\n`);
  views.forEach(view => {
    console.log(`Message ID: ${view.messageId}, User ID: ${view.userId}, Viewed At: ${view.viewedAt}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
