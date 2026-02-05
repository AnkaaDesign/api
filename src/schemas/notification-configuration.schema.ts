// packages/schemas/src/notification-configuration.schema.ts

import { z } from 'zod';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_IMPORTANCE,
  NOTIFICATION_TYPE,
  SECTOR_PRIVILEGES,
} from '@constants';

// =====================
// Channel Messages Schema
// =====================

/**
 * Email message template structure
 */
export const emailMessageSchema = z.object({
  subject: z.string().min(1, 'Assunto do email é obrigatório'),
  body: z.string().min(1, 'Corpo do email é obrigatório'),
});

/**
 * Channel messages schema - validates template structure for all notification channels
 */
export const channelMessagesSchema = z.object({
  inApp: z.string().min(1, 'Mensagem in-app é obrigatória'),
  push: z.string().min(1, 'Mensagem push é obrigatória'),
  email: emailMessageSchema,
  whatsapp: z.string().min(1, 'Mensagem WhatsApp é obrigatória'),
});

export type ChannelMessages = z.infer<typeof channelMessagesSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;

// =====================
// Notification Templates Schema
// =====================

/**
 * Notification templates schema - validates full templates object with different event variants
 * Each variant (updated, cleared, filesAdded, filesRemoved) contains channel-specific messages
 */
export const notificationTemplatesSchema = z.object({
  updated: channelMessagesSchema.optional(),
  cleared: channelMessagesSchema.optional(),
  filesAdded: channelMessagesSchema.optional(),
  filesRemoved: channelMessagesSchema.optional(),
});

export type NotificationTemplates = z.infer<typeof notificationTemplatesSchema>;

// =====================
// Channel Config Schema
// =====================

/**
 * Channel configuration schema - validates configuration for a single notification channel
 */
export const channelConfigSchema = z.object({
  channel: z.nativeEnum(NOTIFICATION_CHANNEL, {
    errorMap: () => ({ message: 'Canal de notificação inválido' }),
  }),
  enabled: z.boolean({
    required_error: 'Status de habilitação é obrigatório',
    invalid_type_error: 'Status de habilitação inválido',
  }),
  mandatory: z.boolean({
    required_error: 'Status de obrigatoriedade é obrigatório',
    invalid_type_error: 'Status de obrigatoriedade inválido',
  }),
  defaultOn: z.boolean({
    required_error: 'Status de ativação padrão é obrigatório',
    invalid_type_error: 'Status de ativação padrão inválido',
  }),
  minImportance: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .optional(),
});

export type ChannelConfig = z.infer<typeof channelConfigSchema>;

// =====================
// Sector Override Schema
// =====================

/**
 * Sector override schema - validates overrides for specific sectors
 * Allows customizing notification behavior per sector
 */
export const sectorOverrideSchema = z.object({
  sectorId: z.string().uuid({ message: 'ID do setor inválido' }),
  enabled: z.boolean().optional(),
  channels: z.array(channelConfigSchema).optional(),
  importance: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .optional(),
  templates: notificationTemplatesSchema.optional(),
});

export type SectorOverride = z.infer<typeof sectorOverrideSchema>;

// =====================
// Target Rule Schema
// =====================

/**
 * Target rule schema - validates rules for targeting notifications
 * Defines which sectors can receive a notification type
 */
export const targetRuleSchema = z.object({
  allowedSectors: z
    .array(z.string().uuid({ message: 'ID do setor inválido' }))
    .min(1, 'Deve incluir pelo menos um setor permitido'),
  allowedPrivileges: z
    .array(
      z.nativeEnum(SECTOR_PRIVILEGES, {
        errorMap: () => ({ message: 'Privilégio de setor inválido' }),
      }),
    )
    .optional(),
  excludedSectors: z.array(z.string().uuid({ message: 'ID do setor inválido' })).optional(),
  excludedPrivileges: z
    .array(
      z.nativeEnum(SECTOR_PRIVILEGES, {
        errorMap: () => ({ message: 'Privilégio de setor inválido' }),
      }),
    )
    .optional(),
});

