import { PrismaClient, NotificationType, NotificationImportance, NotificationChannel, SectorPrivileges, Prisma } from '@prisma/client';

/**
 * Seed data for task date field notification configurations
 *
 * This seeds notification configurations for the DATES category fields:
 * - entryDate: Data de Entrada
 * - term: Prazo (deadline)
 * - forecastDate: Data Prevista
 * - startedAt: Data de Inicio
 * - finishedAt: Data de Conclusao
 *
 * Based on configuration from:
 * @see /src/modules/common/notification/task-notification.config.ts
 */

interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
}

interface MessageTemplates {
  updated: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
  cleared?: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
}

interface NotificationConfigSeed {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  enabled: boolean;
  importance: NotificationImportance;
  metadata: Prisma.InputJsonValue;
  templates: Prisma.InputJsonValue;
  channels: ChannelConfig[];
  allowedSectors: SectorPrivileges[];
}

/**
 * Default allowed sectors for DATES category (fallback)
 */
const DATES_CATEGORY_ROLES: SectorPrivileges[] = [
  'ADMIN',
  'PRODUCTION',
  'FINANCIAL',
  'LOGISTIC',
];

/**
 * Helper to create channel configs with sensible defaults
 */
function createChannelConfigs(defaultChannels: NotificationChannel[]): ChannelConfig[] {
  const allChannels: NotificationChannel[] = ['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP'];

  return allChannels.map((channel) => ({
    channel,
    enabled: true,
    mandatory: false,
    defaultOn: defaultChannels.includes(channel),
  }));
}

/**
 * Task date field notification configurations
 */
