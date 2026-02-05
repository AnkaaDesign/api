import { PrismaClient } from '@prisma/client';
import { seedAllNotificationConfigurations } from './all-notifications.seed';

/**
 * Main entry point for notification configuration seeds.
 *
 * This file now uses a SINGLE unified seed file (all-notifications.seed.ts)
 * that contains ALL notification configurations for the system.
 *
 * The unified approach ensures:
 * - Single source of truth for all notifications
 * - Easier maintenance and updates
 * - Consistent structure across all notifications
 * - No duplicate or conflicting configurations
 *
 * Total notifications: 70
 * Categories:
 * - Task Lifecycle (3)
 * - Task Status Events (3)
 * - Task Deadlines - Term (6)
 * - Task Deadlines - Forecast (6)
 * - Task Basic Fields (4)
 * - Task Date Fields (5)
 * - Task Assignment Fields (3)
 * - Task Financial Fields (6)
 * - Task Artwork/Production Fields (5)
 * - Task Truck Fields (3)
 * - Task Negotiation Fields (3)
 * - Service Orders (6)
 * - Borrow (2)
 * - Paint (1)
 * - PPE/EPI (4)
 * - Alerts (10)
 */

export { seedAllNotificationConfigurations };

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
