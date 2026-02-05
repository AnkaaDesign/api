import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Handlebars Template Service
 * Provides template compilation and rendering with Handlebars engine
 */
@Injectable()
export class HandlebarsTemplateService {
  private readonly logger = new Logger(HandlebarsTemplateService.name);
  private readonly templateCache = new Map<string, Handlebars.TemplateDelegate>();
  private readonly templatesDir: string;

  constructor() {
    // Set templates directory from environment or use default
    this.templatesDir =
      process.env.EMAIL_TEMPLATES_DIR || path.join(process.cwd(), 'src', 'templates', 'emails');

    // Register custom helpers
    this.registerHelpers();

    this.logger.log(`Handlebars template service initialized with directory: ${this.templatesDir}`);
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Date formatting helper
    Handlebars.registerHelper('formatDate', (date: Date | string, format?: string) => {
      if (!date) return '';

      const dateObj = typeof date === 'string' ? new Date(date) : date;

      if (format === 'short') {
        return dateObj.toLocaleDateString('pt-BR');
      } else if (format === 'long') {
        return dateObj.toLocaleDateString('pt-BR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } else if (format === 'datetime') {
        return dateObj.toLocaleString('pt-BR');
      }

      return dateObj.toLocaleDateString('pt-BR');
    });

    // Currency formatting helper
    Handlebars.registerHelper('formatCurrency', (value: number, currency = 'BRL') => {
      if (value === null || value === undefined) return '';

      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: currency,
      }).format(value);
    });

    // Number formatting helper
    Handlebars.registerHelper('formatNumber', (value: number, decimals = 2) => {
      if (value === null || value === undefined) return '';

      return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    });

    // Conditional equality helper
    Handlebars.registerHelper('eq', (a: any, b: any) => {
      return a === b;
    });

    // Conditional not equal helper
    Handlebars.registerHelper('neq', (a: any, b: any) => {
      return a !== b;
    });

    // Conditional greater than helper
    Handlebars.registerHelper('gt', (a: number, b: number) => {
      return a > b;
    });

    // Conditional less than helper
    Handlebars.registerHelper('lt', (a: number, b: number) => {
      return a < b;
    });

    // Logical OR helper
    Handlebars.registerHelper('or', (...args: any[]) => {
      // Remove the Handlebars options object (last argument)
      const values = args.slice(0, -1);
      return values.some(val => !!val);
    });

    // Logical AND helper
    Handlebars.registerHelper('and', (...args: any[]) => {
      // Remove the Handlebars options object (last argument)
      const values = args.slice(0, -1);
      return values.every(val => !!val);
    });

    // Uppercase helper
    Handlebars.registerHelper('uppercase', (str: string) => {
      return str ? str.toUpperCase() : '';
    });

    // Lowercase helper
    Handlebars.registerHelper('lowercase', (str: string) => {
      return str ? str.toLowerCase() : '';
    });

    // Capitalize helper
    Handlebars.registerHelper('capitalize', (str: string) => {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    });

    // Truncate helper
    Handlebars.registerHelper('truncate', (str: string, length = 50, suffix = '...') => {
      if (!str || str.length <= length) return str;
      return str.substring(0, length) + suffix;
    });

    // JSON stringify helper
    Handlebars.registerHelper('json', (obj: any) => {
      return JSON.stringify(obj, null, 2);
    });

    // Default value helper
    Handlebars.registerHelper('default', (value: any, defaultValue: any) => {
      return value !== null && value !== undefined ? value : defaultValue;
    });

    // Array length helper
    Handlebars.registerHelper('length', (array: any[]) => {
      return Array.isArray(array) ? array.length : 0;
    });

    // Array join helper
    Handlebars.registerHelper('join', (array: any[], separator = ', ') => {
      return Array.isArray(array) ? array.join(separator) : '';
    });

    // Math helpers
    Handlebars.registerHelper('add', (a: number, b: number) => a + b);
    Handlebars.registerHelper('subtract', (a: number, b: number) => a - b);
    Handlebars.registerHelper('multiply', (a: number, b: number) => a * b);
    Handlebars.registerHelper('divide', (a: number, b: number) => (b !== 0 ? a / b : 0));

