// packages/schemas/src/common.ts

import { cleanCNPJ, cleanCPF, cleanPhone, cleanPIS, cleanEmail, cleanSmsCode, cleanContactMethod } from '@utils';
import { isValidCNPJ, isValidCPF, isValidPhone, isValidPIS, isValidEmail, isValidSmsCode, isValidContactMethod } from '@utils';
import { z } from "zod";

// =====================
// Base Validation Schemas
// =====================

// Date and time schemas
export const dateRangeSchema = z
  .object({
    gte: z.coerce.date().optional(),
    lte: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      if (data.gte && data.lte) {
        return data.lte >= data.gte;
      }
      return true;
    },
    {
      message: "Data final deve ser posterior ou igual à data inicial",
      path: ["lte"],
    },
  );

export const nullableDate = z.coerce.date().nullable();
export const optionalDate = z.coerce.date().optional();
export const requiredDate = z.coerce.date({
  required_error: "Data é obrigatória",
  invalid_type_error: "Data inválida",
});

export const createDateSchema = (label = "data") =>
  z.coerce.date({
    required_error: `${label} é obrigatória`,
    invalid_type_error: `${label} inválida`,
  });
export const nullableNumber = z.number().nullable();
export const nullableString = z
  .string()
  .nullable()
  .transform((val) => (val === "" ? null : val));

// Additional number utilities for better null/undefined handling
export const optionalNumber = z.number().nullable().optional();
export const optionalPositiveNumber = z.number().positive().nullable().optional();
export const optionalNonNegativeNumber = z.number().min(0).nullable().optional();

// UUID validation schemas
export const createUuidSchema = (label = "ID") => z.string().uuid({ message: `${label} inválido` });

export const uuidArraySchema = (label = "valor") =>
  z
    .array(z.string().uuid({ message: `${label} inválido` }))
    .min(1, `Deve conter pelo menos um ${label}`)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: `Lista de ${label} contém duplicatas`,
    });

// Document validation schemas
export const cpfSchema = z.string().transform(cleanCPF).refine(isValidCPF, { message: "CPF inválido" });

export const cnpjSchema = z
  .string()
  .transform((val) => {
    if (!val || val.trim() === "") return "";
    return cleanCNPJ(val);
  })
  .refine(
    (val) => {
      // Empty string is valid (for optional fields)
      if (!val || val === "") return true;
      // Only validate if we have a complete CNPJ (14 digits)
      // Partial inputs during typing should be allowed
      if (val.length < 14) return true;
      // Only validate complete CNPJs
      return isValidCNPJ(val);
    },
    { message: "CNPJ inválido" },
  );

// Optional CNPJ schema for nullable fields
export const cnpjOptionalSchema = z
  .union([
    z
      .string()
      .transform((val) => {
        if (!val || val.trim() === "") return null;
        return cleanCNPJ(val);
      })
      .refine(
        (val) => {
          // Allow null/empty values
          if (!val || val === "") return true;
          // Only validate if we have exactly 14 digits
          if (val.length !== 14) return true; // Don't validate partial CNPJs
          // Validate complete CNPJs
          return isValidCNPJ(val);
        },
        { message: "CNPJ inválido" },
      ),
    z.null(),
    z.undefined(),
  ])
  .optional()
  .refine(
    (val) => {
      // null, undefined, or empty string are valid
      if (!val || val === null || val === undefined || val === "") return true;
      // Only validate if we have a complete CNPJ (14 digits)
      // Partial inputs during typing should be allowed
      if (val.length < 14) return true;
      // Only validate complete CNPJs
      return isValidCNPJ(val);
    },
    { message: "CNPJ inválido" },
  );

export const phoneSchema = z
  .string()
  .transform((val) => {
    // Don't transform if the value is already valid
    // This preserves existing phone numbers that might be in different formats
    if (!val || val.trim() === "") {
      return "";
    }

    // If it's already a valid phone format, keep it as is
    if (isValidPhone(val)) {
      return val;
    }

    // Try to clean the phone
    try {
      return cleanPhone(val);
    } catch {
      // If cleanPhone fails, return the original value
      // This prevents losing data during updates
      console.warn(`Phone validation: keeping original value "${val}" as cleanPhone failed`);
      return val;
    }
  })
  .refine(
    (val) => {
      // Allow empty strings (for optional phones)
      if (!val || val.trim() === "") return true;
      // Otherwise must be valid
      return isValidPhone(val);
    },
    { message: "Número de telefone inválido" },
  );

