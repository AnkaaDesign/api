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
 * 1. Task Lifecycle (2) - created, overdue
 * 2. Task Status Events (4) - waiting_production, in_production, completed, ready_for_production
 * 3. Task Deadlines - Term (5) - 1hour, 4hours, 1day, 3days, 7days
 * 4. Task Deadlines - Forecast (6) - 10days, 7days, 3days, 1day, today, overdue
 * 5. Task Basic Fields (5) - name, status, details, serialNumber, priority
 * 6. Task Date Fields (5)
 * 7. Task Assignment Fields (3)
 * 8. Task Financial Fields (6)
 * 9. Task Artwork/Production Fields (5)
 * 10. Task Truck Fields (8) - plate, spot, chassisNumber, category, implementType, leftSideLayoutId, rightSideLayoutId, backSideLayoutId
 * 11. Task Negotiation Fields (2)
 * 12. Service Orders - Type-Specific (7 events x 5 types + 1 artwork waiting_approval = 36)
 * 13. Borrow/Emprestimo (2)
 * 14. Paint/Tinta (1)
 * 15. PPE/EPI (4)
 * 16. Alerts (0) - removed, no code emits alert events yet
 * 17. Cut/Recorte (5)
 * 18. Order/Pedido (5)
 * 19. Item/Stock Detail (4)
 * 20. Artwork Approval (3)
 * 21. Time Entry Reminders (1)
 *
 * TOTAL: 112 notifications
 *
 * Last updated: 2026
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

// Service Order type-specific sector mappings
const SO_TYPE_PRODUCTION_SECTORS: SectorPrivileges[] = ['ADMIN', 'PRODUCTION', 'LOGISTIC'];
const SO_TYPE_FINANCIAL_SECTORS: SectorPrivileges[] = ['ADMIN', 'FINANCIAL'];
const SO_TYPE_COMMERCIAL_SECTORS: SectorPrivileges[] = ['ADMIN', 'COMMERCIAL', 'FINANCIAL'];
const SO_TYPE_ARTWORK_SECTORS: SectorPrivileges[] = ['ADMIN', 'DESIGNER'];
const SO_TYPE_LOGISTIC_SECTORS: SectorPrivileges[] = ['ADMIN', 'LOGISTIC'];

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
// 1. TASK LIFECYCLE NOTIFICATIONS (2)
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
];

// ============================================================================
// 2. TASK STATUS EVENTS (4)
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
  {
    key: 'task.ready_for_production',
    name: 'Tarefa Pronta para Producao',
    notificationType: 'PRODUCTION',
    eventType: 'ready_for_production',
    description: 'Notificacao enviada especificamente ao setor de producao quando uma tarefa esta pronta para iniciar a producao',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Pronta para producao: "{taskName}" #{serialNumber} - Todos os preparativos concluidos',
        push: 'Tarefa pronta para producao!',
        email: {
          subject: 'Tarefa pronta para producao - #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) esta pronta para iniciar a producao.\n\nTodos os preparativos foram concluidos e a tarefa pode ser iniciada.\n\nAlterado por: {changedBy}',
        },
        whatsapp: 'Tarefa "{taskName}" #{serialNumber} pronta para producao. Iniciada por {changedBy}.',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION'],
    },
  },
];

// ============================================================================
// 3. TASK DEADLINES - TERM (5)
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
];

// ============================================================================
// 4. TASK FORECAST - PREVISAO DE LIBERACAO (6)
// The forecast date (forecastDate) is the expected date when the truck
// will be liberated/available for painting. These notifications alert
// teams as the liberation date approaches.
// ============================================================================

