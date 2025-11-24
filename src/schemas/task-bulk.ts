// schemas/task-bulk.ts
// Schemas for bulk task operations

import { z } from 'zod';

// =====================
// Bulk Arts Schema
// =====================
export const taskBulkArtsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tarefa deve ser selecionada'),
  artworkIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma arte deve ser selecionada'),
});

export type TaskBulkArtsFormData = z.infer<typeof taskBulkArtsSchema>;

// =====================
// Bulk Documents Schema
// =====================
export const taskBulkDocumentsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tarefa deve ser selecionada'),
  documentType: z.enum(['budget', 'invoice', 'receipt'], {
    required_error: 'Tipo de documento é obrigatório',
  }),
  documentIds: z.array(z.string().uuid()).min(1, 'Pelo menos um documento deve ser selecionado'),
});

export type TaskBulkDocumentsFormData = z.infer<typeof taskBulkDocumentsSchema>;

// =====================
// Bulk Paints Schema
// =====================
export const taskBulkPaintsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tarefa deve ser selecionada'),
  paintIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tinta deve ser selecionada'),
});

export type TaskBulkPaintsFormData = z.infer<typeof taskBulkPaintsSchema>;

// =====================
// Bulk Cutting Plans Schema
// =====================
export const taskBulkCuttingPlansSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tarefa deve ser selecionada'),
  cutData: z.object({
    fileId: z.string().uuid('ID do arquivo inválido'),
    type: z.string(),
    origin: z.string().optional().default('PLAN'),
    reason: z.string().optional().nullable(),
    quantity: z.number().int().min(1).optional().default(1),
  }),
});

export type TaskBulkCuttingPlansFormData = z.infer<typeof taskBulkCuttingPlansSchema>;

// =====================
// Bulk Operation Response
// =====================
export const bulkOperationResultSchema = z.object({
  success: z.number(),
  failed: z.number(),
  total: z.number(),
  errors: z.array(
    z.object({
      taskId: z.string(),
      error: z.string(),
    })
  ),
});

export type BulkOperationResult = z.infer<typeof bulkOperationResultSchema>;

// =====================
// Bulk File Upload Schema
// =====================
// This schema is for uploading files that will be applied to multiple tasks
// The files are uploaded once and their IDs are added to all selected tasks
export const taskBulkFileUploadSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1, 'Pelo menos uma tarefa deve ser selecionada'),
  fileType: z.enum(['budgets', 'invoices', 'receipts', 'artworks'], {
    required_error: 'Tipo de arquivo é obrigatório',
  }),
});

export type TaskBulkFileUploadFormData = z.infer<typeof taskBulkFileUploadSchema>;
