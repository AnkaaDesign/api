import {
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  SECTOR_PRIVILEGES,
} from '../../../constants/enums';

/**
 * Task Field Categories - Used for organizing and filtering notifications
 */
export enum TaskFieldCategory {
  /** Lifecycle events (created, overdue) */
  LIFECYCLE = 'LIFECYCLE',
  /** Basic info fields (name, status, details, serial) */
  BASIC = 'BASIC',
  /** Date-related fields (entryDate, term, forecastDate, startedAt, finishedAt) */
  DATES = 'DATES',
  /** Assignment fields (sectorId, customerId, invoiceToId) */
  ASSIGNMENT = 'ASSIGNMENT',
  /** Financial fields - RESTRICTED (commission, budgets, invoices, receipts, reimbursements) */
  FINANCIAL = 'FINANCIAL',
  /** Artwork and design files (artworks) */
  ARTWORK = 'ARTWORK',
  /** Negotiation fields (negotiatingWith) */
  NEGOTIATION = 'NEGOTIATION',
  /** Production fields (paintId, observation) */
  PRODUCTION = 'PRODUCTION',
}

/**
 * Default roles for each category (fallback when field doesn't have specific allowedRoles)
 */
export const CATEGORY_ALLOWED_ROLES: Record<TaskFieldCategory, SECTOR_PRIVILEGES[]> = {
  [TaskFieldCategory.LIFECYCLE]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
  ],
  [TaskFieldCategory.BASIC]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],
  [TaskFieldCategory.DATES]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],
  [TaskFieldCategory.ASSIGNMENT]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],
  [TaskFieldCategory.FINANCIAL]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
  [TaskFieldCategory.ARTWORK]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
  [TaskFieldCategory.NEGOTIATION]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  ],
  [TaskFieldCategory.PRODUCTION]: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
};

/**
 * Field-specific role overrides - takes precedence over category roles
 * This allows granular control per notification event
 */
export const FIELD_ALLOWED_ROLES: Record<string, SECTOR_PRIVILEGES[]> = {
  // LIFECYCLE events - created goes to preparation sectors, overdue to production sectors
  created: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.FINANCIAL, SECTOR_PRIVILEGES.COMMERCIAL],
  overdue: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.FINANCIAL],

  // DATE events - granular control
  deadline: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
  forecastDate: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  ],
  term: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],
  finishedAt: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],

  // ASSIGNMENT events
  sector: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
  ],

  // ARTWORK events
  artworks: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],
  baseFiles: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.DESIGNER,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],

  // REPRESENTATIVE events - visible to privileged users only
  representatives: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  ],
  // DEPRECATED: Kept for backward compatibility with existing preferences
  negotiatingWith: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  ],

  // PRODUCTION events
  paint: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.WAREHOUSE],
  logoPaints: [SECTOR_PRIVILEGES.ADMIN, SECTOR_PRIVILEGES.PRODUCTION, SECTOR_PRIVILEGES.WAREHOUSE],
  observation: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.PRODUCTION,
    SECTOR_PRIVILEGES.COMMERCIAL,
  ],

  // FINANCIAL events - commission is visible to those who receive it
  commission: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.PRODUCTION,
  ],

  // invoiceToId - visible to privileged users
  invoiceToId: [
    SECTOR_PRIVILEGES.ADMIN,
    SECTOR_PRIVILEGES.FINANCIAL,
    SECTOR_PRIVILEGES.COMMERCIAL,
    SECTOR_PRIVILEGES.LOGISTIC,
    SECTOR_PRIVILEGES.DESIGNER,
  ],
};

/**
 * Channel message templates interface
 */
export interface ChannelMessages {
  /** In-app notification message (short) */
  inApp: string;
  /** Push notification message (very short) */
  push: string;
  /** Email subject and body template */
  email: {
    subject: string;
    body: string;
  };
  /** WhatsApp message (conversational) */
  whatsapp: string;
}

