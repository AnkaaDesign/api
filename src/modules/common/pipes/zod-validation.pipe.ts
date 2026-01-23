// modules/common/pipes/zod-validation.pipe.ts

import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError, ZodIssue } from 'zod';

interface ValidationErrorResponse {
  message: string;
  errors: string[];
  statusCode: number;
}

interface FormattedZodError {
  field: string;
  message: string;
  code: string;
  value?: unknown;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    try {
      // Skip validation for certain metadata types
      if (metadata.type === 'param' || metadata.type === 'custom') {
        return value;
      }

      // For query parameters, use special handling
      if (metadata.type === 'query') {
        const transformedValue = this.transformQueryParams(value);
        return this.schema.parse(transformedValue);
      }

      // For body parameters, fix arrays before validation
      if (metadata.type === 'body') {
        const fixedValue = this.fixArrays(value);
        return this.schema.parse(fixedValue);
      }

      // Parse and validate the value
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        // Log the detailed Zod error for debugging
        if (process.env.NODE_ENV !== 'production') {
          console.error('[ZodValidationPipe] Zod validation error:', {
            issues: error.issues,
            value: value,
            schema: this.schema.constructor.name,
          });
        }

        const formattedErrors = this.formatZodErrors(error.issues);
        const errorResponse = this.createErrorResponse(formattedErrors, metadata.type);
        throw new BadRequestException(errorResponse);
      }

      // Log the actual error for debugging
      console.error('[ZodValidationPipe] Non-ZodError caught:', {
        errorType: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        value: value,
      });

