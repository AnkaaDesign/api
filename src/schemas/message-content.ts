// packages/schemas/src/message-content.ts

import { z } from 'zod';

// =====================
// Inline Text Formatting Schemas
// =====================

export const inlineTextStyleSchema = z.enum(['bold', 'italic', 'code']);

export const inlinePlainTextSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const inlineStyledTextSchema = z.object({
  type: z.literal('styled'),
  text: z.string(),
  styles: z.array(inlineTextStyleSchema).min(1, 'Pelo menos um estilo deve ser fornecido'),
});

export const inlineLinkSchema = z.object({
  type: z.literal('link'),
  text: z.string().min(1, 'Texto do link não pode ser vazio'),
  url: z.string().url('URL inválida'),
});

export const inlineContentSchema = z.discriminatedUnion('type', [
  inlinePlainTextSchema,
  inlineStyledTextSchema,
  inlineLinkSchema,
]);

// =====================
// Block Type Schemas
// =====================

export const headingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  content: z.array(inlineContentSchema).min(1, 'Conteúdo do título não pode ser vazio'),
});

export const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  content: z.array(inlineContentSchema).min(1, 'Conteúdo do parágrafo não pode ser vazio'),
});

export const imageBlockSchema = z.object({
  type: z.literal('image'),
  url: z.string().url('URL da imagem inválida'),
  alt: z.string().optional(),
  caption: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export const buttonBlockSchema = z.object({
  type: z.literal('button'),
  text: z.string().min(1, 'Texto do botão não pode ser vazio'),
  url: z.string().url('URL do botão inválida'),
  variant: z.enum(['primary', 'secondary', 'outline']).optional(),
});

export const dividerBlockSchema = z.object({
  type: z.literal('divider'),
});

export const listBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z
    .array(z.array(inlineContentSchema).min(1, 'Item da lista não pode ser vazio'))
    .min(1, 'Lista deve ter pelo menos um item'),
});

export const quoteBlockSchema = z.object({
  type: z.literal('quote'),
  content: z.array(inlineContentSchema).min(1, 'Conteúdo da citação não pode ser vazio'),
  author: z.string().optional(),
});

// =====================
// Message Block Union Schema
// =====================

export const messageBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  paragraphBlockSchema,
  imageBlockSchema,
  buttonBlockSchema,
  dividerBlockSchema,
  listBlockSchema,
  quoteBlockSchema,
]);

// =====================
// Message Content Schema
// =====================

export const messageContentSchema = z.object({
  blocks: z.array(messageBlockSchema).min(1, 'Mensagem deve ter pelo menos um bloco de conteúdo'),
  version: z.string().default('1.0').optional(),
});

// =====================
// Creation Schemas (for API endpoints)
// =====================

export const createMessageContentSchema = z.object({
  blocks: z
    .array(messageBlockSchema)
    .min(1, 'Mensagem deve ter pelo menos um bloco de conteúdo')
    .max(100, 'Mensagem não pode ter mais de 100 blocos'),
  version: z.string().optional(),
});

export const updateMessageContentSchema = z.object({
  blocks: z
    .array(messageBlockSchema)
    .min(1, 'Mensagem deve ter pelo menos um bloco de conteúdo')
    .max(100, 'Mensagem não pode ter mais de 100 blocos')
    .optional(),
  version: z.string().optional(),
});

// =====================
// Individual Block Creation Schemas
// =====================

export const createHeadingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  content: z
    .array(inlineContentSchema)
    .min(1, 'Conteúdo do título não pode ser vazio')
    .max(50, 'Título não pode ter mais de 50 elementos inline'),
});

export const createParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  content: z
    .array(inlineContentSchema)
    .min(1, 'Conteúdo do parágrafo não pode ser vazio')
    .max(200, 'Parágrafo não pode ter mais de 200 elementos inline'),
});

export const createImageBlockSchema = z.object({
  type: z.literal('image'),
  url: z.string().url('URL da imagem inválida'),
  alt: z.string().max(200, 'Texto alternativo muito longo').optional(),
  caption: z.string().max(500, 'Legenda muito longa').optional(),
  width: z.number().positive('Largura deve ser positiva').optional(),
  height: z.number().positive('Altura deve ser positiva').optional(),
});

export const createButtonBlockSchema = z.object({
  type: z.literal('button'),
  text: z
    .string()
    .min(1, 'Texto do botão não pode ser vazio')
    .max(100, 'Texto do botão muito longo'),
  url: z.string().url('URL do botão inválida'),
  variant: z.enum(['primary', 'secondary', 'outline']).default('primary').optional(),
});

