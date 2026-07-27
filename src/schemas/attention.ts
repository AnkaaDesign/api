// api/src/schemas/attention.ts
//
// Validation + shared vocabulary for the Attention / presence system.
//
// Mirrored on the web side in `web/src/lib/attention/types.ts` (same list, same
// order) following this repo's api↔web schema-duplication convention. Keep the two
// in sync — the socket wire is untyped JSON, so a drift here fails silently.

import { z } from 'zod';

/**
 * Entity types the attention + presence system can address.
 *
 * Deliberately an explicit list rather than a free `string`: it is the whitelist the
 * gateway validates against, so a client cannot mint arbitrary presence keys (which
 * would grow the in-memory registry unbounded) or push a warning at an entity type
 * no UI can render.
 *
 * To onboard a new entity: add it here, add it to the web mirror, and declare the
 * entity's descriptor in `web/src/lib/attention/entities.ts`. No gateway change.
 */
export const ATTENTION_ENTITY_TYPES = [
  'TASK',
  'CUT',
  'ORDER',
  'ITEM',
  'AIRBRUSHING',
  'OBSERVATION',
  'SERVICE_ORDER',
  'TASK_QUOTE',
  'TRUCK',
  'CUSTOMER',
  'SUPPLIER',
  'PAINT',
  'USER',
  'BORROW',
  'EXTERNAL_WITHDRAWAL',
  'PPE_DELIVERY',
] as const;

export type AttentionEntityType = (typeof ATTENTION_ENTITY_TYPES)[number];

export const attentionEntityTypeSchema = z.enum(ATTENTION_ENTITY_TYPES);

export function isAttentionEntityType(value: unknown): value is AttentionEntityType {
  return typeof value === 'string' && (ATTENTION_ENTITY_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Socket payloads (validated in the gateway, not by a Nest pipe — @SubscribeMessage
// handlers bypass the global ValidationPipe).
// ---------------------------------------------------------------------------

export const presenceEnterSchema = z.object({
  entityType: attentionEntityTypeSchema,
  entityId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64).optional(),
});

export const presenceLeaveSchema = presenceEnterSchema;

export const entityChangedSchema = z.object({
  entityType: attentionEntityTypeSchema,
  entityId: z.string().min(1).max(64),
  changedFields: z.array(z.string().max(64)).max(200).optional(),
});

export type PresenceEnterInput = z.infer<typeof presenceEnterSchema>;
export type EntityChangedInput = z.infer<typeof entityChangedSchema>;

// ---------------------------------------------------------------------------
// HTTP payloads
// ---------------------------------------------------------------------------

/**
 * `fromUserName` is intentionally ABSENT: the sender's display name is resolved
 * server-side from the authenticated user. Accepting it from the client allowed a
 * warning to be attributed to anyone ("Diretoria").
 */
export const attentionSendWarningSchema = z.object({
  entityType: attentionEntityTypeSchema,
  entityId: z.string().min(1).max(64),
  target: z.discriminatedUnion('level', [
    z.object({ level: z.literal('row') }),
    z.object({ level: z.literal('detail') }),
    z.object({ level: z.literal('field'), field: z.string().min(1).max(64) }),
  ]),
  recipientUserIds: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().max(500).optional(),
  tone: z.enum(['harsh', 'soft', 'none']).optional(),
  blinkCount: z.number().int().min(1).max(20).optional(),
  cooldownMs: z
    .number()
    .int()
    .min(60 * 1000)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  expiresInMs: z
    .number()
    .int()
    .min(1000)
    .max(7 * 24 * 60 * 60 * 1000)
    .optional(),
});

export type AttentionSendWarningFormData = z.infer<typeof attentionSendWarningSchema>;

export const attentionAckUpsertSchema = z.object({
  ruleId: z.string().min(1).max(128),
  entityType: attentionEntityTypeSchema,
  entityId: z.string().min(1).max(64),
  snoozeUntil: z.number().int().nonnegative().nullable().optional(),
  acknowledged: z.boolean().optional(),
  lastFiredAt: z.number().int().nonnegative().nullable().optional(),
});

export type AttentionAckUpsertFormData = z.infer<typeof attentionAckUpsertSchema>;
