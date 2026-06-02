import { z } from 'zod';

// =====================================================================
// WasteCertificate — Zod validation schemas (API)
// The create endpoint is multipart (generated PDF + metadata fields), so
// scalar fields arrive as strings and are coerced here.
// =====================================================================

export const wasteCertificateCreateSchema = z
  .object({
    date: z.coerce.date(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    description: z.string().trim().min(1, 'Descrição é obrigatória.'),
    volume: z.string().trim().min(1, 'Volume é obrigatório.'),
  })
  .refine((d) => d.periodEnd >= d.periodStart, {
    message: 'A data final do período deve ser maior ou igual à inicial.',
    path: ['periodEnd'],
  });

export const wasteCertificateUpdateSchema = z
  .object({
    date: z.coerce.date().optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    description: z.string().trim().min(1).optional(),
    volume: z.string().trim().min(1).optional(),
  })
  .partial();

const orderByDirection = z.enum(['asc', 'desc']);

// Only allow sorting on real scalar columns of the table.
const ORDERABLE_FIELDS = [
  'date',
  'periodStart',
  'periodEnd',
  'description',
  'volume',
  'status',
  'createdAt',
] as const;

export const wasteCertificateGetManySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  searchingFor: z.string().trim().optional(),
  status: z.enum(['GENERATED', 'SIGNED']).optional(),
  orderBy: z
    .record(z.enum(ORDERABLE_FIELDS), orderByDirection)
    .optional(),
});

export const wasteCertificateQuerySchema = z.object({
  include: z.any().optional(),
});

export type WasteCertificateCreateFormData = z.infer<typeof wasteCertificateCreateSchema>;
export type WasteCertificateUpdateFormData = z.infer<typeof wasteCertificateUpdateSchema>;
export type WasteCertificateGetManyFormData = z.infer<typeof wasteCertificateGetManySchema>;