export const pisSchema = z.string().transform(cleanPIS).refine(isValidPIS, { message: "PIS inválido" });

// Enhanced email schema with comprehensive validation
export const emailSchema = z.string().transform(cleanEmail).refine(isValidEmail, { message: "E-mail inválido" });

// Contact method schema (email or phone)
export const contactMethodSchema = z.string().transform(cleanContactMethod).refine(isValidContactMethod, { message: "Digite um email ou telefone válido" });

// SMS code schema
export const smsCodeSchema = z.string().transform(cleanSmsCode).refine(isValidSmsCode, { message: "Código SMS inválido" });

// Generic 6-digit verification code schema (unified for all verification types)
export const verificationCodeSchema = z
  .string()
  .length(6, "Código deve ter exatamente 6 dígitos")
  .regex(/^\d{6}$/, "Código deve conter apenas números");

// Enhanced phone schema with better validation
export const phoneSchemaEnhanced = z.string().transform(cleanPhone).refine(isValidPhone, { message: "Número de telefone inválido" });

// =====================
// Generic Range Schemas
// =====================

export const createNumberRangeSchema = (label = "valor") =>
  z.object({
    gte: z.number().min(0, `${label} mínimo deve ser maior ou igual a 0`).optional(),
    lte: z.number().min(0, `${label} máximo deve ser maior ou igual a 0`).optional(),
  });

export const createIntRangeSchema = () =>
  z.object({
    gte: z.number().int().min(0).optional(),
    lte: z.number().int().min(0).optional(),
  });

// =====================
// Generic Text Validation Schemas
// =====================

export const createNameSchema = (minLength = 2, maxLength = 200, label = "nome") =>
  z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, {
      message: `${label} não pode ser vazio`,
    })
    .refine((val) => val.length >= minLength, {
      message: `${label} deve ter pelo menos ${minLength} caracteres`,
    })
    .refine((val) => val.length <= maxLength, {
      message: `${label} deve ter no máximo ${maxLength} caracteres`,
    });

export const createDescriptionSchema = (minLength = 3, maxLength = 1000, required = true) => {
  const baseSchema = z
    .string()
    .transform((val) => val.trim())
    .refine((val) => val.length >= minLength, {
      message: `Descrição deve ter pelo menos ${minLength} caracteres`,
    })
    .refine((val) => val.length <= maxLength, {
      message: `Descrição deve ter no máximo ${maxLength} caracteres`,
    })
    .refine((val) => val.length > 0, {
      message: "Descrição não pode ser vazia",
    });

  if (required) {
    return baseSchema;
  }

  // For optional fields, only validate if not empty
  return z
    .string()
    .optional()
    .transform((val: string | undefined) => (val === "" || val === undefined ? undefined : val?.trim()))
    .refine((val: string | undefined) => !val || (val.length >= minLength && val.length <= maxLength), {
      message: `Descrição deve ter entre ${minLength} e ${maxLength} caracteres`,
    });
};

// =====================
// Pagination and Ordering
// =====================

export const orderByDirectionSchema = z.enum(["asc", "desc"]);

/**
 * Normalizes orderBy to Prisma format.
 * Converts objects with multiple fields into an array of single-field objects.
 *
 * @example
 * Input: [{ status: "asc", createdAt: "desc" }]
 * Output: [{ status: "asc" }, { createdAt: "desc" }]
 */
export const normalizeOrderBy = (orderBy: any): any => {
  if (!orderBy) return orderBy;

  // If it's already an array
  if (Array.isArray(orderBy)) {
    return orderBy.flatMap(item => {
      if (typeof item !== 'object' || item === null) return item;

      // Convert multi-field object into array of single-field objects
      const entries = Object.entries(item);
      if (entries.length <= 1) return item;

      return entries.map(([key, value]) => ({ [key]: value }));
    });
  }

  // If it's a single object with multiple fields
  if (typeof orderBy === 'object' && orderBy !== null) {
    const entries = Object.entries(orderBy);
    if (entries.length <= 1) return orderBy;

    return entries.map(([key, value]) => ({ [key]: value }));
  }

  return orderBy;
};