      throw new BadRequestException({
        message: 'Falha na validação dos dados enviados',
        errors: [error instanceof Error ? error.message : 'Erro desconhecido durante a validação'],
        statusCode: 400,
      } as ValidationErrorResponse);
    }
  }

  private transformQueryParams(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const transformed: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined || val === null) {
        transformed[key] = val;
        continue;
      }

      if (typeof val !== 'string') {
        transformed[key] = val;
        continue;
      }

      // Handle array-like strings (comma-separated values)
      if (val.includes(',') && this.shouldParseAsArray(key)) {
        transformed[key] = val
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
        continue;
      }

      // Handle boolean strings
      if (val === 'true') {
        transformed[key] = true;
        continue;
      }
      if (val === 'false') {
        transformed[key] = false;
        continue;
      }

      // Handle number strings (but skip fields that should remain as strings)
      if (this.isNumericString(val) && !this.shouldKeepFieldAsString(key)) {
        const numValue = Number(val);
        if (!isNaN(numValue)) {
          transformed[key] = numValue;
          continue;
        }
      }

      // Handle date strings
      if (this.isDateString(val)) {
        const date = new Date(val);
        if (!isNaN(date.getTime())) {
          transformed[key] = date;
          continue;
        }
      }

      // Handle JSON strings (commonly used for include parameters)
      if (key === 'include' && (val.startsWith('{') || val.startsWith('['))) {
        try {
          const parsed = JSON.parse(val);
          if (typeof parsed === 'object' && parsed !== null) {
            transformed[key] = parsed;
            continue;
          }
        } catch (e) {
          // Not valid JSON, keep as string
        }
      }

      // Keep as string
      transformed[key] = val;
    }

    return transformed;
  }

  private formatZodErrors(issues: ZodIssue[]): FormattedZodError[] {
    return issues.map(issue => {
      const field = this.getFieldPath(issue.path);
      const message = this.translateErrorMessage(issue);

      return {
        field,
        message,
        code: issue.code,
        value: issue.code !== 'invalid_type' ? (issue as any).received : undefined,
      };
    });
  }

  private getFieldPath(path: (string | number)[]): string {
    if (path.length === 0) return 'raiz';

    return path
      .map((segment, index) => {
        if (typeof segment === 'number') {
          return `[${segment}]`;
        }
        return index === 0 ? segment : `.${segment}`;
      })
      .join('');
  }

  private translateErrorMessage(issue: ZodIssue): string {
    const fieldName = this.getFieldDisplayName(issue.path);

    switch (issue.code) {
      case 'invalid_type':
        return this.getInvalidTypeMessage(issue, fieldName);

      case 'too_small':
        return this.getTooSmallMessage(issue, fieldName);

      case 'too_big':
        return this.getTooBigMessage(issue, fieldName);

      case 'invalid_string':
        return this.getInvalidStringMessage(issue, fieldName);

      case 'invalid_date':
        return `${fieldName} deve ser uma data válida`;

      case 'invalid_enum_value':
        return `${fieldName} deve ser um dos valores: ${(issue as any).options?.join(', ') || 'valores válidos'}`;

      case 'unrecognized_keys':
        const keys = (issue as any).keys?.join(', ') || 'campos';
        return `Campos não reconhecidos: ${keys}`;

      case 'invalid_union':
        return `${fieldName} não atende a nenhum dos formatos válidos`;

      case 'custom':
        return issue.message || `${fieldName} contém valor inválido`;

      default:
        return issue.message || `${fieldName} é inválido`;
    }
  }

  private getFieldDisplayName(path: (string | number)[]): string {
    if (path.length === 0) return 'Campo';

    const fieldMappings: Record<string, string> = {
      name: 'Nome',
      email: 'E-mail',
      password: 'Senha',
      status: 'Status',
      customerId: 'Cliente',
      sectorId: 'Setor',
      userId: 'Usuário',
      paintId: 'Tinta',
      serialNumber: 'Número de série',
      details: 'Detalhes',
      entryDate: 'Data de entrada',
      term: 'Prazo',
      startedAt: 'Data de início',
      finishedAt: 'Data de finalização',
      commission: 'Comissão',
      services: 'Serviços',
      location: 'Localização',
      observation: 'Observação',
      truck: 'Caminhão',
      fileIds: 'Arquivos',
      paintIds: 'Tintas',
    };

    const mainField = path[0]?.toString() || '';
    return fieldMappings[mainField] || mainField.charAt(0).toUpperCase() + mainField.slice(1);
  }

  private getInvalidTypeMessage(
    issue: ZodIssue & { expected: string; received: string },
    fieldName: string,
  ): string {
    const typeMap: Record<string, string> = {
      string: 'texto',
      number: 'número',
      boolean: 'verdadeiro/falso',
      date: 'data',
      array: 'lista',
      object: 'objeto',
    };

    const expected = typeMap[issue.expected] || issue.expected;
    const received = typeMap[issue.received] || issue.received;

    if (issue.received === 'undefined') {
      return `${fieldName} é obrigatório`;
    }

    if (issue.received === 'null') {
      return `${fieldName} não pode ser nulo`;
    }

    return `${fieldName} deve ser do tipo ${expected}, mas foi recebido ${received}`;
  }

  private getTooSmallMessage(
    issue: ZodIssue & { minimum: number | bigint; inclusive: boolean; type: string },
    fieldName: string,
  ): string {
    const { minimum, inclusive, type } = issue;
    // Convert bigint to number for display purposes
    const minValue = typeof minimum === 'bigint' ? Number(minimum) : minimum;

    switch (type) {
      case 'string':
        return inclusive
          ? `${fieldName} deve ter pelo menos ${minValue} caracteres`
          : `${fieldName} deve ter mais de ${minValue} caracteres`;

      case 'number':
        return inclusive
          ? `${fieldName} deve ser maior ou igual a ${minValue}`
          : `${fieldName} deve ser maior que ${minValue}`;

      case 'array':
        return inclusive
          ? `${fieldName} deve conter pelo menos ${minValue} itens`
          : `${fieldName} deve conter mais de ${minValue} itens`;

      case 'date':
        return `${fieldName} deve ser posterior a ${new Date(minValue).toLocaleDateString('pt-BR')}`;

      default:
        return `${fieldName} é muito pequeno (mínimo: ${minValue})`;
    }
  }

  private getTooBigMessage(
    issue: ZodIssue & { maximum: number | bigint; inclusive: boolean; type: string },
    fieldName: string,
  ): string {
    const { maximum, inclusive, type } = issue;
    // Convert bigint to number for display purposes
    const maxValue = typeof maximum === 'bigint' ? Number(maximum) : maximum;

    switch (type) {
      case 'string':
        return inclusive
          ? `${fieldName} deve ter no máximo ${maxValue} caracteres`
          : `${fieldName} deve ter menos de ${maxValue} caracteres`;

      case 'number':
        return inclusive
          ? `${fieldName} deve ser menor ou igual a ${maxValue}`
          : `${fieldName} deve ser menor que ${maxValue}`;

      case 'array':
        return inclusive
          ? `${fieldName} deve conter no máximo ${maxValue} itens`
          : `${fieldName} deve conter menos de ${maxValue} itens`;

      case 'date':
        return `${fieldName} deve ser anterior a ${new Date(maxValue).toLocaleDateString('pt-BR')}`;

      default:
        return `${fieldName} é muito grande (máximo: ${maxValue})`;
    }
  }

  private getInvalidStringMessage(
    issue: ZodIssue & { validation: string | object },
    fieldName: string,
  ): string {
    const { validation } = issue;

    // Handle string validations
    if (typeof validation === 'string') {
      switch (validation) {
        case 'email':
          return `${fieldName} deve ser um e-mail válido`;
        case 'url':
          return `${fieldName} deve ser uma URL válida`;
        case 'uuid':
          return `${fieldName} deve ser um UUID válido`;
        case 'cuid':
          return `${fieldName} deve ser um CUID válido`;
        case 'regex':
          return `${fieldName} não atende ao formato exigido`;
        case 'datetime':
          return `${fieldName} deve ser uma data e hora válida`;
        default:
          return `${fieldName} contém formato inválido`;
      }
    }

    // Handle object validations (like includes, startsWith, endsWith, etc.)
    if (typeof validation === 'object' && validation !== null) {
      if ('includes' in validation) {
        return `${fieldName} deve conter "${(validation as any).includes}"`;
      }
      if ('startsWith' in validation) {
        return `${fieldName} deve começar com "${(validation as any).startsWith}"`;
      }
      if ('endsWith' in validation) {
        return `${fieldName} deve terminar com "${(validation as any).endsWith}"`;
      }
    }

    return `${fieldName} contém formato inválido`;
  }

  private createErrorResponse(
    errors: FormattedZodError[],
    metadataType?: string,
  ): ValidationErrorResponse {
    const contextMessages: Record<string, string> = {
      body: 'Dados do corpo da requisição inválidos',
      query: 'Parâmetros de consulta inválidos',
      param: 'Parâmetros da URL inválidos',
    };

    const contextMessage = contextMessages[metadataType || 'body'] || 'Dados de entrada inválidos';

    const errorMessages = errors.map(error => {
      return error.field === 'raiz' ? error.message : `${error.field}: ${error.message}`;
    });

    return {
      message: `${contextMessage}. Corrija os erros abaixo e tente novamente.`,
      errors: errorMessages,
      statusCode: 400,
    };
  }

  private shouldParseAsArray(fieldName: string): boolean {
    const arrayFields = [
      'status',
      'customerId',
      'sectorId',
      'userId',
      'paintId',
      'fileIds',
      'paintIds',
      'taskIds',
      'tags',
      'permissions',
      'categoryIds',
      'brandIds',
      'supplierIds',
    ];

    return arrayFields.some(field => fieldName.includes(field));
  }

  private isNumericString(value: string): boolean {
    return /^-?\d+(\.\d+)?$/.test(value.trim());
  }

  private isDateString(value: string): boolean {
    // Check for ISO date format or common date patterns
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
    const commonDatePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

    return isoDatePattern.test(value) || commonDatePattern.test(value);
  }

  private shouldKeepFieldAsString(fieldName: string): boolean {
    // Fields that should always be kept as strings, even if they look like numbers
    const stringOnlyFields = [
      'barcode',
      'barcodes', // Barcode fields
      'cpf',
      'cnpj',
      'pis', // Brazilian document fields
      'phone',
      'phoneNumber',
      'phoneNumbers', // Phone numbers
      'zipCode',
      'cep', // Postal codes
      'code',
      'uniCode', // Various code fields
      'serialNumber', // Serial numbers
      'searchingFor', // Search fields should remain as strings
    ];

    // Check if the field name contains any of these string-only field names
    return stringOnlyFields.some(field => fieldName.toLowerCase().includes(field.toLowerCase()));
  }

  protected fixArrays(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.fixArrays(item));
    }

    // Handle JSON strings (from FormData)
    if (typeof obj === 'string') {
      try {
        const parsed = JSON.parse(obj);
        // Only process if it's an object or array
        if (typeof parsed === 'object' && parsed !== null) {
          return this.fixArrays(parsed);
        }
      } catch (e) {
        // Not JSON, return as-is
        return obj;
      }
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    // Don't process Date objects - they are valid values
    if (obj instanceof Date) {
      return obj;
    }

    // Check if this object looks like a serialized array
    if (this.isSerializedArray(obj)) {
      return this.convertToArray(obj);
    }

    // Recursively fix nested objects and convert string values to proper types
    const fixed: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip internal context field
      if (key === '_context') {
        continue;
      }

      // Convert boolean strings to booleans (FormData sends "true"/"false" as strings)
      if (typeof value === 'string') {
        if (value === 'true') {
          fixed[key] = true;
          continue;
        }
        if (value === 'false') {
          fixed[key] = false;
          continue;
        }

        // CRITICAL: Convert empty strings to null for nullable fields
        // FormData converts null values to empty strings, we need to convert back
        // This handles: UUID fields (logoId), enum fields (streetType, state), etc.
        if (value === '' && this.shouldConvertEmptyToNull(key)) {
          fixed[key] = null;
          continue;
        }

        // Convert numeric strings to numbers for known numeric fields
        if (this.isNumericField(key) && this.isNumericString(value)) {
          const numValue = Number(value);
          if (!isNaN(numValue)) {
            fixed[key] = numValue;
            continue;
          }
        }
      }
      fixed[key] = this.fixArrays(value);
    }

    return fixed;
  }

  private isNumericField(fieldName: string): boolean {
    // Fields that should be converted from string to number when they contain numeric strings
    // This is necessary because FormData sends everything as strings
    const numericFields = [
      // Layout fields
      'height',
      'width',
      'doorHeight',
      'doorOffset',
      'position',
      // Order/Item fields
      'price',
      'unitPrice',
      'amount',
      'quantity',
      'orderedQuantity',
      'receivedQuantity',
      'total',
      'subtotal',
      'discount',
      'tax',
      'fee',
      'ipi',
      'icms',
      'boxQuantity',
      'maxQuantity',
      'minQuantity',
      'leadTime',
      'stockQuantity',
      // Maintenance/Schedule fields
      'timeTaken',
      'frequencyCount',
      'dayOfMonth',
      'rescheduleCount',
      // User/HR fields
      'performanceLevel',
      'payrollNumber',
      'statusOrder',
      // Measure fields
      'value',
      // Task fields
      'xPosition',
      'yPosition',
      // Time clock/Geolocation fields
      'dayType',
      'latitude',
      'longitude',
      'accuracy',
      // Filter/Range fields (when sent in body)
      'min',
      'max',
      'from',
      'to',
      // Paint formula fields
      'componentQuantity',
      'componentPercentage',
      'percentage',
      // Cut fields
      '_fileIndex',
      // Bonus fields
      'bonusAmount',
      'deductionAmount',
      // EPI/PPE fields
      'deliveryQuantity',
      'requestedQuantity',
      // Commission fields
      'commission',
      'rate',
    ];
    return numericFields.includes(fieldName);
  }

  /**
   * Determines if an empty string should be converted to null
   * This is necessary because FormData converts null values to empty strings
   * We need to convert them back for proper Zod validation of nullable fields
   */
  private shouldConvertEmptyToNull(fieldName: string): boolean {
    // Fields ending with 'Id' are typically UUIDs and should be null when empty
    if (fieldName.endsWith('Id')) {
      return true;
    }

    // Fields ending with 'Type' are typically enums and should be null when empty
    if (fieldName.endsWith('Type')) {
      return true;
    }

    // Specific enum fields that don't follow the naming convention
    const enumFields = [
      'state',
      'status',
      'role',
      'sector',
      'priority',
      'category',
      'method',
      'frequency',
      'dayOfWeek',
      'position',
      'streetType',
    ];

    // Fields that should be null when empty (optional nullable fields)
    const nullableFields = [
      'email',
      'phone',
      'cnpj',
      'cpf',
      'pis',
      'cnh',
      'zipCode',
      'cep',
      'address',
      'addressNumber',
      'addressComplement',
      'neighborhood',
      'city',
      'country',
      'site',
      'pix',
      'corporateName',
      'fantasyName',
      'observations',
      'notes',
      'description',
      'complement',
      'reference',
      'representativeName',
    ];

    const lowerFieldName = fieldName.toLowerCase();
    return enumFields.some(f => lowerFieldName === f.toLowerCase()) ||
           nullableFields.some(f => lowerFieldName === f.toLowerCase());
  }

  protected isSerializedArray(obj: any): boolean {
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;

    // Check if all keys are PURELY numeric (not just starting with a digit)
    // This prevents UUIDs like "0c656895-..." from being mistaken as array indices
    // parseInt("0c656895-...") incorrectly returns 0, so we use regex instead
    const isNumericKey = (k: string) => /^\d+$/.test(k);
    if (!keys.every(isNumericKey)) return false;

    // Check if keys are sequential starting from 0
    const numericKeys = keys.map(k => parseInt(k, 10));
    numericKeys.sort((a, b) => a - b);
    return numericKeys.every((key, index) => key === index);
  }

  protected convertToArray(obj: any): any[] {
    const keys = Object.keys(obj)
      .map(k => parseInt(k, 10))
      .sort((a, b) => a - b);
    const array: any[] = [];

    for (const key of keys) {
      array.push(this.fixArrays(obj[key.toString()]));
    }

    return array;
  }
}

