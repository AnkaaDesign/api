// Example React renderer for message content blocks (Web)
// This file demonstrates how to render MessageContent in a React web application

import React from 'react';
import type {
  MessageContent,
  MessageBlock,
  InlineContent,
  HeadingBlock,
  ParagraphBlock,
  ImageBlock,
  ButtonBlock,
  ListBlock,
  QuoteBlock,
} from './message-content';

// =====================
// Inline Content Renderer
// =====================

interface InlineContentRendererProps {
  content: InlineContent[];
  className?: string;
}

export const InlineContentRenderer: React.FC<InlineContentRendererProps> = ({ content, className }) => {
  return (
    <span className={className}>
      {content.map((item, index) => {
        switch (item.type) {
          case 'text':
            return <React.Fragment key={index}>{item.text}</React.Fragment>;

          case 'styled': {
            let element: React.ReactNode = item.text;

            // Apply styles in order
            if (item.styles.includes('bold')) {
              element = <strong>{element}</strong>;
            }
            if (item.styles.includes('italic')) {
              element = <em>{element}</em>;
            }
            if (item.styles.includes('code')) {
              element = <code className="inline-code">{element}</code>;
            }

            return <React.Fragment key={index}>{element}</React.Fragment>;
          }

          case 'link':
            return (
              <a
                key={index}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="message-link"
              >
                {item.text}
              </a>
            );

          default:
            return null;
        }
      })}
    </span>
  );
};

// =====================
// Block Renderers
// =====================

export const HeadingRenderer: React.FC<{ block: HeadingBlock }> = ({ block }) => {
  const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';

  return (
    <Tag className={`message-heading message-heading-${block.level}`}>
      <InlineContentRenderer content={block.content} />
    </Tag>
  );
};

export const ParagraphRenderer: React.FC<{ block: ParagraphBlock }> = ({ block }) => {
  return (
    <p className="message-paragraph">
      <InlineContentRenderer content={block.content} />
    </p>
  );
};

export const ImageRenderer: React.FC<{ block: ImageBlock }> = ({ block }) => {
  return (
    <figure className="message-image">
      <img
        src={block.url}
        alt={block.alt || ''}
        width={block.width}
        height={block.height}
        loading="lazy"
        className="message-image-img"
      />
      {block.caption && (
        <figcaption className="message-image-caption">{block.caption}</figcaption>
      )}
    </figure>
  );
};

export const ButtonRenderer: React.FC<{ block: ButtonBlock }> = ({ block }) => {
  const variantClass = block.variant ? `message-button-${block.variant}` : 'message-button-primary';

  return (
    <div className="message-button-wrapper">
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`message-button ${variantClass}`}
      >
        {block.text}
      </a>
    </div>
  );
};

export const DividerRenderer: React.FC = () => {
  return <hr className="message-divider" />;
};

export const ListRenderer: React.FC<{ block: ListBlock }> = ({ block }) => {
  const Tag = block.ordered ? 'ol' : 'ul';

  return (
    <Tag className={`message-list message-list-${block.ordered ? 'ordered' : 'unordered'}`}>
      {block.items.map((item, index) => (
        <li key={index} className="message-list-item">
          <InlineContentRenderer content={item} />
        </li>
      ))}
    </Tag>
  );
};

export const QuoteRenderer: React.FC<{ block: QuoteBlock }> = ({ block }) => {
  return (
    <blockquote className="message-quote">
      <div className="message-quote-content">
        <InlineContentRenderer content={block.content} />
      </div>
      {block.author && (
        <cite className="message-quote-author">— {block.author}</cite>
      )}
    </blockquote>
  );
};

// =====================
// Main Block Renderer
// =====================

