// packages/schemas/src/notification.ts

import { z } from 'zod';
import { NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_IMPORTANCE } from '@constants';
import { nullableDate, orderByDirectionSchema, normalizeOrderBy } from './common';

// =====================
// Include Schemas
// =====================

export const notificationIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
        }),
      ])
      .optional(),
    seenBy: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

export const seenNotificationIncludeSchema = z
  .object({
    user: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
        }),
      ])
      .optional(),
    notification: z
      .union([
        z.boolean(),
        z.object({
          include: z.any().optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schemas
// =====================

export const notificationOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      title: orderByDirectionSchema.optional(),
      body: orderByDirectionSchema.optional(),
      type: orderByDirectionSchema.optional(),
      importance: orderByDirectionSchema.optional(),
      actionType: orderByDirectionSchema.optional(),
      actionUrl: orderByDirectionSchema.optional(),
      scheduledAt: orderByDirectionSchema.optional(),
      sentAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        title: orderByDirectionSchema.optional(),
        body: orderByDirectionSchema.optional(),
        type: orderByDirectionSchema.optional(),
        importance: orderByDirectionSchema.optional(),
        actionType: orderByDirectionSchema.optional(),
        actionUrl: orderByDirectionSchema.optional(),
        scheduledAt: orderByDirectionSchema.optional(),
        sentAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

export const seenNotificationOrderBySchema = z
  .union([
    z.object({
      id: orderByDirectionSchema.optional(),
      seenAt: orderByDirectionSchema.optional(),
      createdAt: orderByDirectionSchema.optional(),
      updatedAt: orderByDirectionSchema.optional(),
    }),
    z.array(
      z.object({
        id: orderByDirectionSchema.optional(),
        seenAt: orderByDirectionSchema.optional(),
        createdAt: orderByDirectionSchema.optional(),
        updatedAt: orderByDirectionSchema.optional(),
      }),
    ),
  ])
  .optional();

// =====================
// Where Schemas
// =====================

export const notificationWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => notificationWhereSchema)).optional(),
    OR: z.array(z.lazy(() => notificationWhereSchema)).optional(),
    NOT: z.lazy(() => notificationWhereSchema).optional(),

    id: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    userId: z
      .union([
        z.string(),
        z.null(),
        z.object({
          equals: z.union([z.string(), z.null()]).optional(),
          not: z.union([z.string(), z.null()]).optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    title: z
      .union([
        z.string(),
        z.object({
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
        }),
      ])
      .optional(),

    body: z
      .union([
        z.string(),
        z.object({
          contains: z.string().optional(),
          startsWith: z.string().optional(),
          endsWith: z.string().optional(),
        }),
      ])
      .optional(),

    type: z
      .union([
        z.nativeEnum(NOTIFICATION_TYPE),
        z.object({
          equals: z.nativeEnum(NOTIFICATION_TYPE).optional(),
          not: z.nativeEnum(NOTIFICATION_TYPE).optional(),
          in: z.array(z.nativeEnum(NOTIFICATION_TYPE)).optional(),
          notIn: z.array(z.nativeEnum(NOTIFICATION_TYPE)).optional(),
        }),
      ])
      .optional(),

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

    scheduledAt: z
      .union([
        z.date(),
        z.null(),
        z.object({
          equals: z.union([z.date(), z.null()]).optional(),
          not: z.union([z.date(), z.null()]).optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    sentAt: z
      .union([
        z.date(),
        z.null(),
        z.object({
          equals: z.union([z.date(), z.null()]).optional(),
          not: z.union([z.date(), z.null()]).optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    createdAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    updatedAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    user: z.lazy(() => z.any()).optional(),
    seenBy: z.lazy(() => z.any()).optional(),
  })
  .partial();

export const seenNotificationWhereSchema: z.ZodType<any> = z
  .object({
    AND: z.array(z.lazy(() => seenNotificationWhereSchema)).optional(),
    OR: z.array(z.lazy(() => seenNotificationWhereSchema)).optional(),
    NOT: z.lazy(() => seenNotificationWhereSchema).optional(),

    id: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    userId: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    notificationId: z
      .union([
        z.string(),
        z.object({
          equals: z.string().optional(),
          not: z.string().optional(),
          in: z.array(z.string()).optional(),
          notIn: z.array(z.string()).optional(),
        }),
      ])
      .optional(),

    seenAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    createdAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    updatedAt: z
      .union([
        z.date(),
        z.object({
          equals: z.date().optional(),
          not: z.date().optional(),
          lt: z.coerce.date().optional(),
          lte: z.coerce.date().optional(),
          gt: z.coerce.date().optional(),
          gte: z.coerce.date().optional(),
        }),
      ])
      .optional(),

    user: z.lazy(() => z.any()).optional(),
    notification: z.lazy(() => z.any()).optional(),
  })
  .partial();

// =====================
// Convenience Filters
// =====================

const notificationFilters = {
  searchingFor: z.string().optional(),
  types: z.array(z.nativeEnum(NOTIFICATION_TYPE)).optional(),
  channels: z.array(z.nativeEnum(NOTIFICATION_CHANNEL)).optional(),
  importance: z.array(z.nativeEnum(NOTIFICATION_IMPORTANCE)).optional(),
  userIds: z.array(z.string()).optional(),
  unread: z.boolean().optional(),
  scheduledAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
  sentAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

const seenNotificationFilters = {
  userIds: z.array(z.string()).optional(),
  notificationIds: z.array(z.string()).optional(),
  seenAtRange: z
    .object({
      gte: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
    })
    .optional(),
};

// =====================
// Transform Functions
// =====================

const notificationTransform = (data: any) => {
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

  if (data.searchingFor) {
    andConditions.push({
      OR: [
        { title: { contains: data.searchingFor, mode: 'insensitive' } },
        { body: { contains: data.searchingFor, mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }

  if (data.types?.length) {
    andConditions.push({ type: { in: data.types } });
    delete data.types;
  }

  if (data.importance?.length) {
    andConditions.push({ importance: { in: data.importance } });
    delete data.importance;
  }

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.channels?.length) {
    andConditions.push({
      channel: {
        hasSome: data.channels,
      },
    });
    delete data.channels;
  }

  if (data.unread !== undefined) {
    if (data.unread) {
      andConditions.push({ seenBy: { none: {} } });
    } else {
      andConditions.push({ seenBy: { some: {} } });
    }
    delete data.unread;
  }

  if (data.scheduledAtRange) {
    const scheduledAtCondition: any = {};
    if (data.scheduledAtRange.gte) {
      const fromDate =
        data.scheduledAtRange.gte instanceof Date
          ? data.scheduledAtRange.gte
          : new Date(data.scheduledAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      scheduledAtCondition.gte = fromDate;
    }
    if (data.scheduledAtRange.lte) {
      const toDate =
        data.scheduledAtRange.lte instanceof Date
          ? data.scheduledAtRange.lte
          : new Date(data.scheduledAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      scheduledAtCondition.lte = toDate;
    }
    if (Object.keys(scheduledAtCondition).length > 0) {
      andConditions.push({ scheduledAt: scheduledAtCondition });
    }
    delete data.scheduledAtRange;
  }

  if (data.sentAtRange) {
    const sentAtCondition: any = {};
    if (data.sentAtRange.gte) {
      const fromDate =
        data.sentAtRange.gte instanceof Date
          ? data.sentAtRange.gte
          : new Date(data.sentAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      sentAtCondition.gte = fromDate;
    }
    if (data.sentAtRange.lte) {
      const toDate =
        data.sentAtRange.lte instanceof Date
          ? data.sentAtRange.lte
          : new Date(data.sentAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      sentAtCondition.lte = toDate;
    }
    if (Object.keys(sentAtCondition).length > 0) {
      andConditions.push({ sentAt: sentAtCondition });
    }
    delete data.sentAtRange;
  }

  if (data.createdAt) {
    const createdAtCondition: any = {};
    if (data.createdAt.gte) {
      const fromDate =
        data.createdAt.gte instanceof Date ? data.createdAt.gte : new Date(data.createdAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      createdAtCondition.gte = fromDate;
    }
    if (data.createdAt.lte) {
      const toDate =
        data.createdAt.lte instanceof Date ? data.createdAt.lte : new Date(data.createdAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      createdAtCondition.lte = toDate;
    }
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.createdAt;
  }

  if (data.updatedAt) {
    const updatedAtCondition: any = {};
    if (data.updatedAt.gte) {
      const fromDate =
        data.updatedAt.gte instanceof Date ? data.updatedAt.gte : new Date(data.updatedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      updatedAtCondition.gte = fromDate;
    }
    if (data.updatedAt.lte) {
      const toDate =
        data.updatedAt.lte instanceof Date ? data.updatedAt.lte : new Date(data.updatedAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      updatedAtCondition.lte = toDate;
    }
    if (Object.keys(updatedAtCondition).length > 0) {
      andConditions.push({ updatedAt: updatedAtCondition });
    }
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND
        ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

const seenNotificationTransform = (data: any) => {
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

  if (data.userIds?.length) {
    andConditions.push({ userId: { in: data.userIds } });
    delete data.userIds;
  }

  if (data.notificationIds?.length) {
    andConditions.push({ notificationId: { in: data.notificationIds } });
    delete data.notificationIds;
  }

  if (data.seenAtRange) {
    const seenAtCondition: any = {};
    if (data.seenAtRange.gte) {
      const fromDate =
        data.seenAtRange.gte instanceof Date
          ? data.seenAtRange.gte
          : new Date(data.seenAtRange.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      seenAtCondition.gte = fromDate;
    }
    if (data.seenAtRange.lte) {
      const toDate =
        data.seenAtRange.lte instanceof Date
          ? data.seenAtRange.lte
          : new Date(data.seenAtRange.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      seenAtCondition.lte = toDate;
    }
    if (Object.keys(seenAtCondition).length > 0) {
      andConditions.push({ seenAt: seenAtCondition });
    }
    delete data.seenAtRange;
  }

  if (data.createdAt) {
    const createdAtCondition: any = {};
    if (data.createdAt.gte) {
      const fromDate =
        data.createdAt.gte instanceof Date ? data.createdAt.gte : new Date(data.createdAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      createdAtCondition.gte = fromDate;
    }
    if (data.createdAt.lte) {
      const toDate =
        data.createdAt.lte instanceof Date ? data.createdAt.lte : new Date(data.createdAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      createdAtCondition.lte = toDate;
    }
    if (Object.keys(createdAtCondition).length > 0) {
      andConditions.push({ createdAt: createdAtCondition });
    }
    delete data.createdAt;
  }

  if (data.updatedAt) {
    const updatedAtCondition: any = {};
    if (data.updatedAt.gte) {
      const fromDate =
        data.updatedAt.gte instanceof Date ? data.updatedAt.gte : new Date(data.updatedAt.gte);
      // Set to start of day (00:00:00)
      fromDate.setHours(0, 0, 0, 0);
      updatedAtCondition.gte = fromDate;
    }
    if (data.updatedAt.lte) {
      const toDate =
        data.updatedAt.lte instanceof Date ? data.updatedAt.lte : new Date(data.updatedAt.lte);
      // Set to end of day (23:59:59.999)
      toDate.setHours(23, 59, 59, 999);
      updatedAtCondition.lte = toDate;
    }
    if (Object.keys(updatedAtCondition).length > 0) {
      andConditions.push({ updatedAt: updatedAtCondition });
    }
    delete data.updatedAt;
  }

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = data.where.AND
        ? { ...data.where, AND: [...(data.where.AND || []), ...andConditions] }
        : andConditions.length === 1
          ? andConditions[0]
          : { AND: andConditions };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

// =====================
// Query Schemas
// =====================

export const notificationGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: notificationWhereSchema.optional(),
    orderBy: notificationOrderBySchema.optional(),
    include: notificationIncludeSchema.optional(),
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
    ...notificationFilters,
  })
  .transform(notificationTransform);

export const seenNotificationGetManySchema = z
  .object({
    page: z.coerce.number().int().min(0).default(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(20).optional(),
    take: z.coerce.number().int().positive().max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
    where: seenNotificationWhereSchema.optional(),
    orderBy: seenNotificationOrderBySchema.optional(),
    include: seenNotificationIncludeSchema.optional(),
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
    ...seenNotificationFilters,
  })
  .transform(seenNotificationTransform);

// =====================
// Additional Query Schemas
// =====================

export const notificationGetByIdSchema = z.object({
  include: notificationIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Notificação inválida' }),
});

export const seenNotificationGetByIdSchema = z.object({
  include: seenNotificationIncludeSchema.optional(),
  id: z.string().uuid({ message: 'Visualização inválida' }),
});

// =====================
// Transform for Create/Update Schemas
// =====================

const toFormData = <T>(data: T) => data;

// =====================
// CRUD Schemas
// =====================

export const notificationCreateSchema = z
  .object({
    userId: z.union([z.string().uuid({ message: 'Usuário inválido' }), z.null()]).optional(),
    title: z.string().min(1, 'Título é obrigatório'),
    body: z.string().min(1, 'Corpo é obrigatório'),
    type: z.enum(Object.values(NOTIFICATION_TYPE) as [string, ...string[]], {
      errorMap: () => ({ message: 'tipo de notificação inválido' }),
    }),
    channel: z
      .preprocess(
        (val) => {
          // Convert object with numeric keys to array
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.values(val);
          }
          return val;
        },
        z
          .array(
            z.enum(Object.values(NOTIFICATION_CHANNEL) as [string, ...string[]], {
              errorMap: () => ({ message: 'canal de notificação inválido' }),
            }),
          )
          .default([NOTIFICATION_CHANNEL.IN_APP]),
      ),
    importance: z
      .enum(Object.values(NOTIFICATION_IMPORTANCE) as [string, ...string[]], {
        errorMap: () => ({ message: 'importância da notificação inválida' }),
      })
      .default(NOTIFICATION_IMPORTANCE.NORMAL),
    actionType: z.string().nullable().optional(),
    actionUrl: z.string().url('URL de ação inválida').nullable().optional(),
    scheduledAt: nullableDate.optional(),
    sentAt: nullableDate.optional(),
  })
  .transform(toFormData);

export const notificationUpdateSchema = z
  .object({
    userId: z.union([z.string().uuid({ message: 'Usuário inválido' }), z.null()]).optional(),
    title: z.string().min(1, 'Título é obrigatório').optional(),
    body: z.string().min(1, 'Corpo é obrigatório').optional(),
    type: z
      .enum(Object.values(NOTIFICATION_TYPE) as [string, ...string[]], {
        errorMap: () => ({ message: 'tipo de notificação inválido' }),
      })
      .optional(),
    channel: z
      .array(
        z.enum(Object.values(NOTIFICATION_CHANNEL) as [string, ...string[]], {
          errorMap: () => ({ message: 'canal de notificação inválido' }),
        }),
      )
      .optional(),
    importance: z
      .enum(Object.values(NOTIFICATION_IMPORTANCE) as [string, ...string[]], {
        errorMap: () => ({ message: 'importância da notificação inválida' }),
      })
      .optional(),
    actionType: z.string().nullable().optional(),
    actionUrl: z.string().url('URL de ação inválida').nullable().optional(),
    scheduledAt: nullableDate.optional(),
    sentAt: nullableDate.optional(),
  })
  .transform(toFormData);

export const seenNotificationCreateSchema = z
  .object({
    userId: z.string().uuid({ message: 'Usuário inválido' }),
    notificationId: z.string().uuid({ message: 'Notificação inválida' }),
    seenAt: z.date().default(() => new Date()),
  })
  .transform(toFormData);

export const seenNotificationUpdateSchema = z
  .object({
    userId: z.string().uuid({ message: 'Usuário inválido' }).optional(),
    notificationId: z.string().uuid({ message: 'Notificação inválida' }).optional(),
    seenAt: z.date().optional(),
  })
  .transform(toFormData);

// =====================
// Batch Operations Schemas
// =====================

export const notificationBatchCreateSchema = z.object({
  notifications: z
    .array(notificationCreateSchema)
    .min(1, 'Pelo menos uma notificação deve ser fornecida'),
});

export const notificationBatchUpdateSchema = z.object({
  notifications: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Notificação inválida' }),
        data: notificationUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma notificação deve ser fornecida'),
});

export const notificationBatchDeleteSchema = z.object({
  notificationIds: z
    .array(z.string().uuid({ message: 'Notificação inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const notificationQuerySchema = z.object({
  include: notificationIncludeSchema.optional(),
});

export const seenNotificationBatchCreateSchema = z.object({
  seenNotifications: z
    .array(seenNotificationCreateSchema)
    .min(1, 'Pelo menos uma notificação vista deve ser fornecida'),
});

export const seenNotificationBatchUpdateSchema = z.object({
  seenNotifications: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Notificação vista inválida' }),
        data: seenNotificationUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos uma notificação vista deve ser fornecida'),
});

export const seenNotificationBatchDeleteSchema = z.object({
  seenNotificationIds: z
    .array(z.string().uuid({ message: 'Visualização inválida' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// Query schema for include parameter
export const seenNotificationQuerySchema = z.object({
  include: seenNotificationIncludeSchema.optional(),
});

// =====================
// Inferred Types
// =====================

// Notification types
export type NotificationGetManyFormData = z.infer<typeof notificationGetManySchema>;
export type NotificationGetByIdFormData = z.infer<typeof notificationGetByIdSchema>;
export type NotificationQueryFormData = z.infer<typeof notificationQuerySchema>;

export type NotificationCreateFormData = z.infer<typeof notificationCreateSchema>;
export type NotificationUpdateFormData = z.infer<typeof notificationUpdateSchema>;

export type NotificationBatchCreateFormData = z.infer<typeof notificationBatchCreateSchema>;
export type NotificationBatchUpdateFormData = z.infer<typeof notificationBatchUpdateSchema>;
export type NotificationBatchDeleteFormData = z.infer<typeof notificationBatchDeleteSchema>;

export type NotificationInclude = z.infer<typeof notificationIncludeSchema>;
export type NotificationOrderBy = z.infer<typeof notificationOrderBySchema>;
export type NotificationWhere = z.infer<typeof notificationWhereSchema>;

// SeenNotification types
export type SeenNotificationGetManyFormData = z.infer<typeof seenNotificationGetManySchema>;
export type SeenNotificationGetByIdFormData = z.infer<typeof seenNotificationGetByIdSchema>;
export type SeenNotificationQueryFormData = z.infer<typeof seenNotificationQuerySchema>;

export type SeenNotificationCreateFormData = z.infer<typeof seenNotificationCreateSchema>;
export type SeenNotificationUpdateFormData = z.infer<typeof seenNotificationUpdateSchema>;

export type SeenNotificationBatchCreateFormData = z.infer<typeof seenNotificationBatchCreateSchema>;
export type SeenNotificationBatchUpdateFormData = z.infer<typeof seenNotificationBatchUpdateSchema>;
export type SeenNotificationBatchDeleteFormData = z.infer<typeof seenNotificationBatchDeleteSchema>;

export type SeenNotificationInclude = z.infer<typeof seenNotificationIncludeSchema>;
export type SeenNotificationOrderBy = z.infer<typeof seenNotificationOrderBySchema>;
export type SeenNotificationWhere = z.infer<typeof seenNotificationWhereSchema>;
