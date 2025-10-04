// packages/constants/src/enum-labels.ts

import {
  ORDER_STATUS,
  USER_STATUS,
  ASSIGNMENT_TYPE,
  TASK_STATUS,
  SERVICE_ORDER_STATUS,
  AIRBRUSHING_STATUS,
  CUT_TYPE,
  CUT_STATUS,
  CUT_ORIGIN,
  CUT_REQUEST_REASON,
  GARAGE_STATUS,
  VACATION_STATUS,
  MAINTENANCE_STATUS,
  MAINTENANCE_SCHEDULE_STATUS,
  PAINT_BRAND,
  PAINT_FINISH,
  PAINT_TYPE_ENUM,
  TRUCK_MANUFACTURER,
  COLOR_PALETTE,
  WARNING_SEVERITY,
  WARNING_CATEGORY,
  NOTIFICATION_TYPE,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_CHANNEL,
  COLOR_SCHEMA,
  VERIFICATION_TYPE,
  VERIFICATION_ERROR_CODE,
  VERIFICATION_ERROR_SEVERITY,
  VERIFICATION_ERROR_CATEGORY,
  HOLIDAY_TYPE,
  MEASURE_UNIT,
  MEASURE_TYPE,
  BORROW_STATUS,
  EXTERNAL_WITHDRAWAL_STATUS,
  PPE_REQUEST_STATUS,
  PPE_DELIVERY_STATUS,
  SECTOR_PRIVILEGES,
  TREND_DIRECTION,
  TREND_TYPE,
  PERIOD_TYPE,
  CHART_TYPE,
  PRIORITY_TYPE,
  RISK_LEVEL,
  STOCK_LEVEL,
  ABC_CATEGORY,
  XYZ_CATEGORY,
  HEALTH_STATUS,
  PERFORMANCE_LEVEL,
  URGENCY_LEVEL,
  EFFORT_LEVEL,
  CONFIDENCE_LEVEL,
  PERCENTAGE_ADJUST_TYPE,
  EXPORT_FORMAT,
  BATCH_OPERATION_STATUS,
  VALIDATION_SEVERITY,
  VACATION_TYPE,
  WEEK_DAY,
  MONTH,
  MONTH_OCCURRENCE,
  SCHEDULE_FREQUENCY,
  PANTS_SIZE,
  SHIRT_SIZE,
  BOOT_SIZE,
  SLEEVES_SIZE,
  MASK_SIZE,
  GLOVES_SIZE,
  RAIN_BOOTS_SIZE,
  PPE_TYPE,
  PPE_SIZE_TYPE,
  PPE_SIZE,
  ACTIVITY_OPERATION,
  AUDIT_ACTION,
  ENTITY_TYPE,
  PPE_DELIVERY_MODE,
  ORDER_TRIGGER_TYPE,
  FILE_ENTITY_TYPE,
  ACTIVITY_REASON,
  WORKLOAD_LEVEL,
  FILE_FORMAT,
  ACTIVITY_LEVEL,
  CHANGE_ACTION,
  CHANGE_TRIGGERED_BY,
  EVENT_TYPE,
  TIMELINE_EVENT_TYPE,
  MERGE_STRATEGY,
  GROUP_BY,
  ALERT_TYPE,
  TASK_OBSERVATION_TYPE,
  ITEM_ISSUE_TYPE,
  ITEM_CATEGORY_TYPE,
  TIME_RANGE,
  DASHBOARD_TIME_PERIOD,
  RESCHEDULE_REASON,
  CHANGE_LOG_ENTITY_TYPE,
  CHANGE_LOG_ACTION,
  NOTIFICATION_ACTION_TYPE,
  SMS_VERIFICATION_STATUS,
  SMS_VERIFICATION_TYPE,
  RATE_LIMIT_TYPE,
  LOCKOUT_REASON,
  CAPTCHA_REQUIREMENT_LEVEL,
  VERIFICATION_ABUSE_LEVEL,
  PROGRESSIVE_DELAY_TIER,
  VERIFICATION_SECURITY_ACTION,
  EMAIL_TYPE,
  EMAIL_STATUS,
  VERIFICATION_STATUS,
  VERIFICATION_METHOD,
  VERIFICATION_PURPOSE,
  NOTE_CATEGORY,
  DOCUMENT_CATEGORY,
  LINK_TYPE,
  FAVORITE_PAGES,
  DRIVER_STATUS,
  CNH_CATEGORY,
  LAYOUT_SIDE,
  LICENSE_TYPE,
  BLOOD_TYPE,
  BONUS_DISCOUNT_REASON,
  BONUS_STATUS,
  DISCOUNT_TYPE,
  PAYROLL_STATUS,
  PAYROLL_MONTH,
  COMMISSION_STATUS,
  STATISTICS_GROUP_BY,
  STATISTICS_METRIC,
  STATISTICS_PERIOD,
} from "./enums";

// =====================
// Status Labels
// =====================

export const ORDER_STATUS_LABELS: Record<ORDER_STATUS, string> = {
  [ORDER_STATUS.CREATED]: "Criado",
  [ORDER_STATUS.PARTIALLY_FULFILLED]: "Parcialmente Feito",
  [ORDER_STATUS.FULFILLED]: "Feito",
  [ORDER_STATUS.OVERDUE]: "Atrasado",
  [ORDER_STATUS.PARTIALLY_RECEIVED]: "Parcialmente Recebido",
  [ORDER_STATUS.RECEIVED]: "Recebido",
  [ORDER_STATUS.CANCELLED]: "Cancelado",
};

export const USER_STATUS_LABELS: Record<USER_STATUS, string> = {
  [USER_STATUS.EXPERIENCE_PERIOD_1]: "Experiência 1/2 (45 dias)",
  [USER_STATUS.EXPERIENCE_PERIOD_2]: "Experiência 2/2 (45 dias)",
  [USER_STATUS.CONTRACTED]: "Contratado",
  [USER_STATUS.DISMISSED]: "Desligado",
};

export const TASK_STATUS_LABELS: Record<TASK_STATUS, string> = {
  [TASK_STATUS.PENDING]: "Pendente",
  [TASK_STATUS.IN_PRODUCTION]: "Em Produção",
  [TASK_STATUS.COMPLETED]: "Finalizado",
  [TASK_STATUS.CANCELLED]: "Cancelado",
  [TASK_STATUS.ON_HOLD]: "Em Espera",
};

export const SERVICE_ORDER_STATUS_LABELS: Record<SERVICE_ORDER_STATUS, string> = {
  [SERVICE_ORDER_STATUS.PENDING]: "Pendente",
  [SERVICE_ORDER_STATUS.IN_PROGRESS]: "Em Andamento",
  [SERVICE_ORDER_STATUS.COMPLETED]: "Finalizado",
  [SERVICE_ORDER_STATUS.CANCELLED]: "Cancelado",
};

export const AIRBRUSHING_STATUS_LABELS: Record<AIRBRUSHING_STATUS, string> = {
  [AIRBRUSHING_STATUS.PENDING]: "Pendente",
  [AIRBRUSHING_STATUS.IN_PRODUCTION]: "Em Produção",
  [AIRBRUSHING_STATUS.COMPLETED]: "Finalizado",
  [AIRBRUSHING_STATUS.CANCELLED]: "Cancelado",
};

export const CUT_TYPE_LABELS: Record<CUT_TYPE, string> = {
  [CUT_TYPE.VINYL]: "Adesivo",
  [CUT_TYPE.STENCIL]: "Espovo",
};

export const CUT_STATUS_LABELS: Record<CUT_STATUS, string> = {
  [CUT_STATUS.PENDING]: "Pendente",
  [CUT_STATUS.CUTTING]: "Cortando",
  [CUT_STATUS.COMPLETED]: "Concluído",
};

export const CUT_ORIGIN_LABELS: Record<CUT_ORIGIN, string> = {
  [CUT_ORIGIN.PLAN]: "Plano",
  [CUT_ORIGIN.REQUEST]: "Solicitação",
};

export const CUT_REQUEST_REASON_LABELS: Record<CUT_REQUEST_REASON, string> = {
  [CUT_REQUEST_REASON.WRONG_APPLY]: "Aplicação Incorreta",
  [CUT_REQUEST_REASON.LOST]: "Perdido",
  [CUT_REQUEST_REASON.WRONG]: "Errado",
};

export const GARAGE_STATUS_LABELS: Record<GARAGE_STATUS, string> = {
  [GARAGE_STATUS.ACTIVE]: "Ativo",
  [GARAGE_STATUS.INACTIVE]: "Inativo",
  [GARAGE_STATUS.MAINTENANCE]: "Manutenção",
};

export const VACATION_STATUS_LABELS: Record<VACATION_STATUS, string> = {
  [VACATION_STATUS.PENDING]: "Pendente",
  [VACATION_STATUS.APPROVED]: "Aprovado",
  [VACATION_STATUS.REJECTED]: "Rejeitado",
  [VACATION_STATUS.CANCELLED]: "Cancelado",
  [VACATION_STATUS.IN_PROGRESS]: "Em Andamento",
  [VACATION_STATUS.COMPLETED]: "Concluído",
};


export const MAINTENANCE_STATUS_LABELS: Record<MAINTENANCE_STATUS, string> = {
  [MAINTENANCE_STATUS.PENDING]: "Pendente",
  [MAINTENANCE_STATUS.IN_PROGRESS]: "Em Andamento",
  [MAINTENANCE_STATUS.COMPLETED]: "Concluído",
  [MAINTENANCE_STATUS.CANCELLED]: "Cancelado",
  [MAINTENANCE_STATUS.OVERDUE]: "Atrasado",
};

export const MAINTENANCE_SCHEDULE_STATUS_LABELS: Record<MAINTENANCE_SCHEDULE_STATUS, string> = {
  [MAINTENANCE_SCHEDULE_STATUS.PENDING]: "Pendente",
  [MAINTENANCE_SCHEDULE_STATUS.FINISHED]: "Finalizado",
  [MAINTENANCE_SCHEDULE_STATUS.CANCELLED]: "Cancelado",
};

export const BORROW_STATUS_LABELS: Record<BORROW_STATUS, string> = {
  [BORROW_STATUS.ACTIVE]: "Ativo",
  [BORROW_STATUS.RETURNED]: "Devolvido",
  [BORROW_STATUS.LOST]: "Perdido",
};

export const EXTERNAL_WITHDRAWAL_STATUS_LABELS: Record<EXTERNAL_WITHDRAWAL_STATUS, string> = {
  [EXTERNAL_WITHDRAWAL_STATUS.PENDING]: "Pendente",
  [EXTERNAL_WITHDRAWAL_STATUS.PARTIALLY_RETURNED]: "Parcialmente Devolvido",
  [EXTERNAL_WITHDRAWAL_STATUS.FULLY_RETURNED]: "Totalmente Devolvido",
  [EXTERNAL_WITHDRAWAL_STATUS.CHARGED]: "Cobrado",
  [EXTERNAL_WITHDRAWAL_STATUS.CANCELLED]: "Cancelado",
};

export const PPE_REQUEST_STATUS_LABELS: Record<PPE_REQUEST_STATUS, string> = {
  [PPE_REQUEST_STATUS.PENDING]: "Pendente",
  [PPE_REQUEST_STATUS.APPROVED]: "Aprovado",
  [PPE_REQUEST_STATUS.REJECTED]: "Rejeitado",
  [PPE_REQUEST_STATUS.DELIVERED]: "Entregue",
  [PPE_REQUEST_STATUS.CANCELLED]: "Cancelado",
};

export const PPE_DELIVERY_STATUS_LABELS: Record<PPE_DELIVERY_STATUS, string> = {
  [PPE_DELIVERY_STATUS.PENDING]: "Pendente",
  [PPE_DELIVERY_STATUS.APPROVED]: "Aprovado",
  [PPE_DELIVERY_STATUS.DELIVERED]: "Entregue",
  [PPE_DELIVERY_STATUS.REPROVED]: "Reprovado",
  [PPE_DELIVERY_STATUS.CANCELLED]: "Cancelado",
};

export const ASSIGNMENT_TYPE_LABELS: Record<ASSIGNMENT_TYPE, string> = {
  [ASSIGNMENT_TYPE.ALL]: "Todos",
  [ASSIGNMENT_TYPE.ALL_EXCEPT]: "Todos Exceto",
  [ASSIGNMENT_TYPE.SPECIFIC]: "Específicos",
};

// =====================
// Paint Labels
// =====================

// PAINT_TYPE is now a model instead of enum
// Paint types are managed dynamically in the database

export const PAINT_BRAND_LABELS: Record<PAINT_BRAND, string> = {
  [PAINT_BRAND.PPG]: "PPG",
  [PAINT_BRAND.FARBEN]: "Farben",
  [PAINT_BRAND.LAZZURIL]: "Lazzuril",
};

export const PAINT_FINISH_LABELS: Record<PAINT_FINISH, string> = {
  [PAINT_FINISH.SOLID]: "Lisa",
  [PAINT_FINISH.METALLIC]: "Metálico",
  [PAINT_FINISH.PEARL]: "Perolizado",
  [PAINT_FINISH.MATTE]: "Fosco",
  [PAINT_FINISH.SATIN]: "Semi Brilho",
};

export const PAINT_TYPE_ENUM_LABELS: Record<PAINT_TYPE_ENUM, string> = {
  [PAINT_TYPE_ENUM.POLYESTER]: "Poliéster",
  [PAINT_TYPE_ENUM.ACRYLIC]: "Acrílica",
  [PAINT_TYPE_ENUM.LACQUER]: "Laca",
  [PAINT_TYPE_ENUM.POLYURETHANE]: "Poliuretano",
  [PAINT_TYPE_ENUM.EPOXY]: "Epóxi",
};

export const TRUCK_MANUFACTURER_LABELS: Record<TRUCK_MANUFACTURER, string> = {
  [TRUCK_MANUFACTURER.SCANIA]: "Scania",
  [TRUCK_MANUFACTURER.VOLVO]: "Volvo",
  [TRUCK_MANUFACTURER.DAF]: "DAF",
  [TRUCK_MANUFACTURER.VOLKSWAGEN]: "Volkswagen",
  [TRUCK_MANUFACTURER.IVECO]: "Iveco",
  [TRUCK_MANUFACTURER.MERCEDES_BENZ]: "Mercedes Benz",
};