export type TargetRule = z.infer<typeof targetRuleSchema>;

// =====================
// Create Notification Configuration Schema
// =====================

/**
 * Create notification configuration schema - full creation validation
 */
export const createNotificationConfigurationSchema = z.object({
  // Identification
  name: z
    .string({
      required_error: 'Nome da configuração é obrigatório',
      invalid_type_error: 'Nome da configuração inválido',
    })
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),

  description: z
    .string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .nullable()
    .optional(),

  // Notification type
  notificationType: z.nativeEnum(NOTIFICATION_TYPE, {
    errorMap: () => ({ message: 'Tipo de notificação inválido' }),
  }),

  // Global settings
  enabled: z.boolean().default(true),

  importance: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .default(NOTIFICATION_IMPORTANCE.NORMAL),

  // Channel configurations
  channels: z
    .array(channelConfigSchema)
    .min(1, 'Deve configurar pelo menos um canal de notificação'),

  // Templates
  templates: notificationTemplatesSchema.optional(),

  // Targeting rules
  targetRules: targetRuleSchema.optional(),

  // Sector-specific overrides
  sectorOverrides: z.array(sectorOverrideSchema).optional(),

  // Metadata
  metadata: z.record(z.any()).nullable().optional(),
});

export type CreateNotificationConfigurationFormData = z.infer<
  typeof createNotificationConfigurationSchema
>;

// =====================
// Update Notification Configuration Schema
// =====================

/**
 * Update notification configuration schema - partial update validation
 * All fields are optional for patch-style updates
 */
export const updateNotificationConfigurationSchema = z.object({
  // Identification
  name: z
    .string({
      invalid_type_error: 'Nome da configuração inválido',
    })
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres')
    .optional(),

  description: z
    .string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .nullable()
    .optional(),

  // Notification type - generally shouldn't change, but allowed
  notificationType: z
    .nativeEnum(NOTIFICATION_TYPE, {
      errorMap: () => ({ message: 'Tipo de notificação inválido' }),
    })
    .optional(),

  // Global settings
  enabled: z.boolean().optional(),

  importance: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .optional(),

  // Channel configurations
  channels: z
    .array(channelConfigSchema)
    .min(1, 'Deve configurar pelo menos um canal de notificação')
    .optional(),

  // Templates
  templates: notificationTemplatesSchema.optional(),

  // Targeting rules
  targetRules: targetRuleSchema.optional(),

  // Sector-specific overrides
  sectorOverrides: z.array(sectorOverrideSchema).optional(),

  // Metadata
  metadata: z.record(z.any()).nullable().optional(),
});

export type UpdateNotificationConfigurationFormData = z.infer<
  typeof updateNotificationConfigurationSchema
>;

// =====================
// Notification Context Schema
// =====================

/**
 * Notification context schema - validates context passed to dispatch
 * Contains all the dynamic data needed to render notification templates
 */
export const notificationContextSchema = z.object({
  // Target user information
  userId: z.string().uuid({ message: 'ID do usuário inválido' }).optional(),
  userIds: z.array(z.string().uuid({ message: 'ID do usuário inválido' })).optional(),

  // Sector information
  sectorId: z.string().uuid({ message: 'ID do setor inválido' }).optional(),
  sectorIds: z.array(z.string().uuid({ message: 'ID do setor inválido' })).optional(),

  // Related entity
  relatedEntityId: z.string().uuid({ message: 'ID da entidade inválido' }).optional(),
  relatedEntityType: z.string().optional(),

  // Template variables for interpolation
  templateVariables: z.record(z.any()).optional(),

  // Action information
  actionType: z.string().optional(),
  actionUrl: z.string().url({ message: 'URL de ação inválida' }).optional(),

  // Override settings for this dispatch
  importanceOverride: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .optional(),
  channelOverride: z
    .array(
      z.nativeEnum(NOTIFICATION_CHANNEL, {
        errorMap: () => ({ message: 'Canal de notificação inválido' }),
      }),
    )
    .optional(),

  // Force send even if user has disabled
  forceSend: z.boolean().optional(),

  // Scheduling
  scheduledAt: z.coerce.date().optional(),

  // Additional metadata
  metadata: z.record(z.any()).optional(),
});

