// packages/types/src/message-content.ts

/**
 * Comprehensive type system for message content blocks
 * Supports web (React) and mobile (React Native) rendering
 * JSON-serializable and type-safe
 */

// =====================
// Inline Text Formatting Types
// =====================

export type InlineTextStyle = 'bold' | 'italic' | 'code';

export interface InlineLink {
  type: 'link';
  text: string;
  url: string;
}

export interface InlineStyledText {
  type: 'styled';
  text: string;
  styles: InlineTextStyle[];
}

export interface InlinePlainText {
  type: 'text';
  text: string;
}

export type InlineContent = InlinePlainText | InlineStyledText | InlineLink;

// =====================
// Block Types
// =====================

// Heading block (h1, h2, h3)
export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  content: InlineContent[];
}

// Paragraph block with inline formatting
export interface ParagraphBlock {
  type: 'paragraph';
  content: InlineContent[];
}

// Image block
export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

// Button/Link block
export interface ButtonBlock {
  type: 'button';
  text: string;
  url: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

// Divider block
export interface DividerBlock {
  type: 'divider';
}

// List block (ordered or unordered)
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: InlineContent[][];
}

// Quote block
export interface QuoteBlock {
  type: 'quote';
  content: InlineContent[];
  author?: string;
}

// =====================
// Union Type for All Blocks
// =====================

export type MessageBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | ListBlock
  | QuoteBlock;

// =====================
// Message Content Structure
// =====================

export interface MessageContent {
  blocks: MessageBlock[];
  version?: string; // For versioning the content structure
}

// =====================
// Helper Types for Discriminated Unions
// =====================

export type MessageBlockType = MessageBlock['type'];
export type InlineContentType = InlineContent['type'];

// =====================
// Type Guards
// =====================

export function isHeadingBlock(block: MessageBlock): block is HeadingBlock {
  return block.type === 'heading';
}

export function isParagraphBlock(block: MessageBlock): block is ParagraphBlock {
  return block.type === 'paragraph';
}

export function isImageBlock(block: MessageBlock): block is ImageBlock {
  return block.type === 'image';
}

export function isButtonBlock(block: MessageBlock): block is ButtonBlock {
  return block.type === 'button';
}

export function isDividerBlock(block: MessageBlock): block is DividerBlock {
  return block.type === 'divider';
}

export function isListBlock(block: MessageBlock): block is ListBlock {
  return block.type === 'list';
}

export function isQuoteBlock(block: MessageBlock): block is QuoteBlock {
  return block.type === 'quote';
}

export function isInlinePlainText(content: InlineContent): content is InlinePlainText {
  return content.type === 'text';
}

export function isInlineStyledText(content: InlineContent): content is InlineStyledText {
  return content.type === 'styled';
}

export function isInlineLink(content: InlineContent): content is InlineLink {
  return content.type === 'link';
}

// =====================
// Builder Helpers
// =====================

export const MessageContentBuilders = {
  heading: (level: 1 | 2 | 3, content: InlineContent[]): HeadingBlock => ({
    type: 'heading',
    level,
    content,
  }),

  paragraph: (content: InlineContent[]): ParagraphBlock => ({
    type: 'paragraph',
    content,
  }),

  image: (
    url: string,
    options?: {
      alt?: string;
      caption?: string;
      width?: number;
      height?: number;
    },
  ): ImageBlock => ({
    type: 'image',
    url,
    ...options,
  }),

  button: (
    text: string,
    url: string,
    variant?: 'primary' | 'secondary' | 'outline',
  ): ButtonBlock => ({
    type: 'button',
    text,
    url,
    variant,
  }),

  divider: (): DividerBlock => ({
    type: 'divider',
  }),

  list: (ordered: boolean, items: InlineContent[][]): ListBlock => ({
    type: 'list',
    ordered,
    items,
  }),

  quote: (content: InlineContent[], author?: string): QuoteBlock => ({
    type: 'quote',
    content,
    author,
  }),

  text: (text: string): InlinePlainText => ({
    type: 'text',
    text,
  }),

  styled: (text: string, styles: InlineTextStyle[]): InlineStyledText => ({
    type: 'styled',
    text,
    styles,
  }),

  link: (text: string, url: string): InlineLink => ({
    type: 'link',
    text,
    url,
  }),

  bold: (text: string): InlineStyledText => ({
    type: 'styled',
    text,
    styles: ['bold'],
  }),

  italic: (text: string): InlineStyledText => ({
    type: 'styled',
    text,
    styles: ['italic'],
  }),

  code: (text: string): InlineStyledText => ({
    type: 'styled',
    text,
    styles: ['code'],
  }),
};

// =====================
// Utility Functions
// =====================

/**
 * Creates a message content structure from blocks
 */
export function createMessageContent(blocks: MessageBlock[], version = '1.0'): MessageContent {
  return {
    blocks,
    version,
  };
}

/**
 * Validates that a message content structure is well-formed
 */
export function validateMessageContent(content: unknown): content is MessageContent {
  if (!content || typeof content !== 'object') return false;
  const mc = content as MessageContent;
  return Array.isArray(mc.blocks) && mc.blocks.every(validateMessageBlock);
}

/**
 * Validates that a block is well-formed
 */
export function validateMessageBlock(block: unknown): block is MessageBlock {
  if (!block || typeof block !== 'object') return false;
  const b = block as MessageBlock;

  switch (b.type) {
    case 'heading':
      return (
        'level' in b &&
        [1, 2, 3].includes(b.level) &&
        'content' in b &&
        Array.isArray(b.content)
      );
    case 'paragraph':
      return 'content' in b && Array.isArray(b.content);
    case 'image':
      return 'url' in b && typeof b.url === 'string';
    case 'button':
      return (
        'text' in b &&
        typeof b.text === 'string' &&
        'url' in b &&
        typeof b.url === 'string'
      );
    case 'divider':
      return true;
    case 'list':
      return (
        'ordered' in b &&
        typeof b.ordered === 'boolean' &&
        'items' in b &&
        Array.isArray(b.items)
      );
    case 'quote':
      return 'content' in b && Array.isArray(b.content);
    default:
      return false;
  }
}

/**
 * Extracts plain text from inline content (useful for search, previews, etc.)
 */
export function extractPlainText(content: InlineContent[]): string {
  return content.map(item => {
    switch (item.type) {
      case 'text':
      case 'styled':
      case 'link':
        return item.text;
      default:
        return '';
    }
  }).join('');
}

/**
 * Extracts plain text from a block
 */
export function extractBlockText(block: MessageBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return extractPlainText(block.content);
    case 'list':
      return block.items.map(item => extractPlainText(item)).join(' ');
    case 'button':
      return block.text;
    case 'image':
      return block.alt || block.caption || '';
    case 'divider':
      return '';
    default:
      return '';
  }
}

/**
 * Extracts all text from message content
 */
export function extractAllText(content: MessageContent): string {
  return content.blocks.map(extractBlockText).join('\n');
}