export const COLOR_PALETTE_LABELS: Record<COLOR_PALETTE, string> = {
  [COLOR_PALETTE.BLACK]: "Preto",
  [COLOR_PALETTE.GRAY]: "Cinza",
  [COLOR_PALETTE.WHITE]: "Branco",
  [COLOR_PALETTE.SILVER]: "Prata",
  [COLOR_PALETTE.GOLDEN]: "Dourado",
  [COLOR_PALETTE.YELLOW]: "Amarelo",
  [COLOR_PALETTE.ORANGE]: "Laranja",
  [COLOR_PALETTE.BROWN]: "Marrom",
  [COLOR_PALETTE.RED]: "Vermelho",
  [COLOR_PALETTE.PINK]: "Rosa",
  [COLOR_PALETTE.PURPLE]: "Roxo",
  [COLOR_PALETTE.BLUE]: "Azul",
  [COLOR_PALETTE.GREEN]: "Verde",
  [COLOR_PALETTE.BEIGE]: "Bege",
};

// =====================
// Warning Labels
// =====================

export const WARNING_SEVERITY_LABELS: Record<WARNING_SEVERITY, string> = {
  [WARNING_SEVERITY.VERBAL]: "Verbal",
  [WARNING_SEVERITY.WRITTEN]: "Escrita",
  [WARNING_SEVERITY.SUSPENSION]: "Suspensão",
  [WARNING_SEVERITY.FINAL_WARNING]: "Advertência Final",
};

export const WARNING_CATEGORY_LABELS: Record<WARNING_CATEGORY, string> = {
  [WARNING_CATEGORY.SAFETY]: "Segurança",
  [WARNING_CATEGORY.MISCONDUCT]: "Má Conduta",
  [WARNING_CATEGORY.INSUBORDINATION]: "Insubordinação",
  [WARNING_CATEGORY.POLICY_VIOLATION]: "Violação de Política",
  [WARNING_CATEGORY.ATTENDANCE]: "Assiduidade",
  [WARNING_CATEGORY.PERFORMANCE]: "Desempenho",
  [WARNING_CATEGORY.BEHAVIOR]: "Comportamento",
  [WARNING_CATEGORY.OTHER]: "Outro",
};

// =====================
// Notification Labels
// =====================

export const NOTIFICATION_TYPE_LABELS: Record<NOTIFICATION_TYPE, string> = {
  [NOTIFICATION_TYPE.SYSTEM]: "Sistema",
  [NOTIFICATION_TYPE.TASK]: "Tarefa",
  [NOTIFICATION_TYPE.ORDER]: "Pedido",
  [NOTIFICATION_TYPE.PPE]: "EPI",
  [NOTIFICATION_TYPE.VACATION]: "Férias",
  [NOTIFICATION_TYPE.WARNING]: "Advertência",
  [NOTIFICATION_TYPE.STOCK]: "Estoque",
  [NOTIFICATION_TYPE.GENERAL]: "Geral",
};

export const NOTIFICATION_ACTION_TYPE_LABELS: Record<NOTIFICATION_ACTION_TYPE, string> = {
  [NOTIFICATION_ACTION_TYPE.VIEW_DETAILS]: "Ver Detalhes",
  [NOTIFICATION_ACTION_TYPE.APPROVE_REQUEST]: "Aprovar Solicitação",
  [NOTIFICATION_ACTION_TYPE.REJECT_REQUEST]: "Rejeitar Solicitação",
  [NOTIFICATION_ACTION_TYPE.COMPLETE_TASK]: "Concluir Tarefa",
  [NOTIFICATION_ACTION_TYPE.TASK_CREATED]: "Tarefa Criada",
  [NOTIFICATION_ACTION_TYPE.TASK_UPDATED]: "Tarefa Atualizada",
  [NOTIFICATION_ACTION_TYPE.VIEW_ORDER]: "Ver Pedido",
  [NOTIFICATION_ACTION_TYPE.VIEW_REPORT]: "Ver Relatório",
  [NOTIFICATION_ACTION_TYPE.ACKNOWLEDGE]: "Confirmar",
  [NOTIFICATION_ACTION_TYPE.DISMISS]: "Dispensar",
};

