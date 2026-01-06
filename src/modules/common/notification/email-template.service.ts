import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for email template data
 */
export interface EmailTemplateData {
  // Base layout variables
  subject?: string;
  userName?: string;
  logoUrl?: string;
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  actionUrl?: string;
  actionText?: string;
  footerNote?: string;
  helpUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
  unsubscribeUrl?: string;
  year?: number;

  // Template-specific content
  content?: string;

  // Additional dynamic properties
  [key: string]: any;
}

/**
 * Email template rendering options
 */
export interface RenderOptions {
  useLayout?: boolean;
  layoutPath?: string;
  inlineCss?: boolean;
}

/**
 * Service for rendering email templates using Handlebars
 */
@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly templatesPath: string;
  private readonly layoutsPath: string;
  private readonly templateCache: Map<string, HandlebarsTemplateDelegate>;

  constructor() {
    // Determine if running in production (compiled) or development
    const isProduction = process.env.NODE_ENV === 'production';
    const baseDir = isProduction ? path.join(__dirname, '..', '..', '..') : __dirname;

    this.templatesPath = path.join(baseDir, 'templates', 'email');
    this.layoutsPath = path.join(this.templatesPath, 'layouts');
    this.templateCache = new Map();

    this.registerHelpers();
    this.logger.log(`Email templates path: ${this.templatesPath}`);
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Equality helper
    Handlebars.registerHelper('eq', function (a: any, b: any) {
      return a === b;
    });

    // Not equal helper
    Handlebars.registerHelper('ne', function (a: any, b: any) {
      return a !== b;
    });

    // Greater than helper
    Handlebars.registerHelper('gt', function (a: number, b: number) {
      return a > b;
    });

    // Less than helper
    Handlebars.registerHelper('lt', function (a: number, b: number) {
      return a < b;
    });

    // And helper
    Handlebars.registerHelper('and', function (...args: any[]) {
      // Remove the last argument which is the Handlebars options object
      const conditions = args.slice(0, -1);
      return conditions.every(Boolean);
    });

    // Or helper
    Handlebars.registerHelper('or', function (...args: any[]) {
      // Remove the last argument which is the Handlebars options object
      const conditions = args.slice(0, -1);
      return conditions.some(Boolean);
    });

    // Format date helper
    Handlebars.registerHelper('formatDate', function (date: Date | string, format?: string) {
      if (!date) return '';

      const d = new Date(date);
      if (isNaN(d.getTime())) return date.toString();

      // Simple date formatting (can be enhanced with date-fns)
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');

      switch (format) {
        case 'short':
          return `${day}/${month}/${year}`;
        case 'long':
          return `${day}/${month}/${year} ${hours}:${minutes}`;
        case 'time':
          return `${hours}:${minutes}`;
        default:
          return `${day}/${month}/${year}`;
      }
    });

    // Currency helper
    Handlebars.registerHelper('currency', function (value: number, currency = 'BRL') {
      if (typeof value !== 'number') return value;

      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: currency,
      }).format(value);
    });

    // Pluralize helper
    Handlebars.registerHelper(
      'pluralize',
      function (count: number, singular: string, plural: string) {
        return count === 1 ? singular : plural;
      },
    );

    // Uppercase helper
    Handlebars.registerHelper('uppercase', function (str: string) {
      return str ? str.toUpperCase() : '';
    });

    // Lowercase helper
    Handlebars.registerHelper('lowercase', function (str: string) {
      return str ? str.toLowerCase() : '';
    });

    // Capitalize helper
    Handlebars.registerHelper('capitalize', function (str: string) {
      return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
    });

    // Truncate helper
    Handlebars.registerHelper('truncate', function (str: string, length: number) {
      if (!str || str.length <= length) return str;
      return str.substring(0, length) + '...';
    });

    // Default value helper
    Handlebars.registerHelper('default', function (value: any, defaultValue: any) {
      return value != null ? value : defaultValue;
    });

    this.logger.log('Handlebars helpers registered');
  }

  /**
   * Load a template from disk
   */
  private loadTemplate(templatePath: string): string {
    try {
      const fullPath = path.join(this.templatesPath, templatePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`Template file not found: ${fullPath}`);
      }

      return fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      this.logger.error(`Error loading template ${templatePath}:`, error);
      throw error;
    }
  }

  /**
   * Load the base layout template
   */
  private loadLayout(layoutName = 'base.html'): string {
    try {
      const layoutPath = path.join(this.layoutsPath, layoutName);

      if (!fs.existsSync(layoutPath)) {
        throw new Error(`Layout file not found: ${layoutPath}`);
      }

      return fs.readFileSync(layoutPath, 'utf-8');
    } catch (error) {
      this.logger.error(`Error loading layout ${layoutName}:`, error);
      throw error;
    }
  }

  /**
   * Compile a template with caching
   */
  private compileTemplate(templateSource: string, cacheKey?: string): HandlebarsTemplateDelegate {
    if (cacheKey && this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey)!;
    }

    const compiled = Handlebars.compile(templateSource);

    if (cacheKey) {
      this.templateCache.set(cacheKey, compiled);
    }

    return compiled;
  }

  /**
   * Render a template with data
   *
   * @param templateName - Name of the template (e.g., 'task/status-change.html')
   * @param data - Data to pass to the template
   * @param options - Rendering options
   * @returns Rendered HTML string
   */
  public render(
    templateName: string,
    data: EmailTemplateData,
    options: RenderOptions = {},
  ): string {
    try {
      const { useLayout = true, layoutPath = 'base.html' } = options;

      // Set default values
      const templateData: EmailTemplateData = {
        companyName: process.env.COMPANY_NAME || 'Sua Empresa',
        companyAddress: process.env.COMPANY_ADDRESS,
        companyPhone: process.env.COMPANY_PHONE,
        companyEmail: process.env.COMPANY_EMAIL || 'contato@empresa.com',
        logoUrl: process.env.COMPANY_LOGO_URL,
        actionText: 'Ver Detalhes',
        year: new Date().getFullYear(),
        helpUrl: process.env.HELP_URL || '#',
        privacyUrl: process.env.PRIVACY_URL || '#',
        termsUrl: process.env.TERMS_URL || '#',
        ...data,
      };

      // Load and compile the content template
      const templateSource = this.loadTemplate(templateName);
      const contentTemplate = this.compileTemplate(templateSource, templateName);
      const renderedContent = contentTemplate(templateData);

      // If not using layout, return content directly
      if (!useLayout) {
        return renderedContent;
      }

      // Load and compile the layout
      const layoutSource = this.loadLayout(layoutPath);
      const layoutTemplate = this.compileTemplate(layoutSource, `layout:${layoutPath}`);

      // Render the layout with the content
      const finalHtml = layoutTemplate({
        ...templateData,
        content: renderedContent,
      });

      return finalHtml;
    } catch (error) {
      this.logger.error(`Error rendering template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Render a template directly from a string
   *
   * @param templateString - Template string
   * @param data - Data to pass to the template
   * @returns Rendered HTML string
   */
  public renderString(templateString: string, data: EmailTemplateData): string {
    try {
      const template = Handlebars.compile(templateString);
      return template(data);
    } catch (error) {
      this.logger.error('Error rendering template string:', error);
      throw error;
    }
  }

  /**
   * Clear the template cache
   */
  public clearCache(): void {
    this.templateCache.clear();
    this.logger.log('Template cache cleared');
  }

  /**
   * Check if a template exists
   */
  public templateExists(templateName: string): boolean {
    const fullPath = path.join(this.templatesPath, templateName);
    return fs.existsSync(fullPath);
  }

  /**
   * Get available templates in a category
   */
  public getAvailableTemplates(category?: string): string[] {
    try {
      const searchPath = category ? path.join(this.templatesPath, category) : this.templatesPath;

      if (!fs.existsSync(searchPath)) {
        return [];
      }

      const files = fs.readdirSync(searchPath);
      return files.filter(file => file.endsWith('.html'));
    } catch (error) {
      this.logger.error(`Error getting available templates:`, error);
      return [];
    }
  }

  /**
   * Precompile and cache commonly used templates
   */
  public warmupCache(templateNames: string[]): void {
    this.logger.log(`Warming up template cache with ${templateNames.length} templates`);

    for (const templateName of templateNames) {
      try {
        const templateSource = this.loadTemplate(templateName);
        this.compileTemplate(templateSource, templateName);
      } catch (error) {
        this.logger.warn(`Failed to warm up template ${templateName}:`, error);
      }
    }

    this.logger.log('Template cache warmup complete');
  }

  /**
   * Render email with multipart text/html support
   * Returns both plain text and HTML versions
   */
  public renderMultipart(
    templateName: string,
    data: EmailTemplateData,
    options: RenderOptions = {},
  ): { html: string; text: string } {
    const html = this.render(templateName, data, options);

    // Generate plain text version by stripping HTML tags
    // This is a simple implementation - can be enhanced with a proper HTML-to-text library
    const text = this.htmlToText(html);

    return { html, text };
  }

  /**
   * Simple HTML to text conversion
   * Can be enhanced with libraries like html-to-text
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }
}
