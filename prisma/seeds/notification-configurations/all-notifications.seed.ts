import {
  PrismaClient,
  NotificationImportance,
  NotificationChannel,
  SectorPrivileges,
  NotificationType,
  Prisma,
} from '@prisma/client';

/**
 * ============================================================================
 * UNIFIED NOTIFICATION CONFIGURATIONS SEED
 * ============================================================================
 *
 * This is the SINGLE SOURCE OF TRUTH for ALL notification configurations.
 * All notifications in the system should be defined here and seeded into
 * the database. Code should NOT hardcode notification configurations.
 *
 * CATEGORIES:
 * 1. Task Lifecycle (3)
 * 2. Task Status Events (3)
 * 3. Task Deadlines - Term (6)
 * 4. Task Deadlines - Forecast (6)
 * 5. Task Basic Fields (4)
 * 6. Task Date Fields (5)
 * 7. Task Assignment Fields (3)
 * 8. Task Financial Fields (6)
 * 9. Task Artwork/Production Fields (5)
 * 10. Task Truck Fields (3)
 * 11. Task Negotiation Fields (3)
 * 12. Service Orders (6 + 1 = 7)
 * 13. Borrow/Emprestimo (2)
 * 14. Paint/Tinta (1)
 * 15. PPE/EPI (4)
 * 16. Alerts (10)
 * 17. Cut/Recorte (5)
 * 18. Order/Pedido (5)
 * 19. Item/Stock Detail (5)
 * 20. Artwork Approval (3)
 * 21. Time Entry Reminders (2)
 *
 * TOTAL: 91 notifications
 *
 * Last updated: 2025
 */

// ============================================================================
// TYPES
// ============================================================================

interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  mandatory: boolean;
  defaultOn: boolean;
}

interface NotificationConfig {
  key: string;
  name: string;
  notificationType: NotificationType;
  eventType: string;
  description: string;
  importance: NotificationImportance;
  workHoursOnly: boolean;
  maxFrequencyPerDay?: number;
  templates: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  channelConfigs: ChannelConfig[];
  targetRule: {
    allowedSectors: SectorPrivileges[];
    customFilter?: string;
  };
}

// ============================================================================
// SECTOR CONSTANTS
// ============================================================================

const ALL_SECTORS: SectorPrivileges[] = [
  'ADMIN', 'PRODUCTION', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC',
  'DESIGNER', 'WAREHOUSE', 'MAINTENANCE', 'HUMAN_RESOURCES', 'PLOTTING',
];

const PRODUCTION_SECTORS: SectorPrivileges[] = ['ADMIN', 'PRODUCTION', 'LOGISTIC', 'COMMERCIAL'];
const FINANCIAL_SECTORS: SectorPrivileges[] = ['ADMIN', 'FINANCIAL', 'COMMERCIAL'];
const BASIC_SECTORS: SectorPrivileges[] = ['ADMIN', 'PRODUCTION', 'FINANCIAL', 'DESIGNER', 'LOGISTIC'];
const DATE_SECTORS: SectorPrivileges[] = ['ADMIN', 'PRODUCTION', 'FINANCIAL', 'LOGISTIC'];
const NEGOTIATION_SECTORS: SectorPrivileges[] = ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'];

// ============================================================================
// CHANNEL PRESETS
// ============================================================================

const CHANNELS_IN_APP_ONLY: ChannelConfig[] = [
  { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
];

const CHANNELS_IN_APP_PUSH: ChannelConfig[] = [
  { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'PUSH', enabled: true, mandatory: false, defaultOn: true },
  { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
];

const CHANNELS_URGENT: ChannelConfig[] = [
  { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'EMAIL', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'WHATSAPP', enabled: true, mandatory: false, defaultOn: true },
];

const CHANNELS_HIGH: ChannelConfig[] = [
  { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'PUSH', enabled: true, mandatory: true, defaultOn: true },
  { channel: 'EMAIL', enabled: true, mandatory: false, defaultOn: false },
  { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
];

// ============================================================================
// 1. TASK LIFECYCLE NOTIFICATIONS (3)
// ============================================================================

const TASK_LIFECYCLE_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.created',
    name: 'Nova Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'created',
    description: 'Notificacao enviada quando uma nova tarefa e criada no sistema',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Nova tarefa criada: "{taskName}" #{serialNumber}',
        push: 'Nova tarefa criada',
        email: {
          subject: 'Nova tarefa criada: {taskName}',
          body: 'Uma nova tarefa foi criada:\n\nNome: {taskName}\nNumero de Serie: #{serialNumber}\nCriada por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Nova tarefa criada: "{taskName}" #{serialNumber} por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.overdue',
    name: 'Tarefa Atrasada',
    notificationType: 'PRODUCTION',
    eventType: 'overdue',
    description: 'Notificacao urgente enviada quando uma tarefa esta atrasada',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: '"{taskName}" #{serialNumber} esta atrasada ha {daysOverdue} dia(s)',
        push: 'Tarefa atrasada!',
        email: {
          subject: 'URGENTE: {taskName} #{serialNumber} atrasada',
          body: 'ATENCAO: A tarefa "{taskName}" #{serialNumber} esta atrasada ha {daysOverdue} dia(s).\n\nE necessario tomar uma acao imediata para resolver esta situacao.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'URGENTE: "{taskName}" #{serialNumber} esta atrasada ha {daysOverdue} dia(s)!',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL'],
    },
  },
  {
    key: 'task.deadline_approaching',
    name: 'Prazo se Aproximando',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_approaching',
    description: 'Notificacao enviada quando o prazo de uma tarefa esta se aproximando',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Prazo se aproximando: "{taskName}" #{serialNumber} vence em {daysRemaining} dia(s)',
        push: 'Prazo se aproximando!',
        email: {
          subject: 'Prazo se aproximando - Tarefa #{serialNumber}',
          body: 'ATENCAO: O prazo da tarefa "{taskName}" esta se aproximando.\n\nVence em: {daysRemaining} dia(s)\nPrazo: {term}\n\nVerifique se a tarefa esta em andamento e tome as providencias necessarias.',
        },
        whatsapp: 'Prazo se aproximando: Tarefa #{serialNumber} "{taskName}" vence em {daysRemaining} dia(s)!',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: PRODUCTION_SECTORS,
      customFilter: 'TASK_ASSIGNEE',
    },
  },
];

// ============================================================================
// 2. TASK STATUS EVENTS (3)
// ============================================================================

const TASK_STATUS_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.waiting_production',
    name: 'Tarefa Disponivel para Producao',
    notificationType: 'PRODUCTION',
    eventType: 'waiting_production',
    description: 'Notificacao enviada quando uma tarefa esta pronta para producao (status WAITING_PRODUCTION)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Tarefa disponivel para producao: "{taskName}" #{serialNumber}',
        push: 'Tarefa pronta para producao',
        email: {
          subject: 'Tarefa disponivel para producao - #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) esta disponivel para producao.\n\nTodos os preparativos foram concluidos e a tarefa pode ser iniciada.\n\nSetor: {sectorName}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Tarefa disponivel para producao: "{taskName}" #{serialNumber}. Pronta para iniciar.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },
  {
    key: 'task.in_production',
    name: 'Producao Iniciada',
    notificationType: 'PRODUCTION',
    eventType: 'in_production',
    description: 'Notificacao enviada quando a producao de uma tarefa e iniciada (status IN_PRODUCTION)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Producao iniciada: "{taskName}" #{serialNumber}',
        push: 'Producao iniciada',
        email: {
          subject: 'Producao iniciada - Tarefa #{serialNumber}',
          body: 'A producao da tarefa "{taskName}" (#{serialNumber}) foi iniciada.\n\nSetor: {sectorName}\nIniciado por: {changedBy}\nData de inicio: {changedAt}',
        },
        whatsapp: 'Producao iniciada: "{taskName}" #{serialNumber} por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.completed',
    name: 'Tarefa Concluida',
    notificationType: 'PRODUCTION',
    eventType: 'completed',
    description: 'Notificacao enviada quando uma tarefa e concluida (status COMPLETED)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Tarefa concluida: "{taskName}" #{serialNumber}',
        push: 'Tarefa concluida',
        email: {
          subject: 'Tarefa concluida - #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) foi concluida.\n\nSetor: {sectorName}\nConcluido por: {changedBy}\nData de conclusao: {changedAt}',
        },
        whatsapp: 'Tarefa concluida: "{taskName}" #{serialNumber} por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL', 'FINANCIAL', 'LOGISTIC'],
    },
  },
];

// ============================================================================
// 3. TASK DEADLINES - TERM (6)
// ============================================================================