export const NOTIFICATION_IMPORTANCE_LABELS: Record<NOTIFICATION_IMPORTANCE, string> = {
  [NOTIFICATION_IMPORTANCE.LOW]: "Baixa",
  [NOTIFICATION_IMPORTANCE.NORMAL]: "Normal",
  [NOTIFICATION_IMPORTANCE.HIGH]: "Alta",
  [NOTIFICATION_IMPORTANCE.URGENT]: "Urgente",
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NOTIFICATION_CHANNEL, string> = {
  [NOTIFICATION_CHANNEL.EMAIL]: "E-mail",
  [NOTIFICATION_CHANNEL.SMS]: "SMS",
  [NOTIFICATION_CHANNEL.PUSH]: "Push",
  [NOTIFICATION_CHANNEL.IN_APP]: "No Aplicativo",
};

// =====================
// Other Labels
// =====================

export const COLOR_SCHEMA_LABELS: Record<COLOR_SCHEMA, string> = {
  [COLOR_SCHEMA.LIGHT]: "Claro",
  [COLOR_SCHEMA.DARK]: "Escuro",
  [COLOR_SCHEMA.SYSTEM]: "Automático",
};

export const VERIFICATION_TYPE_LABELS: Record<VERIFICATION_TYPE, string> = {
  [VERIFICATION_TYPE.EMAIL]: "E-mail",
  [VERIFICATION_TYPE.PHONE]: "Telefone",
  [VERIFICATION_TYPE.PASSWORD_RESET]: "Redefinição de Senha",
};

export const VERIFICATION_ERROR_CODE_LABELS: Record<VERIFICATION_ERROR_CODE, string> = {
  // Request validation errors
  [VERIFICATION_ERROR_CODE.INVALID_CONTACT]: "Contato inválido",
  [VERIFICATION_ERROR_CODE.CONTACT_REQUIRED]: "Contato é obrigatório",
  [VERIFICATION_ERROR_CODE.CODE_REQUIRED]: "Código é obrigatório",
  [VERIFICATION_ERROR_CODE.INVALID_CONTACT_FORMAT]: "Formato de contato inválido",

  // User-related errors
  [VERIFICATION_ERROR_CODE.USER_NOT_FOUND]: "Usuário não encontrado",
  [VERIFICATION_ERROR_CODE.USER_ALREADY_VERIFIED]: "Conta já verificada",
  [VERIFICATION_ERROR_CODE.USER_INACTIVE]: "Usuário inativo",

  // Code validation errors
  [VERIFICATION_ERROR_CODE.INVALID_CODE]: "Código de verificação inválido",
  [VERIFICATION_ERROR_CODE.CODE_EXPIRED]: "Código de verificação expirado",
  [VERIFICATION_ERROR_CODE.NO_CODE_SENT]: "Nenhum código foi enviado",
  [VERIFICATION_ERROR_CODE.CODE_MISMATCH]: "Código não confere",

  // Rate limiting errors
  [VERIFICATION_ERROR_CODE.TOO_MANY_ATTEMPTS]: "Muitas tentativas de verificação",
  [VERIFICATION_ERROR_CODE.TOO_MANY_REQUESTS]: "Muitas solicitações",
  [VERIFICATION_ERROR_CODE.CONTACT_COOLDOWN]: "Aguarde antes de tentar novamente",
  [VERIFICATION_ERROR_CODE.IP_RATE_LIMITED]: "Limite de tentativas por IP excedido",
  [VERIFICATION_ERROR_CODE.PROGRESSIVE_DELAY]: "Aguarde antes da próxima tentativa",

  // Service errors
  [VERIFICATION_ERROR_CODE.SMS_SEND_FAILED]: "Falha ao enviar SMS",
  [VERIFICATION_ERROR_CODE.EMAIL_SEND_FAILED]: "Falha ao enviar e-mail",
  [VERIFICATION_ERROR_CODE.NOTIFICATION_FAILED]: "Falha ao enviar notificação",
  [VERIFICATION_ERROR_CODE.EXTERNAL_SERVICE_ERROR]: "Erro no serviço externo",

  // System errors
  [VERIFICATION_ERROR_CODE.DATABASE_ERROR]: "Erro no banco de dados",
  [VERIFICATION_ERROR_CODE.CACHE_ERROR]: "Erro no cache",
  [VERIFICATION_ERROR_CODE.CONFIGURATION_ERROR]: "Erro de configuração",
  [VERIFICATION_ERROR_CODE.INTERNAL_ERROR]: "Erro interno do sistema",

  // Security errors
  [VERIFICATION_ERROR_CODE.SUSPICIOUS_ACTIVITY]: "Atividade suspeita detectada",
  [VERIFICATION_ERROR_CODE.BLOCKED_IP]: "IP bloqueado",
  [VERIFICATION_ERROR_CODE.BLACKLISTED_CONTACT]: "Contato na lista de bloqueio",
  [VERIFICATION_ERROR_CODE.SECURITY_VIOLATION]: "Violação de segurança",
};

export const VERIFICATION_ERROR_SEVERITY_LABELS: Record<VERIFICATION_ERROR_SEVERITY, string> = {
  [VERIFICATION_ERROR_SEVERITY.LOW]: "Baixa",
  [VERIFICATION_ERROR_SEVERITY.MEDIUM]: "Média",
  [VERIFICATION_ERROR_SEVERITY.HIGH]: "Alta",
  [VERIFICATION_ERROR_SEVERITY.CRITICAL]: "Crítica",
};

export const VERIFICATION_ERROR_CATEGORY_LABELS: Record<VERIFICATION_ERROR_CATEGORY, string> = {
  [VERIFICATION_ERROR_CATEGORY.VALIDATION]: "Validação",
  [VERIFICATION_ERROR_CATEGORY.RATE_LIMITING]: "Limite de Taxa",
  [VERIFICATION_ERROR_CATEGORY.AUTHENTICATION]: "Autenticação",
  [VERIFICATION_ERROR_CATEGORY.EXTERNAL_SERVICE]: "Serviço Externo",
  [VERIFICATION_ERROR_CATEGORY.SYSTEM]: "Sistema",
  [VERIFICATION_ERROR_CATEGORY.SECURITY]: "Segurança",
};

export const HOLIDAY_TYPE_LABELS: Record<HOLIDAY_TYPE, string> = {
  [HOLIDAY_TYPE.NATIONAL]: "Nacional",
  [HOLIDAY_TYPE.STATE]: "Estadual",
  [HOLIDAY_TYPE.MUNICIPAL]: "Municipal",
  [HOLIDAY_TYPE.OPTIONAL]: "Facultativo",
};

export const MEASURE_UNIT_LABELS: Record<MEASURE_UNIT, string> = {
  // Weight units
  [MEASURE_UNIT.KILOGRAM]: "kg",
  [MEASURE_UNIT.GRAM]: "g",

  // Volume units
  [MEASURE_UNIT.MILLILITER]: "ml",
  [MEASURE_UNIT.LITER]: "l",
  [MEASURE_UNIT.CUBIC_METER]: "m³",
  [MEASURE_UNIT.CUBIC_CENTIMETER]: "cm³",

  // Length units
  [MEASURE_UNIT.MILLIMETER]: "mm",
  [MEASURE_UNIT.CENTIMETER]: "cm",
  [MEASURE_UNIT.METER]: "m",
  [MEASURE_UNIT.INCHES]: "pol",

  // Diameter units (fractional inches)
  [MEASURE_UNIT.INCH_1_8]: '1/8"',
  [MEASURE_UNIT.INCH_1_4]: '1/4"',
  [MEASURE_UNIT.INCH_3_8]: '3/8"',
  [MEASURE_UNIT.INCH_1_2]: '1/2"',
  [MEASURE_UNIT.INCH_5_8]: '5/8"',
  [MEASURE_UNIT.INCH_3_4]: '3/4"',
  [MEASURE_UNIT.INCH_7_8]: '7/8"',
  [MEASURE_UNIT.INCH_1]: '1"',
  [MEASURE_UNIT.INCH_1_1_4]: '1.1/4"',
  [MEASURE_UNIT.INCH_1_1_2]: '1.1/2"',
  [MEASURE_UNIT.INCH_2]: '2"',

  // Thread pitch units
  [MEASURE_UNIT.THREAD_MM]: "mm (passo)",
  [MEASURE_UNIT.THREAD_TPI]: "TPI",

  // Electrical units
  [MEASURE_UNIT.WATT]: "W",
  [MEASURE_UNIT.VOLT]: "V",
  [MEASURE_UNIT.AMPERE]: "A",

  // Area units
  [MEASURE_UNIT.SQUARE_CENTIMETER]: "cm²",
  [MEASURE_UNIT.SQUARE_METER]: "m²",

  // Count and packaging units
  [MEASURE_UNIT.UNIT]: "un",
  [MEASURE_UNIT.PAIR]: "pr",
  [MEASURE_UNIT.DOZEN]: "dz",
  [MEASURE_UNIT.HUNDRED]: "ct",
  [MEASURE_UNIT.THOUSAND]: "mil",

  // Container and packaging units
  [MEASURE_UNIT.PACKAGE]: "pc",
  [MEASURE_UNIT.BOX]: "cx",
  [MEASURE_UNIT.ROLL]: "rl",
  [MEASURE_UNIT.SHEET]: "fl",
  [MEASURE_UNIT.SET]: "cj",
  [MEASURE_UNIT.SACK]: "sc",

  // PPE Size units (letter sizes)
  [MEASURE_UNIT.P]: "P",
  [MEASURE_UNIT.M]: "M",
  [MEASURE_UNIT.G]: "G",
  [MEASURE_UNIT.GG]: "GG",
  [MEASURE_UNIT.XG]: "XG",
};

export const MEASURE_TYPE_LABELS: Record<MEASURE_TYPE, string> = {
  [MEASURE_TYPE.WEIGHT]: "Peso",
  [MEASURE_TYPE.VOLUME]: "Volume",
  [MEASURE_TYPE.LENGTH]: "Comprimento",
  [MEASURE_TYPE.AREA]: "Área",
  [MEASURE_TYPE.COUNT]: "Contagem",
  [MEASURE_TYPE.DIAMETER]: "Diâmetro",
  [MEASURE_TYPE.THREAD]: "Rosca/Passo",
  [MEASURE_TYPE.ELECTRICAL]: "Elétrico",
  [MEASURE_TYPE.SIZE]: "Tamanho",
};

// =====================
// Additional Labels
// =====================

export const SECTOR_PRIVILEGES_LABELS: Record<SECTOR_PRIVILEGES, string> = {
  [SECTOR_PRIVILEGES.BASIC]: "Básico",
  [SECTOR_PRIVILEGES.MAINTENANCE]: "Manutenção",
  [SECTOR_PRIVILEGES.WAREHOUSE]: "Almoxarifado",
  [SECTOR_PRIVILEGES.ADMIN]: "Administrador",
  [SECTOR_PRIVILEGES.PRODUCTION]: "Produção",
  [SECTOR_PRIVILEGES.LEADER]: "Líder",
  [SECTOR_PRIVILEGES.HUMAN_RESOURCES]: "Recursos Humanos",
  [SECTOR_PRIVILEGES.EXTERNAL]: "Externo",
  [SECTOR_PRIVILEGES.FINANCIAL]: "Financeiro",
};

export const TREND_DIRECTION_LABELS: Record<TREND_DIRECTION, string> = {
  [TREND_DIRECTION.UP]: "Crescente",
  [TREND_DIRECTION.DOWN]: "Decrescente",
  [TREND_DIRECTION.STABLE]: "Estável",
};

export const TREND_TYPE_LABELS: Record<TREND_TYPE, string> = {
  [TREND_TYPE.POSITIVE]: "Positivo",
  [TREND_TYPE.NEGATIVE]: "Negativo",
  [TREND_TYPE.NEUTRAL]: "Neutro",
  [TREND_TYPE.VOLATILE]: "Volátil",
  [TREND_TYPE.SEASONAL]: "Sazonal",
};

export const PERIOD_TYPE_LABELS: Record<PERIOD_TYPE, string> = {
  [PERIOD_TYPE.DAILY]: "Diário",
  [PERIOD_TYPE.WEEKLY]: "Semanal",
  [PERIOD_TYPE.MONTHLY]: "Mensal",
  [PERIOD_TYPE.QUARTERLY]: "Trimestral",
  [PERIOD_TYPE.YEARLY]: "Anual",
};

export const CHART_TYPE_LABELS: Record<CHART_TYPE, string> = {
  [CHART_TYPE.PIE]: "Pizza",
  [CHART_TYPE.DONUT]: "Rosca",
  [CHART_TYPE.AREA]: "Área",
  [CHART_TYPE.BAR]: "Barras",
  [CHART_TYPE.LINE]: "Linhas",
  [CHART_TYPE.STACKED]: "Empilhado",
};

export const PRIORITY_TYPE_LABELS: Record<PRIORITY_TYPE, string> = {
  [PRIORITY_TYPE.LOW]: "Baixa",
  [PRIORITY_TYPE.MEDIUM]: "Média",
  [PRIORITY_TYPE.HIGH]: "Alta",
  [PRIORITY_TYPE.CRITICAL]: "Crítica",
};

export const RISK_LEVEL_LABELS: Record<RISK_LEVEL, string> = {
  [RISK_LEVEL.LOW]: "Baixo",
  [RISK_LEVEL.MEDIUM]: "Médio",
  [RISK_LEVEL.HIGH]: "Alto",
  [RISK_LEVEL.CRITICAL]: "Crítico",
};

export const STOCK_LEVEL_LABELS: Record<STOCK_LEVEL, string> = {
  [STOCK_LEVEL.NEGATIVE_STOCK]: "Estoque Negativo",
  [STOCK_LEVEL.OUT_OF_STOCK]: "Sem Estoque",
  [STOCK_LEVEL.CRITICAL]: "Crítico",
  [STOCK_LEVEL.LOW]: "Baixo",
  [STOCK_LEVEL.OPTIMAL]: "Ótimo",
  [STOCK_LEVEL.OVERSTOCKED]: "Excesso de Estoque",
};

export const ABC_CATEGORY_LABELS: Record<ABC_CATEGORY, string> = {
  [ABC_CATEGORY.A]: "Categoria A - Alto Valor",
  [ABC_CATEGORY.B]: "Categoria B - Médio Valor",
  [ABC_CATEGORY.C]: "Categoria C - Baixo Valor",
};

export const XYZ_CATEGORY_LABELS: Record<XYZ_CATEGORY, string> = {
  [XYZ_CATEGORY.X]: "Categoria X - Demanda Estável",
  [XYZ_CATEGORY.Y]: "Categoria Y - Demanda Variável",
  [XYZ_CATEGORY.Z]: "Categoria Z - Demanda Irregular",
};

export const HEALTH_STATUS_LABELS: Record<HEALTH_STATUS, string> = {
  [HEALTH_STATUS.EXCELLENT]: "Excelente",
  [HEALTH_STATUS.GOOD]: "Bom",
  [HEALTH_STATUS.FAIR]: "Regular",
  [HEALTH_STATUS.POOR]: "Ruim",
  [HEALTH_STATUS.CRITICAL]: "Crítico",
};

export const PERFORMANCE_LEVEL_LABELS: Record<PERFORMANCE_LEVEL, string> = {
  [PERFORMANCE_LEVEL.EXCELLENT]: "Excelente",
  [PERFORMANCE_LEVEL.GOOD]: "Bom",
  [PERFORMANCE_LEVEL.FAIR]: "Regular",
  [PERFORMANCE_LEVEL.POOR]: "Ruim",
};

export const URGENCY_LEVEL_LABELS: Record<URGENCY_LEVEL, string> = {
  [URGENCY_LEVEL.LOW]: "Baixa",
  [URGENCY_LEVEL.MEDIUM]: "Média",
  [URGENCY_LEVEL.HIGH]: "Alta",
  [URGENCY_LEVEL.CRITICAL]: "Crítica",
};

export const EFFORT_LEVEL_LABELS: Record<EFFORT_LEVEL, string> = {
  [EFFORT_LEVEL.LOW]: "Baixo",
  [EFFORT_LEVEL.MEDIUM]: "Médio",
  [EFFORT_LEVEL.HIGH]: "Alto",
};

export const CONFIDENCE_LEVEL_LABELS: Record<CONFIDENCE_LEVEL, string> = {
  [CONFIDENCE_LEVEL.LOW]: "Baixa",
  [CONFIDENCE_LEVEL.MEDIUM]: "Média",
  [CONFIDENCE_LEVEL.HIGH]: "Alta",
};

export const PERCENTAGE_ADJUST_TYPE_LABELS: Record<PERCENTAGE_ADJUST_TYPE, string> = {
  [PERCENTAGE_ADJUST_TYPE.INCREASE]: "Aumento",
  [PERCENTAGE_ADJUST_TYPE.DECREASE]: "Redução",
};

export const EXPORT_FORMAT_LABELS: Record<EXPORT_FORMAT, string> = {
  [EXPORT_FORMAT.CSV]: "CSV",
  [EXPORT_FORMAT.EXCEL]: "Excel",
  [EXPORT_FORMAT.PDF]: "PDF",
  [EXPORT_FORMAT.JSON]: "JSON",
};

export const BATCH_OPERATION_STATUS_LABELS: Record<BATCH_OPERATION_STATUS, string> = {
  [BATCH_OPERATION_STATUS.PENDING]: "Pendente",
  [BATCH_OPERATION_STATUS.PROCESSING]: "Processando",
  [BATCH_OPERATION_STATUS.COMPLETED]: "Concluído",
  [BATCH_OPERATION_STATUS.FAILED]: "Falhou",
  [BATCH_OPERATION_STATUS.PARTIAL]: "Parcial",
};

export const VALIDATION_SEVERITY_LABELS: Record<VALIDATION_SEVERITY, string> = {
  [VALIDATION_SEVERITY.ERROR]: "Erro",
  [VALIDATION_SEVERITY.WARNING]: "Aviso",
  [VALIDATION_SEVERITY.INFO]: "Informação",
};

export const VACATION_TYPE_LABELS: Record<VACATION_TYPE, string> = {
  [VACATION_TYPE.ANNUAL]: "Férias Anuais",
  [VACATION_TYPE.COLLECTIVE]: "Férias Coletivas",
  [VACATION_TYPE.MEDICAL]: "Licença Médica",
  [VACATION_TYPE.MATERNITY]: "Licença Maternidade",
  [VACATION_TYPE.PATERNITY]: "Licença Paternidade",
  [VACATION_TYPE.EMERGENCY]: "Emergência",
  [VACATION_TYPE.STUDY]: "Licença Estudo",
  [VACATION_TYPE.UNPAID]: "Não Remunerada",
  [VACATION_TYPE.OTHER]: "Outro",
};

export const WEEK_DAY_LABELS: Record<WEEK_DAY, string> = {
  [WEEK_DAY.MONDAY]: "Segunda-feira",
  [WEEK_DAY.TUESDAY]: "Terça-feira",
  [WEEK_DAY.WEDNESDAY]: "Quarta-feira",
  [WEEK_DAY.THURSDAY]: "Quinta-feira",
  [WEEK_DAY.FRIDAY]: "Sexta-feira",
  [WEEK_DAY.SATURDAY]: "Sábado",
  [WEEK_DAY.SUNDAY]: "Domingo",
};

export const MONTH_LABELS: Record<MONTH, string> = {
  [MONTH.JANUARY]: "Janeiro",
  [MONTH.FEBRUARY]: "Fevereiro",
  [MONTH.MARCH]: "Março",
  [MONTH.APRIL]: "Abril",
  [MONTH.MAY]: "Maio",
  [MONTH.JUNE]: "Junho",
  [MONTH.JULY]: "Julho",
  [MONTH.AUGUST]: "Agosto",
  [MONTH.SEPTEMBER]: "Setembro",
  [MONTH.OCTOBER]: "Outubro",
  [MONTH.NOVEMBER]: "Novembro",
  [MONTH.DECEMBER]: "Dezembro",
};

export const MONTH_OCCURRENCE_LABELS: Record<MONTH_OCCURRENCE, string> = {
  [MONTH_OCCURRENCE.FIRST]: "Primeira",
  [MONTH_OCCURRENCE.SECOND]: "Segunda",
  [MONTH_OCCURRENCE.THIRD]: "Terceira",
  [MONTH_OCCURRENCE.FOURTH]: "Quarta",
  [MONTH_OCCURRENCE.LAST]: "Última",
};

export const SCHEDULE_FREQUENCY_LABELS: Record<SCHEDULE_FREQUENCY, string> = {
  [SCHEDULE_FREQUENCY.ONCE]: "Uma Vez",
  [SCHEDULE_FREQUENCY.DAILY]: "Diário",
  [SCHEDULE_FREQUENCY.WEEKLY]: "Semanal",
  [SCHEDULE_FREQUENCY.BIWEEKLY]: "Quinzenal",
  [SCHEDULE_FREQUENCY.MONTHLY]: "Mensal",
  [SCHEDULE_FREQUENCY.BIMONTHLY]: "Bimestral",
  [SCHEDULE_FREQUENCY.QUARTERLY]: "Trimestral",
  [SCHEDULE_FREQUENCY.TRIANNUAL]: "Quadrimestral",
  [SCHEDULE_FREQUENCY.QUADRIMESTRAL]: "Quadrimestral",
  [SCHEDULE_FREQUENCY.SEMI_ANNUAL]: "Semestral",
  [SCHEDULE_FREQUENCY.ANNUAL]: "Anual",
  [SCHEDULE_FREQUENCY.CUSTOM]: "Personalizado",
};

/**
 * Generate dynamic frequency label based on frequency + interval
 * @param frequency Base frequency
 * @param interval Frequency interval/count (default: 1)
 * @returns Localized frequency label
 */
export function getDynamicFrequencyLabel(frequency: SCHEDULE_FREQUENCY, interval: number = 1): string {
  if (!interval || interval === 1) {
    return SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;
  }

  switch (frequency) {
    case SCHEDULE_FREQUENCY.DAILY:
      return interval === 1 ? "Diário" : `A cada ${interval} dias`;

    case SCHEDULE_FREQUENCY.WEEKLY:
      if (interval === 2) return "Quinzenal";
      return interval === 1 ? "Semanal" : `A cada ${interval} semanas`;

    case SCHEDULE_FREQUENCY.MONTHLY:
      if (interval === 2) return "Bimestral";
      if (interval === 3) return "Trimestral";
      if (interval === 4) return "Quadrimestral";
      if (interval === 6) return "Semestral";
      return interval === 1 ? "Mensal" : `A cada ${interval} meses`;

    case SCHEDULE_FREQUENCY.ANNUAL:
      return interval === 1 ? "Anual" : `A cada ${interval} anos`;

    default:
      return SCHEDULE_FREQUENCY_LABELS[frequency] || frequency;
  }
}

export const PANTS_SIZE_LABELS: Record<PANTS_SIZE, string> = {
  [PANTS_SIZE.SIZE_36]: "36",
  [PANTS_SIZE.SIZE_38]: "38",
  [PANTS_SIZE.SIZE_40]: "40",
  [PANTS_SIZE.SIZE_42]: "42",
  [PANTS_SIZE.SIZE_44]: "44",
  [PANTS_SIZE.SIZE_46]: "46",
  [PANTS_SIZE.SIZE_48]: "48",
};

export const SHIRT_SIZE_LABELS: Record<SHIRT_SIZE, string> = {
  [SHIRT_SIZE.P]: "P",
  [SHIRT_SIZE.M]: "M",
  [SHIRT_SIZE.G]: "G",
  [SHIRT_SIZE.GG]: "GG",
  [SHIRT_SIZE.XG]: "XG",
};

export const BOOT_SIZE_LABELS: Record<BOOT_SIZE, string> = {
  [BOOT_SIZE.SIZE_36]: "36",
  [BOOT_SIZE.SIZE_38]: "38",
  [BOOT_SIZE.SIZE_40]: "40",
  [BOOT_SIZE.SIZE_42]: "42",
  [BOOT_SIZE.SIZE_44]: "44",
  [BOOT_SIZE.SIZE_46]: "46",
  [BOOT_SIZE.SIZE_48]: "48",
};

export const SLEEVES_SIZE_LABELS: Record<SLEEVES_SIZE, string> = {
  [SLEEVES_SIZE.P]: "P",
  [SLEEVES_SIZE.M]: "M",
  [SLEEVES_SIZE.G]: "G",
  [SLEEVES_SIZE.GG]: "GG",
  [SLEEVES_SIZE.XG]: "XG",
};

export const MASK_SIZE_LABELS: Record<MASK_SIZE, string> = {
  [MASK_SIZE.P]: "Pequeno",
  [MASK_SIZE.M]: "Médio",
};

export const GLOVES_SIZE_LABELS: Record<GLOVES_SIZE, string> = {
  [GLOVES_SIZE.P]: "Pequeno",
  [GLOVES_SIZE.M]: "Médio",
  [GLOVES_SIZE.G]: "Grande",
};

export const RAIN_BOOTS_SIZE_LABELS: Record<RAIN_BOOTS_SIZE, string> = {
  [RAIN_BOOTS_SIZE.SIZE_36]: "36",
  [RAIN_BOOTS_SIZE.SIZE_38]: "38",
  [RAIN_BOOTS_SIZE.SIZE_40]: "40",
  [RAIN_BOOTS_SIZE.SIZE_42]: "42",
  [RAIN_BOOTS_SIZE.SIZE_44]: "44",
  [RAIN_BOOTS_SIZE.SIZE_46]: "46",
};

export const PPE_TYPE_LABELS: Record<PPE_TYPE, string> = {
  [PPE_TYPE.SHIRT]: "Camisa",
  [PPE_TYPE.PANTS]: "Calça",
  [PPE_TYPE.BOOTS]: "Botas",
  [PPE_TYPE.SLEEVES]: "Manguito",
  [PPE_TYPE.MASK]: "Máscara",
  [PPE_TYPE.GLOVES]: "Luvas",
  [PPE_TYPE.RAIN_BOOTS]: "Galocha",
};

export const PPE_SIZE_TYPE_LABELS: Record<PPE_SIZE_TYPE, string> = {
  [PPE_SIZE_TYPE.SHIRT]: "Camisa",
  [PPE_SIZE_TYPE.PANTS]: "Calça",
  [PPE_SIZE_TYPE.BOOT]: "Bota",
  [PPE_SIZE_TYPE.GLOVE]: "Luva",
  [PPE_SIZE_TYPE.MASK]: "Máscara",
  [PPE_SIZE_TYPE.OVERALL]: "Macacão",
  [PPE_SIZE_TYPE.HELMET]: "Capacete",
  [PPE_SIZE_TYPE.UNIFORM]: "Uniforme",
};

export const PPE_SIZE_LABELS: Record<PPE_SIZE, string> = {
  // Shirt, Sleeves, and Mask sizes
  [PPE_SIZE.P]: "P",
  [PPE_SIZE.M]: "M",
  [PPE_SIZE.G]: "G",
  [PPE_SIZE.GG]: "GG",
  [PPE_SIZE.XG]: "XG",

  // Pants and Boots sizes
  [PPE_SIZE.SIZE_36]: "36",
  [PPE_SIZE.SIZE_38]: "38",
  [PPE_SIZE.SIZE_40]: "40",
  [PPE_SIZE.SIZE_42]: "42",
  [PPE_SIZE.SIZE_44]: "44",
  [PPE_SIZE.SIZE_46]: "46",
  [PPE_SIZE.SIZE_48]: "48",
};

export const PPE_DELIVERY_MODE_LABELS: Record<PPE_DELIVERY_MODE, string> = {
  [PPE_DELIVERY_MODE.SCHEDULED]: "Programada",
  [PPE_DELIVERY_MODE.ON_DEMAND]: "Sob Demanda",
  [PPE_DELIVERY_MODE.BOTH]: "Ambas",
};

export const ACTIVITY_OPERATION_LABELS: Record<ACTIVITY_OPERATION, string> = {
  [ACTIVITY_OPERATION.INBOUND]: "Entrada",
  [ACTIVITY_OPERATION.OUTBOUND]: "Saída",
};

export const AUDIT_ACTION_LABELS: Record<AUDIT_ACTION, string> = {
  [AUDIT_ACTION.CREATE]: "Criar",
  [AUDIT_ACTION.UPDATE]: "Atualizar",
  [AUDIT_ACTION.DELETE]: "Excluir",
};

export const ENTITY_TYPE_LABELS: Record<ENTITY_TYPE, string> = {
  [ENTITY_TYPE.ACTIVITY]: "Atividade",
  [ENTITY_TYPE.AIRBRUSHING]: "Aerografia",
  [ENTITY_TYPE.BONUS]: "Bonificação",
  [ENTITY_TYPE.BORROW]: "Empréstimo",
  [ENTITY_TYPE.CATEGORY]: "Categoria",
  [ENTITY_TYPE.COLLECTION]: "Coleção",
  [ENTITY_TYPE.COMMISSION]: "Comissão",
  [ENTITY_TYPE.CUT]: "Corte",
  [ENTITY_TYPE.CUT_ITEM]: "Item de Corte",
  [ENTITY_TYPE.CUT_PLAN]: "Plano de Corte",
  [ENTITY_TYPE.CUT_REQUEST]: "Solicitação de Corte",
  [ENTITY_TYPE.CUSTOMER]: "Cliente",
  [ENTITY_TYPE.DASHBOARD]: "Dashboard",
  [ENTITY_TYPE.DEPLOYMENT]: "Implantação",
  [ENTITY_TYPE.DELIVERY]: "Entrega",
  [ENTITY_TYPE.DISCOUNT]: "Desconto",
  [ENTITY_TYPE.PPE_CONFIG]: "Configuração de EPI",
  [ENTITY_TYPE.PPE_DELIVERY]: "Entrega de EPI",
  [ENTITY_TYPE.PPE_REQUEST]: "Solicitação de EPI",
  [ENTITY_TYPE.PPE_DELIVERY_SCHEDULE]: "Agendamento de EPI",
  [ENTITY_TYPE.PPE_SIZE]: "Tamanho de EPI",
  [ENTITY_TYPE.EXTERNAL_WITHDRAWAL]: "Retirada Externa",
  [ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM]: "Item de Retirada Externa",
  [ENTITY_TYPE.FILE]: "Arquivo",
  [ENTITY_TYPE.FUEL]: "Combustível",
  [ENTITY_TYPE.GARAGE]: "Garagem",
  [ENTITY_TYPE.GARAGE_LANE]: "Pista de Garagem",
  [ENTITY_TYPE.HOLIDAY]: "Feriado",
  [ENTITY_TYPE.ITEM]: "Item",
  [ENTITY_TYPE.ITEM_BRAND]: "Marca do Item",
  [ENTITY_TYPE.ITEM_CATEGORY]: "Categoria do Item",
  [ENTITY_TYPE.LAYOUT]: "Layout",
  [ENTITY_TYPE.MAINTENANCE]: "Manutenção",
  [ENTITY_TYPE.MAINTENANCE_ITEM]: "Item de Manutenção",
  [ENTITY_TYPE.MAINTENANCE_SCHEDULE]: "Agendamento de Manutenção",
  [ENTITY_TYPE.MEASURE]: "Medida",
  [ENTITY_TYPE.NOTIFICATION]: "Notificação",
  [ENTITY_TYPE.NOTIFICATION_PREFERENCE]: "Preferência de Notificação",
  [ENTITY_TYPE.OBSERVATION]: "Observação",
  [ENTITY_TYPE.ORDER]: "Pedido",
  [ENTITY_TYPE.ORDER_ITEM]: "Item do Pedido",
  [ENTITY_TYPE.ORDER_RULE]: "Regra de Pedido",
  [ENTITY_TYPE.ORDER_SCHEDULE]: "Agendamento de Pedido",
  [ENTITY_TYPE.PAINT]: "Tinta",
  [ENTITY_TYPE.PAINT_BRAND]: "Marca de Tinta",
  [ENTITY_TYPE.PAINT_TYPE]: "Tipo de Tinta",
  [ENTITY_TYPE.PAINT_GROUND]: "Fundo de Tinta",
  [ENTITY_TYPE.PAINT_FORMULA]: "Fórmula de Tinta",
  [ENTITY_TYPE.PAINT_FORMULA_COMPONENT]: "Componente de Fórmula",
  [ENTITY_TYPE.PAINT_PRODUCTION]: "Produção de Tinta",
  [ENTITY_TYPE.PARKING_SPOT]: "Vaga de Estacionamento",
  [ENTITY_TYPE.PAYROLL]: "Folha de Pagamento",
  [ENTITY_TYPE.PIECE]: "Peça",
  [ENTITY_TYPE.POSITION]: "Cargo",
  [ENTITY_TYPE.POSITION_REMUNERATION]: "Remuneração do Cargo",
  [ENTITY_TYPE.PREFERENCES]: "Preferências",
  [ENTITY_TYPE.PRICE]: "Preço",
  [ENTITY_TYPE.PRODUCTION]: "Produção",
  [ENTITY_TYPE.PURCHASE]: "Compra",
  [ENTITY_TYPE.WARNING]: "Advertência",
  [ENTITY_TYPE.SECTOR]: "Setor",
  [ENTITY_TYPE.SEEN_NOTIFICATION]: "Notificação Vista",
  [ENTITY_TYPE.SERVICE]: "Serviço",
  [ENTITY_TYPE.SERVICE_ORDER]: "Ordem de Serviço",
  [ENTITY_TYPE.SUPPLIER]: "Fornecedor",
  [ENTITY_TYPE.TASK]: "Tarefa",
  [ENTITY_TYPE.TIME_CLOCK_ENTRY]: "Registro de Ponto",
  [ENTITY_TYPE.TRUCK]: "Caminhão",
  [ENTITY_TYPE.USER]: "Usuário",
  [ENTITY_TYPE.VACATION]: "Férias",
  [ENTITY_TYPE.VERIFICATION]: "Verificação",
};

export const FILE_ENTITY_TYPE_LABELS: Record<FILE_ENTITY_TYPE, string> = {
  [FILE_ENTITY_TYPE.TASK]: "Tarefa",
  [FILE_ENTITY_TYPE.CUSTOMER_LOGO]: "Logo do Cliente",
  [FILE_ENTITY_TYPE.SUPPLIER_LOGO]: "Logo do Fornecedor",
  [FILE_ENTITY_TYPE.OBSERVATION]: "Observação",
  [FILE_ENTITY_TYPE.WARNING]: "Advertência",
  [FILE_ENTITY_TYPE.ORDER_BUDGET]: "Orçamento do Pedido",
  [FILE_ENTITY_TYPE.ORDER_NFE]: "NFe do Pedido",
  [FILE_ENTITY_TYPE.ORDER_RECEIPT]: "Recibo do Pedido",
  [FILE_ENTITY_TYPE.TASK_BUDGET]: "Orçamento da Tarefa",
  [FILE_ENTITY_TYPE.TASK_NFE]: "NFe da Tarefa",
  [FILE_ENTITY_TYPE.TASK_RECEIPT]: "Recibo da Tarefa",
  [FILE_ENTITY_TYPE.AIRBRUSHING_RECEIPT]: "Recibo de Aerografia",
  [FILE_ENTITY_TYPE.AIRBRUSHING_NFE]: "NFe de Aerografia",
  [FILE_ENTITY_TYPE.EXTERNAL_WITHDRAWAL_BUDGET]: "Orçamento de Retirada Externa",
  [FILE_ENTITY_TYPE.EXTERNAL_WITHDRAWAL_NFE]: "NFe de Retirada Externa",
  [FILE_ENTITY_TYPE.EXTERNAL_WITHDRAWAL_RECEIPT]: "Recibo de Retirada Externa",
  [FILE_ENTITY_TYPE.EXPENSE]: "Despesa",
};

export const DELIVERY_MODE_LABELS: Record<PPE_DELIVERY_MODE, string> = {
  [PPE_DELIVERY_MODE.SCHEDULED]: "Programada",
  [PPE_DELIVERY_MODE.ON_DEMAND]: "Sob Demanda",
  [PPE_DELIVERY_MODE.BOTH]: "Ambos",
};

export const ORDER_TRIGGER_TYPE_LABELS: Record<ORDER_TRIGGER_TYPE, string> = {
  [ORDER_TRIGGER_TYPE.STOCK_LEVEL]: "Nível de Estoque",
  [ORDER_TRIGGER_TYPE.CONSUMPTION_RATE]: "Taxa de Consumo",
  [ORDER_TRIGGER_TYPE.SCHEDULED]: "Programado",
};

export const ACTIVITY_REASON_LABELS: Record<ACTIVITY_REASON, string> = {
  [ACTIVITY_REASON.ORDER_RECEIVED]: "Pedido Recebido",
  [ACTIVITY_REASON.PRODUCTION_USAGE]: "Uso em Produção",
  [ACTIVITY_REASON.PPE_DELIVERY]: "Entrega de EPI",
  [ACTIVITY_REASON.BORROW]: "Empréstimo",
  [ACTIVITY_REASON.RETURN]: "Devolução",
  [ACTIVITY_REASON.EXTERNAL_WITHDRAWAL]: "Retirada Externa",
  [ACTIVITY_REASON.INVENTORY_COUNT]: "Contagem de Inventário",
  [ACTIVITY_REASON.MANUAL_ADJUSTMENT]: "Ajuste Manual",
  [ACTIVITY_REASON.MAINTENANCE]: "Manutenção",
  [ACTIVITY_REASON.DAMAGE]: "Dano",
  [ACTIVITY_REASON.LOSS]: "Perda",
  [ACTIVITY_REASON.PAINT_PRODUCTION]: "Produção de Tinta",
  [ACTIVITY_REASON.EXTERNAL_WITHDRAWAL_RETURN]: "Retorno de Retirada Externa",
  [ACTIVITY_REASON.OTHER]: "Outro",
};

export const WORKLOAD_LEVEL_LABELS: Record<WORKLOAD_LEVEL, string> = {
  [WORKLOAD_LEVEL.LOW]: "Baixo",
  [WORKLOAD_LEVEL.NORMAL]: "Normal",
  [WORKLOAD_LEVEL.HIGH]: "Alto",
  [WORKLOAD_LEVEL.CRITICAL]: "Crítico",
};

export const FILE_FORMAT_LABELS: Record<FILE_FORMAT, string> = {
  [FILE_FORMAT.JSON]: "JSON",
  [FILE_FORMAT.YAML]: "YAML",
  [FILE_FORMAT.CSV]: "CSV",
  [FILE_FORMAT.EXCEL]: "Excel",
  [FILE_FORMAT.PDF]: "PDF",
};

export const ACTIVITY_LEVEL_LABELS: Record<ACTIVITY_LEVEL, string> = {
  [ACTIVITY_LEVEL.VERY_ACTIVE]: "Muito Ativo",
  [ACTIVITY_LEVEL.ACTIVE]: "Ativo",
  [ACTIVITY_LEVEL.OCCASIONAL]: "Ocasional",
  [ACTIVITY_LEVEL.DORMANT]: "Inativo",
  [ACTIVITY_LEVEL.LOST]: "Perdido",
};

export const CHANGE_ACTION_LABELS: Record<CHANGE_ACTION, string> = {
  [CHANGE_ACTION.CREATE]: "Criado",
  [CHANGE_ACTION.UPDATE]: "Atualizado",
  [CHANGE_ACTION.DELETE]: "Excluído",
  [CHANGE_ACTION.RESTORE]: "Restaurado",
  [CHANGE_ACTION.ROLLBACK]: "Revertido",
  [CHANGE_ACTION.ARCHIVE]: "Arquivado",
  [CHANGE_ACTION.UNARCHIVE]: "Desarquivado",
  [CHANGE_ACTION.ACTIVATE]: "Ativado",
  [CHANGE_ACTION.DEACTIVATE]: "Desativado",
  [CHANGE_ACTION.APPROVE]: "Aprovado",
  [CHANGE_ACTION.REJECT]: "Rejeitado",
  [CHANGE_ACTION.CANCEL]: "Cancelado",
  [CHANGE_ACTION.COMPLETE]: "Concluído",
  [CHANGE_ACTION.RESCHEDULE]: "Reagendado",
  [CHANGE_ACTION.BATCH_CREATE]: "Criado em Lote",
  [CHANGE_ACTION.BATCH_UPDATE]: "Atualizado em Lote",
  [CHANGE_ACTION.BATCH_DELETE]: "Excluído em Lote",
  [CHANGE_ACTION.VIEW]: "Visualizado",
};

export const CHANGE_TRIGGERED_BY_LABELS: Record<CHANGE_TRIGGERED_BY, string> = {
  [CHANGE_TRIGGERED_BY.TASK_CREATE]: "Criação de Tarefa",
  [CHANGE_TRIGGERED_BY.TASK_UPDATE]: "Atualização de Tarefa",
  [CHANGE_TRIGGERED_BY.ITEM_UPDATE]: "Atualização de Item",
  [CHANGE_TRIGGERED_BY.USER_ACTION]: "Ação do Usuário",
  [CHANGE_TRIGGERED_BY.BATCH_CREATE]: "Criação em Lote",
  [CHANGE_TRIGGERED_BY.BATCH_UPDATE]: "Atualização em Lote",
  [CHANGE_TRIGGERED_BY.BATCH_DELETE]: "Exclusão em Lote",
  [CHANGE_TRIGGERED_BY.BATCH_OPERATION]: "Operação em Lote",
  [CHANGE_TRIGGERED_BY.SYSTEM]: "Sistema",
  [CHANGE_TRIGGERED_BY.SYSTEM_GENERATED]: "Gerado pelo Sistema",
  [CHANGE_TRIGGERED_BY.USER]: "Usuário",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL]: "Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_DELETE]: "Exclusão de Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_RETURN]: "Devolução de Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_SYNC]: "Sincronização de Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM]: "Item de Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM_UPDATE]: "Atualização de Item de Retirada Externa",
  [CHANGE_TRIGGERED_BY.EXTERNAL_WITHDRAWAL_ITEM_DELETE]: "Exclusão de Item de Retirada Externa",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_CREATE]: "Criação de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_UPDATE]: "Atualização de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_DELETE]: "Exclusão de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_CREATE]: "Criação em Lote de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_UPDATE]: "Atualização em Lote de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_COMPONENT_BATCH_DELETE]: "Exclusão em Lote de Componente de Fórmula",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_CREATE]: "Criação de Produção de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_UPDATE]: "Atualização de Produção de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_DELETE]: "Exclusão de Produção de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_CREATE]: "Criação de Produção de Tinta em Lote",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_UPDATE]: "Atualização de Produção de Tinta em Lote",
  [CHANGE_TRIGGERED_BY.PAINT_PRODUCTION_BATCH_DELETE]: "Exclusão de Produção de Tinta em Lote",
  [CHANGE_TRIGGERED_BY.PAINT_CREATE]: "Criação de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_UPDATE]: "Atualização de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_DELETE]: "Exclusão de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BATCH_CREATE]: "Criação em Lote de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BATCH_UPDATE]: "Atualização em Lote de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BATCH_DELETE]: "Exclusão em Lote de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_CREATE]: "Criação de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_UPDATE]: "Atualização de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_DELETE]: "Exclusão de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_CREATE]: "Criação em Lote de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_UPDATE]: "Atualização em Lote de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_FORMULA_BATCH_DELETE]: "Exclusão em Lote de Fórmula de Tinta",
  [CHANGE_TRIGGERED_BY.ORDER_UPDATE]: "Atualização de Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_CREATE]: "Criação de Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_STATUS_CHANGE]: "Alteração de Status do Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_CANCEL]: "Cancelamento de Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_ITEM_UPDATE]: "Atualização de Item do Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_ITEM_RECEIVED]: "Recebimento de Item do Pedido",
  [CHANGE_TRIGGERED_BY.ORDER_ITEM_SYNC]: "Sincronização de Item do Pedido",
  [CHANGE_TRIGGERED_BY.SCHEDULE]: "Agendamento",
  [CHANGE_TRIGGERED_BY.ACTIVITY_CREATE]: "Criação de Atividade",
  [CHANGE_TRIGGERED_BY.ACTIVITY_UPDATE]: "Atualização de Atividade",
  [CHANGE_TRIGGERED_BY.ACTIVITY_DELETE]: "Exclusão de Atividade",
  [CHANGE_TRIGGERED_BY.PPE_DELIVERY]: "Entrega de EPI",
  [CHANGE_TRIGGERED_BY.ACTIVITY_SYNC]: "Sincronização de Atividade",
  [CHANGE_TRIGGERED_BY.INVENTORY_ADJUSTMENT]: "Ajuste de Inventário",
  [CHANGE_TRIGGERED_BY.INVENTORY_COUNT]: "Contagem de Inventário",
  [CHANGE_TRIGGERED_BY.ITEM_MONTHLY_CONSUMPTION_UPDATE]: "Atualização de Consumo Mensal do Item",
  [CHANGE_TRIGGERED_BY.AUTOMATIC_MIN_MAX_UPDATE]: "Atualização Automática de Mín/Máx",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_CREATE]: "Criação de tipo de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_UPDATE]: "Atualização de tipo de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_DELETE]: "Remoção de tipo de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_CREATE]: "Criação em Lote de Tipo de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_UPDATE]: "Atualização em Lote de Tipo de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_TYPE_BATCH_DELETE]: "Exclusão em Lote de Tipo de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_CREATE]: "Criação de marca de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_UPDATE]: "Atualização de marca de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_DELETE]: "Remoção de marca de tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_CREATE]: "Criação em Lote de Marca de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_UPDATE]: "Atualização em Lote de Marca de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_BRAND_BATCH_DELETE]: "Exclusão em Lote de Marca de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_CREATE]: "Criação de Base de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_UPDATE]: "Atualização de Base de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_DELETE]: "Exclusão de Base de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_CREATE]: "Criação em Lote de Base de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_UPDATE]: "Atualização em Lote de Base de Tinta",
  [CHANGE_TRIGGERED_BY.PAINT_GROUND_BATCH_DELETE]: "Exclusão em Lote de Base de Tinta",
  [CHANGE_TRIGGERED_BY.SMS_VERIFICATION_CREATE]: "Criação de Verificação SMS",
  [CHANGE_TRIGGERED_BY.SMS_VERIFICATION_SEND]: "Envio de Verificação SMS",
  [CHANGE_TRIGGERED_BY.SMS_VERIFICATION_VERIFY]: "Verificação SMS",
  [CHANGE_TRIGGERED_BY.SMS_VERIFICATION_EXPIRE]: "Expiração de Verificação SMS",
  [CHANGE_TRIGGERED_BY.SMS_VERIFICATION_CANCEL]: "Cancelamento de Verificação SMS",
  [CHANGE_TRIGGERED_BY.EMAIL_SERVICE]: "Serviço de Email",
  [CHANGE_TRIGGERED_BY.VERIFICATION_CREATE]: "Criação de Verificação",
  [CHANGE_TRIGGERED_BY.VERIFICATION_SEND]: "Envio de Verificação",
  [CHANGE_TRIGGERED_BY.VERIFICATION_VERIFY]: "Verificação Concluída",
  [CHANGE_TRIGGERED_BY.VERIFICATION_EXPIRE]: "Expiração de Verificação",
  [CHANGE_TRIGGERED_BY.VERIFICATION_CANCEL]: "Cancelamento de Verificação",
  [CHANGE_TRIGGERED_BY.VERIFICATION_RESEND]: "Reenvio de Verificação",
  [CHANGE_TRIGGERED_BY.VEHICLE_MOVEMENT]: "Movimentação de veículo",
  [CHANGE_TRIGGERED_BY.PARKING_ASSIGNMENT]: "Atribuição de estacionamento",
  [CHANGE_TRIGGERED_BY.GARAGE_CAPACITY_CHANGE]: "Alteração de capacidade da garagem",
  [CHANGE_TRIGGERED_BY.OBSERVATION_CREATE]: "Criação de observação",
  [CHANGE_TRIGGERED_BY.OBSERVATION_DELETE]: "Exclusão de observação",
  [CHANGE_TRIGGERED_BY.SCHEDULED_JOB]: "Tarefa Agendada",
  [CHANGE_TRIGGERED_BY.API]: "API",
  [CHANGE_TRIGGERED_BY.WEBHOOK]: "Webhook",
  [CHANGE_TRIGGERED_BY.ADMIN]: "Administrador",
};