/**
 * Complete configuration for a task field notification
 */
export interface TaskFieldNotificationConfig {
  /** Database field name */
  field: string;
  /** Portuguese display label */
  label: string;
  /** Field category for role-based filtering */
  category: TaskFieldCategory;
  /** Notification importance level */
  importance: NOTIFICATION_IMPORTANCE;
  /** Default channels for this field (user preferences override) */
  defaultChannels: NOTIFICATION_CHANNEL[];
  /** Whether this field should trigger notifications */
  enabled: boolean;
  /** Whether this is a file array field (artworks, budgets, etc.) */
  isFileArray: boolean;
  /** Message templates for each channel */
  messages: {
    /** Message when value is set/updated */
    updated: ChannelMessages;
    /** Message when value is cleared/removed (optional) */
    cleared?: ChannelMessages;
    /** For file arrays: message when files are added */
    filesAdded?: ChannelMessages;
    /** For file arrays: message when files are removed */
    filesRemoved?: ChannelMessages;
  };
  /** Custom value formatter function name */
  formatter?: string;
}

/**
 * Complete Task Field Notification Configuration
 *
 * This configuration defines ALL task fields that should trigger notifications,
 * with role-based access control and Portuguese messages for all channels.
 */
export const TASK_FIELD_NOTIFICATIONS: TaskFieldNotificationConfig[] = [
  // =====================
  // LIFECYCLE EVENTS
  // =====================
  {
    field: 'created',
    label: 'Nova Tarefa',
    category: TaskFieldCategory.LIFECYCLE,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Nova tarefa criada: "{taskName}"',
        push: 'Nova tarefa criada',
        email: {
          subject: '🆕 Nova tarefa criada: {taskName}',
          body: 'Uma nova tarefa foi criada:\n\nNome: {taskName}\nNúmero de Série: {serialNumber}\nCriada por: {changedBy}\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: '🆕 Nova tarefa criada: "{taskName}" por {changedBy}.',
      },
    },
  },
  {
    field: 'overdue',
    label: 'Tarefa Atrasada',
    category: TaskFieldCategory.LIFECYCLE,
    importance: NOTIFICATION_IMPORTANCE.URGENT,
    defaultChannels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.EMAIL,
    ],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Tarefa atrasada: "{taskName}" está atrasada há {daysOverdue} dia(s)',
        push: 'Tarefa atrasada!',
        email: {
          subject: '⚠️ URGENTE: Tarefa #{serialNumber} atrasada',
          body: 'ATENÇÃO: A tarefa "{taskName}" está atrasada há {daysOverdue} dia(s).\n\nÉ necessário tomar uma ação imediata para resolver esta situação.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp:
          '⚠️ URGENTE: Tarefa #{serialNumber} "{taskName}" está atrasada há {daysOverdue} dia(s)!',
      },
    },
  },

  // =====================
  // BASIC FIELDS
  // =====================
  {
    field: 'name',
    label: 'Nome',
    category: TaskFieldCategory.BASIC,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Nome da tarefa alterado de {oldValue} para {newValue}',
        push: 'Tarefa renomeada: {newValue}',
        email: {
          subject: 'Alteração no nome da tarefa #{serialNumber}',
          body: 'O nome da tarefa foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.',
        },
        whatsapp: '📝 A tarefa #{serialNumber} foi renomeada de *{oldValue}* para *{newValue}*.',
      },
    },
  },
  {
    field: 'status',
    label: 'Status',
    category: TaskFieldCategory.BASIC,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Status alterado de {oldValue} para {newValue}',
        push: 'Status: {newValue}',
        email: {
          subject: 'Status da tarefa #{serialNumber} alterado',
          body: 'O status da tarefa <strong>{taskName}</strong> foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.\n\nAcesse o sistema para mais detalhes.',
        },
        whatsapp: '🔄 A tarefa #{serialNumber} mudou de *{oldValue}* para *{newValue}*.',
      },
    },
    formatter: 'formatStatus',
  },
  {
    field: 'details',
    label: 'Detalhes',
    category: TaskFieldCategory.BASIC,
    importance: NOTIFICATION_IMPORTANCE.LOW,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Detalhes da tarefa foram atualizados',
        push: 'Detalhes atualizados',
        email: {
          subject: 'Detalhes da tarefa #{serialNumber} atualizados',
          body: 'Os detalhes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: '📄 Os detalhes da tarefa #{serialNumber} foram atualizados.',
      },
    },
  },
  {
    field: 'serialNumber',
    label: 'Número de Série',
    category: TaskFieldCategory.BASIC,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Número de série alterado para: {newValue}',
        push: 'Número de série: {newValue}',
        email: {
          subject: 'Número de série da tarefa alterado',
          body: 'O número de série da tarefa <strong>{taskName}</strong> foi alterado de <strong>{oldValue}</strong> para <strong>{newValue}</strong> por {changedBy}.',
        },
        whatsapp: '🔢 Número de série alterado para: *{newValue}*',
      },
    },
  },

  // =====================
  // DATE FIELDS
  // =====================
  {
    field: 'entryDate',
    label: 'Data de Entrada',
    category: TaskFieldCategory.DATES,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Data de entrada definida para {newValue}',
        push: 'Entrada: {newValue}',
        email: {
          subject: 'Data de entrada da tarefa #{serialNumber}',
          body: 'A data de entrada da tarefa "{taskName}" foi definida para {newValue} por {changedBy}.',
        },
        whatsapp: '📅 Data de entrada da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Data de entrada removida',
        push: 'Data de entrada removida',
        email: {
          subject: 'Data de entrada removida - Tarefa #{serialNumber}',
          body: 'A data de entrada da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: '📅 Data de entrada da tarefa #{serialNumber} foi removida.',
      },
    },
    formatter: 'formatDate',
  },
  {
    field: 'term',
    label: 'Prazo',
    category: TaskFieldCategory.DATES,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Prazo alterado para {newValue}',
        push: 'Novo prazo: {newValue}',
        email: {
          subject: '⚠️ Prazo da tarefa #{serialNumber} alterado',
          body: 'ATENÇÃO: O prazo da tarefa "{taskName}" foi alterado de {oldValue} para {newValue} por {changedBy}.\n\nPor favor, verifique se a nova data é viável.',
        },
        whatsapp:
          '⚠️ Prazo da tarefa #{serialNumber} alterado para {newValue}. Verifique o cronograma!',
      },
      cleared: {
        inApp: 'Prazo removido',
        push: 'Prazo removido',
        email: {
          subject: 'Prazo removido - Tarefa #{serialNumber}',
          body: 'O prazo da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: '📅 Prazo da tarefa #{serialNumber} foi removido.',
      },
    },
    formatter: 'formatDate',
  },
  {
    field: 'forecastDate',
    label: 'Data Prevista',
    category: TaskFieldCategory.DATES,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Data prevista alterada para {newValue}',
        push: 'Previsão: {newValue}',
        email: {
          subject: 'Previsão de entrega - Tarefa #{serialNumber}',
          body: 'A data prevista da tarefa "{taskName}" foi alterada para {newValue} por {changedBy}.',
        },
        whatsapp: '📅 Data prevista da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Data prevista removida',
        push: 'Previsão removida',
        email: {
          subject: 'Previsão removida - Tarefa #{serialNumber}',
          body: 'A data prevista da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: '📅 Data prevista da tarefa #{serialNumber} foi removida.',
      },
    },
    formatter: 'formatDate',
  },
  {
    field: 'startedAt',
    label: 'Data de Início',
    category: TaskFieldCategory.DATES,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Produção iniciada em {newValue}',
        push: 'Produção iniciada!',
        email: {
          subject: '🚀 Produção iniciada - Tarefa #{serialNumber}',
          body: 'A produção da tarefa "{taskName}" foi iniciada em {newValue} por {changedBy}.',
        },
        whatsapp: '🚀 Produção da tarefa #{serialNumber} iniciada em {newValue}!',
      },
      cleared: {
        inApp: 'Data de início removida',
        push: 'Data de início removida',
        email: {
          subject: 'Data de início removida - Tarefa #{serialNumber}',
          body: 'A data de início da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: '📅 Data de início da tarefa #{serialNumber} foi removida.',
      },
    },
    formatter: 'formatDate',
  },
  {
    field: 'finishedAt',
    label: 'Data de Conclusão',
    category: TaskFieldCategory.DATES,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Tarefa concluída em {newValue}',
        push: 'Tarefa concluída!',
        email: {
          subject: '✅ Tarefa #{serialNumber} concluída',
          body: 'A tarefa "{taskName}" foi concluída em {newValue} por {changedBy}.\n\nParabéns pela conclusão!',
        },
        whatsapp: '✅ Tarefa #{serialNumber} concluída em {newValue}!',
      },
      cleared: {
        inApp: 'Data de conclusão removida - tarefa reaberta',
        push: 'Tarefa reaberta',
        email: {
          subject: 'Tarefa #{serialNumber} reaberta',
          body: 'A data de conclusão da tarefa "{taskName}" foi removida por {changedBy}. A tarefa está reaberta.',
        },
        whatsapp: '🔄 Tarefa #{serialNumber} foi reaberta.',
      },
    },
    formatter: 'formatDate',
  },

  // =====================
  // ASSIGNMENT FIELDS
  // =====================
  {
    field: 'sectorId',
    label: 'Setor',
    category: TaskFieldCategory.ASSIGNMENT,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: false,
    messages: {
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
    },
    formatter: 'formatSector',
  },
  {
    field: 'customerId',
    label: 'Cliente',
    category: TaskFieldCategory.ASSIGNMENT,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
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
    },
    formatter: 'formatCustomer',
  },
  {
    field: 'invoiceToId',
    label: 'Faturar Para',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
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
    },
    formatter: 'formatCustomer',
  },

  // =====================
  // FINANCIAL FIELDS (RESTRICTED TO ADMIN & FINANCIAL)
  // =====================
  {
    field: 'commission',
    label: 'Comissão',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Status de comissão alterado para "{newValue}"',
        push: 'Comissão: {newValue}',
        email: {
          subject: '💵 Comissão alterada - Tarefa #{serialNumber}',
          body: 'O status de comissão da tarefa "{taskName}" foi alterado de "{oldValue}" para "{newValue}" por {changedBy}.',
        },
        whatsapp: '💵 Comissão da tarefa #{serialNumber}: {newValue}.',
      },
    },
    formatter: 'formatCommissionStatus',
  },
  {
    field: 'budgets',
    label: 'Orçamentos',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Orçamentos atualizados',
        push: 'Orçamentos atualizados',
        email: {
          subject: '📋 Orçamentos - Tarefa #{serialNumber}',
          body: 'Os orçamentos da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: '📋 Orçamentos da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} orçamento(s) adicionado(s)',
        push: 'Novo orçamento',
        email: {
          subject: '📋 Novo orçamento - Tarefa #{serialNumber}',
          body: '{count} novo(s) orçamento(s) adicionado(s) à tarefa "{taskName}" por {changedBy}.\n\nVerifique os valores e aprove se estiver correto.',
        },
        whatsapp: '📋 {count} orçamento(s) adicionado(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} orçamento(s) removido(s)',
        push: 'Orçamento removido',
        email: {
          subject: 'Orçamento removido - Tarefa #{serialNumber}',
          body: '{count} orçamento(s) removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} orçamento(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
  },
  {
    field: 'invoices',
    label: 'Notas Fiscais',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [
      NOTIFICATION_CHANNEL.IN_APP,
      NOTIFICATION_CHANNEL.PUSH,
      NOTIFICATION_CHANNEL.EMAIL,
    ],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Notas fiscais atualizadas',
        push: 'NF atualizada',
        email: {
          subject: '📄 Nota Fiscal - Tarefa #{serialNumber}',
          body: 'As notas fiscais da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: '📄 Notas fiscais da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} nota(s) fiscal(is) adicionada(s)',
        push: 'Nova NF anexada',
        email: {
          subject: '📄 Nova Nota Fiscal - Tarefa #{serialNumber}',
          body: '{count} nova(s) nota(s) fiscal(is) adicionada(s) à tarefa "{taskName}" por {changedBy}.\n\nVerifique a documentação fiscal.',
        },
        whatsapp: '📄 {count} NF(s) adicionada(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} nota(s) fiscal(is) removida(s)',
        push: 'NF removida',
        email: {
          subject: '⚠️ NF Removida - Tarefa #{serialNumber}',
          body: '{count} nota(s) fiscal(is) removida(s) da tarefa "{taskName}" por {changedBy}.\n\nVerifique se foi intencional.',
        },
        whatsapp: '⚠️ {count} NF(s) removida(s) da tarefa #{serialNumber}.',
      },
    },
  },
  {
    field: 'receipts',
    label: 'Comprovantes',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Comprovantes atualizados',
        push: 'Comprovantes atualizados',
        email: {
          subject: '🧾 Comprovantes - Tarefa #{serialNumber}',
          body: 'Os comprovantes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: '🧾 Comprovantes da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} comprovante(s) adicionado(s)',
        push: 'Novo comprovante',
        email: {
          subject: '🧾 Novo comprovante - Tarefa #{serialNumber}',
          body: '{count} novo(s) comprovante(s) adicionado(s) à tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '🧾 {count} comprovante(s) adicionado(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} comprovante(s) removido(s)',
        push: 'Comprovante removido',
        email: {
          subject: 'Comprovante removido - Tarefa #{serialNumber}',
          body: '{count} comprovante(s) removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} comprovante(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
  },
  {
    field: 'reimbursements',
    label: 'Reembolsos',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.EMAIL],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Reembolsos atualizados',
        push: 'Reembolsos atualizados',
        email: {
          subject: '💸 Reembolsos - Tarefa #{serialNumber}',
          body: 'Os documentos de reembolso da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: '💸 Reembolsos da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} reembolso(s) adicionado(s)',
        push: 'Novo reembolso',
        email: {
          subject: '💸 Novo reembolso - Tarefa #{serialNumber}',
          body: '{count} novo(s) documento(s) de reembolso adicionado(s) à tarefa "{taskName}" por {changedBy}.\n\nVerifique para aprovação.',
        },
        whatsapp: '💸 {count} reembolso(s) adicionado(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} reembolso(s) removido(s)',
        push: 'Reembolso removido',
        email: {
          subject: 'Reembolso removido - Tarefa #{serialNumber}',
          body: '{count} documento(s) de reembolso removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} reembolso(s) removido(s) da tarefa #{serialNumber}.',
      },
    },
  },
  {
    field: 'invoiceReimbursements',
    label: 'NF de Reembolso',
    category: TaskFieldCategory.FINANCIAL,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'NFs de reembolso atualizadas',
        push: 'NF reembolso atualizada',
        email: {
          subject: '📄 NF de Reembolso - Tarefa #{serialNumber}',
          body: 'As notas fiscais de reembolso da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: '📄 NFs de reembolso da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} NF(s) de reembolso adicionada(s)',
        push: 'Nova NF reembolso',
        email: {
          subject: '📄 Nova NF de Reembolso - Tarefa #{serialNumber}',
          body: '{count} nova(s) NF(s) de reembolso adicionada(s) à tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '📄 {count} NF(s) de reembolso adicionada(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} NF(s) de reembolso removida(s)',
        push: 'NF reembolso removida',
        email: {
          subject: 'NF de Reembolso removida - Tarefa #{serialNumber}',
          body: '{count} NF(s) de reembolso removida(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} NF(s) de reembolso removida(s) da tarefa #{serialNumber}.',
      },
    },
  },

  // =====================
  // ARTWORK FIELDS
  // =====================
  {
    field: 'artworks',
    label: 'Artes',
    category: TaskFieldCategory.ARTWORK,
    importance: NOTIFICATION_IMPORTANCE.HIGH,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Artes atualizadas',
        push: 'Artes atualizadas',
        email: {
          subject: '🎨 Artes - Tarefa #{serialNumber}',
          body: 'As artes da tarefa "{taskName}" foram atualizadas por {changedBy}.\n\nVerifique os novos arquivos.',
        },
        whatsapp: '🎨 Artes da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} arte(s) adicionada(s)',
        push: 'Nova arte anexada',
        email: {
          subject: '🎨 Nova arte - Tarefa #{serialNumber}',
          body: '{count} nova(s) arte(s) adicionada(s) à tarefa "{taskName}" por {changedBy}.\n\nVerifique as artes para aprovação ou início da produção.',
        },
        whatsapp: '🎨 {count} arte(s) adicionada(s) à tarefa #{serialNumber}. Verifique!',
      },
      filesRemoved: {
        inApp: '{count} arte(s) removida(s)',
        push: 'Arte removida',
        email: {
          subject: '⚠️ Arte removida - Tarefa #{serialNumber}',
          body: '{count} arte(s) removida(s) da tarefa "{taskName}" por {changedBy}.\n\nVerifique se ainda existem artes válidas para produção.',
        },
        whatsapp: '⚠️ {count} arte(s) removida(s) da tarefa #{serialNumber}.',
      },
    },
  },
  {
    field: 'baseFiles',
    label: 'Arquivos Base',
    category: TaskFieldCategory.ARTWORK,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Arquivos base atualizados',
        push: 'Arquivos base atualizados',
        email: {
          subject: '📁 Arquivos Base - Tarefa #{serialNumber}',
          body: 'Os arquivos base da tarefa "{taskName}" foram atualizados por {changedBy}.\n\nVerifique os novos arquivos.',
        },
        whatsapp: '📁 Arquivos base da tarefa #{serialNumber} atualizados.',
      },
      filesAdded: {
        inApp: '{count} arquivo(s) base adicionado(s)',
        push: 'Novo arquivo base',
        email: {
          subject: '📁 Novo arquivo base - Tarefa #{serialNumber}',
          body: '{count} novo(s) arquivo(s) base adicionado(s) à tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '📁 {count} arquivo(s) base adicionado(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} arquivo(s) base removido(s)',
        push: 'Arquivo base removido',
        email: {
          subject: '⚠️ Arquivo base removido - Tarefa #{serialNumber}',
          body: '{count} arquivo(s) base removido(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} arquivo(s) base removido(s) da tarefa #{serialNumber}.',
      },
    },
  },

  // =====================
  // REPRESENTATIVE FIELDS
  // =====================
  {
    field: 'representatives',
    label: 'Representantes',
    category: TaskFieldCategory.NEGOTIATION,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Representantes atualizados: {newValue}',
        push: 'Representantes: {newValue}',
        email: {
          subject: '👥 Representantes - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram atualizados para "{newValue}" por {changedBy}.',
        },
        whatsapp: '👥 Representantes da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Representantes removidos',
        push: 'Representantes removidos',
        email: {
          subject: 'Representantes removidos - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram removidos por {changedBy}.',
        },
        whatsapp: '👥 Representantes da tarefa #{serialNumber} foram removidos.',
      },
    },
    formatter: 'formatRepresentatives',
  },
  {
    field: 'representativeIds',
    label: 'Representantes',
    category: TaskFieldCategory.NEGOTIATION,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Representantes atualizados',
        push: 'Representantes atualizados',
        email: {
          subject: '👥 Representantes - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram atualizados por {changedBy}.',
        },
        whatsapp: '👥 Representantes da tarefa #{serialNumber} foram atualizados.',
      },
      cleared: {
        inApp: 'Representantes removidos',
        push: 'Representantes removidos',
        email: {
          subject: 'Representantes removidos - Tarefa #{serialNumber}',
          body: 'Os representantes da tarefa "{taskName}" foram removidos por {changedBy}.',
        },
        whatsapp: '👥 Representantes da tarefa #{serialNumber} foram removidos.',
      },
    },
  },

  // =====================
  // NEGOTIATION FIELDS (DEPRECATED - kept for historical data)
  // =====================
  {
    field: 'negotiatingWith',
    label: 'Negociando Com',
    category: TaskFieldCategory.NEGOTIATION,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Contato de negociação atualizado: {newValue}',
        push: 'Negociação: {newValue}',
        email: {
          subject: '🤝 Contato de negociação - Tarefa #{serialNumber}',
          body: 'O contato de negociação da tarefa "{taskName}" foi atualizado para "{newValue}" por {changedBy}.',
        },
        whatsapp: '🤝 Negociando tarefa #{serialNumber} com: {newValue}.',
      },
      cleared: {
        inApp: 'Contato de negociação removido',
        push: 'Negociação removida',
        email: {
          subject: 'Contato de negociação removido - Tarefa #{serialNumber}',
          body: 'O contato de negociação da tarefa "{taskName}" foi removido por {changedBy}.',
        },
        whatsapp: '🤝 Contato de negociação da tarefa #{serialNumber} foi removido.',
      },
    },
    formatter: 'formatContact',
  },

  // =====================
  // PRODUCTION FIELDS
  // =====================
  {
    field: 'paintId',
    label: 'Pintura Geral',
    category: TaskFieldCategory.PRODUCTION,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Pintura geral alterada para "{newValue}"',
        push: 'Pintura: {newValue}',
        email: {
          subject: '🎨 Pintura definida - Tarefa #{serialNumber}',
          body: 'A pintura geral da tarefa "{taskName}" foi alterada para "{newValue}" por {changedBy}.',
        },
        whatsapp: '🎨 Pintura da tarefa #{serialNumber}: {newValue}.',
      },
      cleared: {
        inApp: 'Pintura geral removida',
        push: 'Pintura removida',
        email: {
          subject: 'Pintura removida - Tarefa #{serialNumber}',
          body: 'A pintura geral da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: '🎨 Pintura da tarefa #{serialNumber} foi removida.',
      },
    },
    formatter: 'formatPaint',
  },
  {
    field: 'logoPaints',
    label: 'Pinturas do Logotipo',
    category: TaskFieldCategory.PRODUCTION,
    importance: NOTIFICATION_IMPORTANCE.NORMAL,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: true,
    messages: {
      updated: {
        inApp: 'Pinturas do logotipo atualizadas',
        push: 'Pinturas do logo atualizadas',
        email: {
          subject: '🎨 Pinturas do logotipo - Tarefa #{serialNumber}',
          body: 'As pinturas do logotipo da tarefa "{taskName}" foram atualizadas por {changedBy}.',
        },
        whatsapp: '🎨 Pinturas do logotipo da tarefa #{serialNumber} atualizadas.',
      },
      filesAdded: {
        inApp: '{count} cor(es) de logotipo adicionada(s)',
        push: 'Novas cores de logo',
        email: {
          subject: '🎨 Cores de logotipo adicionadas - Tarefa #{serialNumber}',
          body: '{count} nova(s) cor(es) de logotipo adicionada(s) à tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '🎨 {count} cor(es) de logotipo adicionada(s) à tarefa #{serialNumber}.',
      },
      filesRemoved: {
        inApp: '{count} cor(es) de logotipo removida(s)',
        push: 'Cores de logo removidas',
        email: {
          subject: 'Cores de logotipo removidas - Tarefa #{serialNumber}',
          body: '{count} cor(es) de logotipo removida(s) da tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '⚠️ {count} cor(es) de logotipo removida(s) da tarefa #{serialNumber}.',
      },
    },
    formatter: 'formatPaints',
  },
  {
    field: 'observation',
    label: 'Observação',
    category: TaskFieldCategory.PRODUCTION,
    importance: NOTIFICATION_IMPORTANCE.LOW,
    defaultChannels: [NOTIFICATION_CHANNEL.IN_APP],
    enabled: true,
    isFileArray: false,
    messages: {
      updated: {
        inApp: 'Nova observação adicionada à tarefa',
        push: 'Nova observação',
        email: {
          subject: '📝 Observação - Tarefa #{serialNumber}',
          body: 'Uma observação foi adicionada à tarefa "{taskName}" por {changedBy}.',
        },
        whatsapp: '📝 Nova observação na tarefa #{serialNumber}.',
      },
      cleared: {
        inApp: 'Observação removida',
        push: 'Observação removida',
        email: {
          subject: 'Observação removida - Tarefa #{serialNumber}',
          body: 'A observação da tarefa "{taskName}" foi removida por {changedBy}.',
        },
        whatsapp: '📝 Observação da tarefa #{serialNumber} foi removida.',
      },
    },
  },
];

/**
 * Get field configuration by field name
 */
export function getFieldConfig(fieldName: string): TaskFieldNotificationConfig | undefined {
  return TASK_FIELD_NOTIFICATIONS.find(config => config.field === fieldName);
}

/**
 * Get all financial fields (restricted to ADMIN and FINANCIAL)
 */
export function getFinancialFields(): string[] {
  return TASK_FIELD_NOTIFICATIONS.filter(
    config => config.category === TaskFieldCategory.FINANCIAL,
  ).map(config => config.field);
}

/**
 * Get allowed roles for a specific field
 * First checks field-specific overrides (FIELD_ALLOWED_ROLES), then falls back to category roles
 */
export function getAllowedRolesForField(fieldName: string): SECTOR_PRIVILEGES[] {
  // First check for field-specific override
  if (FIELD_ALLOWED_ROLES[fieldName]) {
    return FIELD_ALLOWED_ROLES[fieldName];
  }

  // Fallback to category-based roles
  const config = getFieldConfig(fieldName);
  if (!config) return [];
  return CATEGORY_ALLOWED_ROLES[config.category] || [];
}

/**
 * Check if a role can receive notifications for a field
 */
export function canRoleReceiveFieldNotification(
  fieldName: string,
  privilege: SECTOR_PRIVILEGES,
): boolean {
  const allowedRoles = getAllowedRolesForField(fieldName);
  return allowedRoles.includes(privilege);
}

/**
 * Get all enabled field names
 */
export function getEnabledFields(): string[] {
  return TASK_FIELD_NOTIFICATIONS.filter(config => config.enabled).map(config => config.field);
}

/**
 * Get field label in Portuguese
 */
export function getFieldLabel(fieldName: string): string {
  const config = getFieldConfig(fieldName);
  return config?.label || fieldName;
}

/**
 * Map of field names to their Portuguese labels (for backward compatibility)
 */
export const FIELD_LABELS: Record<string, string> = TASK_FIELD_NOTIFICATIONS.reduce(
  (acc, config) => {
    acc[config.field] = config.label;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Event types for user preferences (one per field)
 */
export const TASK_FIELD_EVENT_TYPES: Record<string, string> = TASK_FIELD_NOTIFICATIONS.reduce(
  (acc, config) => {
    const eventKey = config.field
      .toUpperCase()
      .replace(/([A-Z])/g, '_$1')
      .replace(/^_/, '');
    acc[`${eventKey}_CHANGED`] = `task.field.${config.field}`;
    return acc;
  },
  {} as Record<string, string>,
);
