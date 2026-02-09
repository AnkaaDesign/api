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
 * Total notifications: 112+ (including dynamically generated SO configs)
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
 * - Task Truck Fields (8)
 * - Task Negotiation Fields (2)
 * - Service Orders - Type-Specific (41)
 * - Borrow (2)
 * - Paint (1)
 * - PPE/EPI (4)
 * - Alerts (0)
 * - Cut Notifications (5)
 * - Order Notifications (5)
 * - Item/Stock Detail (4)
 * - Artwork Approval (3)
 * - Time Entry Reminders (1)
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