const TASK_TERM_DEADLINE_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.deadline_1hour',
    name: 'Prazo em 1 Hora',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_1hour',
    description: 'Notificacao urgente enviada 1 hora antes do prazo da tarefa',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} vence em 1 hora!',
        push: 'URGENTE: Prazo em 1 hora!',
        email: {
          subject: 'URGENTE: Tarefa #{serialNumber} vence em 1 hora',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) vence em 1 HORA.\n\nPrazo: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nE necessaria acao imediata para concluir esta tarefa.',
        },
        whatsapp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} vence em 1 HORA! Acao imediata necessaria.',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: PRODUCTION_SECTORS,
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'task.deadline_4hours',
    name: 'Prazo em 4 Horas',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_4hours',
    description: 'Notificacao urgente enviada 4 horas antes do prazo da tarefa',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} vence em 4 horas!',
        push: 'URGENTE: Prazo em 4 horas!',
        email: {
          subject: 'URGENTE: Tarefa #{serialNumber} vence em 4 horas',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) vence em 4 HORAS.\n\nPrazo: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se a tarefa esta em andamento e tome as providencias necessarias.',
        },
        whatsapp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} vence em 4 HORAS! Verifique o andamento.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: PRODUCTION_SECTORS,
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'task.deadline_1day',
    name: 'Prazo em 1 Dia',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_1day',
    description: 'Notificacao enviada 1 dia antes do prazo da tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Prazo amanha: Tarefa "{taskName}" #{serialNumber} vence em 1 dia',
        push: 'Prazo amanha: {taskName}',
        email: {
          subject: 'Prazo amanha - Tarefa #{serialNumber}',
          body: 'ATENCAO: A tarefa "{taskName}" (#{serialNumber}) vence AMANHA.\n\nPrazo: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se a tarefa esta em andamento e tome as providencias necessarias.',
        },
        whatsapp: 'Prazo amanha: Tarefa "{taskName}" #{serialNumber}. Verifique o andamento.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: PRODUCTION_SECTORS,
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'task.deadline_3days',
    name: 'Prazo em 3 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_3days',
    description: 'Notificacao enviada 3 dias antes do prazo da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Prazo se aproximando: Tarefa "{taskName}" #{serialNumber} vence em 3 dias',
        push: 'Prazo em 3 dias: {taskName}',
        email: {
          subject: 'Prazo em 3 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) vence em 3 dias.\n\nPrazo: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se a tarefa esta em andamento.',
        },
        whatsapp: 'Prazo em 3 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: PRODUCTION_SECTORS,
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'task.deadline_7days',
    name: 'Prazo em 7 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'deadline_7days',
    description: 'Notificacao enviada 7 dias antes do prazo da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Prazo se aproximando: Tarefa "{taskName}" #{serialNumber} vence em 7 dias',
        push: 'Prazo em 7 dias: {taskName}',
        email: {
          subject: 'Prazo em 7 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) vence em 7 dias.\n\nPrazo: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se a tarefa esta planejada.',
        },
        whatsapp: 'Prazo em 7 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'task.term_overdue',
    name: 'Prazo Vencido',
    notificationType: 'PRODUCTION',
    eventType: 'term_overdue',
    description: 'Notificacao urgente enviada quando o prazo da tarefa esta vencido',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: 'ATRASADO: Tarefa "{taskName}" #{serialNumber} esta atrasada ha {daysOverdue} dia(s)',
        push: 'ATRASADO: Tarefa esta vencida!',
        email: {
          subject: 'URGENTE: Tarefa #{serialNumber} esta atrasada',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) esta ATRASADA ha {daysOverdue} dia(s).\n\nPrazo original: {term}\nStatus atual: {status}\nSetor: {sectorName}\n\nE necessaria acao imediata para resolver esta situacao.',
        },
        whatsapp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} esta ATRASADA ha {daysOverdue} dia(s)! Acao imediata necessaria.',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC', 'COMMERCIAL', 'FINANCIAL'],
    },
  },
];

// ============================================================================
// 4. TASK DEADLINES - FORECAST (6)
// ============================================================================

const TASK_FORECAST_DEADLINE_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.forecast_10days',
    name: 'Previsao em 10 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_10days',
    description: 'Notificacao enviada 10 dias antes da data de previsao da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Previsao se aproximando: Tarefa "{taskName}" #{serialNumber} tem previsao em 10 dias',
        push: 'Previsao em 10 dias: {taskName}',
        email: {
          subject: 'Previsao em 10 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de producao em 10 dias.\n\nData de previsao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se os preparativos estao em andamento.',
        },
        whatsapp: 'Previsao em 10 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_7days',
    name: 'Previsao em 7 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_7days',
    description: 'Notificacao enviada 7 dias antes da data de previsao da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Previsao se aproximando: Tarefa "{taskName}" #{serialNumber} tem previsao em 7 dias',
        push: 'Previsao em 7 dias: {taskName}',
        email: {
          subject: 'Previsao em 7 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de producao em 7 dias.\n\nData de previsao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se os preparativos estao em andamento.',
        },
        whatsapp: 'Previsao em 7 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_3days',
    name: 'Previsao em 3 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_3days',
    description: 'Notificacao enviada 3 dias antes da data de previsao da tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Previsao se aproximando: Tarefa "{taskName}" #{serialNumber} tem previsao em 3 dias{pendingOrdersText}',
        push: 'Previsao em 3 dias: {taskName}',
        email: {
          subject: 'Previsao em 3 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de producao em 3 dias.\n\nData de previsao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se todos os preparativos estao concluidos.',
        },
        whatsapp: 'Previsao em 3 dias: Tarefa "{taskName}" #{serialNumber}.{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_1day',
    name: 'Previsao Amanha',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_1day',
    description: 'Notificacao enviada 1 dia antes da data de previsao da tarefa, incluindo verificacao de pedidos pendentes',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Previsao amanha: Tarefa "{taskName}" #{serialNumber}{pendingOrdersText}',
        push: 'Previsao amanha: {taskName}',
        email: {
          subject: 'Previsao amanha - Tarefa #{serialNumber}',
          body: 'ATENCAO: A tarefa "{taskName}" (#{serialNumber}) tem previsao de producao AMANHA.\n\nData de previsao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se tudo esta pronto para a producao.',
        },
        whatsapp: 'Previsao amanha: Tarefa "{taskName}" #{serialNumber}.{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_today',
    name: 'Previsao Hoje',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_today',
    description: 'Notificacao urgente enviada quando a data de previsao da tarefa e hoje',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 2,
    templates: {
      updated: {
        inApp: 'HOJE: Tarefa "{taskName}" #{serialNumber} tem previsao para HOJE{pendingOrdersText}',
        push: 'HOJE: Previsao de producao!',
        email: {
          subject: 'URGENTE: Previsao HOJE - Tarefa #{serialNumber}',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) tem previsao de producao para HOJE.\n\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se a producao esta em andamento.',
        },
        whatsapp: 'HOJE: Tarefa "{taskName}" #{serialNumber} tem previsao para HOJE!{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_overdue',
    name: 'Previsao Atrasada',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_overdue',
    description: 'Notificacao urgente enviada quando a data de previsao da tarefa esta atrasada',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: 'ATRASADO: Tarefa "{taskName}" #{serialNumber} tem previsao atrasada ha {daysOverdue} dia(s){pendingOrdersText}',
        push: 'ATRASADO: Previsao vencida!',
        email: {
          subject: 'URGENTE: Previsao atrasada - Tarefa #{serialNumber}',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) esta com a previsao ATRASADA ha {daysOverdue} dia(s).\n\nData de previsao original: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nE necessaria acao imediata para resolver esta situacao.',
        },
        whatsapp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} tem previsao ATRASADA ha {daysOverdue} dia(s)!{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL', 'FINANCIAL'],
    },
  },
];

// ============================================================================
// 5. TASK BASIC FIELDS (4)
// ============================================================================

const TASK_BASIC_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.name',
    name: 'Nome da Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'field.name',
    description: 'Nome',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Nome da tarefa alterado de "{oldValue}" para "{newValue}"',
        push: 'Tarefa renomeada: {newValue}',
        email: {
          subject: 'Alteracao no nome da tarefa #{serialNumber}',
          body: 'O nome da tarefa foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'A tarefa #{serialNumber} foi renomeada de "{oldValue}" para "{newValue}".',
      },
    },
    metadata: { field: 'name', category: 'BASIC' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: BASIC_SECTORS },
  },
  {
    key: 'task.field.status',
    name: 'Status da Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'field.status',
    description: 'Status',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Status alterado de {oldValue} para {newValue}',
        push: 'Status: {newValue}',
        email: {
          subject: 'Status da tarefa #{serialNumber} alterado',
          body: 'O status da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'A tarefa #{serialNumber} mudou de "{oldValue}" para "{newValue}".',
      },
    },
    metadata: { field: 'status', category: 'BASIC', formatter: 'formatStatus' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: BASIC_SECTORS },
  },
  {
    key: 'task.field.details',
    name: 'Detalhes da Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'field.details',
    description: 'Detalhes',
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
    metadata: { field: 'details', category: 'BASIC' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: BASIC_SECTORS },
  },
  {
    key: 'task.field.serialNumber',
    name: 'Numero de Serie',
    notificationType: 'PRODUCTION',
    eventType: 'field.serialNumber',
    description: 'Numero de Serie',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Numero de serie alterado para: {newValue}',
        push: 'Numero de serie: {newValue}',
        email: {
          subject: 'Numero de serie da tarefa alterado',
          body: 'O numero de serie da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Numero de serie alterado para: {newValue}',
      },
    },
    metadata: { field: 'serialNumber', category: 'BASIC' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: BASIC_SECTORS },
  },
];

// ============================================================================
// 6. TASK DATE FIELDS (5)
// ============================================================================

