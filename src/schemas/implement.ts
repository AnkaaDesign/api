// IMPLEMENTO (era `Implement`) — schemas das rotas `/implements` (e do alias `/implements`).
//
// PLANO §5.1/§5.3 (P11a): include/where/orderBy ESTRITOS, corpo de edição
// `.strict()` só com o que é gravável, e a SÉRIE fora do corpo (S-9: a rota
// aceita WAREHOUSE; a série se edita na tarefa, domínio `identity`, ou pelo
// portal). O corpo velho (`implementType`, `implementId`) chega traduzido pelo alias.

import { z } from 'zod';
import {
  orderByDirectionSchema,
  normalizeOrderBy,
  normalizeSearchTerm,
  normalizeVehicleSearchTerm,
  plateSchema,
  rearDoorBarCountSchema,
  rearDoorHatchCountSchema,
  rearDoorLeavesSchema,
  chassisNumberSchema,
} from './common';
import { IMPLEMENT_SPOT, IMPLEMENT_CATEGORY, IMPLEMENT_TYPE } from '@constants';
import { IMPLEMENT_FACES, type ImplementFace } from '../constants/implement-faces';

/** DD1: toda tarefa tem exatamente um implemento; ele não se remove, se limpa. */
export const IMPLEMENT_NOT_REMOVABLE_MESSAGE =
  'O implemento não pode ser removido da tarefa; limpe os campos.';

// =====================
// Enums
// =====================

export const implementSpotSchema = z.nativeEnum(IMPLEMENT_SPOT);
export const implementCategorySchema = z.nativeEnum(IMPLEMENT_CATEGORY);
export const implementTypeSchema = z.nativeEnum(IMPLEMENT_TYPE);

// =====================
// Include (estrito)
// =====================

const measureInclude = z
  .union([
    z.boolean(),
    z
      .object({
        include: z.object({ sections: z.boolean().optional(), photo: z.boolean().optional() }).strict().optional(),
      })
      .strict(),
  ])
  .optional();

export const implementIncludeSchema = z
  .object({
    task: z
      .union([
        z.boolean(),
        z
          .object({
            include: z
              .object({
                sector: z.boolean().optional(),
                customer: z.boolean().optional(),
                budgets: z.boolean().optional(),
                invoices: z.boolean().optional(),
                receipts: z.boolean().optional(),
                observation: z.boolean().optional(),
                generalPainting: z.boolean().optional(),
                createdBy: z.boolean().optional(),
                layouts: z.boolean().optional(),
                logoPaints: z.boolean().optional(),
                serviceOrders: z.boolean().optional(),
              })
              .strict()
              .optional(),
            select: z.record(z.string(), z.any()).optional(),
          })
          .strict(),
      ])
      .optional(),
    // As medidas de cada face, da lista única (`leftSideMeasure`, …, `frontSideMeasure`)
    ...(Object.fromEntries(IMPLEMENT_FACES.map(face => [`${face}SideMeasure`, measureInclude])) as Record<
      `${ImplementFace}SideMeasure`,
      typeof measureInclude
    >),
    // Foto da plaqueta de identificação (VIN) — File, não texto.
    vinPlate: z.boolean().optional(),
    // Projeto do implemento (a Furgões): PDFs.
    projectFiles: z.boolean().optional(),
  })
  .strict();

// =====================
// Order By
// =====================

const implementOrderByFields = z
  .object({
    id: orderByDirectionSchema.optional(),
    serialNumber: orderByDirectionSchema.optional(),
    plate: orderByDirectionSchema.optional(),
    chassisNumber: orderByDirectionSchema.optional(),
    vinPlateId: orderByDirectionSchema.optional(),
    category: orderByDirectionSchema.optional(),
    type: orderByDirectionSchema.optional(),
    spot: orderByDirectionSchema.optional(),
    taskId: orderByDirectionSchema.optional(),
    createdAt: orderByDirectionSchema.optional(),
    updatedAt: orderByDirectionSchema.optional(),
  })
  .strict();

export const implementOrderBySchema = z
  .union([implementOrderByFields, z.array(implementOrderByFields)])
  .optional();

// =====================
// Where (estrito; relações aninhadas passam pelo G1, que as confere no DMMF)
// =====================

const stringFilter = z.union([
  z.string(),
  z
    .object({
      equals: z.string().nullable().optional(),
      not: z.string().nullable().optional(),
      in: z.array(z.string()).optional(),
      notIn: z.array(z.string()).optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      mode: z.enum(['default', 'insensitive']).optional(),
    })
    .strict(),
]);