export const EVENT_TYPE_LABELS: Record<EVENT_TYPE, string> = {
  [EVENT_TYPE.CREATED]: "Criado",
  [EVENT_TYPE.STARTED]: "Iniciado",
  [EVENT_TYPE.PAUSED]: "Pausado",
  [EVENT_TYPE.RESUMED]: "Retomado",
  [EVENT_TYPE.COMPLETED]: "Concluído",
  [EVENT_TYPE.CANCELLED]: "Cancelado",
};

export const TIMELINE_EVENT_TYPE_LABELS: Record<TIMELINE_EVENT_TYPE, string> = {
  [TIMELINE_EVENT_TYPE.CREATED]: "Criado",
  [TIMELINE_EVENT_TYPE.UPDATED]: "Atualizado",
  [TIMELINE_EVENT_TYPE.STATUS_CHANGED]: "Status Alterado",
  [TIMELINE_EVENT_TYPE.FILE_ADDED]: "Arquivo Adicionado",
  [TIMELINE_EVENT_TYPE.FILE_REMOVED]: "Arquivo Removido",
  [TIMELINE_EVENT_TYPE.NOTE_ADDED]: "Nota Adicionada",
  [TIMELINE_EVENT_TYPE.ASSIGNED]: "Atribuído",
  [TIMELINE_EVENT_TYPE.COMPLETED]: "Concluído",
};

