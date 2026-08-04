import { z } from 'zod';

// =====================================================================
// Painting production cost engine — Zod schemas
// Plano: api/PAINTING_COST_ENGINE_PLAN.md
// =====================================================================

export const paintingFaceViews = ['LEFT_SIDE', 'RIGHT_SIDE', 'BACK', 'FRONT', 'ROOF'] as const;
export const paintingServiceContexts = ['NEW_IMPLEMENT', 'REFORM'] as const;
export const paintingSubstrates = ['CHAPA_FRISOS', 'ISOPLASTIC', 'SIDER_LONA', 'OUTRO'] as const;
export const paintingStatuses = ['DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'ARCHIVED', 'FAILED'] as const;
export const paintingRegionKinds = ['CHAPADA', 'DEGRADE', 'FOTOGRAFICO', 'MICRO', 'TEXTURA', 'RESERVA'] as const;
export const paintingStrategies = [
  'ADESIVO_RECORTE',
  'FITA_CORTE',
  'FITA_FLEXIVEL',
  'STENCIL',
  'CURA_ADESIVO',
  'AEROGRAFIA',
  'AEROGRAFIA_ARTISTICA',
  'NENHUMA',
] as const;
export const paintingBoundaryResolutions = ['FITA_CORTE', 'FITA_FLEXIVEL', 'CURA_ADESIVO', 'NENHUMA'] as const;
export const paintingReferenceKinds = ['TOTAL_LENGTH', 'WIDTH', 'SIDE_HEIGHT', 'HEIGHT'] as const;
export const paintingComputeStages = ['MATCH', 'STRATEGY', 'PLAN'] as const;
export const paintingEngineStages = ['quantize', 'regions', 'classify', 'boundaries', 'adhesive'] as const;

export const paintingCostLineKinds = ['MATERIAL', 'MAO_DE_OBRA', 'SERVICO', 'EQUIPAMENTO'] as const;
export const paintingMeasureBases = ['AREA', 'LINEAR', 'VOLUME', 'UNIT', 'TIME'] as const;

/**
 * Programa de superfície. Só comprimento e altura são digitados — largura, teto,
 * chassi, frames, portas e Thermo King são inferidos, e a pintura geral / cor final
 * saem da arte. `targetPaintId` é apenas override manual da cor detectada.
 */
const surfaceFields = {
  paintSystemKey: z.string().trim().nullish().optional(),
  targetPaintId: z.string().uuid().nullish().optional(),
  lengthCm: z.coerce.number().positive().nullish().optional(),
  heightCm: z.coerce.number().positive().nullish().optional(),
};

export const paintingAnalysisCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.'),
  serviceContext: z.enum(paintingServiceContexts).default('NEW_IMPLEMENT'),
  substrate: z.enum(paintingSubstrates).default('CHAPA_FRISOS'),
  alreadyPrepared: z.coerce.boolean().default(false),
  taskId: z.string().uuid().nullish(),
  implementMeasureId: z.string().uuid().nullish(),
  ...surfaceFields,
});

export const paintingAnalysisUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  serviceContext: z.enum(paintingServiceContexts).optional(),
  substrate: z.enum(paintingSubstrates).optional(),
  alreadyPrepared: z.coerce.boolean().optional(),
  status: z.enum(paintingStatuses).optional(),
  taskId: z.string().uuid().nullish().optional(),
  implementMeasureId: z.string().uuid().nullish().optional(),
  ...surfaceFields,
});

export const paintingAnalysisGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  searchingFor: z.string().trim().optional(),
  status: z.enum(paintingStatuses).optional(),
  taskId: z.string().uuid().optional(),
  orderBy: z.record(z.enum(['name', 'status', 'createdAt', 'updatedAt']), z.enum(['asc', 'desc'])).optional(),
});

// multipart: scalar fields arrive as strings
export const paintingFaceCreateSchema = z.object({
  view: z.enum(paintingFaceViews),
  referenceKind: z.enum(paintingReferenceKinds),
  referenceValueCm: z.coerce.number().positive('Medida de referência deve ser positiva.'),
  fileId: z.string().uuid().optional(), // alternative to the uploaded file
});

export const paintingFaceUpdateSchema = z.object({
  referenceKind: z.enum(paintingReferenceKinds).optional(),
  referenceValueCm: z.coerce.number().positive().optional(),
  backgroundMode: z.enum(['WHITE_PLATE', 'GENERAL_PAINT', 'SIDER_CANVAS']).optional(),
  backgroundPaintId: z.string().uuid().nullish().optional(),
});

export const paintingProcessSchema = z.object({
  faceIds: z.array(z.string().uuid()).optional(),
  stages: z.array(z.enum(paintingEngineStages)).optional(),
  paramsOverride: z.record(z.string(), z.any()).optional(),
});