export const createListBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean().default(false),
  items: z
    .array(
      z
        .array(inlineContentSchema)
        .min(1, 'Item da lista não pode ser vazio')
        .max(100, 'Item da lista não pode ter mais de 100 elementos inline'),
    )
    .min(1, 'Lista deve ter pelo menos um item')
    .max(50, 'Lista não pode ter mais de 50 itens'),
});

export const createQuoteBlockSchema = z.object({
  type: z.literal('quote'),
  content: z
    .array(inlineContentSchema)
    .min(1, 'Conteúdo da citação não pode ser vazio')
    .max(100, 'Citação não pode ter mais de 100 elementos inline'),
  author: z.string().max(100, 'Nome do autor muito longo').optional(),
});

// =====================
// Inline Content Creation Schemas
// =====================

export const createInlinePlainTextSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1, 'Texto não pode ser vazio').max(5000, 'Texto muito longo'),
});

export const createInlineStyledTextSchema = z.object({
  type: z.literal('styled'),
  text: z.string().min(1, 'Texto não pode ser vazio').max(5000, 'Texto muito longo'),
  styles: z
    .array(inlineTextStyleSchema)
    .min(1, 'Pelo menos um estilo deve ser fornecido')
    .max(3, 'No máximo 3 estilos podem ser aplicados')
    .refine(arr => new Set(arr).size === arr.length, {
      message: 'Estilos não podem se repetir',
    }),
});

export const createInlineLinkSchema = z.object({
  type: z.literal('link'),
  text: z.string().min(1, 'Texto do link não pode ser vazio').max(500, 'Texto do link muito longo'),
  url: z.string().url('URL inválida').max(2000, 'URL muito longa'),
});

// =====================
// Validation Schemas
// =====================

// Schema for validating entire message content with strict limits
export const validateMessageContentSchema = messageContentSchema.refine(
  data => {
    // Count total inline content elements across all blocks
    let totalInlineElements = 0;
    for (const block of data.blocks) {
      if ('content' in block && Array.isArray(block.content)) {
        totalInlineElements += block.content.length;
      }
      if (block.type === 'list') {
        for (const item of block.items) {
          totalInlineElements += item.length;
        }
      }
    }
    return totalInlineElements <= 1000;
  },
  {
    message: 'Mensagem muito complexa: limite de 1000 elementos inline excedido',
  },
);

// =====================
// Inferred Types
// =====================

export type InlineTextStyle = z.infer<typeof inlineTextStyleSchema>;
export type InlinePlainText = z.infer<typeof inlinePlainTextSchema>;
export type InlineStyledText = z.infer<typeof inlineStyledTextSchema>;
export type InlineLink = z.infer<typeof inlineLinkSchema>;
export type InlineContent = z.infer<typeof inlineContentSchema>;

export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type ButtonBlock = z.infer<typeof buttonBlockSchema>;
export type DividerBlock = z.infer<typeof dividerBlockSchema>;
export type ListBlock = z.infer<typeof listBlockSchema>;
export type QuoteBlock = z.infer<typeof quoteBlockSchema>;

export type MessageBlock = z.infer<typeof messageBlockSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;

export type CreateMessageContentFormData = z.infer<typeof createMessageContentSchema>;
export type UpdateMessageContentFormData = z.infer<typeof updateMessageContentSchema>;

// =====================
// Helper Functions for Schema Validation
// =====================

/**
 * Validates and parses message content
 */
export function parseMessageContent(data: unknown): MessageContent {
  return messageContentSchema.parse(data);
}

/**
 * Safely validates message content without throwing
 */
export function safeParseMessageContent(data: unknown): {
  success: boolean;
  data?: MessageContent;
  error?: z.ZodError;
} {
  const result = messageContentSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validates a single message block
 */
export function parseMessageBlock(data: unknown): MessageBlock {
  return messageBlockSchema.parse(data);
}

/**
 * Safely validates a single message block without throwing
 */
export function safeParseMessageBlock(data: unknown): {
  success: boolean;
  data?: MessageBlock;
  error?: z.ZodError;
} {
  const result = messageBlockSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Validates inline content
 */
export function parseInlineContent(data: unknown): InlineContent {
  return inlineContentSchema.parse(data);
}

/**
 * Safely validates inline content without throwing
 */
export function safeParseInlineContent(data: unknown): {
  success: boolean;
  data?: InlineContent;
  error?: z.ZodError;
} {
  const result = inlineContentSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
