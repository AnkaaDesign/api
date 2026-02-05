import { PrismaClient, NotificationImportance, NotificationChannel, SectorPrivileges, NotificationType, Prisma } from '@prisma/client';

/**
 * Task Artwork and Production Field Notification Configurations Seed
 *
 * This seed creates notification configurations for task artwork and production fields:
 *
 * ARTWORK category:
 * - task.field.artworks: Artwork files notifications (HIGH importance)
 * - task.field.baseFiles: Base files notifications (NORMAL importance)
 *
 * PRODUCTION category:
 * - task.field.paintId: Paint selection notifications (NORMAL importance)
 * - task.field.logoPaints: Logo paint colors notifications (NORMAL importance)
 * - task.field.observation: Production observations (LOW importance, IN_APP only)
 *
 * Templates are based on the existing task-notification.config.ts
 */

interface TaskFieldConfig {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  isFileArray: boolean;
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
    cleared?: {
      inApp: string;
      push: string;
      email: {
        subject: string;
        body: string;
      };
      whatsapp: string;
    };
    filesAdded?: {
      inApp: string;
      push: string;
      email: {
        subject: string;
        body: string;
      };
      whatsapp: string;
    };
    filesRemoved?: {
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
  metadata?: Record<string, unknown>;
}

const taskArtworkProductionFieldConfigs: TaskFieldConfig[] = [
  // =====================
  // ARTWORK CATEGORY
  // =====================

  // task.field.artworks (HIGH importance, file array)
  {
    key: 'task.field.artworks',
    notificationType: 'TASK',
    eventType: 'field.artworks',
    description: 'Notificacao enviada quando as artes de uma tarefa sao atualizadas, adicionadas ou removidas',
    importance: 'HIGH',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Artes atualizadas',
        push: 'Artes atualizadas',
        email: {
          subject: 'Artes - Tarefa #{serialNumber}',
          body: 'As artes da tarefa "{taskName}" foram atualizadas por {changedBy}.\n\nVerifique os novos arquivos.',
        },
        whatsapp: 'Artes da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} arte(s) adicionada(s)',
        push: 'Nova arte anexada',
        email: {
          subject: 'Nova arte - Tarefa #{serialNumber}',
          body: '{count} nova(s) arte(s) adicionada(s) a tarefa "{taskName}" por {changedBy}.\n\nVerifique as artes para aprovacao ou inicio da producao.',
        },
        whatsapp: '{count} arte(s) adicionada(s) a tarefa #{serialNumber}. Verifique!',
      },
      filesRemoved: {
        inApp: '{count} arte(s) removida(s)',
        push: 'Arte removida',
        email: {
          subject: 'Arte removida - Tarefa #{serialNumber}',
          body: '{count} arte(s) removida(s) da tarefa "{taskName}" por {changedBy}.\n\nVerifique se ainda existem artes validas para producao.',
        },
        whatsapp: '{count} arte(s) removida(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER', 'COMMERCIAL'],
    },
    metadata: {
      category: 'ARTWORK',
      isFileArray: true,
      fieldLabel: 'Artes',
    },
  },

  // task.field.baseFiles (NORMAL importance, file array)
  {
    key: 'task.field.baseFiles',
    notificationType: 'TASK',
    eventType: 'field.baseFiles',
    description: 'Notificacao enviada quando os arquivos base de uma tarefa sao atualizados, adicionados ou removidos',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Arquivos base atualizados',
        push: 'Arquivos base atualizados',
        email: {
          subject: 'Arquivos Base - Tarefa #{serialNumber}',
          body: 'Os arquivos base da tarefa "{taskName}" foram atualizados por {changedBy}.\n\nVerifique os novos arquivos.',
        },
        whatsapp: 'Arquivos base da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} arquivo(s) base adicionado(s)',
        push: 'Novo arquivo base',
        email: {
          subject: 'Novo arquivo base - Tarefa #{serialNumber}',
          body: '{count} novo(s) arquivo(s) base adicionado(s) a tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} arquivo(s) base adicionado(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} arquivo(s) base removido(s)',
        push: 'Arquivo base removido',
        email: {
          subject: 'Arquivo base removido - Tarefa #{serialNumber}',
          body: '{count} arquivo(s) base removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} arquivo(s) base removido(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER', 'COMMERCIAL'],
    },
    metadata: {
      category: 'ARTWORK',
      isFileArray: true,
      fieldLabel: 'Arquivos Base',
    },
  },

  // =====================
  // PRODUCTION CATEGORY
  // =====================

  // task.field.paintId (NORMAL importance)
  {
    key: 'task.field.paintId',
    notificationType: 'TASK',
    eventType: 'field.paintId',
    description: 'Notificacao enviada quando a pintura geral de uma tarefa e alterada ou removida',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: false,
    templates: {
      updated: {
        inApp: 'Pintura geral alterada para "{newValue}"',
        push: 'Pintura: {newValue}',
        email: {
          subject: 'Pintura definida - Tarefa #{serialNumber}',
          body: 'A pintura geral da tarefa "{taskName}" foi alterada para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Pintura da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Pintura geral removida',
        push: 'Pintura removida',
        email: {
          subject: 'Pintura removida - Tarefa #{serialNumber}',
          body: 'A pintura geral da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Pintura da tarefa #{serialNumber} foi removida.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'WAREHOUSE'],
    },
    metadata: {
      category: 'PRODUCTION',
      isFileArray: false,
      fieldLabel: 'Pintura Geral',
      formatter: 'formatPaint',
    },
  },

  // task.field.logoPaints (NORMAL importance, file array)
  {
    key: 'task.field.logoPaints',
    notificationType: 'TASK',
    eventType: 'field.logoPaints',
    description: 'Notificacao enviada quando as pinturas do logotipo de uma tarefa sao atualizadas, adicionadas ou removidas',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Pinturas do logotipo atualizadas',
        push: 'Pinturas do logo atualizadas',
        email: {
          subject: 'Pinturas do logotipo - Tarefa #{serialNumber}',
          body: 'As pinturas do logotipo da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: 'Pinturas do logotipo da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} cor(es) de logotipo adicionada(s)',
        push: 'Novas cores de logo',
        email: {
          subject: 'Cores de logotipo adicionadas - Tarefa #{serialNumber}',
          body: '{count} nova(s) cor(es) de logotipo adicionada(s) a tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} cor(es) de logotipo adicionada(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} cor(es) de logotipo removida(s)',
        push: 'Cores de logo removidas',
        email: {
          subject: 'Cores de logotipo removidas - Tarefa #{serialNumber}',
          body: '{count} cor(es) de logotipo removida(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} cor(es) de logotipo removida(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'WAREHOUSE'],
    },
    metadata: {
      category: 'PRODUCTION',
      isFileArray: true,
      fieldLabel: 'Pinturas do Logotipo',
      formatter: 'formatPaints',
    },
  },

  // task.field.observation (LOW importance, IN_APP only)
  {
    key: 'task.field.observation',
    notificationType: 'TASK',
    eventType: 'field.observation',
    description: 'Notificacao enviada quando a observacao de uma tarefa e adicionada ou removida (baixa prioridade, apenas in-app)',
    importance: 'LOW',
    workHoursOnly: true,
    isFileArray: false,
    templates: {
      updated: {
        inApp: 'Nova observacao adicionada a tarefa',
        push: 'Nova observacao',
        email: {
          subject: 'Observacao - Tarefa #{serialNumber}',
          body: 'Uma observacao foi adicionada a tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: 'Nova observacao na tarefa #{serialNumber}.',
      },
      cleared: {
        inApp: 'Observacao removida',
        push: 'Observacao removida',
        email: {
          subject: 'Observacao removida - Tarefa #{serialNumber}',
          body: 'A observacao da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Observacao da tarefa #{serialNumber} foi removida.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: false, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: false, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
    metadata: {
      category: 'PRODUCTION',
      isFileArray: false,
      fieldLabel: 'Observacao',
    },
  },
];

/**
 * Seeds task artwork and production field notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskArtworkProductionFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding task artwork and production field notification configurations...');

  for (const config of taskArtworkProductionFieldConfigs) {
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
        templates: config.templates as Prisma.JsonValue,
        metadata: (config.metadata ?? null) as Prisma.JsonValue,
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

  console.log('Task artwork and production field notification configurations seeded successfully!');
}

// Allow running as standalone script
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskArtworkProductionFieldNotifications(prisma)
    .then(() => {
      console.log('Done!');
    })
    .catch((error) => {
      console.error('Error seeding task artwork and production field notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
