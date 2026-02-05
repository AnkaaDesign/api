import { Injectable, Logger } from '@nestjs/common';
import {
  TASK_STATUS,
  COMMISSION_STATUS,
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_TYPE,
} from '../../../constants/enums';

// =====================
// Type Definitions
// =====================

/**
 * Message type for template selection
 */
export type MessageType = 'updated' | 'cleared' | 'filesAdded' | 'filesRemoved';

/**
 * Channel-specific template content
 */
export interface ChannelTemplate {
  updated?: string;
  cleared?: string;
  filesAdded?: string;
  filesRemoved?: string;
}

/**
 * Email template structure
 */
export interface EmailTemplateContent {
  subject: string;
  body: string;
  html?: string;
}

/**
 * Email templates by message type
 */
export interface EmailTemplates {
  updated?: EmailTemplateContent;
  cleared?: EmailTemplateContent;
  filesAdded?: EmailTemplateContent;
  filesRemoved?: EmailTemplateContent;
}

/**
 * Complete notification templates for all channels
 */
export interface NotificationTemplates {
  inApp?: ChannelTemplate | string;
  push?: ChannelTemplate | string;
  email?: EmailTemplates | EmailTemplateContent;
  whatsapp?: ChannelTemplate | string;
}

/**
 * Rendered templates result
 */
export interface RenderedTemplates {
  inApp?: string;
  push?: string;
  email?: { subject: string; body: string; html?: string };
  whatsapp?: string;
}

/**
 * Context for notification rendering
 */
export interface NotificationContext {
  // Task information
  task?: {
    id?: string;
    name?: string;
    serialNumber?: string;
    status?: TASK_STATUS;
  };
  taskId?: string;
  taskName?: string;
  serialNumber?: string;

  // Value changes
  oldValue?: any;
  newValue?: any;

  // User information
  changedBy?: string;
  changedByName?: string;
  userId?: string;
  userName?: string;

  // File information
  files?: any[];
  fileCount?: number;
  count?: number;

  // Overdue information
  daysOverdue?: number;
  daysRemaining?: number;

  // Timestamps
  timestamp?: Date;
  date?: string;
  time?: string;

  // Additional context
  sectorName?: string;
  customerName?: string;
  paintName?: string;
  url?: string;

  // Generic metadata
  [key: string]: any;
}

/**
 * Formatter type for value formatting
 */
export type FormatterType =
  | 'formatDate'
  | 'formatDateTime'
  | 'formatCurrency'
  | 'formatStatus'
  | 'formatSector'
  | 'formatCustomer'
  | 'formatPaint'
  | 'formatServiceOrderStatus'
  | 'formatServiceOrderType'
  | 'formatCommissionStatus';

// =====================
// Status Translation Maps
// =====================

const TASK_STATUS_LABELS: Record<TASK_STATUS, string> = {
  [TASK_STATUS.PREPARATION]: 'Preparação',
  [TASK_STATUS.WAITING_PRODUCTION]: 'Aguardando Produção',
  [TASK_STATUS.IN_PRODUCTION]: 'Em Produção',
  [TASK_STATUS.COMPLETED]: 'Concluído',
  [TASK_STATUS.CANCELLED]: 'Cancelado',
};

const COMMISSION_STATUS_LABELS: Record<COMMISSION_STATUS, string> = {
  [COMMISSION_STATUS.NO_COMMISSION]: 'Sem Comissão',
  [COMMISSION_STATUS.PARTIAL_COMMISSION]: 'Comissão Parcial',
  [COMMISSION_STATUS.FULL_COMMISSION]: 'Comissão Total',
  [COMMISSION_STATUS.SUSPENDED_COMMISSION]: 'Comissão Suspensa',
};

const SERVICE_ORDER_STATUS_LABELS: Record<SERVICE_ORDER_STATUS, string> = {
  [SERVICE_ORDER_STATUS.PENDING]: 'Pendente',
  [SERVICE_ORDER_STATUS.IN_PROGRESS]: 'Em Andamento',
  [SERVICE_ORDER_STATUS.WAITING_APPROVE]: 'Aguardando Aprovação',
  [SERVICE_ORDER_STATUS.COMPLETED]: 'Concluído',
  [SERVICE_ORDER_STATUS.CANCELLED]: 'Cancelado',
};

