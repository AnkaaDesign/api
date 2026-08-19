import { z } from 'zod';

/**
 * "Marcar como resolvido" — a linha do extrato que a categoria explica e que não
 * tem obrigação nem documento a vincular.
 *
 * O motivo é OPCIONAL (diferente de "Ignorar", que exige um): ignorar tira a
 * linha do escopo da conciliação e isso precisa ser justificado; aqui o
 * pagamento continua no escopo, contabilizado pela sua categoria — o que se
 * declara é apenas que não existe conta nem nota por trás dele.
 */
export const acknowledgeSettlementSchema = z.object({
  acknowledged: z.boolean().default(true),
  note: z.string().trim().max(500).optional().nullable(),
});

export type AcknowledgeSettlementDto = z.infer<typeof acknowledgeSettlementSchema>;
