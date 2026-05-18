import { z } from 'zod';

export const importStatementSchema = z.object({
  /** Reserved for future multi-account support; currently unused. */
  bankAccountAlias: z.string().optional(),
});

export type ImportStatementDto = z.infer<typeof importStatementSchema>;
