// Example React Native renderer for message content blocks (Mobile)
// This file demonstrates how to render MessageContent in a React Native application

import React from 'react';
import { View, Text, Image, Pressable, Linking, StyleSheet } from 'react-native';
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
  style?: any;
}

export const InlineContentRenderer: React.FC<InlineContentRendererProps> = ({ content, style }) => {
  return (
    <Text style={style}>
      {content.map((item, index) => {
        switch (item.type) {
          case 'text':
            return <Text key={index}>{item.text}</Text>;

          case 'styled': {
            const textStyles: any[] = [];

            if (item.styles.includes('bold')) {
              textStyles.push(styles.bold);
            }
            if (item.styles.includes('italic')) {
              textStyles.push(styles.italic);
            }
            if (item.styles.includes('code')) {
              textStyles.push(styles.inlineCode);
            }

            return (
              <Text key={index} style={textStyles}>
                {item.text}
              </Text>
            );
          }

          case 'link':
            return (
              <Text
                key={index}
                style={styles.link}
                onPress={() => Linking.openURL(item.url)}
              >
                {item.text}
              </Text>
            );

          default:
            return null;
        }
      })}
    </Text>
  );
};

// =====================
// Block Renderers
// =====================

export const HeadingRenderer: React.FC<{ block: HeadingBlock }> = ({ block }) => {
  const headingStyle = [
    styles.heading,
    block.level === 1 && styles.heading1,
    block.level === 2 && styles.heading2,
    block.level === 3 && styles.heading3,
  ];

  return (
    <View style={styles.headingContainer}>
      <InlineContentRenderer content={block.content} style={headingStyle} />
    </View>
  );
};

export const ParagraphRenderer: React.FC<{ block: ParagraphBlock }> = ({ block }) => {
  return (
    <View style={styles.paragraphContainer}>
      <InlineContentRenderer content={block.content} style={styles.paragraph} />
    </View>
  );
};

export const ImageRenderer: React.FC<{ block: ImageBlock }> = ({ block }) => {
  return (
    <View style={styles.imageContainer}>
      <Image
        source={{ uri: block.url }}
        style={[
          styles.image,
          block.width && block.height
            ? { width: block.width, height: block.height }
            : undefined,
        ]}
        resizeMode="cover"
        accessible={true}
        accessibilityLabel={block.alt || 'Image'}
      />
      {block.caption && (
        <Text style={styles.imageCaption}>{block.caption}</Text>
      )}
    </View>
  );
};

export const ButtonRenderer: React.FC<{ block: ButtonBlock }> = ({ block }) => {
  const buttonStyle = [
    styles.button,
    block.variant === 'primary' && styles.buttonPrimary,
    block.variant === 'secondary' && styles.buttonSecondary,
    block.variant === 'outline' && styles.buttonOutline,
  ];

  const textStyle = [
    styles.buttonText,
    block.variant === 'primary' && styles.buttonTextPrimary,
    block.variant === 'secondary' && styles.buttonTextSecondary,
    block.variant === 'outline' && styles.buttonTextOutline,
  ];

  const handlePress = () => {
    Linking.openURL(block.url);
  };

  return (
    <View style={styles.buttonContainer}>
      <Pressable
        style={({ pressed }) => [buttonStyle, pressed && styles.buttonPressed]}
        onPress={handlePress}
      >
        <Text style={textStyle}>{block.text}</Text>
      </Pressable>
    </View>
  );
};

export const DividerRenderer: React.FC = () => {
  return <View style={styles.divider} />;
};

export const ListRenderer: React.FC<{ block: ListBlock }> = ({ block }) => {
  return (
    <View style={styles.listContainer}>
      {block.items.map((item, index) => (
        <View key={index} style={styles.listItem}>
          <Text style={styles.listBullet}>
            {block.ordered ? `${index + 1}.` : '•'}
          </Text>
          <View style={styles.listItemContent}>
            <InlineContentRenderer content={item} style={styles.listItemText} />
          </View>
        </View>
      ))}
    </View>
  );
};

export const QuoteRenderer: React.FC<{ block: QuoteBlock }> = ({ block }) => {
  return (
    <View style={styles.quoteContainer}>
      <View style={styles.quoteBar} />
      <View style={styles.quoteContent}>
        <InlineContentRenderer content={block.content} style={styles.quoteText} />
        {block.author && (
          <Text style={styles.quoteAuthor}>— {block.author}</Text>
        )}
      </View>
    </View>
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
  style?: any;
}

export const MessageContentRenderer: React.FC<MessageContentRendererProps> = ({
  content,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      {content.blocks.map((block, index) => (
        <View key={index} style={styles.blockContainer}>
          <MessageBlockRenderer block={block} />
        </View>
      ))}
    </View>
  );
};

// =====================
// Styles
// =====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  blockContainer: {
    marginBottom: 16,
  },

  // Headings
  headingContainer: {
    marginBottom: 8,
  },
  heading: {
    fontWeight: '600',
    color: '#000',
    lineHeight: 1.3,
  },
  heading1: {
    fontSize: 28,
    marginBottom: 12,
  },
  heading2: {
    fontSize: 22,
    marginBottom: 10,
  },
  heading3: {
    fontSize: 18,
    marginBottom: 8,
  },

  // Paragraph
  paragraphContainer: {
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },

  // Inline formatting
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: 'monospace',
    backgroundColor: '#f4f4f4',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    fontSize: 14,
  },
  link: {
    color: '#0066cc',
    textDecorationLine: 'underline',
  },

  // Image
  imageContainer: {
    marginBottom: 12,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  imageCaption: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },

  // Button
  buttonContainer: {
    marginVertical: 8,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#0066cc',
  },
  buttonSecondary: {
    backgroundColor: '#6c757d',
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#0066cc',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: '#ffffff',
  },
  buttonTextSecondary: {
    color: '#ffffff',
  },
  buttonTextOutline: {
    color: '#0066cc',
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 16,
  },

  // List
  listContainer: {
    paddingLeft: 8,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  listBullet: {
    fontSize: 16,
    marginRight: 8,
    color: '#333',
    minWidth: 24,
  },
  listItemContent: {
    flex: 1,
  },
  listItemText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },

  // Quote
  quoteContainer: {
    flexDirection: 'row',
    marginVertical: 12,
  },
  quoteBar: {
    width: 4,
    backgroundColor: '#0066cc',
    marginRight: 12,
    borderRadius: 2,
  },
  quoteContent: {
    flex: 1,
  },
  quoteText: {
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: '#555',
    marginBottom: 8,
  },
  quoteAuthor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});

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

// =====================
// Custom Theme Support
// =====================

interface Theme {
  colors: {
    primary: string;
    secondary: string;
    text: string;
    textSecondary: string;
    background: string;
    border: string;
  };
  fonts: {
    regular: string;
    bold: string;
    monospace: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}

export const createThemedStyles = (theme: Theme) => {
  return StyleSheet.create({
    // You can create themed styles here based on your theme object
    // This allows for easy customization across your app
    container: {
      backgroundColor: theme.colors.background,
    },
    heading: {
      color: theme.colors.text,
      fontFamily: theme.fonts.bold,
    },
    paragraph: {
      color: theme.colors.text,
      fontFamily: theme.fonts.regular,
    },
    link: {
      color: theme.colors.primary,
    },
    buttonPrimary: {
      backgroundColor: theme.colors.primary,
    },
    // ... add more themed styles as needed
  });
};