const SERVICE_ORDER_TYPE_LABELS: Record<SERVICE_ORDER_TYPE, string> = {
  [SERVICE_ORDER_TYPE.PRODUCTION]: 'Produção',
  [SERVICE_ORDER_TYPE.FINANCIAL]: 'Financeiro',
  [SERVICE_ORDER_TYPE.COMMERCIAL]: 'Comercial',
  [SERVICE_ORDER_TYPE.ARTWORK]: 'Arte',
  [SERVICE_ORDER_TYPE.LOGISTIC]: 'Logística',
};

// =====================
// Service Implementation
// =====================

/**
 * NotificationTemplateRendererService
 *
 * Renders notification templates with context variables.
 * Supports multiple channels (inApp, push, email, whatsapp) and
 * different message types (updated, cleared, filesAdded, filesRemoved).
 */
@Injectable()
export class NotificationTemplateRendererService {
  private readonly logger = new Logger(NotificationTemplateRendererService.name);

  /**
   * Render all templates for all channels with the given context
   *
   * @param templates - Templates for all channels
   * @param context - Context variables for rendering
   * @param messageType - Type of message to render
   * @returns Rendered templates for all channels
   */
  renderAllTemplates(
    templates: NotificationTemplates,
    context: NotificationContext,
    messageType: MessageType = 'updated',
  ): RenderedTemplates {
    const variables = this.buildContextVariables(context);
    const result: RenderedTemplates = {};

    try {
      // Render inApp template
      if (templates.inApp) {
        const template = this.getTemplateForMessageType(templates.inApp, messageType);
        if (template) {
          result.inApp = this.renderTemplate(template, variables);
        }
      }

      // Render push template
      if (templates.push) {
        const template = this.getTemplateForMessageType(templates.push, messageType);
        if (template) {
          result.push = this.renderTemplate(template, variables);
        }
      }

      // Render email template
      if (templates.email) {
        const emailTemplate = this.getEmailTemplateForMessageType(templates.email, messageType);
        if (emailTemplate) {
          result.email = this.renderEmailTemplate(emailTemplate, variables);
        }
      }

      // Render whatsapp template
      if (templates.whatsapp) {
        const template = this.getTemplateForMessageType(templates.whatsapp, messageType);
        if (template) {
          result.whatsapp = this.renderTemplate(template, variables);
        }
      }
    } catch (error) {
      this.logger.error('Error rendering templates', error);
      // Return partial results on error
    }

    return result;
  }

