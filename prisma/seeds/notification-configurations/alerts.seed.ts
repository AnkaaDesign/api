import { PrismaClient, NotificationImportance, NotificationChannel, SectorPrivileges, NotificationType, Prisma } from '@prisma/client';

/**
 * Alert Notification Configurations Seed
 *
 * This seed creates notification configurations for various alert types:
 *
 * Stock Alerts:
 * - alert.stock_out: URGENT - Item out of stock
 * - alert.low_stock: HIGH - Stock below minimum
 * - alert.reorder_needed: HIGH - Reorder point reached
 *
 * Task Alerts:
 * - alert.overdue: HIGH - Task overdue (supplements task.overdue)
 * - alert.customer_complaint: URGENT - Customer complaint received
 *
 * PPE Alerts:
 * - alert.stock_shortage: HIGH - PPE stock shortage
 * - alert.missing_delivery: HIGH - PPE delivery missing
 *
 * Order Alerts:
 * - alert.delivery_delay: HIGH - Order delivery delayed
 *
 * Warning Alerts:
 * - alert.escalation_needed: URGENT - Warning requires escalation
 * - alert.repeat_offender: HIGH - Repeat warning offender detected
 *
 * Templates are in Portuguese (pt-BR) for the target audience.
 */

interface AlertConfig {
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

const alertConfigs: AlertConfig[] = [
  // =====================
  // STOCK ALERTS
  // =====================

  // alert.stock_out - URGENT, all channels mandatory except whatsapp
  {
    key: 'alert.stock_out',
    notificationType: 'STOCK',
    eventType: 'stock_out',
    description: 'Alerta urgente enviado quando um item fica sem estoque',
    importance: 'URGENT',
    workHoursOnly: false, // Urgent sends anytime
    maxFrequencyPerDay: 5,
    templates: {
      updated: {
        inApp: 'ESTOQUE ZERADO: "{itemName}" esta sem estoque!',
        push: 'URGENTE: Item sem estoque!',
        email: {
          subject: 'URGENTE: Estoque zerado - {itemName}',
          body: 'ATENCAO URGENTE!\n\nO item "{itemName}" esta SEM ESTOQUE.\n\nCategoria: {categoryName}\nFornecedor: {supplierName}\nUltima movimentacao: {lastMovementDate}\n\nE necessaria acao imediata para repor este item.\n\nAcesse o sistema para criar um pedido de reposicao.',
        },
        whatsapp: 'URGENTE: O item "{itemName}" esta SEM ESTOQUE! Acesso imediato necessario.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'],
    },
  },

  // alert.low_stock - HIGH, IN_APP + PUSH
  {
    key: 'alert.low_stock',
    notificationType: 'STOCK',
    eventType: 'low_stock',
    description: 'Alerta enviado quando o estoque de um item esta abaixo do minimo',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: 'Estoque baixo: "{itemName}" - {currentQuantity}/{minQuantity} unidades',
        push: 'Estoque baixo: {itemName}',
        email: {
          subject: 'Alerta de estoque baixo - {itemName}',
          body: 'O estoque do item "{itemName}" esta abaixo do minimo.\n\nQuantidade atual: {currentQuantity}\nQuantidade minima: {minQuantity}\nCategoria: {categoryName}\n\nConsidere fazer um pedido de reposicao.',
        },
        whatsapp: 'Estoque baixo: "{itemName}" com {currentQuantity} unidades (minimo: {minQuantity}).',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['WAREHOUSE', 'ADMIN', 'MAINTENANCE'],
    },
  },

