import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedNotificationPreferences() {
  const users = await prisma.user.findMany();

  const defaultPreferences = [
    // Mandatory task notifications
    { type: 'TASK', eventType: 'status', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'], mandatory: true },
    { type: 'TASK', eventType: 'deadline', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH', 'WHATSAPP'], mandatory: true },
    { type: 'TASK', eventType: 'assignment', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'], mandatory: true },
    { type: 'TASK', eventType: 'artwork', channels: ['IN_APP', 'EMAIL'], mandatory: true },
    { type: 'TASK', eventType: 'budget', channels: ['IN_APP', 'EMAIL'], mandatory: true },
    { type: 'TASK', eventType: 'invoice', channels: ['IN_APP', 'EMAIL'], mandatory: true },
    { type: 'TASK', eventType: 'term', channels: ['IN_APP', 'EMAIL', 'MOBILE_PUSH'], mandatory: true },
    { type: 'TASK', eventType: 'forecast', channels: ['IN_APP', 'EMAIL'], mandatory: true },

    // Optional order notifications
    { type: 'ORDER', eventType: 'created', channels: ['IN_APP'], mandatory: false },
    { type: 'ORDER', eventType: 'status', channels: ['IN_APP', 'EMAIL'], mandatory: false },
    { type: 'ORDER', eventType: 'overdue', channels: ['IN_APP', 'EMAIL', 'WHATSAPP'], mandatory: false },

    // Optional stock notifications
    { type: 'STOCK', eventType: 'low', channels: ['IN_APP', 'EMAIL'], mandatory: false },
    { type: 'STOCK', eventType: 'out', channels: ['IN_APP', 'EMAIL', 'WHATSAPP'], mandatory: false },
  ];

  for (const user of users) {
    for (const pref of defaultPreferences) {
      await prisma.userNotificationPreference.upsert({
        where: {
          userId_notificationType_eventType: {
            userId: user.id,
            notificationType: pref.type,
            eventType: pref.eventType,
          },
        },
        create: {
          userId: user.id,
          notificationType: pref.type,
          eventType: pref.eventType,
          channels: pref.channels,
          isMandatory: pref.mandatory,
          enabled: true,
        },
        update: {},
      });
    }
  }

  console.log(`Seeded preferences for ${users.length} users`);
}

seedNotificationPreferences()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
