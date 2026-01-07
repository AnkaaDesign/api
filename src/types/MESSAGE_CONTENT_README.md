# Message Content Type System

A comprehensive, type-safe, and JSON-serializable type system for rich message content that works seamlessly on both web (React) and mobile (React Native) platforms.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Type Definitions](#type-definitions)
- [Zod Schemas](#zod-schemas)
- [Usage Examples](#usage-examples)
- [Rendering](#rendering)
- [Validation](#validation)
- [Best Practices](#best-practices)

## Overview

This type system provides a structured way to create, validate, and render rich message content with support for:

- Headings (h1, h2, h3)
- Paragraphs with inline formatting (bold, italic, code)
- Images with captions
- Buttons/Links
- Dividers
- Ordered and unordered lists
- Quotes with optional attribution

## Features

- **Type-safe**: Full TypeScript support with discriminated unions
- **JSON-serializable**: Can be stored in databases or sent over APIs
- **Validated**: Comprehensive Zod schemas for runtime validation
- **Cross-platform**: Works on React (web) and React Native (mobile)
- **Extensible**: Easy to add new block types
- **Developer-friendly**: Builder helpers and type guards included

## Installation

The types and schemas are available at:

```typescript
// Types
import type { MessageContent, MessageBlock, InlineContent } from './types/message-content';

// Zod schemas
import { messageContentSchema, messageBlockSchema } from './schemas/message-content';

// Builder helpers
import { MessageContentBuilders, createMessageContent } from './types/message-content';
```

## Type Definitions

### Core Types

#### MessageContent

The root structure for message content:

```typescript
interface MessageContent {
  blocks: MessageBlock[];
  version?: string; // For versioning the content structure
}
```

#### MessageBlock

A discriminated union of all supported block types:

```typescript
type MessageBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | ListBlock
  | QuoteBlock;
```

#### InlineContent

Content within text blocks (paragraphs, headings, etc.):

```typescript
type InlineContent = InlinePlainText | InlineStyledText | InlineLink;
```

### Block Types

#### HeadingBlock

```typescript
interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  content: InlineContent[];
}
```

#### ParagraphBlock

```typescript
interface ParagraphBlock {
  type: 'paragraph';
  content: InlineContent[];
}
```

#### ImageBlock

```typescript
interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}
```

#### ButtonBlock

```typescript
interface ButtonBlock {
  type: 'button';
  text: string;
  url: string;
  variant?: 'primary' | 'secondary' | 'outline';
}
```

#### DividerBlock

```typescript
interface DividerBlock {
  type: 'divider';
}
```

#### ListBlock

```typescript
interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: InlineContent[][];
}
```

#### QuoteBlock

```typescript
interface QuoteBlock {
  type: 'quote';
  content: InlineContent[];
  author?: string;
}
```

### Inline Content Types

#### InlinePlainText

```typescript
interface InlinePlainText {
  type: 'text';
  text: string;
}
```

#### InlineStyledText

```typescript
interface InlineStyledText {
  type: 'styled';
  text: string;
  styles: ('bold' | 'italic' | 'code')[];
}
```

#### InlineLink

```typescript
interface InlineLink {
  type: 'link';
  text: string;
  url: string;
}
```

## Zod Schemas

All types have corresponding Zod schemas for validation:

```typescript
import { messageContentSchema } from './schemas/message-content';

// Validate message content
const result = messageContentSchema.safeParse(data);

if (result.success) {
  const validContent = result.data;
}
```

Available schemas:

- `messageContentSchema` - Main message content
- `messageBlockSchema` - Individual blocks
- `inlineContentSchema` - Inline content
- `createMessageContentSchema` - For API creation endpoints
- `updateMessageContentSchema` - For API update endpoints

## Usage Examples

### Simple Text Message

```typescript
import { MessageContentBuilders, createMessageContent } from './types/message-content';

const message = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Hello, world!'),
  ]),
]);
```

### Formatted Text

```typescript
const formattedMessage = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('This text has '),
    MessageContentBuilders.bold('bold'),
    MessageContentBuilders.text(', '),
    MessageContentBuilders.italic('italic'),
    MessageContentBuilders.text(', and '),
    MessageContentBuilders.code('code'),
    MessageContentBuilders.text(' formatting.'),
  ]),
]);
```

### Rich Content Message

```typescript
const richMessage = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Welcome!'),
  ]),

  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('We are excited to have you here.'),
  ]),

  MessageContentBuilders.image('https://example.com/image.jpg', {
    alt: 'Welcome image',
    caption: 'Join our community',
  }),

  MessageContentBuilders.list(false, [
    [MessageContentBuilders.text('Fast and reliable')],
    [MessageContentBuilders.text('Easy to use')],
    [MessageContentBuilders.text('Secure by default')],
  ]),

  MessageContentBuilders.divider(),

  MessageContentBuilders.button('Get Started', 'https://example.com/signup', 'primary'),
]);
```

### Using Helper Functions

```typescript
// Simple message
const simple = createSimpleMessage('Hello, world!');

// Message with title and body
const titled = createTitledMessage(
  'New Feature',
  'Check out our latest update!'
);

// Message with action
const action = createActionMessage(
  'Upgrade Available',
  'A new version is ready to install.',
  'Update Now',
  'https://example.com/update'
);
```

## Rendering

### React (Web)

```typescript
import { MessageContentRenderer } from './types/message-content.react-renderer.example';

function MessageView({ content }: { content: MessageContent }) {
  return <MessageContentRenderer content={content} />;
}
```

### React Native (Mobile)

```typescript
import { MessageContentRenderer } from './types/message-content.react-native-renderer.example';

function MessageView({ content }: { content: MessageContent }) {
  return <MessageContentRenderer content={content} />;
}
```

Both renderers support:
- All block types
- Inline formatting
- Links (with proper handling)
- Images with lazy loading
- Accessible markup
- Customizable styles

## Validation

### Runtime Validation

```typescript
import { parseMessageContent, safeParseMessageContent } from './schemas/message-content';

// Throws error if invalid
const validated = parseMessageContent(untrustedData);

// Safe parsing
const result = safeParseMessageContent(untrustedData);
if (result.success) {
  console.log('Valid:', result.data);
} else {
  console.error('Invalid:', result.error);
}
```

### Type Guards

```typescript
import {
  isHeadingBlock,
  isParagraphBlock,
  isImageBlock,
  // ... other guards
} from './types/message-content';

if (isHeadingBlock(block)) {
  console.log('Heading level:', block.level);
}
```

### Validation Functions

```typescript
import {
  validateMessageContent,
  validateMessageBlock,
  extractPlainText,
  extractAllText,
} from './types/message-content';

// Check if content is well-formed
if (validateMessageContent(data)) {
  // Safe to use
}

// Extract text for search/preview
const preview = extractAllText(content);
```

## Best Practices

### 1. Use Builder Helpers

Instead of manually creating objects:

```typescript
// ✅ Good
const content = MessageContentBuilders.paragraph([
  MessageContentBuilders.bold('Important:'),
  MessageContentBuilders.text(' Please read carefully.'),
]);

// ❌ Avoid
const content = {
  type: 'paragraph',
  content: [
    { type: 'styled', text: 'Important:', styles: ['bold'] },
    { type: 'text', text: ' Please read carefully.' },
  ],
};
```

### 2. Validate User Input

Always validate content from untrusted sources:

```typescript
const result = safeParseMessageContent(userInput);
if (!result.success) {
  return { error: 'Invalid message format' };
}
```

### 3. Keep Messages Simple

- Limit nesting depth
- Use the validators to enforce limits
- Consider mobile screen sizes

### 4. Accessibility

- Always provide `alt` text for images
- Use semantic heading levels (h1 → h2 → h3)
- Ensure sufficient color contrast in renderers

### 5. Performance

- Use lazy loading for images
- Consider virtualization for long message lists
- Extract plain text for search indexes

### 6. JSON Storage

The types are fully JSON-serializable:

```typescript
// Store in database
const json = JSON.stringify(messageContent);
await db.messages.create({ content: json });

// Retrieve from database
const stored = await db.messages.findOne(id);
const content = JSON.parse(stored.content) as MessageContent;

// Validate after parsing
const validated = messageContentSchema.parse(content);
```

## Extending the System

To add a new block type:

1. Add the interface in `message-content.ts`:
```typescript
export interface CodeBlock {
  type: 'code';
  language: string;
  code: string;
}
```

2. Add to the union type:
```typescript
export type MessageBlock =
  | HeadingBlock
  | CodeBlock  // Add here
  | // ... other types
```

3. Add Zod schema in `message-content.ts`:
```typescript
export const codeBlockSchema = z.object({
  type: z.literal('code'),
  language: z.string(),
  code: z.string(),
});
```

4. Update the discriminated union:
```typescript
export const messageBlockSchema = z.discriminatedUnion('type', [
  // ... existing schemas
  codeBlockSchema,
]);
```

5. Add renderer for both platforms

## License

This type system is part of the Ankaa project.