  // alert.reorder_needed - HIGH, IN_APP + EMAIL
  {
    key: 'alert.reorder_needed',
    notificationType: 'STOCK',
    eventType: 'reorder_needed',
    description: 'Alerta enviado quando um item atinge o ponto de reposicao',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Reposicao necessaria: "{itemName}" atingiu o ponto de pedido',
        push: 'Reposicao necessaria: {itemName}',
        email: {
          subject: 'Ponto de reposicao atingido - {itemName}',
          body: 'O item "{itemName}" atingiu o ponto de reposicao e precisa ser reposto.\n\nQuantidade atual: {currentQuantity}\nPonto de pedido: {reorderPoint}\nQuantidade sugerida: {suggestedQuantity}\nFornecedor: {supplierName}\n\nAcesse o sistema para criar um pedido de compra.',
        },
        whatsapp: 'Reposicao necessaria: "{itemName}" atingiu o ponto de pedido.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'],
    },
  },

  // =====================
  // TASK ALERTS
  // =====================

  // alert.overdue - HIGH, IN_APP + PUSH (supplements task.overdue)
  {
    key: 'alert.overdue',
    notificationType: 'TASK',
    eventType: 'alert_overdue',
    description: 'Alerta de tarefa atrasada - complementa task.overdue com notificacoes adicionais',
    importance: 'HIGH',
    workHoursOnly: false,
    maxFrequencyPerDay: 2,
    templates: {
      updated: {
        inApp: 'Tarefa atrasada: "{taskName}" - {daysOverdue} dia(s) de atraso',
        push: 'Tarefa atrasada: {daysOverdue} dia(s)!',
        email: {
          subject: 'Alerta: Tarefa #{serialNumber} atrasada',
          body: 'A tarefa "{taskName}" esta atrasada ha {daysOverdue} dia(s).\n\nNumero de Serie: {serialNumber}\nPrazo original: {term}\nSetor responsavel: {sectorName}\n\nPor favor, verifique a situacao e tome as providencias necessarias.',
        },
        whatsapp: 'Alerta: Tarefa #{serialNumber} atrasada ha {daysOverdue} dia(s)!',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
      customFilter: 'TASK_ASSIGNEE',
    },
  },

  // alert.customer_complaint - URGENT, all channels
  {
    key: 'alert.customer_complaint',
    notificationType: 'TASK',
    eventType: 'customer_complaint',
    description: 'Alerta urgente enviado quando uma reclamacao de cliente e registrada',
    importance: 'URGENT',
    workHoursOnly: false, // Urgent sends anytime
    templates: {
      updated: {
        inApp: 'RECLAMACAO DO CLIENTE: "{customerName}" - Tarefa #{serialNumber}',
        push: 'URGENTE: Reclamacao de cliente!',
        email: {
          subject: 'URGENTE: Reclamacao de cliente - {customerName}',
          body: 'ATENCAO URGENTE!\n\nUma reclamacao de cliente foi registrada.\n\nCliente: {customerName}\nTarefa: {taskName} (#{serialNumber})\nMotivo: {complaintReason}\nRegistrado por: {changedBy}\nData: {complaintDate}\n\nE necessaria acao imediata para resolver esta situacao.',
        },
        whatsapp: 'URGENTE: Reclamacao do cliente "{customerName}" sobre tarefa #{serialNumber}. Acao imediata necessaria!',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: true, mandatory: true, defaultOn: true },
    ],
    targetRule: {
      allowedSectors: ['ADMIN', 'COMMERCIAL', 'PRODUCTION', 'FINANCIAL'],
    },
  },

  // =====================
  // PPE ALERTS
  // =====================

  // alert.stock_shortage - HIGH, IN_APP + PUSH
  {
    key: 'alert.stock_shortage',
    notificationType: 'PPE',
    eventType: 'stock_shortage',
    description: 'Alerta enviado quando ha falta de estoque de EPI',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Falta de EPI: "{ppeItemName}" - Estoque insuficiente para entregas programadas',
        push: 'Falta de EPI: {ppeItemName}',
        email: {
          subject: 'Alerta de falta de EPI - {ppeItemName}',
          body: 'O estoque de EPI "{ppeItemName}" esta insuficiente para atender as entregas programadas.\n\nQuantidade em estoque: {currentQuantity}\nQuantidade necessaria: {requiredQuantity}\nEntregas pendentes: {pendingDeliveries}\n\nPor favor, providencie a reposicao.',
        },
        whatsapp: 'Falta de EPI: "{ppeItemName}" com estoque insuficiente para entregas.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['HUMAN_RESOURCES', 'ADMIN', 'WAREHOUSE'],
    },
  },

  // alert.missing_delivery - HIGH, IN_APP only
  {
    key: 'alert.missing_delivery',
    notificationType: 'PPE',
    eventType: 'missing_delivery',
    description: 'Alerta enviado quando uma entrega de EPI programada nao foi realizada',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Entrega de EPI pendente: {employeeName} - {ppeItemName}',
        push: 'Entrega de EPI pendente',
        email: {
          subject: 'Entrega de EPI pendente - {employeeName}',
          body: 'Uma entrega de EPI programada nao foi realizada.\n\nColaborador: {employeeName}\nItem: {ppeItemName}\nData programada: {scheduledDate}\nSetor: {sectorName}\n\nPor favor, verifique e regularize a situacao.',
        },
        whatsapp: 'Entrega de EPI pendente para {employeeName}: {ppeItemName}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'],
    },
  },

  // =====================
  // ORDER ALERTS
  // =====================

  // alert.delivery_delay - HIGH, IN_APP + PUSH
  {
    key: 'alert.delivery_delay',
    notificationType: 'ORDER',
    eventType: 'delivery_delay',
    description: 'Alerta enviado quando ha atraso na entrega de um pedido',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Atraso na entrega: Pedido #{orderNumber} - {daysDelayed} dia(s) de atraso',
        push: 'Atraso na entrega: Pedido #{orderNumber}',
        email: {
          subject: 'Atraso na entrega - Pedido #{orderNumber}',
          body: 'O pedido #{orderNumber} esta com atraso na entrega.\n\nFornecedor: {supplierName}\nData prevista: {expectedDate}\nDias de atraso: {daysDelayed}\nItens: {itemsCount}\n\nPor favor, entre em contato com o fornecedor para verificar a situacao.',
        },
        whatsapp: 'Atraso na entrega do pedido #{orderNumber} - {daysDelayed} dia(s). Verificar com fornecedor.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'],
    },
  },

  // =====================
  // WARNING ALERTS
  // =====================

  // alert.escalation_needed - URGENT, all channels
  {
    key: 'alert.escalation_needed',
    notificationType: 'WARNING',
    eventType: 'escalation_needed',
    description: 'Alerta urgente enviado quando um aviso precisa ser escalado para nivel superior',
    importance: 'URGENT',
    workHoursOnly: false, // Urgent sends anytime
    templates: {
      updated: {
        inApp: 'ESCALACAO NECESSARIA: Aviso para {employeeName} requer acao do RH',
        push: 'URGENTE: Escalacao de aviso necessaria!',
        email: {
          subject: 'URGENTE: Escalacao de aviso necessaria - {employeeName}',
          body: 'ATENCAO URGENTE!\n\nUm aviso precisa ser escalado para tratamento em nivel superior.\n\nColaborador: {employeeName}\nSetor: {sectorName}\nTipo de aviso: {warningSeverity}\nMotivo: {warningReason}\nCategoria: {warningCategory}\nAvisos anteriores: {previousWarningsCount}\n\nE necessaria acao imediata do RH para avaliar a situacao.',
        },
        whatsapp: 'URGENTE: Aviso para {employeeName} requer escalacao. {warningSeverity} - {warningReason}.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: true, mandatory: true, defaultOn: true },
    ],
    targetRule: {
      allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'],
    },
  },

  // alert.repeat_offender - HIGH, IN_APP + EMAIL
  {
    key: 'alert.repeat_offender',
    notificationType: 'WARNING',
    eventType: 'repeat_offender',
    description: 'Alerta enviado quando um colaborador recebe avisos repetidos',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Avisos recorrentes: {employeeName} - {warningsCount} avisos no periodo',
        push: 'Avisos recorrentes: {employeeName}',
        email: {
          subject: 'Alerta: Avisos recorrentes - {employeeName}',
          body: 'O colaborador {employeeName} recebeu {warningsCount} avisos no periodo.\n\nSetor: {sectorName}\nTipo mais frequente: {mostFrequentCategory}\nUltimo aviso: {lastWarningDate}\nMotivo: {lastWarningReason}\n\nRecomenda-se avaliacao do historico e possivel acao disciplinar.',
        },
        whatsapp: 'Avisos recorrentes: {employeeName} com {warningsCount} avisos. Avaliar historico.',
      },
    },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: {
      allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'],
    },
  },
];

/**
 * Seeds alert notification configurations
 *
 * @param prisma - PrismaClient instance
 */
export async function seedAlertNotifications(prisma: PrismaClient): Promise<void> {
  console.log('Seeding alert notification configurations...');

  for (const config of alertConfigs) {
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

    console.log(`  - Created configuration "${config.key}" (${config.importance}) with ${created.channelConfigs.length} channel configs`);
  }

  console.log('Alert notification configurations seeded successfully!');
  console.log(`  Total configurations: ${alertConfigs.length}`);
  console.log('  - Stock alerts: 3 (stock_out, low_stock, reorder_needed)');
  console.log('  - Task alerts: 2 (overdue, customer_complaint)');
  console.log('  - PPE alerts: 2 (stock_shortage, missing_delivery)');
  console.log('  - Order alerts: 1 (delivery_delay)');
  console.log('  - Warning alerts: 2 (escalation_needed, repeat_offender)');
}

// Allow running as standalone script
if (require.main === module) {
  const prisma = new PrismaClient();

  seedAlertNotifications(prisma)
    .then(() => {
      console.log('Done!');
    })
    .catch((error) => {
      console.error('Error seeding alert notifications:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