export const paintingComputeSchema = z.object({
  stages: z.array(z.enum(paintingComputeStages)).optional(),
});

export const paintingRegionUpdateSchema = z.object({
  paintId: z.string().uuid().nullish().optional(),
  kind: z.enum(paintingRegionKinds).optional(),
  strategy: z.enum(paintingStrategies).optional(),
});

export const paintingBoundaryUpdateSchema = z.object({
  resolution: z.enum(paintingBoundaryResolutions).optional(),
});

export const paintingStepUpdateSchema = z.object({
  minutes: z.coerce.number().min(0).optional(),
  actualMinutes: z.coerce.number().min(0).nullish().optional(),
  actualNotes: z.string().trim().nullish().optional(),
});

export const paintingStepTaskUpdateSchema = z.object({
  minutes: z.coerce.number().min(0).optional(),
});

/** Quantidade consumida e valor unitário de uma linha de material do passo. */
export const paintingStepMaterialUpdateSchema = z.object({
  quantity: z.coerce.number().min(0).optional(),
  unitPrice: z.coerce.number().min(0).optional(),
});

// ---- config ---------------------------------------------------------------

export const paintingRateUpdateSchema = z.object({
  value: z.coerce.number().positive().optional(),
  complexityFactorMedium: z.coerce.number().min(1).optional(),
  complexityFactorHigh: z.coerce.number().min(1).optional(),
  notes: z.string().trim().nullish().optional(),
});

export const paintingIndirectUpdateSchema = z.object({
  value: z.coerce.number().min(0).optional(),
  active: z.coerce.boolean().optional(),
});

export const paintingRuleUpdateSchema = z.object({
  params: z.record(z.string(), z.any()).optional(),
  active: z.coerce.boolean().optional(),
});

export const paintingPaintSystemUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  paintTypeId: z.string().uuid().nullish().optional(),
  coatsSchedule: z
    .array(
      z.object({
        role: z.enum(['GROUND', 'COLOR', 'CLEAR']),
        systemKey: z.string().trim().min(1),
        coats: z.coerce.number().int().min(1).max(8),
      }),
    )
    .optional(),
  mixBase: z.coerce.number().min(0).optional(),
  mixCatalyst: z.coerce.number().min(0).optional(),
  mixThinner: z.coerce.number().min(0).optional(),
  catalystItemId: z.string().uuid().nullish().optional(),
  thinnerItemId: z.string().uuid().nullish().optional(),
  coverageM2PerL: z.coerce.number().positive().optional(),
  sprayLossPct: z.coerce.number().min(0).max(1).optional(),
  prepLossPct: z.coerce.number().min(0).max(1).optional(),
  minBatchL: z.coerce.number().min(0).optional(),
  cureMinutes: z.coerce.number().min(0).optional(),
  needsConfirmation: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
});

export const paintingProcessParamUpdateSchema = z.object({
  coatsDefault: z.coerce.number().int().min(1).max(6).optional(),
  coverageM2PerL: z.coerce.number().positive().optional(),
  sprayLossPct: z.coerce.number().min(0).max(1).optional(),
  prepLossPct: z.coerce.number().min(0).max(1).optional(),
  cureMinutes: z.coerce.number().min(0).optional(),
  needsClearCoat: z.coerce.boolean().optional(),
});

export type PaintingAnalysisCreateFormData = z.infer<typeof paintingAnalysisCreateSchema>;
export type PaintingAnalysisUpdateFormData = z.infer<typeof paintingAnalysisUpdateSchema>;
export type PaintingAnalysisGetManyFormData = z.infer<typeof paintingAnalysisGetManySchema>;
export type PaintingFaceCreateFormData = z.infer<typeof paintingFaceCreateSchema>;
export type PaintingFaceUpdateFormData = z.infer<typeof paintingFaceUpdateSchema>;
export type PaintingProcessFormData = z.infer<typeof paintingProcessSchema>;
export type PaintingComputeFormData = z.infer<typeof paintingComputeSchema>;
export type PaintingRegionUpdateFormData = z.infer<typeof paintingRegionUpdateSchema>;
export type PaintingBoundaryUpdateFormData = z.infer<typeof paintingBoundaryUpdateSchema>;
export type PaintingStepUpdateFormData = z.infer<typeof paintingStepUpdateSchema>;
export type PaintingStepTaskUpdateFormData = z.infer<typeof paintingStepTaskUpdateSchema>;
export type PaintingStepMaterialUpdateFormData = z.infer<typeof paintingStepMaterialUpdateSchema>;
export type PaintingPaintSystemUpdateFormData = z.infer<typeof paintingPaintSystemUpdateSchema>;
