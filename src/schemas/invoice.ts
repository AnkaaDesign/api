import { z } from 'zod';
import {
  INVOICE_STATUS,
  INSTALLMENT_STATUS,
} from '../constants/enums';
import {
  paginationSchema,
  orderByDirectionSchema,
} from './common';

// =====================
// Enum Schemas
// =====================

export const invoiceStatusSchema = z.nativeEnum(INVOICE_STATUS);
export const installmentStatusSchema = z.nativeEnum(INSTALLMENT_STATUS);

// =====================
// Include Schema
// =====================

export const invoiceIncludeSchema = z
  .object({
    installments: z
      .union([
        z.boolean(),
        z.object({
          include: z
            .object({
              bankSlip: z
                .union([
                  z.boolean(),
                  z.object({
                    include: z
                      .object({ pdfFile: z.boolean().optional() })
                      .optional(),
                  }),
                ])
                .optional(),
            })
            .optional(),
        }),
      ])
      .optional(),
    nfseDocuments: z.boolean().optional(),
    customer: z.boolean().optional(),
    task: z.boolean().optional(),
    createdBy: z.boolean().optional(),
    customerConfig: z.boolean().optional(),
  })
  .optional();

// =====================
// OrderBy Schema
// =====================

export const invoiceOrderBySchema = z
  .object({
    createdAt: orderByDirectionSchema.optional(),
    totalAmount: orderByDirectionSchema.optional(),
    status: orderByDirectionSchema.optional(),
    paidAmount: orderByDirectionSchema.optional(),
  })
  .optional();

// =====================
// Where Schema
// =====================

export const invoiceWhereSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    status: z
      .union([invoiceStatusSchema, z.array(invoiceStatusSchema)])
      .optional(),
    createdById: z.string().uuid().optional(),
  })
  .optional();

// =====================
// GetMany Schema
// =====================

export const invoiceGetManySchema = z.object({
  ...paginationSchema.shape,
  orderBy: invoiceOrderBySchema,
  where: invoiceWhereSchema,
  include: invoiceIncludeSchema,
  taskId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z
    .union([invoiceStatusSchema, z.array(invoiceStatusSchema)])
    .optional(),
});

export type InvoiceGetManyFormData = z.infer<typeof invoiceGetManySchema>;

// =====================
// Cancel Schema
// =====================

export const invoiceCancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type InvoiceCancelFormData = z.infer<typeof invoiceCancelSchema>;