const TASK_DATE_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.entryDate',
    name: 'Data de Entrada',
    notificationType: 'PRODUCTION',
    eventType: 'field.entryDate',
    description: 'Notificacao quando a data de entrada da tarefa e alterada ou removida',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'entryDate', category: 'DATES', formatter: 'formatDate' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
  {
    key: 'task.field.term',
    name: 'Prazo',
    notificationType: 'PRODUCTION',
    eventType: 'field.term',
    description: 'Notificacao quando o prazo da tarefa e alterado ou removido',
    importance: 'HIGH',
    workHoursOnly: true,
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
    metadata: { field: 'term', category: 'DATES', formatter: 'formatDate' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
  {
    key: 'task.field.forecastDate',
    name: 'Data Prevista',
    notificationType: 'PRODUCTION',
    eventType: 'field.forecastDate',
    description: 'Notificacao quando a data prevista de entrega e alterada ou removida',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'forecastDate', category: 'DATES', formatter: 'formatDate' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'FINANCIAL', 'COMMERCIAL', 'LOGISTIC', 'DESIGNER'] },
  },
  {
    key: 'task.field.startedAt',
    name: 'Data de Inicio',
    notificationType: 'PRODUCTION',
    eventType: 'field.startedAt',
    description: 'Notificacao quando a producao da tarefa e iniciada ou a data de inicio e removida',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'startedAt', category: 'DATES', formatter: 'formatDate' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
  {
    key: 'task.field.finishedAt',
    name: 'Data de Conclusao',
    notificationType: 'PRODUCTION',
    eventType: 'field.finishedAt',
    description: 'Notificacao quando a tarefa e concluida ou reaberta',
    importance: 'HIGH',
    workHoursOnly: true,
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
    metadata: { field: 'finishedAt', category: 'DATES', formatter: 'formatDate' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
];

// ============================================================================
// 7. TASK ASSIGNMENT FIELDS (3)
// ============================================================================

const TASK_ASSIGNMENT_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.sectorId',
    name: 'Setor Responsavel',
    notificationType: 'PRODUCTION',
    eventType: 'field.sectorId',
    description: 'Notificacao quando o setor responsavel pela tarefa e alterado ou removido',
    importance: 'HIGH',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'Setor responsavel alterado para: {newValue}',
        push: 'Novo setor: {newValue}',
        email: {
          subject: 'Atribuicao de setor - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" foi transferida de "{oldValue}" para "{newValue}" por {changedBy}.\n\nO novo setor responsavel deve verificar os detalhes da tarefa.',
        },
        whatsapp: 'Tarefa #{serialNumber} transferida para o setor {newValue}.',
      },
      cleared: {
        inApp: 'Setor responsavel removido',
        push: 'Setor removido',
        email: {
          subject: 'Setor removido - Tarefa #{serialNumber}',
          body: 'O setor responsavel pela tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Tarefa #{serialNumber} esta sem setor responsavel.',
      },
    },
    metadata: { field: 'sectorId', category: 'ASSIGNMENT', formatter: 'formatSector' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
  {
    key: 'task.field.customerId',
    name: 'Cliente',
    notificationType: 'PRODUCTION',
    eventType: 'field.customerId',
    description: 'Notificacao quando o cliente da tarefa e alterado ou removido',
    importance: 'NORMAL',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'Cliente alterado para: {newValue}',
        push: 'Novo cliente: {newValue}',
        email: {
          subject: 'Cliente alterado - Tarefa #{serialNumber}',
          body: 'O cliente da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Cliente da tarefa #{serialNumber} alterado para {newValue}.',
      },
      cleared: {
        inApp: 'Cliente removido',
        push: 'Cliente removido',
        email: {
          subject: 'Cliente removido - Tarefa #{serialNumber}',
          body: 'O cliente da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Cliente da tarefa #{serialNumber} foi removido.',
      },
    },
    metadata: { field: 'customerId', category: 'ASSIGNMENT', formatter: 'formatCustomer' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: DATE_SECTORS },
  },
  {
    key: 'task.field.invoiceToId',
    name: 'Faturar Para',
    notificationType: 'PRODUCTION',
    eventType: 'field.invoiceToId',
    description: 'Notificacao quando o cliente de faturamento da tarefa e alterado ou removido',
    importance: 'NORMAL',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'Cliente para faturamento alterado para "{newValue}"',
        push: 'Faturar para: {newValue}',
        email: {
          subject: 'Cliente de faturamento - Tarefa #{serialNumber}',
          body: 'O cliente de faturamento da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.\n\nVerifique os dados fiscais antes de emitir nota.',
        },
        whatsapp: 'Faturar tarefa #{serialNumber} para: {newValue}.',
      },
      cleared: {
        inApp: 'Cliente de faturamento removido',
        push: 'Faturamento removido',
        email: {
          subject: 'Cliente de faturamento removido - Tarefa #{serialNumber}',
          body: 'O cliente de faturamento da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Cliente de faturamento da tarefa #{serialNumber} foi removido.',
      },
    },
    metadata: { field: 'invoiceToId', category: 'FINANCIAL', formatter: 'formatCustomer' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: NEGOTIATION_SECTORS },
  },
];

// ============================================================================
// 8. TASK FINANCIAL FIELDS (6)
// ============================================================================

const TASK_FINANCIAL_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.commission',
    name: 'Comissao',
    notificationType: 'PRODUCTION',
    eventType: 'field.commission',
    description: 'Notificacao quando o status de comissao da tarefa e alterado',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'commission', category: 'FINANCIAL', formatter: 'formatCommissionStatus' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
  {
    key: 'task.field.budgets',
    name: 'Orcamentos',
    notificationType: 'PRODUCTION',
    eventType: 'field.budgets',
    description: 'Notificacao quando orcamentos sao atualizados, adicionados ou removidos da tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
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
    metadata: { field: 'budgets', category: 'FINANCIAL', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
  {
    key: 'task.field.invoices',
    name: 'Notas Fiscais',
    notificationType: 'PRODUCTION',
    eventType: 'field.invoices',
    description: 'Notificacao quando notas fiscais sao atualizadas, adicionadas ou removidas da tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
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
    metadata: { field: 'invoices', category: 'FINANCIAL', isFileArray: true },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
  {
    key: 'task.field.receipts',
    name: 'Comprovantes',
    notificationType: 'PRODUCTION',
    eventType: 'field.receipts',
    description: 'Notificacao quando comprovantes sao atualizados, adicionados ou removidos da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'receipts', category: 'FINANCIAL', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
  {
    key: 'task.field.reimbursements',
    name: 'Reembolsos',
    notificationType: 'PRODUCTION',
    eventType: 'field.reimbursements',
    description: 'Notificacao quando documentos de reembolso sao atualizados, adicionados ou removidos da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'reimbursements', category: 'FINANCIAL', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
  {
    key: 'task.field.invoiceReimbursements',
    name: 'NF de Reembolso',
    notificationType: 'PRODUCTION',
    eventType: 'field.invoiceReimbursements',
    description: 'Notificacao quando notas fiscais de reembolso sao atualizadas, adicionadas ou removidas da tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'invoiceReimbursements', category: 'FINANCIAL', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: FINANCIAL_SECTORS },
  },
];

// ============================================================================
// 9. TASK ARTWORK/PRODUCTION FIELDS (5)
// ============================================================================

const TASK_ARTWORK_PRODUCTION_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.artworks',
    name: 'Artes',
    notificationType: 'PRODUCTION',
    eventType: 'field.artworks',
    description: 'Notificacao enviada quando as artes de uma tarefa sao atualizadas, adicionadas ou removidas',
    importance: 'HIGH',
    workHoursOnly: true,
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
    metadata: { field: 'artworks', category: 'ARTWORK', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER', 'COMMERCIAL'] },
  },
  {
    key: 'task.field.baseFiles',
    name: 'Arquivos Base',
    notificationType: 'PRODUCTION',
    eventType: 'field.baseFiles',
    description: 'Notificacao enviada quando os arquivos base de uma tarefa sao atualizados, adicionados ou removidos',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'baseFiles', category: 'ARTWORK', isFileArray: true },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER', 'COMMERCIAL'] },
  },
  {
    key: 'task.field.paintId',
    name: 'Pintura Geral',
    notificationType: 'PRODUCTION',
    eventType: 'field.paintId',
    description: 'Notificacao enviada quando a pintura geral de uma tarefa e alterada ou removida',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'paintId', category: 'PRODUCTION', formatter: 'formatPaint' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'WAREHOUSE'] },
  },
  {
    key: 'task.field.logoPaints',
    name: 'Pinturas do Logotipo',
    notificationType: 'PRODUCTION',
    eventType: 'field.logoPaints',
    description: 'Notificacao enviada quando as pinturas do logotipo de uma tarefa sao atualizadas, adicionadas ou removidas',
    importance: 'NORMAL',
    workHoursOnly: true,
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
    metadata: { field: 'logoPaints', category: 'PRODUCTION', isFileArray: true, formatter: 'formatPaints' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'WAREHOUSE'] },
  },
  {
    key: 'task.field.observation',
    name: 'Observacao',
    notificationType: 'PRODUCTION',
    eventType: 'field.observation',
    description: 'Notificacao enviada quando a observacao de uma tarefa e adicionada ou removida',
    importance: 'LOW',
    workHoursOnly: true,
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
    metadata: { field: 'observation', category: 'PRODUCTION' },
    channelConfigs: [
      { channel: 'IN_APP', enabled: true, mandatory: true, defaultOn: true },
      { channel: 'PUSH', enabled: false, mandatory: false, defaultOn: false },
      { channel: 'EMAIL', enabled: false, mandatory: false, defaultOn: false },
      { channel: 'WHATSAPP', enabled: false, mandatory: false, defaultOn: false },
    ],
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'] },
  },
];