// =====================
// Generic Batch Operations Schemas
// =====================

export const createBatchCreateSchema = <T extends z.ZodType<any>>(itemSchema: T, itemName: string, maxItems = 100) =>
  z.object({
    [`${itemName}s`]: z.array(itemSchema).min(1, `Deve incluir pelo menos um ${itemName}`).max(maxItems, `Limite máximo de ${maxItems} ${itemName}s por vez`),
  });

export const createBatchUpdateSchema = <T extends z.ZodType<any>>(updateSchema: T, itemName: string, maxItems = 100) =>
  z.object({
    [`${itemName}s`]: z
      .array(
        z.object({
          id: z.string().uuid({ message: `${itemName} inválido` }),
          data: updateSchema,
        }),
      )
      .min(1, `Deve incluir pelo menos um ${itemName}`)
      .max(maxItems, `Limite máximo de ${maxItems} ${itemName}s por vez`),
  });

export const createBatchDeleteSchema = (itemName: string, maxItems = 100) =>
  z.object({
    [`${itemName}Ids`]: z
      .array(z.string().uuid({ message: `${itemName} inválido` }))
      .min(1, `Deve incluir pelo menos um ${itemName}`)
      .max(maxItems, `Limite máximo de ${maxItems} ${itemName}s por vez`),
    reason: z.string().optional(),
  });

// Common batch query schema for include parameter
export const createBatchQuerySchema = <T extends z.ZodType<any>>(includeSchema: T) =>
  z.object({
    include: includeSchema.optional(),
  });

// =====================
// Array Validation Helpers
// =====================

export const createArraySchema = <T extends z.ZodType<any>>(itemSchema: T, minItems = 0, maxItems = 100, label = "item") =>
  z
    .array(itemSchema)
    .min(minItems, minItems > 0 ? `Deve incluir pelo menos ${minItems} ${label}${minItems > 1 ? "s" : ""}` : undefined)
    .max(maxItems, `Limite máximo de ${maxItems} ${label}s`);

export const createUniqueArraySchema = <T extends z.ZodType<any>>(itemSchema: T, minItems = 0, maxItems = 100, label = "item") =>
  createArraySchema(itemSchema, minItems, maxItems, label).refine((arr) => new Set(arr).size === arr.length, {
    message: `Lista não pode conter ${label}s duplicados`,
  });

// =====================
// Status Change Schemas
// =====================

export const createStatusChangeSchema = <TStatus extends z.ZodType<any>>(statusSchema: TStatus) =>
  z.object({
    newStatus: statusSchema,
    reason: z.string().min(3, "Motivo deve ter pelo menos 3 caracteres").optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }),
  });

export const createBulkStatusChangeSchema = <TStatus extends z.ZodType<any>>(statusSchema: TStatus, entityName = "entidade", maxItems = 100) =>
  z.object({
    [`${entityName}Ids`]: z
      .array(z.string().uuid({ message: `${entityName} inválido` }))
      .min(1, `Deve incluir pelo menos um ${entityName}`)
      .max(maxItems, `Limite máximo de ${maxItems} ${entityName}s por vez`),
    newStatus: statusSchema,
    reason: z.string().min(3, "Motivo deve ter pelo menos 3 caracteres").optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }),
  });

// =====================
// Date/Time Helpers
// =====================

export const createDateRangeSchema = (fieldName: string) =>
  z
    .object({
      gte: z.coerce
        .date({
          invalid_type_error: `Data inicial de ${fieldName} inválida`,
        })
        .optional(),
      lte: z.coerce
        .date({
          invalid_type_error: `Data final de ${fieldName} inválida`,
        })
        .optional(),
    })
    .refine(
      (data) => {
        if (data.gte && data.lte) {
          return data.lte >= data.gte;
        }
        return true;
      },
      {
        message: `Data final de ${fieldName} deve ser posterior ou igual à data inicial`,
        path: ["lte"],
      },
    );

