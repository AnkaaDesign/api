// packages/schemas/src/implementMeasure.ts

import { z } from 'zod';

// =====================
// ImplementMeasure Section Schema
// =====================

export const implementMeasureSectionCreateSchema = z
  .object({
    width: z.number().positive('Largura deve ser positiva').max(20, 'Largura máxima: 20 metros'),
    isDoor: z.boolean().default(false),
    doorHeight: z.number().min(0, 'Altura da porta deve ser positiva').nullable().optional(),
    position: z.number().int().min(0),
  })
  .refine(
    data => {
      // If it's a door, doorHeight should have a value
      // If it's not a door, doorHeight should be null
      if (data.isDoor) {
        return data.doorHeight !== null && data.doorHeight !== undefined;
      } else {
        return data.doorHeight === null || data.doorHeight === undefined;
      }
    },
    {
      message: 'Porta deve ter altura definida',
      path: ['doorHeight'],
    },
  );

export const implementMeasureSectionUpdateSchema = z.object({
  width: z
    .number()
    .positive('Largura deve ser positiva')
    .max(20, 'Largura máxima: 20 metros')
    .optional(),
  isDoor: z.boolean().optional(),
  doorHeight: z.number().min(0, 'Altura da porta deve ser positiva').nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// =====================
// CRUD Schemas
// =====================

export const implementMeasureCreateSchema = z.object({
  height: z
    .number({ required_error: 'Altura é obrigatória' })
    .positive('Altura deve ser positiva')
    .max(10, 'Altura deve ser menor que 10 metros'),

  sections: z
    .array(implementMeasureSectionCreateSchema)
    .min(1, 'Deve ter pelo menos uma seção')
    .max(10, 'Máximo de 10 seções permitidas'),

  photoId: z.string().uuid('Foto inválida').nullable().optional(),
});

export const implementMeasureUpdateSchema = z.object({
  height: z
    .number()
    .positive('Altura deve ser positiva')
    .max(10, 'Altura deve ser menor que 10 metros')
    .optional(),

  sections: z
    .array(implementMeasureSectionCreateSchema)
    .min(1, 'Deve ter pelo menos uma seção')
    .max(10, 'Máximo de 10 seções permitidas')
    .optional(),

  photoId: z.string().uuid('Foto inválida').nullable().optional(),
});

// =====================
// A face embutida no caminhão da tarefa (`leftSideMeasure`, `rightSideMeasure`,
// `backSideMeasure` dentro do objeto do caminhão de `POST/PUT /tasks` e dos lotes)
// =====================
//
// FONTE ÚNICA: `schemas/task.ts` importa daqui (antes tinha uma cópia própria).
//
// ⚠️ É MAIS FROUXA que `implementMeasureCreateSchema` DE PROPÓSITO, e continua
// assim na Fase A do rework do implemento: nenhum cliente instalado (web em
// produção, app 1.4.1) pode passar a levar 400 num salvamento que hoje passa.
// As diferenças, medidas contra o schema do módulo:
//   - largura da seção sem o teto de 20 m; altura sem o teto de 10 m;
//   - sem a regra "porta ⇒ altura da porta, e só porta tem altura";
//   - lista de seções pode vir VAZIA (o escritor trata vazia como "manter as
//     seções atuais" numa edição);
//   - aceita `id` na face e na seção (o formulário devolve o que leu).
// O aperto entra com a frente e a porta traseira (P11), junto com os clientes.
export const implementMeasureFaceSectionInputSchema = z.object({
  id: z.string().uuid().optional(), // Existing section ID for updates
  width: z.number().positive(),
  isDoor: z.boolean(),
  doorHeight: z.number().nullable(),
  position: z.number(),
});

export const implementMeasureFaceInputSchema = z
  .object({
    id: z.string().uuid().optional(), // Existing implementMeasure ID for updates
    height: z.number().positive(),
    sections: z.array(implementMeasureFaceSectionInputSchema),
    photoId: z.string().uuid().nullable().optional(),
  })
  .nullable()
  .optional();

// =====================
// Type Inference
// =====================

export type ImplementMeasureSectionCreateFormData = z.infer<typeof implementMeasureSectionCreateSchema>;
export type ImplementMeasureSectionUpdateFormData = z.infer<typeof implementMeasureSectionUpdateSchema>;
export type ImplementMeasureCreateFormData = z.infer<typeof implementMeasureCreateSchema>;
export type ImplementMeasureUpdateFormData = z.infer<typeof implementMeasureUpdateSchema>;
export type ImplementMeasureFaceInputFormData = z.infer<typeof implementMeasureFaceInputSchema>;

// =====================
// Helper Functions
// =====================

export function calculateTotalLength(sections: ImplementMeasureSectionCreateFormData[]): number {
  return sections.reduce((sum, section) => sum + section.width, 0);
}

export function validateImplementMeasureConsistency(
  sections: ImplementMeasureSectionCreateFormData[],
  height: number,
): boolean {
  // All door heights should be less than or equal to implementMeasure height
  return sections.every(
    s =>
      !s.isDoor || (s.doorHeight !== null && s.doorHeight !== undefined && s.doorHeight <= height),
  );
}