// ============================================================================
// 10. TASK TRUCK FIELDS (3)
// ============================================================================

const TASK_TRUCK_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.truck.plate',
    name: 'Placa do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.plate',
    description: 'Notificacao enviada quando a placa do caminhao e alterada na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Placa alterada: "{taskName}" #{serialNumber} - Placa: {newValue}',
        push: 'Placa do caminhao alterada',
        email: {
          subject: 'Placa do caminhao alterada - Tarefa #{serialNumber}',
          body: 'A placa do caminhao foi alterada na tarefa "{taskName}" (#{serialNumber}).\n\nPlaca anterior: {oldValue}\nNova placa: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Placa alterada na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Placa do caminhao removida',
        push: 'Placa removida',
        email: {
          subject: 'Placa removida - Tarefa #{serialNumber}',
          body: 'A placa do caminhao da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Placa da tarefa #{serialNumber} foi removida.',
      },
    },
    metadata: { field: 'truck.plate', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.truck.spot',
    name: 'Vaga do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.spot',
    description: 'Notificacao enviada quando a vaga do caminhao e alterada na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Vaga alterada: "{taskName}" #{serialNumber} - Vaga: {newValue}',
        push: 'Vaga do caminhao alterada',
        email: {
          subject: 'Vaga do caminhao alterada - Tarefa #{serialNumber}',
          body: 'A vaga do caminhao foi alterada na tarefa "{taskName}" (#{serialNumber}).\n\nVaga anterior: {oldValue}\nNova vaga: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Vaga alterada na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Vaga do caminhao removida',
        push: 'Vaga removida',
        email: {
          subject: 'Vaga removida - Tarefa #{serialNumber}',
          body: 'A vaga do caminhao da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Vaga da tarefa #{serialNumber} foi removida.',
      },
    },
    metadata: { field: 'truck.spot', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.truck.layout',
    name: 'Layout do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.layout',
    description: 'Notificacao enviada quando o layout do caminhao e alterado na tarefa',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Layout alterado: "{taskName}" #{serialNumber}',
        push: 'Layout do caminhao alterado',
        email: {
          subject: 'Layout do caminhao alterado - Tarefa #{serialNumber}',
          body: 'O layout do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nAlterado por: {changedBy}',
        },
        whatsapp: 'Layout alterado na tarefa "{taskName}" #{serialNumber}.',
      },
      cleared: {
        inApp: 'Layout do caminhao removido',
        push: 'Layout removido',
        email: {
          subject: 'Layout removido - Tarefa #{serialNumber}',
          body: 'O layout do caminhao da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Layout da tarefa #{serialNumber} foi removido.',
      },
    },
    metadata: { field: 'truck.layout', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER'] },
  },
];

// ============================================================================
// 11. TASK NEGOTIATION FIELDS (3)
// ============================================================================

const TASK_NEGOTIATION_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.representatives',
    name: 'Representantes',
    notificationType: 'PRODUCTION',
    eventType: 'field.representatives',
    description: 'Notificacao quando os representantes da tarefa sao alterados',
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
    metadata: { field: 'representatives', category: 'NEGOTIATION', formatter: 'formatRepresentatives' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: NEGOTIATION_SECTORS },
  },
  {
    key: 'task.field.representativeIds',
    name: 'IDs de Representantes',
    notificationType: 'PRODUCTION',
    eventType: 'field.representativeIds',
    description: 'Notificacao quando os IDs de representantes da tarefa sao alterados',
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
    metadata: { field: 'representativeIds', category: 'NEGOTIATION' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: NEGOTIATION_SECTORS },
  },
  {
    key: 'task.field.negotiatingWith',
    name: 'Negociando Com',
    notificationType: 'PRODUCTION',
    eventType: 'field.negotiatingWith',
    description: 'Notificacao quando o contato de negociacao da tarefa e alterado (DEPRECATED)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Contato de negociacao atualizado: {newValue}',
        push: 'Negociacao: {newValue}',
        email: {
          subject: 'Contato de negociacao - Tarefa #{serialNumber}',
          body: 'O contato de negociacao da tarefa "{taskName}" foi atualizado para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Negociando tarefa #{serialNumber} com: {newValue}.',
      },
      cleared: {
        inApp: 'Contato de negociacao removido',
        push: 'Negociacao removida',
        email: {
          subject: 'Contato de negociacao removido - Tarefa #{serialNumber}',
          body: 'O contato de negociacao da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: 'Contato de negociacao da tarefa #{serialNumber} foi removido.',
      },
    },
    metadata: { field: 'negotiatingWith', category: 'NEGOTIATION', deprecated: true, replacedBy: 'representatives' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: NEGOTIATION_SECTORS },
  },
];

// ============================================================================
// 12. SERVICE ORDER NOTIFICATIONS (6)
// ============================================================================

const SERVICE_ORDER_CONFIGS: NotificationConfig[] = [
  {
    key: 'service_order.created',
    name: 'Ordem de Servico Criada',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.created',
    description: 'Notificacao enviada quando uma nova ordem de servico e criada no sistema',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} criada para a tarefa "{taskName}"',
        push: 'OS #{id}: Nova ordem de servico criada',
        email: {
          subject: 'Nova Ordem de Servico #{id} Criada',
          body: 'Uma nova ordem de servico foi criada:\n\nOS: #{id}\nTarefa: {taskName}\nTipo: {type}\nDescricao: {description}\nCriada por: {changedBy}',
        },
        whatsapp: 'Nova OS #{id} criada para tarefa "{taskName}". Tipo: {type}. Criada por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION'] },
  },
  {
    key: 'service_order.assigned',
    name: 'Ordem de Servico Atribuida',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.assigned',
    description: 'Notificacao enviada quando uma ordem de servico e atribuida a um usuario',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} atribuida a {assignedTo}: "{description}"',
        push: 'OS #{id}: Voce foi atribuido a uma ordem de servico',
        email: {
          subject: 'Ordem de Servico #{id} Atribuida a Voce',
          body: 'Uma ordem de servico foi atribuida a voce:\n\nOS: #{id}\nDescricao: {description}\nAtribuido por: {assignedBy}\nAtribuido para: {assignedTo}\n\nPor favor, verifique os detalhes e inicie o trabalho assim que possivel.',
        },
        whatsapp: 'OS #{id} atribuida a {assignedTo} por {assignedBy}. Descricao: {description}',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
      customFilter: 'SERVICE_ORDER_ASSIGNEE',
    },
  },
  {
    key: 'service_order.started',
    name: 'Ordem de Servico Iniciada',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.started',
    description: 'Notificacao enviada quando uma ordem de servico e iniciada (em andamento)',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} iniciada: "{description}"',
        push: 'OS #{id}: Ordem de servico iniciada',
        email: {
          subject: 'Ordem de Servico #{id} Iniciada',
          body: 'A ordem de servico foi iniciada:\n\nOS: #{id}\nDescricao: {description}\nIniciada por: {changedBy}\nData de inicio: {startedAt}',
        },
        whatsapp: 'OS #{id} iniciada: "{description}". Iniciada por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION'] },
  },
  {
    key: 'service_order.completed',
    name: 'Ordem de Servico Concluida',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.completed',
    description: 'Notificacao enviada quando uma ordem de servico e concluida',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} concluida: "{description}"',
        push: 'OS #{id}: Ordem de servico concluida',
        email: {
          subject: 'Ordem de Servico #{id} Concluida',
          body: 'A ordem de servico foi concluida:\n\nOS: #{id}\nDescricao: {description}\nConcluida por: {changedBy}\nData de conclusao: {completedAt}',
        },
        whatsapp: 'OS #{id} concluida: "{description}". Concluida por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'FINANCIAL'] },
  },
  {
    key: 'service_order.approved',
    name: 'Ordem de Servico Aprovada',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.approved',
    description: 'Notificacao enviada quando uma ordem de servico e aprovada',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} aprovada: "{description}"',
        push: 'OS #{id}: Ordem de servico aprovada',
        email: {
          subject: 'Ordem de Servico #{id} Aprovada',
          body: 'A ordem de servico foi aprovada:\n\nOS: #{id}\nDescricao: {description}\nAprovada por: {changedBy}\nData de aprovacao: {approvedAt}',
        },
        whatsapp: 'OS #{id} aprovada: "{description}". Aprovada por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION'] },
  },
  {
    key: 'service_order.cancelled',
    name: 'Ordem de Servico Cancelada',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.cancelled',
    description: 'Notificacao enviada quando uma ordem de servico e cancelada',
    importance: 'HIGH',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{id} cancelada: "{description}"',
        push: 'OS #{id}: Ordem de servico cancelada',
        email: {
          subject: 'Ordem de Servico #{id} Cancelada',
          body: 'A ordem de servico foi cancelada:\n\nOS: #{id}\nDescricao: {description}\nCancelada por: {changedBy}\nMotivo: {cancellationReason}',
        },
        whatsapp: 'OS #{id} cancelada: "{description}". Cancelada por {changedBy}. Motivo: {cancellationReason}',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION'] },
  },
];

