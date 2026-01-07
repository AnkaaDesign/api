// packages/types/src/message-content.examples.ts

/**
 * Examples and usage patterns for the message content type system
 */

import type { MessageContent, MessageBlock, InlineContent } from './message-content';
import { MessageContentBuilders, createMessageContent } from './message-content';

// =====================
// Basic Examples
// =====================

// Example 1: Simple text message
export const simpleTextMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Hello, this is a simple message!'),
  ]),
]);

// Example 2: Message with formatting
export const formattedMessage: MessageContent = createMessageContent([
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

// Example 3: Message with multiple styles on same text
export const multiStyleMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('This is '),
    MessageContentBuilders.styled('bold and italic', ['bold', 'italic']),
    MessageContentBuilders.text(' text.'),
  ]),
]);

// Example 4: Message with link
export const linkMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Visit '),
    MessageContentBuilders.link('our website', 'https://example.com'),
    MessageContentBuilders.text(' for more information.'),
  ]),
]);

// =====================
// Rich Content Examples
// =====================

// Example 5: Article-style message with headings
export const articleMessage: MessageContent = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Welcome to Our Platform'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('We are excited to have you here!'),
  ]),
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('Getting Started'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Follow these steps to begin your journey.'),
  ]),
]);

// Example 6: Message with image
export const imageMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Check out this amazing photo:'),
  ]),
  MessageContentBuilders.image('https://example.com/photo.jpg', {
    alt: 'Beautiful landscape',
    caption: 'Photo taken at sunset',
    width: 800,
    height: 600,
  }),
]);

// Example 7: Message with button
export const buttonMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Ready to get started?'),
  ]),
  MessageContentBuilders.button('Sign Up Now', 'https://example.com/signup', 'primary'),
]);

// =====================
// List Examples
// =====================

// Example 8: Unordered list
export const unorderedListMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Our key features:'),
  ]),
  MessageContentBuilders.list(false, [
    [MessageContentBuilders.text('Fast and reliable')],
    [MessageContentBuilders.text('Easy to use')],
    [MessageContentBuilders.text('Secure by default')],
  ]),
]);

// Example 9: Ordered list
export const orderedListMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Setup instructions:'),
  ]),
  MessageContentBuilders.list(true, [
    [MessageContentBuilders.text('Download the app')],
    [MessageContentBuilders.text('Create an account')],
    [MessageContentBuilders.text('Complete your profile')],
  ]),
]);

// Example 10: List with formatted items
export const formattedListMessage: MessageContent = createMessageContent([
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Important notes:'),
  ]),
  MessageContentBuilders.list(false, [
    [
      MessageContentBuilders.bold('Security:'),
      MessageContentBuilders.text(' We take your privacy seriously.'),
    ],
    [
      MessageContentBuilders.bold('Performance:'),
      MessageContentBuilders.text(' Optimized for speed.'),
    ],
    [
      MessageContentBuilders.bold('Support:'),
      MessageContentBuilders.text(' Available 24/7 via '),
      MessageContentBuilders.link('email', 'mailto:support@example.com'),
      MessageContentBuilders.text('.'),
    ],
  ]),
]);

// =====================
// Quote Examples
// =====================

// Example 11: Simple quote
export const simpleQuoteMessage: MessageContent = createMessageContent([
  MessageContentBuilders.quote([
    MessageContentBuilders.text('The best way to predict the future is to invent it.'),
  ], 'Alan Kay'),
]);

// Example 12: Quote with formatting
export const formattedQuoteMessage: MessageContent = createMessageContent([
  MessageContentBuilders.quote([
    MessageContentBuilders.text('Stay '),
    MessageContentBuilders.bold('hungry'),
    MessageContentBuilders.text(', stay '),
    MessageContentBuilders.bold('foolish'),
    MessageContentBuilders.text('.'),
  ], 'Steve Jobs'),
]);

// =====================
// Complex Examples
// =====================

