import {
  PrismaClient,
  NotificationImportance,
  NotificationChannel,
  SectorPrivileges,
  NotificationType,
  Prisma,
} from '@prisma/client';

/**
 * Task Financial Field Notification Configurations Seed
 *
 * This seed creates notification configurations for FINANCIAL category fields:
 * - task.field.commission: Comissao (commission status)
 * - task.field.budgets: Orcamentos (file array)
 * - task.field.invoices: Notas Fiscais (file array)
 * - task.field.receipts: Comprovantes (file array)
 * - task.field.reimbursements: Reembolsos (file array)
 * - task.field.invoiceReimbursements: NF de Reembolso (file array)
 *
 * RESTRICTED to financial sectors: ADMIN, FINANCIAL, COMMERCIAL
 *
 * Templates are copied from the existing task-notification.config.ts
 * @see /src/modules/common/notification/task-notification.config.ts
 */

interface FileArrayMessageTemplates {
  updated: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
  filesAdded: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
  filesRemoved: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
}

interface SimpleMessageTemplates {
  updated: {
    inApp: string;
    push: string;
    email: { subject: string; body: string };
    whatsapp: string;
  };
}

interface TaskFinancialFieldConfig {
  key: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  isFileArray: boolean;
  templates: FileArrayMessageTemplates | SimpleMessageTemplates;
  channelConfigs: Array<{
    channel: NotificationChannel;
    enabled: boolean;
    mandatory: boolean;
    defaultOn: boolean;
  }>;
  targetRule: {
    allowedSectors: SectorPrivileges[];
  };
  metadata: Record<string, unknown>;
}

/**
 * Allowed sectors for FINANCIAL category (RESTRICTED)
 * From CATEGORY_ALLOWED_ROLES[TaskFieldCategory.FINANCIAL]
 */
const FINANCIAL_ALLOWED_SECTORS: SectorPrivileges[] = ['ADMIN', 'FINANCIAL', 'COMMERCIAL'];

/**
 * Task financial field notification configurations
 */
