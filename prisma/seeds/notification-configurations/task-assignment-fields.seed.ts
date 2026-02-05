import { PrismaClient, NotificationType, NotificationImportance, NotificationChannel, SectorPrivileges, Prisma } from '@prisma/client';

/**
 * Seed data for task assignment field notifications
 *
 * Creates notification configurations for ASSIGNMENT category fields:
 * - task.field.sectorId (HIGH importance - sector transfer is important)
 * - task.field.customerId (NORMAL importance)
 * - task.field.invoiceToId (NORMAL importance - FINANCIAL category but assignment-related)
 */

// =====================
// Template Definitions
// =====================

/**
 * Templates for sectorId field changes
 * Includes both 'updated' and 'cleared' variants
 */
const sectorIdTemplates = {
  updated: {
    inApp: 'Setor responsável alterado para: {newValue}',
    push: 'Novo setor: {newValue}',
    email: {
      subject: 'Atribuição de setor - Tarefa #{serialNumber}',
      body: 'A tarefa <strong>{taskName}</strong> foi transferida de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.\n\nO novo setor responsável deve verificar os detalhes da tarefa.',
    },
    whatsapp: '🔀 Tarefa #{serialNumber} transferida para o setor *{newValue}*.',
  },
  cleared: {
    inApp: 'Setor responsável removido',
    push: 'Setor removido',
    email: {
      subject: 'Setor removido - Tarefa #{serialNumber}',
      body: 'O setor responsável pela tarefa <strong>{taskName}</strong> foi removido por {changedBy}.',
    },
    whatsapp: '⚠️ Tarefa #{serialNumber} está sem setor responsável.',
  },
};

/**
 * Templates for customerId field changes
 */
const customerIdTemplates = {
  updated: {
    inApp: 'Cliente alterado para: {newValue}',
    push: 'Novo cliente: {newValue}',
    email: {
      subject: 'Cliente alterado - Tarefa #{serialNumber}',
      body: 'O cliente da tarefa <strong>{taskName}</strong> foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.',
    },
    whatsapp: '👤 Cliente da tarefa #{serialNumber} alterado para *{newValue}*.',
  },
  cleared: {
    inApp: 'Cliente removido',
    push: 'Cliente removido',
    email: {
      subject: 'Cliente removido - Tarefa #{serialNumber}',
      body: 'O cliente da tarefa <strong>{taskName}</strong> foi removido por {changedBy}.',
    },
    whatsapp: '⚠️ Cliente da tarefa #{serialNumber} foi removido.',
  },
};

/**
 * Templates for invoiceToId field changes
 */
const invoiceToIdTemplates = {
  updated: {
    inApp: 'Cliente para faturamento alterado para "{newValue}"',
    push: 'Faturar para: {newValue}',
    email: {
      subject: '💰 Cliente de faturamento - Tarefa #{serialNumber}',
      body: 'O cliente de faturamento da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.\n\nVerifique os dados fiscais antes de emitir nota.',
    },
    whatsapp: '💰 Faturar tarefa #{serialNumber} para: {newValue}.',
  },
  cleared: {
    inApp: 'Cliente de faturamento removido',
    push: 'Faturamento removido',
    email: {
      subject: 'Cliente de faturamento removido - Tarefa #{serialNumber}',
      body: 'O cliente de faturamento da tarefa "{taskName}" foi removido por {changedBy}.',
    },
    whatsapp: '⚠️ Cliente de faturamento da tarefa #{serialNumber} foi removido.',
  },
};

// =====================
// Configuration Definitions
// =====================

interface NotificationConfigData {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  enabled: boolean;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  batchingEnabled: boolean;
  templates: Record<string, unknown>;
  metadata: Record<string, unknown>;
  channelConfigs: {
    channel: NotificationChannel;
    enabled: boolean;
    mandatory: boolean;
    defaultOn: boolean;
    minImportance?: NotificationImportance;
  }[];
  targetRule: {
    allowedSectors: SectorPrivileges[];
    excludeInactive: boolean;
    excludeOnVacation: boolean;
  };
  sectorOverrides?: {
    sector: SectorPrivileges;
    channelOverrides: {
      channel: NotificationChannel;
      mandatory: boolean;
    }[];
    importanceOverride?: NotificationImportance;
  }[];
}

/**
 * Category default allowed sectors for ASSIGNMENT fields
 */
const ASSIGNMENT_CATEGORY_ALLOWED_SECTORS: SectorPrivileges[] = [
  SectorPrivileges.ADMIN,
  SectorPrivileges.PRODUCTION,
  SectorPrivileges.FINANCIAL,
  SectorPrivileges.LOGISTIC,
];

/**
 * Task assignment field notification configurations
 */
