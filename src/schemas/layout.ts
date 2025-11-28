// packages/schemas/src/layout.ts

import { z } from "zod";

// =====================
// Layout Section Schema
// =====================

export const layoutSectionCreateSchema = z.object({
  width: z.number().positive("Largura deve ser positiva").max(20, "Largura máxima: 20 metros"),
  isDoor: z.boolean().default(false),
  doorHeight: z.number().min(0, "Altura da porta deve ser positiva").nullable().optional(),
  position: z.number().int().min(0),
}).refine(
  (data) => {
    // If it's a door, doorHeight should have a value
    // If it's not a door, doorHeight should be null
    if (data.isDoor) {
      return data.doorHeight !== null && data.doorHeight !== undefined;
    } else {
      return data.doorHeight === null || data.doorHeight === undefined;
    }
  },
  {
    message: "Porta deve ter altura definida",
    path: ["doorHeight"]
  }
);

export const layoutSectionUpdateSchema = z.object({
  width: z.number().positive("Largura deve ser positiva").max(20, "Largura máxima: 20 metros").optional(),
  isDoor: z.boolean().optional(),
  doorHeight: z.number().min(0, "Altura da porta deve ser positiva").nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// =====================
// CRUD Schemas
// =====================

export const layoutCreateSchema = z.object({
  height: z.number({ required_error: "Altura é obrigatória" }).positive("Altura deve ser positiva").max(10, "Altura deve ser menor que 10 metros"),

  layoutSections: z.array(layoutSectionCreateSchema).min(1, "Deve ter pelo menos uma seção").max(10, "Máximo de 10 seções permitidas"),

  photoId: z.string().uuid("Foto inválida").nullable().optional(),
});

export const layoutUpdateSchema = z.object({
  height: z.number().positive("Altura deve ser positiva").max(10, "Altura deve ser menor que 10 metros").optional(),

  layoutSections: z.array(layoutSectionCreateSchema).min(1, "Deve ter pelo menos uma seção").max(10, "Máximo de 10 seções permitidas").optional(),

  photoId: z.string().uuid("Foto inválida").nullable().optional(),
});

// =====================
// Type Inference
// =====================

export type LayoutSectionCreateFormData = z.infer<typeof layoutSectionCreateSchema>;
export type LayoutSectionUpdateFormData = z.infer<typeof layoutSectionUpdateSchema>;
export type LayoutCreateFormData = z.infer<typeof layoutCreateSchema>;
export type LayoutUpdateFormData = z.infer<typeof layoutUpdateSchema>;

// =====================
// Helper Functions
// =====================

export function calculateTotalLength(layoutSections: LayoutSectionCreateFormData[]): number {
  return layoutSections.reduce((sum, section) => sum + section.width, 0);
}

export function validateLayoutConsistency(layoutSections: LayoutSectionCreateFormData[], height: number): boolean {
  // All door heights should be less than or equal to layout height
  return layoutSections.every((s) => !s.isDoor || (s.doorHeight !== null && s.doorHeight !== undefined && s.doorHeight <= height));
}