function enumFilter<T extends z.ZodTypeAny>(e: T) {
  return z
    .union([
      e,
      z
        .object({
          equals: e.nullable().optional(),
          not: e.nullable().optional(),
          in: z.array(e).optional(),
          notIn: z.array(e).optional(),
        })
        .strict(),
    ])
    .nullable()
    .optional();
}

const dateRange = z
  .object({ gte: z.coerce.date().optional(), lte: z.coerce.date().optional() })
  .strict()
  .optional();

export const implementWhereSchema: z.ZodSchema<any> = z.lazy(() =>
  z
    .object({
      AND: z.union([implementWhereSchema, z.array(implementWhereSchema)]).optional(),
      OR: z.array(implementWhereSchema).optional(),
      NOT: z.union([implementWhereSchema, z.array(implementWhereSchema)]).optional(),
      id: stringFilter.optional(),
      serialNumber: stringFilter.nullable().optional(),
      plate: stringFilter.nullable().optional(),
      chassisNumber: stringFilter.nullable().optional(),
      vinPlateId: stringFilter.nullable().optional(),
      category: enumFilter(implementCategorySchema),
      type: enumFilter(implementTypeSchema),
      spot: enumFilter(implementSpotSchema),
      rearDoorLeaves: enumFilter(rearDoorLeavesSchema),
      rearDoorBarCount: z.union([z.number().int(), z.record(z.string(), z.any())]).nullable().optional(),
      rearDoorHatchCount: z.union([z.number().int(), z.record(z.string(), z.any())]).nullable().optional(),
      taskId: stringFilter.optional(),
      createdAt: dateRange,
      updatedAt: dateRange,
      // Relações: o formato é o do Prisma; o G1 (queryModel: 'Implement') recusa
      // com 400 nomeado a chave que o modelo não conhece.
      task: z.record(z.string(), z.any()).optional(),
      ...(Object.fromEntries(
        IMPLEMENT_FACES.map(face => [`${face}SideMeasure`, z.record(z.string(), z.any()).nullable().optional()]),
      ) as Record<`${ImplementFace}SideMeasure`, z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodAny>>>>),
      projectFiles: z.record(z.string(), z.any()).optional(),
    })
    .strict(),
);

// =====================
// Filtros de conveniência → where
// =====================

const implementTransform = (data: any): any => {
  if (data.orderBy) {
    data.orderBy = normalizeOrderBy(data.orderBy);
  }

  const andConditions: any[] = [];

  if (data.searchingFor && typeof data.searchingFor === 'string' && data.searchingFor.trim()) {
    const searchTerm = data.searchingFor.trim();
    andConditions.push({
      OR: [
        { plateNormalized: { contains: normalizeVehicleSearchTerm(searchTerm) } },
        { chassisNumberNormalized: { contains: normalizeVehicleSearchTerm(searchTerm) } },
        // DD1: a série é do implemento (coluna gerada + GIN próprios, M1s)
        { serialNumberNormalized: { contains: normalizeSearchTerm(searchTerm) } },
        { task: { nameNormalized: { contains: normalizeSearchTerm(searchTerm) } } },
      ],
    });
  }
  delete data.searchingFor;

  // Vaga atribuída ou não. `spot: null` = fora das instalações (não é "pátio").
  if (data.hasSpot === true) andConditions.push({ spot: { not: null } });
  else if (data.hasSpot === false) andConditions.push({ spot: null });
  delete data.hasSpot;

  if (Array.isArray(data.spots) && data.spots.length > 0) {
    andConditions.push({ spot: { in: data.spots } });
  }
  delete data.spots;

  if (Array.isArray(data.categories) && data.categories.length > 0) {
    andConditions.push({ category: { in: data.categories } });
  }
  delete data.categories;

  if (Array.isArray(data.types) && data.types.length > 0) {
    andConditions.push({ type: { in: data.types } });
  }
  delete data.types;

  // Barracão (B1, B2, B3): vagas com o prefixo do barracão
  if (data.garageNumber && typeof data.garageNumber === 'string') {
    const prefix = `B${data.garageNumber}_`;
    const garageSpots = Object.values(IMPLEMENT_SPOT).filter(spot => spot.startsWith(prefix));
    if (garageSpots.length > 0) andConditions.push({ spot: { in: garageSpots } });
  }
  delete data.garageNumber;

  // Pátio = as duas vagas de pátio (espera e saída). O filtro antigo `inPatio`
  // procurava `spot: null`, que na verdade é "fora das instalações".
  if (data.inPatio === true) {
    andConditions.push({ spot: { in: [IMPLEMENT_SPOT.YARD_WAIT, IMPLEMENT_SPOT.YARD_EXIT] } });
  }
  delete data.inPatio;

  if (Array.isArray(data.taskIds) && data.taskIds.length > 0) {
    andConditions.push({ taskId: { in: data.taskIds } });
  }
  delete data.taskIds;

  if (andConditions.length > 0) {
    if (data.where) {
      data.where = { AND: [data.where, ...andConditions] };
    } else {
      data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
    }
  }

  return data;
};

