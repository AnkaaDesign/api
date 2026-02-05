import { PrismaClient, NotificationImportance, NotificationChannel, SectorPrivileges, NotificationType, Prisma } from '@prisma/client';

/**
 * Task Lifecycle Notification Configurations Seed
 *
 * This seed creates notification configurations for task lifecycle events:
 * - task.created: New task creation notifications
 * - task.overdue: Overdue task urgent notifications
 * - task.deadline_approaching: Deadline approaching warnings
 *
 * Templates are copied from the existing task-notification.config.ts
 */

interface TaskLifecycleConfig {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  maxFrequencyPerDay?: number;
  templates: {
    updated: {
      inApp: string;
      push: string;
      email: {
        subject: string;
        body: string;
      };
      whatsapp: string;
    };
  };
  channelConfigs: Array<{
    channel: NotificationChannel;
    enabled: boolean;
    mandatory: boolean;
    defaultOn: boolean;
  }>;
  targetRule: {
    allowedSectors: SectorPrivileges[];
    customFilter?: string;
  };
}

const taskLifecycleConfigs: TaskLifecycleConfig[] = [
  // =====================
  // task.created
  // =====================
  {
    key: 'task.created',
    notificationType: 'TASK',
    eventType: 'created',
    description: 'Notificação enviada quando uma nova tarefa é criada no sistema',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Nova tarefa criada: "{taskName}"',
        push: 'Nova tarefa criada',
        email: {
          subject: 'Nova tarefa criada: {taskName}',
          body: 'Uma nova tarefa foi criada:\n\nNome: {taskName}\nNúmero de Série: {serialNumber}\nCriada por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Nova tarefa criada: "{taskName}" por {changedBy}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL'],
    },
  },

  // =====================
  // task.overdue
  // =====================
  {
    key: 'task.overdue',
    notificationType: 'TASK',
    eventType: 'overdue',
    description: 'Notificação urgente enviada quando uma tarefa está atrasada',
    importance: 'URGENT',
    workHoursOnly: false, // Urgent sends anytime
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: 'Tarefa atrasada: "{taskName}" está atrasada há {daysOverdue} dia(s)',
        push: 'Tarefa atrasada!',
        email: {
          subject: 'URGENTE: Tarefa #{serialNumber} atrasada',
          body: 'ATENÇÃO: A tarefa "{taskName}" está atrasada há {daysOverdue} dia(s).\n\nÉ necessário tomar uma ação imediata para resolver esta situação.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'URGENTE: Tarefa #{serialNumber} "{taskName}" está atrasada há {daysOverdue} dia(s)!',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: true },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL'],
    },
  },

  // =====================
  // task.deadline_approaching
  // =====================
  {
    key: 'task.deadline_approaching',
    notificationType: 'TASK',
    eventType: 'deadline_approaching',
    description: 'Notificação enviada quando o prazo de uma tarefa está se aproximando',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Prazo se aproximando: "{taskName}" vence em {daysRemaining} dia(s)',
        push: 'Prazo se aproximando!',
        email: {
          subject: 'Prazo se aproximando - Tarefa #{serialNumber}',
          body: 'ATENÇÃO: O prazo da tarefa "{taskName}" está se aproximando.\n\nVence em: {daysRemaining} dia(s)\nPrazo: {term}\n\nVerifique se a tarefa está em andamento e tome as providências necessárias.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Prazo se aproximando: Tarefa #{serialNumber} "{taskName}" vence em {daysRemaining} dia(s)!',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC', 'COMMERCIAL'],
      customFilter: 'TASK_ASSIGNEE', // Only notify assigned user
    },
  },
];

/**
 * Seeds task lifecycle notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskLifecycleNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding task lifecycle notification configurations...');

  for (const config of taskLifecycleConfigs) {
    // Check if configuration already exists
    const existing = await prisma.notificationConfiguration.findUnique({
      where: { key: config.key },
    });

    if (existing) {
      console.log(`  - Configuration "${config.key}" already exists, skipping...`);
      continue;
    }

    // Create the notification configuration with nested relations
    const created = await prisma.notificationConfiguration.create({
      data: {
        key: config.key,
        notificationType: config.notificationType,
        eventType: config.eventType,
        description: config.description,
        enabled: true,
        importance: config.importance,
        workHoursOnly: config.workHoursOnly,
        batchingEnabled: false,
        maxFrequencyPerDay: config.maxFrequencyPerDay ?? null,
        templates: config.templates as Prisma.JsonValue,
        channelConfigs: {
          create: config.channelConfigs.map((channelConfig) => ({
            channel: channelConfig.channel,
            enabled: channelConfig.enabled,
            mandatory: channelConfig.mandatory,
            defaultOn: channelConfig.defaultOn,
          })),
        },
        targetRule: {
          create: {
            allowedSectors: config.targetRule.allowedSectors,
            excludeInactive: true,
            excludeOnVacation: true,
            customFilter: config.targetRule.customFilter ?? null,
          },
        },
      },
      include: {
        channelConfigs: true,
        targetRule: true,
      },
    });

    console.log(`  - Created configuration "${config.key}" with ${created.channelConfigs.length} channel configs`);
  }

  console.log('Task lifecycle notification configurations seeded successfully!');
}

// Allow running as standalone script
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskLifecycleNotifications(prisma)
    .then(() => {
      console.log('Done!');
    })
    .catch((error) => {
      console.error('Error seeding task lifecycle notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
