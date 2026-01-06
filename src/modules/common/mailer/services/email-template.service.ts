import { Injectable, Logger } from '@nestjs/common';

/**
 * Interface for base template data that all templates should include
 */
export interface BaseTemplateData {
  companyName: string;
  supportEmail: string;
  supportPhone: string;
  supportUrl: string;
  userName?: string;
}

/**
 * Interface for notification template data
 */
export interface NotificationTemplateData extends BaseTemplateData {
  title: string;
  body: string;
  actionUrl?: string;
  actionText?: string;
  importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  timestamp?: string;
  metadata?: Record<string, any>;
}

/**
 * Interface for rendered template (includes both HTML and plain text)
 */
export interface RenderedTemplate {
  html: string;
  plainText: string;
  subject: string;
}

/**
 * Email Template Service
 * Handles rendering of email templates with support for both HTML and plain text versions
 */
@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  // Default company information (can be overridden)
  private readonly defaultCompanyData: BaseTemplateData = {
    companyName: 'Ankaa',
    supportEmail: process.env.EMAIL_USER || 'suporte@ankaa.com',
    supportPhone: process.env.TWILIO_PHONE_NUMBER || '+55 11 99999-9999',
    supportUrl: `${process.env.API_URL || 'http://localhost:3030'}/suporte`,
  };

  /**
   * Render notification email template
   * @param data - Template data for the notification
   * @returns Rendered template with HTML and plain text versions
   */
  renderNotificationTemplate(data: NotificationTemplateData): RenderedTemplate {
    try {
      // Merge with default company data
      const templateData = {
        ...this.defaultCompanyData,
        ...data,
      };

      // Generate HTML version
      const html = this.generateNotificationHTML(templateData);

      // Generate plain text version
      const plainText = this.generateNotificationPlainText(templateData);

      // Generate subject line
      const subject = this.generateSubject(templateData);

      return {
        html,
        plainText,
        subject,
      };
    } catch (error) {
      this.logger.error(`Failed to render notification template: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Render a custom template with provided HTML
   * @param html - Custom HTML template
   * @param data - Template data
   * @returns Rendered template with HTML and plain text versions
   */
  renderCustomTemplate(html: string, data: any): RenderedTemplate {
    try {
      // Replace template variables
      const renderedHtml = this.replaceTemplateVariables(html, data);

      // Generate plain text version
      const plainText = this.htmlToPlainText(renderedHtml);

      // Extract or generate subject
      const subject = data.subject || data.title || 'Nova Notificação';

      return {
        html: renderedHtml,
        plainText,
        subject,
      };
    } catch (error) {
      this.logger.error(`Failed to render custom template: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate HTML for notification email
   * @param data - Notification template data
   * @returns HTML string
   */
  private generateNotificationHTML(data: NotificationTemplateData): string {
    const importanceConfig = this.getImportanceConfig(data.importance);

    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escapeHtml(data.title)} - ${data.companyName}</title>
        <style>${this.getBaseEmailStyle()}</style>
      </head>
      <body>
        <div class="header" style="background: ${importanceConfig.color};">
          <h1>${importanceConfig.icon} ${this.escapeHtml(data.title)}</h1>
          ${data.timestamp ? `<p class="timestamp">${this.escapeHtml(data.timestamp)}</p>` : ''}
        </div>

        <div class="content">
          ${data.userName ? `<h2>Olá, ${this.escapeHtml(data.userName)}!</h2>` : ''}

          <div class="notification-body">
            ${this.escapeHtml(data.body)}
          </div>

          ${
            data.importance && data.importance !== 'LOW'
              ? `
          <div class="importance-badge ${data.importance.toLowerCase()}">
            <strong>${importanceConfig.label}</strong>
          </div>
          `
              : ''
          }

          ${
            data.actionUrl && data.actionText
              ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.escapeHtml(data.actionUrl)}" class="button">${this.escapeHtml(data.actionText)}</a>
          </div>
          `
              : ''
          }

          ${
            data.metadata && Object.keys(data.metadata).length > 0
              ? `
          <div class="metadata">
            <strong>Informações adicionais:</strong>
            <ul>
              ${Object.entries(data.metadata)
                .map(
                  ([key, value]) =>
                    `<li><strong>${this.escapeHtml(key)}:</strong> ${this.escapeHtml(String(value))}</li>`,
                )
                .join('')}
            </ul>
          </div>
          `
              : ''
          }
        </div>

        <div class="footer">
          <p>Esta é uma notificação automática do sistema ${data.companyName}.</p>
          <p>Precisa de ajuda? <a href="${data.supportUrl}">Entre em contato conosco</a></p>
          <p>📧 ${data.supportEmail} | 📱 ${data.supportPhone}</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate plain text version of notification email
   * @param data - Notification template data
   * @returns Plain text string
   */
  private generateNotificationPlainText(data: NotificationTemplateData): string {
    const importanceConfig = this.getImportanceConfig(data.importance);
    let text = '';

    text += `${data.companyName}\n`;
    text += `${'='.repeat(data.companyName.length)}\n\n`;
    text += `${data.title}\n\n`;

    if (data.timestamp) {
      text += `Data: ${data.timestamp}\n\n`;
    }

    if (data.userName) {
      text += `Olá, ${data.userName}!\n\n`;
    }

    text += `${data.body}\n\n`;

    if (data.importance && data.importance !== 'LOW') {
      text += `IMPORTÂNCIA: ${importanceConfig.label}\n\n`;
    }

    if (data.actionUrl && data.actionText) {
      text += `${data.actionText}: ${data.actionUrl}\n\n`;
    }

    if (data.metadata && Object.keys(data.metadata).length > 0) {
      text += `Informações adicionais:\n`;
      Object.entries(data.metadata).forEach(([key, value]) => {
        text += `- ${key}: ${value}\n`;
      });
      text += '\n';
    }

    text += `---\n`;
    text += `Esta é uma notificação automática do sistema ${data.companyName}.\n`;
    text += `Precisa de ajuda? Visite: ${data.supportUrl}\n`;
    text += `Email: ${data.supportEmail} | Telefone: ${data.supportPhone}\n`;

    return text;
  }

  /**
   * Generate email subject line
   * @param data - Template data
   * @returns Subject string
   */
  private generateSubject(data: NotificationTemplateData): string {
    const importancePrefix = this.getImportancePrefix(data.importance);
    return `${importancePrefix}${data.title} - ${data.companyName}`;
  }

  /**
   * Get importance configuration (color, icon, label)
   * @param importance - Importance level
   * @returns Configuration object
   */
  private getImportanceConfig(importance?: string): {
    color: string;
    icon: string;
    label: string;
  } {
    switch (importance) {
      case 'URGENT':
        return {
          color: '#dc3545',
          icon: '🚨',
          label: 'URGENTE',
        };
      case 'HIGH':
        return {
          color: '#fd7e14',
          icon: '⚠️',
          label: 'ALTA PRIORIDADE',
        };
      case 'MEDIUM':
        return {
          color: '#ffc107',
          icon: '📌',
          label: 'MÉDIA PRIORIDADE',
        };
      case 'LOW':
      default:
        return {
          color: '#16802B',
          icon: '📬',
          label: 'BAIXA PRIORIDADE',
        };
    }
  }

  /**
   * Get importance prefix for subject line
   * @param importance - Importance level
   * @returns Prefix string
   */
  private getImportancePrefix(importance?: string): string {
    switch (importance) {
      case 'URGENT':
        return '[URGENTE] ';
      case 'HIGH':
        return '[IMPORTANTE] ';
      default:
        return '';
    }
  }

  /**
   * Replace template variables in a string
   * @param template - Template string with {{variable}} syntax
   * @param data - Data object with values
   * @returns Rendered string
   */
  private replaceTemplateVariables(template: string, data: any): string {
    let result = template;

    // Replace {{variable}} with data values
    const regex = /\{\{(\w+)\}\}/g;
    result = result.replace(regex, (match, key) => {
      const value = data[key];
      return value !== undefined ? String(value) : match;
    });

    return result;
  }

  /**
   * Convert HTML to plain text
   * @param html - HTML string
   * @returns Plain text string
   */
  private htmlToPlainText(html: string): string {
    // Remove HTML tags and convert to plain text
    let text = html;

    // Remove scripts and styles
    text = text.replace(/<script[^>]*>.*?<\/script>/gis, '');
    text = text.replace(/<style[^>]*>.*?<\/style>/gis, '');

    // Convert common HTML elements to plain text equivalents
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<li[^>]*>/gi, '- ');
    text = text.replace(/<\/li>/gi, '\n');

    // Extract link text: <a href="url">text</a> -> text (url)
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Clean up whitespace
    text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
    text = text.replace(/[ \t]+/g, ' '); // Normalize spaces
    text = text.trim();

    return text;
  }

  /**
   * Decode HTML entities
   * @param text - Text with HTML entities
   * @returns Decoded text
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[^;]+;/g, match => entities[match] || match);
  }

  /**
   * Escape HTML special characters
   * @param text - Text to escape
   * @returns Escaped text
   */
  private escapeHtml(text: string): string {
    if (!text) return '';

    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return String(text).replace(/[&<>"']/g, match => entities[match]);
  }

  /**
   * Get base email styling
   * @returns CSS string
   */
  private getBaseEmailStyle(): string {
    return `
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f5f5f5;
      }
      .header {
        background: #16802B;
        color: white;
        padding: 20px;
        text-align: center;
        border-radius: 8px 8px 0 0;
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
      }
      .timestamp {
        margin: 10px 0 0 0;
        font-size: 14px;
        opacity: 0.9;
      }
      .content {
        background: white;
        padding: 30px;
        border: 1px solid #ddd;
        border-top: none;
      }
      .content h2 {
        margin-top: 0;
        color: #16802B;
      }
      .notification-body {
        margin: 20px 0;
        line-height: 1.8;
        white-space: pre-wrap;
      }
      .footer {
        background: #f8f9fa;
        padding: 20px;
        text-align: center;
        border: 1px solid #ddd;
        border-top: none;
        border-radius: 0 0 8px 8px;
        font-size: 14px;
        color: #666;
      }
      .footer a {
        color: #16802B;
        text-decoration: none;
      }
      .button {
        display: inline-block;
        padding: 12px 30px;
        background: #16802B;
        color: white !important;
        text-decoration: none;
        border-radius: 5px;
        font-weight: bold;
        margin: 20px 0;
      }
      .button:hover {
        background: #125a1f;
      }
      .importance-badge {
        padding: 10px 15px;
        border-radius: 5px;
        margin: 20px 0;
        text-align: center;
        font-weight: bold;
      }
      .importance-badge.urgent {
        background: #f8d7da;
        border: 2px solid #dc3545;
        color: #721c24;
      }
      .importance-badge.high {
        background: #fff3cd;
        border: 2px solid #fd7e14;
        color: #856404;
      }
      .importance-badge.medium {
        background: #fff3cd;
        border: 2px solid #ffc107;
        color: #856404;
      }
      .metadata {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 5px;
        padding: 15px;
        margin: 20px 0;
      }
      .metadata ul {
        margin: 10px 0 0 0;
        padding-left: 20px;
      }
      .metadata li {
        margin: 5px 0;
      }
    `;
  }

  /**
   * Create base email data with environment defaults
   * @param userName - Optional user name
   * @returns Base template data
   */
  createBaseEmailData(userName?: string): BaseTemplateData {
    return {
      ...this.defaultCompanyData,
      userName,
    };
  }

  /**
   * Validate template data
   * @param data - Template data to validate
   * @returns True if valid, throws error otherwise
   */
  validateTemplateData(data: NotificationTemplateData): boolean {
    if (!data.title || data.title.trim().length === 0) {
      throw new Error('Template data must include a title');
    }

    if (!data.body || data.body.trim().length === 0) {
      throw new Error('Template data must include a body');
    }

    if (data.title.length > 200) {
      throw new Error('Title must be 200 characters or less');
    }

    if (data.body.length > 5000) {
      throw new Error('Body must be 5000 characters or less');
    }

    if (data.actionUrl && !data.actionText) {
      throw new Error('Action URL requires action text');
    }

    if (data.actionText && !data.actionUrl) {
      throw new Error('Action text requires action URL');
    }

    return true;
  }
}