export const MERGE_STRATEGY_LABELS: Record<MERGE_STRATEGY, string> = {
  [MERGE_STRATEGY.KEEP_PRIMARY]: "Manter Principal",
  [MERGE_STRATEGY.KEEP_NEWEST]: "Manter Mais Recente",
  [MERGE_STRATEGY.MANUAL]: "Manual",
};

export const GROUP_BY_LABELS: Record<GROUP_BY, string> = {
  [GROUP_BY.DAY]: "Dia",
  [GROUP_BY.WEEK]: "Semana",
  [GROUP_BY.MONTH]: "Mês",
  [GROUP_BY.YEAR]: "Ano",
  [GROUP_BY.ITEM]: "Item",
  [GROUP_BY.USER]: "Usuário",
};

export const ALERT_TYPE_LABELS: Record<ALERT_TYPE, string> = {
  // Activity Alerts
  [ALERT_TYPE.HIGH_SPENDING]: "Alto Gasto",
  [ALERT_TYPE.UNUSUAL_PATTERN]: "Padrão Incomum",
  [ALERT_TYPE.DISCREPANCY]: "Discrepância",
  [ALERT_TYPE.LOW_STOCK]: "Estoque Baixo",

  // Item Alerts
  [ALERT_TYPE.STOCK_OUT]: "Sem Estoque",
  [ALERT_TYPE.OVERSTOCK]: "Excesso de Estoque",
  [ALERT_TYPE.SLOW_MOVING]: "Baixa Movimentação",
  [ALERT_TYPE.REORDER_NEEDED]: "Reposição Necessária",

  // User Alerts
  [ALERT_TYPE.HIGH_TURNOVER]: "Alta Rotatividade",
  [ALERT_TYPE.ATTENDANCE_ISSUE]: "Problema de Assiduidade",

  // Order Alerts
  [ALERT_TYPE.DELIVERY_DELAY]: "Atraso na Entrega",

  // Customer Alerts
  [ALERT_TYPE.SERVICE_ISSUE]: "Problema de Serviço",
  [ALERT_TYPE.PAYMENT_DELAY]: "Atraso no Pagamento",

  // Task Alerts
  [ALERT_TYPE.OVERDUE]: "Atrasado",
  [ALERT_TYPE.CUSTOMER_COMPLAINT]: "Reclamação do Cliente",

  // Borrow Alerts
  [ALERT_TYPE.HIGH_DEMAND]: "Alta Demanda",
  [ALERT_TYPE.USER_VIOLATION]: "Violação do Usuário",

  // Vacation Alerts
  [ALERT_TYPE.EXPIRING_DAYS]: "Dias Expirando",
  [ALERT_TYPE.PLANNING_CONFLICT]: "Conflito de Planejamento",

  // Warning Alerts
  [ALERT_TYPE.REPEAT_OFFENDER]: "Reincidente",
  [ALERT_TYPE.ESCALATION_NEEDED]: "Escalonamento Necessário",
  [ALERT_TYPE.PATTERN_DETECTED]: "Padrão Detectado",

  // PPE Alerts
  [ALERT_TYPE.STOCK_SHORTAGE]: "Falta de Estoque",
  [ALERT_TYPE.MISSING_DELIVERY]: "Entrega Faltante",

  // Supplier Alerts
  [ALERT_TYPE.DELIVERY_DELAYS]: "Atrasos na Entrega",
};

export const TASK_OBSERVATION_TYPE_LABELS: Record<TASK_OBSERVATION_TYPE, string> = {
  [TASK_OBSERVATION_TYPE.DAMAGE]: "Dano Causado",
  [TASK_OBSERVATION_TYPE.OVERDUE]: "Atrasado",
  [TASK_OBSERVATION_TYPE.QUALITY]: "Qualidade",
};

export const ITEM_ISSUE_TYPE_LABELS: Record<ITEM_ISSUE_TYPE, string> = {
  [ITEM_ISSUE_TYPE.OVERAGE]: "Excesso",
  [ITEM_ISSUE_TYPE.SHORTAGE]: "Falta",
  [ITEM_ISSUE_TYPE.DAMAGE]: "Dano",
  [ITEM_ISSUE_TYPE.MISMATCH]: "Divergência",
};

export const ITEM_CATEGORY_TYPE_LABELS: Record<ITEM_CATEGORY_TYPE, string> = {
  [ITEM_CATEGORY_TYPE.REGULAR]: "Regular",
  [ITEM_CATEGORY_TYPE.TOOL]: "Ferramenta",
  [ITEM_CATEGORY_TYPE.PPE]: "EPI",
};

export const TIME_RANGE_LABELS: Record<TIME_RANGE, string> = {
  [TIME_RANGE.LAST_7_DAYS]: "Últimos 7 Dias",
  [TIME_RANGE.LAST_30_DAYS]: "Últimos 30 Dias",
  [TIME_RANGE.LAST_90_DAYS]: "Últimos 90 Dias",
  [TIME_RANGE.LAST_YEAR]: "Último Ano",
  [TIME_RANGE.CUSTOM]: "Personalizado",
};

