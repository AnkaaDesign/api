import { PrismaClient, NotificationImportance, NotificationChannel, SectorPrivileges, NotificationType, Prisma } from '@prisma/client';

/**
 * Service Order Notification Configurations Seed
 *
 * This seed creates notification configurations for service order events:
 * - service_order.created: New service order creation notifications
 * - service_order.assigned: Service order assignment notifications
 * - service_order.started: Service order started (in progress) notifications
 * - service_order.completed: Service order completed notifications
 * - service_order.approved: Service order approved notifications
 * - service_order.cancelled: Service order cancelled notifications
 *
 * Templates are in Portuguese (pt-BR).
 */

interface ServiceOrderConfig {
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

const serviceOrderConfigs: ServiceOrderConfig[] = [
  // =====================
  // service_order.created
  // =====================
  {
    key: 'service_order.created',
    notificationType: 'SERVICE_ORDER',
    eventType: 'created',
    description: 'Notificacao enviada quando uma nova ordem de servico e criada no sistema',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} criada para a tarefa "{taskName}"',
        push: 'OS #{id}: Nova ordem de servico criada',
        email: {
          subject: 'Nova Ordem de Servico #{id} Criada',
          body: 'Uma nova ordem de servico foi criada:\n\nOS: #{id}\nTarefa: {taskName}\nTipo: {type}\nDescricao: {description}\nCriada por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Nova OS #{id} criada para tarefa "{taskName}". Tipo: {type}. Criada por {changedBy}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },

  // =====================
  // service_order.assigned
  // =====================
  {
    key: 'service_order.assigned',
    notificationType: 'SERVICE_ORDER',
    eventType: 'assigned',
    description: 'Notificacao enviada quando uma ordem de servico e atribuida a um usuario',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} atribuida a {assignedTo}: "{description}"',
        push: 'OS #{id}: Voce foi atribuido a uma ordem de servico',
        email: {
          subject: 'Ordem de Servico #{id} Atribuida a Voce',
          body: 'Uma ordem de servico foi atribuida a voce:\n\nOS: #{id}\nDescricao: {description}\nAtribuido por: {assignedBy}\nAtribuido para: {assignedTo}\n\nPor favor, verifique os detalhes e inicie o trabalho assim que possivel.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'OS #{id} atribuida a {assignedTo} por {assignedBy}. Descricao: {description}',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'MAINTENANCE', 'WAREHOUSE', 'PLOTTING', 'HUMAN_RESOURCES', 'FINANCIAL', 'LOGISTIC', 'COMMERCIAL', 'DESIGNER'],
      customFilter: 'SERVICE_ORDER_ASSIGNEE',
    },
  },

  // =====================
  // service_order.started
  // =====================
  {
    key: 'service_order.started',
    notificationType: 'SERVICE_ORDER',
    eventType: 'started',
    description: 'Notificacao enviada quando uma ordem de servico e iniciada (em andamento)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} iniciada: "{description}"',
        push: 'OS #{id}: Ordem de servico iniciada',
        email: {
          subject: 'Ordem de Servico #{id} Iniciada',
          body: 'A ordem de servico foi iniciada:\n\nOS: #{id}\nDescricao: {description}\nIniciada por: {changedBy}\nData de inicio: {startedAt}\n\nAcesse o sistema para acompanhar o progresso.',
        },
        whatsapp: 'OS #{id} iniciada: "{description}". Iniciada por {changedBy}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },

  // =====================
  // service_order.completed
  // =====================
  {
    key: 'service_order.completed',
    notificationType: 'SERVICE_ORDER',
    eventType: 'completed',
    description: 'Notificacao enviada quando uma ordem de servico e concluida',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} concluida: "{description}"',
        push: 'OS #{id}: Ordem de servico concluida',
        email: {
          subject: 'Ordem de Servico #{id} Concluida',
          body: 'A ordem de servico foi concluida:\n\nOS: #{id}\nDescricao: {description}\nConcluida por: {changedBy}\nData de conclusao: {completedAt}\n\nAcesse o sistema para revisar os detalhes.',
        },
        whatsapp: 'OS #{id} concluida: "{description}". Concluida por {changedBy}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL'],
    },
  },

  // =====================
  // service_order.approved
  // =====================
  {
    key: 'service_order.approved',
    notificationType: 'SERVICE_ORDER',
    eventType: 'approved',
    description: 'Notificacao enviada quando uma ordem de servico e aprovada',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} aprovada: "{description}"',
        push: 'OS #{id}: Ordem de servico aprovada',
        email: {
          subject: 'Ordem de Servico #{id} Aprovada',
          body: 'A ordem de servico foi aprovada:\n\nOS: #{id}\nDescricao: {description}\nAprovada por: {changedBy}\nData de aprovacao: {approvedAt}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'OS #{id} aprovada: "{description}". Aprovada por {changedBy}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },

  // =====================
  // service_order.cancelled
  // =====================
  {
    key: 'service_order.cancelled',
    notificationType: 'SERVICE_ORDER',
    eventType: 'cancelled',
    description: 'Notificacao enviada quando uma ordem de servico e cancelada',
    importance: 'HIGH',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} cancelada: "{description}"',
        push: 'OS #{id}: Ordem de servico cancelada',
        email: {
          subject: 'Ordem de Servico #{id} Cancelada',
          body: 'A ordem de servico foi cancelada:\n\nOS: #{id}\nDescricao: {description}\nCancelada por: {changedBy}\nMotivo: {cancellationReason}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'OS #{id} cancelada: "{description}". Cancelada por {changedBy}. Motivo: {cancellationReason}',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },
];

/**
 * Seeds service order notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedServiceOrderNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding service order notification configurations...');

  for (const config of serviceOrderConfigs) {
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

  console.log('Service order notification configurations seeded successfully!');
}

// Allow running as standalone script
if (require.main === module) {
  const prisma = new PrismaClient();

  seedServiceOrderNotifications(prisma)
    .then(() => {
      console.log('Done!');
    })
    .catch((error) => {
      console.error('Error seeding service order notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