  /**
   * Render a single template string with variables
   *
   * Replaces {variableName} with actual values from variables object.
   * Supports nested access: {task.name}
   * Handles missing variables gracefully (leaves as-is or empty)
   *
   * @param template - Template string with {variable} placeholders
   * @param variables - Variables to replace in the template
   * @returns Rendered template string
   */
  renderTemplate(template: string, variables: Record<string, any>): string {
    if (!template) {
      return '';
    }

    try {
      // Replace {variableName} patterns with actual values
      return template.replace(/\{([^}]+)\}/g, (match, path) => {
        const value = this.getNestedValue(variables, path.trim());

        // If value is undefined or null, leave placeholder as-is for debugging
        // or return empty string for cleaner output
        if (value === undefined || value === null) {
          this.logger.debug(`Variable not found: ${path}`);
          return ''; // Return empty string for missing variables
        }

        // Convert value to string
        return String(value);
      });
    } catch (error) {
      this.logger.error(`Error rendering template: ${template}`, error);
      return template; // Return original template on error
    }
  }

  /**
   * Render an email template with subject and body
   *
   * @param emailTemplate - Email template with subject and body
   * @param variables - Variables to replace in the template
   * @returns Rendered email template
   */
  renderEmailTemplate(
    emailTemplate: EmailTemplateContent,
    variables: Record<string, any>,
  ): { subject: string; body: string; html?: string } {
    const result: { subject: string; body: string; html?: string } = {
      subject: this.renderTemplate(emailTemplate.subject || '', variables),
      body: this.renderTemplate(emailTemplate.body || '', variables),
    };

    if (emailTemplate.html) {
      result.html = this.renderTemplate(emailTemplate.html, variables);
    }

    return result;
  }

  /**
   * Build context variables from notification context
   *
   * Extracts and formats standard variables from the context object.
   *
   * @param context - Notification context
   * @returns Record of variables for template rendering
   */
  buildContextVariables(context: NotificationContext): Record<string, any> {
    const now = context.timestamp || new Date();

    const variables: Record<string, any> = {
      // Task information
      taskName: context.taskName || context.task?.name || '',
      serialNumber: context.serialNumber || context.task?.serialNumber || '',
      taskId: context.taskId || context.task?.id || '',

      // Value changes (formatted)
      oldValue: this.formatContextValue(context.oldValue),
      newValue: this.formatContextValue(context.newValue),

      // User information
      changedBy: context.changedBy || context.changedByName || '',
      userName: context.userName || context.changedBy || '',

      // File/count information
      count: context.count ?? context.fileCount ?? context.files?.length ?? 0,
      fileCount: context.fileCount ?? context.files?.length ?? 0,

      // Overdue information
      daysOverdue: context.daysOverdue ?? 0,
      daysRemaining: context.daysRemaining ?? 0,

      // Timestamps
      timestamp: now.toISOString(),
      date: this.formatDate(now),
      time: this.formatTime(now),

      // Additional context
      sectorName: context.sectorName || '',
      customerName: context.customerName || '',
      paintName: context.paintName || '',
      url: context.url || '',

      // Task object for nested access
      task: {
        id: context.task?.id || context.taskId || '',
        name: context.task?.name || context.taskName || '',
        serialNumber: context.task?.serialNumber || context.serialNumber || '',
        status: context.task?.status
          ? this.formatValue(context.task.status, 'formatStatus')
          : '',
      },
    };

    // Add any additional context properties
    for (const [key, value] of Object.entries(context)) {
      if (!(key in variables) && value !== undefined && value !== null) {
        variables[key] = this.formatContextValue(value);
      }
    }

    return variables;
  }

  /**
   * Format a value using the specified formatter
   *
   * @param value - Value to format
   * @param formatter - Formatter type to use
   * @returns Formatted string
   */
  formatValue(value: any, formatter?: FormatterType): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (!formatter) {
      return this.formatContextValue(value);
    }

    try {
      switch (formatter) {
        case 'formatDate':
          return this.formatDate(value);

        case 'formatDateTime':
          return this.formatDateTime(value);

        case 'formatCurrency':
          return this.formatCurrency(value);

        case 'formatStatus':
          return this.formatTaskStatus(value);

        case 'formatCommissionStatus':
          return this.formatCommissionStatus(value);

        case 'formatServiceOrderStatus':
          return this.formatServiceOrderStatus(value);

        case 'formatServiceOrderType':
          return this.formatServiceOrderType(value);

        case 'formatSector':
          return this.formatSector(value);

        case 'formatCustomer':
          return this.formatCustomer(value);

        case 'formatPaint':
          return this.formatPaint(value);

        default:
          return String(value);
      }
    } catch (error) {
      this.logger.warn(`Error formatting value with ${formatter}:`, error);
      return String(value);
    }
  }

  // =====================
  // Private Helper Methods
  // =====================

  /**
   * Get template string for a specific message type
   */
  private getTemplateForMessageType(
    template: ChannelTemplate | string,
    messageType: MessageType,
  ): string | null {
    // If template is a simple string, use it directly
    if (typeof template === 'string') {
      return template;
    }

    // If template is an object, get the specific message type
    const specificTemplate = template[messageType];
    if (specificTemplate) {
      return specificTemplate;
    }

    // Fallback to 'updated' if specific type not found
    if (messageType !== 'updated' && template.updated) {
      this.logger.debug(`Template for ${messageType} not found, falling back to 'updated'`);
      return template.updated;
    }

    return null;
  }

  /**
   * Get email template for a specific message type
   */
  private getEmailTemplateForMessageType(
    email: EmailTemplates | EmailTemplateContent,
    messageType: MessageType,
  ): EmailTemplateContent | null {
    // If it's a direct EmailTemplateContent (has subject property)
    if ('subject' in email) {
      return email as EmailTemplateContent;
    }

    // If it's EmailTemplates, get specific type
    const templates = email as EmailTemplates;
    const specificTemplate = templates[messageType];
    if (specificTemplate) {
      return specificTemplate;
    }

    // Fallback to 'updated'
    if (messageType !== 'updated' && templates.updated) {
      this.logger.debug(`Email template for ${messageType} not found, falling back to 'updated'`);
      return templates.updated;
    }

    return null;
  }

  /**
   * Get nested value from object using dot notation
   * e.g., getNestedValue(obj, 'task.name') returns obj.task.name
   */
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Format a context value for display
   */
  private formatContextValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }

    // Handle Date objects
    if (value instanceof Date) {
      return this.formatDateTime(value);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return 'Nenhum';
      }
      return `${value.length} item(s)`;
    }

    // Handle objects with name property
    if (typeof value === 'object' && value.name) {
      return String(value.name);
    }

    // Handle plain objects
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }

    // Handle booleans
    if (typeof value === 'boolean') {
      return value ? 'Sim' : 'Não';
    }

    return String(value);
  }

  /**
   * Format date as DD/MM/YYYY
   */
  private formatDate(value: any): string {
    try {
      const date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) {
        return String(value);
      }
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return String(value);
    }
  }

  /**
   * Format date and time as DD/MM/YYYY HH:mm
   */
  private formatDateTime(value: any): string {
    try {
      const date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) {
        return String(value);
      }
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }

  /**
   * Format time as HH:mm
   */
  private formatTime(value: any): string {
    try {
      const date = value instanceof Date ? value : new Date(value);
      if (isNaN(date.getTime())) {
        return String(value);
      }
      return date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }

  /**
   * Format currency as R$ X.XXX,XX
   */
  private formatCurrency(value: any): string {
    try {
      const num = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(num)) {
        return String(value);
      }
      return num.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
    } catch {
      return String(value);
    }
  }

  /**
   * Format task status enum to Portuguese label
   */
  private formatTaskStatus(value: any): string {
    const status = String(value) as TASK_STATUS;
    return TASK_STATUS_LABELS[status] || String(value);
  }

  /**
   * Format commission status enum to Portuguese label
   */
  private formatCommissionStatus(value: any): string {
    const status = String(value) as COMMISSION_STATUS;
    return COMMISSION_STATUS_LABELS[status] || String(value);
  }

  /**
   * Format service order status enum to Portuguese label
   */
  private formatServiceOrderStatus(value: any): string {
    const status = String(value) as SERVICE_ORDER_STATUS;
    return SERVICE_ORDER_STATUS_LABELS[status] || String(value);
  }

  /**
   * Format service order type enum to Portuguese label
   */
  private formatServiceOrderType(value: any): string {
    const type = String(value) as SERVICE_ORDER_TYPE;
    return SERVICE_ORDER_TYPE_LABELS[type] || String(value);
  }

  /**
   * Format sector - extract name from object or return string
   */
  private formatSector(value: any): string {
    if (typeof value === 'object' && value?.name) {
      return String(value.name);
    }
    return String(value);
  }

  /**
   * Format customer - extract fantasyName or name from object or return string
   */
  private formatCustomer(value: any): string {
    if (typeof value === 'object') {
      return String(value.fantasyName || value.name || value);
    }
    return String(value);
  }

  /**
   * Format paint - extract name or code from object or return string
   */
  private formatPaint(value: any): string {
    if (typeof value === 'object') {
      if (value.name && value.code) {
        return `${value.name} (${value.code})`;
      }
      return String(value.name || value.code || value);
    }
    return String(value);
  }
}
