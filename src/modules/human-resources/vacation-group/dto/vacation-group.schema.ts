// vacation-group.schema.ts
// Férias COLETIVAS (CLT art. 139-141) — Departamento Pessoal.
//
// Mirrors the vacation module's module-local zod convention. A VacationGroup is
// the collective "template": register the shared período + alvo (ALL/SECTOR/
// POSITION) first, then expand it into one individual Vacation per colaborador.

import { z } from 'zod';
import { VACATION_STATUS, VACATION_GROUP_TYPE } from '../../../../constants';

// =====================
// Include / order / where (Prisma passthrough)
// =====================

const relationIncludeSchema = z.union([
  z.boolean(),
  z.object({
    include: z.any().optional(),
    select: z.any().optional(),
    where: z.any().optional(),
    orderBy: z.any().optional(),
  }),
]);

export const vacationGroupIncludeSchema = z
  .object({
    vacations: relationIncludeSchema.optional(),
  })
  .partial();

const orderByDirection = z.enum(['asc', 'desc']);

const vacationGroupOrderByFields = z.object({
  id: orderByDirection.optional(),
  name: orderByDirection.optional(),
  status: orderByDirection.optional(),
  statusOrder: orderByDirection.optional(),
  acquisitiveStart: orderByDirection.optional(),
  acquisitiveEnd: orderByDirection.optional(),
  concessiveEnd: orderByDirection.optional(),
  createdAt: orderByDirection.optional(),
  updatedAt: orderByDirection.optional(),
});

export const vacationGroupOrderBySchema = z
  .union([vacationGroupOrderByFields, z.array(vacationGroupOrderByFields)])
  .optional();

const stringWhere = z.union([
  z.string(),
  z.object({
    equals: z.string().optional(),
    in: z.array(z.string()).optional(),
    contains: z.string().optional(),
    mode: z.enum(['default', 'insensitive']).optional(),
    not: z.string().optional(),
  }),
]);

export const vacationGroupWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      AND: z.array(vacationGroupWhereSchema).optional(),
      OR: z.array(vacationGroupWhereSchema).optional(),
      NOT: vacationGroupWhereSchema.optional(),
      id: stringWhere.optional(),
      name: stringWhere.optional(),
      type: stringWhere.optional(),
      status: stringWhere.optional(),
    })
    .partial(),
);

// =====================
// Filters + transform
// =====================

const vacationGroupFilters = {
  searchingFor: z.string().optional(),
  statuses: z.array(z.enum(Object.values(VACATION_STATUS) as [string, ...string[]])).optional(),
};

const paginationShape = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  take: z.coerce.number().int().positive().max(100).optional(),
};

const vacationGroupTransform = (data: any) => {
  if (data.take && !data.limit) data.limit = data.take;
  delete data.take;
  const and: any[] = Array.isArray(data.AND) ? [...data.AND] : data.AND ? [data.AND] : [];
  if (data.searchingFor) {
    and.push({
      OR: [
        { name: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
        { notes: { contains: data.searchingFor.trim(), mode: 'insensitive' } },
      ],
    });
    delete data.searchingFor;
  }
  if (Array.isArray(data.statuses) && data.statuses.length > 0) {
    and.push({ status: { in: data.statuses } });
    delete data.statuses;
  }
  if (and.length > 0) {
    const where = data.where ?? {};
    where.AND = [...(where.AND ?? []), ...and];
    data.where = where;
  }
  return data;
};

// =====================
// Query schemas
// =====================

export const vacationGroupGetManySchema = z
  .object({
    ...paginationShape,
    where: vacationGroupWhereSchema.optional(),
    orderBy: vacationGroupOrderBySchema.optional(),
    include: vacationGroupIncludeSchema.optional(),
    ...vacationGroupFilters,
  })
  .transform(vacationGroupTransform);

export const vacationGroupQuerySchema = z.object({
  include: vacationGroupIncludeSchema.optional(),
});

// =====================
// CRUD schemas (template single-period: startDate + days)
// =====================

const groupGozoDaysSchema = z.coerce
  .number({ invalid_type_error: 'dias inválidos' })
  .int({ message: 'Dias deve ser inteiro' })
  .min(1, { message: 'O gozo coletivo deve ter ao menos 1 dia' })
  .max(30, { message: 'O gozo coletivo não pode exceder 30 dias' });

export const vacationGroupCreateSchema = z
  .object({
    name: z.string().min(1, { message: 'Informe um nome para as férias coletivas' }).max(200),
    type: z.enum(Object.values(VACATION_GROUP_TYPE) as [string, ...string[]]),
    acquisitiveStart: z.coerce.date({ invalid_type_error: 'data inválida' }),
    acquisitiveEnd: z.coerce.date({ invalid_type_error: 'data inválida' }),
    sectorIds: z.array(z.string().uuid({ message: 'Setor inválido' })).optional(),
    positionIds: z.array(z.string().uuid({ message: 'Cargo inválido' })).optional(),
    notes: z.string().max(2000).nullable().optional(),
    // Template single-period aplicado a cada colaborador na expansão.
    startDate: z.coerce.date({ invalid_type_error: 'data de início inválida' }),
    days: groupGozoDaysSchema,
  })
  .refine(
    d => d.type !== VACATION_GROUP_TYPE.SECTOR || (d.sectorIds?.length ?? 0) > 0,
    { message: 'Selecione ao menos um setor para férias coletivas por setor.', path: ['sectorIds'] },
  )
  .refine(
    d => d.type !== VACATION_GROUP_TYPE.POSITION || (d.positionIds?.length ?? 0) > 0,
    { message: 'Selecione ao menos um cargo para férias coletivas por cargo.', path: ['positionIds'] },
  );

export const vacationGroupUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sectorIds: z.array(z.string().uuid()).optional(),
  positionIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date({ invalid_type_error: 'data de início inválida' }).optional(),
  days: groupGozoDaysSchema.optional(),
});

export const vacationGroupAdvanceSchema = z.object({
  status: z.enum(Object.values(VACATION_STATUS) as [string, ...string[]]).optional(),
});

// =====================
// Inferred types
// =====================

export type VacationGroupGetManyFormData = z.infer<typeof vacationGroupGetManySchema>;
export type VacationGroupQueryFormData = z.infer<typeof vacationGroupQuerySchema>;
export type VacationGroupCreateFormData = z.infer<typeof vacationGroupCreateSchema>;
export type VacationGroupUpdateFormData = z.infer<typeof vacationGroupUpdateSchema>;
export type VacationGroupAdvanceFormData = z.infer<typeof vacationGroupAdvanceSchema>;
export type VacationGroupInclude = z.infer<typeof vacationGroupIncludeSchema>;
