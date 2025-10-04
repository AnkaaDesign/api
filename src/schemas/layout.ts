// packages/schemas/src/layout.ts

import { z } from "zod";

// =====================
// Layout Section Schema
// =====================

export const layoutSectionCreateSchema = z.object({
  width: z.number().positive("Largura deve ser positiva").max(20, "Largura máxima: 20 metros"),
  isDoor: z.boolean().default(false),
  doorOffset: z.number().min(0, "Espaço superior deve ser positivo").nullable().optional(),
  position: z.number().int().min(0),
}).refine(
  (data) => {
    // If it's a door, doorOffset should have a value
    // If it's not a door, doorOffset should be null
    if (data.isDoor) {
      return data.doorOffset !== null && data.doorOffset !== undefined;
    } else {
      return data.doorOffset === null || data.doorOffset === undefined;
    }
  },
  {
    message: "Porta deve ter espaço superior definido",
    path: ["doorOffset"]
  }
);

export const layoutSectionUpdateSchema = z.object({
  width: z.number().positive("Largura deve ser positiva").max(20, "Largura máxima: 20 metros").optional(),
  isDoor: z.boolean().optional(),
  doorOffset: z.number().min(0, "Espaço superior deve ser positivo").nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// =====================
// CRUD Schemas
// =====================

export const layoutCreateSchema = z.object({
  height: z.number({ required_error: "Altura é obrigatória" }).positive("Altura deve ser positiva").max(10, "Altura deve ser menor que 10 metros"),

  sections: z.array(layoutSectionCreateSchema).min(1, "Deve ter pelo menos uma seção").max(10, "Máximo de 10 seções permitidas"),

  photoId: z.string().uuid("Foto inválida").nullable().optional(),
});

export const layoutUpdateSchema = z.object({
  height: z.number().positive("Altura deve ser positiva").max(10, "Altura deve ser menor que 10 metros").optional(),

  sections: z.array(layoutSectionCreateSchema).min(1, "Deve ter pelo menos uma seção").max(10, "Máximo de 10 seções permitidas").optional(),

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

export function calculateTotalLength(sections: LayoutSectionCreateFormData[]): number {
  return sections.reduce((sum, section) => sum + section.width, 0);
}

export function validateLayoutConsistency(sections: LayoutSectionCreateFormData[], height: number): boolean {
  // All door offsets should be less than height
  return sections.every((s) => !s.isDoor || (s.doorOffset !== null && s.doorOffset !== undefined && s.doorOffset < height));
}