    this.logger.log('Handlebars helpers registered successfully');
  }

  /**
   * Compile a template from string
   * @param templateString - Template content as string
   * @param cacheName - Optional cache name for reuse
   * @returns Compiled template function
   */
  compileTemplate(templateString: string, cacheName?: string): Handlebars.TemplateDelegate {
    try {
      // Check cache if name provided
      if (cacheName && this.templateCache.has(cacheName)) {
        return this.templateCache.get(cacheName)!;
      }

      // Compile template
      const compiled = Handlebars.compile(templateString);

      // Cache if name provided
      if (cacheName) {
        this.templateCache.set(cacheName, compiled);
      }

      return compiled;
    } catch (error) {
      this.logger.error(`Failed to compile template: ${error.message}`, error.stack);
      throw new Error(`Template compilation failed: ${error.message}`);
    }
  }

  /**
   * Load and compile a template from file
   * @param templateName - Name of template file (without extension)
   * @param subDirectory - Optional subdirectory within templates folder
   * @returns Compiled template function
   */
  async loadTemplate(
    templateName: string,
    subDirectory?: string,
  ): Promise<Handlebars.TemplateDelegate> {
    const cacheKey = subDirectory ? `${subDirectory}/${templateName}` : templateName;

    // Check cache
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey)!;
    }

    try {
      // Build file path
      const templatePath = subDirectory
        ? path.join(this.templatesDir, subDirectory, `${templateName}.hbs`)
        : path.join(this.templatesDir, `${templateName}.hbs`);

      // Check if file exists
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath}`);
      }

      // Read template file
      const templateContent = fs.readFileSync(templatePath, 'utf-8');

      // Compile and cache
      const compiled = Handlebars.compile(templateContent);
      this.templateCache.set(cacheKey, compiled);

      this.logger.log(`Template loaded and compiled: ${cacheKey}`);

      return compiled;
    } catch (error) {
      this.logger.error(`Failed to load template ${cacheKey}: ${error.message}`, error.stack);
      throw new Error(`Template loading failed: ${error.message}`);
    }
  }

  /**
   * Register a partial template
   * @param name - Partial name
   * @param templateString - Partial template content
   */
  registerPartial(name: string, templateString: string): void {
    try {
      Handlebars.registerPartial(name, templateString);
      this.logger.log(`Partial registered: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to register partial ${name}: ${error.message}`, error.stack);
      throw new Error(`Partial registration failed: ${error.message}`);
    }
  }

  /**
   * Load and register a partial from file
   * @param name - Partial name
   * @param fileName - File name (without extension)
   */
  async loadPartial(name: string, fileName?: string): Promise<void> {
    const actualFileName = fileName || name;

    try {
      const partialPath = path.join(this.templatesDir, 'partials', `${actualFileName}.hbs`);

      if (!fs.existsSync(partialPath)) {
        throw new Error(`Partial file not found: ${partialPath}`);
      }

      const partialContent = fs.readFileSync(partialPath, 'utf-8');
      Handlebars.registerPartial(name, partialContent);

      this.logger.log(`Partial loaded and registered: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to load partial ${name}: ${error.message}`, error.stack);
      throw new Error(`Partial loading failed: ${error.message}`);
    }
  }

  /**
   * Load all partials from the partials directory
   */
  async loadAllPartials(): Promise<void> {
    const partialsDir = path.join(this.templatesDir, 'partials');

    try {
      // Check if partials directory exists
      if (!fs.existsSync(partialsDir)) {
        this.logger.warn(`Partials directory not found: ${partialsDir}`);
        return;
      }

      // Read all .hbs files in partials directory
      const files = fs.readdirSync(partialsDir).filter(file => file.endsWith('.hbs'));

      for (const file of files) {
        const partialName = path.basename(file, '.hbs');
        const partialPath = path.join(partialsDir, file);
        const partialContent = fs.readFileSync(partialPath, 'utf-8');

        Handlebars.registerPartial(partialName, partialContent);
        this.logger.log(`Partial loaded: ${partialName}`);
      }

      this.logger.log(`Loaded ${files.length} partials from ${partialsDir}`);
    } catch (error) {
      this.logger.error(`Failed to load partials: ${error.message}`, error.stack);
    }
  }

  /**
   * Render a template with data
   * @param templateName - Template name or compiled template
   * @param data - Data to pass to template
   * @param subDirectory - Optional subdirectory for file-based templates
   * @returns Rendered HTML string
   */
  async render(
    templateName: string | Handlebars.TemplateDelegate,
    data: any,
    subDirectory?: string,
  ): Promise<string> {
    try {
      let template: Handlebars.TemplateDelegate;

      if (typeof templateName === 'string') {
        template = await this.loadTemplate(templateName, subDirectory);
      } else {
        template = templateName;
      }

      return template(data);
    } catch (error) {
      this.logger.error(`Failed to render template: ${error.message}`, error.stack);
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  /**
   * Clear template cache
   * @param templateName - Optional specific template to clear, or all if not provided
   */
  clearCache(templateName?: string): void {
    if (templateName) {
      this.templateCache.delete(templateName);
      this.logger.log(`Template cache cleared for: ${templateName}`);
    } else {
      this.templateCache.clear();
      this.logger.log('All template cache cleared');
    }
  }

  /**
   * Get templates directory path
   * @returns Templates directory absolute path
   */
  getTemplatesDirectory(): string {
    return this.templatesDir;
  }

  /**
   * Check if template file exists
   * @param templateName - Template name
   * @param subDirectory - Optional subdirectory
   * @returns True if template exists
   */
  templateExists(templateName: string, subDirectory?: string): boolean {
    const templatePath = subDirectory
      ? path.join(this.templatesDir, subDirectory, `${templateName}.hbs`)
      : path.join(this.templatesDir, `${templateName}.hbs`);

    return fs.existsSync(templatePath);
  }

  /**
   * Register a custom helper
   * @param name - Helper name
   * @param fn - Helper function
   */
  registerHelper(name: string, fn: Handlebars.HelperDelegate): void {
    Handlebars.registerHelper(name, fn);
    this.logger.log(`Custom helper registered: ${name}`);
  }

  /**
   * Unregister a helper
   * @param name - Helper name
   */
  unregisterHelper(name: string): void {
    Handlebars.unregisterHelper(name);
    this.logger.log(`Helper unregistered: ${name}`);
  }

  /**
   * Unregister a partial
   * @param name - Partial name
   */
  unregisterPartial(name: string): void {
    Handlebars.unregisterPartial(name);
    this.logger.log(`Partial unregistered: ${name}`);
  }
}
