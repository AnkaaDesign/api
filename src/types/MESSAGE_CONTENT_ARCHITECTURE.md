# Message Content Type System Architecture

## Type Hierarchy

```
MessageContent
├── blocks: MessageBlock[]
└── version?: string

MessageBlock (Discriminated Union)
├── HeadingBlock
│   ├── type: "heading"
│   ├── level: 1 | 2 | 3
│   └── content: InlineContent[]
│
├── ParagraphBlock
│   ├── type: "paragraph"
│   └── content: InlineContent[]
│
├── ImageBlock
│   ├── type: "image"
│   ├── url: string
│   ├── alt?: string
│   ├── caption?: string
│   ├── width?: number
│   └── height?: number
│
├── ButtonBlock
│   ├── type: "button"
│   ├── text: string
│   ├── url: string
│   └── variant?: "primary" | "secondary" | "outline"
│
├── DividerBlock
│   └── type: "divider"
│
├── ListBlock
│   ├── type: "list"
│   ├── ordered: boolean
│   └── items: InlineContent[][]
│
└── QuoteBlock
    ├── type: "quote"
    ├── content: InlineContent[]
    └── author?: string

InlineContent (Discriminated Union)
├── InlinePlainText
│   ├── type: "text"
│   └── text: string
│
├── InlineStyledText
│   ├── type: "styled"
│   ├── text: string
│   └── styles: ("bold" | "italic" | "code")[]
│
└── InlineLink
    ├── type: "link"
    ├── text: string
    └── url: string
```

## Data Flow

```
User Input
    ↓
[Validation Layer]
    ↓ (Zod Schema)
MessageContent (Validated)
    ↓
[Storage Layer]
    ↓ (JSON)
Database
    ↓
[Retrieval Layer]
    ↓ (Parse & Validate)
MessageContent (Type-safe)
    ↓
[Rendering Layer]
    ↓
Web (React) ←→ Mobile (React Native)
```

## Component Architecture

### Web (React)
```
MessageContentRenderer
    ↓
MessageBlockRenderer
    ├── HeadingRenderer
    │   └── InlineContentRenderer
    ├── ParagraphRenderer
    │   └── InlineContentRenderer
    ├── ImageRenderer
    ├── ButtonRenderer
    ├── DividerRenderer
    ├── ListRenderer
    │   └── InlineContentRenderer (per item)
    └── QuoteRenderer
        └── InlineContentRenderer
```

### Mobile (React Native)
```
MessageContentRenderer
    ↓
MessageBlockRenderer
    ├── HeadingRenderer
    │   └── InlineContentRenderer
    ├── ParagraphRenderer
    │   └── InlineContentRenderer
    ├── ImageRenderer
    ├── ButtonRenderer (with Linking)
    ├── DividerRenderer
    ├── ListRenderer
    │   └── InlineContentRenderer (per item)
    └── QuoteRenderer
        └── InlineContentRenderer
```

## Validation Flow

```
Raw Input (unknown)
    ↓
safeParseMessageContent()
    ↓
    ├── Success → MessageContent (validated)
    │   ↓
    │   └── Safe to use in app
    │
    └── Failure → ZodError
        ↓
        └── Return error to user
```

## Type Safety Guarantees

### Compile-time
- TypeScript ensures all properties are correctly typed
- Discriminated unions prevent invalid block combinations
- Required vs optional fields enforced
- Type inference from Zod schemas

### Runtime
- Zod validates structure matches types
- URL validation for links and buttons
- Array size limits enforced
- String length limits enforced

## Extension Points

1. **New Block Types**
   - Add interface to types
   - Add to MessageBlock union
   - Create Zod schema
   - Add to discriminated union
   - Implement renderers

2. **New Inline Styles**
   - Add to InlineTextStyle type
   - Update Zod enum
   - Update renderers

3. **Custom Validation**
   - Extend Zod schemas with .refine()
   - Add custom validators
   - Chain validations

4. **Custom Rendering**
   - Override default renderers
   - Add custom styles
   - Implement themes

## Performance Considerations

### Optimization Strategies

1. **Large Messages**
   - Use virtual scrolling for long message lists
   - Lazy load images
   - Debounce validation

2. **Real-time Validation**
   - Validate on blur, not on change
   - Cache validation results
   - Use worker threads for large messages

3. **Rendering**
   - Memoize block renderers
   - Use React.memo for performance
   - Virtualize long lists

## Security Considerations

### Input Sanitization

1. **URLs**
   - Always validate with Zod
   - Consider URL whitelist for sensitive apps
   - Use rel="noopener noreferrer" on links

2. **Text Content**
   - HTML is never rendered (uses Text/span)
   - XSS not possible with this system
   - All content is escaped by React/React Native

3. **Images**
   - Validate image URLs
   - Consider image size limits
   - Use CSP headers on web

### Best Practices

1. Always validate user input
2. Never trust deserialized JSON without validation
3. Implement rate limiting on API endpoints
4. Log suspicious validation failures
5. Use HTTPS for all image/button URLs

## Example Use Cases

### 1. Notification System
```typescript
MessageContent for in-app notifications
├── Title (Heading)
├── Body (Paragraph with formatting)
└── Action Button
```

### 2. Messaging App
```typescript
MessageContent for chat messages
├── Text with inline formatting
├── Images with captions
├── Quoted messages
└── Links
```

### 3. Content Management
```typescript
MessageContent for articles/posts
├── Title (H1)
├── Sections (H2/H3)
├── Paragraphs with formatting
├── Images
├── Lists
├── Quotes
└── Call-to-action buttons
```

### 4. Email Templates
```typescript
MessageContent for rich emails
├── Header (H1)
├── Body paragraphs
├── Feature lists
├── Images
└── CTA buttons
```

## Testing Strategy

### Unit Tests
- Validate each block type
- Test builder functions
- Test type guards
- Test text extraction

### Integration Tests
- End-to-end validation flow
- Serialization/deserialization
- Renderer output

### Performance Tests
- Large message validation
- Rendering performance
- Memory usage

### Edge Cases
- Empty content
- Maximum sizes
- Invalid URLs
- Special characters
- Unicode support

## Migration Guide

### From Simple String Messages

Before:
```typescript
interface Message {
  text: string;
}
```

After:
```typescript
interface Message {
  content: MessageContent;
}

// Convert existing messages
const content = createSimpleMessage(oldMessage.text);
```

### From HTML Messages

Before:
```typescript
interface Message {
  html: string; // "<h1>Title</h1><p>Text</p>"
}
```

After:
```typescript
// Parse HTML and convert to MessageContent
// Use a conversion utility or manual mapping
const content = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Title'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Text'),
  ]),
]);
```

## Monitoring & Analytics

### Metrics to Track
- Validation failure rate
- Average message complexity (block count)
- Most used block types
- Rendering performance
- Error rates by block type

### Logging
- Log validation errors with context
- Track message creation patterns
- Monitor API endpoint performance
- Alert on unusual patterns