// Example 13: Complete notification message
export const notificationMessage: MessageContent = createMessageContent([
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('New Order Received'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('You have received a new order from '),
    MessageContentBuilders.bold('John Doe'),
    MessageContentBuilders.text('.'),
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.heading(3, [
    MessageContentBuilders.text('Order Details'),
  ]),
  MessageContentBuilders.list(false, [
    [
      MessageContentBuilders.bold('Order ID:'),
      MessageContentBuilders.text(' '),
      MessageContentBuilders.code('#12345'),
    ],
    [
      MessageContentBuilders.bold('Total:'),
      MessageContentBuilders.text(' $99.99'),
    ],
    [
      MessageContentBuilders.bold('Status:'),
      MessageContentBuilders.text(' Pending'),
    ],
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.button('View Order', 'https://example.com/orders/12345', 'primary'),
]);

// Example 14: Blog post style message
export const blogPostMessage: MessageContent = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Building Better User Experiences'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Published on '),
    MessageContentBuilders.italic('January 6, 2026'),
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.image('https://example.com/hero-image.jpg', {
    alt: 'User experience design',
    caption: 'Designing with users in mind',
  }),
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('Introduction'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text(
      'User experience design is more important than ever. In this article, we explore the key principles.',
    ),
  ]),
  MessageContentBuilders.quote([
    MessageContentBuilders.text('Design is not just what it looks like and feels like. Design is how it works.'),
  ], 'Steve Jobs'),
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('Key Principles'),
  ]),
  MessageContentBuilders.list(true, [
    [MessageContentBuilders.bold('Simplicity:'), MessageContentBuilders.text(' Keep it simple and intuitive')],
    [MessageContentBuilders.bold('Consistency:'), MessageContentBuilders.text(' Maintain consistent patterns')],
    [MessageContentBuilders.bold('Feedback:'), MessageContentBuilders.text(' Provide clear user feedback')],
  ]),
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text('Conclusion'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('By following these principles, you can create experiences that users love. Learn more in our '),
    MessageContentBuilders.link('design guide', 'https://example.com/guide'),
    MessageContentBuilders.text('.'),
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.button('Read More Articles', 'https://example.com/blog', 'secondary'),
]);

// Example 15: Product announcement message
export const productAnnouncementMessage: MessageContent = createMessageContent([
  MessageContentBuilders.heading(1, [
    MessageContentBuilders.text('Introducing: New Pro Features'),
  ]),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('We are thrilled to announce the launch of our '),
    MessageContentBuilders.bold('Pro tier'),
    MessageContentBuilders.text(' with powerful new features designed for professionals.'),
  ]),
  MessageContentBuilders.image('https://example.com/pro-features.jpg', {
    alt: 'Pro features preview',
  }),
  MessageContentBuilders.heading(2, [
    MessageContentBuilders.text("What's New"),
  ]),
  MessageContentBuilders.list(false, [
    [
      MessageContentBuilders.bold('Advanced Analytics:'),
      MessageContentBuilders.text(' Get deeper insights into your data.'),
    ],
    [
      MessageContentBuilders.bold('Team Collaboration:'),
      MessageContentBuilders.text(' Work together seamlessly.'),
    ],
    [
      MessageContentBuilders.bold('Priority Support:'),
      MessageContentBuilders.text(' Get help when you need it most.'),
    ],
  ]),
  MessageContentBuilders.divider(),
  MessageContentBuilders.paragraph([
    MessageContentBuilders.text('Special launch offer: '),
    MessageContentBuilders.bold('50% off'),
    MessageContentBuilders.text(' for the first 3 months!'),
  ]),
  MessageContentBuilders.button('Upgrade to Pro', 'https://example.com/upgrade', 'primary'),
  MessageContentBuilders.button('Learn More', 'https://example.com/pro', 'outline'),
]);

// =====================
// Helper Functions for Creating Content
// =====================

/**
 * Creates a simple text-only message
 */
export function createSimpleMessage(text: string): MessageContent {
  return createMessageContent([
    MessageContentBuilders.paragraph([
      MessageContentBuilders.text(text),
    ]),
  ]);
}

/**
 * Creates a message with title and body
 */
export function createTitledMessage(title: string, body: string): MessageContent {
  return createMessageContent([
    MessageContentBuilders.heading(2, [
      MessageContentBuilders.text(title),
    ]),
    MessageContentBuilders.paragraph([
      MessageContentBuilders.text(body),
    ]),
  ]);
}

/**
 * Creates a message with title, body, and action button
 */
export function createActionMessage(
  title: string,
  body: string,
  buttonText: string,
  buttonUrl: string,
): MessageContent {
  return createMessageContent([
    MessageContentBuilders.heading(2, [
      MessageContentBuilders.text(title),
    ]),
    MessageContentBuilders.paragraph([
      MessageContentBuilders.text(body),
    ]),
    MessageContentBuilders.button(buttonText, buttonUrl, 'primary'),
  ]);
}

// =====================
// JSON Serialization Examples
// =====================

// Example of JSON-serialized message (what would be stored in database or sent over API)
export const jsonSerializedExample = JSON.stringify(simpleTextMessage, null, 2);

// Example of parsing JSON back to typed structure
export function parseJsonMessage(json: string): MessageContent {
  return JSON.parse(json) as MessageContent;
}