// =====================
// Common Utility Functions
// =====================

export const createMapToFormDataHelper = <TEntity, TFormData>(mapper: (entity: TEntity) => TFormData) => mapper;

// Simple identity function for form data transformation
export const toFormData = <T>(data: T) => data;

// =====================
// Audit and History
// =====================

export const createAuditSchema = () =>
  z.object({
    entityType: z.string(),
    entityId: z.string().uuid({ message: "Entidade inválida" }),
    action: z.string(),
    field: z.string().optional(),
    oldValue: z.any().optional(),
    newValue: z.any().optional(),
    reason: z.string().optional(),
    userId: z.string().uuid({ message: "Usuário inválido" }).optional(),
  });

// =====================
// Additional Common Validation Patterns
// =====================

// URL validation with Portuguese message
export const urlSchema = z.string().url({ message: "URL inválida" });

// State code validation (Brazilian states)
export const stateCodeSchema = z.string().length(2, { message: "Estado deve ter 2 caracteres" }).toUpperCase();

// Hex color validation
export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: "Cor HEX inválida" });

// Percentage validation (0-100)
export const percentageSchema = z.number().min(0, { message: "Porcentagem deve ser maior ou igual a 0" }).max(100, { message: "Porcentagem deve ser menor ou igual a 100" });

// Money/currency validation (non-negative with 2 decimal places)
export const moneySchema = z.number().min(0, { message: "Valor deve ser maior ou igual a 0" }).multipleOf(0.01, { message: "Valor deve ter no máximo 2 casas decimais" });

// Positive quantity validation
export const quantitySchema = z.number().positive({ message: "Quantidade deve ser positiva" });

// File size validation helper
export const createFileSizeSchema = (maxSizeMB: number) =>
  z.number().max(maxSizeMB * 1024 * 1024, {
    message: `Arquivo deve ter no máximo ${maxSizeMB}MB`,
  });

// Common arrays
export const phoneArraySchema = z.array(z.string()).default([]);
export const tagArraySchema = z.array(z.string()).default([]);

// Pagination schema
export const paginationSchema = z.object({
  page: z.number().int().min(0).default(1).optional(),
  limit: z.number().int().positive().max(100).default(20).optional(),
});

// Search mode for case sensitivity
export const searchModeSchema = z.enum(["default", "insensitive"]);

// =====================
// Where Clause Helpers
// =====================

// String where clause
export const createStringWhereSchema = () =>
  z.union([
    z.string(),
    z.object({
      equals: z.string().optional(),
      not: z.string().optional(),
      in: z.array(z.string()).optional(),
      notIn: z.array(z.string()).optional(),
      contains: z.string().optional(),
      startsWith: z.string().optional(),
      endsWith: z.string().optional(),
      mode: searchModeSchema.optional(),
    }),
  ]);

// UUID where clause
export const createUuidWhereSchema = () =>
  z.union([
    z.string(),
    z.object({
      equals: z.string().optional(),
      not: z.string().optional(),
      in: z.array(z.string()).optional(),
      notIn: z.array(z.string()).optional(),
    }),
  ]);

// Number where clause
export const createNumberWhereSchema = () =>
  z.union([
    z.number(),
    z.object({
      equals: z.number().optional(),
      not: z.number().optional(),
      in: z.array(z.number()).optional(),
      notIn: z.array(z.number()).optional(),
      lt: z.number().optional(),
      lte: z.number().optional(),
      gt: z.number().optional(),
      gte: z.number().optional(),
    }),
  ]);

// Date where clause
export const createDateWhereSchema = () =>
  z.union([
    z.coerce.date(),
    z.object({
      equals: z.coerce.date().optional(),
      not: z.coerce.date().optional(),
      in: z.array(z.coerce.date()).optional(),
      notIn: z.array(z.coerce.date()).optional(),
      lt: z.coerce.date().optional(),
      lte: z.coerce.date().optional(),
      gt: z.coerce.date().optional(),
      gte: z.coerce.date().optional(),
    }),
  ]);