const TASK_FORECAST_DEADLINE_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.forecast_10days',
    name: 'Liberacao em 10 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_10days',
    description: 'Notificacao enviada 10 dias antes da previsao de liberacao do caminhao',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Liberacao se aproximando: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar em 10 dias',
        push: 'Liberacao em 10 dias: {taskName}',
        email: {
          subject: 'Liberacao em 10 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de liberacao do caminhao em 10 dias.\n\nData de liberacao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se os preparativos estao em andamento.',
        },
        whatsapp: 'Liberacao em 10 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_7days',
    name: 'Liberacao em 7 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_7days',
    description: 'Notificacao enviada 7 dias antes da previsao de liberacao do caminhao',
    importance: 'NORMAL',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Liberacao se aproximando: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar em 7 dias',
        push: 'Liberacao em 7 dias: {taskName}',
        email: {
          subject: 'Liberacao em 7 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de liberacao do caminhao em 7 dias.\n\nData de liberacao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n\nVerifique se os preparativos estao em andamento.',
        },
        whatsapp: 'Liberacao em 7 dias: Tarefa "{taskName}" #{serialNumber}.',
      },
    },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_3days',
    name: 'Liberacao em 3 Dias',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_3days',
    description: 'Notificacao enviada 3 dias antes da previsao de liberacao do caminhao',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Liberacao em 3 dias: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar em 3 dias{pendingOrdersText}',
        push: 'Liberacao em 3 dias: {taskName}',
        email: {
          subject: 'Liberacao em 3 dias - Tarefa #{serialNumber}',
          body: 'A tarefa "{taskName}" (#{serialNumber}) tem previsao de liberacao do caminhao em 3 dias.\n\nData de liberacao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se todos os preparativos estao concluidos.',
        },
        whatsapp: 'Liberacao em 3 dias: Tarefa "{taskName}" #{serialNumber}.{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_1day',
    name: 'Liberacao Amanha',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_1day',
    description: 'Notificacao enviada 1 dia antes da previsao de liberacao do caminhao, incluindo verificacao de pedidos pendentes',
    importance: 'HIGH',
    workHoursOnly: true,
    maxFrequencyPerDay: 1,
    templates: {
      updated: {
        inApp: 'Liberacao amanha: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar AMANHA{pendingOrdersText}',
        push: 'Liberacao amanha: {taskName}',
        email: {
          subject: 'Liberacao amanha - Tarefa #{serialNumber}',
          body: 'ATENCAO: A tarefa "{taskName}" (#{serialNumber}) tem previsao de liberacao do caminhao AMANHA.\n\nData de liberacao: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se tudo esta pronto para a producao.',
        },
        whatsapp: 'Liberacao amanha: Tarefa "{taskName}" #{serialNumber}.{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_HIGH,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_today',
    name: 'Liberacao Hoje',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_today',
    description: 'Notificacao urgente enviada quando a previsao de liberacao do caminhao e hoje',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 2,
    templates: {
      updated: {
        inApp: 'HOJE: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar HOJE{pendingOrdersText}',
        push: 'HOJE: Liberacao do caminhao!',
        email: {
          subject: 'URGENTE: Liberacao HOJE - Tarefa #{serialNumber}',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) tem previsao de liberacao do caminhao para HOJE.\n\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nVerifique se a producao esta em andamento.',
        },
        whatsapp: 'HOJE: Tarefa "{taskName}" #{serialNumber} - caminhao previsto para liberar HOJE!{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL'],
    },
  },
  {
    key: 'task.forecast_overdue',
    name: 'Liberacao Atrasada',
    notificationType: 'PRODUCTION',
    eventType: 'forecast_overdue',
    description: 'Notificacao urgente enviada quando a previsao de liberacao do caminhao esta atrasada',
    importance: 'URGENT',
    workHoursOnly: false,
    maxFrequencyPerDay: 3,
    templates: {
      updated: {
        inApp: 'ATRASADO: Tarefa "{taskName}" #{serialNumber} - liberacao atrasada ha {daysOverdue} dia(s){pendingOrdersText}',
        push: 'ATRASADO: Liberacao vencida!',
        email: {
          subject: 'URGENTE: Liberacao atrasada - Tarefa #{serialNumber}',
          body: 'ATENCAO URGENTE!\n\nA tarefa "{taskName}" (#{serialNumber}) esta com a previsao de liberacao ATRASADA ha {daysOverdue} dia(s).\n\nData de liberacao original: {forecast}\nStatus atual: {status}\nSetor: {sectorName}\n{pendingOrdersText}\n\nE necessaria acao imediata para resolver esta situacao.',
        },
        whatsapp: 'URGENTE: Tarefa "{taskName}" #{serialNumber} - liberacao ATRASADA ha {daysOverdue} dia(s)!{pendingOrdersText}',
      },
    },
    channelConfigs: CHANNELS_URGENT,
    targetRule: {
      allowedSectors: ['ADMIN', 'PRODUCTION', 'COMMERCIAL', 'FINANCIAL'],
    },
  },
];