export const DASHBOARD_TIME_PERIOD_LABELS: Record<DASHBOARD_TIME_PERIOD, string> = {
  [DASHBOARD_TIME_PERIOD.TODAY]: "Hoje",
  [DASHBOARD_TIME_PERIOD.THIS_WEEK]: "Esta Semana",
  [DASHBOARD_TIME_PERIOD.THIS_MONTH]: "Este Mês",
  [DASHBOARD_TIME_PERIOD.THIS_YEAR]: "Este Ano",
  [DASHBOARD_TIME_PERIOD.TOTAL]: "Total",
  [DASHBOARD_TIME_PERIOD.ALL_TIME]: "Todo Período",
};

export const RESCHEDULE_REASON_LABELS: Record<RESCHEDULE_REASON, string> = {
  [RESCHEDULE_REASON.LOW_FUNDS]: "Fundos Insuficientes",
  [RESCHEDULE_REASON.SUPPLIER_DELAY]: "Atraso do Fornecedor",
  [RESCHEDULE_REASON.OPERATIONAL_ISSUE]: "Problema Operacional",
  [RESCHEDULE_REASON.PRIORITY_CHANGE]: "Mudança de Prioridade",
  [RESCHEDULE_REASON.SEASONAL_ADJUSTMENT]: "Ajuste Sazonal",
  [RESCHEDULE_REASON.EMERGENCY]: "Emergência",
  [RESCHEDULE_REASON.OTHER]: "Outro",
};

export const CHANGE_LOG_ENTITY_TYPE_LABELS: Record<CHANGE_LOG_ENTITY_TYPE, string> = {
  [CHANGE_LOG_ENTITY_TYPE.ACTIVITY]: "Atividade",
  [CHANGE_LOG_ENTITY_TYPE.AIRBRUSHING]: "Aerografia",
  [CHANGE_LOG_ENTITY_TYPE.BONUS]: "Bonificação",
  [CHANGE_LOG_ENTITY_TYPE.BORROW]: "Empréstimo",
  [CHANGE_LOG_ENTITY_TYPE.CATEGORY]: "Categoria",
  [CHANGE_LOG_ENTITY_TYPE.COLLECTION]: "Coleção",
  [CHANGE_LOG_ENTITY_TYPE.CUT]: "Corte",
  [CHANGE_LOG_ENTITY_TYPE.CUT_ITEM]: "Item de Corte",
  [CHANGE_LOG_ENTITY_TYPE.CUT_PLAN]: "Plano de Corte",
  [CHANGE_LOG_ENTITY_TYPE.CUT_REQUEST]: "Solicitação de Corte",
  [CHANGE_LOG_ENTITY_TYPE.DELIVERY]: "Entrega",
  [CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY]: "Entrega EPI",
  [CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY_ITEM]: "Item Entrega EPI",
  [CHANGE_LOG_ENTITY_TYPE.PPE_REQUEST]: "Solicitação EPI",
  [CHANGE_LOG_ENTITY_TYPE.PPE_DELIVERY_SCHEDULE]: "Agendamento EPI",
  [CHANGE_LOG_ENTITY_TYPE.PPE_SIZE]: "Tamanho EPI",
  [CHANGE_LOG_ENTITY_TYPE.EXTERNAL_WITHDRAWAL]: "Retirada Externa",
  [CHANGE_LOG_ENTITY_TYPE.EXTERNAL_WITHDRAWAL_ITEM]: "Item de Retirada Externa",
  [CHANGE_LOG_ENTITY_TYPE.FILE]: "Arquivo",
  [CHANGE_LOG_ENTITY_TYPE.GARAGE_LANE]: "Faixa de Garagem",
  [CHANGE_LOG_ENTITY_TYPE.ITEM]: "Item",
  [CHANGE_LOG_ENTITY_TYPE.ITEM_BRAND]: "Marca de Item",
  [CHANGE_LOG_ENTITY_TYPE.ITEM_CATEGORY]: "Categoria de Item",
  [CHANGE_LOG_ENTITY_TYPE.LAYOUT]: "Layout",
  [CHANGE_LOG_ENTITY_TYPE.MAINTENANCE]: "Manutenção",
  [CHANGE_LOG_ENTITY_TYPE.MAINTENANCE_SCHEDULE]: "Agendamento de Manutenção",
  [CHANGE_LOG_ENTITY_TYPE.NOTIFICATION]: "Notificação",
  [CHANGE_LOG_ENTITY_TYPE.ORDER]: "Pedido",
  [CHANGE_LOG_ENTITY_TYPE.ORDER_ITEM]: "Item do Pedido",
  [CHANGE_LOG_ENTITY_TYPE.ORDER_RULE]: "Regra de Pedido",
  [CHANGE_LOG_ENTITY_TYPE.ORDER_SCHEDULE]: "Agendamento de Pedido",
  [CHANGE_LOG_ENTITY_TYPE.PAINT]: "Tinta",
  [CHANGE_LOG_ENTITY_TYPE.PAINT_TYPE]: "Tipo de Tinta",
  [CHANGE_LOG_ENTITY_TYPE.SERVICE]: "Serviço",
  [CHANGE_LOG_ENTITY_TYPE.PAINT_GROUND]: "Base de Tinta",
  [CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA]: "Fórmula de Tinta",
  [CHANGE_LOG_ENTITY_TYPE.PAINT_FORMULA_COMPONENT]: "Componente de Fórmula",
  [CHANGE_LOG_ENTITY_TYPE.PAINT_PRODUCTION]: "Produção de Pintura",
  [CHANGE_LOG_ENTITY_TYPE.PARKING_SPOT]: "Vaga de Estacionamento",
  [CHANGE_LOG_ENTITY_TYPE.PIECE]: "Peça",
  [CHANGE_LOG_ENTITY_TYPE.POSITION]: "Cargo",
  [CHANGE_LOG_ENTITY_TYPE.PRODUCTION]: "Produção",
  [CHANGE_LOG_ENTITY_TYPE.PURCHASE]: "Compra",
  [CHANGE_LOG_ENTITY_TYPE.WARNING]: "Advertência",
  [CHANGE_LOG_ENTITY_TYPE.SECTOR]: "Setor",
  [CHANGE_LOG_ENTITY_TYPE.SERVICE_ORDER]: "Ordem de Serviço",
  [CHANGE_LOG_ENTITY_TYPE.SUPPLIER]: "Fornecedor",
  [CHANGE_LOG_ENTITY_TYPE.TASK]: "Tarefa",
  [CHANGE_LOG_ENTITY_TYPE.TIME_CLOCK_ENTRY]: "Registro de Ponto",
  [CHANGE_LOG_ENTITY_TYPE.USER]: "Usuário",
  [CHANGE_LOG_ENTITY_TYPE.VACATION]: "Férias",
  [CHANGE_LOG_ENTITY_TYPE.MAINTENANCE_ITEM]: "Item de Manutenção",
  [CHANGE_LOG_ENTITY_TYPE.PPE_CONFIG]: "Configuração de EPI",
  [CHANGE_LOG_ENTITY_TYPE.PRICE]: "Preço",
  [CHANGE_LOG_ENTITY_TYPE.HOLIDAY]: "Feriado",
  [CHANGE_LOG_ENTITY_TYPE.CUSTOMER]: "Cliente",
  [CHANGE_LOG_ENTITY_TYPE.TRUCK]: "Caminhão",
  [CHANGE_LOG_ENTITY_TYPE.SEEN_NOTIFICATION]: "Notificação Visualizada",
  [CHANGE_LOG_ENTITY_TYPE.NOTIFICATION_PREFERENCE]: "Preferência de Notificação",
  [CHANGE_LOG_ENTITY_TYPE.VERIFICATION]: "Verificação",
  [CHANGE_LOG_ENTITY_TYPE.EXPENSE]: "Despesa",
  [CHANGE_LOG_ENTITY_TYPE.COMMISSION]: "Comissão",
  [CHANGE_LOG_ENTITY_TYPE.DISCOUNT]: "Desconto",
  [CHANGE_LOG_ENTITY_TYPE.PAYROLL]: "Folha de Pagamento",
  [CHANGE_LOG_ENTITY_TYPE.DEPLOYMENT]: "Implantação",
};

export const CHANGE_LOG_ACTION_LABELS: Record<CHANGE_LOG_ACTION, string> = {
  [CHANGE_LOG_ACTION.CREATE]: "Criar",
  [CHANGE_LOG_ACTION.UPDATE]: "Atualizar",
  [CHANGE_LOG_ACTION.DELETE]: "Excluir",
  [CHANGE_LOG_ACTION.RESTORE]: "Restaurar",
  [CHANGE_LOG_ACTION.ROLLBACK]: "Reverter",
  [CHANGE_LOG_ACTION.ARCHIVE]: "Arquivar",
  [CHANGE_LOG_ACTION.UNARCHIVE]: "Desarquivar",
  [CHANGE_LOG_ACTION.ACTIVATE]: "Ativar",
  [CHANGE_LOG_ACTION.DEACTIVATE]: "Desativar",
  [CHANGE_LOG_ACTION.APPROVE]: "Aprovar",
  [CHANGE_LOG_ACTION.REJECT]: "Rejeitar",
  [CHANGE_LOG_ACTION.CANCEL]: "Cancelar",
  [CHANGE_LOG_ACTION.COMPLETE]: "Concluir",
  [CHANGE_LOG_ACTION.RESCHEDULE]: "Reagendar",
  [CHANGE_LOG_ACTION.BATCH_CREATE]: "Criar em Lote",
  [CHANGE_LOG_ACTION.BATCH_UPDATE]: "Atualizar em Lote",
  [CHANGE_LOG_ACTION.BATCH_DELETE]: "Excluir em Lote",
  [CHANGE_LOG_ACTION.VIEW]: "Visualizar",
};

// =====================
// SMS Verification Labels
// =====================

export const SMS_VERIFICATION_STATUS_LABELS: Record<SMS_VERIFICATION_STATUS, string> = {
  [SMS_VERIFICATION_STATUS.PENDING]: "Pendente",
  [SMS_VERIFICATION_STATUS.SENT]: "Enviado",
  [SMS_VERIFICATION_STATUS.VERIFIED]: "Verificado",
  [SMS_VERIFICATION_STATUS.EXPIRED]: "Expirado",
  [SMS_VERIFICATION_STATUS.FAILED]: "Falhou",
  [SMS_VERIFICATION_STATUS.CANCELLED]: "Cancelado",
  [SMS_VERIFICATION_STATUS.RATE_LIMITED]: "Limitado por Taxa",
  [SMS_VERIFICATION_STATUS.BLOCKED]: "Bloqueado",
};

export const SMS_VERIFICATION_TYPE_LABELS: Record<SMS_VERIFICATION_TYPE, string> = {
  [SMS_VERIFICATION_TYPE.PHONE_VERIFICATION]: "Verificação de Telefone",
  [SMS_VERIFICATION_TYPE.EMAIL_VERIFICATION]: "Verificação de Email",
  [SMS_VERIFICATION_TYPE.PASSWORD_RESET]: "Redefinição de Senha",
  [SMS_VERIFICATION_TYPE.TWO_FACTOR_AUTH]: "Autenticação de Dois Fatores",
  [SMS_VERIFICATION_TYPE.ACCOUNT_CONFIRMATION]: "Confirmação de Conta",
};

// =====================
// Rate Limiting Labels
// =====================

export const RATE_LIMIT_TYPE_LABELS: Record<RATE_LIMIT_TYPE, string> = {
  [RATE_LIMIT_TYPE.PER_CODE_ATTEMPT]: "Tentativas por Código",
  [RATE_LIMIT_TYPE.IP_VERIFICATION]: "Verificação por IP",
  [RATE_LIMIT_TYPE.CODE_SEND_CONTACT]: "Envio por Contato",
  [RATE_LIMIT_TYPE.CODE_SEND_IP]: "Envio por IP",
  [RATE_LIMIT_TYPE.ACCOUNT_LOCKOUT]: "Bloqueio de Conta",
  [RATE_LIMIT_TYPE.GLOBAL_RATE_LIMIT]: "Limite Global",
};

export const LOCKOUT_REASON_LABELS: Record<LOCKOUT_REASON, string> = {
  [LOCKOUT_REASON.EXCESSIVE_FAILED_ATTEMPTS]: "Excesso de Tentativas Falhadas",
  [LOCKOUT_REASON.IP_ABUSE_DETECTED]: "Abuso de IP Detectado",
  [LOCKOUT_REASON.PATTERN_ABUSE]: "Padrão de Abuso",
  [LOCKOUT_REASON.CAPTCHA_FAILURES]: "Falhas no CAPTCHA",
  [LOCKOUT_REASON.MANUAL_ADMIN_LOCK]: "Bloqueio Manual do Admin",
  [LOCKOUT_REASON.SECURITY_VIOLATION]: "Violação de Segurança",
};

export const CAPTCHA_REQUIREMENT_LEVEL_LABELS: Record<CAPTCHA_REQUIREMENT_LEVEL, string> = {
  [CAPTCHA_REQUIREMENT_LEVEL.NONE]: "Nenhum",
  [CAPTCHA_REQUIREMENT_LEVEL.BASIC]: "Básico",
  [CAPTCHA_REQUIREMENT_LEVEL.INTERMEDIATE]: "Intermediário",
  [CAPTCHA_REQUIREMENT_LEVEL.ADVANCED]: "Avançado",
  [CAPTCHA_REQUIREMENT_LEVEL.MAXIMUM]: "Máximo",
};

export const VERIFICATION_ABUSE_LEVEL_LABELS: Record<VERIFICATION_ABUSE_LEVEL, string> = {
  [VERIFICATION_ABUSE_LEVEL.LOW]: "Baixo",
  [VERIFICATION_ABUSE_LEVEL.MEDIUM]: "Médio",
  [VERIFICATION_ABUSE_LEVEL.HIGH]: "Alto",
  [VERIFICATION_ABUSE_LEVEL.CRITICAL]: "Crítico",
  [VERIFICATION_ABUSE_LEVEL.SEVERE]: "Severo",
};