// Boolean where clause
export const createBooleanWhereSchema = () =>
  z.union([
    z.boolean(),
    z.object({
      equals: z.boolean().optional(),
      not: z.boolean().optional(),
    }),
  ]);

// Array where clause
export const createArrayWhereSchema = () =>
  z.object({
    has: z.string().optional(),
    hasEvery: z.array(z.string()).optional(),
    hasSome: z.array(z.string()).optional(),
    isEmpty: z.boolean().optional(),
  });

// Relation where clause
export const createRelationWhereSchema = () =>
  z.object({
    is: z.any().optional(),
    isNot: z.any().optional(),
    some: z.any().optional(),
    every: z.any().optional(),
    none: z.any().optional(),
  });

// =====================
// Transform Helpers
// =====================

// Create search OR conditions
export const createSearchTransform = (searchingFor: string, fields: string[]) => {
  if (!searchingFor?.trim()) return null;

  return {
    OR: fields.map((field) => ({
      [field]: { contains: searchingFor.trim(), mode: "insensitive" },
    })),
  };
};

// Create has/doesn't have filter
export const createHasFilterTransform = (hasValue: boolean | undefined, field: string) => {
  if (hasValue === undefined) return null;

  if (hasValue) {
    return { [field]: { some: {} } };
  } else {
    return { [field]: { none: {} } };
  }
};

// Create null/not null filter
export const createNullFilterTransform = (hasValue: boolean | undefined, field: string) => {
  if (hasValue === undefined) return null;

  if (hasValue) {
    return { [field]: { not: null } };
  } else {
    return { [field]: null };
  }
};

// Merge AND conditions helper
export const mergeAndConditions = (data: any, andConditions: any[]) => {
  if (andConditions.length === 0) return data;

  if (data.where) {
    if (data.where.AND && Array.isArray(data.where.AND)) {
      data.where.AND = [...data.where.AND, ...andConditions];
    } else {
      data.where = { AND: [data.where, ...andConditions] };
    }
  } else {
    data.where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
  }

  return data;
};

// =====================
// Include Schema Helper
// =====================

export const createIncludeSchema = (relations: Record<string, any>) =>
  z.union([
    z.boolean(),
    z.object({
      include: z.object(relations).optional(),
    }),
  ]);

// =====================
// Common Business Field Schemas
// =====================

export const fantasyNameSchema = createNameSchema(2, 255, "Nome fantasia");
export const corporateNameSchema = createNameSchema(2, 255, "Razão social").nullable().optional();
export const addressSchema = z.string().max(500, { message: "Endereço deve ter no máximo 500 caracteres" }).nullable().optional();
export const citySchema = z.string().max(100, { message: "Cidade deve ter no máximo 100 caracteres" }).nullable().optional();
export const notesSchema = z.string().max(1000, { message: "Observações devem ter no máximo 1000 caracteres" }).nullable().optional();

// =====================
// Export commonly used validation patterns
// =====================

export const commonValidations = {
  // Text validations
  createNameSchema,
  createDescriptionSchema,
  fantasyNameSchema,
  corporateNameSchema,
  addressSchema,
  citySchema,
  notesSchema,

  // Number validations
  createNumberRangeSchema,
  createIntRangeSchema,
  percentageSchema,
  moneySchema,
  quantitySchema,

  // Array validations
  createArraySchema,
  createUniqueArraySchema,
  phoneArraySchema,
  tagArraySchema,

  // Date validations
  createDateRangeSchema,
  dateRangeSchema,
  nullableDate,
  optionalDate,
  requiredDate,

  // Complex operations
  createStatusChangeSchema,
  createBulkStatusChangeSchema,

  // Where clause helpers
  createStringWhereSchema,
  createUuidWhereSchema,
  createNumberWhereSchema,
  createDateWhereSchema,
  createBooleanWhereSchema,
  createArrayWhereSchema,
  createRelationWhereSchema,

  // Transform helpers
  createSearchTransform,
  createHasFilterTransform,
  createNullFilterTransform,
  mergeAndConditions,

  // Other helpers
  createIncludeSchema,
  createFileSizeSchema,
};
