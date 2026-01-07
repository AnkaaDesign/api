# Message Content Type System - File Locations

## Created Files

All files have been created in the `/home/kennedy/Documents/repositories/api/src/` directory:

### 1. Core Type Definitions
**Path:** `/home/kennedy/Documents/repositories/api/src/types/message-content.ts`

Contains:
- TypeScript type definitions for all block types
- Inline content types
- Type guards (isHeadingBlock, isParagraphBlock, etc.)
- Builder helpers (MessageContentBuilders)
- Utility functions (extractPlainText, validateMessageContent, etc.)

### 2. Zod Validation Schemas
**Path:** `/home/kennedy/Documents/repositories/api/src/schemas/message-content.ts`

Contains:
- Zod schemas for all types
- Runtime validation functions
- Create/Update schemas for API endpoints
- Schema-based type inference
- Safe parsing utilities

### 3. Usage Examples
**Path:** `/home/kennedy/Documents/repositories/api/src/types/message-content.examples.ts`

Contains:
- 15+ real-world message examples
- Simple to complex use cases
- Helper functions for common patterns
- JSON serialization examples

### 4. React Web Renderer
**Path:** `/home/kennedy/Documents/repositories/api/src/types/message-content.react-renderer.example.tsx`

Contains:
- Complete React component for rendering messages
- Individual block renderers
- Inline content renderer
- Example CSS styles
- Usage examples

### 5. React Native Mobile Renderer
**Path:** `/home/kennedy/Documents/repositories/api/src/types/message-content.react-native-renderer.example.tsx`

Contains:
- Complete React Native component for rendering messages
- StyleSheet definitions
- Platform-specific handling (Linking, Image, etc.)
- Theme support example
- Usage examples

### 6. Documentation
**Path:** `/home/kennedy/Documents/repositories/api/src/types/MESSAGE_CONTENT_README.md`

Contains:
- Complete documentation
- Type reference
- Usage guides
- Best practices
- Extension guide

### 7. Test Examples
**Path:** `/home/kennedy/Documents/repositories/api/src/types/message-content.test.example.ts`

Contains:
- Validation tests
- Builder tests
- Type guard tests
- Text extraction tests
- Serialization tests
- Edge case tests
- Performance tests

## Quick Import Guide

### For Type Definitions
```typescript
import type {
  MessageContent,
  MessageBlock,
  InlineContent,
  HeadingBlock,
  ParagraphBlock,
  // ... other types
} from '@types/message-content';

import {
  MessageContentBuilders,
  createMessageContent,
  validateMessageContent,
  extractPlainText,
  // ... other utilities
} from '@types/message-content';
```

### For Validation
```typescript
import {
  messageContentSchema,
  messageBlockSchema,
  parseMessageContent,
  safeParseMessageContent,
  // ... other schemas
} from '@schemas/message-content';
```

### For Rendering (Web)
```typescript
import { MessageContentRenderer } from '@types/message-content.react-renderer.example';
```

### For Rendering (Mobile)
```typescript
import { MessageContentRenderer } from '@types/message-content.react-native-renderer.example';
```

## Integration Steps

### 1. Update Type Index (Optional)
Add to `/home/kennedy/Documents/repositories/api/src/types/index.ts`:
```typescript
export * from './message-content';
```

### 2. Update Schema Index (Optional)
Add to `/home/kennedy/Documents/repositories/api/src/schemas/index.ts`:
```typescript
export * from './message-content';
```

### 3. Use in Your Application

#### Creating a Message
```typescript
import { MessageContentBuilders, createMessageContent } from '@types/message-content';

const message = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Hello!'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Welcome to our platform.'),
  ]),
]);
```

#### Validating User Input
```typescript
import { safeParseMessageContent } from '@schemas/message-content';

const result = safeParseMessageContent(userInput);
if (result.success) {
  await saveMessage(result.data);
} else {
  return { error: 'Invalid message format' };
}
```

#### Rendering on Web
```typescript
import { MessageContentRenderer } from '@types/message-content.react-renderer.example';

function MessageView({ message }) {
  return <MessageContentRenderer content={message} />;
}
```

#### Rendering on Mobile
```typescript
import { MessageContentRenderer } from '@types/message-content.react-native-renderer.example';

function MessageView({ message }) {
  return <MessageContentRenderer content={message} />;
}
```

## Database Schema Example

If using Prisma, you might add:

```prisma
model Message {
  id        String   @id @default(uuid())
  content   Json     // Stores MessageContent as JSON
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // ... other fields
}
```

When querying:
```typescript
const message = await prisma.message.findUnique({ where: { id } });

// Validate the content
const validated = messageContentSchema.parse(message.content);
```

## Next Steps

1. Review the type definitions in `message-content.ts`
2. Check the examples in `message-content.examples.ts`
3. Adapt the renderers to match your design system
4. Add tests based on `message-content.test.example.ts`
5. Integrate into your API endpoints
6. Add to your frontend components

## Support for Additional Block Types

To add new block types (e.g., code blocks, tables, etc.), follow the extension guide in MESSAGE_CONTENT_README.md.