export const PROGRESSIVE_DELAY_TIER_LABELS: Record<PROGRESSIVE_DELAY_TIER, string> = {
  [PROGRESSIVE_DELAY_TIER.TIER_1]: "5 segundos",
  [PROGRESSIVE_DELAY_TIER.TIER_2]: "15 segundos",
  [PROGRESSIVE_DELAY_TIER.TIER_3]: "30 segundos",
  [PROGRESSIVE_DELAY_TIER.TIER_4]: "1 minuto",
  [PROGRESSIVE_DELAY_TIER.TIER_5]: "5 minutos",
  [PROGRESSIVE_DELAY_TIER.TIER_6]: "15 minutos",
  [PROGRESSIVE_DELAY_TIER.TIER_7]: "30 minutos",
  [PROGRESSIVE_DELAY_TIER.TIER_8]: "1 hora",
};

export const VERIFICATION_SECURITY_ACTION_LABELS: Record<VERIFICATION_SECURITY_ACTION, string> = {
  [VERIFICATION_SECURITY_ACTION.LOG_ATTEMPT]: "Registrar Tentativa",
  [VERIFICATION_SECURITY_ACTION.DELAY_RESPONSE]: "Atrasar Resposta",
  [VERIFICATION_SECURITY_ACTION.REQUIRE_CAPTCHA]: "Requerer CAPTCHA",
  [VERIFICATION_SECURITY_ACTION.TEMPORARY_BLOCK]: "Bloqueio Temporário",
  [VERIFICATION_SECURITY_ACTION.ESCALATE_SECURITY]: "Escalar Segurança",
  [VERIFICATION_SECURITY_ACTION.NOTIFY_ADMIN]: "Notificar Admin",
  [VERIFICATION_SECURITY_ACTION.PERMANENT_BLOCK]: "Bloqueio Permanente",
};

// =====================
// Email Labels
// =====================

export const EMAIL_TYPE_LABELS: Record<EMAIL_TYPE, string> = {
  [EMAIL_TYPE.PASSWORD_RESET]: "Redefinição de Senha",
  [EMAIL_TYPE.TEMPORARY_PASSWORD]: "Senha Temporária",
  [EMAIL_TYPE.ACCOUNT_VERIFICATION]: "Verificação de Conta",
  [EMAIL_TYPE.PASSWORD_CHANGED]: "Senha Alterada",
  [EMAIL_TYPE.ACCOUNT_STATUS_CHANGE]: "Alteração de Status da Conta",
  [EMAIL_TYPE.WELCOME]: "Bem-vindo",
  [EMAIL_TYPE.NOTIFICATION]: "Notificação",
};

export const EMAIL_STATUS_LABELS: Record<EMAIL_STATUS, string> = {
  [EMAIL_STATUS.PENDING]: "Pendente",
  [EMAIL_STATUS.SENT]: "Enviado",
  [EMAIL_STATUS.DELIVERED]: "Entregue",
  [EMAIL_STATUS.FAILED]: "Falhou",
  [EMAIL_STATUS.BOUNCED]: "Rejeitado",
  [EMAIL_STATUS.CANCELLED]: "Cancelado",
};

// =====================
// Unified Verification Labels
// =====================

export const VERIFICATION_STATUS_LABELS: Record<VERIFICATION_STATUS, string> = {
  [VERIFICATION_STATUS.PENDING]: "Pendente",
  [VERIFICATION_STATUS.SENT]: "Enviado",
  [VERIFICATION_STATUS.VERIFIED]: "Verificado",
  [VERIFICATION_STATUS.EXPIRED]: "Expirado",
  [VERIFICATION_STATUS.FAILED]: "Falhou",
  [VERIFICATION_STATUS.CANCELLED]: "Cancelado",
};

export const VERIFICATION_METHOD_LABELS: Record<VERIFICATION_METHOD, string> = {
  [VERIFICATION_METHOD.EMAIL]: "E-mail",
  [VERIFICATION_METHOD.PHONE]: "Telefone",
  [VERIFICATION_METHOD.EMAIL_AND_PHONE]: "E-mail e Telefone",
};

export const VERIFICATION_PURPOSE_LABELS: Record<VERIFICATION_PURPOSE, string> = {
  [VERIFICATION_PURPOSE.ACCOUNT_VERIFICATION]: "Verificação de Conta",
  [VERIFICATION_PURPOSE.PASSWORD_RESET]: "Redefinição de Senha",
  [VERIFICATION_PURPOSE.PHONE_VERIFICATION]: "Verificação de Telefone",
  [VERIFICATION_PURPOSE.EMAIL_VERIFICATION]: "Verificação de E-mail",
  [VERIFICATION_PURPOSE.TWO_FACTOR_AUTH]: "Autenticação de Dois Fatores",
  [VERIFICATION_PURPOSE.LOGIN_VERIFICATION]: "Verificação de Login",
};

// =====================
// Item Notes & Documents Labels
// =====================

export const NOTE_CATEGORY_LABELS: Record<NOTE_CATEGORY, string> = {
  [NOTE_CATEGORY.GENERAL]: "Geral",
  [NOTE_CATEGORY.QUALITY]: "Qualidade",
  [NOTE_CATEGORY.MAINTENANCE]: "Manutenção",
  [NOTE_CATEGORY.COMPLIANCE]: "Conformidade",
  [NOTE_CATEGORY.SPECIFICATION]: "Especificação",
  [NOTE_CATEGORY.USAGE]: "Uso",
  [NOTE_CATEGORY.SUPPLIER]: "Fornecedor",
  [NOTE_CATEGORY.SAFETY]: "Segurança",
  [NOTE_CATEGORY.OTHER]: "Outro",
};

export const DOCUMENT_CATEGORY_LABELS: Record<DOCUMENT_CATEGORY, string> = {
  [DOCUMENT_CATEGORY.TECHNICAL_SPEC]: "Especificação Técnica",
  [DOCUMENT_CATEGORY.CERTIFICATE]: "Certificado",
  [DOCUMENT_CATEGORY.MANUAL]: "Manual",
  [DOCUMENT_CATEGORY.SAFETY_DATA]: "Dados de Segurança",
  [DOCUMENT_CATEGORY.WARRANTY]: "Garantia",
  [DOCUMENT_CATEGORY.INVOICE]: "Nota Fiscal",
  [DOCUMENT_CATEGORY.CONTRACT]: "Contrato",
  [DOCUMENT_CATEGORY.COMPLIANCE]: "Conformidade",
  [DOCUMENT_CATEGORY.PHOTO]: "Foto",
  [DOCUMENT_CATEGORY.OTHER]: "Outro",
};

export const LINK_TYPE_LABELS: Record<LINK_TYPE, string> = {
  [LINK_TYPE.MANUFACTURER]: "Site do Fabricante",
  [LINK_TYPE.DOCUMENTATION]: "Documentação",
  [LINK_TYPE.TUTORIAL]: "Tutorial",
  [LINK_TYPE.SUPPLIER]: "Fornecedor",
  [LINK_TYPE.INTERNAL]: "Recurso Interno",
  [LINK_TYPE.OTHER]: "Outro",
};

// =====================
// Driver Management Labels
// =====================

export const DRIVER_STATUS_LABELS: Record<DRIVER_STATUS, string> = {
  [DRIVER_STATUS.ACTIVE]: "Ativo",
  [DRIVER_STATUS.INACTIVE]: "Inativo",
  [DRIVER_STATUS.SUSPENDED]: "Suspenso",
  [DRIVER_STATUS.LICENSE_EXPIRED]: "CNH Vencida",
};

export const CNH_CATEGORY_LABELS: Record<CNH_CATEGORY, string> = {
  [CNH_CATEGORY.A]: "Categoria A - Motocicleta",
  [CNH_CATEGORY.B]: "Categoria B - Carro",
  [CNH_CATEGORY.C]: "Categoria C - Caminhão",
  [CNH_CATEGORY.D]: "Categoria D - Micro-ônibus",
  [CNH_CATEGORY.E]: "Categoria E - Carreta",
  [CNH_CATEGORY.AB]: "Categoria AB - A + B",
  [CNH_CATEGORY.AC]: "Categoria AC - A + C",
  [CNH_CATEGORY.AD]: "Categoria AD - A + D",
  [CNH_CATEGORY.AE]: "Categoria AE - A + E",
};

export const LICENSE_TYPE_LABELS: Record<LICENSE_TYPE, string> = {
  [LICENSE_TYPE.DEFINITIVE]: "Definitiva",
  [LICENSE_TYPE.PROVISIONAL]: "Provisória",
  [LICENSE_TYPE.INTERNATIONAL]: "Internacional",
};

export const BLOOD_TYPE_LABELS: Record<BLOOD_TYPE, string> = {
  [BLOOD_TYPE.A_POSITIVE]: "A+",
  [BLOOD_TYPE.A_NEGATIVE]: "A-",
  [BLOOD_TYPE.B_POSITIVE]: "B+",
  [BLOOD_TYPE.B_NEGATIVE]: "B-",
  [BLOOD_TYPE.AB_POSITIVE]: "AB+",
  [BLOOD_TYPE.AB_NEGATIVE]: "AB-",
  [BLOOD_TYPE.O_POSITIVE]: "O+",
  [BLOOD_TYPE.O_NEGATIVE]: "O-",
};

// =====================
// Favorite Pages Labels
// =====================

