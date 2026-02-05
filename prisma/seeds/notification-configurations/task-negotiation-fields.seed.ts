import { PrismaClient, NotificationImportance, NotificationChannel, SectorPrivileges, Prisma } from '@prisma/client';

/**
 * Seed data for task negotiation field notification configurations.
 *
 * NEGOTIATION category fields:
 * - task.field.representatives - Representantes (updated, cleared)
 * - task.field.representativeIds - IDs de Representantes (updated, cleared)
 * - task.field.negotiatingWith - Negociando Com (DEPRECATED)
 *
 * All negotiation fields:
 * - Channels: IN_APP (default on), others (default off)
 * - workHoursOnly: true
 * - importance: NORMAL
 * - allowedSectors: [ADMIN, FINANCIAL, COMMERCIAL, LOGISTIC, DESIGNER]
 */

interface ChannelMessages {
  inApp: string;
  push: string;
  email: {
    subject: string;
    body: string;
  };
  whatsapp: string;
}

interface NotificationTemplates {
  updated: ChannelMessages;
  cleared?: ChannelMessages;
}

interface NegotiationFieldConfig {
  key: string;
  eventType: string;
  description: string;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  templates: NotificationTemplates;
  metadata?: Record<string, unknown>;
  allowedSectors: SectorPrivileges[];
}

// Templates from task-notification.config.ts
const NEGOTIATION_FIELD_CONFIGS: NegotiationFieldConfig[] = [
  // representatives - Representantes
  {
    key: 'task.field.representatives',
    eventType: 'task.field.representatives',
    description: 'Notificação quando os representantes da tarefa são alterados',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Representantes atualizados: {newValue}',
        push: 'Representantes: {newValue}',
        email: {
          subject: 'Representantes - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram atualizados para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Representantes da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Representantes removidos',
        push: 'Representantes removidos',
        email: {
          subject: 'Representantes removidos - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram removidos por {changedBy}.',
        },
        whatsapp: 'Representantes da tarefa #{serialNumber} foram removidos.',
      },
    },
    allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'],
  },

  // representativeIds - IDs de Representantes (ID version of representatives)
  {
    key: 'task.field.representativeIds',
    eventType: 'task.field.representativeIds',
    description: 'Notificação quando os IDs de representantes da tarefa são alterados',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Representantes atualizados',
        push: 'Representantes atualizados',
        email: {
          subject: 'Representantes - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: 'Representantes da tarefa #{serialNumber} foram atualizados.',
      },
      cleared: {
        inApp: 'Representantes removidos',
        push: 'Representantes removidos',
        email: {
          subject: 'Representantes removidos - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram removidos por {changedBy}.',
        },
        whatsapp: 'Representantes da tarefa #{serialNumber} foram removidos.',
      },
    },
    allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'],
  },

  // negotiatingWith - Negociando Com (DEPRECATED but kept for historical data)
  {
    key: 'task.field.negotiatingWith',
    eventType: 'task.field.negotiatingWith',
    description: 'Notificação quando o contato de negociação da tarefa é alterado (DEPRECATED - usar representatives)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Contato de negociação atualizado: {newValue}',
        push: 'Negociação: {newValue}',
        email: {
          subject: 'Contato de negociação - Tarefa #{serialNumber}',
          body: 'O contato de negociação da tarefa "{taskName}" foi atualizado para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Negociando tarefa #{serialNumber} com: {newValue}.',
      },
      cleared: {
        inApp: 'Contato de negociação removido',
        push: 'Negociação removida',
        email: {
          subject: 'Contato de negociação removido - Tarefa #{serialNumber}',
          body: 'O contato de negociação da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Contato de negociação da tarefa #{serialNumber} foi removido.',
      },
    },
    metadata: {
      deprecated: true,
      replacedBy: 'representatives',
    },
    allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'],
  },
];

/**
 * Channel configuration for negotiation fields:
 * - IN_APP: enabled by default
 * - PUSH, EMAIL, WHATSAPP: disabled by default
 */
const DEFAULT_CHANNEL_CONFIGS: { channel: NotificationChannel; enabled: boolean; mandatory: boolean; defaultOn: boolean }[] = [
  { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
  { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
];

/**
 * Seeds notification configurations for task negotiation fields.
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskNegotiationFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding task negotiation field notification configurations...');

  for (const config of NEGOTIATION_FIELD_CONFIGS) {
    // Upsert the main notification configuration
    const notificationConfig = await prisma.notificationConfiguration.upsert({
      where: { key: config.key },
      create: {
        key: config.key,
        notificationType: 'TASK',
        eventType: config.eventType,
        description: config.description,
        enabled: true,
        importance: config.importance,
        workHoursOnly: config.workHoursOnly,
        batchingEnabled: false,
        templates: config.templates as unknown as Prisma.JsonValue,
        metadata: (config.metadata ?? null) as Prisma.JsonValue,
      },
      update: {
        notificationType: 'TASK',
        eventType: config.eventType,
        description: config.description,
        importance: config.importance,
        workHoursOnly: config.workHoursOnly,
        templates: config.templates as unknown as Prisma.JsonValue,
        metadata: (config.metadata ?? null) as Prisma.JsonValue,
      },
    });

    console.log(`  Created/updated configuration: ${config.key}`);

    // Upsert channel configurations
    for (const channelConfig of DEFAULT_CHANNEL_CONFIGS) {
      await prisma.notificationChannelConfig.upsert({
        where: {
          configurationId_channel: {
            configurationId: notificationConfig.id,
            channel: channelConfig.channel,
          },
        },
        create: {
          configurationId: notificationConfig.id,
          channel: channelConfig.channel,
          enabled: channelConfig.enabled,
          mandatory: channelConfig.mandatory,
          defaultOn: channelConfig.defaultOn,
        },
        update: {
          enabled: channelConfig.enabled,
          mandatory: channelConfig.mandatory,
          defaultOn: channelConfig.defaultOn,
        },
      });
    }

    console.log(`    - Created/updated ${DEFAULT_CHANNEL_CONFIGS.length} channel configs`);

    // Upsert target rule with allowed sectors
    await prisma.notificationTargetRule.upsert({
      where: {
        configurationId: notificationConfig.id,
      },
      create: {
        configurationId: notificationConfig.id,
        allowedSectors: config.allowedSectors,
        excludeInactive: true,
        excludeOnVacation: true,
      },
      update: {
        allowedSectors: config.allowedSectors,
        excludeInactive: true,
        excludeOnVacation: true,
      },
    });

    console.log(`    - Created/updated target rule with sectors: ${config.allowedSectors.join(', ')}`);
  }

  console.log(`\nSuccessfully seeded ${NEGOTIATION_FIELD_CONFIGS.length} task negotiation field notification configurations.`);
}

// Allow running directly with ts-node or as a module
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskNegotiationFieldNotifications(prisma)
    .then(() => {
      console.log('\nSeed completed successfully.');
    })
    .catch((error) => {
      console.error('Error seeding task negotiation field notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
