// Example test file demonstrating validation and usage of the message content type system
// This can be used as a reference for writing actual tests

import {
  MessageContentBuilders,
  createMessageContent,
  validateMessageContent,
  extractPlainText,
  extractAllText,
  isHeadingBlock,
  isParagraphBlock,
} from './message-content';

import {
  messageContentSchema,
  messageBlockSchema,
  parseMessageContent,
  safeParseMessageContent,
} from '../schemas/message-content';

// =====================
// Test Data
// =====================

const validSimpleMessage = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Hello, world!'),
  ]),
]);

const validComplexMessage = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Welcome'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('This is a '),
    MessageContentBuilders.bold('test'),
    MessageContentBuilders.text(' message.'),
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.list(false, [
    [MessageContentBuilders.text('Item 1')],
    [MessageContentBuilders.text('Item 2')],
  ]),
]);

const invalidMessage = {
  blocks: [
    {
      type: 'invalid-type',
      content: [],
    },
  ],
};

const invalidEmptyMessage = {
  blocks: [],
};

// =====================
// Validation Tests
// =====================

export function testValidation() {
  console.log('Testing validation...\n');

  // Test 1: Valid simple message
  console.log('Test 1: Valid simple message');
  const result1 = safeParseMessageContent(validSimpleMessage);
  console.log('  Success:', result1.success); // true
  console.log('  Data:', result1.data?.blocks.length, 'blocks');
  console.log();

  // Test 2: Valid complex message
  console.log('Test 2: Valid complex message');
  const result2 = safeParseMessageContent(validComplexMessage);
  console.log('  Success:', result2.success); // true
  console.log('  Data:', result2.data?.blocks.length, 'blocks');
  console.log();

  // Test 3: Invalid message type
  console.log('Test 3: Invalid message type');
  const result3 = safeParseMessageContent(invalidMessage);
  console.log('  Success:', result3.success); // false
  if (!result3.success) {
    console.log('  Error:', result3.error.errors[0]?.message);
  }
  console.log();

  // Test 4: Empty blocks array
  console.log('Test 4: Empty blocks array');
  const result4 = safeParseMessageContent(invalidEmptyMessage);
  console.log('  Success:', result4.success); // false
  if (!result4.success) {
    console.log('  Error:', result4.error.errors[0]?.message);
  }
  console.log();

  // Test 5: Using validateMessageContent
  console.log('Test 5: Using validateMessageContent');
  console.log('  Valid message:', validateMessageContent(validSimpleMessage)); // true
  console.log('  Invalid message:', validateMessageContent(invalidMessage)); // false
  console.log();
}

// =====================
// Builder Tests
// =====================

export function testBuilders() {
  console.log('Testing builders...\n');

  // Test heading
  const heading = MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('Test Heading'),
  ]);
  console.log('Heading:', JSON.stringify(heading, null, 2));
  console.log();

  // Test paragraph with formatting
  const paragraph = MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Plain text, '),
    MessageContentBuilders.bold('bold text'),
    MessageContentBuilders.text(', '),
    MessageContentBuilders.italic('italic text'),
    MessageContentBuilders.text(', and '),
    MessageContentBuilders.link('a link', 'https://example.com'),
  ]);
  console.log('Paragraph:', JSON.stringify(paragraph, null, 2));
  console.log();

  // Test list
  const list = MessageContentBuilders.list(true, [
    [MessageContentBuilders.text('First item')],
    [
      MessageContentBuilders.bold('Second'),
      MessageContentBuilders.text(' item'),
    ],
  ]);
  console.log('List:', JSON.stringify(list, null, 2));
  console.log();

  // Test image
  const image = MessageContentBuilders.image('https://example.com/image.jpg', {
    alt: 'Test image',
    caption: 'A beautiful image',
    width: 800,
    height: 600,
  });
  console.log('Image:', JSON.stringify(image, null, 2));
  console.log();

  // Test button
  const button = MessageContentBuilders.button(
    'Click Me',
    'https://example.com',
    'primary'
  );
  console.log('Button:', JSON.stringify(button, null, 2));
  console.log();
}

// =====================
// Type Guard Tests
// =====================

export function testTypeGuards() {
  console.log('Testing type guards...\n');

  const blocks = validComplexMessage.blocks;

  blocks.forEach((block, index) => {
    console.log(`Block ${index}:`);
    console.log('  Type:', block.type);
    console.log('  Is heading?', isHeadingBlock(block));
    console.log('  Is paragraph?', isParagraphBlock(block));

    if (isHeadingBlock(block)) {
      console.log('  Heading level:', block.level);
    }

    if (isParagraphBlock(block)) {
      console.log('  Content items:', block.content.length);
    }
    console.log();
  });
}

// =====================
// Text Extraction Tests
// =====================

