// agenda-event.ts
// Agenda com avisos — eventos com notificação antecipada (in-app, WhatsApp etc.).

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  paginationSchema,
  createStringWhereSchema,
  createUuidWhereSchema,
  createBooleanWhereSchema,
  createDateWhereSchema,
  mergeAndConditions,
} from './common';
import { NOTIFICATION_CHANNEL } from '@constants';

// =====================
// Include Schema
// =====================
export const agendaEventIncludeSchema = z
  .object({
    createdBy: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              position: z.boolean().optional(),
              sector: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// =====================
// OrderBy Schema
// =====================
const agendaEventOrderByFields = {
  id: orderByDirectionSchema.optional(),
  title: orderByDirectionSchema.optional(),
  eventDate: orderByDirectionSchema.optional(),
  notifyOnDay: orderByDirectionSchema.optional(),
  isActive: orderByDirectionSchema.optional(),
  createdById: orderByDirectionSchema.optional(),
  lastNotifiedAt: orderByDirectionSchema.optional(),
  createdAt: orderByDirectionSchema.optional(),
  updatedAt: orderByDirectionSchema.optional(),
};

export const agendaEventOrderBySchema = z
  .union([
    z.object(agendaEventOrderByFields).partial(),
    z.array(z.object(agendaEventOrderByFields).partial()),
  ])
  .optional();

// =====================
// Where Schema
// =====================
export const agendaEventWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(agendaEventWhereSchema).optional(),
      OR: z.array(agendaEventWhereSchema).optional(),
      NOT: agendaEventWhereSchema.optional(),
      id: createUuidWhereSchema().optional(),
      title: createStringWhereSchema().optional(),
      description: z.union([createStringWhereSchema(), z.null()]).optional(),
      eventDate: createDateWhereSchema().optional(),
      notifyOnDay: createBooleanWhereSchema().optional(),
      isActive: createBooleanWhereSchema().optional(),
      createdById: createUuidWhereSchema().optional(),
      lastNotifiedAt: z.union([createDateWhereSchema(), z.null()]).optional(),
      createdAt: createDateWhereSchema().optional(),
      updatedAt: createDateWhereSchema().optional(),
      createdBy: z
        .object({
          is: z.lazy(() => z.any()).optional(),
          isNot: z.lazy(() => z.any()).optional(),
        })
        .optional(),
    })
    .partial(),
);

// =====================
// Filters & Transform
// =====================
const agendaEventFilters = {
  searchingFor: z.string().optional(),
  isActive: z.boolean().optional(),
  createdByIds: z.array(z.string()).optional(),
  eventDateFrom: z.coerce.date().optional(),
  eventDateTo: z.coerce.date().optional(),
};

const agendaEventTransform = (data: any) => {
  if (data.orderBy) data.orderBy = normalizeOrderBy(data.orderBy);
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;

  const andConditions: any[] = [];
  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }
  if (typeof data.isActive === 'boolean') {
    andConditions.push({ isActive: data.isActive });
    delete data.isActive;
  }
  if (data.createdByIds && Array.isArray(data.createdByIds) && data.createdByIds.length > 0) {
    andConditions.push({ createdById: { in: data.createdByIds } });
    delete data.createdByIds;
  }
  if (data.eventDateFrom) {
    andConditions.push({ eventDate: { gte: data.eventDateFrom } });
    delete data.eventDateFrom;
  }
  if (data.eventDateTo) {
    andConditions.push({ eventDate: { lte: data.eventDateTo } });
    delete data.eventDateTo;
  }
  return mergeAndConditions(data, andConditions);
};

// =====================
// Query Schemas
// =====================
export const agendaEventGetManySchema = z
  .object({
    ...paginationSchema.shape,
    where: agendaEventWhereSchema.optional(),
    orderBy: agendaEventOrderBySchema.optional(),
    include: agendaEventIncludeSchema.optional(),
    ...agendaEventFilters,
  })
  .transform(agendaEventTransform);

export const agendaEventQuerySchema = z.object({
  include: agendaEventIncludeSchema.optional(),
});

export const agendaEventBatchQuerySchema = z.object({
  include: agendaEventIncludeSchema.optional(),
});

