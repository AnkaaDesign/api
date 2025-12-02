import { z } from 'zod';
import { HOLIDAY_TYPE } from '@constants';

/**
 * Schema for creating a new holiday in Secullum
 * Based on the API request: { "Data": "2025-06-07", "Descricao": "Teste", "Tipo": "NATIONAL" }
 */
export const secullumCreateHolidaySchema = z.object({
  Data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
    .refine(date => {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime());
    }, 'Data deve ser uma data válida')
    .refine(date => {
      const parsed = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return parsed >= today;
    }, 'Data não pode ser no passado')
    .refine(date => {
      const parsed = new Date(date);
      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 10);
      return parsed <= maxDate;
    }, 'Data não pode ser superior a 10 anos no futuro'),

  Descricao: z
    .string()
    .min(1, 'Descrição é obrigatória')
    .max(100, 'Descrição deve ter no máximo 100 caracteres')
    .transform(val => val.trim())
    .refine(val => val.length > 0, 'Descrição não pode ser vazia'),

  Tipo: z
    .enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]], {
      required_error: 'Tipo de feriado é obrigatório',
      invalid_type_error: 'Tipo de feriado inválido',
    })
    .optional()
    .default(HOLIDAY_TYPE.NATIONAL),
});

export type SecullumCreateHolidayFormData = z.infer<typeof secullumCreateHolidaySchema>;

/**
 * Schema for the holiday response from Secullum API
 */
export const secullumHolidaySchema = z.object({
  Id: z.number(),
  Data: z.string(),
  Descricao: z.string(),
  Tipo: z.enum(Object.values(HOLIDAY_TYPE) as [string, ...string[]]).optional(),
});

export type SecullumHolidayData = z.infer<typeof secullumHolidaySchema>;

/**
 * Schema for holiday creation API response
 */
export const secullumCreateHolidayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: secullumHolidaySchema.optional(),
});

export type SecullumCreateHolidayResponse = z.infer<typeof secullumCreateHolidayResponseSchema>;

/**
 * Schema for holiday deletion API response
 */
export const secullumDeleteHolidayResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SecullumDeleteHolidayResponse = z.infer<typeof secullumDeleteHolidayResponseSchema>;