// ============================================================================
// 5. TASK BASIC FIELDS (5)
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
  {
    key: 'task.field.priority',
    name: 'Prioridade da Tarefa',
    notificationType: 'PRODUCTION',
    eventType: 'field.priority',
    description: 'Notificacao enviada quando a prioridade da tarefa e alterada',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Prioridade alterada: "{taskName}" #{serialNumber} - {oldValue} para {newValue}',
        push: 'Prioridade alterada: {newValue}',
        email: {
          subject: 'Prioridade alterada - Tarefa #{serialNumber}',
          body: 'A prioridade da tarefa "{taskName}" (#{serialNumber}) foi alterada de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: 'Prioridade da tarefa #{serialNumber} alterada para {newValue}.',
      },
    },
    metadata: { field: 'priority', category: 'BASIC' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
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
    name: 'Prazo de Conclusao',
    notificationType: 'PRODUCTION',
    eventType: 'field.term',
    description: 'Notificacao quando o prazo para concluir a pintura/tarefa e alterado ou removido',
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
    name: 'Previsao de Liberacao',
    notificationType: 'PRODUCTION',
    eventType: 'field.forecastDate',
    description: 'Notificacao quando a previsao de liberacao do caminhao e alterada ou removida',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Previsao de liberacao alterada para {newValue}',
        push: 'Liberacao: {newValue}',
        email: {
          subject: 'Previsao de liberacao - Tarefa #{serialNumber}',
          body: 'A previsao de liberacao do caminhao da tarefa "{taskName}" foi alterada para {newValue} por {changedBy}.',
        },
        whatsapp: 'Previsao de liberacao da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Previsao de liberacao removida',
        push: 'Liberacao removida',
        email: {
          subject: 'Previsao de liberacao removida - Tarefa #{serialNumber}',
          body: 'A previsao de liberacao do caminhao da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: 'Previsao de liberacao da tarefa #{serialNumber} foi removida.',
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
// 10. TASK TRUCK FIELDS (8)
// ============================================================================

const TASK_TRUCK_FIELD_CONFIGS: NotificationConfig[] = [
  {
    key: 'task.field.truck.plate',
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
    },
    metadata: { field: 'truck.plate', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.field.truck.spot',
    name: 'Localizacao do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.spot',
    description: 'Notificacao enviada quando a localizacao do caminhao e alterada na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Localizacao alterada: "{taskName}" #{serialNumber} - Local: {newValue}',
        push: 'Localizacao do caminhao alterada',
        email: {
          subject: 'Localizacao do caminhao alterada - Tarefa #{serialNumber}',
          body: 'A localizacao do caminhao foi alterada na tarefa "{taskName}" (#{serialNumber}).\n\nLocalizacao anterior: {oldValue}\nNova localizacao: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Localizacao alterada na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
    },
    metadata: { field: 'truck.spot', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.field.truck.chassisNumber',
    name: 'Chassi do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.chassisNumber',
    description: 'Notificacao enviada quando o numero do chassi do caminhao e alterado na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Chassi alterado: "{taskName}" #{serialNumber} - Chassi: {newValue}',
        push: 'Chassi do caminhao alterado',
        email: {
          subject: 'Chassi do caminhao alterado - Tarefa #{serialNumber}',
          body: 'O chassi do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nChassi anterior: {oldValue}\nNovo chassi: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Chassi alterado na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
    },
    metadata: { field: 'truck.chassisNumber', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.field.truck.category',
    name: 'Categoria do Caminhao',
    notificationType: 'PRODUCTION',
    eventType: 'truck.category',
    description: 'Notificacao enviada quando a categoria do caminhao e alterada na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Categoria alterada: "{taskName}" #{serialNumber} - Categoria: {newValue}',
        push: 'Categoria do caminhao alterada',
        email: {
          subject: 'Categoria do caminhao alterada - Tarefa #{serialNumber}',
          body: 'A categoria do caminhao foi alterada na tarefa "{taskName}" (#{serialNumber}).\n\nCategoria anterior: {oldValue}\nNova categoria: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Categoria alterada na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
    },
    metadata: { field: 'truck.category', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.field.truck.implementType',
    name: 'Tipo de Implemento',
    notificationType: 'PRODUCTION',
    eventType: 'truck.implementType',
    description: 'Notificacao enviada quando o tipo de implemento do caminhao e alterado na tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Tipo de implemento alterado: "{taskName}" #{serialNumber} - Implemento: {newValue}',
        push: 'Tipo de implemento alterado',
        email: {
          subject: 'Tipo de implemento alterado - Tarefa #{serialNumber}',
          body: 'O tipo de implemento do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nTipo anterior: {oldValue}\nNovo tipo: {newValue}\nAlterado por: {changedBy}',
        },
        whatsapp: 'Implemento alterado na tarefa "{taskName}" #{serialNumber}: {newValue}.',
      },
    },
    metadata: { field: 'truck.implementType', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_ONLY,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'LOGISTIC'] },
  },
  {
    key: 'task.field.truck.leftSideLayoutId',
    name: 'Layout Lado Esquerdo',
    notificationType: 'PRODUCTION',
    eventType: 'truck.leftSideLayoutId',
    description: 'Notificacao enviada quando o layout do lado esquerdo do caminhao e alterado',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Layout lado esquerdo alterado: "{taskName}" #{serialNumber}',
        push: 'Layout lado esquerdo alterado',
        email: {
          subject: 'Layout lado esquerdo alterado - Tarefa #{serialNumber}',
          body: 'O layout do lado esquerdo do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nAlterado por: {changedBy}',
        },
        whatsapp: 'Layout lado esquerdo alterado na tarefa "{taskName}" #{serialNumber}.',
      },
    },
    metadata: { field: 'truck.leftSideLayoutId', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER'] },
  },
  {
    key: 'task.field.truck.rightSideLayoutId',
    name: 'Layout Lado Direito',
    notificationType: 'PRODUCTION',
    eventType: 'truck.rightSideLayoutId',
    description: 'Notificacao enviada quando o layout do lado direito do caminhao e alterado',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Layout lado direito alterado: "{taskName}" #{serialNumber}',
        push: 'Layout lado direito alterado',
        email: {
          subject: 'Layout lado direito alterado - Tarefa #{serialNumber}',
          body: 'O layout do lado direito do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nAlterado por: {changedBy}',
        },
        whatsapp: 'Layout lado direito alterado na tarefa "{taskName}" #{serialNumber}.',
      },
    },
    metadata: { field: 'truck.rightSideLayoutId', category: 'PRODUCTION' },
    channelConfigs: CHANNELS_IN_APP_PUSH,
    targetRule: { allowedSectors: ['ADMIN', 'PRODUCTION', 'DESIGNER'] },
  },
  {
    key: 'task.field.truck.backSideLayoutId',
    name: 'Layout Traseira',
    notificationType: 'PRODUCTION',
    eventType: 'truck.backSideLayoutId',
    description: 'Notificacao enviada quando o layout da traseira do caminhao e alterado',
    importance: 'HIGH',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: 'Layout traseira alterado: "{taskName}" #{serialNumber}',
        push: 'Layout traseira alterado',
        email: {
          subject: 'Layout traseira alterado - Tarefa #{serialNumber}',
          body: 'O layout da traseira do caminhao foi alterado na tarefa "{taskName}" (#{serialNumber}).\n\nAlterado por: {changedBy}',
        },
        whatsapp: 'Layout traseira alterado na tarefa "{taskName}" #{serialNumber}.',
      },
    },
    metadata: { field: 'truck.backSideLayoutId', category: 'PRODUCTION' },
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
// 12. SERVICE ORDER NOTIFICATIONS - TYPE-SPECIFIC (9 events x 5 types = 45)
// ============================================================================