// ============================================================================
// 13. BORROW NOTIFICATIONS (2)
// ============================================================================

const BORROW_CONFIGS: NotificationConfig[] = [
  {
    key: 'borrow.unreturned_reminder',
    name: 'Lembrete de Devolucao',
    notificationType: 'USER',
    eventType: 'borrow.unreturned_reminder',
    description: 'Lembrete diario as 17:20 para usuarios com itens emprestados nao devolvidos',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Lembrete: Voce possui {itemCount} item(ns) emprestado(s) pendente(s) de devolucao',
        push: 'Lembrete de devolucao',
        email: {
          subject: 'Lembrete: Itens emprestados pendentes de devolucao',
          body: 'Ola!\n\nEste e um lembrete de que voce possui {itemCount} item(ns) emprestado(s) pendente(s) de devolucao.\n\nItens:\n{itemsList}\n\nPor favor, devolva os itens no almoxarifado antes do final do expediente.\n\nCaso ja tenha devolvido, desconsidere esta mensagem.',
        },
        whatsapp: 'Lembrete: Voce possui {itemCount} item(ns) emprestado(s) pendente(s) de devolucao. Por favor, devolva ao almoxarifado.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
      customFilter: 'BORROWER',
    },
  },
  {
    key: 'borrow.unreturned_manager_reminder',
    name: 'Lembrete de Devolucao (Gestor)',
    notificationType: 'USER',
    eventType: 'borrow.unreturned_manager_reminder',
    description: 'Lembrete diario as 17:20 para gestores sobre colaboradores com itens nao devolvidos',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Lembrete: {userCount} colaborador(es) do seu setor possui(em) item(ns) emprestado(s) pendente(s)',
        push: 'Colaboradores com itens pendentes',
        email: {
          subject: 'Lembrete: Colaboradores com itens emprestados pendentes',
          body: 'Ola!\n\nEste e um lembrete de que {userCount} colaborador(es) do seu setor possui(em) item(ns) emprestado(s) pendente(s) de devolucao.\n\nColaboradores:\n{usersList}\n\nPor favor, oriente os colaboradores a devolverem os itens no almoxarifado.',
        },
        whatsapp: 'Lembrete: {userCount} colaborador(es) do seu setor possui(em) item(ns) emprestado(s) pendente(s) de devolucao.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC', 'MAINTENANCE', 'WAREHOUSE'],
      customFilter: 'SECTOR_MANAGER',
    },
  },
];

// ============================================================================
// 14. PAINT NOTIFICATIONS (1)
// ============================================================================

const PAINT_CONFIGS: NotificationConfig[] = [
  {
    key: 'paint.produced',
    name: 'Tinta Produzida',
    notificationType: 'PRODUCTION',
    eventType: 'paint.produced',
    description: 'Notificacao enviada quando uma tinta e produzida e esta disponivel para tarefas que a utilizam',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Tinta "{paintName}" que e utilizada na tarefa "{taskName}" foi produzida',
        push: 'Tinta produzida',
        email: {
          subject: 'Tinta produzida - {paintName}',
          body: 'A tinta "{paintName}" foi produzida e esta disponivel.\n\nVolume produzido: {volumeLiters}L\nProduzido por: {producedByName}\n\nEsta tinta e utilizada na(s) seguinte(s) tarefa(s):\n{taskNames}',
        },
        whatsapp: 'Tinta "{paintName}" produzida ({volumeLiters}L). Utilizada na tarefa "{taskName}".',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
      customFilter: 'TASK_SECTOR_USERS',
    },
  },
];

// ============================================================================
// 15. PPE/EPI NOTIFICATIONS (4)
// ============================================================================

const PPE_CONFIGS: NotificationConfig[] = [
  {
    key: 'ppe.requested',
    name: 'Nova Solicitacao de EPI',
    notificationType: 'USER',
    eventType: 'ppe.requested',
    description: 'Notificacao enviada quando um usuario solicita EPI',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: '{requestedByName} solicitou "{itemName}". Aguardando aprovacao.',
        push: 'Nova solicitacao de EPI',
        email: {
          subject: 'Nova solicitacao de EPI - {itemName}',
          body: '{requestedByName} solicitou "{itemName}".\n\nQuantidade: {quantity}\n\nAguardando aprovacao.\n\nAcesse o sistema para aprovar ou rejeitar a solicitacao.',
        },
        whatsapp: '{requestedByName} solicitou "{itemName}". Aguardando aprovacao.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'HUMAN_RESOURCES'] },
  },
  {
    key: 'ppe.approved',
    name: 'Solicitacao de EPI Aprovada',
    notificationType: 'USER',
    eventType: 'ppe.approved',
    description: 'Notificacao enviada quando uma solicitacao de EPI e aprovada',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Sua solicitacao de "{itemName}" foi aprovada por {approvedByName}. Aguarde a entrega pelo almoxarifado.',
        push: 'Solicitacao de EPI aprovada',
        email: {
          subject: 'Solicitacao de EPI aprovada - {itemName}',
          body: 'Sua solicitacao de "{itemName}" foi aprovada por {approvedByName}.\n\nQuantidade: {quantity}\n\nAguarde a entrega pelo almoxarifado.',
        },
        whatsapp: 'Sua solicitacao de "{itemName}" foi aprovada por {approvedByName}. Aguarde a entrega.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
      customFilter: 'PPE_DELIVERY_RECIPIENT',
    },
  },
  {
    key: 'ppe.rejected',
    name: 'Solicitacao de EPI Reprovada',
    notificationType: 'USER',
    eventType: 'ppe.rejected',
    description: 'Notificacao enviada quando uma solicitacao de EPI e reprovada',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Sua solicitacao de "{itemName}" foi reprovada por {rejectedByName}.',
        push: 'Solicitacao de EPI reprovada',
        email: {
          subject: 'Solicitacao de EPI reprovada - {itemName}',
          body: 'Sua solicitacao de "{itemName}" foi reprovada por {rejectedByName}.',
        },
        whatsapp: 'Sua solicitacao de "{itemName}" foi reprovada por {rejectedByName}.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
      customFilter: 'PPE_DELIVERY_RECIPIENT',
    },
  },
  {
    key: 'ppe.delivered',
    name: 'EPI Entregue',
    notificationType: 'USER',
    eventType: 'ppe.delivered',
    description: 'Notificacao enviada quando um EPI e entregue ao usuario',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: '"{itemName}" foi entregue a voce por {deliveredByName}.',
        push: 'EPI entregue',
        email: {
          subject: 'EPI entregue - {itemName}',
          body: '"{itemName}" foi entregue a voce por {deliveredByName}.\n\nQuantidade: {quantity}',
        },
        whatsapp: '"{itemName}" foi entregue a voce por {deliveredByName}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
      customFilter: 'PPE_DELIVERY_RECIPIENT',
    },
  },
];

// ============================================================================
// 16. ALERT NOTIFICATIONS (10)
// ============================================================================

