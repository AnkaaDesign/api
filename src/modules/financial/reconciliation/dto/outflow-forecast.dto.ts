import { z } from 'zod';

/**
 * Query for the composite "Previsão de Saídas" endpoint. `reference` is the
 * competence month (YYYY-MM); defaults to the current month when omitted.
 */
export const outflowForecastQuerySchema = z.object({
  reference: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato YYYY-MM')
    .optional(),
});

export type OutflowForecastQueryDto = z.infer<typeof outflowForecastQuerySchema>;