/**
 * Generates 8 notification configs for a specific SO type.
 * Each SO type gets its own set of configs targeting the correct sectors.
 */
function generateSOConfigsForType(
  soType: string,
  typeLower: string,
  typeLabel: string,
  sectors: SectorPrivileges[],
  options?: { includeWaitingApproval?: boolean },
): NotificationConfig[] {
  const configs: NotificationConfig[] = [
    {
      key: `service_order.created.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Criada`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.created.${typeLower}`,
      description: `Notificacao enviada quando uma nova ordem de servico do tipo ${typeLabel} e criada`,
      importance: 'NORMAL',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{id} criada para a tarefa "{taskName}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Nova ordem de servico criada`,
          email: {
            subject: `Nova Ordem de Servico ${typeLabel} #{id} Criada`,
            body: `Uma nova ordem de servico (${typeLabel}) foi criada:\n\nOrdem de Servico: #{id}\nTarefa: {taskName}\nTipo: ${typeLabel}\nDescricao: {description}\nCriada por: {changedBy}`,
          },
          whatsapp: `Nova Ordem de Servico ${typeLabel} #{id} criada para tarefa "{taskName}". Criada por {changedBy}.`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_ONLY,
      targetRule: { allowedSectors: sectors },
    },
    {
      key: `service_order.assigned.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Atribuida`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.assigned.${typeLower}`,
      description: `Notificacao enviada quando uma Ordem de Servico ${typeLabel} e atribuida a um usuario`,
      importance: 'HIGH',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{id} atribuida a {assignedTo}: "{description}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Voce foi atribuido`,
          email: {
            subject: `Ordem de Servico ${typeLabel} #{id} Atribuida a Voce`,
            body: `Uma ordem de servico (${typeLabel}) foi atribuida a voce:\n\nOrdem de Servico: #{id}\nDescricao: {description}\nAtribuido por: {assignedBy}\nAtribuido para: {assignedTo}\n\nPor favor, verifique os detalhes e inicie o trabalho assim que possivel.`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{id} atribuida a {assignedTo} por {assignedBy}.`,
        },
      },
      channelConfigs: CHANNELS_HIGH,
      targetRule: {
        allowedSectors: ALL_SECTORS,
        customFilter: 'SERVICE_ORDER_ASSIGNEE',
      },
    },
    {
      key: `service_order.started.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Iniciada`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.started.${typeLower}`,
      description: `Notificacao enviada quando uma Ordem de Servico ${typeLabel} e iniciada`,
      importance: 'NORMAL',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{id} iniciada: "{description}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Ordem de servico iniciada`,
          email: {
            subject: `Ordem de Servico ${typeLabel} #{id} Iniciada`,
            body: `A ordem de servico (${typeLabel}) foi iniciada:\n\nOrdem de Servico: #{id}\nDescricao: {description}\nIniciada por: {changedBy}\nData de inicio: {startedAt}`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{id} iniciada. Iniciada por {changedBy}.`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_ONLY,
      targetRule: { allowedSectors: sectors },
    },
    {
      key: `service_order.completed.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Concluida`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.completed.${typeLower}`,
      description: `Notificacao enviada quando uma Ordem de Servico ${typeLabel} e concluida`,
      importance: 'HIGH',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{id} concluida: "{description}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Ordem de servico concluida`,
          email: {
            subject: `Ordem de Servico ${typeLabel} #{id} Concluida`,
            body: `A ordem de servico (${typeLabel}) foi concluida:\n\nOrdem de Servico: #{id}\nDescricao: {description}\nConcluida por: {changedBy}\nData de conclusao: {completedAt}`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{id} concluida. Concluida por {changedBy}.`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_PUSH,
      targetRule: { allowedSectors: sectors },
    },
    {
      key: `service_order.cancelled.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Cancelada`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.cancelled.${typeLower}`,
      description: `Notificacao enviada quando uma Ordem de Servico ${typeLabel} e cancelada`,
      importance: 'HIGH',
      workHoursOnly: false,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{id} cancelada: "{description}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Ordem de servico cancelada`,
          email: {
            subject: `Ordem de Servico ${typeLabel} #{id} Cancelada`,
            body: `A ordem de servico (${typeLabel}) foi cancelada:\n\nOrdem de Servico: #{id}\nDescricao: {description}\nCancelada por: {changedBy}\nMotivo: {cancellationReason}`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{id} cancelada. Cancelada por {changedBy}. Motivo: {cancellationReason}`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_PUSH,
      targetRule: { allowedSectors: sectors },
    },
    {
      key: `service_order.observation_changed.${typeLower}`,
      name: `Observacao de Ordem de Servico ${typeLabel} Alterada`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.observation_changed.${typeLower}`,
      description: `Notificacao enviada quando a observacao de uma Ordem de Servico ${typeLabel} e alterada`,
      importance: 'NORMAL',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Observacao da Ordem de Servico ${typeLabel} #{id} alterada na tarefa "{taskName}"`,
          push: `Ordem de Servico ${typeLabel} #{id}: Observacao alterada`,
          email: {
            subject: `Observacao Alterada - Ordem de Servico ${typeLabel} #{id}`,
            body: `A observacao de uma ordem de servico (${typeLabel}) foi alterada:\n\nOrdem de Servico: #{id}\nTarefa: {taskName}\nAlterada por: {changedBy}\n\nObservacao anterior: {oldObservation}\nNova observacao: {newObservation}`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{id}: Observacao alterada por {changedBy}.`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_ONLY,
      targetRule: { allowedSectors: sectors },
    },
    {
      key: `service_order.status_changed_for_creator.${typeLower}`,
      name: `Status da Ordem de Servico ${typeLabel} Alterado (Criador)`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.status_changed_for_creator.${typeLower}`,
      description: `Notificacao enviada ao criador de uma Ordem de Servico ${typeLabel} quando o status e alterado por outra pessoa`,
      importance: 'NORMAL',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Sua Ordem de Servico ${typeLabel} #{id} mudou de status: {oldStatus} para {newStatus}`,
          push: `Ordem de Servico ${typeLabel} #{id}: Status alterado para {newStatus}`,
          email: {
            subject: `Status Alterado - Ordem de Servico ${typeLabel} #{id}`,
            body: `O status de uma ordem de servico (${typeLabel}) que voce criou foi alterado:\n\nOrdem de Servico: #{id}\nTarefa: {taskName}\nStatus anterior: {oldStatus}\nNovo status: {newStatus}\nAlterado por: {changedBy}`,
          },
          whatsapp: `Sua Ordem de Servico ${typeLabel} #{id} mudou para {newStatus}. Alterado por {changedBy}.`,
        },
      },
      channelConfigs: CHANNELS_IN_APP_PUSH,
      targetRule: { allowedSectors: ALL_SECTORS },
    },
  ];

  // Only ARTWORK type uses WAITING_APPROVE status
  if (options?.includeWaitingApproval) {
    configs.push({
      key: `service_order.waiting_approval.${typeLower}`,
      name: `Ordem de Servico ${typeLabel} Aguardando Aprovacao`,
      notificationType: 'PRODUCTION',
      eventType: `service_order.waiting_approval.${typeLower}`,
      description: `Notificacao enviada quando uma Ordem de Servico ${typeLabel} esta aguardando aprovacao`,
      importance: 'HIGH',
      workHoursOnly: true,
      templates: {
        updated: {
          inApp: `Ordem de Servico ${typeLabel} #{serviceOrderNumber} aguardando aprovacao`,
          push: `Ordem de Servico ${typeLabel} aguardando aprovacao`,
          email: {
            subject: `Ordem de Servico ${typeLabel} #{serviceOrderNumber} - Aguardando Aprovacao`,
            body: `Uma ordem de servico (${typeLabel}) esta aguardando sua aprovacao:\n\nNumero: #{serviceOrderNumber}\nDescricao: {description}\nExecutado por: {executedBy}\nData: {completedDate}\n\nAcesse o sistema para aprovar ou rejeitar.`,
          },
          whatsapp: `Ordem de Servico ${typeLabel} #{serviceOrderNumber} aguardando aprovacao. Verificar sistema.`,
        },
      },
      channelConfigs: CHANNELS_HIGH,
      targetRule: { allowedSectors: sectors },
    });
  }

  return configs;
}

const SERVICE_ORDER_TYPE_CONFIGS: NotificationConfig[] = [
  ...generateSOConfigsForType('PRODUCTION', 'production', 'Producao', SO_TYPE_PRODUCTION_SECTORS),
  ...generateSOConfigsForType('FINANCIAL', 'financial', 'Financeira', SO_TYPE_FINANCIAL_SECTORS),
  ...generateSOConfigsForType('COMMERCIAL', 'commercial', 'Comercial', SO_TYPE_COMMERCIAL_SECTORS),
  ...generateSOConfigsForType('ARTWORK', 'artwork', 'Arte', SO_TYPE_ARTWORK_SECTORS, { includeWaitingApproval: true }),
  ...generateSOConfigsForType('LOGISTIC', 'logistic', 'Logistica', SO_TYPE_LOGISTIC_SECTORS),
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
// 16. ALERT NOTIFICATIONS
// NOTE: Alert configs removed - no code currently emits alert.* events.
// These can be re-added when alert systems are implemented.
// ============================================================================

const ALERT_CONFIGS: NotificationConfig[] = [];

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
    name: 'Recortes Adicionados',
    notificationType: 'PRODUCTION',
    eventType: 'cuts.added.to.task',
    description: 'Notificacao enviada quando recortes sao adicionados a uma tarefa',
    importance: 'NORMAL',
    workHoursOnly: true,
    templates: {
      updated: {
        inApp: '{count} recorte(s) adicionado(s) para tarefa "{taskName}" #{serialNumber}',
        push: 'Recortes adicionados',
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

// (SERVICE_ORDER_ADDITIONAL_CONFIGS removed - merged into SERVICE_ORDER_TYPE_CONFIGS above)

// ============================================================================
// 20. ITEM/STOCK DETAIL NOTIFICATIONS (4)
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
// 21. TIME ENTRY REMINDER NOTIFICATIONS (1)
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
];

// ============================================================================
// ALL CONFIGURATIONS
// ============================================================================

const ALL_NOTIFICATION_CONFIGS: NotificationConfig[] = [
  // Task Lifecycle (2)
  ...TASK_LIFECYCLE_CONFIGS,
  // Task Status Events (4)
  ...TASK_STATUS_CONFIGS,
  // Task Deadlines - Term (5)
  ...TASK_TERM_DEADLINE_CONFIGS,
  // Task Deadlines - Forecast (6)
  ...TASK_FORECAST_DEADLINE_CONFIGS,
  // Task Basic Fields (5)
  ...TASK_BASIC_FIELD_CONFIGS,
  // Task Date Fields (5)
  ...TASK_DATE_FIELD_CONFIGS,
  // Task Assignment Fields (3)
  ...TASK_ASSIGNMENT_FIELD_CONFIGS,
  // Task Financial Fields (6)
  ...TASK_FINANCIAL_FIELD_CONFIGS,
  // Task Artwork/Production Fields (5)
  ...TASK_ARTWORK_PRODUCTION_FIELD_CONFIGS,
  // Task Truck Fields (8)
  ...TASK_TRUCK_FIELD_CONFIGS,
  // Task Negotiation Fields (3)
  ...TASK_NEGOTIATION_FIELD_CONFIGS,
  // Service Orders - Type-Specific (36)
  ...SERVICE_ORDER_TYPE_CONFIGS,
  // Borrow (2)
  ...BORROW_CONFIGS,
  // Paint (1)
  ...PAINT_CONFIGS,
  // PPE/EPI (4)
  ...PPE_CONFIGS,
  // Alerts (0)
  ...ALERT_CONFIGS,
  // Cut Notifications (5)
  ...CUT_CONFIGS,
  // Order Notifications (5)
  ...ORDER_CONFIGS,
  // Item/Stock Detail (4)
  ...ITEM_STOCK_CONFIGS,
  // Artwork Approval (5)
  ...ARTWORK_CONFIGS,
  // Time Entry Reminders (1)
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
