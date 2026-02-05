import { PrismaClient, NotificationType, NotificationImportance, NotificationChannel, SectorPrivileges, Prisma } from '@prisma/client';

/**
 * Seed data for Task Basic Field Notifications
 *
 * This seed creates NotificationConfiguration entries for BASIC category task fields:
 * - name: Task name changes
 * - status: Task status changes
 * - details: Task details updates
 * - serialNumber: Task serial number changes
 *
 * Configurations are based on TASK_FIELD_NOTIFICATIONS from task-notification.config.ts
 * with FIELD_ALLOWED_ROLES falling back to CATEGORY_ALLOWED_ROLES for BASIC category.
 */

// BASIC category allowed roles from task-notification.config.ts
const BASIC_CATEGORY_ALLOWED_ROLES: SectorPrivileges[] = [
  'ADMIN',
  'PRODUCTION',
  'FINANCIAL',
  'DESIGNER',
  'LOGISTIC',
];

interface EmailTemplate {
  subject: string;
  body: string;
}

interface ChannelTemplates {
  inApp: string;
  push: string;
  email: EmailTemplate;
  whatsapp: string;
}

interface Templates {
  updated: ChannelTemplates;
  cleared?: ChannelTemplates;
}

interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
}

interface TargetRule {
  allowedSectors: SectorPrivileges[];
  excludeInactive: boolean;
  excludeOnVacation: boolean;
}

interface NotificationConfigData {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  enabled: boolean;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  templates: Templates;
  channelConfigs: ChannelConfig[];
  targetRule: TargetRule;
}

/**
 * Task Basic Field Notification Configurations
 *
 * Based on TASK_FIELD_NOTIFICATIONS from task-notification.config.ts
 */
const TASK_BASIC_FIELD_CONFIGS: NotificationConfigData[] = [
  // =====================
  // NAME FIELD
  // =====================
  {
    key: 'task.field.name',
    notificationType: 'TASK',
    eventType: 'name',
    description: 'Nome',
    enabled: true,
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Nome da tarefa alterado de {oldValue} para {newValue}',
        push: 'Tarefa renomeada: {newValue}',
        email: {
          subject: 'Alteracao no nome da tarefa #{serialNumber}',
          body: 'O nome da tarefa foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.',
        },
        whatsapp: 'A tarefa #{serialNumber} foi renomeada de *{oldValue}* para *{newValue}*.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: BASIC_CATEGORY_ALLOWED_ROLES,
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },

  // =====================
  // STATUS FIELD
  // =====================
  {
    key: 'task.field.status',
    notificationType: 'TASK',
    eventType: 'status',
    description: 'Status',
    enabled: true,
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Status alterado de {oldValue} para {newValue}',
        push: 'Status: {newValue}',
        email: {
          subject: 'Status da tarefa #{serialNumber} alterado',
          body: 'O status da tarefa <strong>{taskName}</strong> foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'A tarefa #{serialNumber} mudou de *{oldValue}* para *{newValue}*.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: BASIC_CATEGORY_ALLOWED_ROLES,
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },

  // =====================
  // DETAILS FIELD
  // =====================
  {
    key: 'task.field.details',
    notificationType: 'TASK',
    eventType: 'details',
    description: 'Detalhes',
    enabled: true,
    importance: 'LOW',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Detalhes da tarefa foram atualizados',
        push: 'Detalhes atualizados',
        email: {
          subject: 'Detalhes da tarefa #{serialNumber} atualizados',
          body: 'Os detalhes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: 'Os detalhes da tarefa #{serialNumber} foram atualizados.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: BASIC_CATEGORY_ALLOWED_ROLES,
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },

  // =====================
  // SERIAL NUMBER FIELD
  // =====================
  {
    key: 'task.field.serialNumber',
    notificationType: 'TASK',
    eventType: 'serialNumber',
    description: 'Numero de Serie',
    enabled: true,
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Numero de serie alterado para: {newValue}',
        push: 'Numero de serie: {newValue}',
        email: {
          subject: 'Numero de serie da tarefa alterado',
          body: 'O numero de serie da tarefa <strong>{taskName}</strong> foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.',
        },
        whatsapp: 'Numero de serie alterado para: *{newValue}*',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: BASIC_CATEGORY_ALLOWED_ROLES,
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },
];

/**
 * Seeds Task Basic Field Notification Configurations
 *
 * Creates or updates NotificationConfiguration entries for BASIC category fields:
 * - task.field.name
 * - task.field.status
 * - task.field.details
 * - task.field.serialNumber
 *
 * Each configuration includes:
 * - Channel configurations (IN_APP, PUSH, EMAIL, WHATSAPP)
 * - Target rules with allowed sectors based on CATEGORY_ALLOWED_ROLES
 * - Message templates for 'updated' event type
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskBasicFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding Task Basic Field Notification Configurations...\n');

  for (const config of TASK_BASIC_FIELD_CONFIGS) {
    console.log(`  Processing: ${config.key}`);

    // Upsert the main NotificationConfiguration
    const notificationConfig = await prisma.notificationConfiguration.upsert({
      where: { key: config.key },
      create: {
        key: config.key,
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: config.enabled,
        importance: config.importance,
        workHoursOnly: config.workHoursOnly,
        templates: config.templates as unknown as Prisma.JsonValue,
      },
      update: {
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: config.enabled,
        importance: config.importance,
        workHoursOnly: config.workHoursOnly,
        templates: config.templates as unknown as Prisma.JsonValue,
      },
    });

    // Delete existing channel configs and recreate
    await prisma.notificationChannelConfig.deleteMany({
      where: { configurationId: notificationConfig.id },
    });

    // Create channel configurations
    for (const channelConfig of config.channelConfigs) {
      await prisma.notificationChannelConfig.create({
        data: {
          configurationId: notificationConfig.id,
          channel: channelConfig.channel,
          enabled: channelConfig.enabled,
          mandatory: channelConfig.mandatory,
          defaultOn: channelConfig.defaultOn,
        },
      });
    }

    // Upsert target rule
    await prisma.notificationTargetRule.upsert({
      where: { configurationId: notificationConfig.id },
      create: {
        configurationId: notificationConfig.id,
        allowedSectors: config.targetRule.allowedSectors,
        excludeInactive: config.targetRule.excludeInactive,
        excludeOnVacation: config.targetRule.excludeOnVacation,
      },
      update: {
        allowedSectors: config.targetRule.allowedSectors,
        excludeInactive: config.targetRule.excludeInactive,
        excludeOnVacation: config.targetRule.excludeOnVacation,
      },
    });

    console.log(`    Created/Updated: ${config.key} (${config.description})`);
  }

  console.log('\nTask Basic Field Notification Configurations seeded successfully!');
  console.log(`  Total configurations: ${TASK_BASIC_FIELD_CONFIGS.length}`);
}

// Allow running directly with: npx ts-node prisma/seeds/notification-configurations/task-basic-fields.seed.ts
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskBasicFieldNotifications(prisma)
    .then(() => {
      console.log('\nSeed completed successfully!');
    })
    .catch((error) => {
      console.error('Error seeding Task Basic Field Notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