// =====================
// CRUD Schemas
// =====================
// Codificação dos lembretes (notifyDaysBefore Int[]):
//   N > 0 ⇒ lembrete N dias ANTES do evento;
//   0     ⇒ lembrete NO DIA do evento (substitui o antigo toggle "Avisar no
//           dia" — notifyOnDay é mantido por compatibilidade e derivado no
//           service como (0 ∈ notifyDaysBefore));
//   -1    ⇒ aviso de ATRASO, 1 dia APÓS o evento.
const notifyDaysBeforeSchema = z
  .array(
    z
      .number()
      .int()
      .min(-1, 'Valor de lembrete inválido')
      .max(365, 'Máximo 365 dias'),
  )
  .max(10, 'Máximo de 10 lembretes');

export const agendaEventCreateSchema = z.object({
  title: z
    .string({ required_error: 'O título é obrigatório' })
    .min(1, 'O título é obrigatório')
    .max(200, 'Máximo de 200 caracteres'),
  description: z.string().max(1000, 'Máximo de 1000 caracteres').nullable().optional(),
  eventDate: z.coerce.date({ required_error: 'A data do evento é obrigatória' }),
  notifyDaysBefore: notifyDaysBeforeSchema.optional(),
  notifyOnDay: z.boolean().optional(),
  channels: z
    .array(z.enum(Object.values(NOTIFICATION_CHANNEL) as [string, ...string[]]))
    .optional(),
  targetSectorIds: z.array(z.string().uuid({ message: 'Setor inválido' })).optional(),
  targetUserIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
  isActive: z.boolean().optional(),
});

export const agendaEventUpdateSchema = z.object({
  title: z.string().min(1, 'O título é obrigatório').max(200, 'Máximo de 200 caracteres').optional(),
  description: z.string().max(1000, 'Máximo de 1000 caracteres').nullable().optional(),
  eventDate: z.coerce.date().optional(),
  notifyDaysBefore: notifyDaysBeforeSchema.optional(),
  notifyOnDay: z.boolean().optional(),
  channels: z
    .array(z.enum(Object.values(NOTIFICATION_CHANNEL) as [string, ...string[]]))
    .optional(),
  targetSectorIds: z.array(z.string().uuid({ message: 'Setor inválido' })).optional(),
  targetUserIds: z.array(z.string().uuid({ message: 'Colaborador inválido' })).optional(),
  isActive: z.boolean().optional(),
});

export const agendaEventBatchCreateSchema = z.object({
  agendaEvents: z.array(agendaEventCreateSchema).min(1, 'Pelo menos um evento deve ser fornecido'),
});

export const agendaEventBatchUpdateSchema = z.object({
  agendaEvents: z
    .array(
      z.object({
        id: z.string().uuid({ message: 'Evento inválido' }),
        data: agendaEventUpdateSchema,
      }),
    )
    .min(1, 'Pelo menos um evento deve ser fornecido'),
});

export const agendaEventBatchDeleteSchema = z.object({
  agendaEventIds: z
    .array(z.string().uuid({ message: 'Evento inválido' }))
    .min(1, 'Pelo menos um ID deve ser fornecido'),
});

// =====================
// Inferred Types
// =====================
export type AgendaEventGetManyFormData = z.infer<typeof agendaEventGetManySchema>;
export type AgendaEventQueryFormData = z.infer<typeof agendaEventQuerySchema>;
export type AgendaEventBatchQueryFormData = z.infer<typeof agendaEventBatchQuerySchema>;
export type AgendaEventCreateFormData = z.infer<typeof agendaEventCreateSchema>;
export type AgendaEventUpdateFormData = z.infer<typeof agendaEventUpdateSchema>;
export type AgendaEventBatchCreateFormData = z.infer<typeof agendaEventBatchCreateSchema>;
export type AgendaEventBatchUpdateFormData = z.infer<typeof agendaEventBatchUpdateSchema>;
export type AgendaEventBatchDeleteFormData = z.infer<typeof agendaEventBatchDeleteSchema>;
export type AgendaEventInclude = z.infer<typeof agendaEventIncludeSchema>;
export type AgendaEventOrderBy = z.infer<typeof agendaEventOrderBySchema>;
export type AgendaEventWhere = z.infer<typeof agendaEventWhereSchema>;
