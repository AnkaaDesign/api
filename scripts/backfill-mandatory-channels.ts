/**
 * Backfill mandatoryChannels for existing UserNotificationPreference records
 *
 * This script updates all existing user notification preferences to have proper
 * mandatoryChannels based on the default notification preferences configuration.
 *
 * Run with: npx ts-node scripts/backfill-mandatory-channels.ts
 */

import { PrismaClient, NotificationType, NotificationChannel } from '@prisma/client';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL } from '../src/constants';

const prisma = new PrismaClient();

// Define mandatory channels for each notification type/event
const MANDATORY_CHANNELS_MAP: Record<string, NotificationChannel[]> = {
  // Task notifications with mandatory channels
  'TASK:created': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'TASK:overdue': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'TASK:term': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'TASK:deadline': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'TASK:status': [NotificationChannel.IN_APP, NotificationChannel.PUSH],
  'TASK:completion': [NotificationChannel.IN_APP, NotificationChannel.PUSH],
  'TASK:sectorId': [NotificationChannel.IN_APP, NotificationChannel.PUSH],
  'TASK:artworks': [NotificationChannel.IN_APP, NotificationChannel.PUSH],

  // Service Order notifications - all have same mandatory channels
  'SERVICE_ORDER:completed': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'SERVICE_ORDER:artwork-waiting-approval': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],
  'SERVICE_ORDER:assigned': [
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.WHATSAPP,
  ],

  // All other notifications have no mandatory channels (empty array)
};

async function main() {
  console.log('🚀 Starting backfill of mandatoryChannels...');

  try {
    // Get all user notification preferences
    const preferences = await prisma.userNotificationPreference.findMany({
      select: {
        id: true,
        notificationType: true,
        eventType: true,
        mandatoryChannels: true,
      },
    });

    console.log(`📊 Found ${preferences.length} user notification preferences`);

    let updated = 0;
    let skipped = 0;

    for (const pref of preferences) {
      const key = `${pref.notificationType}:${pref.eventType || ''}`;
      const mandatoryChannels = MANDATORY_CHANNELS_MAP[key] || [];

      // Check if mandatoryChannels are already set correctly
      const currentMandatory = pref.mandatoryChannels || [];
      const isSame =
        mandatoryChannels.length === currentMandatory.length &&
        mandatoryChannels.every(ch => currentMandatory.includes(ch));

      if (isSame) {
        skipped++;
        continue;
      }

      // Update the preference
      await prisma.userNotificationPreference.update({
        where: { id: pref.id },
        data: {
          mandatoryChannels: mandatoryChannels,
        },
      });

      updated++;

      if (updated % 100 === 0) {
        console.log(`✅ Updated ${updated} preferences...`);
      }
    }

    console.log('\\n✨ Backfill completed successfully!');
    console.log(`✅ Updated: ${updated} preferences`);
    console.log(`⏭️  Skipped: ${skipped} preferences (already correct)`);
  } catch (error) {
    console.error('❌ Error during backfill:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