const taskDateFieldConfigs: NotificationConfigSeed[] = [
  // =====================
  // task.field.entryDate - Data de Entrada
  // =====================
  {
    key: 'task-field-entry-date',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'task.field.entryDate',
    description: 'Notificacao quando a data de entrada da tarefa e alterada ou removida',
    enabled: true,
    importance: 'NORMAL',
    metadata: {
      formatter: 'formatDate',
      field: 'entryDate',
      category: 'DATES',
      label: 'Data de Entrada',
    },
    templates: {
      updated: {
        inApp: 'Data de entrada definida para {newValue}',
        push: 'Entrada: {newValue}',
        email: {
          subject: 'Data de entrada da tarefa #{serialNumber}',
          body: 'A data de entrada da tarefa "{taskName}" foi definida para {newValue} por {changedBy}.',
        },
        whatsapp: 'Data de entrada da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Data de entrada removida',
        push: 'Data de entrada removida',
        email: {
          subject: 'Data de entrada removida - Tarefa #{serialNumber}',
          body: 'A data de entrada da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Data de entrada da tarefa #{serialNumber} foi removida.',
      },
    },
    channels: createChannelConfigs(['IN_APP']),
    allowedSectors: DATES_CATEGORY_ROLES,
  },

  // =====================
  // task.field.term - Prazo (deadline)
  // =====================
  {
    key: 'task-field-term',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'task.field.term',
    description: 'Notificacao quando o prazo da tarefa e alterado ou removido - IMPORTANTE para planejamento',
    enabled: true,
    importance: 'HIGH', // Deadline change is important
    metadata: {
      formatter: 'formatDate',
      field: 'term',
      category: 'DATES',
      label: 'Prazo',
    },
    templates: {
      updated: {
        inApp: 'Prazo alterado para {newValue}',
        push: 'Novo prazo: {newValue}',
        email: {
          subject: 'Prazo da tarefa #{serialNumber} alterado',
          body: 'ATENCAO: O prazo da tarefa "{taskName}" foi alterado de {oldValue} para {newValue} por {changedBy}.\n\nPor favor, verifique se a nova data e viavel.',
        },
        whatsapp: 'Prazo da tarefa #{serialNumber} alterado para {newValue}. Verifique o cronograma!',
      },
      cleared: {
        inApp: 'Prazo removido',
        push: 'Prazo removido',
        email: {
          subject: 'Prazo removido - Tarefa #{serialNumber}',
          body: 'O prazo da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Prazo da tarefa #{serialNumber} foi removido.',
      },
    },
    channels: createChannelConfigs(['IN_APP', 'PUSH']),
    allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL', 'LOGISTIC'], // From FIELD_ALLOWED_ROLES.term
  },

  // =====================
  // task.field.forecastDate - Data Prevista
  // =====================
  {
    key: 'task-field-forecast-date',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'task.field.forecastDate',
    description: 'Notificacao quando a data prevista de entrega e alterada ou removida',
    enabled: true,
    importance: 'NORMAL',
    metadata: {
      formatter: 'formatDate',
      field: 'forecastDate',
      category: 'DATES',
      label: 'Data Prevista',
    },
    templates: {
      updated: {
        inApp: 'Data prevista alterada para {newValue}',
        push: 'Previsao: {newValue}',
        email: {
          subject: 'Previsao de entrega - Tarefa #{serialNumber}',
          body: 'A data prevista da tarefa "{taskName}" foi alterada para {newValue} por {changedBy}.',
        },
        whatsapp: 'Data prevista da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Data prevista removida',
        push: 'Previsao removida',
        email: {
          subject: 'Previsao removida - Tarefa #{serialNumber}',
          body: 'A data prevista da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Data prevista da tarefa #{serialNumber} foi removida.',
      },
    },
    channels: createChannelConfigs(['IN_APP']),
    allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'], // From FIELD_ALLOWED_ROLES.forecastDate
  },

  // =====================
  // task.field.startedAt - Data de Inicio
  // =====================
  {
    key: 'task-field-started-at',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'task.field.startedAt',
    description: 'Notificacao quando a producao da tarefa e iniciada ou a data de inicio e removida',
    enabled: true,
    importance: 'NORMAL',
    metadata: {
      formatter: 'formatDate',
      field: 'startedAt',
      category: 'DATES',
      label: 'Data de Inicio',
    },
    templates: {
      updated: {
        inApp: 'Producao iniciada em {newValue}',
        push: 'Producao iniciada!',
        email: {
          subject: 'Producao iniciada - Tarefa #{serialNumber}',
          body: 'A producao da tarefa "{taskName}" foi iniciada em {newValue} por {changedBy}.',
        },
        whatsapp: 'Producao da tarefa #{serialNumber} iniciada em {newValue}!',
      },
      cleared: {
        inApp: 'Data de inicio removida',
        push: 'Data de inicio removida',
        email: {
          subject: 'Data de inicio removida - Tarefa #{serialNumber}',
          body: 'A data de inicio da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Data de inicio da tarefa #{serialNumber} foi removida.',
      },
    },
    channels: createChannelConfigs(['IN_APP', 'PUSH']),
    allowedSectors: DATES_CATEGORY_ROLES,
  },

  // =====================
  // task.field.finishedAt - Data de Conclusao
  // =====================
  {
    key: 'task-field-finished-at',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'task.field.finishedAt',
    description: 'Notificacao quando a tarefa e concluida ou reaberta - IMPORTANTE para acompanhamento',
    enabled: true,
    importance: 'HIGH', // Task completion is important
    metadata: {
      formatter: 'formatDate',
      field: 'finishedAt',
      category: 'DATES',
      label: 'Data de Conclusao',
    },
    templates: {
      updated: {
        inApp: 'Tarefa concluida em {newValue}',
        push: 'Tarefa concluida!',
        email: {
          subject: 'Tarefa #{serialNumber} concluida',
          body: 'A tarefa "{taskName}" foi concluida em {newValue} por {changedBy}.\n\nParabens pela conclusao!',
        },
        whatsapp: 'Tarefa #{serialNumber} concluida em {newValue}!',
      },
      cleared: {
        inApp: 'Data de conclusao removida - tarefa reaberta',
        push: 'Tarefa reaberta',
        email: {
          subject: 'Tarefa #{serialNumber} reaberta',
          body: 'A data de conclusao da tarefa "{taskName}" foi removida por {changedBy}. A tarefa esta reaberta.',
        },
        whatsapp: 'Tarefa #{serialNumber} foi reaberta.',
      },
    },
    channels: createChannelConfigs(['IN_APP', 'PUSH']),
    allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL', 'LOGISTIC'], // From FIELD_ALLOWED_ROLES.finishedAt
  },
];

/**
 * Seed task date field notification configurations
 *
 * Creates NotificationConfiguration records with related:
 * - NotificationChannelConfig (channel settings)
 * - NotificationTargetRule (allowed sectors)
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskDateFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding task date field notification configurations...');

  for (const config of taskDateFieldConfigs) {
    // Upsert the main configuration
    const notificationConfig = await prisma.notificationConfiguration.upsert({
      where: {
        key: config.key,
      },
      create: {
        key: config.key,
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: config.enabled,
        importance: config.importance,
        metadata: config.metadata,
        templates: config.templates,
      },
      update: {
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: config.enabled,
        importance: config.importance,
        metadata: config.metadata,
        templates: config.templates,
      },
    });

    // Upsert channel configs
    for (const channelConfig of config.channels) {
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

    const label = (config.metadata as Record<string, unknown>).label as string;
    console.log(`  - ${config.eventType} (${label}) - importance: ${config.importance}`);
  }

  console.log(`\nSeeded ${taskDateFieldConfigs.length} task date field notification configurations.`);
}

// Allow running directly
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskDateFieldNotifications(prisma)
    .then(() => {
      console.log('\nTask date field notification configurations seeded successfully.');
    })
    .catch((error) => {
      console.error('Error seeding task date field notification configurations:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