export const MessageBlockRenderer: React.FC<{ block: MessageBlock }> = ({ block }) => {
  switch (block.type) {
    case 'heading':
      return <HeadingRenderer block={block} />;

    case 'paragraph':
      return <ParagraphRenderer block={block} />;

    case 'image':
      return <ImageRenderer block={block} />;

    case 'button':
      return <ButtonRenderer block={block} />;

    case 'divider':
      return <DividerRenderer />;

    case 'list':
      return <ListRenderer block={block} />;

    case 'quote':
      return <QuoteRenderer block={block} />;

    default:
      console.warn('Unknown block type:', (block as any).type);
      return null;
  }
};

// =====================
// Main Message Content Renderer
// =====================

interface MessageContentRendererProps {
  content: MessageContent;
  className?: string;
}

export const MessageContentRenderer: React.FC<MessageContentRendererProps> = ({
  content,
  className = 'message-content'
}) => {
  return (
    <div className={className}>
      {content.blocks.map((block, index) => (
        <div key={index} className="message-block">
          <MessageBlockRenderer block={block} />
        </div>
      ))}
    </div>
  );
};

// =====================
// Example CSS (to be added to your styles)
// =====================

export const exampleCSS = `
/* Message Content Styles */
.message-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
}

.message-block {
  margin-bottom: 1.25rem;
}

.message-block:last-child {
  margin-bottom: 0;
}

/* Headings */
.message-heading {
  font-weight: 600;
  margin: 0;
  line-height: 1.3;
}

.message-heading-1 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.message-heading-2 {
  font-size: 1.5rem;
  margin-bottom: 0.875rem;
}

.message-heading-3 {
  font-size: 1.25rem;
  margin-bottom: 0.75rem;
}

/* Paragraph */
.message-paragraph {
  margin: 0;
}

/* Inline formatting */
.inline-code {
  background-color: #f4f4f4;
  border-radius: 3px;
  padding: 0.125rem 0.25rem;
  font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
  font-size: 0.9em;
}

.message-link {
  color: #0066cc;
  text-decoration: none;
}

.message-link:hover {
  text-decoration: underline;
}

/* Image */
.message-image {
  margin: 0;
}

.message-image-img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

.message-image-caption {
  font-size: 0.875rem;
  color: #666;
  margin-top: 0.5rem;
  font-style: italic;
}

/* Button */
.message-button-wrapper {
  margin: 0.5rem 0;
}

.message-button {
  display: inline-block;
  padding: 0.625rem 1.25rem;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s;
}

.message-button-primary {
  background-color: #0066cc;
  color: white;
}

.message-button-primary:hover {
  background-color: #0052a3;
}

.message-button-secondary {
  background-color: #6c757d;
  color: white;
}

.message-button-secondary:hover {
  background-color: #5a6268;
}

.message-button-outline {
  background-color: transparent;
  color: #0066cc;
  border: 2px solid #0066cc;
}

.message-button-outline:hover {
  background-color: #0066cc;
  color: white;
}

/* Divider */
.message-divider {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 1.5rem 0;
}

/* List */
.message-list {
  margin: 0;
  padding-left: 1.5rem;
}

.message-list-item {
  margin-bottom: 0.5rem;
}

.message-list-item:last-child {
  margin-bottom: 0;
}

/* Quote */
.message-quote {
  border-left: 4px solid #0066cc;
  padding-left: 1rem;
  margin: 0;
  font-style: italic;
  color: #555;
}

.message-quote-content {
  margin-bottom: 0.5rem;
}

.message-quote-author {
  display: block;
  font-style: normal;
  font-weight: 500;
  color: #333;
  font-size: 0.9em;
}
`;

// =====================
// Usage Example
// =====================

export const UsageExample: React.FC = () => {
  const sampleMessage: MessageContent = {
    blocks: [
      {
        type: 'heading',
        level: 1,
        content: [{ type: 'text', text: 'Welcome!' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'This is a ' },
          { type: 'styled', text: 'sample message', styles: ['bold'] },
          { type: 'text', text: ' with rich content.' },
        ],
      },
      {
        type: 'button',
        text: 'Learn More',
        url: 'https://example.com',
        variant: 'primary',
      },
    ],
    version: '1.0',
  };

  return <MessageContentRenderer content={sampleMessage} />;
};