const ALERT_CONFIGS: NotificationConfig[] = [
  // Stock Alerts
  {
    key: 'alert.stock_out',
    name: 'Estoque Zerado',
    notificationType: 'STOCK',
    eventType: 'alert.stock_out',
    description: 'Alerta urgente enviado quando um item fica sem estoque',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 5,
    templates: {
      updated: {
        inApp: 'ESTOQUE ZERADO: "{itemName}" esta sem estoque!',
        push: 'URGENTE: Item sem estoque!',
        email: {
          subject: 'URGENTE: Estoque zerado - {itemName}',
          body: 'ATENCAO URGENTE!\n\nO item "{itemName}" esta SEM ESTOQUE.\n\nCategoria: {categoryName}\nFornecedor: {supplierName}\nUltima movimentacao: {lastMovementDate}\n\nE necessaria acao imediata para repor este item.',
        },
        whatsapp: 'URGENTE: O item "{itemName}" esta SEM ESTOQUE! Acao imediata necessaria.',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: { allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'] },
  },
  {
    key: 'alert.low_stock',
    name: 'Estoque Baixo',
    notificationType: 'STOCK',
    eventType: 'alert.low_stock',
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
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['WAREHOUSE', 'ADMIN', 'MAINTENANCE'] },
  },
  {
    key: 'alert.reorder_needed',
    name: 'Reposicao Necessaria',
    notificationType: 'STOCK',
    eventType: 'alert.reorder_needed',
    description: 'Alerta enviado quando um item atinge o ponto de reposicao',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Reposicao necessaria: "{itemName}" atingiu o ponto de pedido',
        push: 'Reposicao necessaria: {itemName}',
        email: {
          subject: 'Ponto de reposicao atingido - {itemName}',
          body: 'O item "{itemName}" atingiu o ponto de reposicao e precisa ser reposto.\n\nQuantidade atual: {currentQuantity}\nPonto de pedido: {reorderPoint}\nQuantidade sugerida: {suggestedQuantity}\nFornecedor: {supplierName}',
        },
        whatsapp: 'Reposicao necessaria: "{itemName}" atingiu o ponto de pedido.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'] },
  },

  // Task Alerts
  {
    key: 'alert.overdue',
    name: 'Tarefa Atrasada (Alerta)',
    notificationType: 'PRODUCTION',
    eventType: 'alert.overdue',
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
          body: 'A tarefa "{taskName}" esta atrasada ha {daysOverdue} dia(s).\n\nNumero de Serie: #{serialNumber}\nPrazo original: {term}\nSetor responsavel: {sectorName}\n\nPor favor, verifique a situacao e tome as providencias necessarias.',
        },
        whatsapp: 'Alerta: Tarefa #{serialNumber} atrasada ha {daysOverdue} dia(s)!',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
      customFilter: 'TASK_ASSIGNEE',
    },
  },
  {
    key: 'alert.customer_complaint',
    name: 'Reclamacao de Cliente',
    notificationType: 'PRODUCTION',
    eventType: 'alert.customer_complaint',
    description: 'Alerta urgente enviado quando uma reclamacao de cliente e registrada',
    importance: 'URGENT',
    workHoursOnly: false,
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
    channelConfigs: CHANNELS_URGENT,
    targetRule: { allowedSectors: ['ADMIN', 'COMMERCIAL', 'PRODUCTION', 'FINANCIAL'] },
  },

  // PPE Alerts
  {
    key: 'alert.stock_shortage',
    name: 'Falta de EPI',
    notificationType: 'USER',
    eventType: 'alert.stock_shortage',
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
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['HUMAN_RESOURCES', 'ADMIN', 'WAREHOUSE'] },
  },
  {
    key: 'alert.missing_delivery',
    name: 'Entrega de EPI Pendente',
    notificationType: 'USER',
    eventType: 'alert.missing_delivery',
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
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'] },
  },

  // Order Alert
  {
    key: 'alert.delivery_delay',
    name: 'Atraso na Entrega',
    notificationType: 'STOCK',
    eventType: 'alert.delivery_delay',
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
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['WAREHOUSE', 'ADMIN', 'FINANCIAL'] },
  },

  // Warning Alerts
  {
    key: 'alert.escalation_needed',
    name: 'Escalacao Necessaria',
    notificationType: 'USER',
    eventType: 'alert.escalation_needed',
    description: 'Alerta urgente enviado quando um aviso precisa ser escalado para nivel superior',
    importance: 'URGENT',
    workHoursOnly: false,
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
    channelConfigs: CHANNELS_URGENT,
    targetRule: { allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'] },
  },
  {
    key: 'alert.repeat_offender',
    name: 'Avisos Recorrentes',
    notificationType: 'USER',
    eventType: 'alert.repeat_offender',
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
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['HUMAN_RESOURCES', 'ADMIN'] },
  },
];

// ============================================================================
// 17. CUT NOTIFICATIONS (5)
// ============================================================================

const CUT_CONFIGS: NotificationConfig[] = [
  {
    key: 'cut.created',
    name: 'Recorte Criado',
    notificationType: 'PRODUCTION',
    eventType: 'cut.created',
    description: 'Notificacao enviada quando um novo recorte e adicionado a uma tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Recorte de {cutTypeLabel} adicionado para tarefa "{taskName}" #{serialNumber}',
        push: 'Novo recorte adicionado',
        email: {
          subject: 'Recorte de {cutTypeLabel} adicionado - Tarefa #{serialNumber}',
          body: 'Um novo recorte foi adicionado:\n\nTarefa: {taskName} #{serialNumber}\nTipo: {cutTypeLabel}\nCriado por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Recorte de {cutTypeLabel} adicionado para tarefa #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: PRODUCTION_SECTORS },
  },
  {
    key: 'cut.started',
    name: 'Recorte Iniciado',
    notificationType: 'PRODUCTION',
    eventType: 'cut.started',
    description: 'Notificacao enviada quando um recorte e iniciado',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Recorte de {cutTypeLabel} da tarefa "{taskName}" #{serialNumber} foi iniciado',
        push: 'Recorte iniciado',
        email: {
          subject: 'Recorte iniciado - Tarefa #{serialNumber}',
          body: 'O recorte foi iniciado:\n\nTarefa: {taskName} #{serialNumber}\nTipo: {cutTypeLabel}\nIniciado por: {changedBy}\n\nAcesse o sistema para acompanhar.',
        },
        whatsapp: 'Recorte de {cutTypeLabel} da tarefa #{serialNumber} foi iniciado.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: PRODUCTION_SECTORS },
  },
  {
    key: 'cut.completed',
    name: 'Recorte Concluido',
    notificationType: 'PRODUCTION',
    eventType: 'cut.completed',
    description: 'Notificacao enviada quando um recorte e concluido',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Recorte de {cutTypeLabel} da tarefa "{taskName}" #{serialNumber} foi concluido',
        push: 'Recorte concluido',
        email: {
          subject: 'Recorte concluido - Tarefa #{serialNumber}',
          body: 'O recorte foi concluido:\n\nTarefa: {taskName} #{serialNumber}\nTipo: {cutTypeLabel}\nConcluido por: {changedBy}\n\nAcesse o sistema para verificar.',
        },
        whatsapp: 'Recorte de {cutTypeLabel} da tarefa #{serialNumber} foi concluido!',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: PRODUCTION_SECTORS },
  },
  {
    key: 'cut.request.created',
    name: 'Solicitacao de Recorte',
    notificationType: 'PRODUCTION',
    eventType: 'cut.request.created',
    description: 'Notificacao urgente enviada quando uma solicitacao de recorte e criada',
    importance: 'URGENT',
    workHoursOnly: false,
    templates: {
      updated: {
        inApp: 'URGENTE: Novo recorte de {cutTypeLabel} solicitado para tarefa "{taskName}" #{serialNumber}',
        push: 'URGENTE: Solicitacao de recorte!',
        email: {
          subject: 'URGENTE: Solicitacao de recorte - Tarefa #{serialNumber}',
          body: 'ATENCAO: Uma nova solicitacao de recorte foi criada e requer acao imediata.\n\nTarefa: {taskName} #{serialNumber}\nTipo: {cutTypeLabel}\nSolicitado por: {changedBy}\nMotivo: {reason}\n\nAcesse o sistema para processar a solicitacao.',
        },
        whatsapp: 'URGENTE: Solicitacao de recorte de {cutTypeLabel} para tarefa #{serialNumber}!',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'PLOTTING'] },
  },
  {
    key: 'cuts.added.to.task',
    name: 'Recortes Adicionados em Lote',
    notificationType: 'PRODUCTION',
    eventType: 'cuts.added.to.task',
    description: 'Notificacao enviada quando multiplos recortes sao adicionados a uma tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: '{count} recorte(s) adicionado(s) para tarefa "{taskName}" #{serialNumber}',
        push: 'Recortes adicionados em lote',
        email: {
          subject: '{count} recorte(s) adicionado(s) - Tarefa #{serialNumber}',
          body: 'Foram adicionados {count} recorte(s) a tarefa:\n\nTarefa: {taskName} #{serialNumber}\nQuantidade: {count}\nAdicionados por: {changedBy}\n\nAcesse o sistema para verificar os detalhes.',
        },
        whatsapp: '{count} recorte(s) adicionado(s) para tarefa #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: PRODUCTION_SECTORS },
  },
];

// ============================================================================
// 18. ORDER NOTIFICATIONS (5)
// ============================================================================