export function testTextExtraction() {
  console.log('Testing text extraction...\n');

  const message = createMessageContent([
    MessageContentBuilders.heading(1, [
      MessageContentBuilders.text('Title'),
    ]),
    MessageContentBuilders.paragraph([
      MessageContentBuilders.text('This is '),
      MessageContentBuilders.bold('important'),
      MessageContentBuilders.text(' text.'),
    ]),
    MessageContentBuilders.list(false, [
      [MessageContentBuilders.text('Item one')],
      [MessageContentBuilders.text('Item two')],
    ]),
  ]);

  // Extract all text
  const allText = extractAllText(message);
  console.log('All text:', allText);
  console.log();

  // Extract from individual blocks
  message.blocks.forEach((block, index) => {
    if ('content' in block && Array.isArray(block.content)) {
      const text = extractPlainText(block.content);
      console.log(`Block ${index} text:`, text);
    }
  });
  console.log();
}

// =====================
// JSON Serialization Tests
// =====================

export function testSerialization() {
  console.log('Testing JSON serialization...\n');

  const original = validComplexMessage;

  // Serialize
  const json = JSON.stringify(original);
  console.log('Serialized length:', json.length, 'characters');
  console.log('Serialized preview:', json.substring(0, 100) + '...');
  console.log();

  // Deserialize
  const parsed = JSON.parse(json);
  console.log('Parsed blocks:', parsed.blocks?.length);
  console.log();

  // Validate after parsing
  const validated = safeParseMessageContent(parsed);
  console.log('Valid after parsing?', validated.success);
  console.log();

  // Check equality
  const reserialized = JSON.stringify(parsed);
  console.log('Serialization stable?', json === reserialized);
  console.log();
}

// =====================
// Edge Cases Tests
// =====================

export function testEdgeCases() {
  console.log('Testing edge cases...\n');

  // Test 1: Empty inline content should fail
  console.log('Test 1: Empty paragraph content');
  const emptyParagraph = {
    type: 'paragraph',
    content: [],
  };
  const result1 = messageBlockSchema.safeParse(emptyParagraph);
  console.log('  Valid?', result1.success); // false
  console.log();

  // Test 2: Multiple styles on same text
  console.log('Test 2: Multiple styles');
  const multiStyle = MessageContentBuilders.styled('text', ['bold', 'italic', 'code']);
  console.log('  Created:', JSON.stringify(multiStyle, null, 2));
  console.log();

  // Test 3: Very long URL
  console.log('Test 3: Long URL validation');
  const longUrl = 'https://example.com/' + 'a'.repeat(2000);
  const result3 = safeParseMessageContent(
    createMessageContent([
      MessageContentBuilders.button('Test', longUrl),
    ])
  );
  console.log('  Valid?', result3.success);
  if (!result3.success) {
    console.log('  Error:', result3.error.errors[0]?.message);
  }
  console.log();

  // Test 4: Nested list items with links
  console.log('Test 4: Complex list items');
  const complexList = MessageContentBuilders.list(false, [
    [
      MessageContentBuilders.bold('Title: '),
      MessageContentBuilders.text('Visit '),
      MessageContentBuilders.link('our site', 'https://example.com'),
      MessageContentBuilders.text(' for more.'),
    ],
  ]);
  const result4 = messageBlockSchema.safeParse(complexList);
  console.log('  Valid?', result4.success);
  console.log();

  // Test 5: Quote without author
  console.log('Test 5: Quote without author');
  const quoteNoAuthor = MessageContentBuilders.quote([
    MessageContentBuilders.text('Anonymous quote'),
  ]);
  console.log('  Has author?', 'author' in quoteNoAuthor);
  const result5 = messageBlockSchema.safeParse(quoteNoAuthor);
  console.log('  Valid?', result5.success);
  console.log();
}

// =====================
// Performance Tests
// =====================

export function testPerformance() {
  console.log('Testing performance...\n');

  // Create a large message
  const largeBlocks = [];
  for (let i = 0; i < 100; i++) {
    largeBlocks.push(
      MessageContentBuilders.paragraph([
        MessageContentBuilders.text(`Paragraph ${i}: `),
        MessageContentBuilders.bold(`Bold text ${i}`),
      ])
    );
  }

  const largeMessage = createMessageContent(largeBlocks);

  // Test validation performance
  console.log('Validating message with', largeBlocks.length, 'blocks...');
  const start = performance.now();
  const result = messageContentSchema.safeParse(largeMessage);
  const end = performance.now();

  console.log('  Valid?', result.success);
  console.log('  Time:', (end - start).toFixed(2), 'ms');
  console.log();

  // Test serialization performance
  console.log('Serializing large message...');
  const start2 = performance.now();
  const json = JSON.stringify(largeMessage);
  const end2 = performance.now();

  console.log('  Size:', (json.length / 1024).toFixed(2), 'KB');
  console.log('  Time:', (end2 - start2).toFixed(2), 'ms');
  console.log();
}

// =====================
// Run All Tests
// =====================

export function runAllTests() {
  console.log('='.repeat(60));
  console.log('MESSAGE CONTENT TYPE SYSTEM TESTS');
  console.log('='.repeat(60));
  console.log();

  testValidation();
  testBuilders();
  testTypeGuards();
  testTextExtraction();
  testSerialization();
  testEdgeCases();
  testPerformance();

  console.log('='.repeat(60));
  console.log('ALL TESTS COMPLETE');
  console.log('='.repeat(60));
}

// Uncomment to run tests
// runAllTests();
