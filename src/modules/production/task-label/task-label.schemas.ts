import { z } from 'zod';
import { LABEL_SLOTS } from './task-label-sheet';

export const taskLabelPrintSchema = z.object({
  labels: z
    .array(
      z.object({
        slot: z
          .number()
          .int()
          .min(0)
          .max(LABEL_SLOTS.length - 1),
        taskId: z.string().uuid(),
      }),
    )
    .min(1, 'Escolha ao menos uma etiqueta.')
    .max(LABEL_SLOTS.length, `A folha tem ${LABEL_SLOTS.length} espaços.`)
    .refine(labels => new Set(labels.map(l => l.slot)).size === labels.length, {
      message: 'Há dois cartões no mesmo espaço da folha.',
    }),
});

export type TaskLabelPrintFormData = z.infer<typeof taskLabelPrintSchema>;