const ORDER_CONFIGS: NotificationConfig[] = [
  {
    key: 'order.created',
    name: 'Pedido Criado',
    notificationType: 'STOCK',
    eventType: 'order.created',
    description: 'Notificacao enviada quando um novo pedido de compra e criado',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Novo pedido criado: #{orderNumber} - {supplierName}',
        push: 'Novo pedido criado',
        email: {
          subject: 'Novo Pedido Criado - #{orderNumber}',
          body: 'Um novo pedido de compra foi criado:\n\nNumero: #{orderNumber}\nFornecedor: {supplierName}\nItens: {itemCount}\nValor Total: R$ {totalValue}\nCriado por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Novo pedido #{orderNumber} criado para {supplierName}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
  {
    key: 'order.status.changed',
    name: 'Status do Pedido Alterado',
    notificationType: 'STOCK',
    eventType: 'order.status.changed',
    description: 'Notificacao enviada quando o status de um pedido e alterado',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Status do pedido #{orderNumber} alterado para {newStatus}',
        push: 'Status do pedido alterado',
        email: {
          subject: 'Status do Pedido #{orderNumber} Alterado',
          body: 'O status do pedido foi alterado:\n\nNumero: #{orderNumber}\nFornecedor: {supplierName}\nStatus anterior: {oldStatus}\nNovo status: {newStatus}\nAlterado por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: 'Pedido #{orderNumber}: status alterado para {newStatus}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
  {
    key: 'order.overdue',
    name: 'Pedido Atrasado/Vencendo',
    notificationType: 'STOCK',
    eventType: 'order.overdue',
    description: 'Notificacao enviada quando um pedido esta atrasado ou proximo do vencimento',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 2,
    templates: {
      updated: {
        inApp: 'Pedido #{orderNumber} esta {overdueStatus}',
        push: 'Pedido atrasado/vencendo!',
        email: {
          subject: 'ATENCAO: Pedido #{orderNumber} - {overdueStatus}',
          body: 'ATENCAO: O pedido requer sua atencao:\n\nNumero: #{orderNumber}\nFornecedor: {supplierName}\nStatus: {overdueStatus}\nData prevista: {expectedDate}\nDias de atraso: {daysOverdue}\n\nVerifique com o fornecedor e tome as providencias necessarias.',
        },
        whatsapp: 'ATENCAO: Pedido #{orderNumber} {overdueStatus}. Verificar fornecedor.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
  {
    key: 'order.item.received',
    name: 'Item do Pedido Recebido',
    notificationType: 'STOCK',
    eventType: 'order.item.received',
    description: 'Notificacao enviada quando um item de um pedido e recebido',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Item "{itemName}" recebido do pedido #{orderNumber}',
        push: 'Item recebido',
        email: {
          subject: 'Item Recebido - Pedido #{orderNumber}',
          body: 'Um item foi recebido:\n\nPedido: #{orderNumber}\nItem: {itemName}\nQuantidade recebida: {quantityReceived}\nRecebido por: {changedBy}\n\nO estoque foi atualizado automaticamente.',
        },
        whatsapp: 'Item "{itemName}" recebido do pedido #{orderNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE'] },
  },
  {
    key: 'order.cancelled',
    name: 'Pedido Cancelado',
    notificationType: 'STOCK',
    eventType: 'order.cancelled',
    description: 'Notificacao enviada quando um pedido e cancelado',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Pedido #{orderNumber} foi cancelado',
        push: 'Pedido cancelado',
        email: {
          subject: 'Pedido #{orderNumber} Cancelado',
          body: 'O pedido foi cancelado:\n\nNumero: #{orderNumber}\nFornecedor: {supplierName}\nMotivo: {cancellationReason}\nCancelado por: {changedBy}\n\nVerifique se ha necessidade de criar um novo pedido.',
        },
        whatsapp: 'Pedido #{orderNumber} foi cancelado. Motivo: {cancellationReason}.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
];

// ============================================================================
// 19. ADDITIONAL SERVICE ORDER NOTIFICATIONS (1)
// ============================================================================

const SERVICE_ORDER_ADDITIONAL_CONFIGS: NotificationConfig[] = [
  {
    key: 'service_order.waiting_approval',
    name: 'Ordem de Servico Aguardando Aprovacao',
    notificationType: 'PRODUCTION',
    eventType: 'service_order.waiting_approval',
    description: 'Notificacao enviada quando uma ordem de servico esta aguardando aprovacao',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Ordem de servico #{serviceOrderNumber} aguardando aprovacao',
        push: 'OS aguardando aprovacao',
        email: {
          subject: 'Ordem de Servico #{serviceOrderNumber} - Aguardando Aprovacao',
          body: 'Uma ordem de servico esta aguardando sua aprovacao:\n\nNumero: #{serviceOrderNumber}\nTipo: {serviceType}\nDescricao: {description}\nExecutado por: {executedBy}\nData: {completedDate}\n\nAcesse o sistema para aprovar ou rejeitar.',
        },
        whatsapp: 'OS #{serviceOrderNumber} aguardando aprovacao. Verificar sistema.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'MAINTENANCE'] },
  },
];

// ============================================================================
// 20. ITEM/STOCK DETAIL NOTIFICATIONS (5)
// ============================================================================

const ITEM_STOCK_CONFIGS: NotificationConfig[] = [
  {
    key: 'item.low_stock',
    name: 'Item com Estoque Baixo',
    notificationType: 'STOCK',
    eventType: 'item.low_stock',
    description: 'Notificacao enviada quando um item atinge nivel de estoque baixo',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Estoque baixo: "{itemName}" - {currentQuantity} unidades restantes',
        push: 'Estoque baixo: {itemName}',
        email: {
          subject: 'Estoque Baixo - {itemName}',
          body: 'ATENCAO: O item esta com estoque baixo:\n\nItem: {itemName}\nCodigo: {itemCode}\nQuantidade atual: {currentQuantity}\nQuantidade minima: {minimumQuantity}\nCategoria: {category}\n\nConsidere fazer um novo pedido de compra.',
        },
        whatsapp: 'Estoque baixo: {itemName} com apenas {currentQuantity} unidades.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
  {
    key: 'item.out_of_stock',
    name: 'Item Sem Estoque',
    notificationType: 'STOCK',
    eventType: 'item.out_of_stock',
    description: 'Notificacao urgente enviada quando um item fica sem estoque',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 2,
    templates: {
      updated: {
        inApp: 'URGENTE: "{itemName}" esta sem estoque!',
        push: 'URGENTE: Item sem estoque!',
        email: {
          subject: 'URGENTE: Estoque Esgotado - {itemName}',
          body: 'ATENCAO URGENTE: O item esta sem estoque:\n\nItem: {itemName}\nCodigo: {itemCode}\nCategoria: {category}\n\nE necessario providenciar a reposicao imediatamente para evitar interrupcoes na producao.',
        },
        whatsapp: 'URGENTE: {itemName} esta SEM ESTOQUE! Providenciar reposicao imediata.',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'PRODUCTION'] },
  },
  {
    key: 'item.reorder_required',
    name: 'Recompra Necessaria',
    notificationType: 'STOCK',
    eventType: 'item.reorder_required',
    description: 'Notificacao enviada quando um item atinge o ponto de recompra',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Recompra necessaria: "{itemName}" atingiu ponto de pedido',
        push: 'Recompra necessaria',
        email: {
          subject: 'Recompra Necessaria - {itemName}',
          body: 'O item atingiu o ponto de pedido:\n\nItem: {itemName}\nCodigo: {itemCode}\nQuantidade atual: {currentQuantity}\nPonto de pedido: {reorderPoint}\nQuantidade sugerida: {suggestedOrderQuantity}\nFornecedor preferencial: {preferredSupplier}\n\nCrie um novo pedido de compra.',
        },
        whatsapp: 'Recompra: {itemName} atingiu ponto de pedido. Criar pedido.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE', 'FINANCIAL'] },
  },
  {
    key: 'item.overstock',
    name: 'Excesso de Estoque',
    notificationType: 'STOCK',
    eventType: 'item.overstock',
    description: 'Notificacao enviada quando um item esta com excesso de estoque',
    importance: 'LOW',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Excesso de estoque: "{itemName}" - {currentQuantity} unidades',
        push: 'Excesso de estoque',
        email: {
          subject: 'Excesso de Estoque - {itemName}',
          body: 'O item esta com excesso de estoque:\n\nItem: {itemName}\nCodigo: {itemCode}\nQuantidade atual: {currentQuantity}\nQuantidade maxima: {maximumQuantity}\nExcesso: {excessQuantity}\n\nConsidere ajustar os parametros de estoque ou redistribuir.',
        },
        whatsapp: 'Excesso de estoque: {itemName} com {currentQuantity} unidades.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE'] },
  },
  {
    key: 'item.daily_stock_report',
    name: 'Relatorio Diario de Estoque',
    notificationType: 'STOCK',
    eventType: 'item.daily_stock_report',
    description: 'Relatorio diario agregado com itens que requerem atencao de estoque',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Verificacao diaria: {totalItems} item(s) requerem atencao',
        push: 'Verificacao diaria de estoque',
        email: {
          subject: 'Verificacao Diaria de Estoque - {totalItems} itens requerem atencao',
          body: 'Relatorio diario de verificacao de estoque:\n\n{stockSummary}\n\nItens sem estoque: {outOfStockCount}\nItens com estoque baixo: {lowStockCount}\nItens para recompra: {reorderCount}\n\nAcesse o sistema para detalhes completos.',
        },
        whatsapp: 'Verificacao de estoque: {totalItems} itens requerem atencao.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'WAREHOUSE'] },
  },
];

// ============================================================================
// 21. ARTWORK APPROVAL NOTIFICATIONS (3)
// Note: artwork.uploaded is NOT included here because task.field.artworks
// already handles notifications when artwork files are added/removed.
// These notifications focus specifically on the APPROVAL WORKFLOW (status changes).
// ============================================================================

const ARTWORK_CONFIGS: NotificationConfig[] = [
  {
    key: 'artwork.approved',
    name: 'Arte Aprovada',
    notificationType: 'PRODUCTION',
    eventType: 'artwork.approved',
    description: 'Notificacao enviada quando uma arte e aprovada',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Arte aprovada: "{taskName}" #{serialNumber} - Pronta para producao',
        push: 'Arte aprovada: {taskName}',
        email: {
          subject: 'Arte Aprovada - Tarefa #{serialNumber}',
          body: 'A arte foi aprovada:\n\nTarefa: {taskName} #{serialNumber}\nAprovada por: {changedBy}\nData: {changedAt}\n\nA tarefa esta pronta para a proxima etapa da producao.',
        },
        whatsapp: 'Arte aprovada: "{taskName}" #{serialNumber}. Pronta para producao!',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'DESIGNER', 'PRODUCTION'] },
  },
  {
    key: 'artwork.reproved',
    name: 'Arte Reprovada',
    notificationType: 'PRODUCTION',
    eventType: 'artwork.reproved',
    description: 'Notificacao enviada quando uma arte e reprovada e precisa de revisao',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Arte reprovada: "{taskName}" #{serialNumber} - Revisao necessaria',
        push: 'Arte reprovada: Revisao necessaria',
        email: {
          subject: 'Arte Reprovada - Tarefa #{serialNumber} - Revisao Necessaria',
          body: 'A arte foi reprovada e precisa de revisao:\n\nTarefa: {taskName} #{serialNumber}\nReprovada por: {changedBy}\nMotivo: {reason}\nData: {changedAt}\n\nPor favor, faca as correcoes necessarias e envie uma nova versao.',
        },
        whatsapp: 'Arte reprovada: "{taskName}" #{serialNumber}. Motivo: {reason}. Nova versao necessaria.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: { allowedSectors: ['ADMIN', 'DESIGNER'] },
  },
  {
    key: 'artwork.pending_approval_reminder',
    name: 'Lembrete de Arte Pendente',
    notificationType: 'PRODUCTION',
    eventType: 'artwork.pending_approval_reminder',
    description: 'Lembrete enviado quando uma arte esta aguardando aprovacao por mais de 24 horas',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Lembrete: Arte da tarefa "{taskName}" #{serialNumber} aguardando aprovacao ha {daysPending} dia(s)',
        push: 'Lembrete: Arte aguardando aprovacao',
        email: {
          subject: 'Lembrete: Arte Aguardando Aprovacao - Tarefa #{serialNumber}',
          body: 'LEMBRETE: Uma arte esta aguardando aprovacao:\n\nTarefa: {taskName} #{serialNumber}\nTempo aguardando: {daysPending} dia(s)\n\nPor favor, revise e aprove ou reprove a arte para que a producao possa continuar.',
        },
        whatsapp: 'Lembrete: Arte da tarefa #{serialNumber} aguardando aprovacao ha {daysPending} dia(s). Por favor, revise.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'COMMERCIAL'] },
  },
];

// ============================================================================
// 21. TIME ENTRY REMINDER NOTIFICATIONS (2)
// ============================================================================

const TIME_ENTRY_REMINDER_CONFIGS: NotificationConfig[] = [
  {
    key: 'timeentry.reminder',
    name: 'Lembrete de Registro de Ponto',
    notificationType: 'USER',
    eventType: 'timeentry.reminder',
    description: 'Lembrete enviado 15 minutos apos o horario esperado quando o colaborador ainda nao registrou seu ponto (entrada ou saida)',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 4, // One per entry type max (ENTRADA1, SAIDA1, ENTRADA2, SAIDA2)
    templates: {
      updated: {
        inApp: 'Lembrete: Voce ainda nao registrou sua {entryLabel}. Horario esperado: {expectedTime}.',
        push: 'Lembrete de Ponto',
        email: {
          subject: 'Lembrete de Registro de Ponto - {date}',
          body: 'Ola {userName},\n\nEste e um lembrete automatico informando que voce ainda nao registrou sua {entryLabel}.\n\nHorario esperado: {expectedTime}\nData: {date}\n\nPor favor, acesse o sistema de ponto para realizar o registro.\n\nEste e um lembrete automatico do sistema.',
        },
        whatsapp: 'Lembrete de Ponto: Voce ainda nao registrou sua {entryLabel}. Horario esperado: {expectedTime}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
    },
  },
  {
    key: 'timeentry.missing_daily',
    name: 'Resumo Diario de Pontos Pendentes',
    notificationType: 'USER',
    eventType: 'timeentry.missing_daily',
    description: 'Resumo enviado ao final do dia listando todos os registros de ponto que nao foram realizados',
    importance: 'HIGH',
    workHoursOnly: false, // Sent after work hours
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Atencao: Voce tem {missingCount} registro(s) de ponto pendente(s) hoje.',
        push: 'Pontos pendentes hoje!',
        email: {
          subject: 'ATENCAO: Registros de Ponto Pendentes - {date}',
          body: 'Ola {userName},\n\nIdentificamos que voce possui registros de ponto pendentes para hoje ({date}).\n\nRegistros faltantes:\n{missingEntries}\n\nPor favor, regularize seus registros de ponto ou entre em contato com o RH caso tenha alguma justificativa.\n\nEste e um lembrete automatico do sistema.',
        },
        whatsapp: 'ATENCAO: Voce tem {missingCount} registro(s) de ponto pendente(s) hoje. Regularize seu ponto!',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ALL_SECTORS,
    },
  },
];

// ============================================================================
// ALL CONFIGURATIONS
// ============================================================================

const ALL_NOTIFICATION_CONFIGS: NotificationConfig[] = [
  // Task Lifecycle (3)
  ...TASK_LIFECYCLE_CONFIGS,
  // Task Status Events (3)
  ...TASK_STATUS_CONFIGS,
  // Task Deadlines - Term (6)
  ...TASK_TERM_DEADLINE_CONFIGS,
  // Task Deadlines - Forecast (6)
  ...TASK_FORECAST_DEADLINE_CONFIGS,
  // Task Basic Fields (4)
  ...TASK_BASIC_FIELD_CONFIGS,
  // Task Date Fields (5)
  ...TASK_DATE_FIELD_CONFIGS,
  // Task Assignment Fields (3)
  ...TASK_ASSIGNMENT_FIELD_CONFIGS,
  // Task Financial Fields (6)
  ...TASK_FINANCIAL_FIELD_CONFIGS,
  // Task Artwork/Production Fields (5)
  ...TASK_ARTWORK_PRODUCTION_FIELD_CONFIGS,
  // Task Truck Fields (3)
  ...TASK_TRUCK_FIELD_CONFIGS,
  // Task Negotiation Fields (3)
  ...TASK_NEGOTIATION_FIELD_CONFIGS,
  // Service Orders (6)
  ...SERVICE_ORDER_CONFIGS,
  // Borrow (2)
  ...BORROW_CONFIGS,
  // Paint (1)
  ...PAINT_CONFIGS,
  // PPE/EPI (4)
  ...PPE_CONFIGS,
  // Alerts (10)
  ...ALERT_CONFIGS,
  // Cut Notifications (5)
  ...CUT_CONFIGS,
  // Order Notifications (5)
  ...ORDER_CONFIGS,
  // Additional Service Order (1)
  ...SERVICE_ORDER_ADDITIONAL_CONFIGS,
  // Item/Stock Detail (5)
  ...ITEM_STOCK_CONFIGS,
  // Artwork Approval (5)
  ...ARTWORK_CONFIGS,
  // Time Entry Reminders (4)
  ...TIME_ENTRY_REMINDER_CONFIGS,
];

// ============================================================================
// SEED FUNCTION
// ============================================================================

/**
 * Seeds ALL notification configurations to the database.
 *
 * This function:
 * 1. Clears all existing configurations (fresh start)
 * 2. Creates all notification configurations with their channels and target rules
 *
 * @param prisma - PrismaClient instance
 */
export async function seedAllNotificationConfigurations(prisma: PrismaClient): Promise<void> {
  console.log('========================================');
  console.log('UNIFIED NOTIFICATION CONFIGURATIONS SEED');
  console.log('========================================');
  console.log(`Total configurations to seed: ${ALL_NOTIFICATION_CONFIGS.length}`);
  console.log('');

  // Clear existing configurations (fresh start)
  console.log('Clearing existing configurations...');
  await prisma.notificationRule.deleteMany({});
  await prisma.notificationTargetRule.deleteMany({});
  await prisma.notificationSectorOverride.deleteMany({});
  await prisma.notificationChannelConfig.deleteMany({});
  await prisma.notificationConfiguration.deleteMany({});
  console.log('  Cleared all existing configurations');
  console.log('');

  // Seed each configuration
  let created = 0;
  let errors = 0;

  for (const config of ALL_NOTIFICATION_CONFIGS) {
    try {
      const notificationConfig = await prisma.notificationConfiguration.create({
        data: {
          key: config.key,
          name: config.name,
          notificationType: config.notificationType,
          eventType: config.eventType,
          description: config.description,
          enabled: true,
          importance: config.importance,
          workHoursOnly: config.workHoursOnly,
          batchingEnabled: false,
          maxFrequencyPerDay: config.maxFrequencyPerDay ?? null,
          templates: config.templates as Prisma.JsonValue,
          metadata: (config.metadata ?? null) as Prisma.JsonValue,
          channelConfigs: {
            create: config.channelConfigs.map((cc) => ({
              channel: cc.channel,
              enabled: cc.enabled,
              mandatory: cc.mandatory,
              defaultOn: cc.defaultOn,
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
      });

      console.log(`  ✓ ${config.key} (${config.importance})`);
      created++;
    } catch (error) {
      console.error(`  ✗ ${config.key}: ${(error as Error).message}`);
      errors++;
    }
  }

  console.log('');
  console.log('========================================');
  console.log('SEED SUMMARY');
  console.log('========================================');
  console.log(`  Created: ${created}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${ALL_NOTIFICATION_CONFIGS.length}`);
  console.log('');

  if (errors === 0) {
    console.log('All notification configurations seeded successfully!');
  } else {
    console.log('Some configurations failed to seed. Please check the errors above.');
  }
}

// ============================================================================
// STANDALONE EXECUTION
// ============================================================================

if (require.main === module) {
  const prisma = new PrismaClient();

  seedAllNotificationConfigurations(prisma)
    .then(() => {
      console.log('\nDone!');
    })
    .catch((error) => {
      console.error('Error seeding notification configurations:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export default seedAllNotificationConfigurations;