// Alternative pipe specifically for query parameters with enhanced transformation
@Injectable()
export class ZodQueryValidationPipe extends ZodValidationPipe {
  constructor(schema: ZodSchema) {
    super(schema);
  }

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Only process query parameters
    if (metadata.type !== 'query') {
      return value;
    }

    // Parse dot notation in query parameters
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const parsed: any = {};

      // First pass: handle searchingFor field specially to keep it as string
      if ('searchingFor' in value) {
        // Always convert searchingFor to string, even if it arrives as a number
        parsed.searchingFor = String(value.searchingFor);
        if (process.env.NODE_ENV !== 'production') {
          console.log(
            '[ZodQueryValidationPipe] Converted searchingFor to string:',
            parsed.searchingFor,
          );
        }
      }

      for (const [key, val] of Object.entries(value)) {
        // Skip searchingFor as it's already handled
        if (key === 'searchingFor') {
          continue;
        }
        // Handle array notation with nested brackets (e.g., where[status][in][] -> where.status.in)
        if (key.endsWith('[]') && key.includes('[')) {
          const keyWithoutArraySuffix = key.slice(0, -2); // Remove the [] suffix

          // Check if this is nested bracket notation
          const matches = keyWithoutArraySuffix.match(/^([^\[]+)(.+)$/);
          if (matches) {
            const basePath = matches[1];
            const bracketPath = matches[2];

            // Extract all bracket parts
            const bracketParts = bracketPath.match(/\[([^\]]+)\]/g);
            if (bracketParts) {
              let current = parsed;

              // Initialize base path
              if (!current[basePath]) {
                current[basePath] = {};
              }
              current = current[basePath];

              // Navigate through bracket parts
              for (let i = 0; i < bracketParts.length - 1; i++) {
                const part = bracketParts[i].slice(1, -1); // Remove brackets
                if (!current[part]) {
                  current[part] = {};
                }
                current = current[part];
              }

              // Set the final array value
              const lastPart = bracketParts[bracketParts.length - 1].slice(1, -1);
              // Handle both single values and arrays
              if (Array.isArray(val)) {
                const pathParts = [basePath];
                for (let i = 0; i < bracketParts.length - 1; i++) {
                  pathParts.push(bracketParts[i].slice(1, -1));
                }
                pathParts.push(lastPart);
                current[lastPart] = val.map(v => this.transformValue(v, pathParts));
              } else {
                const pathParts = [basePath];
                for (let i = 0; i < bracketParts.length - 1; i++) {
                  pathParts.push(bracketParts[i].slice(1, -1));
                }
                pathParts.push(lastPart);
                current[lastPart] = [this.transformValue(val, pathParts)];
              }
              continue;
            }
          }

          // Handle simple array notation (e.g., categoryIds[] -> categoryIds)
          const baseKey = key.slice(0, -2); // Remove the [] suffix
          if (!parsed[baseKey]) {
            parsed[baseKey] = [];
          }
          // Handle both single values and arrays
          if (Array.isArray(val)) {
            parsed[baseKey] = val.map(v => this.transformValue(v, baseKey));
          } else {
            parsed[baseKey] = [this.transformValue(val, baseKey)];
          }
          continue;
        }

        // Handle bracket notation (e.g., prices[orderBy][createdAt] -> { prices: { orderBy: { createdAt: ... } } })
        if (key.includes('[') && !key.includes('.')) {
          const matches = key.match(/^([^\[]+)(.+)$/);
          if (matches) {
            const basePath = matches[1];
            const bracketPath = matches[2];

            // Extract all bracket parts
            const bracketParts = bracketPath.match(/\[([^\]]+)\]/g);
            if (bracketParts) {
              let current = parsed;

              // Initialize base path
              if (!current[basePath]) {
                current[basePath] = {};
              }
              current = current[basePath];

              // Navigate through bracket parts
              for (let i = 0; i < bracketParts.length - 1; i++) {
                const part = bracketParts[i].slice(1, -1); // Remove brackets
                if (!current[part]) {
                  current[part] = {};
                }
                current = current[part];
              }

              // Set the final value
              const lastPart = bracketParts[bracketParts.length - 1].slice(1, -1);
              const pathParts = [basePath];
              for (let i = 0; i < bracketParts.length - 1; i++) {
                pathParts.push(bracketParts[i].slice(1, -1));
              }
              pathParts.push(lastPart);
              const transformedValue = this.transformValue(val, pathParts);
              current[lastPart] = transformedValue;
              continue;
            }
          }
        }

        // Handle dot notation with array brackets
        // e.g., "include.orderItems.where.order.status.in[]" or "include.orderItems.where.order.status.in[0]"
        // or "orderBy[0].status=asc" or "orderBy[1].createdAt=desc"

        // Check if this key has array index notation (e.g., orderBy[0].status)
        const arrayIndexMatch = key.match(/^([^\[]+)\[(\d+)\]\.(.+)$/);
        if (arrayIndexMatch) {
          const [, basePath, index, remainingPath] = arrayIndexMatch;
          const arrayIndex = parseInt(index, 10);

          // Initialize the array if it doesn't exist
          if (!parsed[basePath]) {
            parsed[basePath] = [];
          }

          // Ensure we have an object at this array index
          if (!parsed[basePath][arrayIndex]) {
            parsed[basePath][arrayIndex] = {};
          }

          // Parse the remaining path (e.g., "status" or "item.name")
          const remainingParts = remainingPath.split('.');
          let current = parsed[basePath][arrayIndex];

          for (let i = 0; i < remainingParts.length - 1; i++) {
            const part = remainingParts[i];
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }

          const lastPart = remainingParts[remainingParts.length - 1];
          current[lastPart] = this.transformValue(val, [basePath, ...remainingParts]);
          continue;
        }

        const keyWithoutBrackets = key.replace(/\[\d*\]$/, ''); // Remove array brackets at the end
        const isArrayNotation = key !== keyWithoutBrackets;

        if (keyWithoutBrackets.includes('.')) {
          const parts = keyWithoutBrackets.split('.');
          let current = parsed;

          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) {
              current[part] = {};
            } else if (typeof current[part] !== 'object' || Array.isArray(current[part])) {
              // If the current value is a primitive (like true) or an array, we need to convert it to an object
              // This handles cases like include.truck=true being overridden by include.truck.include.leftSideLayout=...
              current[part] = {};
            }
            current = current[part];
          }

          const lastPart = parts[parts.length - 1];

          // Handle array values
          if (isArrayNotation) {
            if (!current[lastPart]) {
              current[lastPart] = [];
            }
            if (Array.isArray(current[lastPart])) {
              current[lastPart].push(this.transformValue(val, parts));
            }
          } else {
            // Check if this is part of an array (when multiple values with same key exist)
            if (Array.isArray(val)) {
              current[lastPart] = val.map(v => this.transformValue(v, parts));
            } else {
              current[lastPart] = this.transformValue(val, parts);
            }
          }
        } else if (key.includes('[')) {
          // Handle bracket notation without dots (e.g., include[brand] or include[prices][orderBy][createdAt])
          const matches = key.match(/^([^\[]+)(.*)$/);
          if (matches) {
            const basePath = matches[1];
            const bracketPath = matches[2];

            if (bracketPath === '[true]' || bracketPath === '[false]') {
              // Handle boolean bracket notation (e.g., include[brand][true])
              parsed[basePath] = bracketPath === '[true]';
              continue;
            }

            // Extract all bracket parts
            const bracketParts = bracketPath.match(/\[([^\]]+)\]/g);
            if (bracketParts) {
              let current = parsed;

              // Initialize base path if needed
              if (!current[basePath]) {
                current[basePath] = {};
              }
              current = current[basePath];

              // Navigate through bracket parts
              for (let i = 0; i < bracketParts.length - 1; i++) {
                const part = bracketParts[i].slice(1, -1); // Remove brackets
                if (!current[part]) {
                  current[part] = {};
                }
                current = current[part];
              }

              // Set the final value
              const lastPart = bracketParts[bracketParts.length - 1].slice(1, -1);
              // Special handling for boolean strings and include syntax
              if (val === 'true' || lastPart === 'true') {
                try {
                  current[lastPart === 'true' ? Object.keys(current).pop() || lastPart : lastPart] =
                    true;
                } catch (e) {
                  // If the object is frozen/non-extensible, create a new object
                  if (process.env.NODE_ENV !== 'production') {
                    console.warn(
                      '[ZodQueryValidationPipe] Cannot modify object, creating new structure',
                      e,
                    );
                  }
                  // Skip this assignment as it's likely a parse error
                }
              } else {
                const pathParts = [basePath];
                for (let i = 0; i < bracketParts.length - 1; i++) {
                  pathParts.push(bracketParts[i].slice(1, -1));
                }
                pathParts.push(lastPart);
                try {
                  current[lastPart] = this.transformValue(val, pathParts);
                } catch (e) {
                  if (process.env.NODE_ENV !== 'production') {
                    console.warn('[ZodQueryValidationPipe] Cannot set value on object', e);
                  }
                }
              }
            } else {
              parsed[key] = this.transformValue(val, key);
            }
          }
        } else {
          // Handle keys without dots but with array notation
          const baseKey = keyWithoutBrackets;
          if (isArrayNotation) {
            if (!parsed[baseKey]) {
              parsed[baseKey] = [];
            }
            if (Array.isArray(parsed[baseKey])) {
              parsed[baseKey].push(this.transformValue(val, baseKey));
            }
          } else {
            parsed[key] = this.transformValue(val, [key]);
          }
        }
      }

      // Remove undefined values from the parsed object to avoid schema validation issues
      const cleanParsed = this.removeUndefinedValues(parsed);

      // Fix arrays that were serialized as objects with numeric keys (e.g., status[0]=COMPLETED)
      const fixedParsed = this.fixArrays(cleanParsed);

      return super.transform(fixedParsed, metadata);
    }

    return super.transform(value, metadata);
  }

  private transformValue(value: any, context?: string | string[]): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Transform boolean strings
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Check if this field should be kept as string
    const path = Array.isArray(context) ? context : [context || ''];
    if (this.shouldKeepAsString(path)) {
      return value;
    }

    // Try to parse JSON strings for complex objects (like include parameters)
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        // Only return parsed value if it's an object or array
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch (e) {
        // Not valid JSON, continue with other transformations
      }
    }

    // Transform number strings (including negative numbers)
    if (/^-?\d+$/.test(value)) {
      const num = parseInt(value, 10);
      if (!isNaN(num)) return num;
    }

    if (/^-?\d+\.\d+$/.test(value)) {
      const num = parseFloat(value);
      if (!isNaN(num)) return num;
    }

    // Transform ISO date strings
    // Check if it looks like an ISO date string (e.g., 2025-09-18T23:44:09.110Z)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Keep as string
    return value;
  }

  private shouldKeepAsString(path: string[]): boolean {
    // Fields that should always be kept as strings, even if they look like numbers
    const stringOnlyFields = [
      'barcode',
      'barcodes', // Barcode fields
      'cpf',
      'cnpj',
      'pis', // Brazilian document fields
      'phone',
      'phoneNumber',
      'phoneNumbers', // Phone numbers
      'zipCode',
      'cep', // Postal codes
      'code',
      'uniCode', // Various code fields
      'serialNumber', // Serial numbers
      'searchingFor',
      'searchTerm',
      'query',
      'search',
      'q', // Search fields should remain as strings
      'tag',
      'tags', // Tag fields
      'reference',
      'ref', // Reference fields
    ];

    // Check if any part of the path contains these field names
    return path.some(segment =>
      stringOnlyFields.some(field => segment.toLowerCase().includes(field.toLowerCase())),
    );
  }

  private removeUndefinedValues(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedValues(item));
    }

    // Don't process Date objects - they are valid values
    if (obj instanceof Date) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        // Don't process Date objects - they are valid values
        if (value instanceof Date) {
          cleaned[key] = value;
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const cleanedValue = this.removeUndefinedValues(value);
          // Only add the object if it has at least one property after cleaning
          if (Object.keys(cleanedValue).length > 0) {
            cleaned[key] = cleanedValue;
          }
        } else {
          cleaned[key] = value;
        }
      }
    }

    return cleaned;
  }
}