export type NotificationContext = z.infer<typeof notificationContextSchema>;

// =====================
// Query Schemas
// =====================

/**
 * Get notification configuration by ID schema
 */
export const notificationConfigurationGetByIdSchema = z.object({
  id: z.string().uuid({ message: 'ID da configuração inválido' }),
});

export type NotificationConfigurationGetByIdFormData = z.infer<
  typeof notificationConfigurationGetByIdSchema
>;

/**
 * Get many notification configurations schema with filters
 */
export const notificationConfigurationGetManySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(0).default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional(),

  // Filters
  searchingFor: z.string().optional(),
  enabled: z.boolean().optional(),
  notificationType: z
    .nativeEnum(NOTIFICATION_TYPE, {
      errorMap: () => ({ message: 'Tipo de notificação inválido' }),
    })
    .optional(),
  notificationTypes: z
    .array(
      z.nativeEnum(NOTIFICATION_TYPE, {
        errorMap: () => ({ message: 'Tipo de notificação inválido' }),
      }),
    )
    .optional(),
  importance: z
    .nativeEnum(NOTIFICATION_IMPORTANCE, {
      errorMap: () => ({ message: 'Nível de importância inválido' }),
    })
    .optional(),
  importanceLevels: z
    .array(
      z.nativeEnum(NOTIFICATION_IMPORTANCE, {
        errorMap: () => ({ message: 'Nível de importância inválido' }),
      }),
    )
    .optional(),
  hasChannel: z
    .nativeEnum(NOTIFICATION_CHANNEL, {
      errorMap: () => ({ message: 'Canal de notificação inválido' }),
    })
    .optional(),
});

export type NotificationConfigurationGetManyFormData = z.infer<
  typeof notificationConfigurationGetManySchema
>;

// =====================
// Batch Operations Schemas
// =====================

/**
 * Batch create notification configurations schema
 */
export const notificationConfigurationBatchCreateSchema = z.object({
  configurations: z
    .array(createNotificationConfigurationSchema)
    .min(1, 'Deve incluir pelo menos uma configuração')
    .max(100, 'Limite máximo de 100 configurações por vez'),
});

export type NotificationConfigurationBatchCreateFormData = z.infer<
  typeof notificationConfigurationBatchCreateSchema
>;

/**
 * Batch update notification configurations schema
 */
export const notificationConfigurationBatchUpdateSchema = z.object({
  configurations: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'ID da configuração inválido' }),
        data: updateNotificationConfigurationSchema,
      }),
    )
    .min(1, 'Deve incluir pelo menos uma configuração')
    .max(100, 'Limite máximo de 100 configurações por vez'),
});

export type NotificationConfigurationBatchUpdateFormData = z.infer<
  typeof notificationConfigurationBatchUpdateSchema
>;

/**
 * Batch delete notification configurations schema
 */
export const notificationConfigurationBatchDeleteSchema = z.object({
  configurationIds: z
    .array(z.string().uuid({ message: 'ID da configuração inválido' }))
    .min(1, 'Deve incluir pelo menos um ID')
    .max(100, 'Limite máximo de 100 configurações por vez'),
  reason: z.string().optional(),
});

export type NotificationConfigurationBatchDeleteFormData = z.infer<
  typeof notificationConfigurationBatchDeleteSchema
>;

// =====================
// Dispatch Schema
// =====================

/**
 * Dispatch notification schema - used when sending a notification
 */
export const dispatchNotificationSchema = z.object({
  configurationId: z.string().uuid({ message: 'ID da configuração inválido' }),
  context: notificationContextSchema,
});

export type DispatchNotificationFormData = z.infer<typeof dispatchNotificationSchema>;