export const FAVORITE_PAGES_LABELS: Record<FAVORITE_PAGES, string> = {
  // Production - List Pages
  [FAVORITE_PAGES.PRODUCAO_CRONOGRAMA_LISTAR]: "Cronograma de Produção",
  [FAVORITE_PAGES.PRODUCAO_RECORTE_LISTAR]: "Lista de Recortes",
  [FAVORITE_PAGES.PRODUCAO_SERVICOS_LISTAR]: "Lista de Serviços",
  [FAVORITE_PAGES.PRODUCAO_OBSERVACOES_LISTAR]: "Lista de Observações",
  [FAVORITE_PAGES.PRODUCAO_AEROGRAFIA_LISTAR]: "Lista de Aerografias",
  [FAVORITE_PAGES.PRODUCAO_GARAGENS_LISTAR]: "Lista de Garagens",
  [FAVORITE_PAGES.PRODUCAO_ORDENS_SERVICO_LISTAR]: "Lista de Ordens de Serviço",
  [FAVORITE_PAGES.PRODUCAO_HISTORICO_LISTAR]: "Histórico de Produção",

  // Production - Create Pages
  [FAVORITE_PAGES.PRODUCAO_CRONOGRAMA_CADASTRAR]: "Cadastrar Tarefa",
  [FAVORITE_PAGES.PRODUCAO_RECORTE_CADASTRAR]: "Cadastrar Recorte",
  [FAVORITE_PAGES.PRODUCAO_SERVICOS_CADASTRAR]: "Cadastrar Serviço",
  [FAVORITE_PAGES.PRODUCAO_OBSERVACOES_CADASTRAR]: "Cadastrar Observação",
  [FAVORITE_PAGES.PRODUCAO_AEROGRAFIA_CADASTRAR]: "Cadastrar Aerografia",
  [FAVORITE_PAGES.PRODUCAO_GARAGENS_CADASTRAR]: "Cadastrar Garagem",
  [FAVORITE_PAGES.PRODUCAO_ORDENS_SERVICO_CADASTRAR]: "Cadastrar Ordem de Serviço",

  // Inventory - List Pages
  [FAVORITE_PAGES.ESTOQUE_MOVIMENTACOES_LISTAR]: "Movimentações de Estoque",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_LISTAR]: "Lista de Produtos",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_CATEGORIAS_LISTAR]: "Lista de Categorias",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_MARCAS_LISTAR]: "Lista de Marcas",
  [FAVORITE_PAGES.ESTOQUE_PEDIDOS_LISTAR]: "Lista de Pedidos",
  [FAVORITE_PAGES.ESTOQUE_PEDIDOS_AGENDAMENTOS_LISTAR]: "Agendamentos de Pedidos",
  [FAVORITE_PAGES.ESTOQUE_PEDIDOS_AUTOMATICOS_LISTAR]: "Pedidos Automáticos",
  [FAVORITE_PAGES.ESTOQUE_MANUTENCAO_LISTAR]: "Lista de Manutenções",
  [FAVORITE_PAGES.ESTOQUE_MANUTENCAO_AGENDAMENTOS_LISTAR]: "Agendamentos de Manutenção",
  [FAVORITE_PAGES.ESTOQUE_RETIRADAS_EXTERNAS_LISTAR]: "Lista de Retiradas Externas",
  [FAVORITE_PAGES.ESTOQUE_FORNECEDORES_LISTAR]: "Lista de Fornecedores",
  [FAVORITE_PAGES.ESTOQUE_EPI_LISTAR]: "Lista de EPIs",
  [FAVORITE_PAGES.ESTOQUE_EPI_ENTREGAS_LISTAR]: "Entregas de EPIs",
  [FAVORITE_PAGES.ESTOQUE_EPI_AGENDAMENTOS_LISTAR]: "Agendamentos de EPIs",
  [FAVORITE_PAGES.ESTOQUE_EMPRESTIMOS_LISTAR]: "Lista de Empréstimos",
  // Statistics Pages
  [FAVORITE_PAGES.ESTATISTICAS]: "Estatísticas",
  [FAVORITE_PAGES.ESTATISTICAS_ESTOQUE]: "Estatísticas do Estoque",
  [FAVORITE_PAGES.ESTATISTICAS_ESTOQUE_CONSUMO]: "Análise de Consumo",
  [FAVORITE_PAGES.ESTATISTICAS_ESTOQUE_MOVIMENTACAO]: "Movimentação de Estoque",
  [FAVORITE_PAGES.ESTATISTICAS_ESTOQUE_TENDENCIAS]: "Análise de Tendências",
  [FAVORITE_PAGES.ESTATISTICAS_ESTOQUE_TOP_ITENS]: "Top Itens - Estatísticas",

  // Inventory - Create Pages
  [FAVORITE_PAGES.ESTOQUE_MOVIMENTACOES_CADASTRAR]: "Cadastrar Movimentação",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_CADASTRAR]: "Cadastrar Produto",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_CATEGORIAS_CADASTRAR]: "Cadastrar Categoria",
  [FAVORITE_PAGES.ESTOQUE_PRODUTOS_MARCAS_CADASTRAR]: "Cadastrar Marca",
  [FAVORITE_PAGES.ESTOQUE_PEDIDOS_CADASTRAR]: "Cadastrar Pedido",
  [FAVORITE_PAGES.ESTOQUE_PEDIDOS_AGENDAMENTOS_CADASTRAR]: "Cadastrar Agendamento de Pedido",
  [FAVORITE_PAGES.ESTOQUE_MANUTENCAO_CADASTRAR]: "Cadastrar Manutenção",
  [FAVORITE_PAGES.ESTOQUE_MANUTENCAO_AGENDAMENTOS_CADASTRAR]: "Cadastrar Agendamento de Manutenção",
  [FAVORITE_PAGES.ESTOQUE_RETIRADAS_EXTERNAS_CADASTRAR]: "Cadastrar Retirada Externa",
  [FAVORITE_PAGES.ESTOQUE_FORNECEDORES_CADASTRAR]: "Cadastrar Fornecedor",
  [FAVORITE_PAGES.ESTOQUE_EPI_CADASTRAR]: "Cadastrar EPI",
  [FAVORITE_PAGES.ESTOQUE_EPI_ENTREGAS_CADASTRAR]: "Cadastrar Entrega de EPI",
  [FAVORITE_PAGES.ESTOQUE_EPI_AGENDAMENTOS_CADASTRAR]: "Cadastrar Agendamento de EPI",
  [FAVORITE_PAGES.ESTOQUE_EMPRESTIMOS_CADASTRAR]: "Cadastrar Empréstimo",

  // Painting - List Pages
  [FAVORITE_PAGES.PINTURA_CATALOGO_LISTAR]: "Catálogo de Tintas",
  [FAVORITE_PAGES.PINTURA_PRODUCOES_LISTAR]: "Lista de Produções",
  [FAVORITE_PAGES.PINTURA_TIPOS_TINTA_LISTAR]: "Lista de Tipos de Tinta",
  [FAVORITE_PAGES.PINTURA_FORMULAS_LISTAR]: "Lista de Fórmulas",
  [FAVORITE_PAGES.PINTURA_FORMULACOES_LISTAR]: "Lista de Formulações",
  [FAVORITE_PAGES.PINTURA_COMPONENTES_LISTAR]: "Lista de Componentes",

  // Painting - Create Pages
  [FAVORITE_PAGES.PINTURA_CATALOGO_CADASTRAR]: "Cadastrar Tinta",
  [FAVORITE_PAGES.PINTURA_PRODUCOES_CADASTRAR]: "Cadastrar Produção",
  [FAVORITE_PAGES.PINTURA_TIPOS_TINTA_CADASTRAR]: "Cadastrar Tipo de Tinta",
  [FAVORITE_PAGES.PINTURA_FORMULAS_CADASTRAR]: "Cadastrar Fórmula",
  [FAVORITE_PAGES.PINTURA_FORMULACOES_CADASTRAR]: "Cadastrar Formulação",
  [FAVORITE_PAGES.PINTURA_COMPONENTES_CADASTRAR]: "Cadastrar Componente",

  // Administration - List Pages
  [FAVORITE_PAGES.ADMINISTRACAO_COMISSOES_LISTAR]: "Lista de Comissões",
  [FAVORITE_PAGES.ADMINISTRACAO_CLIENTES_LISTAR]: "Lista de Clientes",
  [FAVORITE_PAGES.ADMINISTRACAO_COLABORADORES_LISTAR]: "Lista de Colaboradores",
  [FAVORITE_PAGES.ADMINISTRACAO_ORCAMENTOS_LISTAR]: "Lista de Orçamentos",
  [FAVORITE_PAGES.ADMINISTRACAO_REGISTROS_ALTERACOES_LISTAR]: "Registros de Alterações",
  [FAVORITE_PAGES.ADMINISTRACAO_ARQUIVOS_LISTAR]: "Lista de Arquivos",
  [FAVORITE_PAGES.ADMINISTRACAO_SETORES_LISTAR]: "Lista de Setores",
  [FAVORITE_PAGES.ADMINISTRACAO_NOTIFICACOES_LISTAR]: "Lista de Notificações",
  [FAVORITE_PAGES.ADMINISTRACAO_FOLHA_DE_PAGAMENTO]: "Folha de Pagamento",

  // Administration - Create Pages
  [FAVORITE_PAGES.ADMINISTRACAO_CLIENTES_CADASTRAR]: "Cadastrar Cliente",
  [FAVORITE_PAGES.ADMINISTRACAO_COLABORADORES_CADASTRAR]: "Cadastrar Colaborador",
  [FAVORITE_PAGES.ADMINISTRACAO_ORCAMENTOS_CADASTRAR]: "Cadastrar Orçamento",
  [FAVORITE_PAGES.ADMINISTRACAO_ARQUIVOS_CADASTRAR]: "Upload de Arquivo",
  [FAVORITE_PAGES.ADMINISTRACAO_SETORES_CADASTRAR]: "Cadastrar Setor",
  [FAVORITE_PAGES.ADMINISTRACAO_NOTIFICACOES_CADASTRAR]: "Enviar Notificação",
  [FAVORITE_PAGES.ADMINISTRACAO_NOTIFICACOES_EDITAR]: "Editar Notificação",

  // Human Resources - List Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_LISTAR]: "Lista de Cargos",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_LISTAR]: "Lista de Férias",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_LISTAR]: "Lista de Feriados",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_AVISOS_LISTAR]: "Lista de Avisos",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CALCULOS]: "Cálculos de Ponto",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_LISTAR]: "Lista de EPIs (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_ENTREGAS_LISTAR]: "Entregas de EPIs (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_AGENDAMENTOS_LISTAR]: "Agendamentos de EPIs (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_TAMANHOS_LISTAR]: "Tamanhos de EPIs",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_SETORES_LISTAR]: "Lista de Setores (RH)",

  // Human Resources - Create Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_CADASTRAR]: "Cadastrar Cargo",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_CADASTRAR]: "Cadastrar Férias",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_CADASTRAR]: "Cadastrar Feriado",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_AVISOS_CADASTRAR]: "Cadastrar Aviso",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_CADASTRAR]: "Cadastrar EPI (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_ENTREGAS_CADASTRAR]: "Cadastrar Entrega de EPI (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_AGENDAMENTOS_CADASTRAR]: "Cadastrar Agendamento de EPI (RH)",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_EPI_TAMANHOS_CADASTRAR]: "Cadastrar Tamanho de EPI",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_SETORES_CADASTRAR]: "Cadastrar Setor (RH)",

  // Personal - List Pages
  [FAVORITE_PAGES.PESSOAL_MINHAS_COMISSOES_LISTAR]: "Minhas Comissões",
  [FAVORITE_PAGES.PESSOAL_MINHAS_FERIAS_LISTAR]: "Minhas Férias",
  [FAVORITE_PAGES.PESSOAL_MEUS_FERIADOS_LISTAR]: "Meus Feriados",
  [FAVORITE_PAGES.PESSOAL_MEUS_EMPRESTIMOS_LISTAR]: "Meus Empréstimos",
  [FAVORITE_PAGES.PESSOAL_MEUS_EPIS_LISTAR]: "Meus EPIs",
  [FAVORITE_PAGES.PESSOAL_MEUS_AVISOS_LISTAR]: "Meus Avisos",
  [FAVORITE_PAGES.PESSOAL_MINHAS_NOTIFICACOES_LISTAR]: "Minhas Notificações",

  // Catalog Basic - List Pages
  [FAVORITE_PAGES.CATALOGO_BASICO_LISTAR]: "Catálogo Básico",

  // Server - List Pages
  [FAVORITE_PAGES.SERVIDOR_USUARIOS]: "Usuários do Sistema",

  // Human Resources - Edit Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_EDITAR]: "Editar Cargo",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_EDITAR]: "Editar Férias",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_EDITAR]: "Editar Feriado",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_AVISOS_EDITAR]: "Editar Aviso",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_SETORES_EDITAR]: "Editar Setor",

  // Human Resources - Details Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_DETALHES]: "Detalhes do Cargo",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_DETALHES]: "Detalhes das Férias",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_DETALHES]: "Detalhes do Feriado",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_AVISOS_DETALHES]: "Detalhes do Aviso",

  // Human Resources - Batch Edit Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_EDITAR_LOTE]: "Editar Cargos em Lote",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_EDITAR_LOTE]: "Editar Férias em Lote",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_EDITAR_LOTE]: "Editar Feriados em Lote",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_AVISOS_EDITAR_LOTE]: "Editar Avisos em Lote",

  // Human Resources - Calendar Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIAS_CALENDARIO]: "Calendário de Férias",
  [FAVORITE_PAGES.RECURSOS_HUMANOS_FERIADOS_CALENDARIO]: "Calendário de Feriados",

  // Human Resources - Additional Pages
  [FAVORITE_PAGES.RECURSOS_HUMANOS_CARGOS_REMUNERACOES]: "Remunerações do Cargo",

  // Administration - Edit Pages
  [FAVORITE_PAGES.ADMINISTRACAO_SETORES_EDITAR]: "Editar Setor",

  // Administration - Details Pages
  [FAVORITE_PAGES.ADMINISTRACAO_SETORES_DETALHES]: "Detalhes do Setor",

  // Administration - Batch Edit Pages
  [FAVORITE_PAGES.ADMINISTRACAO_SETORES_EDITAR_LOTE]: "Editar Setores em Lote",
};

export const LAYOUT_SIDE_LABELS: Record<LAYOUT_SIDE, string> = {
  [LAYOUT_SIDE.LEFT]: "Lateral Esquerda",
  [LAYOUT_SIDE.RIGHT]: "Lateral Direita",
  [LAYOUT_SIDE.BACK]: "Traseira",
};

// =====================
// Bonus & Payroll Labels
// =====================

export const BONUS_DISCOUNT_REASON_LABELS: Record<BONUS_DISCOUNT_REASON, string> = {
  [BONUS_DISCOUNT_REASON.ABSENCE]: "Ausência",
  [BONUS_DISCOUNT_REASON.LATE_DELIVERY]: "Entrega Atrasada",
  [BONUS_DISCOUNT_REASON.QUALITY_ISSUE]: "Problema de Qualidade",
  [BONUS_DISCOUNT_REASON.DISCIPLINARY]: "Disciplinar",
  [BONUS_DISCOUNT_REASON.OTHER]: "Outro",
};

export const BONUS_STATUS_LABELS: Record<BONUS_STATUS, string> = {
  [BONUS_STATUS.DRAFT]: "Rascunho",
  [BONUS_STATUS.CONFIRMED]: "Confirmado",
};

export const DISCOUNT_TYPE_LABELS: Record<DISCOUNT_TYPE, string> = {
  [DISCOUNT_TYPE.PERCENTAGE]: "Porcentagem",
  [DISCOUNT_TYPE.FIXED_VALUE]: "Valor Fixo",
};

export const PAYROLL_STATUS_LABELS: Record<PAYROLL_STATUS, string> = {
  [PAYROLL_STATUS.DRAFT]: "Rascunho",
  [PAYROLL_STATUS.FINALIZED]: "Finalizado",
};

export const PAYROLL_MONTH_LABELS: Record<PAYROLL_MONTH, string> = {
  [PAYROLL_MONTH.JANUARY]: "Janeiro",
  [PAYROLL_MONTH.FEBRUARY]: "Fevereiro",
  [PAYROLL_MONTH.MARCH]: "Março",
  [PAYROLL_MONTH.APRIL]: "Abril",
  [PAYROLL_MONTH.MAY]: "Maio",
  [PAYROLL_MONTH.JUNE]: "Junho",
  [PAYROLL_MONTH.JULY]: "Julho",
  [PAYROLL_MONTH.AUGUST]: "Agosto",
  [PAYROLL_MONTH.SEPTEMBER]: "Setembro",
  [PAYROLL_MONTH.OCTOBER]: "Outubro",
  [PAYROLL_MONTH.NOVEMBER]: "Novembro",
  [PAYROLL_MONTH.DECEMBER]: "Dezembro",
};

export const COMMISSION_STATUS_LABELS: Record<COMMISSION_STATUS, string> = {
  [COMMISSION_STATUS.NO_COMMISSION]: "Sem Comissão",
  [COMMISSION_STATUS.PARTIAL_COMMISSION]: "Comissão Parcial",
  [COMMISSION_STATUS.FULL_COMMISSION]: "Comissão Integral",
  [COMMISSION_STATUS.SUSPENDED_COMMISSION]: "Comissão Suspensa",
};

// =====================
// Statistics Labels
// =====================

export const STATISTICS_GROUP_BY_LABELS: Record<STATISTICS_GROUP_BY, string> = {
  [STATISTICS_GROUP_BY.SECTOR]: "Setor",
  [STATISTICS_GROUP_BY.USER]: "Usuário",
  [STATISTICS_GROUP_BY.CATEGORY]: "Categoria",
  [STATISTICS_GROUP_BY.BRAND]: "Marca",
  [STATISTICS_GROUP_BY.SUPPLIER]: "Fornecedor",
  [STATISTICS_GROUP_BY.ITEM]: "Item",
  [STATISTICS_GROUP_BY.DATE]: "Data",
  [STATISTICS_GROUP_BY.ACTIVITY_REASON]: "Motivo da Atividade",
  [STATISTICS_GROUP_BY.ACTIVITY_OPERATION]: "Operação da Atividade",
};

export const STATISTICS_METRIC_LABELS: Record<STATISTICS_METRIC, string> = {
  [STATISTICS_METRIC.QUANTITY]: "Quantidade",
  [STATISTICS_METRIC.TOTAL_PRICE]: "Preço Total",
  [STATISTICS_METRIC.UNIT_PRICE]: "Preço Unitário",
  [STATISTICS_METRIC.COUNT]: "Contagem",
  [STATISTICS_METRIC.FREQUENCY]: "Frequência",
  [STATISTICS_METRIC.PERCENTAGE]: "Percentual",
  [STATISTICS_METRIC.AVERAGE]: "Média",
  [STATISTICS_METRIC.SUM]: "Soma",
  [STATISTICS_METRIC.MIN]: "Mínimo",
  [STATISTICS_METRIC.MAX]: "Máximo",
};

export const STATISTICS_PERIOD_LABELS: Record<STATISTICS_PERIOD, string> = {
  [STATISTICS_PERIOD.DAILY]: "Diário",
  [STATISTICS_PERIOD.WEEKLY]: "Semanal",
  [STATISTICS_PERIOD.MONTHLY]: "Mensal",
  [STATISTICS_PERIOD.QUARTERLY]: "Trimestral",
  [STATISTICS_PERIOD.YEARLY]: "Anual",
  [STATISTICS_PERIOD.CUSTOM]: "Personalizado",
  [STATISTICS_PERIOD.LAST_7_DAYS]: "Últimos 7 Dias",
  [STATISTICS_PERIOD.LAST_30_DAYS]: "Últimos 30 Dias",
  [STATISTICS_PERIOD.LAST_90_DAYS]: "Últimos 90 Dias",
  [STATISTICS_PERIOD.LAST_YEAR]: "Último Ano",
  [STATISTICS_PERIOD.THIS_WEEK]: "Esta Semana",
  [STATISTICS_PERIOD.THIS_MONTH]: "Este Mês",
  [STATISTICS_PERIOD.THIS_QUARTER]: "Este Trimestre",
  [STATISTICS_PERIOD.THIS_YEAR]: "Este Ano",
};