/**
 * `GET /implements`. Sem `limit`, devolve TODOS (é o que o pátio e o barracão do
 * web e do app pedem hoje em `GET /implements`); com `limit`, pagina.
 */
export const implementGetManySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
    searchingFor: z.string().optional(),
    hasSpot: z.boolean().optional(),
    spots: z.array(implementSpotSchema).optional(),
    garageNumber: z.enum(['1', '2', '3']).optional(),
    inPatio: z.boolean().optional(),
    categories: z.array(implementCategorySchema).optional(),
    types: z.array(implementTypeSchema).optional(),
    taskIds: z.array(z.string().uuid()).optional(),
    where: implementWhereSchema.optional(),
    orderBy: implementOrderBySchema,
    include: implementIncludeSchema.optional(),
  })
  .strict()
  .transform(implementTransform);

export const implementQuerySchema = z
  .object({
    include: implementIncludeSchema.optional(),
  })
  .strict();

// =====================
// Corpo de edição
// =====================

/**
 * `PUT /implements/:id` — SÓ o que é gravável aqui. A série NÃO (S-9): quem tem
 * esta rota inclui o almoxarifado, e a série se edita na tarefa (domínio
 * `identity`) ou pelo portal. Frente e porta traseira chegam com a M2 (P11b).
 */
export const IMPLEMENT_SERIAL_NOT_EDITABLE_HERE = 'A série se edita na tarefa.';

export const implementUpdateSchema = z
  .object({
    plate: plateSchema,
    chassisNumber: chassisNumberSchema,
    vinPlateId: z.string().uuid('Foto da plaqueta inválida').nullable().optional(),
    category: implementCategorySchema.nullable().optional(),
    type: implementTypeSchema.nullable().optional(),
    spot: implementSpotSchema.nullable().optional(),
    // Porta traseira (R5, DD4): null apaga, ausente não mexe.
    rearDoorLeaves: rearDoorLeavesSchema.nullable().optional(),
    rearDoorBarCount: rearDoorBarCountSchema.nullable().optional(),
    rearDoorHatchCount: rearDoorHatchCountSchema.nullable().optional(),
    serialNumber: z
      .any()
      .optional()
      .refine(v => v === undefined, { message: IMPLEMENT_SERIAL_NOT_EDITABLE_HERE }),
  })
  .strict();

/**
 * `PUT /implements/:id/project-files` — o PROJETO DO IMPLEMENTO (R6): o PDF da
 * Furgões. `fileIds` é a lista INTEIRA que fica (arquivos já enviados); os que
 * sobem no multipart (`implementProjectFiles`) entram junto. Lista vazia e sem
 * upload = tirar todos.
 */
export const implementProjectFilesSchema = z
  .object({
    fileIds: z.array(z.string().uuid('Arquivo inválido')).max(30, 'No máximo 30 arquivos no projeto.').default([]),
  })
  .strict();

export type ImplementProjectFilesFormData = z.infer<typeof implementProjectFilesSchema>;

// =====================
// Vagas, movimentação e disponibilidade
// =====================

export const implementBulkSpotUpdateSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            implementId: z.string().uuid('Implemento inválido'),
            spot: implementSpotSchema.nullable(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export const implementRequestMovementSchema = z
  .object({
    taskId: z.string().uuid('Tarefa inválida'),
    implementId: z.string().uuid('Implemento inválido'),
    taskName: z.string().max(300).nullable().optional(),
    fromSpot: implementSpotSchema.nullable().optional(),
    toSpot: implementSpotSchema.nullable().optional(),
  })
  .strict();

export const implementAvailabilityQuerySchema = z
  .object({
    implementLength: z.coerce.number().positive('Comprimento inválido').max(40),
    excludeImplementId: z.string().uuid().optional(),
  })
  .strict();

// =====================
// Tipos
// =====================

export type ImplementGetManyFormData = z.infer<typeof implementGetManySchema>;
export type ImplementQueryFormData = z.infer<typeof implementQuerySchema>;
export type ImplementUpdateFormData = z.infer<typeof implementUpdateSchema>;
export type ImplementBulkSpotUpdateFormData = z.infer<typeof implementBulkSpotUpdateSchema>;
export type ImplementRequestMovementFormData = z.infer<typeof implementRequestMovementSchema>;
export type ImplementAvailabilityQueryFormData = z.infer<typeof implementAvailabilityQuerySchema>;
export type ImplementInclude = z.infer<typeof implementIncludeSchema>;