const taskFinancialFieldConfigs: TaskFinancialFieldConfig[] = [
  // =====================
  // task.field.commission - Comissao
  // =====================
  {
    key: 'task.field.commission',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.commission',
    description: 'Notificacao quando o status de comissao da tarefa e alterado',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: false,
    templates: {
      updated: {
        inApp: 'Status de comissao alterado para "{newValue}"',
        push: 'Comissao: {newValue}',
        email: {
          subject: 'Comissao alterada - Tarefa #{serialNumber}',
          body: 'O status de comissao da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Comissao da tarefa #{serialNumber}: {newValue}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'commission',
      category: 'FINANCIAL',
      formatter: 'formatCommissionStatus',
    },
  },

  // =====================
  // task.field.budgets - Orcamentos (file array)
  // =====================
  {
    key: 'task.field.budgets',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.budgets',
    description: 'Notificacao quando orcamentos sao atualizados, adicionados ou removidos da tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Orcamentos atualizados',
        push: 'Orcamentos atualizados',
        email: {
          subject: 'Orcamentos - Tarefa #{serialNumber}',
          body: 'Os orcamentos da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: 'Orcamentos da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} orcamento(s) adicionado(s)',
        push: 'Novo orcamento',
        email: {
          subject: 'Novo orcamento - Tarefa #{serialNumber}',
          body: '{count} novo(s) orcamento(s) adicionado(s) a tarefa "{taskName}" por {changedBy}.\n\nVerifique os valores e aprove se estiver correto.',
        },
        whatsapp: '{count} orcamento(s) adicionado(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} orcamento(s) removido(s)',
        push: 'Orcamento removido',
        email: {
          subject: 'Orcamento removido - Tarefa #{serialNumber}',
          body: '{count} orcamento(s) removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} orcamento(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'budgets',
      category: 'FINANCIAL',
      isFileArray: true,
    },
  },

  // =====================
  // task.field.invoices - Notas Fiscais (file array)
  // =====================
  {
    key: 'task.field.invoices',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.invoices',
    description: 'Notificacao quando notas fiscais sao atualizadas, adicionadas ou removidas da tarefa - IMPORTANTE para documentacao fiscal',
    importance: 'HIGH',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Notas fiscais atualizadas',
        push: 'NF atualizada',
        email: {
          subject: 'Nota Fiscal - Tarefa #{serialNumber}',
          body: 'As notas fiscais da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: 'Notas fiscais da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} nota(s) fiscal(is) adicionada(s)',
        push: 'Nova NF anexada',
        email: {
          subject: 'Nova Nota Fiscal - Tarefa #{serialNumber}',
          body: '{count} nova(s) nota(s) fiscal(is) adicionada(s) a tarefa "{taskName}" por {changedBy}.\n\nVerifique a documentacao fiscal.',
        },
        whatsapp: '{count} NF(s) adicionada(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} nota(s) fiscal(is) removida(s)',
        push: 'NF removida',
        email: {
          subject: 'NF Removida - Tarefa #{serialNumber}',
          body: '{count} nota(s) fiscal(is) removida(s) da tarefa "{taskName}" por {changedBy}.\n\nVerifique se foi intencional.',
        },
        whatsapp: '{count} NF(s) removida(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'invoices',
      category: 'FINANCIAL',
      isFileArray: true,
    },
  },

  // =====================
  // task.field.receipts - Comprovantes (file array)
  // =====================
  {
    key: 'task.field.receipts',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.receipts',
    description: 'Notificacao quando comprovantes sao atualizados, adicionados ou removidos da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Comprovantes atualizados',
        push: 'Comprovantes atualizados',
        email: {
          subject: 'Comprovantes - Tarefa #{serialNumber}',
          body: 'Os comprovantes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: 'Comprovantes da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} comprovante(s) adicionado(s)',
        push: 'Novo comprovante',
        email: {
          subject: 'Novo comprovante - Tarefa #{serialNumber}',
          body: '{count} novo(s) comprovante(s) adicionado(s) a tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} comprovante(s) adicionado(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} comprovante(s) removido(s)',
        push: 'Comprovante removido',
        email: {
          subject: 'Comprovante removido - Tarefa #{serialNumber}',
          body: '{count} comprovante(s) removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} comprovante(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'receipts',
      category: 'FINANCIAL',
      isFileArray: true,
    },
  },

  // =====================
  // task.field.reimbursements - Reembolsos (file array)
  // =====================
  {
    key: 'task.field.reimbursements',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.reimbursements',
    description: 'Notificacao quando documentos de reembolso sao atualizados, adicionados ou removidos da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'Reembolsos atualizados',
        push: 'Reembolsos atualizados',
        email: {
          subject: 'Reembolsos - Tarefa #{serialNumber}',
          body: 'Os documentos de reembolso da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: 'Reembolsos da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} reembolso(s) adicionado(s)',
        push: 'Novo reembolso',
        email: {
          subject: 'Novo reembolso - Tarefa #{serialNumber}',
          body: '{count} novo(s) documento(s) de reembolso adicionado(s) a tarefa "{taskName}" por {changedBy}.\n\nVerifique para aprovacao.',
        },
        whatsapp: '{count} reembolso(s) adicionado(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} reembolso(s) removido(s)',
        push: 'Reembolso removido',
        email: {
          subject: 'Reembolso removido - Tarefa #{serialNumber}',
          body: '{count} documento(s) de reembolso removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} reembolso(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'reimbursements',
      category: 'FINANCIAL',
      isFileArray: true,
    },
  },

  // =====================
  // task.field.invoiceReimbursements - NF de Reembolso (file array)
  // =====================
  {
    key: 'task.field.invoiceReimbursements',
    notificationType: 'TASK_FIELD_UPDATE',
    eventType: 'field.invoiceReimbursements',
    description: 'Notificacao quando notas fiscais de reembolso sao atualizadas, adicionadas ou removidas da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    isFileArray: true,
    templates: {
      updated: {
        inApp: 'NFs de reembolso atualizadas',
        push: 'NF reembolso atualizada',
        email: {
          subject: 'NF de Reembolso - Tarefa #{serialNumber}',
          body: 'As notas fiscais de reembolso da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: 'NFs de reembolso da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} NF(s) de reembolso adicionada(s)',
        push: 'Nova NF reembolso',
        email: {
          subject: 'Nova NF de Reembolso - Tarefa #{serialNumber}',
          body: '{count} nova(s) NF(s) de reembolso adicionada(s) a tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} NF(s) de reembolso adicionada(s) a tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} NF(s) de reembolso removida(s)',
        push: 'NF reembolso removida',
        email: {
          subject: 'NF de Reembolso removida - Tarefa #{serialNumber}',
          body: '{count} NF(s) de reembolso removida(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '{count} NF(s) de reembolso removida(s) da tarefa #{serialNumber}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: false, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: FINANCIAL_ALLOWED_SECTORS,
    },
    metadata: {
      field: 'invoiceReimbursements',
      category: 'FINANCIAL',
      isFileArray: true,
    },
  },
];

/**
 * Seeds task financial field notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedTaskFinancialFieldNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding task financial field notification configurations...');

  for (const config of taskFinancialFieldConfigs) {
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
        templates: config.templates as unknown as Prisma.JsonValue,
        metadata: config.metadata as Prisma.JsonValue,
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
          },
        },
      },
      include: {
        channelConfigs: true,
        targetRule: true,
      },
    });

    console.log(
      `  - Created configuration "${config.key}" with ${created.channelConfigs.length} channel configs (isFileArray: ${config.isFileArray})`,
    );
  }

  console.log(
    `Task financial field notification configurations seeded successfully! (${taskFinancialFieldConfigs.length} configurations)`,
  );
}

// Allow running as standalone script
if (require.main === module) {
  const prisma = new PrismaClient();

  seedTaskFinancialFieldNotifications(prisma)
    .then(() => {
      console.log('Done!');
    })
    .catch((error) => {
      console.error('Error seeding task financial field notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
