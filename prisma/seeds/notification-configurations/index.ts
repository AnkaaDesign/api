import { PrismaClient } from '@prisma/client';
import { seedTaskLifecycleNotifications } from './task-lifecycle.seed';
import { seedTaskBasicFieldNotifications } from './task-basic-fields.seed';
import { seedTaskDateFieldNotifications } from './task-date-fields.seed';
import { seedTaskAssignmentFieldNotifications } from './task-assignment-fields.seed';
import { seedTaskFinancialFieldNotifications } from './task-financial-fields.seed';
import { seedTaskArtworkProductionFieldNotifications } from './task-artwork-production-fields.seed';
import { seedTaskNegotiationFieldNotifications } from './task-negotiation-fields.seed';
import { seedServiceOrderNotifications } from './service-order.seed';
import { seedAlertNotifications } from './alerts.seed';

export async function seedAllNotificationConfigurations(prisma: PrismaClient): Promise<void> {
  console.log('🔔 Seeding notification configurations...');

  // Clear existing configurations (fresh start)
  await prisma.notificationRule.deleteMany({});
  await prisma.notificationTargetRule.deleteMany({});
  await prisma.notificationSectorOverride.deleteMany({});
  await prisma.notificationChannelConfig.deleteMany({});
  await prisma.notificationConfiguration.deleteMany({});

  console.log('  Cleared existing configurations');

  // Seed in order
  await seedTaskLifecycleNotifications(prisma);
  console.log('  ✓ Task lifecycle notifications');

  await seedTaskBasicFieldNotifications(prisma);
  console.log('  ✓ Task basic field notifications');

  await seedTaskDateFieldNotifications(prisma);
  console.log('  ✓ Task date field notifications');

  await seedTaskAssignmentFieldNotifications(prisma);
  console.log('  ✓ Task assignment field notifications');

  await seedTaskFinancialFieldNotifications(prisma);
  console.log('  ✓ Task financial field notifications');

  await seedTaskArtworkProductionFieldNotifications(prisma);
  console.log('  ✓ Task artwork production field notifications');

  await seedTaskNegotiationFieldNotifications(prisma);
  console.log('  ✓ Task negotiation field notifications');

  await seedServiceOrderNotifications(prisma);
  console.log('  ✓ Service order notifications');

  await seedAlertNotifications(prisma);
  console.log('  ✓ Alert notifications');

  const count = await prisma.notificationConfiguration.count();
  console.log(`✅ Seeded ${count} notification configurations`);
}

// Allow running directly
if (require.main === module) {
  const prisma = new PrismaClient();
  seedAllNotificationConfigurations(prisma)
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
      process.exit(1);
    });
}
