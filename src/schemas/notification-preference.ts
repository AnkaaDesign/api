// packages/schemas/src/notification-preference.ts

import { z } from "zod";
import {
  createMapToFormDataHelper,
  orderByDirectionSchema, normalizeOrderBy,
  createStringWhereSchema,
  createDateWhereSchema,
  createBooleanWhereSchema,
  mergeAndConditions,
  createBatchCreateSchema,
  createBatchUpdateSchema,
  createBatchQuerySchema,
} from "./common";
import { NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '@constants';
import type { NotificationPreference } from '@types';

// =====================
// Include Schema
// =====================

export const notificationPreferenceIncludeSchema = z
  .object({
    preferences: z.boolean().optional(),
    _count: z.union([z.boolean(), z.object({ select: z.record(z.boolean()).optional() })]).optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const notificationPreferenceOrderBySchema = z
  .union([
    z
      .object({
        id: orderByDirectionSchema.optional(),
        notificationType: orderByDirectionSchema.optional(),
        enabled: orderByDirectionSchema.optional(),
        importance: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      })
      .partial(),
    z.array(
      z
        .object({
          id: orderByDirectionSchema.optional(),
          notificationType: orderByDirectionSchema.optional(),
          enabled: orderByDirectionSchema.optional(),
          importance: orderByDirectionSchema.optional(),
          createdAt: orderByDirectionSchema.optional(),
          updatedAt: orderByDirectionSchema.optional(),
        })
        .partial(),
    ),
  ])
  .optional();

// =====================
// Where Schema
// =====================

export const notificationPreferenceWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      // Boolean operators
      AND: z.union([notificationPreferenceWhereSchema, z.array(notificationPreferenceWhereSchema)]).optional(),
      OR: z.array(notificationPreferenceWhereSchema).optional(),
      NOT: z.union([notificationPreferenceWhereSchema, z.array(notificationPreferenceWhereSchema)]).optional(),

      // Fields
      id: createStringWhereSchema().optional(),
      notificationType: createStringWhereSchema().optional(),
      enabled: createBooleanWhereSchema().optional(),
      importance: z
        .union([
          z.nativeEnum(NOTIFICATION_IMPORTANCE),
          z.object({
            equals: z.nativeEnum(NOTIFICATION_IMPORTANCE).optional(),
            not: z.nativeEnum(NOTIFICATION_IMPORTANCE).optional(),
            in: z.array(z.nativeEnum(NOTIFICATION_IMPORTANCE)).optional(),
            notIn: z.array(z.nativeEnum(NOTIFICATION_IMPORTANCE)).optional(),
          }),
        ])
        .optional(),
      channels: z
        .object({
          has: z.nativeEnum(NOTIFICATION_CHANNEL).optional(),
          hasEvery: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).optional(),
          hasSome: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).optional(),
          isEmpty: z.boolean().optional(),
        })
        .optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),

      // Relations
      preferences: z
        .object({
          some: z.any().optional(),
          every: z.any().optional(),
          none: z.any().optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Convenience Filters
// =====================

const notificationPreferenceFilters = {
  // Boolean filters
  enabled: z.boolean().optional(),
  hasPreferences: z.boolean().optional(),

  // Array filters
  notificationPreferenceIds: z.array(z.string()).optional(),
  notificationTypes: z.array(z.string()).optional(),
  importanceLevels: z.array(z.nativeEnum(NOTIFICATION_IMPORTANCE)).optional(),
  channelList: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).optional(),

  // Date filters
  createdAt: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
  updatedAt: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

// =====================
// Transform Functions
// =====================

const notificationPreferenceTransform = (data: any) => {
  // Normalize orderBy to Prisma format
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  // Handle take/limit alias
  if (data.take && !data.limit) {
    data.limit = data.take;
  }
  delete data.take;

  const andConditions: any[] = [];

  // Boolean filters
  if (typeof data.enabled === "boolean") {
    andConditions.push({ enabled: data.enabled });
    delete data.enabled;
  }

  if (data.hasPreferences === true) {
    andConditions.push({ preferences: { some: {} } });
    delete data.hasPreferences;
  } else if (data.hasPreferences === false) {
    andConditions.push({ preferences: { none: {} } });
    delete data.hasPreferences;
  }

  // Array filters
  if (data.notificationPreferenceIds && Array.isArray(data.notificationPreferenceIds) && data.notificationPreferenceIds.length > 0) {
    andConditions.push({ id: { in: data.notificationPreferenceIds } });
    delete data.notificationPreferenceIds;
  }

  if (data.notificationTypes && Array.isArray(data.notificationTypes) && data.notificationTypes.length > 0) {
    andConditions.push({ notificationType: { in: data.notificationTypes } });
    delete data.notificationTypes;
  }

  if (data.importanceLevels && Array.isArray(data.importanceLevels) && data.importanceLevels.length > 0) {
    andConditions.push({ importance: { in: data.importanceLevels } });
    delete data.importanceLevels;
  }

  if (data.channelList && Array.isArray(data.channelList) && data.channelList.length > 0) {
    andConditions.push({ channels: { hasSome: data.channelList } });
    delete data.channelList;
  }

  // Date filters
  if (data.createdAt) {
    andConditions.push({ createdAt: data.createdAt });
    delete data.createdAt;
  }

  if (data.updatedAt) {
    andConditions.push({ updatedAt: data.updatedAt });
    delete data.updatedAt;
  }

  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================

export const notificationPreferenceGetManySchema = z
  .object({
    // Pagination
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),

    // Direct Prisma clauses
    where: notificationPreferenceWhereSchema.optional(),
    orderBy: notificationPreferenceOrderBySchema.optional(),
    include: notificationPreferenceIncludeSchema.optional(),

    // Convenience filters
    ...notificationPreferenceFilters,
  })
  .transform(notificationPreferenceTransform);

export const notificationPreferenceGetByIdSchema = z.object({
  include: notificationPreferenceIncludeSchema.optional(),
  id: z.string().uuid({ message: "Preferência de notificação inválida" }),
});

// =====================
// CRUD Schemas
// =====================

const toFormData = <T>(data: T) => data;

export const notificationPreferenceCreateSchema = z
  .object({
    notificationType: z.string().min(1, "Tipo de notificação é obrigatório"),
    enabled: z.boolean(),
    channels: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).min(1, "Deve incluir pelo menos um canal"),
    importance: z.nativeEnum(NOTIFICATION_IMPORTANCE),
  })
  .transform(toFormData);

export const notificationPreferenceUpdateSchema = z
  .object({
    notificationType: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    channels: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).min(1, "Deve incluir pelo menos um canal").optional(),
    importance: z.nativeEnum(NOTIFICATION_IMPORTANCE).optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations
// =====================

export const notificationPreferenceBatchCreateSchema = createBatchCreateSchema(notificationPreferenceCreateSchema, "preferência de notificação");
export const notificationPreferenceBatchUpdateSchema = createBatchUpdateSchema(notificationPreferenceUpdateSchema, "preferência de notificação");
// Custom batch delete schema with normalized property name
export const notificationPreferenceBatchDeleteSchema = z.object({
  notificationPreferenceIds: z
    .array(z.string().uuid({ message: "Preferência de notificação inválida" }))
    .min(1, "Deve incluir pelo menos uma preferência de notificação")
    .max(100, "Limite máximo de 100 preferências de notificação por vez"),
  reason: z.string().optional(),
});
export const notificationPreferenceQuerySchema = createBatchQuerySchema(notificationPreferenceIncludeSchema);

// =====================
// Type Inference
// =====================

// Query types
export type NotificationPreferenceGetManyFormData = z.infer<typeof notificationPreferenceGetManySchema>;
export type NotificationPreferenceGetByIdFormData = z.infer<typeof notificationPreferenceGetByIdSchema>;
export type NotificationPreferenceQueryFormData = z.infer<typeof notificationPreferenceQuerySchema>;

// CRUD types
export type NotificationPreferenceCreateFormData = z.infer<typeof notificationPreferenceCreateSchema>;
export type NotificationPreferenceUpdateFormData = z.infer<typeof notificationPreferenceUpdateSchema>;

// Batch types
export type NotificationPreferenceBatchCreateFormData = z.infer<typeof notificationPreferenceBatchCreateSchema>;
export type NotificationPreferenceBatchUpdateFormData = z.infer<typeof notificationPreferenceBatchUpdateSchema>;
export type NotificationPreferenceBatchDeleteFormData = z.infer<typeof notificationPreferenceBatchDeleteSchema>;

// Include/OrderBy/Where types
export type NotificationPreferenceInclude = z.infer<typeof notificationPreferenceIncludeSchema>;
export type NotificationPreferenceOrderBy = z.infer<typeof notificationPreferenceOrderBySchema>;
export type NotificationPreferenceWhere = z.infer<typeof notificationPreferenceWhereSchema>;

// =====================
// Helper Functions
// =====================

export const mapNotificationPreferenceToFormData = createMapToFormDataHelper<NotificationPreference, NotificationPreferenceUpdateFormData>((preference) => ({
  notificationType: preference.notificationType,
  enabled: preference.enabled,
  channels: preference.channels,
  importance: preference.importance,
}));
