import { z } from "zod";

// Note: Time clock entries are now managed internally without external integrations
import { dateRangeSchema } from "./common";

// Time validation - HH:MM format
export const timeSchema = z
  .string()
  .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato inválido. Use HH:MM")
  .nullable()
  .optional();

// Base schema for time clock entry data
const timeClockEntryBaseSchema = z.object({
  entry1: timeSchema,
  exit1: timeSchema,
  entry2: timeSchema,
  exit2: timeSchema,
  entry3: timeSchema,
  exit3: timeSchema,
  entry4: timeSchema,
  exit4: timeSchema,
  entry5: timeSchema,
  exit5: timeSchema,
  dayType: z.number().min(0).max(3).default(0),
  compensated: z.boolean().default(false),
  neutral: z.boolean().default(false),
  dayOff: z.boolean().default(false),
  freeLunch: z.boolean().default(false),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
  source: z.string().default("WEB"),
  deviceId: z.string().nullable().optional(),
  hasPhoto: z.boolean().default(false),
});

// Create schema
export const timeClockEntryCreateSchema = timeClockEntryBaseSchema.extend({
  userId: z.string().uuid("Usuário inválido"),
  date: z.coerce.date(),
});

// Update schema
export const timeClockEntryUpdateSchema = timeClockEntryBaseSchema.partial().extend({
  id: z.string().uuid("Registro inválido"),
});

// Batch update schema for inline editing
export const timeClockEntryBatchUpdateSchema = z.object({
  entries: z.array(timeClockEntryUpdateSchema).min(1, "Deve incluir pelo menos uma entrada"),
});

// Time clock justification schema
export const timeClockJustificationSchema = z.object({
  originalTime: z.string(),
  newTime: timeSchema,
  field: z.string(),
  reason: z.string().min(5, "A justificativa deve ter pelo menos 5 caracteres"),
});

// Include schema for relations
export const timeClockEntryIncludeSchema = z
  .object({
    user: z
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
    _count: z
      .union([
        z.boolean(),
        z.object({
          select: z
            .object({
              justifications: z.boolean().optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
  })
  .partial();

// Where clause for filtering
export const timeClockEntryWhereSchema: z.ZodSchema = z.lazy(() =>
  z
    .object({
      id: z.union([z.string(), z.object({ in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() })]).optional(),
      userId: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      date: z.union([z.coerce.date(), dateRangeSchema]).optional(),
      source: z.union([z.string(), z.object({ in: z.array(z.string()).optional() })]).optional(),
      synced: z.boolean().optional(),
      dayOff: z.boolean().optional(),
      compensated: z.boolean().optional(),
      neutral: z.boolean().optional(),
      AND: z.union([timeClockEntryWhereSchema, z.array(timeClockEntryWhereSchema)]).optional(),
      OR: z.array(timeClockEntryWhereSchema).optional(),
      NOT: z.union([timeClockEntryWhereSchema, z.array(timeClockEntryWhereSchema)]).optional(),
    })
    .partial(),
);

// Order by schema
export const timeClockEntryOrderBySchema = z
  .object({
    date: z.enum(["asc", "desc"]).optional(),
    createdAt: z.enum(["asc", "desc"]).optional(),
    updatedAt: z.enum(["asc", "desc"]).optional(),
    user: z
      .object({
        name: z.enum(["asc", "desc"]).optional(),
      })
      .optional(),
  })
  .partial();

// Base query params schema
export const timeClockEntryQueryBaseSchema = z.object({
  include: timeClockEntryIncludeSchema.optional(),
  where: timeClockEntryWhereSchema.optional(),
  orderBy: timeClockEntryOrderBySchema.optional(),
  skip: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  searchingFor: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  userIds: z.union([z.string(), z.array(z.string())]).optional(),
});

// Query params schema with transform
export const timeClockEntryQuerySchema = timeClockEntryQueryBaseSchema.transform((data) => {
  // Handle searchingFor parameter
  if (data.searchingFor && typeof data.searchingFor === "string") {
    data.where = {
      ...data.where,
      OR: [
        {
          user: {
            name: { contains: data.searchingFor, mode: "insensitive" },
          },
        },
        {
          user: {
            cpf: { contains: data.searchingFor },
          },
        },
      ],
    };
    delete data.searchingFor;
  }

  // Handle date range
  if (data.startDate || data.endDate) {
    data.where = {
      ...data.where,
      date: {
        ...(data.startDate && { gte: data.startDate }),
        ...(data.endDate && { lte: data.endDate }),
      },
    };
    delete data.startDate;
    delete data.endDate;
  }

  // Handle userIds
  if (data.userIds) {
    const userIds = Array.isArray(data.userIds) ? data.userIds : [data.userIds];
    data.where = {
      ...data.where,
      userId: { in: userIds },
    };
    delete data.userIds;
  }

  return data;
});

// Move time entry to another day schema
export const timeClockEntryMoveDaySchema = z.object({
  entryId: z.string().uuid("Registro de ponto inválido"),
  field: z.enum(["entry1", "exit1", "entry2", "exit2", "entry3", "exit3", "entry4", "exit4", "entry5", "exit5"], {
    errorMap: () => ({ message: "Campo inválido" }),
  }),
  dayOffset: z
    .number()
    .int()
    .min(-7)
    .max(7)
    .refine((val) => val !== 0, "O deslocamento deve ser diferente de zero"),
  version: z.string().optional(), // For optimistic locking
});

// Partial adjustment schema
export const timeClockPartialAdjustmentSchema = z.object({
  entryId: z.string().uuid("Registro de ponto inválido"),
  field: z.enum(["entry1", "exit1", "entry2", "exit2", "entry3", "exit3", "entry4", "exit4", "entry5", "exit5"], {
    errorMap: () => ({ message: "Campo inválido" }),
  }),
  time: timeSchema,
  reason: z.string().min(5, "O motivo deve ter pelo menos 5 caracteres"),
});

// Type exports
export type TimeClockEntryCreateFormData = z.infer<typeof timeClockEntryCreateSchema>;
export type TimeClockEntryUpdateFormData = z.infer<typeof timeClockEntryUpdateSchema>;
export type TimeClockEntryBatchUpdateFormData = z.infer<typeof timeClockEntryBatchUpdateSchema>;
export type TimeClockJustificationFormData = z.infer<typeof timeClockJustificationSchema>;
export type TimeClockEntryQueryFormData = z.infer<typeof timeClockEntryQuerySchema>;
export type TimeClockEntryInclude = z.infer<typeof timeClockEntryIncludeSchema>;
export type TimeClockEntryWhere = z.infer<typeof timeClockEntryWhereSchema>;
export type TimeClockEntryOrderBy = z.infer<typeof timeClockEntryOrderBySchema>;