const taskAssignmentFieldConfigs: NotificationConfigData[] = [
  // =====================
  // 1. task.field.sectorId
  // =====================
  {
    key: 'task.field.sectorId',
    notificationType: NotificationType.TASK,
    eventType: 'field.sectorId',
    description: 'Notificação quando o setor responsável pela tarefa é alterado ou removido',
    enabled: true,
    importance: NotificationImportance.HIGH, // Sector transfer is important
    workHoursOnly: false,
    batchingEnabled: false,
    templates: sectorIdTemplates,
    metadata: {
      category: 'ASSIGNMENT',
      field: 'sectorId',
      label: 'Setor',
      isFileArray: false,
      formatter: 'formatSector',
    },
    channelConfigs: [
      {
        channel: NotificationChannel.IN_APP,
        enabled: true,
        mandatory: false,
        defaultOn: true,
      },
      {
        channel: NotificationChannel.PUSH,
        enabled: true,
        mandatory: false,
        defaultOn: true,
      },
      {
        channel: NotificationChannel.EMAIL,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.HIGH,
      },
      {
        channel: NotificationChannel.WHATSAPP,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.URGENT,
      },
    ],
    targetRule: {
      allowedSectors: [
        SectorPrivileges.ADMIN,
        SectorPrivileges.PRODUCTION,
        SectorPrivileges.FINANCIAL,
        SectorPrivileges.LOGISTIC,
      ],
      excludeInactive: true,
      excludeOnVacation: true,
    },
    // PRODUCTION sector override: channels [IN_APP, PUSH] mandatory
    // They need to know immediately about sector transfers
    sectorOverrides: [
      {
        sector: SectorPrivileges.PRODUCTION,
        channelOverrides: [
          {
            channel: NotificationChannel.IN_APP,
            mandatory: true,
          },
          {
            channel: NotificationChannel.PUSH,
            mandatory: true,
          },
        ],
      },
    ],
  },

  // =====================
  // 2. task.field.customerId
  // =====================
  {
    key: 'task.field.customerId',
    notificationType: NotificationType.TASK,
    eventType: 'field.customerId',
    description: 'Notificação quando o cliente da tarefa é alterado ou removido',
    enabled: true,
    importance: NotificationImportance.NORMAL,
    workHoursOnly: false,
    batchingEnabled: false,
    templates: customerIdTemplates,
    metadata: {
      category: 'ASSIGNMENT',
      field: 'customerId',
      label: 'Cliente',
      isFileArray: false,
      formatter: 'formatCustomer',
    },
    channelConfigs: [
      {
        channel: NotificationChannel.IN_APP,
        enabled: true,
        mandatory: false,
        defaultOn: true,
      },
      {
        channel: NotificationChannel.PUSH,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.HIGH,
      },
      {
        channel: NotificationChannel.EMAIL,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.HIGH,
      },
      {
        channel: NotificationChannel.WHATSAPP,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.URGENT,
      },
    ],
    // Use category default allowed sectors
    targetRule: {
      allowedSectors: ASSIGNMENT_CATEGORY_ALLOWED_SECTORS,
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },

  // =====================
  // 3. task.field.invoiceToId
  // =====================
  {
    key: 'task.field.invoiceToId',
    notificationType: NotificationType.TASK,
    eventType: 'field.invoiceToId',
    description: 'Notificação quando o cliente de faturamento da tarefa é alterado ou removido',
    enabled: true,
    importance: NotificationImportance.NORMAL,
    workHoursOnly: false,
    batchingEnabled: false,
    templates: invoiceToIdTemplates,
    metadata: {
      category: 'FINANCIAL', // FINANCIAL category but assignment-related
      field: 'invoiceToId',
      label: 'Faturar Para',
      isFileArray: false,
      formatter: 'formatCustomer',
    },
    channelConfigs: [
      {
        channel: NotificationChannel.IN_APP,
        enabled: true,
        mandatory: false,
        defaultOn: true,
      },
      {
        channel: NotificationChannel.PUSH,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.HIGH,
      },
      {
        channel: NotificationChannel.EMAIL,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.HIGH,
      },
      {
        channel: NotificationChannel.WHATSAPP,
        enabled: true,
        mandatory: false,
        defaultOn: false,
        minImportance: NotificationImportance.URGENT,
      },
    ],
    // Specific allowed sectors for invoiceToId
    targetRule: {
      allowedSectors: [
        SectorPrivileges.ADMIN,
        SectorPrivileges.FINANCIAL,
        SectorPrivileges.COMMERCIAL,
        SectorPrivileges.LOGISTIC,
        SectorPrivileges.DESIGNER,
      ],
      excludeInactive: true,
      excludeOnVacation: true,
    },
  },
];

// =====================
// Seed Function
// =====================

/**
 * Seeds task assignment field notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskAssignmentFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('🌱 Seeding task assignment field notifications...\n');

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const config of taskAssignmentFieldConfigs) {
    try {
      // Check if configuration already exists
      const existing = await prisma.notificationConfiguration.findUnique({
        where: { key: config.key },
      });

      if (existing) {
        // Update existing configuration
        await prisma.$transaction(async (tx) => {
          // Update main configuration
          await tx.notificationConfiguration.update({
            where: { key: config.key },
            data: {
              notificationType: config.notificationType,
              eventType: config.eventType,
              description: config.description,
              enabled: config.enabled,
              importance: config.importance,
              workHoursOnly: config.workHoursOnly,
              batchingEnabled: config.batchingEnabled,
              templates: config.templates as Prisma.JsonValue,
              metadata: config.metadata as Prisma.JsonValue,
            },
          });

          // Delete existing channel configs and recreate
          await tx.notificationChannelConfig.deleteMany({
            where: { configurationId: existing.id },
          });

          await tx.notificationChannelConfig.createMany({
            data: config.channelConfigs.map((cc) => ({
              configurationId: existing.id,
              channel: cc.channel,
              enabled: cc.enabled,
              mandatory: cc.mandatory,
              defaultOn: cc.defaultOn,
              minImportance: cc.minImportance,
            })),
          });

          // Delete existing target rule and recreate
          await tx.notificationTargetRule.deleteMany({
            where: { configurationId: existing.id },
          });

          await tx.notificationTargetRule.create({
            data: {
              configurationId: existing.id,
              allowedSectors: config.targetRule.allowedSectors,
              excludeInactive: config.targetRule.excludeInactive,
              excludeOnVacation: config.targetRule.excludeOnVacation,
            },
          });

          // Delete existing sector overrides and recreate if present
          await tx.notificationSectorOverride.deleteMany({
            where: { configurationId: existing.id },
          });

          if (config.sectorOverrides && config.sectorOverrides.length > 0) {
            await tx.notificationSectorOverride.createMany({
              data: config.sectorOverrides.map((so) => ({
                configurationId: existing.id,
                sector: so.sector,
                channelOverrides: so.channelOverrides as Prisma.JsonValue,
                importanceOverride: so.importanceOverride,
              })),
            });
          }
        });

        console.log(`   ✓ Updated: ${config.key}`);
        updatedCount++;
      } else {
        // Create new configuration
        await prisma.$transaction(async (tx) => {
          const created = await tx.notificationConfiguration.create({
            data: {
              key: config.key,
              notificationType: config.notificationType,
              eventType: config.eventType,
              description: config.description,
              enabled: config.enabled,
              importance: config.importance,
              workHoursOnly: config.workHoursOnly,
              batchingEnabled: config.batchingEnabled,
              templates: config.templates as Prisma.JsonValue,
              metadata: config.metadata as Prisma.JsonValue,
            },
          });

          // Create channel configs
          await tx.notificationChannelConfig.createMany({
            data: config.channelConfigs.map((cc) => ({
              configurationId: created.id,
              channel: cc.channel,
              enabled: cc.enabled,
              mandatory: cc.mandatory,
              defaultOn: cc.defaultOn,
              minImportance: cc.minImportance,
            })),
          });

          // Create target rule
          await tx.notificationTargetRule.create({
            data: {
              configurationId: created.id,
              allowedSectors: config.targetRule.allowedSectors,
              excludeInactive: config.targetRule.excludeInactive,
              excludeOnVacation: config.targetRule.excludeOnVacation,
            },
          });

          // Create sector overrides if present
          if (config.sectorOverrides && config.sectorOverrides.length > 0) {
            await tx.notificationSectorOverride.createMany({
              data: config.sectorOverrides.map((so) => ({
                configurationId: created.id,
                sector: so.sector,
                channelOverrides: so.channelOverrides as Prisma.JsonValue,
                importanceOverride: so.importanceOverride,
              })),
            });
          }
        });

        console.log(`   ✓ Created: ${config.key}`);
        createdCount++;
      }
    } catch (error) {
      console.error(`   ✗ Error processing ${config.key}:`, error);
      errorCount++;
    }
  }

  console.log('\n📊 Task Assignment Field Notifications Seed Summary:');
  console.log(`   - Created: ${createdCount}`);
  console.log(`   - Updated: ${updatedCount}`);
  console.log(`   - Errors: ${errorCount}`);
  console.log(`   - Total processed: ${taskAssignmentFieldConfigs.length}`);

  if (errorCount === 0) {
    console.log('\n✅ Task assignment field notifications seeded successfully!\n');
  } else {
    console.log('\n⚠️  Task assignment field notifications seeded with some errors.\n');
  }
}

// =====================
// Standalone Execution
// =====================

/**
 * Main function for standalone execution
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    await seedTaskAssignmentFieldNotifications(prisma);
  } catch (error) {
    console.error('❌ Failed to seed task assignment field notifications:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default seedTaskAssignmentFieldNotifications;
